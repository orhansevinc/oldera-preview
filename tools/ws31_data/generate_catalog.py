#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOCK_PATH = ROOT / "data-catalog" / "source-lock.json"
OUT = ROOT / "data-catalog" / "generated"
PARSER = "ws31-generator/2.0.0"

ITEM_SCHEMA = {
    "item_id": "Num",
    "name": "strName",
    "kind": "Kind",
    "slot": "Slot",
    "race_requirement": "Race",
    "class_requirement": "Class",
    "damage": "Damage",
    "delay": "Delay",
    "range": "Range",
    "weight": "Weight",
    "durability": "Duration",
    "buy_price": "BuyPrice",
    "sell_price": "SellPrice",
    "armor": "Ac",
    "stack_code": "Countable",
    "level_min": "ReqLevel",
    "level_max": "ReqLevelMax",
    "rank": "ReqRank",
    "title": "ReqTitle",
    "req_str": "ReqStr",
    "req_sta": "ReqSta",
    "req_dex": "ReqDex",
    "req_int": "ReqIntel",
    "req_cha": "ReqCha",
    "selling_group": "SellingGroup",
    "item_type": "ItemType",
    "hit_rate": "Hitrate",
    "evasion_rate": "Evasionrate",
    "dagger_ac": "DaggerAc",
    "sword_ac": "SwordAc",
    "mace_ac": "MaceAc",
    "axe_ac": "AxeAc",
    "spear_ac": "SpearAc",
    "bow_ac": "BowAc",
    "fire_damage": "FireDamage",
    "ice_damage": "IceDamage",
    "lightning_damage": "LightningDamage",
    "poison_damage": "PoisonDamage",
    "hp_drain": "HPDrain",
    "mp_damage": "MPDamage",
    "mp_drain": "MPDrain",
    "mirror_damage": "MirrorDamage",
    "strength_bonus": "StrB",
    "stamina_bonus": "StaB",
    "dexterity_bonus": "DexB",
    # Exact pinned OpenKO-db ITEM column. Do not alias to a guessed/default "IntB".
    "intelligence_bonus": "IntelB",
    "charisma_bonus": "ChaB",
    "max_hp_bonus": "MaxHpB",
    "max_mp_bonus": "MaxMpB",
    "fire_resist": "FireR",
    "cold_resist": "ColdR",
    "lightning_resist": "LightningR",
    "magic_resist": "MagicR",
    "poison_resist": "PoisonR",
    "curse_resist": "CurseR",
}

CLIENT_ITEM_INDEX = {
    "item_id": 0,
    "name": 2,
    "model_ref": 6,
    "icon_ref": 7,
}
CLIENT_ITEM_HEADER_EXPECTED = {
    0: "1 - UInt32",
    2: "3 - String",
    6: "7 - UInt32",
    7: "8 - UInt32",
}

GOLDEN_SKILLS = {101003, 102003, 103001, 104001, 104004, 104008}
MORADON_MONSTER_IDS = {750, 751, 752, 754, 755, 850, 851, 852, 853, 854}
EXPECTED_MORADON_NPC = {"templates": 31, "spawn_groups": 39, "declared_population": 43}
EXPECTED_MORADON_MONSTERS = {"templates": 10, "spawn_groups": 20, "declared_population": 135}


