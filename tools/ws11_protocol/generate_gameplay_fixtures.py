#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, struct
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from gameplay import build_frame

ROOT = Path(__file__).resolve().parents[2]
GOOD = ROOT / "protocol-lab" / "gameplay-fixtures"
BAD = ROOT / "protocol-lab" / "negative-fixtures"

def i16(v): return struct.pack("<h", v)
def u16(v): return struct.pack("<H", v)
def u32(v): return struct.pack("<I", v)

fixtures = {
    "game_move_start_demo.bin": build_frame(bytes([0x06]) + u16(1000) + u16(1200) + i16(50) + u16(45) + bytes([1])),
    "game_rotate_demo.bin": build_frame(bytes([0x09]) + i16(157)),
    "game_attack_normal_demo.bin": build_frame(bytes([0x08, 1]) + i16(10001) + i16(110) + i16(25)),
    "game_regen_town_request.bin": build_frame(bytes([0x12, 1])),
    "game_bundle_open_demo.bin": build_frame(bytes([0x24]) + u32(123456)),
    "game_npc_event_demo.bin": build_frame(bytes([0x20]) + i16(10001)),
    "game_magic_casting_demo.bin": build_frame(bytes([0x31, 1]) + u32(102003) + i16(1010) + i16(10001) + i16(0)*6),
    "game_magic_type4_expired_short.bin": build_frame(bytes([0x31, 5, 7])),
    "game_dead_demo.bin": build_frame(bytes([0x11]) + i16(1010)),
    "game_exp_change_demo.bin": build_frame(bytes([0x1A]) + u32(1234567)),
}
meta = {
    "game_move_start_demo.bin": ("0x06","WIZ_MOVE","C2S","c2s"),
    "game_rotate_demo.bin": ("0x09","WIZ_ROTATE","C2S","c2s"),
    "game_attack_normal_demo.bin": ("0x08","WIZ_ATTACK","C2S","c2s_normal"),
    "game_regen_town_request.bin": ("0x12","WIZ_REGENE","C2S","c2s_town"),
    "game_bundle_open_demo.bin": ("0x24","WIZ_BUNDLE_OPEN_REQ","C2S","c2s"),
    "game_npc_event_demo.bin": ("0x20","WIZ_NPC_EVENT","C2S","c2s"),
    "game_magic_casting_demo.bin": ("0x31","WIZ_MAGIC_PROCESS","C2S","generic_full"),
    "game_magic_type4_expired_short.bin": ("0x31","WIZ_MAGIC_PROCESS","S2C","type4_expired_short"),
    "game_dead_demo.bin": ("0x11","WIZ_DEAD","S2C","s2c"),
    "game_exp_change_demo.bin": ("0x1A","WIZ_EXP_CHANGE","S2C","s2c"),
}
GOOD.mkdir(parents=True, exist_ok=True)
entries=[]
for name, data in fixtures.items():
    (GOOD/name).write_bytes(data)
    opcode, symbolic, direction, variant = meta[name]
    entries.append({
        "file":name,"opcode":opcode,"name":symbolic,"direction":direction,"authority_variant":variant,
        "frame_bytes":len(data),"payload_bytes":len(data)-6,"sha256":hashlib.sha256(data).hexdigest(),
        "frame_hex":data.hex(),"provenance":"synthetic-source-derived",
        "source_commit":"Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5"
    })
(GOOD/"manifest.json").write_text(json.dumps({
    "format":"ko1298-gameplay-golden-fixtures-v1",
    "frame":"AA55 + u16le payload length + payload + 55AA",
    "fixtures":entries
}, indent=2)+"\n", encoding="utf-8")

negative = {
    "truncated_frame.bin": bytes.fromhex("aa55050006e8"),
    "oversized_declared_length.bin": bytes.fromhex("aa55ffff0655aa"),
    "wrong_string_length.bin": build_frame(bytes([0xF3]) + i16(10) + b"x"),
    "invalid_magic_subopcode.bin": build_frame(bytes([0x31,0xFF]) + u32(102003) + i16(1010) + i16(10001) + i16(0)*6),
    "impossible_attack_enum.bin": build_frame(bytes([0x08,9,1]) + i16(1010) + i16(10001)),
    "malformed_header.bin": bytes.fromhex("ab550100fe55aa"),
    "unknown_opcode.bin": build_frame(bytes([0xAB,0])),
}
BAD.mkdir(parents=True, exist_ok=True)
for name, data in negative.items():
    (BAD/name).write_bytes(data)
(BAD/"manifest.json").write_text(json.dumps({
    "format":"ko1298-negative-fixtures-v1",
    "fixtures":[
        {"file":"truncated_frame.bin","expect":"FRAME_REJECT"},
        {"file":"oversized_declared_length.bin","expect":"FRAME_REJECT"},
        {"file":"wrong_string_length.bin","expect":"SEMANTIC_REJECT_OR_UNKNOWN"},
        {"file":"invalid_magic_subopcode.bin","expect":"UNKNOWN_VARIANT"},
        {"file":"impossible_attack_enum.bin","expect":"ENUM_REJECT"},
        {"file":"malformed_header.bin","expect":"FRAME_REJECT"},
        {"file":"unknown_opcode.bin","expect":"UNKNOWN_OPCODE"}
    ],
    "non_binary_negative_tests":["integer width overflow is rejected by serializer before bytes exist"]
}, indent=2)+"\n", encoding="utf-8")
print(f"generated {len(fixtures)} golden and {len(negative)} negative fixtures")
