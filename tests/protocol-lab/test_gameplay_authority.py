from __future__ import annotations
import json, random, subprocess, sys, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"tools"/"ws11_protocol"))
from gameplay import ProtocolError, build_frame, decode_frame, decode_payload, parse_frame, serialize_fixed

GOOD=ROOT/"protocol-lab"/"gameplay-fixtures"
BAD=ROOT/"protocol-lab"/"negative-fixtures"

class GameplayAuthorityTests(unittest.TestCase):
    def test_golden_fixture_manifest_integrity(self):
        manifest=json.loads((GOOD/"manifest.json").read_text())
        self.assertEqual(len(manifest["fixtures"]),10)
        for e in manifest["fixtures"]:
            raw=(GOOD/e["file"]).read_bytes()
            self.assertEqual(raw.hex(),e["frame_hex"])
            d=decode_frame(raw,e["direction"])
            self.assertEqual(d["name"],e["name"])
            self.assertEqual(d["variant"],e["authority_variant"])

    def test_move_decode_and_roundtrip_serializer(self):
        d=decode_frame((GOOD/"game_move_start_demo.bin").read_bytes(),"C2S")
        self.assertEqual(d["fields"]["x10"],100.0)
        self.assertEqual(d["fields"]["z10"],120.0)
        self.assertEqual(d["fields"]["y10"],5.0)
        self.assertEqual(d["fields"]["speed10"],4.5)
        p=serialize_fixed("WIZ_MOVE","c2s",{"x10":100.0,"z10":120.0,"y10":5.0,"speed10":4.5,"move_flag":1})
        self.assertEqual(build_frame(p),(GOOD/"game_move_start_demo.bin").read_bytes())

    def test_attack_decode_and_roundtrip_serializer(self):
        d=decode_frame((GOOD/"game_attack_normal_demo.bin").read_bytes(),"C2S")
        self.assertEqual(d["fields"]["attack_type"],1)
        self.assertEqual(d["fields"]["target_id"],10001)
        p=serialize_fixed("WIZ_ATTACK","c2s_normal",{"target_id":10001,"interval100":1.10,"distance10":2.5})
        self.assertEqual(build_frame(p),(GOOD/"game_attack_normal_demo.bin").read_bytes())


    def test_magic_generic_s2c_variant_is_direction_safe(self):
        raw = build_frame(bytes([0x31, 4]) + (102003).to_bytes(4, "little") + (1010).to_bytes(2, "little", signed=True) + (10001).to_bytes(2, "little", signed=True) + (0).to_bytes(2, "little", signed=True) * 6)
        d = decode_frame(raw, "S2C")
        self.assertEqual(d["name"], "WIZ_MAGIC_PROCESS")
        self.assertEqual(d["variant"], "generic_full_s2c")

    def test_magic_command_values_and_short_expiry_variant(self):
        a=json.loads((ROOT/"protocol-lab"/"gameplay-authority.json").read_text())
        magic=next(p for p in a["packets"] if p["name"]=="WIZ_MAGIC_PROCESS")
        self.assertEqual(magic["subopcodes"]["1"],"CASTING")
        self.assertIn("DURATION_EXPIRED",magic["subopcodes"]["5"])
        self.assertEqual(magic["subopcodes"]["6"],"CANCEL")
        d=decode_frame((GOOD/"game_magic_type4_expired_short.bin").read_bytes(),"S2C")
        self.assertEqual(d["variant"],"type4_expired_short")
        self.assertEqual(d["fields"]["command"],5)
        self.assertEqual(d["fields"]["buff_type"],7)

    def test_owner_collision_0x1d_is_resolved_by_semantic_split(self):
        m=json.loads((ROOT/"protocol-lab"/"PROTOCOL_OWNER_MATRIX.json").read_text())
        row=next(r for r in m["matrix"] if r["opcode"]=="0x1D")
        self.assertEqual(row["status"],"COLLISION_RESOLVED")
        self.assertIn("WS14",row["semantic_owner"])
        self.assertIn("WS16",row["semantic_owner"])

    def test_unknown_opcode_is_reported_not_guessed(self):
        d=decode_frame((BAD/"unknown_opcode.bin").read_bytes(),"C2S")
        self.assertEqual(d["name"],"UNKNOWN")
        self.assertEqual(d["confidence"],"UNKNOWN")

    def test_invalid_magic_subopcode_does_not_claim_variant_semantics(self):
        d=decode_frame((BAD/"invalid_magic_subopcode.bin").read_bytes(),"C2S")
        self.assertEqual(d["name"],"WIZ_MAGIC_PROCESS")
        # fixed body is known, but enum value 0xFF must not be treated as a known command
        a=json.loads((ROOT/"protocol-lab"/"gameplay-authority.json").read_text())
        magic=next(p for p in a["packets"] if p["name"]=="WIZ_MAGIC_PROCESS")
        self.assertNotIn(str(d["fields"]["command"]),magic["subopcodes"])

    def test_frame_negative_fixtures_fail_closed(self):
        for name in ("truncated_frame.bin","oversized_declared_length.bin","malformed_header.bin"):
            with self.subTest(name=name):
                with self.assertRaises(ProtocolError):
                    parse_frame((BAD/name).read_bytes())

    def test_integer_overflow_is_rejected_before_serialization(self):
        with self.assertRaises(ProtocolError):
            serialize_fixed("WIZ_MOVE","c2s",{"x10":70000.0,"z10":1.0,"y10":0.0,"speed10":1.0,"move_flag":1})
        with self.assertRaises(ProtocolError):
            serialize_fixed("WIZ_ATTACK","c2s_normal",{"target_id":40000,"interval100":1.0,"distance10":1.0})

    def test_fuzz_frame_parser_never_crashes_outside_protocol_error(self):
        rng=random.Random(1298)
        for _ in range(1000):
            raw=bytes(rng.randrange(256) for _ in range(rng.randrange(0,80)))
            try:
                parse_frame(raw)
            except ProtocolError:
                pass

    def test_authority_has_explicit_unknowns_instead_of_guesses(self):
        a=json.loads((ROOT/"protocol-lab"/"gameplay-authority.json").read_text())
        partial={p["name"] for p in a["packets"] if p["confidence"]=="PARTIAL"}
        self.assertTrue({"WIZ_TRADE_NPC","WIZ_EXCHANGE","WIZ_ITEM_DROP","WIZ_ITEM_GET","WIZ_LEVEL_CHANGE"}.issubset(partial))

if __name__=="__main__":
    unittest.main()