def stable(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha256_text(s):
    return sha256_bytes(s.encode("utf-8"))


def pct(n, d):
    return round((100.0 * n / d), 2) if d else 100.0


def fetch(repo, commit, path):
    url = f"https://raw.githubusercontent.com/{repo}/{commit}/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "oldera-ws31-data-catalog/2.0"})
    with urllib.request.urlopen(req, timeout=120) as response:
        body = response.read()
    return body.decode("utf-8", errors="replace"), sha256_bytes(body), url


def parse_atom(token):
    token = token.strip()
    if token.upper() == "NULL":
        return None
    if (token.startswith("N'") or token.startswith("n'")) and token.endswith("'"):
        return token[2:-1].replace("''", "'")
    if token.startswith("'") and token.endswith("'"):
        return token[1:-1].replace("''", "'")
    try:
        return int(token)
    except ValueError:
        try:
            return float(token)
        except ValueError:
            return token


def split_sql_values(s):
    values, current = [], []
    quoted = False
    i = 0
    while i < len(s):
        char = s[i]
        if char == "'":
            current.append(char)
            if quoted and i + 1 < len(s) and s[i + 1] == "'":
                current.append("'")
                i += 2
                continue
            quoted = not quoted
            i += 1
            continue
        if char == "," and not quoted:
            values.append(parse_atom("".join(current)))
            current = []
            i += 1
            continue
        current.append(char)
        i += 1
    values.append(parse_atom("".join(current)))
    return values


def parse_insert(text, source_id, commit, path):
    match = re.search(
        r"INSERT\s+INTO\s+\[?([A-Za-z0-9_]+)\]?\s*\((.*?)\)\s*VALUES",
        text,
        re.I | re.S,
    )
    if not match:
        raise RuntimeError(f"INSERT header not found: {path}")
    table = match.group(1)
    columns = [x.strip().strip("[]") for x in match.group(2).split(",")]
    rows = []
    start_line = text[: match.end()].count("\n") + 1
    for line_no, line in enumerate(text[match.end() :].splitlines(), start=start_line):
        raw = line.strip()
        if not raw.startswith("("):
            continue
        if raw.endswith(",") or raw.endswith(";"):
            raw = raw[:-1]
        if not (raw.startswith("(") and raw.endswith(")")):
            continue
        values = split_sql_values(raw[1:-1])
        if len(values) != len(columns):
            raise RuntimeError(
                f"{path}:{line_no}: {len(values)} values != {len(columns)} cols"
            )
        row = dict(zip(columns, values))
        row["_prov"] = {
            "source_id": source_id,
            "commit": commit,
            "path": path,
            "line": line_no,
            "row_sha256": sha256_text(stable(values).rstrip("\n")),
        }
        rows.append(row)
    if not rows:
        raise RuntimeError(f"no rows parsed from {path}")
    return table, columns, rows


def parse_csv(text, source_id, commit, path):
    parsed = list(csv.reader(io.StringIO(text)))
    if not parsed:
        raise RuntimeError(f"empty CSV: {path}")
    header = parsed[0]
    rows = []
    for line_no, fields in enumerate(parsed[1:], start=2):
        if not fields:
            continue
        rows.append(
            {
                "fields": fields,
                "_prov": {
                    "source_id": source_id,
                    "commit": commit,
                    "path": path,
                    "line": line_no,
                    "row_sha256": sha256_text(stable(fields).rstrip("\n")),
                },
            }
        )
    return header, rows


def provenance(row):
    return [row["_prov"]]


def verified(row, extra=None):
    result = provenance(row)
    if extra:
        result += [x["_prov"] for x in extra]
    return {"status": "VERIFIED", "provenance": result}


def catalog(name, rows, commits):
    return {
        "catalog": name,
        "patch": "1298",
        "parser_version": PARSER,
        "source_commits": commits,
        "rows": rows,
    }


def require_columns(table_name, columns, mapping):
    required = sorted(set(mapping.values()))
    missing = [name for name in required if name not in columns]
    if missing:
        raise RuntimeError(
            f"{table_name}: required source columns missing: {missing}; available={columns}"
        )


def normalize_path(value):
    return str(value).strip().replace("\\", "/")


def make():
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    sources = lock["sources"]
    commits = {key: value["commit"] for key, value in sources.items()}
    source_manifest = {}
    cache = {}

    def get(source_id, key):
        source = sources[source_id]
        path = source["files"][key]
        cache_key = (source_id, path)
        if cache_key not in cache:
            text, digest, url = fetch(source["repo"], source["commit"], path)
            cache[cache_key] = text
            source_manifest[f"{source_id}:{path}"] = {
                "repo": source["repo"],
                "commit": source["commit"],
                "path": path,
                "sha256": digest,
                "url": url,
            }
        return cache[cache_key], path

    def sql(key):
        text, path = get("openko-db", key)
        return parse_insert(
            text,
            "openko-db",
            sources["openko-db"]["commit"],
            path,
        )

    def client_csv(key):
        text, path = get("openko-client-1298", key)
        return parse_csv(
            text,
            "openko-client-1298",
            sources["openko-client-1298"]["commit"],
            path,
        )

    # Cross-check the server-side semantic mapping before touching ITEM rows.
    server_item_mapping, server_item_mapping_path = get("openko-server", "item_mapping")
    if "IntelB" not in server_item_mapping or "IntelligenceBonus" not in server_item_mapping:
        raise RuntimeError(
            f"{server_item_mapping_path}: expected IntelB -> IntelligenceBonus evidence missing"
        )

    zone_table, zone_columns, db_zones = sql("zones")
    zone_header, client_zones = client_csv("zones")
    client_zone_by_id = {}
    for row in client_zones:
        try:
            client_zone_by_id[int(row["fields"][0])] = row
        except (ValueError, IndexError):
            continue

    zones = []
    for row in db_zones:
        zone_id = int(row["ZoneNo"])
        client_row = client_zone_by_id.get(zone_id * 10)
        map_refs = []
        if client_row:
            for raw in client_row["fields"]:
                stripped = str(raw).strip()
                if ("\\" in stripped or "/" in stripped) and "." in stripped:
                    map_refs.append({"raw": raw, "normalized": normalize_path(raw)})
        nation = "KARUS" if zone_id in {1, 11} else "ELMORAD" if zone_id in {2, 12} else None
        zones.append(
            {
                "zone_id": zone_id,
                "name": str(row["bz"]).strip(),
                "server_map": row["strZoneName"],
                "map_refs": map_refs,
                "type_code": row["Type"],
                "room_event": row["RoomEvent"],
                "nation": nation,
                "nation_status": "SOURCE_NAME_BOUND" if nation else "UNKNOWN_OR_SHARED",
                "initial_position": {
                    "x": row["InitX"],
                    "y": row["InitY"],
                    "z": row["InitZ"],
                },
                "client_table_id": zone_id * 10 if client_row else None,
                "verification": verified(row, [client_row] if client_row else None),
            }
        )
    zones.sort(key=lambda x: x["zone_id"])
    zone_ids = {x["zone_id"] for x in zones}

    npc_table, npc_columns, npc_raw = sql("npcs")
    monster_table, monster_columns, monster_raw = sql("monsters")
    stat_keys = [
        "iHpPoint",
        "sMpPoint",
        "sAtk",
        "sAc",
        "sHitRate",
        "sEvadeRate",
        "sDamage",
        "sAttackDelay",
        "bySpeed1",
        "bySpeed2",
        "byAttackRange",
        "bySearchRange",
        "byTracingRange",
        "iMoney",
    ]
    npcs = []
    for row in npc_raw:
        npcs.append(
            {
                "template_id": int(row["sSid"]),
                "name": str(row["strName"]).strip(),
                "model_proto": row["sPid"],
                "size": row["sSize"],
                "type_code": row["byType"],
                "act_type": row["byActType"],
                "level": row["sLevel"],
                "merchant_group_id": row["iSellingGroup"] or None,
                "drop_table_id": row["sItem"] or None,
                "stats": {key: row[key] for key in stat_keys},
                "verification": verified(row),
            }
        )
    monsters = []
    for row in monster_raw:
        monsters.append(
            {
                "template_id": int(row["sSid"]),
                "name": str(row["strName"]).strip(),
                "model_proto": row["sPid"],
                "size": row["sSize"],
                "type_code": row["byType"],
                "act_type": row["byActType"],
                "level": row["sLevel"],
                "xp_reward": row["iExp"],
                "loyalty_reward": row["iLoyalty"],
                "drop_table_id": row["sItem"] or None,
                "stats": {key: row[key] for key in stat_keys},
                "verification": verified(row),
            }
        )
    npcs.sort(key=lambda x: x["template_id"])
    monsters.sort(key=lambda x: x["template_id"])
    npc_ids = {x["template_id"] for x in npcs}
    monster_ids = {x["template_id"] for x in monsters}

    spawn_table, spawn_columns, spawn_raw = sql("spawns")
    npc_spawns = []
    monster_spawns = []
    unresolved = []
    for source_index, row in enumerate(spawn_raw, start=1):
        act_type = int(row["ActType"])
        template_id = int(row["NpcID"])
        zone_id = int(row["ZoneID"])
        kind = "MONSTER" if act_type < 100 else "NPC"
        source_row = {
            "spawn_id": source_index,
            "source_identity": row["_prov"]["row_sha256"],
            "identity_semantics": "SOURCE_ROW; NOT_RUNTIME_INSTANCE_ID",
            "zone_id": zone_id,
            "template_id": template_id,
            "kind": kind,
            "act_type": act_type,
            "rectangle": {
                "left_x": row["LeftX"],
                "top_z": row["TopZ"],
                "right_x": row["RightX"],
                "bottom_z": row["BottomZ"],
            },
            "limits": {
                "min_x": row["LimitMinX"],
                "min_z": row["LimitMinZ"],
                "max_x": row["LimitMaxX"],
                "max_z": row["LimitMaxZ"],
            },
            "count": row["NumNPC"],
            "respawn_seconds": row["RegTime"],
            "direction": row["byDirection"],
            "dot_count": row["DotCnt"],
            "path": row["path"],
            "terrain_y": None,
            "terrain_y_status": "UNKNOWN_SOURCE_HAS_NO_Y_COLUMN",
            "runtime_projection": {
                "status": "DERIVED_AT_RUNTIME",
                "rng_identity": "NOT_CLAIMED_AS_ORIGINAL_1298_RNG",
            },
            "verification": verified(row),
        }
        expected_ids = monster_ids if kind == "MONSTER" else npc_ids
        failures = []
        if zone_id not in zone_ids:
            failures.append("missing_zone")
        if template_id not in expected_ids:
            failures.append("missing_template")
        if failures:
            unresolved.append(
                {
                    "kind": "spawn_cross_reference_conflict",
                    "spawn_kind": kind,
                    "zone_id": zone_id,
                    "template_id": template_id,
                    "failures": failures,
                    "source": row["_prov"],
                }
            )
            continue
        (monster_spawns if kind == "MONSTER" else npc_spawns).append(source_row)

    # Add source-backed spawn reference counts to zone rows.
    spawn_counts_by_zone = Counter(x["zone_id"] for x in npc_spawns + monster_spawns)
    for zone in zones:
        zone["spawn_refs"] = {
            "verified_source_rows": spawn_counts_by_zone.get(zone["zone_id"], 0)
        }

    item_table, item_columns, item_raw = sql("items")
    require_columns(item_table, item_columns, ITEM_SCHEMA)
    item_header, client_items = client_csv("items")
    if len(item_header) < 8:
        raise RuntimeError(f"client item table header too short: {len(item_header)}")
    for index, expected in CLIENT_ITEM_HEADER_EXPECTED.items():
        if item_header[index] != expected:
            raise RuntimeError(
                f"client item header[{index}] expected {expected!r}, got {item_header[index]!r}"
            )
    client_item_by_id = {}
    for row in client_items:
        try:
            client_item_by_id[int(row["fields"][CLIENT_ITEM_INDEX["item_id"]])] = row
        except (ValueError, IndexError):
            continue

    items = []
    client_item_matches = 0
    for row in item_raw:
        mapped = {semantic: row[source] for semantic, source in ITEM_SCHEMA.items()}
        item_id = int(mapped["item_id"])
        client_row = client_item_by_id.get(item_id)
        if client_row:
            client_item_matches += 1
            fields = client_row["fields"]
            if len(fields) <= max(CLIENT_ITEM_INDEX.values()):
                raise RuntimeError(f"client item row too short for {item_id}")
            model_ref = fields[CLIENT_ITEM_INDEX["model_ref"]]
            icon_ref = fields[CLIENT_ITEM_INDEX["icon_ref"]]
        else:
            model_ref = None
            icon_ref = None

        items.append(
            {
                "item_id": item_id,
                "name": str(mapped["name"]).strip(),
                "kind": mapped["kind"],
                "slot": mapped["slot"],
                "race_requirement": mapped["race_requirement"],
                "class_requirement": mapped["class_requirement"],
                "stack_code": mapped["stack_code"],
                "damage": mapped["damage"],
                "delay": mapped["delay"],
                "range": mapped["range"],
                "weight": mapped["weight"],
                "durability": mapped["durability"],
                "buy_price": mapped["buy_price"],
                "sell_price": mapped["sell_price"],
                "armor": mapped["armor"],
                "requirements": {
                    "level_min": mapped["level_min"],
                    "level_max": mapped["level_max"],
                    "rank": mapped["rank"],
                    "title": mapped["title"],
                    "str": mapped["req_str"],
                    "sta": mapped["req_sta"],
                    "dex": mapped["req_dex"],
                    "int": mapped["req_int"],
                    "cha": mapped["req_cha"],
                },
                "bonuses": {
                    "hit_rate": mapped["hit_rate"],
                    "evasion_rate": mapped["evasion_rate"],
                    "dagger_ac": mapped["dagger_ac"],
                    "sword_ac": mapped["sword_ac"],
                    "mace_ac": mapped["mace_ac"],
                    "axe_ac": mapped["axe_ac"],
                    "spear_ac": mapped["spear_ac"],
                    "bow_ac": mapped["bow_ac"],
                    "fire_damage": mapped["fire_damage"],
                    "ice_damage": mapped["ice_damage"],
                    "lightning_damage": mapped["lightning_damage"],
                    "poison_damage": mapped["poison_damage"],
                    "hp_drain": mapped["hp_drain"],
                    "mp_damage": mapped["mp_damage"],
                    "mp_drain": mapped["mp_drain"],
                    "mirror_damage": mapped["mirror_damage"],
                    "str": mapped["strength_bonus"],
                    "sta": mapped["stamina_bonus"],
                    "dex": mapped["dexterity_bonus"],
                    "int": mapped["intelligence_bonus"],
                    "cha": mapped["charisma_bonus"],
                    "max_hp": mapped["max_hp_bonus"],
                    "max_mp": mapped["max_mp_bonus"],
                    "fire_resist": mapped["fire_resist"],
                    "cold_resist": mapped["cold_resist"],
                    "lightning_resist": mapped["lightning_resist"],
                    "magic_resist": mapped["magic_resist"],
                    "poison_resist": mapped["poison_resist"],
                    "curse_resist": mapped["curse_resist"],
                },
                "selling_group": mapped["selling_group"],
                "item_type": mapped["item_type"],
                "model_ref_raw": model_ref,
                "icon_ref_raw": icon_ref,
                "client_1298_match": bool(client_row),
                "verification": verified(row, [client_row] if client_row else None),
            }
        )
    items.sort(key=lambda x: x["item_id"])
    item_by_id = {x["item_id"]: x for x in items}
    item_ids = set(item_by_id)

    # Merchant groups are a source-backed join, not hand-authored inventory lists.
    npcs_by_group = defaultdict(list)
    for npc in npcs:
        if npc["merchant_group_id"]:
            npcs_by_group[int(npc["merchant_group_id"])].append(npc["template_id"])
    items_by_group = defaultdict(list)
    for item in items:
        if item["selling_group"]:
            items_by_group[int(item["selling_group"])].append(item["item_id"])

    merchants = []
    for group_id in sorted(npcs_by_group):
        ids = sorted(items_by_group.get(group_id, []))
        row = {
            "merchant_id": group_id,
            "npc_template_ids": sorted(npcs_by_group[group_id]),
            "items": [
                {
                    "item_id": item_id,
                    "buy_price": item_by_id[item_id]["buy_price"],
                    "sell_price": item_by_id[item_id]["sell_price"],
                }
                for item_id in ids
            ],
            "derivation": "K_NPC.iSellingGroup == ITEM.SellingGroup",
            "verification": {
                "status": "VERIFIED",
                "provenance": [
                    {
                        "source_id": "openko-db",
                        "commit": commits["openko-db"],
                        "path": sources["openko-db"]["files"]["npcs"],
                    },
                    {
                        "source_id": "openko-db",
                        "commit": commits["openko-db"],
                        "path": sources["openko-db"]["files"]["items"],
                    },
                ],
            },
        }
        merchants.append(row)
        if not ids:
            unresolved.append(
                {"kind": "merchant_group_without_items", "merchant_id": group_id}
            )

    caspy = next((x for x in npcs if x["template_id"] == 13001), None)
    if not caspy or caspy["merchant_group_id"] != 203002:
        raise RuntimeError("Caspy 13001 / selling group 203002 source invariant failed")
    caspy_merchant = next((x for x in merchants if x["merchant_id"] == 203002), None)
    if not caspy_merchant:
        raise RuntimeError("Caspy selling group 203002 missing from merchant catalog")

    # MAKE_ITEM_GROUP resolves group tokens without relying on numeric heuristics.
    group_table, group_columns, group_raw = sql("item_groups")
    expected_group_columns = ["iItemGroupNum"] + [f"iItem_{i}" for i in range(1, 31)]
    missing_group_columns = [x for x in expected_group_columns if x not in group_columns]
    if missing_group_columns:
        raise RuntimeError(
            f"{group_table}: missing required columns {missing_group_columns}"
        )
    item_groups = []
    for row in group_raw:
        members = [int(row[f"iItem_{i}"]) for i in range(1, 31) if int(row[f"iItem_{i}"]) != 0]
        missing_members = sorted({item_id for item_id in members if item_id not in item_ids})
        if missing_members:
            unresolved.append(
                {
                    "kind": "item_group_missing_item",
                    "group_id": int(row["iItemGroupNum"]),
                    "missing_item_ids": missing_members,
                    "source": row["_prov"],
                }
            )
        item_groups.append(
            {
                "group_id": int(row["iItemGroupNum"]),
                "item_ids": members,
                "missing_item_ids": missing_members,
                "verification": verified(row),
            }
        )
    item_groups.sort(key=lambda x: x["group_id"])
    group_ids = {x["group_id"] for x in item_groups}

    def build_drop_tables(key, owner_kind):
        _, _, raw_rows = sql(key)
        result = []
        for row in raw_rows:
            entries = []
            for slot in range(1, 6):
                raw_ref = int(row[f"iItem{slot:02d}"])
                chance = int(row[f"sPersent{slot:02d}"])
                if raw_ref == 0 and chance == 0:
                    continue
                if raw_ref in item_ids:
                    ref_kind = "ITEM"
                elif raw_ref in group_ids:
                    ref_kind = "ITEM_GROUP"
                elif raw_ref < 100:
                    ref_kind = "SPECIAL_PRODUCTION_CODE"
                else:
                    ref_kind = "MISSING_REFERENCE"
                    unresolved.append(
                        {
                            "kind": "drop_reference_missing",
                            "table_id": int(row["sIndex"]),
                            "owner_kind": owner_kind,
                            "slot": slot,
                            "raw_ref": raw_ref,
                            "source": row["_prov"],
                        }
                    )
                entries.append(
                    {
                        "slot": slot,
                        "raw_item_or_group": raw_ref,
                        "raw_probability": chance,
                        "probability_scale": 10000,
                        "reference_kind": ref_kind,
                    }
                )
            result.append(
                {
                    "drop_table_id": int(row["sIndex"]),
                    "owner_kind": owner_kind,
                    "entries": entries,
                    "verification": verified(row),
                }
            )
        return sorted(result, key=lambda x: x["drop_table_id"])

    monster_drops = build_drop_tables("monster_drops", "MONSTER")
    npc_drops = build_drop_tables("npc_drops", "NPC")
    monster_drop_ids = {x["drop_table_id"] for x in monster_drops}
    npc_drop_ids = {x["drop_table_id"] for x in npc_drops}

    monster_drop_refs = [x for x in monsters if x["drop_table_id"]]
    npc_drop_refs = [x for x in npcs if x["drop_table_id"]]
    resolved_monster_drop_refs = 0
    for monster in monster_drop_refs:
        if monster["drop_table_id"] in monster_drop_ids:
            resolved_monster_drop_refs += 1
        else:
            unresolved.append(
                {
                    "kind": "monster_drop_table_missing",
                    "template_id": monster["template_id"],
                    "drop_table_id": monster["drop_table_id"],
                }
            )
    resolved_npc_drop_refs = 0
    for npc in npc_drop_refs:
        if npc["drop_table_id"] in npc_drop_ids:
            resolved_npc_drop_refs += 1
        else:
            unresolved.append(
                {
                    "kind": "npc_drop_table_missing",
                    "template_id": npc["template_id"],
                    "drop_table_id": npc["drop_table_id"],
                }
            )

    # MAGIC main + the Type1..4 tables consumed by WS19.
    _, _, magic_raw = sql("skills")
    skill_header, client_skills = client_csv("skills")
    client_skill_by_id = {}
    for row in client_skills:
        try:
            client_skill_by_id[int(row["fields"][0])] = row
        except (ValueError, IndexError):
            continue

    effects = defaultdict(list)
    skill_type_counts = {}
    for type_no in range(1, 5):
        _, _, effect_rows = sql(f"skill_type{type_no}")
        skill_type_counts[f"type{type_no}"] = len(effect_rows)
        for row in effect_rows:
            keys = [key for key in row if not key.startswith("_")]
            if not keys:
                continue
            try:
                skill_id = int(row[keys[0]])
            except (TypeError, ValueError):
                continue
            effects[skill_id].append(
                {
                    "type": type_no,
                    "raw": {key: row[key] for key in keys},
                    "provenance": row["_prov"],
                }
            )

    valid_classes = {
        101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112,
        201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212,
    }
    skills = []
    invalid_class_skills = []
    for row in magic_raw:
        skill_id = int(row["MagicNum"])
        derived = skill_id // 1000
        class_id = derived if derived in valid_classes else None
        if 100 <= derived <= 299 and class_id is None:
            invalid_class_skills.append(skill_id)
            unresolved.append(
                {
                    "kind": "skill_invalid_class",
                    "skill_id": skill_id,
                    "derived_class_id": derived,
                    "source": row["_prov"],
                }
            )
        client_row = client_skill_by_id.get(skill_id)
        skills.append(
            {
                "skill_id": skill_id,
                "name": str(row["EnName"]).strip(),
                "class_id": class_id,
                "required_level": row["SkillLevel"],
                "prerequisite_skill": row["Skill"],
                "mp_cost": row["Msp"],
                "hp_cost": row["HP"],
                "item_group": row["ItemGroup"],
                "use_item": row["UseItem"] or None,
                "type1": row["Type1"],
                "type2": row["Type2"],
                "range": row["Range"],
                "moral": row["Moral"],
                "cast_time": row["CastTime"],
                "recast_time": row["ReCastTime"],
                "success_rate": row["SuccessRate"],
                "effects": sorted(effects.get(skill_id, []), key=lambda x: x["type"]),
                "client_1298_match": bool(client_row),
                "verification": verified(row, [client_row] if client_row else None),
            }
        )
    skills.sort(key=lambda x: x["skill_id"])
    skill_ids = {x["skill_id"] for x in skills}
    missing_golden = sorted(GOLDEN_SKILLS - skill_ids)
    if missing_golden:
        raise RuntimeError(f"golden WS19 skills missing: {missing_golden}")

    # LEVEL_UP(level, Exp): expose Exp as required_exp with exact source-field provenance.
    progression_table, progression_columns, progression_raw = sql("progression")
    if "level" not in progression_columns or "Exp" not in progression_columns:
        raise RuntimeError(
            f"{progression_table}: expected level/Exp columns; got {progression_columns}"
        )
    progression = [
        {
            "level": int(row["level"]),
            "required_exp": int(row["Exp"]),
            "source_field": "Exp",
            "verification": verified(row),
        }
        for row in progression_raw
    ]
    progression.sort(key=lambda x: x["level"])
    if [x["level"] for x in progression] != list(range(1, 91)):
        raise RuntimeError("LEVEL_UP expected pinned contiguous levels 1..90")

    # Cross-reference/path audits.
    path_variants = defaultdict(set)
    trailing_paths = []
    for zone in zones:
        for path in zone["map_refs"]:
            raw = path["raw"]
            norm = path["normalized"]
            path_variants[norm.lower()].add(norm)
            if raw != str(raw).strip():
                trailing_paths.append({"zone_id": zone["zone_id"], "raw": raw})
    path_case_issues = [
        {"normalized_lower": key, "variants": sorted(values)}
        for key, values in sorted(path_variants.items())
        if len(values) > 1
    ]
    for issue in path_case_issues:
        unresolved.append({"kind": "path_case_inconsistency", **issue})
    for issue in trailing_paths:
        unresolved.append({"kind": "path_whitespace", **issue})

    # Required Moradon slices are derived from source data, never copied from runtime projections.
    moradon_npc_spawns = [x for x in npc_spawns if x["zone_id"] == 21]
    moradon_npc_template_ids = sorted({x["template_id"] for x in moradon_npc_spawns})
    moradon_npc = {
        "templates": len(moradon_npc_template_ids),
        "spawn_groups": len(moradon_npc_spawns),
        "declared_population": sum(int(x["count"]) for x in moradon_npc_spawns),
        "path_defined_groups": sum(1 for x in moradon_npc_spawns if x["path"]),
        "terrain_y_unknown_groups": len(moradon_npc_spawns),
        "template_ids": moradon_npc_template_ids,
    }
    for key, expected in EXPECTED_MORADON_NPC.items():
        if moradon_npc[key] != expected:
            raise RuntimeError(
                f"Moradon NPC source slice mismatch for {key}: "
                f"expected {expected}, got {moradon_npc[key]}"
            )

    moradon_monster_spawns = [
        x
        for x in monster_spawns
        if x["zone_id"] == 21 and x["template_id"] in MORADON_MONSTER_IDS
    ]
    moradon_monsters_present = sorted(
        {x["template_id"] for x in monsters if x["template_id"] in MORADON_MONSTER_IDS}
    )
    moradon_monsters = {
        "templates": len(moradon_monsters_present),
        "spawn_groups": len(moradon_monster_spawns),
        "declared_population": sum(int(x["count"]) for x in moradon_monster_spawns),
        "template_ids": moradon_monsters_present,
        "source_position_semantics": "K_NPCPOS rectangle/count",
        "runtime_projection_semantics": (
            "deterministic projection may be used by WS25; it is not original 1298 RNG identity"
        ),
        "terrain_y_status": "UNKNOWN_SOURCE_HAS_NO_Y_COLUMN",
    }
    for key, expected in EXPECTED_MORADON_MONSTERS.items():
        if moradon_monsters[key] != expected:
            raise RuntimeError(
                f"Moradon monster source slice mismatch for {key}: "
                f"expected {expected}, got {moradon_monsters[key]}"
            )

    outputs = {
        "zones.json": catalog("zones", zones, commits),
        "npc-templates.json": catalog("npc-templates", npcs, commits),
        "npc-spawns.json": catalog("npc-spawns", npc_spawns, commits),
        "monster-templates.json": catalog("monster-templates", monsters, commits),
        "monster-spawns.json": catalog("monster-spawns", monster_spawns, commits),
        "items.json": catalog("items", items, commits),
        "skills.json": catalog("skills", skills, commits),
        "merchants.json": catalog("merchants", merchants, commits),
        "item-groups.json": catalog("item-groups", item_groups, commits),
        "drops.json": catalog("drops", monster_drops + npc_drops, commits),
        "progression.json": catalog("progression", progression, commits),
    }

    duplicate_primary_ids = {}
    for name, rows, key in [
        ("zones", zones, "zone_id"),
        ("npcs", npcs, "template_id"),
        ("monsters", monsters, "template_id"),
        ("items", items, "item_id"),
        ("skills", skills, "skill_id"),
        ("merchants", merchants, "merchant_id"),
        ("item_groups", item_groups, "group_id"),
        ("progression", progression, "level"),
    ]:
        seen, duplicates = set(), []
        for row in rows:
            value = row[key]
            if value in seen:
                duplicates.append(value)
            seen.add(value)
        duplicate_primary_ids[name] = sorted(set(duplicates))
        for value in duplicates:
            unresolved.append(
                {"kind": "duplicate_primary_id", "catalog": name, "id": value}
            )

    source_coverage = {
        "zones": {
            "verified": len(zones),
            "source_rows": len(db_zones),
            "percent": pct(len(zones), len(db_zones)),
        },
        "npc_templates": {
            "verified": len(npcs),
            "source_rows": len(npc_raw),
            "percent": pct(len(npcs), len(npc_raw)),
        },
        "monster_templates": {
            "verified": len(monsters),
            "source_rows": len(monster_raw),
            "percent": pct(len(monsters), len(monster_raw)),
        },
        "spawns": {
            "verified": len(npc_spawns) + len(monster_spawns),
            "source_rows": len(spawn_raw),
            "percent": pct(len(npc_spawns) + len(monster_spawns), len(spawn_raw)),
        },
        "items_db": {
            "verified": len(items),
            "source_rows": len(item_raw),
            "percent": pct(len(items), len(item_raw)),
        },
        "items_client_crossmatch": {
            "verified": client_item_matches,
            "source_rows": len(items),
            "percent": pct(client_item_matches, len(items)),
        },
        "skills_main": {
            "verified": len(skills),
            "source_rows": len(magic_raw),
            "percent": pct(len(skills), len(magic_raw)),
        },
        "progression": {
            "verified": len(progression),
            "source_rows": len(progression_raw),
            "percent": pct(len(progression), len(progression_raw)),
        },
    }

    unresolved.sort(key=lambda x: stable(x))
    conflict_kinds = {
        "spawn_cross_reference_conflict",
        "duplicate_primary_id",
        "item_group_missing_item",
        "drop_reference_missing",
        "monster_drop_table_missing",
        "npc_drop_table_missing",
        "skill_invalid_class",
        "path_case_inconsistency",
        "path_whitespace",
        "merchant_group_without_items",
    }
    conflicts = [x for x in unresolved if x["kind"] in conflict_kinds]

    summary = {
        "parser_version": PARSER,
        "verified_counts": {
            "zones": len(zones),
            "npc_templates": len(npcs),
            "npc_spawns": len(npc_spawns),
            "monster_templates": len(monsters),
            "monster_spawns": len(monster_spawns),
            "items": len(items),
            "skills": len(skills),
            "merchants": len(merchants),
            "item_groups": len(item_groups),
            "drops": len(monster_drops) + len(npc_drops),
            "progression_rows": len(progression),
        },
        "unknown_count": len(unresolved),
        "conflict_count": len(conflicts),
        "source_coverage": source_coverage,
        "coverage": {
            "moradon_npc": moradon_npc,
            "moradon_monsters": moradon_monsters,
            "skills_type_tables": skill_type_counts,
            "golden_skills": sorted(GOLDEN_SKILLS),
            "caspy": {
                "template_id": 13001,
                "selling_group": 203002,
                "merchant_item_count": len(caspy_merchant["items"]),
                "verified": True,
            },
            "drops": {
                "monster_template_refs": len(monster_drop_refs),
                "monster_template_refs_resolved": resolved_monster_drop_refs,
                "monster_template_ref_percent": pct(
                    resolved_monster_drop_refs, len(monster_drop_refs)
                ),
                "npc_template_refs": len(npc_drop_refs),
                "npc_template_refs_resolved": resolved_npc_drop_refs,
                "npc_template_ref_percent": pct(
                    resolved_npc_drop_refs, len(npc_drop_refs)
                ),
                "item_group_count": len(item_groups),
                "special_production_codes_remain_adapter_gated": True,
            },
            "progression": {
                "source_table": "LEVEL_UP",
                "source_exp_field": "Exp",
                "level_min": progression[0]["level"],
                "level_max": progression[-1]["level"],
            },
        },
        "schema_map": {
            "ITEM": {
                "required_source_columns": sorted(set(ITEM_SCHEMA.values())),
                "semantic_to_source": ITEM_SCHEMA,
                "intelligence_bonus_evidence": {
                    "database_column": "IntelB",
                    "server_semantic": "IntelligenceBonus",
                    "requirement_column": "ReqIntel",
                },
            },
            "client_item_table": {
                "header": item_header,
                "semantic_index": CLIENT_ITEM_INDEX,
            },
        },
        "source_commits": commits,
    }

    cross = {
        "duplicate_primary_ids": duplicate_primary_ids,
        "unresolved_count": len(unresolved),
        "conflict_count": len(conflicts),
        "path_case_inconsistencies": path_case_issues,
        "source_runtime_identity_collisions": [],
        "rules": {
            "spawn_kind": "ActType < 100 => K_MONSTER; ActType >= 100 => K_NPC",
            "merchant": "K_NPC.iSellingGroup == ITEM.SellingGroup",
            "monster_drop": "K_MONSTER.sItem -> K_MONSTER_ITEM.sIndex",
            "npc_drop": "K_NPC.sItem -> K_NPC_ITEM.sIndex",
            "drop_group": "K_*_ITEM token -> MAKE_ITEM_GROUP only when exact group ID exists",
            "runtime_identity": (
                "spawn_id/source_identity are catalog source identities; runtime entity IDs are not generated here"
            ),
        },
    }

    drop_coverage = {
        "parser_version": PARSER,
        "source_commits": commits,
        "monster": summary["coverage"]["drops"],
        "reference_kinds": dict(
            sorted(
                Counter(
                    entry["reference_kind"]
                    for table in monster_drops + npc_drops
                    for entry in table["entries"]
                ).items()
            )
        ),
        "ws26_adapter_notes": [
            "ITEM and ITEM_GROUP references are source-resolved.",
            "SPECIAL_PRODUCTION_CODE remains fail-closed adapter territory.",
            "MISSING_REFERENCE rows are reported in unresolved.json and are not silently coerced.",
        ],
    }

    OUT.mkdir(parents=True, exist_ok=True)
    for filename, obj in outputs.items():
        (OUT / filename).write_text(stable(obj), encoding="utf-8")
    (OUT / "source-manifest.json").write_text(
        stable({"parser_version": PARSER, "sources": source_manifest}),
        encoding="utf-8",
    )
    (OUT / "catalog-summary.json").write_text(stable(summary), encoding="utf-8")
    (OUT / "cross-reference-report.json").write_text(stable(cross), encoding="utf-8")
    (OUT / "drop-coverage.json").write_text(stable(drop_coverage), encoding="utf-8")
    (OUT / "unresolved.json").write_text(
        stable({"count": len(unresolved), "rows": unresolved}),
        encoding="utf-8",
    )

    file_hashes = {}
    for path in sorted(OUT.glob("*.json")):
        if path.name == "hash-manifest.json":
            continue
        file_hashes[path.name] = sha256_bytes(path.read_bytes())
    (OUT / "hash-manifest.json").write_text(
        stable({"parser_version": PARSER, "files": file_hashes}),
        encoding="utf-8",
    )

    counts = summary["verified_counts"]
    (ROOT / "workstreams/ws31/STATUS.md").write_text(
        f"""# WS31 STATUS

DURUM: DATA AUTHORITY GENERATED — pinned 1298 sources, deterministic output, explicit UNKNOWN/conflict reporting.

## VERIFIED COUNTS
- zones: {counts['zones']}
- NPC templates / spawn rows: {counts['npc_templates']} / {counts['npc_spawns']}
- monster templates / spawn rows: {counts['monster_templates']} / {counts['monster_spawns']}
- items: {counts['items']}
- skills: {counts['skills']}
- merchants: {counts['merchants']}
- item groups: {counts['item_groups']}
- drop tables: {counts['drops']}
- progression rows: {counts['progression_rows']}
- unknown/unresolved: {summary['unknown_count']}
- conflicts: {summary['conflict_count']}

## MORADON SOURCE SLICES
- NPC: {moradon_npc['templates']} templates, {moradon_npc['spawn_groups']} K_NPCPOS groups, declared population {moradon_npc['declared_population']}.
- NPC terrain Y: source K_NPCPOS has no Y column; {moradon_npc['terrain_y_unknown_groups']} groups remain runtime height-resolver dependent.
- Monsters: {moradon_monsters['templates']} templates, {moradon_monsters['spawn_groups']} K_NPCPOS rows, declared population {moradon_monsters['declared_population']}.
- Monster runtime deterministic rectangle expansion is explicitly DERIVED and is not claimed to reproduce original 1298 RNG positions.

## ITEM SCHEMA EVIDENCE
- Required intelligence stat: `ReqIntel`.
- Intelligence bonus DB column: `IntelB`.
- Server semantic: `IntelligenceBonus`.
- Missing required item fields fail generation; no missing field is coerced to zero.

## DOWNSTREAM SURFACES
- WS17: complete source-backed ITEM parse including requirements, bonuses, durability, price, weight and client model/icon refs when matched.
- WS19: MAGIC main + Type1..4 source tables and six golden skills.
- WS22: source-derived merchant groups; Caspy 13001 -> group 203002 asserted.
- WS25: Moradon source rectangles/counts separated from runtime deterministic projections.
- WS26: K_MONSTER/K_NPC drop tables + MAKE_ITEM_GROUP + item cross-reference coverage.
- WS27: LEVEL_UP levels 1..90 from source `Exp`; no synthetic XP curve.

Machine-readable authority: `data-catalog/generated/`.
`hash-manifest.json` is the committed byte-stability authority.
`catalog-summary.json`, `cross-reference-report.json`, `drop-coverage.json`, and `unresolved.json` retain machine-readable coverage/conflict state.
""",
        encoding="utf-8",
    )
    (ROOT / "workstreams/ws31/DATA_PROVENANCE.md").write_text(
        f"""# WS31 DATA PROVENANCE

Parser: `{PARSER}`

Pinned sources:
- Open-KO/KnightOnline `{commits['openko-server']}` — loader/struct semantic corroboration.
- Open-KO/ko-client-assets `{commits['openko-client-1298']}` — 1298 client tables.
- Open-KO/OpenKO-db `{commits['openko-db']}` — server schema and seed rows.

## ITEM FIELD NORMALIZATION

The pinned `ITEM` SQL header contains `ReqIntel` for the requirement and `IntelB` for the intelligence bonus.
The pinned server evidence maps `IntelB` to `IntelligenceBonus`.
The generator therefore uses an explicit semantic-to-source schema map (`intelligence_bonus -> IntelB`); it does not accept `IntB`, guess aliases, or default missing required fields to zero.

The client item CSV uses numbered/type headers rather than server semantic names. Its required index/type positions are validated before resource/model references are read.

## IDENTITY / RUNTIME BOUNDARY

K_NPCPOS rectangles, counts, paths and source row hashes are source authority.
Terrain Y is not in K_NPCPOS and remains runtime-resolver dependent.
WS25 deterministic rectangle expansion is a runtime projection and is not described as original 1298 RNG positions.
Runtime entity IDs are outside this catalog; source identity and runtime identity are not conflated.

Unknown or contradictory references remain in `data-catalog/generated/unresolved.json` and are never promoted to VERIFIED by inference.
""",
        encoding="utf-8",
    )
    (ROOT / "workstreams/ws31/CATALOG_SUMMARY.md").write_text(
        f"""# WS31 CATALOG SUMMARY

Machine-readable authority: `data-catalog/generated/`.

Counts: zones {counts['zones']}; NPC templates/spawns {counts['npc_templates']}/{counts['npc_spawns']}; monster templates/spawns {counts['monster_templates']}/{counts['monster_spawns']}; items {counts['items']}; skills {counts['skills']}; merchants {counts['merchants']}; item groups {counts['item_groups']}; drop tables {counts['drops']}; progression {counts['progression_rows']}.

Moradon NPC source slice: {moradon_npc['templates']} templates / {moradon_npc['spawn_groups']} groups / population {moradon_npc['declared_population']}.
Moradon monster source slice: {moradon_monsters['templates']} templates / {moradon_monsters['spawn_groups']} rows / population {moradon_monsters['declared_population']}.

Unknown/unresolved: {summary['unknown_count']}. Conflicts: {summary['conflict_count']}.
Category coverage percentages are in `catalog-summary.json`; WS26-specific drop coverage is in `drop-coverage.json`.
""",
        encoding="utf-8",
    )

    by_kind = Counter(row["kind"] for row in unresolved)
    lines = "\n".join(f"- {kind}: {count}" for kind, count in sorted(by_kind.items()))
    if not lines:
        lines = "- none"
    (ROOT / "workstreams/ws31/UNRESOLVED.md").write_text(
        f"""# WS31 UNRESOLVED REPORT

Machine-readable unresolved rows: `data-catalog/generated/unresolved.json`.

Current unresolved/reference issue count: **{len(unresolved)}**.
Current conflict count: **{len(conflicts)}**.

By kind:
{lines}

Expected structural UNKNOWNs such as K_NPCPOS terrain Y are reported in coverage metadata and are not fabricated.
Missing/ambiguous cross-references are retained here and are never silently converted to zero/default production data.
""",
        encoding="utf-8",
    )

    print(stable(summary), end="")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    before = {}
    if args.check and OUT.exists():
        before = {path.name: path.read_bytes() for path in OUT.glob("*.json")}
    make()
    if args.check and before:
        after = {path.name: path.read_bytes() for path in OUT.glob("*.json")}
        if before != after:
            raise SystemExit("generated catalog differs from committed output")
