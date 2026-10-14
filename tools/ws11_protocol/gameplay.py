#!/usr/bin/env python3
"""Strict authority-driven KO 1298 gameplay packet parser/serializer.

Only fixed, exact layouts in protocol-lab/gameplay-authority.json are decoded or
serialized. Variable/partial layouts fail closed instead of being guessed.
"""
from __future__ import annotations

import json
from pathlib import Path
import struct
from typing import Any

HEADER = b"\xaa\x55"
TAIL = b"\x55\xaa"
ROOT = Path(__file__).resolve().parents[2]
AUTHORITY_PATH = ROOT / "protocol-lab" / "gameplay-authority.json"


class ProtocolError(ValueError):
    pass


def parse_frame(raw: bytes) -> bytes:
    if len(raw) < 7:
        raise ProtocolError("truncated frame")
    if raw[:2] != HEADER:
        raise ProtocolError("invalid frame header")
    length = struct.unpack_from("<H", raw, 2)[0]
    if length < 1:
        raise ProtocolError("empty payload")
    if len(raw) != length + 6:
        raise ProtocolError(f"frame length mismatch: declared={length} actual={len(raw)-6}")
    if raw[-2:] != TAIL:
        raise ProtocolError("invalid frame tail")
    return raw[4:-2]


def build_frame(payload: bytes) -> bytes:
    if not payload:
        raise ProtocolError("empty payload")
    if len(payload) > 0xFFFF:
        raise ProtocolError("payload too large")
    return HEADER + struct.pack("<H", len(payload)) + payload + TAIL


def load_authority(path: Path = AUTHORITY_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def packet_by_opcode(opcode: int, authority: dict[str, Any] | None = None) -> dict[str, Any] | None:
    authority = authority or load_authority()
    rows = [p for p in authority["packets"] if int(p["opcode"], 0) == opcode]
    return rows[0] if len(rows) == 1 else None


_PRIMITIVES = {
    "u8": ("<B", 1, 0, 0xFF),
    "u16le": ("<H", 2, 0, 0xFFFF),
    "i16le": ("<h", 2, -0x8000, 0x7FFF),
    "u32le": ("<I", 4, 0, 0xFFFFFFFF),
}


def _decode_primitive(payload: bytes, field: dict[str, Any]) -> Any:
    t = field["type"]
    if t not in _PRIMITIVES:
        raise ProtocolError(f"non-fixed field type {t}")
    fmt, width, _, _ = _PRIMITIVES[t]
    off = field["offset"]
    if off + width > len(payload):
        raise ProtocolError(f"field {field['field']} overflows payload")
    value = struct.unpack_from(fmt, payload, off)[0]
    scale = field.get("scale")
    return value * scale if scale is not None else value


def _variant(packet: dict[str, Any], direction: str, payload: bytes) -> dict[str, Any]:
    direction = direction.upper()
    if direction not in {"C2S", "S2C"}:
        raise ProtocolError("direction must be C2S or S2C")
    candidates = [
        v for v in packet.get("variants", [])
        if v.get("direction") == direction and isinstance(v.get("payload_bytes"), int)
        and v["payload_bytes"] == len(payload)
    ]
    if packet["name"] == "WIZ_MAGIC_PROCESS" and len(payload) >= 2:
        command = payload[1]
        if command == 5 and len(payload) == 3:
            candidates = [v for v in candidates if v["id"] == "type4_expired_short"]
        elif len(payload) == 22:
            wanted = "generic_full" if direction == "C2S" else "generic_full_s2c"
            candidates = [v for v in candidates if v["id"] == wanted]
    if len(candidates) != 1:
        raise ProtocolError(
            f"no unique exact variant for {packet['name']} direction={direction} payload={len(payload)}"
        )
    return candidates[0]


def decode_payload(payload: bytes, direction: str, authority: dict[str, Any] | None = None) -> dict[str, Any]:
    if not payload:
        raise ProtocolError("empty payload")
    authority = authority or load_authority()
    packet = packet_by_opcode(payload[0], authority)
    if packet is None:
        return {
            "opcode": f"0x{payload[0]:02X}",
            "name": "UNKNOWN",
            "direction": direction.upper(),
            "confidence": "UNKNOWN",
            "payload_hex": payload.hex(),
        }
    try:
        variant = _variant(packet, direction, payload)
    except ProtocolError as exc:
        return {
            "opcode": packet["opcode"],
            "name": packet["name"],
            "direction": direction.upper(),
            "confidence": packet["confidence"],
            "variant": "UNKNOWN",
            "payload_hex": payload.hex(),
            "reason": str(exc),
        }
    fields: dict[str, Any] = {}
    for field in variant["fields"]:
        try:
            fields[field["field"]] = _decode_primitive(payload, field)
        except ProtocolError:
            fields[field["field"]] = "UNKNOWN"
    return {
        "opcode": packet["opcode"],
        "name": packet["name"],
        "direction": direction.upper(),
        "confidence": packet["confidence"],
        "variant": variant["id"],
        "fields": fields,
        "payload_hex": payload.hex(),
    }


def decode_frame(raw: bytes, direction: str) -> dict[str, Any]:
    return decode_payload(parse_frame(raw), direction)


def serialize_fixed(name: str, variant_id: str, values: dict[str, int]) -> bytes:
    authority = load_authority()
    packet = next((p for p in authority["packets"] if p["name"] == name), None)
    if packet is None:
        raise ProtocolError(f"unknown packet name {name}")
    variant = next((v for v in packet.get("variants", []) if v["id"] == variant_id), None)
    if variant is None or not isinstance(variant.get("payload_bytes"), int):
        raise ProtocolError(f"{name}/{variant_id} is not an exact fixed variant")
    size = variant["payload_bytes"]
    out = bytearray(size)
    for field in variant["fields"]:
        t = field["type"]
        if t not in _PRIMITIVES:
            raise ProtocolError(f"{name}/{variant_id} contains non-fixed field {t}")
        fmt, width, lo, hi = _PRIMITIVES[t]
        fname = field["field"]
        if fname == "opcode":
            value = int(packet["opcode"], 0)
        elif "value" in field:
            value = int(field["value"], 0) if isinstance(field["value"], str) else int(field["value"])
        else:
            if fname not in values:
                raise ProtocolError(f"missing field {fname}")
            value = values[fname]
            scale = field.get("scale")
            if scale:
                value = round(value / scale)
        if not isinstance(value, int) or not lo <= value <= hi:
            raise ProtocolError(f"{fname} out of range for {t}: {value}")
        struct.pack_into(fmt, out, field["offset"], value)
    return bytes(out)
