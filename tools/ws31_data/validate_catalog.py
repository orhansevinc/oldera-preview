#!/usr/bin/env python3
"""WS31 deterministic validator for the OldKOWeb 1298 data catalog."""

from __future__ import annotations
import argparse
import json
from collections import Counter
from pathlib import Path

CATALOG_FILES = (
    "zones.json",
    "items.json",
    "npcs.json",
    "mobs.json",
    "skills.json",
    "classes.json",
    "quests.json",
    "client-resources.json",
    "out-of-scope.json",
)
VALID_PATCHES = {"1298", "UNKNOWN", "MODERN", "OUT_OF_SCOPE"}
VALID_CONFIDENCE = {"HIGH", "MEDIUM", "LOW", "UNKNOWN"}
REQUIRED = {"id", "name", "category", "patch", "source", "confidence", "notes"}

def load_catalog(root: Path) -> dict[str, list[dict]]:
    base = root / "data-catalog"
    result = {}
    for name in CATALOG_FILES:
        path = base / name
        with path.open("r", encoding="utf-8") as fh:
            value = json.load(fh)
        if not isinstance(value, list):
            raise ValueError(f"{name}: root must be an array")
        result[name] = value
    return result

def validate_schema_shape(catalogs: dict[str, list[dict]]) -> list[str]:
    errors: list[str] = []
    for filename, rows in catalogs.items():
        for index, row in enumerate(rows):
            prefix = f"{filename}[{index}]"
            if not isinstance(row, dict):
                errors.append(f"{prefix}: malformed catalog entry (not an object)")
                continue
            missing = REQUIRED - row.keys()
            if missing:
                errors.append(f"{prefix}: malformed catalog entry; missing {sorted(missing)}")
                continue
            if not isinstance(row["id"], (int, str)) or isinstance(row["id"], bool):
                errors.append(f"{prefix}: invalid id")
            if not isinstance(row["name"], str) or not row["name"].strip():
                errors.append(f"{prefix}: invalid name")
            if row["patch"] not in VALID_PATCHES:
                errors.append(f"{prefix}: invalid patch marker {row['patch']!r}")
            if row["confidence"] not in VALID_CONFIDENCE:
                errors.append(f"{prefix}: invalid confidence {row['confidence']!r}")
            sources = row["source"]
            if not isinstance(sources, list) or not sources:
                errors.append(f"{prefix}: missing source marker")
            else:
                for sidx, marker in enumerate(sources):
                    if not isinstance(marker, dict) or not str(marker.get("kind", "")).strip() or not str(marker.get("ref", "")).strip():
                        errors.append(f"{prefix}.source[{sidx}]: missing source marker")
    return errors

def validate_json_schema(root: Path, catalogs: dict[str, list[dict]]) -> list[str]:
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        return ["jsonschema dependency is required for formal JSON Schema validation"]
    with (root / "data-catalog" / "schema" / "catalog-entry.schema.json").open("r", encoding="utf-8") as fh:
        schema = json.load(fh)
    validator = Draft202012Validator(schema)
    errors: list[str] = []
    for filename, rows in catalogs.items():
        for index, row in enumerate(rows):
            for error in validator.iter_errors(row):
                errors.append(f"{filename}[{index}]: JSON schema: {error.message}")
    return errors

def duplicate_errors(catalogs: dict[str, list[dict]]) -> list[str]:
    errors: list[str] = []
    for filename, rows in catalogs.items():
        keys = [(r.get("category"), r.get("id")) for r in rows if isinstance(r, dict)]
        for key, count in Counter(keys).items():
            if count > 1:
                errors.append(f"{filename}: duplicate ID {key[1]!r} in category {key[0]!r}")
    zones = [r.get("id") for r in catalogs["zones.json"]]
    if len(zones) != len(set(zones)):
        errors.append("zones.json: duplicate zone")
    class_ids = [r.get("id") for r in catalogs["classes.json"] if r.get("category") == "CLASS"]
    if len(class_ids) != len(set(class_ids)):
        errors.append("classes.json: duplicate class ID")
    return errors

def cross_reference_errors(catalogs: dict[str, list[dict]]) -> list[str]:
    errors: list[str] = []
    zones = {r["id"] for r in catalogs["zones.json"]}
    items = {r["id"] for r in catalogs["items.json"]}
    resources = {r["id"] for r in catalogs["client-resources.json"]}
    classes = {r["id"] for r in catalogs["classes.json"] if r["category"] == "CLASS"}
    for row in catalogs["npcs.json"]:
        for zid in row.get("zone_ids", []):
            if zid not in zones:
                errors.append(f"NPC {row['id']}: unresolved zone {zid}")
        rid = row.get("resource_id")
        if rid is not None and rid not in resources:
            errors.append(f"NPC {row['id']}: unresolved client resource {rid}")
    for row in catalogs["mobs.json"]:
        for zid in row.get("zone_ids", []):
            if zid not in zones:
                errors.append(f"MONSTER {row['id']}: unresolved zone {zid}")
        rid = row.get("resource_id")
        if rid is not None and rid not in resources:
            errors.append(f"MONSTER {row['id']}: unresolved client resource {rid}")
    for row in catalogs["skills.json"]:
        cid = row.get("class_id")
        if cid is not None and cid not in classes:
            errors.append(f"SKILL {row['id']}: unresolved class {cid}")
        iid = row.get("exhaust_item_id")
        if iid is not None and iid not in items:
            errors.append(f"SKILL {row['id']}: unresolved item {iid}")
    return errors

def summarize(catalogs: dict[str, list[dict]]) -> dict:
    rows = [row for entries in catalogs.values() for row in entries]
    unknown = [r for r in rows if r.get("patch") == "UNKNOWN" or r.get("confidence") == "UNKNOWN"]
    modern = [r for r in rows if r.get("patch") in {"MODERN", "OUT_OF_SCOPE"}]
    missing_source = [r for r in rows if not isinstance(r.get("source"), list) or not r.get("source")]
    collisions = 0
    for entries in catalogs.values():
        keys = [(r.get("category"), r.get("id")) for r in entries if isinstance(r, dict)]
        collisions += sum(count - 1 for count in Counter(keys).values() if count > 1)
    return {"files": {name: len(entries) for name, entries in catalogs.items()}, "total_records": len(rows), "unknown_records": len(unknown), "id_collision_count": collisions, "missing_source_records": len(missing_source), "modern_or_out_of_scope_records": len(modern)}

def validate(root: Path) -> tuple[list[str], dict]:
    catalogs = load_catalog(root)
    errors = validate_schema_shape(catalogs)
    errors.extend(validate_json_schema(root, catalogs))
    errors.extend(duplicate_errors(catalogs))
    errors.extend(cross_reference_errors(catalogs))
    return errors, summarize(catalogs)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    errors, summary = validate(Path(args.root))
    payload = {"ok": not errors, "errors": errors, "summary": summary}
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print(f"WS31 catalog validation: {'PASS' if not errors else 'FAIL'}")
        print(json.dumps(summary, indent=2))
        for error in errors:
            print(f"ERROR: {error}")
    return 0 if not errors else 1

if __name__ == "__main__":
    raise SystemExit(main())
