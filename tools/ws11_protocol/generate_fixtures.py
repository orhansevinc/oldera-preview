#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ko1298 import build_frame  # noqa: E402

ROOT = Path(__file__).resolve().parents[2] / "protocol-lab" / "fixtures"


def s16(n: int) -> bytes:
    return struct.pack("<h", n)


def u16(n: int) -> bytes:
    return struct.pack("<H", n)


def u32(n: int) -> bytes:
    return struct.pack("<I", n)


def u64(n: int) -> bytes:
    return struct.pack("<Q", n)


def lp16(text: str) -> bytes:
    raw = text.encode("ascii")
    return s16(len(raw)) + raw


def char_slot(name: str = "") -> bytes:
    raw = name.encode("ascii")
    # Empty slots still have all source-read fields in the response body.
    out = s16(len(raw)) + raw
    out += bytes([0])       # race
    out += s16(0)           # class
    out += bytes([0, 0, 0, 0])  # level, face, hair, zone
    for _ in range(8):
        out += u32(0) + s16(0)
    return out


fixtures = {
    "login_serverlist_request.bin": bytes([0xF5]),
    "login_serverlist_response_demo.bin": (
        bytes([0xF5, 1]) + lp16("127.0.0.1") + lp16("OldKO-Lab") + s16(7)
    ),
    "login_account_request_demo.bin": bytes([0xF3]) + lp16("demo") + lp16("demo"),
    "login_account_response_ok.bin": bytes([0xF3, 1]),
    "login_news_request.bin": bytes([0xF6]),
    "login_news_response_demo.bin": (
        bytes([0xF6]) + u16(len(b"Login Notice")) + b"Login Notice" + u16(len(b"WS11 fixture")) + b"WS11 fixture"
    ),
    "game_version_request.bin": bytes([0x2B]),
    "game_version_response_1298_no_crypto.bin": bytes([0x2B]) + s16(1298) + u64(0),
    "game_login_request_demo.bin": bytes([0x01]) + lp16("demo") + lp16("demo"),
    "game_login_response_nationless.bin": bytes([0x01, 0]),
    "nation_select_karus_request.bin": bytes([0x05, 1]),
    "nation_select_karus_response.bin": bytes([0x05, 1]),
    "allchar_request.bin": bytes([0x0C]),
    "allchar_response_empty.bin": bytes([0x0C, 1]) + char_slot() + char_slot() + char_slot(),
    "character_select_request_demo.bin": bytes([0x04]) + lp16("demo") + lp16("FixtureChar") + bytes([1, 1]),
    "character_select_success_demo.bin": (
        bytes([0x04, 1, 1]) + u16(1000) + u16(1000) + s16(0) + bytes([0])
    ),
    "gamestart_phase1_request.bin": bytes([0x0D, 1]),
    "gamestart_signal_unknown_body.bin": bytes([0x0D]),
    "gamestart_phase2_request.bin": bytes([0x0D, 2]),
    "unknown_game_fe.bin": bytes([0xFE, 0x57, 0x53, 0x31, 0x31]),
}

metadata = {
    "login_serverlist_request.bin": ("login", "C2S", "0xF5", "LS_SERVERLIST", "observed", "Exact frame already asserted by openko-browser-network-v2 workflow/probe."),
    "login_serverlist_response_demo.bin": ("login", "S2C", "0xF5", "LS_SERVERLIST", "synthetic-source-derived", "One ASCII server entry; layout follows GameProcLogIn_1298::MsgRecv_GameServerGroupList."),
    "login_account_request_demo.bin": ("login", "C2S", "0xF3", "LS_LOGIN_REQ", "synthetic-source-derived", "ASCII demo credentials; layout follows MsgSend_AccountLogIn."),
    "login_account_response_ok.bin": ("login", "S2C", "0xF3", "LS_LOGIN_REQ", "synthetic-source-derived", "AUTH_OK result byte only."),
    "login_news_request.bin": ("login", "C2S", "0xF6", "LS_NEWS", "source-derived", "One-byte news request."),
    "login_news_response_demo.bin": ("login", "S2C", "0xF6", "LS_NEWS", "synthetic-source-derived", "ASCII notice using source-read u16 lengths."),
    "game_version_request.bin": ("game", "C2S", "0x2B", "WIZ_VERSION_CHECK", "source-derived", "One-byte version request."),
    "game_version_response_1298_no_crypto.bin": ("game", "S2C", "0x2B", "WIZ_VERSION_CHECK", "synthetic-source-derived", "1298 plus uint64 public key 0; inspected client leaves JvCryption inactive."),
    "game_login_request_demo.bin": ("game", "C2S", "0x01", "WIZ_LOGIN", "synthetic-source-derived", "ASCII demo credentials."),
    "game_login_response_nationless.bin": ("game", "S2C", "0x01", "WIZ_LOGIN", "synthetic-source-derived", "Nation 0 routes client to nation select."),
    "nation_select_karus_request.bin": ("game", "C2S", "0x05", "WIZ_SEL_NATION", "synthetic-source-derived", "Nation 1 (Karus)."),
    "nation_select_karus_response.bin": ("game", "S2C", "0x05", "WIZ_SEL_NATION", "synthetic-source-derived", "Nation 1 (Karus)."),
    "allchar_request.bin": ("game", "C2S", "0x0C", "WIZ_ALLCHAR_INFO_REQ", "source-derived", "One-byte all-character request."),
    "allchar_response_empty.bin": ("game", "S2C", "0x0C", "WIZ_ALLCHAR_INFO_REQ", "synthetic-source-derived", "Success plus three empty slots, including every field the client reads."),
    "character_select_request_demo.bin": ("game", "C2S", "0x04", "WIZ_SEL_CHAR", "synthetic-source-derived", "ASCII account/character with zoneInit=1 and wire zone=1."),
    "character_select_success_demo.bin": ("game", "S2C", "0x04", "WIZ_SEL_CHAR", "synthetic-source-derived", "Success, wire zone 1, XYZ raw 1000/1000/0, victory 0."),
    "gamestart_phase1_request.bin": ("game", "C2S", "0x0D", "WIZ_GAMESTART", "source-derived", "Main scene sends phase 1 after resource preload."),
    "gamestart_signal_unknown_body.bin": ("game", "S2C", "0x0D", "WIZ_GAMESTART", "synthetic-source-derived", "Opcode-only signal. Client handler does not read a verified body; body semantics remain UNKNOWN."),
    "gamestart_phase2_request.bin": ("game", "C2S", "0x0D", "WIZ_GAMESTART", "source-derived", "Client replies phase 2 when WIZ_GAMESTART is received."),
    "unknown_game_fe.bin": ("game", "S2C", "0xFE", "WIZ_DEBUG_STRING_PACKET", "synthetic-unknown", "Deliberately opaque body for UNKNOWN behavior tests."),
}

