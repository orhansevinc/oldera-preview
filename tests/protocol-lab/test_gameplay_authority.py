from __future__ import annotations
import json, random, sys, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"tools"/"ws11_protocol"))
from gameplay import ProtocolError, build_frame, decode_frame, parse_frame, serialize_fixed

GOOD=ROOT/"protocol-lab"/"gameplay-fixtures"
BAD=ROOT/"protocol-lab"/"negative-fixtures"

class GameplayAuthorityTests(unittest.TestCase):
    def test_golden_fixture_manifest_integrity(self):
        manifest=json.loads((GOOD/"manifest.json").read_text())
        self.assertEqual(len(manifest["fixtures"]),23)
        self.assertEqual(manifest["external_reused_fixtures"][0]["purpose"],"MOB_RESPAWN_IN")
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

    def test_attack_exact_1298_request_layout_and_roundtrip(self):
        raw=(GOOD/"game_attack_normal_demo.bin").read_bytes()
        self.assertEqual(len(parse_frame(raw)),9)
        d=decode_frame(raw,"C2S")
        self.assertEqual(d["fields"]["attack_type"],1)
        self.assertEqual(d["fields"]["client_result_hint"],1)
        self.assertEqual(d["fields"]["target_id"],10001)
        p=serialize_fixed("WIZ_ATTACK","c2s_normal",{"target_id":10001,"interval100":1.10,"distance10":2.5})
        self.assertEqual(build_frame(p),raw)

    def test_attack_result_success_fail_death(self):
        vals={}
        for name in ("game_attack_success.bin","game_attack_fail.bin","game_attack_dead.bin"):
            d=decode_frame((GOOD/name).read_bytes(),"S2C")
            vals[name]=d["fields"]["result"]
            self.assertEqual(d["fields"]["attacker_id"],1010)
            self.assertEqual(d["fields"]["target_id"],10001)
        self.assertEqual(vals,{"game_attack_success.bin":1,"game_attack_fail.bin":0,"game_attack_dead.bin":2})

    def test_target_hp_exact_state(self):
        d=decode_frame((GOOD/"game_target_hp_initial.bin").read_bytes(),"S2C")
        self.assertEqual(len(parse_frame((GOOD/"game_target_hp_initial.bin").read_bytes())),14)
        self.assertEqual(d["fields"]["max_hp"],100)
        self.assertEqual(d["fields"]["current_hp"],100)
        self.assertEqual(d["fields"]["hp_delta"],0)
        u=decode_frame((GOOD/"game_target_hp_update.bin").read_bytes(),"S2C")
        self.assertEqual(u["fields"]["current_hp"],70)
        self.assertEqual(u["fields"]["hp_delta"],-30)

    def test_player_hp_and_msp_change(self):
        hp=decode_frame((GOOD/"game_player_hp_damage.bin").read_bytes(),"S2C")
        mp=decode_frame((GOOD/"game_msp_after_slash.bin").read_bytes(),"S2C")
        self.assertEqual((hp["fields"]["max_hp"],hp["fields"]["hp"]),(100,75))
        self.assertEqual((mp["fields"]["max_msp"],mp["fields"]["msp"]),(100,96))

    def test_slash_effect_request_success_miss_and_fail(self):
        req=decode_frame((GOOD/"game_slash_effect_request.bin").read_bytes(),"C2S")
        ok=decode_frame((GOOD/"game_slash_effect_success.bin").read_bytes(),"S2C")
        miss=decode_frame((GOOD/"game_slash_effect_miss.bin").read_bytes(),"S2C")
        fail=decode_frame((GOOD/"game_slash_fail.bin").read_bytes(),"S2C")
        for d in (req,ok,miss,fail):
            self.assertEqual(d["fields"]["skill_id"],101003)
            self.assertEqual(d["fields"]["source_id"],1010)
            self.assertEqual(d["fields"]["target_id"],10001)
        self.assertEqual(req["fields"]["command"],3)
        self.assertEqual([req["fields"][f"data{i}"] for i in range(1,7)],[1,1,0,0,0,0])
        self.assertEqual(ok["fields"]["command"],3)
        self.assertEqual([ok["fields"][f"data{i}"] for i in range(1,7)],[1,1,0,0,0,0])
        self.assertEqual(miss["fields"]["command"],3)
        self.assertEqual(miss["fields"]["data2"],0)
        self.assertEqual(miss["fields"]["data6"],-104)
        self.assertEqual(fail["fields"]["command"],4)

    def test_playable_combat_profile_has_no_blocker(self):
        p=json.loads((ROOT/"protocol-lab"/"PLAYABLE_COMBAT_PROTOCOL_PROFILE.json").read_text())
        self.assertEqual(p["milestone"],"MORADON_PLAYABLE_COMBAT_SLICE")
        self.assertEqual(p["selected_active_skill"]["skill_id"],101003)
        self.assertEqual(p["selected_active_skill"]["name"],"Slash")
        self.assertFalse(p["blockers_for_playable_combat_integration"])
        required=[x for x in p["families"] if x["blocking_for_playable_combat"]]
        self.assertTrue(required)
        self.assertTrue(all(x["status"]=="VERIFIED" for x in required))
        slash=next(x for x in p["families"] if x["family"]=="SLASH_MAGIC_REQUEST")
        self.assertEqual(slash["stages"]["CASTING"],"NOT_EMITTED for Type1 zero-cast Slash")
        self.assertEqual(slash["stages"]["FLYING"],"NOT_EMITTED because iFlyingFX=0")

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

    def test_playable_owner_rows(self):
        m=json.loads((ROOT/"protocol-lab"/"PROTOCOL_OWNER_MATRIX.json").read_text())
        rows={(r["opcode"],r["name"]):r for r in m["matrix"]}
        self.assertEqual(rows[("0x22","WIZ_TARGET_HP")]["status"],"VERIFIED_PLAYABLE_COMBAT")
        self.assertEqual(rows[("0x18","WIZ_MSP_CHANGE")]["status"],"VERIFIED")
        self.assertIn("authenticated actor", " ".join(m["rules"]))

    def test_unknown_opcode_is_reported_not_guessed(self):
        d=decode_frame((BAD/"unknown_opcode.bin").read_bytes(),"C2S")
        self.assertEqual(d["name"],"UNKNOWN")
        self.assertEqual(d["confidence"],"UNKNOWN")

    def test_invalid_magic_subopcode_does_not_claim_command_semantics(self):
        d=decode_frame((BAD/"invalid_magic_subopcode.bin").read_bytes(),"C2S")
        self.assertEqual(d["name"],"WIZ_MAGIC_PROCESS")
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
        target=next(p for p in a["packets"] if p["name"]=="WIZ_TARGET_HP")
        self.assertEqual(target["confidence"],"VERIFIED")

if __name__=="__main__":
    unittest.main()
