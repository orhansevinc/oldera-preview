#!/usr/bin/env python3
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[2]
GOOD=ROOT/"protocol-lab"/"gameplay-fixtures"; BAD=ROOT/"protocol-lab"/"negative-fixtures"
FIX=[
    ('game_move_start_demo.bin', 'aa550a0006e803b00432002d000155aa', '0x06', 'WIZ_MOVE', 'C2S', 'c2s'),
    ('game_rotate_demo.bin', 'aa550300099d0055aa', '0x09', 'WIZ_ROTATE', 'C2S', 'c2s'),
    ('game_attack_normal_demo.bin', 'aa55090008010111276e00190055aa', '0x08', 'WIZ_ATTACK', 'C2S', 'c2s_normal'),
    ('game_attack_success.bin', 'aa550700080101f203112755aa', '0x08', 'WIZ_ATTACK', 'S2C', 's2c_result'),
    ('game_attack_fail.bin', 'aa550700080100f203112755aa', '0x08', 'WIZ_ATTACK', 'S2C', 's2c_result'),
    ('game_attack_dead.bin', 'aa550700080102f203112755aa', '0x08', 'WIZ_ATTACK', 'S2C', 's2c_result'),
    ('game_target_hp_initial.bin', 'aa550e00221127016400000064000000000055aa', '0x22', 'WIZ_TARGET_HP', 'S2C', 's2c_state'),
    ('game_target_hp_update.bin', 'aa550e00221127006400000046000000e2ff55aa', '0x22', 'WIZ_TARGET_HP', 'S2C', 's2c_state'),
    ('game_mob_dead.bin', 'aa55030011112755aa', '0x11', 'WIZ_DEAD', 'S2C', 's2c'),
    ('game_mob_attack_player_success.bin', 'aa5507000801011127f20355aa', '0x08', 'WIZ_ATTACK', 'S2C', 's2c_result'),
    ('game_player_hp_damage.bin', 'aa5505001764004b0055aa', '0x17', 'WIZ_HP_CHANGE', 'S2C', 's2c'),
    ('game_msp_after_slash.bin', 'aa550500186400600055aa', '0x18', 'WIZ_MSP_CHANGE', 'S2C', 's2c'),
    ('game_slash_effect_request.bin', 'aa55160031038b8a0100f203112701000100000000000000000055aa', '0x31', 'WIZ_MAGIC_PROCESS', 'C2S', 'generic_full'),
    ('game_slash_effect_success.bin', 'aa55160031038b8a0100f203112701000100000000000000000055aa', '0x31', 'WIZ_MAGIC_PROCESS', 'S2C', 'generic_full_s2c'),
    ('game_slash_effect_miss.bin', 'aa55160031038b8a0100f20311270100000000000000000098ff55aa', '0x31', 'WIZ_MAGIC_PROCESS', 'S2C', 'generic_full_s2c'),
    ('game_slash_fail.bin', 'aa55160031048b8a0100f203112700000000000000000000000055aa', '0x31', 'WIZ_MAGIC_PROCESS', 'S2C', 'generic_full_s2c'),
    ('game_regen_town_request.bin', 'aa550200120155aa', '0x12', 'WIZ_REGENE', 'C2S', 'c2s_town'),
    ('game_bundle_open_demo.bin', 'aa5505002440e2010055aa', '0x24', 'WIZ_BUNDLE_OPEN_REQ', 'C2S', 'c2s'),
    ('game_npc_event_demo.bin', 'aa55030020112755aa', '0x20', 'WIZ_NPC_EVENT', 'C2S', 'c2s'),
    ('game_magic_casting_demo.bin', 'aa5516003101738e0100f203112700000000000000000000000055aa', '0x31', 'WIZ_MAGIC_PROCESS', 'C2S', 'generic_full'),
    ('game_magic_type4_expired_short.bin', 'aa55030031050755aa', '0x31', 'WIZ_MAGIC_PROCESS', 'S2C', 'type4_expired_short'),
    ('game_dead_demo.bin', 'aa55030011f20355aa', '0x11', 'WIZ_DEAD', 'S2C', 's2c'),
    ('game_exp_change_demo.bin', 'aa5505001a87d6120055aa', '0x1A', 'WIZ_EXP_CHANGE', 'S2C', 's2c'),
]
NEG={
    'truncated_frame.bin':'aa55050006e8',
    'oversized_declared_length.bin':'aa55ffff0655aa',
    'wrong_string_length.bin':'aa550400f30a007855aa',
    'invalid_magic_subopcode.bin':'aa55160031ff738e0100f203112700000000000000000000000055aa',
    'impossible_attack_enum.bin':'aa550700080909f203112755aa',
    'malformed_header.bin':'ab550100fe55aa',
    'unknown_opcode.bin':'aa550200ab0055aa',
}
GOOD.mkdir(parents=True,exist_ok=True); entries=[]
for name,hx,op,sym,direction,variant in FIX:
    data=bytes.fromhex(hx); (GOOD/name).write_bytes(data)
    entries.append({"file":name,"opcode":op,"name":sym,"direction":direction,"authority_variant":variant,"sha256":hashlib.sha256(data).hexdigest(),"frame_hex":hx})
(GOOD/"manifest.json").write_text(json.dumps({"format":"ko1298-gameplay-golden-fixtures-v2","source_commit":"Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5","fixtures":entries,"external_reused_fixtures":[{"path":"protocol-lab/visibility-fixtures/monster_in_spawn.bin","purpose":"MOB_RESPAWN_IN"}]},separators=(",",":"))+"\n",encoding="utf-8")
BAD.mkdir(parents=True,exist_ok=True)
for name,hx in NEG.items(): (BAD/name).write_bytes(bytes.fromhex(hx))
(BAD/"manifest.json").write_text(json.dumps({"format":"ko1298-negative-fixtures-v2","fixtures":[{"file":e["file"],"expect":e["expect"]} for e in [{'file': 'truncated_frame.bin', 'expect': 'FRAME_REJECT'}, {'file': 'oversized_declared_length.bin', 'expect': 'FRAME_REJECT'}, {'file': 'wrong_string_length.bin', 'expect': 'SEMANTIC_REJECT_OR_UNKNOWN'}, {'file': 'invalid_magic_subopcode.bin', 'expect': 'UNKNOWN_VARIANT_OR_UNKNOWN_COMMAND'}, {'file': 'impossible_attack_enum.bin', 'expect': 'ENUM_REJECT_OR_SEMANTIC_UNKNOWN'}, {'file': 'malformed_header.bin', 'expect': 'FRAME_REJECT'}, {'file': 'unknown_opcode.bin', 'expect': 'UNKNOWN_OPCODE'}]]},separators=(",",":"))+"\n",encoding="utf-8")
print(f"generated {len(FIX)} golden and {len(NEG)} negative fixtures")
