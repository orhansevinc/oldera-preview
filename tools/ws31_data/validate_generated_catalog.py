#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data-catalog" / "generated"
PARSER = "ws31-generator/2.0.0"
REQUIRED = {
    "zones.json": "zone_id",
    "npc-templates.json": "template_id",
    "npc-spawns.json": "spawn_id",
    "monster-templates.json": "template_id",
    "monster-spawns.json": "spawn_id",
    "items.json": "item_id",
    "skills.json": "skill_id",
    "merchants.json": "merchant_id",
    "item-groups.json": "group_id",
    "drops.json": "drop_table_id",
    "progression.json": "level",
}
GOLDEN_SKILLS = {101003, 102003, 103001, 104001, 104004, 104008}
MORADON_MONSTERS = {750, 751, 752, 754, 755, 850, 851, 852, 853, 854}


def load(name):
    path = OUT / name
    if not path.exists():
        raise SystemExit(f"missing generated file: {name}")
    return json.loads(path.read_text(encoding="utf-8"))


def validate_envelope(name, value, schema, errors):
    for error in Draft202012Validator(schema).iter_errors(value):
        errors.append(f"{name}: schema: {error.message}")


def main():
    errors = []
    generated_schema = json.loads(
        (ROOT / "data-catalog/schema/ws31-generated-catalog.schema.json").read_text(
            encoding="utf-8"
        )
    )
    provenance_schema = json.loads(
        (ROOT / "data-catalog/schema/ws31-provenance.schema.json").read_text(
            encoding="utf-8"
        )
    )
    provenance_validator = Draft202012Validator(provenance_schema)

    for filename, primary_key in REQUIRED.items():
        document = load(filename)
        validate_envelope(filename, document, generated_schema, errors)
        if document.get("parser_version") != PARSER:
            errors.append(f"{filename}: parser_version")
        rows = document.get("rows")
        if not isinstance(rows, list):
            errors.append(f"{filename}: rows")
            continue
        seen = set()
        for index, row in enumerate(rows):
            if primary_key not in row:
                errors.append(f"{filename}[{index}]: missing {primary_key}")
                continue
            key = (
                (row.get("owner_kind"), row[primary_key])
                if filename == "drops.json"
                else row[primary_key]
            )
            if key in seen:
                errors.append(f"{filename}: duplicate primary key {key}")
            seen.add(key)

            verification = row.get("verification")
            if not isinstance(verification, dict) or verification.get("status") != "VERIFIED":
                errors.append(f"{filename}[{index}]: not VERIFIED")
                continue
            provenance = verification.get("provenance")
            if not isinstance(provenance, list) or not provenance:
                errors.append(f"{filename}[{index}]: missing provenance")
                continue
            for marker in provenance:
                for error in provenance_validator.iter_errors(marker):
                    errors.append(
                        f"{filename}[{index}]: provenance schema: {error.message}"
                    )

    summary = load("catalog-summary.json")
    unresolved = load("unresolved.json")
    if summary.get("unknown_count") != unresolved.get("count"):
        errors.append("summary unknown/unresolved count mismatch")
    if summary.get("conflict_count", -1) < 0:
        errors.append("summary missing conflict_count")

    cross = load("cross-reference-report.json")
    if any(cross.get("duplicate_primary_ids", {}).values()):
        errors.append("cross-reference duplicate primary IDs")
    if cross.get("source_runtime_identity_collisions"):
        errors.append("source/runtime identity collision")
    if cross.get("unresolved_count") != unresolved.get("count"):
        errors.append("cross-reference unresolved count mismatch")

    manifest = load("hash-manifest.json")
    for filename, expected in manifest.get("files", {}).items():
        actual = hashlib.sha256((OUT / filename).read_bytes()).hexdigest()
        if actual != expected:
            errors.append(f"hash mismatch: {filename}")

    zones = {x["zone_id"] for x in load("zones.json")["rows"]}
    npcs = {x["template_id"] for x in load("npc-templates.json")["rows"]}
    monsters = {x["template_id"] for x in load("monster-templates.json")["rows"]}
    items = {x["item_id"] for x in load("items.json")["rows"]}
    item_groups = {x["group_id"] for x in load("item-groups.json")["rows"]}

    for filename, templates in (
        ("npc-spawns.json", npcs),
        ("monster-spawns.json", monsters),
    ):
        for row in load(filename)["rows"]:
            if row["template_id"] not in templates:
                errors.append(f"{filename}: dangling template {row['template_id']}")
            if row["zone_id"] not in zones:
                errors.append(f"{filename}: missing zone {row['zone_id']}")
            if row.get("terrain_y") is not None:
                errors.append(f"{filename}: source catalog must not invent terrain Y")
            if row.get("identity_semantics") != "SOURCE_ROW; NOT_RUNTIME_INSTANCE_ID":
                errors.append(f"{filename}: identity semantics missing")

    for merchant in load("merchants.json")["rows"]:
        for item in merchant["items"]:
            if item["item_id"] not in items:
                errors.append(f"merchant missing item {item['item_id']}")
        for npc_id in merchant["npc_template_ids"]:
            if npc_id not in npcs:
                errors.append(f"merchant missing NPC {npc_id}")

    caspy = next(
        (x for x in load("merchants.json")["rows"] if x["merchant_id"] == 203002),
        None,
    )
    if not caspy or 13001 not in caspy["npc_template_ids"]:
        errors.append("Caspy 13001 / group 203002 invariant")

    for group in load("item-groups.json")["rows"]:
        for item_id in group["item_ids"]:
            if item_id not in items and item_id not in group.get("missing_item_ids", []):
                errors.append(
                    f"item group {group['group_id']} has unreported missing item {item_id}"
                )

    for table in load("drops.json")["rows"]:
        for entry in table["entries"]:
            kind = entry["reference_kind"]
            raw = entry["raw_item_or_group"]
            if kind == "ITEM" and raw not in items:
                errors.append(f"drop missing item {raw}")
            if kind == "ITEM_GROUP" and raw not in item_groups:
                errors.append(f"drop missing item group {raw}")
            if kind == "MISSING_REFERENCE":
                # Allowed only if it is explicitly reported as unresolved.
                match = any(
                    row.get("kind") == "drop_reference_missing"
                    and row.get("table_id") == table["drop_table_id"]
                    and row.get("owner_kind") == table["owner_kind"]
                    and row.get("raw_ref") == raw
                    for row in unresolved.get("rows", [])
                )
                if not match:
                    errors.append(
                        f"drop table {table['drop_table_id']} has silent missing ref {raw}"
                    )

    skill_rows = load("skills.json")["rows"]
    skill_ids = {x["skill_id"] for x in skill_rows}
    if not GOLDEN_SKILLS.issubset(skill_ids):
        errors.append(f"missing golden skills {sorted(GOLDEN_SKILLS - skill_ids)}")
    for skill in skill_rows:
        if skill["class_id"] is None and 100 <= skill["skill_id"] // 1000 <= 299:
            if not any(
                row.get("kind") == "skill_invalid_class"
                and row.get("skill_id") == skill["skill_id"]
                for row in unresolved.get("rows", [])
            ):
                errors.append(f"skill invalid class not reported {skill['skill_id']}")

    progression = load("progression.json")["rows"]
    if [x["level"] for x in progression] != list(range(1, 91)):
        errors.append("progression levels must be exact pinned 1..90")
    if any(x.get("source_field") != "Exp" for x in progression):
        errors.append("progression Exp source field lost")

    coverage = summary.get("coverage", {})
    moradon_npc = coverage.get("moradon_npc", {})
    expected_npc = {"templates": 31, "spawn_groups": 39, "declared_population": 43}
    for key, expected in expected_npc.items():
        if moradon_npc.get(key) != expected:
            errors.append(f"Moradon NPC {key}: expected {expected}")

    moradon_monsters = coverage.get("moradon_monsters", {})
    expected_monsters = {
        "templates": 10,
        "source_rows_all_matching_ids": 26,
        "spawn_groups": 20,
        "declared_population": 135,
    }
    for key, expected in expected_monsters.items():
        if moradon_monsters.get(key) != expected:
            errors.append(f"Moradon monsters {key}: expected {expected}")
    if set(moradon_monsters.get("template_ids", [])) != MORADON_MONSTERS:
        errors.append("Moradon monster verified ID slice mismatch")

    item_mapping = summary.get("schema_map", {}).get("ITEM", {})
    evidence = item_mapping.get("intelligence_bonus_evidence", {})
    if evidence != {
        "database_column": "IntelB",
        "server_semantic": "IntelligenceBonus",
        "requirement_column": "ReqIntel",
    }:
        errors.append("ITEM intelligence schema evidence mismatch")
    if item_mapping.get("semantic_to_source", {}).get("intelligence_bonus") != "IntelB":
        errors.append("ITEM intelligence_bonus must map explicitly to IntelB")

    if errors:
        print("\n".join(errors[:300]))
        raise SystemExit(1)
    print("WS31 generated catalog validation: PASS")


if __name__ == "__main__":
    main()