ROOT.mkdir(parents=True, exist_ok=True)
entries = []
for filename, payload in fixtures.items():
    frame = build_frame(payload)
    (ROOT / filename).write_bytes(frame)
    channel, direction, opcode, name, provenance, note = metadata[filename]
    entries.append({
        "file": filename,
        "channel": channel,
        "direction": direction,
        "opcode": opcode,
        "name": name,
        "provenance": provenance,
        "frame_bytes": len(frame),
        "payload_bytes": len(payload),
        "frame_hex": frame.hex(),
        "payload_hex": payload.hex(),
        "note": note,
    })

manifest = {
    "format": "ko1298-raw-frame-fixture-v1",
    "description": "Each .bin is raw KO wire bytes: AA55 + little-endian uint16 payload length + payload + 55AA.",
    "source_commit": "luisfelipe18/old-school-openko@97eb0ea20207afc0c360bfed6915113572711be3",
    "base_commit": "orhansevinc/oldera-preview@18282d0e70de7ccb30244a9f09e2b3bff3040155",
    "fixtures": entries,
}
(ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

sequence = {
    "format": "ko1298-replay-sequence-v1",
    "fixture_root": "fixtures",
    "notes": [
        "Login and game are separate TCP connections.",
        "Live replay sends C2S only; S2C steps are documentation/decoder fixtures and are never synthesized onto a live server connection.",
        "The sequence chooses the nationless branch to demonstrate WIZ_SEL_NATION.",
        "The empty-character response and later character-select demo are independent source-derived fixtures, not a claim that one real session can select a nonexistent character."
    ],
    "steps": [
        {"order": 1, "channel": "login", "direction": "C2S", "fixture": "login_serverlist_request.bin", "event": "login socket connected"},
        {"order": 2, "channel": "login", "direction": "S2C", "fixture": "login_serverlist_response_demo.bin", "event": "server list"},
        {"order": 3, "channel": "login", "direction": "C2S", "fixture": "login_account_request_demo.bin", "event": "credential login"},
        {"order": 4, "channel": "login", "direction": "S2C", "fixture": "login_account_response_ok.bin", "event": "auth OK"},
        {"order": 5, "channel": "login", "direction": "C2S", "fixture": "login_news_request.bin", "event": "news request"},
        {"order": 6, "channel": "login", "direction": "S2C", "fixture": "login_news_response_demo.bin", "event": "news response"},
        {"order": 7, "channel": "game", "direction": "C2S", "fixture": "game_version_request.bin", "event": "game socket connected"},
        {"order": 8, "channel": "game", "direction": "S2C", "fixture": "game_version_response_1298_no_crypto.bin", "event": "version 1298; public key 0"},
        {"order": 9, "channel": "game", "direction": "C2S", "fixture": "game_login_request_demo.bin", "event": "game login"},
        {"order": 10, "channel": "game", "direction": "S2C", "fixture": "game_login_response_nationless.bin", "event": "nation 0"},
        {"order": 11, "channel": "game", "direction": "C2S", "fixture": "nation_select_karus_request.bin", "event": "select nation"},
        {"order": 12, "channel": "game", "direction": "S2C", "fixture": "nation_select_karus_response.bin", "event": "nation selected"},
        {"order": 13, "channel": "game", "direction": "C2S", "fixture": "allchar_request.bin", "event": "request character slots"},
        {"order": 14, "channel": "game", "direction": "S2C", "fixture": "allchar_response_empty.bin", "event": "three empty source-layout slots"},
        {"order": 15, "channel": "game", "direction": "C2S", "fixture": "character_select_request_demo.bin", "event": "independent character-select fixture"},
        {"order": 16, "channel": "game", "direction": "S2C", "fixture": "character_select_success_demo.bin", "event": "character-select success; client initializes zone"},
        {"order": 17, "channel": "game", "direction": "C2S", "fixture": "gamestart_phase1_request.bin", "event": "main scene/resource preload complete"},
        {"order": 18, "channel": "game", "direction": "S2C", "fixture": "gamestart_signal_unknown_body.bin", "event": "server gamestart signal; body UNKNOWN"},
        {"order": 19, "channel": "game", "direction": "C2S", "fixture": "gamestart_phase2_request.bin", "event": "second gamestart phase"},
    ],
}
(ROOT.parent / "login_to_zone.sequence.json").write_text(json.dumps(sequence, indent=2) + "\n", encoding="utf-8")
print(f"generated {len(entries)} fixtures")
