#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
JSON_PATH = ROOT / "data-catalog/generated/MORADON_PLAYABLE_COMBAT_SLICE.json"
MD_PATH = ROOT / "data-catalog/generated/MORADON_PLAYABLE_COMBAT_SLICE.md"
HASH_PATH = ROOT / "data-catalog/generated/hash-manifest.json"
BROWSER_MANIFEST = ROOT / "real1298/KnightOnLine.js"


def canonical_json_bytes(data: dict) -> bytes:
    return (json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def get_path(root, dotted):
    cur = root
    for part in dotted.split("."):
        cur = cur[part]
    return cur


def nearest_point_distance(start_x, start_z, rect):
    lo_x, hi_x = sorted((rect["left_x"], rect["right_x"]))
    lo_z, hi_z = sorted((rect["bottom_z"], rect["top_z"]))
    x = min(max(start_x, lo_x), hi_x)
    z = min(max(start_z, lo_z), hi_z)
    return x, z, round(math.hypot(start_x - x, start_z - z), 6)


def manifest_has(text: str, token: str) -> bool:
    normalized = text.replace("\\\\", "/").replace("\\", "/").lower()
    return token.replace("\\", "/").lower() in normalized


def validate(data: dict) -> None:
    assert data["schema_version"] == 1
    assert data["authority_id"] == "MORADON_PLAYABLE_COMBAT_SLICE"
    assert data["patch"] == "1298"
    assert data["zone"] == {"id": 21, "name": "Moradon"}

    c = data["test_character"]
    assert c["nation"] == {"id": 1, "name": "Karus"}
    assert c["race"] == {"id": 1, "name": "KARUS_BIG"}
    assert c["class"]["id"] == 101
    assert c["level"] == 3

    w = data["starter_equipment"]["right_hand"]
    raw = w["raw_item_org_us_row"]
    assert len(raw) == 37
    assert raw[0] == w["item_id"] == 120010000
    assert raw[2] == w["name"] == "Short Sword"
    assert raw[6] == w["client_refs"]["model_resource_id"] == 12011000
    assert raw[7] == w["client_refs"]["icon_resource_id"] == 12011000
    assert raw[10] == w["weapon_type"]["id"] == 21
    assert raw[15] == w["damage"] == 4
    assert raw[16] == w["attack_delay"]["raw"] == 114
    assert w["attack_delay"]["milliseconds"] == 1140
    assert raw[17] == w["range"]["raw"] == 10
    assert w["range"]["meters"] == 1.0
    assert raw[19] == w["durability"] == 5000
    assert raw[26] == w["requirements"]["level"] == 1

    normal = data["normal_attack"]
    assert normal["data_ready"] is True
    assert normal["weapon_item_id"] == w["item_id"]
    assert normal["weapon_damage"] == w["damage"]
    assert normal["weapon_attack_delay_ms"] == w["attack_delay"]["milliseconds"]
    assert normal["weapon_range_m"] == w["range"]["meters"]

    skill = data["active_skill"]
    main = skill["raw_main_row"]
    type1 = skill["raw_type1_row"]
    assert len(main) == 30 and len(type1) == 12
    assert main[0] == skill["skill_id"] == 101003
    assert main[1] == skill["name"] == "slash"
    assert main[14] == skill["moral"]["id"] == 7
    assert main[15] == skill["required_level"] == 3
    assert main[16] == skill["class_tree_code"] == 1010
    assert main[17] == skill["resource"]["cost"] == 4
    assert main[18] == skill["hp_cost"] == 0
    assert main[19] == skill["required_weapon_or_item_class"] == 0
    assert main[21] == skill["cast_time"]["raw_tenths"] == 0
    assert main[22] == skill["recast"]["raw_tenths"] == 31
    assert skill["recast"]["client_milliseconds"] == 3100
    assert main[25] == skill["success_rate_percent"] == 100
    assert main[26] == skill["type"]["primary"] == 1
    assert main[28] == skill["range"]["raw_valid_distance"] == 0
    assert type1[0] == skill["skill_id"]
    assert type1[2] == skill["damage_effect"]["hit_rate_modifier_percent"] == 100
    assert type1[3] == skill["damage_effect"]["damage_modifier_percent"] == 120

    mob = data["target_mob"]
    mraw = mob["raw_k_monster_row"]
    assert len(mraw) == 46
    assert mraw[0] == mob["template_id"] == mob["sid"] == 850
    assert mraw[1] == mob["name"] == "Bandicoot"
    assert mraw[2] == mob["resource_pid"] == 800
    assert mraw[13] == mob["level"] == 2
    assert mraw[14] == mob["exp"] == 175
    assert mraw[16] == mob["hp"] == 11
    assert mraw[17] == mob["mp"] == 48
    assert mraw[18] == mob["attack_field_sAtk"] == 0
    assert mraw[19] == mob["ac"] == 10
    assert mraw[22] == mob["damage_field_sDamage"] == 3
    assert mraw[23] == mob["attack_delay_ms"] == 1700
    assert mraw[37] == mob["bulk"] == 85
    assert mraw[38] == mob["attack_range"] == 5
    assert mraw[39] == mob["search_range"] == 3
    assert mraw[40] == mob["tracing_range"] == 40

    spawn = mob["spawn"]
    sraw = spawn["raw_k_npcpos_row"]
    assert len(sraw) == 20
    assert sraw[0] == spawn["zone_id"] == 21
    assert sraw[1] == mob["sid"] == 850
    assert sraw[7] == spawn["rectangle"]["left_x"] == 193
    assert sraw[8] == spawn["rectangle"]["top_z"] == 326
    assert sraw[9] == spawn["rectangle"]["right_x"] == 238
    assert sraw[10] == spawn["rectangle"]["bottom_z"] == 298
    assert sraw[15] == spawn["population"] == 5
    assert sraw[16] == spawn["respawn_seconds"] == 20
    assert sraw[19] is None and spawn["path"] is None

    movement = data["player_start_to_mob"]
    start = movement["start_position"]
    assert start["raw_start_position_row"] == [21, 306, 352, 306, 352, 10, 10, 0, 0, 0, 0]
    x, z, distance = nearest_point_distance(
        start["karus_center"]["x"], start["karus_center"]["z"], spawn["rectangle"]
    )
    assert movement["nearest_verified_rectangle_point_from_center"]["x"] == x
    assert movement["nearest_verified_rectangle_point_from_center"]["z"] == z
    assert movement["nominal_horizontal_straight_line_distance"] == distance
    assert movement["movement_required"] is True

    looks = data["mob_model_assets"]
    assert looks["resource_pid"] == mob["resource_pid"] == looks["npc_looks_id"] == 800
    assert looks["cross_reference_status"] == "match"
    lraw = looks["source_chain"]["raw_npc_looks_row"]
    assert lraw[0] == 800
    assert lraw[2].lower().endswith("mob_bandicoot.n3joint")
    assert lraw[3].lower().endswith("mob_bandicoot.n3anim")

    blocker_by_field = {x["field"]: x["blocker"] for x in data["unknowns"]}
    for entry in data["unknowns"]:
        assert entry["value"] is None
        assert entry["blocker"]
        assert get_path(data, entry["field"]) is None
    assert set(blocker_by_field) == {x["field"] for x in data["unknowns"]}

    assert set(data["consumers"]) == {"ws17", "ws19", "ws25", "ws10"}
    assert all(x["parse_ready"] is True for x in data["consumers"].values())

    manifest_text = BROWSER_MANIFEST.read_text(encoding="utf-8", errors="ignore")
    asset_checks = [
        (data["skill_client_assets"]["icon"]["derived_path"],
         data["skill_client_assets"]["icon"]["browser_package_manifest"]),
        (data["skill_client_assets"]["skill_table"]["browser_package_manifest"]["search_token"],
         data["skill_client_assets"]["skill_table"]["browser_package_manifest"]),
        (data["skill_client_assets"]["type1_table"]["browser_package_manifest"]["search_token"],
         data["skill_client_assets"]["type1_table"]["browser_package_manifest"]),
        (data["mob_model_assets"]["browser_package_manifest"]["search_token"],
         data["mob_model_assets"]["browser_package_manifest"]),
    ]
    for token, record in asset_checks:
        actual = manifest_has(manifest_text, token)
        expected = record["status"] == "present"
        assert actual == expected, f"browser package manifest drift for {token}: actual={actual} declared={record['status']}"
        assert record["present"] is expected
        assert record["missing"] is (not expected)
        assert record["conflict"] is False

    assert data["readiness"]["data_authority_ready"] is True
    assert data["readiness"]["consumer_parse_ready"] is True
    assert data["readiness"]["browser_playable_slice_ready"] is False


def render_md(data: dict, authority_sha: str) -> str:
    def scalar(value):
        return "null" if value is None else value
    c = data["test_character"]
    w = data["starter_equipment"]["right_hand"]
    s = data["active_skill"]
    m = data["target_mob"]
    sp = m["spawn"]
    move = data["player_start_to_mob"]
    model = data["mob_model_assets"]
    lines = [
        "# Moradon Playable Combat Slice",
        "",
        f"- Authority: `{data['authority_id']}`",
        f"- Patch: `{data['patch']}`",
        f"- JSON SHA-256: `{authority_sha}`",
        f"- Data authority ready: `{str(data['readiness']['data_authority_ready']).lower()}`",
        f"- Browser playable slice ready: `{str(data['readiness']['browser_playable_slice_ready']).lower()}`",
        "",
        "## Test character",
        "",
        f"`{c['nation']['name']}` / `{c['race']['name']}` / `{c['class']['name']}` / level `{c['level']}`.",
        "",
        "## Starter equipment and normal attack",
        "",
        f"- Right hand: `{w['item_id']}` {w['name']} ({w['weapon_type']['name']})",
        f"- Weapon damage: `{w['damage']}`",
        f"- Attack delay: `{w['attack_delay']['raw']}` = `{w['attack_delay']['milliseconds']} ms`",
        f"- Range: `{w['range']['raw']}` = `{w['range']['meters']} m`",
        f"- Durability: `{w['durability']}`",
        f"- Normal-attack source data ready: `{str(data['normal_attack']['data_ready']).lower()}`",
        "",
        "## Active hostile skill",
        "",
        f"- Skill: `{s['skill_id']}` {s['name']}",
        f"- Requirement: level `{s['required_level']}`, mode `{s['requirement_mode']}`, skill points `{s['required_skill_points']}`",
        f"- Cost: `{s['resource']['cost']}` resource, HP `{s['hp_cost']}`",
        f"- Moral: `{s['moral']['id']}` `{s['moral']['label']}`",
        f"- Type: `{s['type']['primary']}` / damage modifier `{s['damage_effect']['damage_modifier_percent']}%`",
        f"- Client recast: `{s['recast']['raw_tenths']}` = `{s['recast']['client_milliseconds']} ms`",
        f"- Effective server range: `{scalar(s['range']['effective_meters'])}` (raw valid-distance `{s['range']['raw_valid_distance']}`)",
        f"- Skill icon: `{data['skill_client_assets']['icon']['derived_path']}` -> `{data['skill_client_assets']['icon']['browser_package_manifest']['status']}` in current browser preload manifest",
        "",
        "## Target mob",
        "",
        f"- `{m['sid']}` {m['name']} / PID `{m['resource_pid']}` / level `{m['level']}`",
        f"- HP `{m['hp']}`, AC `{m['ac']}`, sAtk `{m['attack_field_sAtk']}`, sDamage `{m['damage_field_sDamage']}`",
        f"- Attack range `{m['attack_range']}`, attack delay `{m['attack_delay_ms']} ms`",
        f"- Spawn `{sp['row_id']}`: rectangle X `{sp['rectangle']['left_x']}..{sp['rectangle']['right_x']}`, Z `{sp['rectangle']['bottom_z']}..{sp['rectangle']['top_z']}`, population `{sp['population']}`, respawn `{sp['respawn_seconds']} s`",
        "",
        "## Player start to target",
        "",
        f"- START_POSITION center: `({move['start_position']['karus_center']['x']}, {move['start_position']['karus_center']['z']})`, raw range fields X/Z `{move['start_position']['range']['x']}/{move['start_position']['range']['z']}`",
        f"- Movement required: `{str(move['movement_required']).lower()}`",
        f"- Nearest verified rectangle point from nominal center: `({move['nearest_verified_rectangle_point_from_center']['x']}, {move['nearest_verified_rectangle_point_from_center']['z']})`",
        f"- Nominal horizontal straight-line distance: `{move['nominal_horizontal_straight_line_distance']}` world-coordinate units",
        f"- Navigable/path distance: `{scalar(move['navigable_path_distance'])}`",
        "",
        "## Mob model assets",
        "",
        f"- K_MONSTER PID / NPC_Looks ID: `{model['resource_pid']}` / `{model['npc_looks_id']}` -> `{model['cross_reference_status']}`",
        f"- Joint: `{model['source_chain']['joint']}`",
        f"- Animation: `{model['source_chain']['animation']}`",
        f"- Browser preload manifest: `{model['browser_package_manifest']['status']}`",
        "",
        "## Consumer projections",
        "",
    ]
    for name, consumer in data["consumers"].items():
        lines.append(f"- `{name}` `{consumer['branch']}@{consumer['head']}` -> {', '.join(consumer['projection'])}; parse ready `{str(consumer['parse_ready']).lower()}`")
    lines += ["", "## Unknowns / blockers", ""]
    for item in data["unknowns"]:
        lines.append(f"- `{item['field']}` = `null` — `{item['blocker']}`")
    lines += ["", "## Integration blockers", ""]
    for blocker in data["blockers"]:
        lines.append(f"- `{blocker['id']}` ({blocker['severity']}): {blocker['detail']}")
    lines += [
        "",
        "> The JSON file is the single machine-readable authority. This Markdown report is deterministically rendered from it.",
        "",
    ]
    return "\n".join(lines)


def update_hash_manifest(authority_sha: str) -> None:
    manifest = json.loads(HASH_PATH.read_text(encoding="utf-8"))
    manifest.setdefault("files", {})[JSON_PATH.name] = authority_sha
    HASH_PATH.write_bytes(canonical_json_bytes(manifest))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    raw = JSON_PATH.read_bytes()
    data = json.loads(raw)
    if raw != canonical_json_bytes(data):
        raise SystemExit(f"{JSON_PATH} is not canonical deterministic JSON")
    validate(data)
    authority_sha = hashlib.sha256(raw).hexdigest()
    expected_md = render_md(data, authority_sha).encode("utf-8")

    if args.check:
        actual_md = MD_PATH.read_bytes()
        if actual_md != expected_md:
            raise SystemExit(f"{MD_PATH} is stale; run generate_playable_combat_slice.py")
        manifest = json.loads(HASH_PATH.read_text(encoding="utf-8"))
        actual_hash = manifest.get("files", {}).get(JSON_PATH.name)
        if actual_hash != authority_sha:
            raise SystemExit(f"hash-manifest mismatch: expected {authority_sha}, got {actual_hash}")
        print(f"OK {data['authority_id']} {authority_sha}")
        return 0

    MD_PATH.write_bytes(expected_md)
    update_hash_manifest(authority_sha)
    print(f"WROTE {MD_PATH.relative_to(ROOT)}")
    print(f"HASH {authority_sha}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
