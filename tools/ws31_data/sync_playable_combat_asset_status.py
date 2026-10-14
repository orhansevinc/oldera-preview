#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json

from generate_playable_combat_slice import (
    BROWSER_MANIFEST,
    HASH_PATH,
    JSON_PATH,
    MD_PATH,
    canonical_json_bytes,
    manifest_has,
    render_md,
    update_hash_manifest,
)


def apply_status(record: dict, token: str, manifest_text: str) -> bool:
    present = manifest_has(manifest_text, token)
    record["search_token"] = token
    record["status"] = "present" if present else "missing"
    record["present"] = present
    record["missing"] = not present
    record["conflict"] = False
    return present


def main() -> int:
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    manifest_text = BROWSER_MANIFEST.read_text(encoding="utf-8", errors="ignore")

    icon_record = data["skill_client_assets"]["icon"]["browser_package_manifest"]
    icon_present = apply_status(
        icon_record,
        "/data/UI/skillicon_03_1010.dxt",
        manifest_text,
    )

    main_record = data["skill_client_assets"]["skill_table"]["browser_package_manifest"]
    main_present = apply_status(
        main_record,
        "/data/Data/Skill_Magic_Main_us.tbl",
        manifest_text,
    )

    type1_record = data["skill_client_assets"]["type1_table"]["browser_package_manifest"]
    type1_present = apply_status(
        type1_record,
        "/data/Data/skill_magic_1.tbl",
        manifest_text,
    )

    mob_record = data["mob_model_assets"]["browser_package_manifest"]
    mob_present = apply_status(mob_record, "mob_bandicoot", manifest_text)

    stale_asset_blockers = {
        "SKILL_ICON_BROWSER_ASSET_MISSING",
        "SKILL_TABLE_BROWSER_ASSET_MISSING",
        "SKILL_TYPE1_BROWSER_ASSET_MISSING",
        "MOB_MODEL_BROWSER_ASSET_MISSING",
    }
    blockers = [
        blocker for blocker in data["blockers"]
        if blocker["id"] not in stale_asset_blockers
    ]
    if not icon_present:
        blockers.insert(0, {
            "detail": "Derived 101003 icon path is absent from the current real1298 preload manifest.",
            "field": "skill_client_assets.icon.browser_package_manifest.status",
            "id": "SKILL_ICON_BROWSER_ASSET_MISSING",
            "severity": "integration",
        })
    if not main_present:
        blockers.insert(0, {
            "detail": "Skill_Magic_Main_us.tbl is source-backed but absent from the current real1298 preload manifest.",
            "field": "skill_client_assets.skill_table.browser_package_manifest.status",
            "id": "SKILL_TABLE_BROWSER_ASSET_MISSING",
            "severity": "integration",
        })
    if not type1_present:
        blockers.insert(0, {
            "detail": "skill_magic_1.tbl is source-backed but absent from the current real1298 preload manifest.",
            "field": "skill_client_assets.type1_table.browser_package_manifest.status",
            "id": "SKILL_TYPE1_BROWSER_ASSET_MISSING",
            "severity": "integration",
        })
    if not mob_present:
        blockers.insert(0, {
            "detail": "Bandicoot NPC_Looks chain is source-backed and PID-matched, but mob_bandicoot paths are absent from the current real1298 preload manifest.",
            "field": "mob_model_assets.browser_package_manifest.status",
            "id": "MOB_MODEL_BROWSER_ASSET_MISSING",
            "severity": "integration",
        })
    data["blockers"] = blockers

    browser_ready = icon_present and main_present and type1_present and mob_present
    data["readiness"]["browser_playable_slice_ready"] = browser_ready
    if browser_ready:
        data["readiness"]["reason"] = "Source-backed combat fixture and required browser package assets are present."
        data["skill_client_assets"]["overall"] = "present"
    else:
        missing = []
        if not icon_present:
            missing.append("skill icon")
        if not main_present:
            missing.append("Skill_Magic_Main_us.tbl")
        if not type1_present:
            missing.append("skill_magic_1.tbl")
        if not mob_present:
            missing.append("Bandicoot model")
        data["readiness"]["reason"] = (
            "Source-backed combat fixture is authoritative; browser package is missing: "
            + ", ".join(missing)
            + "."
        )
        data["skill_client_assets"]["overall"] = (
            "present" if icon_present and main_present and type1_present
            else "blocked_by_browser_asset_manifest"
        )

    raw = canonical_json_bytes(data)
    JSON_PATH.write_bytes(raw)
    authority_sha = hashlib.sha256(raw).hexdigest()
    MD_PATH.write_text(render_md(data, authority_sha), encoding="utf-8")
    update_hash_manifest(authority_sha)

    print(
        "SYNC",
        f"main={'present' if main_present else 'missing'}",
        f"type1={'present' if type1_present else 'missing'}",
        f"icon={'present' if icon_present else 'missing'}",
        f"mob={'present' if mob_present else 'missing'}",
    )
    print(f"HASH {authority_sha}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
