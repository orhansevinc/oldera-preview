#!/usr/bin/env python3
"""Run a WS50 candidate against only immutable SHAs in its manifest.

Provider branches are never resolved here. C4 additionally runs the pinned
Moradon SMD through the exact WS14/WS16/WS25 provider surfaces and records the
first real composition blocker instead of inventing an adapter.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from provider_sets import load_set, validate_set

SURFACES = {
    "WS03": ["services/ko1298-session", "tests/ko1298-session"],
    "WS14": ["services/ko1298-world", "tests/ko1298-world"],
    "WS15": ["services/ko1298-movement", "tests/ko1298-movement"],
    "WS16": ["services/ko1298-npc", "tests/ko1298-npc", "world-data/npc"],
    "WS25": ["services/ko1298-mobs", "tests/ko1298-mobs", "world-data/mobs"],
    "WS31": ["data-catalog/generated/catalog-summary.json"],
    "WS11": ["protocol-lab/PROTOCOL_OWNER_MATRIX.json"],
    "WS45": ["services/session-ownership", "tests/session-ownership"],
}

C4_EXTRA_SURFACES = {
    "WS11": [
        "protocol-lab/VISIBILITY_PROTOCOL_PROFILE.json",
        "protocol-lab/visibility-fixtures",
        "tools/ws11_protocol",
        "tests/protocol-lab",
    ],
    "WS31": ["data-catalog/npcs.json"],
}


def run(cmd: list[str], *, cwd: Path, capture: bool = False, env: dict | None = None) -> str:
    print("+", " ".join(cmd), flush=True)
    proc = subprocess.run(
        cmd,
        cwd=cwd,
        text=True,
        check=True,
        env=env,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    return (proc.stdout or "").strip()


def provider_map(document: dict) -> dict[str, dict]:
    return {provider["ws"]: provider for provider in document["providers"]}


def checkout_surfaces(tree: Path, document: dict) -> None:
    providers = provider_map(document)
    surfaces = {ws: list(paths) for ws, paths in SURFACES.items()}
    if document["set_id"] == "WS50-C4":
        for ws, paths in C4_EXTRA_SURFACES.items():
            surfaces.setdefault(ws, []).extend(paths)
    for ws, paths in surfaces.items():
        provider = providers.get(ws)
        if not provider:
            continue
        for path in paths:
            run(["git", "checkout", provider["exact_sha"], "--", path], cwd=tree)


def c4_env(tree: Path, document: dict) -> dict:
    env = os.environ.copy()
    if document["set_id"] != "WS50-C4":
        return env

    smd = env.get("WS50_MORADON_SMD")
    if not smd or not Path(smd).is_file():
        raise RuntimeError("WS50-C4 requires WS50_MORADON_SMD exact pinned asset input")

    providers = provider_map(document)
    env.update({
        "WS14_MORADON_SMD": smd,
        "WS14_WS16_NPC_DATA": str(tree / "world-data/npc/moradon.json"),
        "WS14_WS25_MOB_DATA": str(tree / "world-data/mobs/verified/moradon-zone21.verified.json"),
        "WS16_WS14_MODULE": str(tree / "services/ko1298-world"),
        "WS16_MORADON_SMD": smd,
        "WS16_WS31_NPC_CATALOG": str(tree / "data-catalog/npcs.json"),
        "WS25_WS14_WORLD_MODULE": str(tree / "services/ko1298-world"),
        "WS25_MORADON_SMD": smd,
        "WS25_WS31_SUMMARY": str(tree / "data-catalog/generated/catalog-summary.json"),
        "WS25_WS14_PROVIDER_SHA": providers["WS14"]["exact_sha"],
        "WS25_WS31_PROVIDER_SHA": providers["WS31"]["exact_sha"],
    })
    return env


def node_test_dir(tree: Path, relative: str, *, env: dict) -> int:
    root = tree / relative
    files = sorted(
        str(path.relative_to(tree))
        for path in root.iterdir()
        if path.is_file() and (path.name.endswith(".test.js") or path.name.endswith(".test.cjs"))
    )
    if not files:
        raise RuntimeError(f"no Node tests found in {relative}")
    run(["node", "--test", *files], cwd=tree, env=env)
    return len(files)


def protocol_checks(tree: Path, document: dict, *, env: dict) -> dict:
    matrix_path = tree / "protocol-lab/PROTOCOL_OWNER_MATRIX.json"
    matrix = json.loads(matrix_path.read_text(encoding="utf-8"))
    rows = {row["opcode"]: row for row in matrix["matrix"]}
    npc_detail = rows.get("0x1D")
    npc_region = rows.get("0x1C")
    if not npc_detail or npc_detail.get("status") != "COLLISION_RESOLVED":
        raise RuntimeError("WS11 exact set no longer proves WIZ_REQ_NPCIN 0x1D collision resolution")

    if document["set_id"] != "WS50-C4":
        if not npc_region or npc_region.get("status") != "PARTIAL_BODY":
            raise RuntimeError("expected legacy NPC_REGION_BODY_AUTHORITY blocker is not reproduced")
        result = {
            "WIZ_REQ_NPCIN_0x1D": npc_detail["status"],
            "WIZ_NPC_REGION_0x1C": npc_region["status"],
        }
        if document["set_id"] == "WS50-C3":
            remaining = matrix.get("ws03_blockers", {}).get("remaining", [])
            mob_gap = next((item for item in remaining if "WS25 mob events" in item and "encoder" in item), None)
            if not mob_gap:
                raise RuntimeError("expected legacy MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY blocker is not reproduced")
            result["mob_browser_encoder_authority"] = "INCOMPLETE"
        return result

    if not npc_region or npc_region.get("status") != "VERIFIED_REGION_ID_LIST":
        raise RuntimeError("C4 requires WS11 VERIFIED_REGION_ID_LIST for 0x1C")
    inout = rows.get("0x0A")
    if not inout or inout.get("status") != "VERIFIED_VISIBILITY":
        raise RuntimeError("C4 requires WS11 VERIFIED_VISIBILITY for 0x0A")

    profile = json.loads((tree / "protocol-lab/VISIBILITY_PROTOCOL_PROFILE.json").read_text(encoding="utf-8"))
    if profile.get("verification_summary", {}).get("blockers_for_ws50") != []:
        raise RuntimeError("C4 WS11 visibility profile still reports a WS50 wire blocker")
    validation = run(["python3", "tools/ws11_protocol/validate_visibility.py"], cwd=tree, capture=True, env=env)
    return {
        "WIZ_NPC_REGION_0x1C": npc_region["status"],
        "WIZ_REQ_NPCIN_0x1D": npc_detail["status"],
        "WIZ_NPC_INOUT_0x0A": inout["status"],
        "monster_visibility": profile["monster_visibility"]["status"],
        "golden_fixture_validation": "PASS",
        "validator_output": validation.splitlines()[-1] if validation else "",
        "NPC_REGION_BODY_AUTHORITY": "CLOSED",
    }


def data_checks(tree: Path, document: dict) -> dict | None:
    if "WS31" not in provider_map(document):
        return None
    summary = json.loads((tree / "data-catalog/generated/catalog-summary.json").read_text(encoding="utf-8"))
    npc = summary["coverage"]["moradon_npc"]
    mobs = summary["coverage"]["moradon_monsters"]
    if npc["templates"] != 31 or npc["spawn_groups"] != 39 or npc["declared_population"] != 43:
        raise RuntimeError("WS31 Moradon NPC authority does not match pinned C2/C3/C4 evidence")
    if mobs["templates"] != 10 or mobs["spawn_groups"] != 20 or mobs["declared_population"] != 135:
        raise RuntimeError("WS31 Moradon mob authority does not match pinned C2/C3/C4 evidence")

    if document["set_id"] != "WS50-C4":
        if npc["terrain_y_unknown_groups"] != 39:
            raise RuntimeError("expected legacy WORLD_TERRAIN_HEIGHT_AUTHORITY NPC blocker is not reproduced")
        if mobs["terrain_y_status"] != "UNKNOWN_SOURCE_HAS_NO_Y_COLUMN":
            raise RuntimeError("expected legacy WORLD_TERRAIN_HEIGHT_AUTHORITY mob blocker is not reproduced")
        return {"moradon_npc": npc, "moradon_monsters": mobs}

    return {
        "moradon_npc": npc,
        "moradon_monsters": mobs,
        "source_y_is_not_authority": True,
        "height_owner": "WS14 exact resolver; verified by C4 provider integration tests",
    }


def c4_contract_checks(tree: Path, document: dict) -> dict | None:
    if document["set_id"] != "WS50-C4":
        return None
    mob_model = (tree / "services/ko1298-mobs/mob-model.cjs").read_text(encoding="utf-8")
    world_service = (tree / "services/ko1298-world/src/world-session-service.js").read_text(encoding="utf-8")

    snapshot_start = mob_model.find("function snapshotMob")
    distance_start = mob_model.find("function distanceSquared", snapshot_start)
    snapshot_body = mob_model[snapshot_start:distance_start]
    has_runtime_id = "runtimeId:" in snapshot_body or "instanceId:" in snapshot_body
    string_source_identity = 'id: `${group.groupId}/${spawn.spawnId}`' in mob_model
    ws14_integer_guard = "nearby mob requires integer instanceId/nid/id" in world_service

    if has_runtime_id:
        raise RuntimeError("C4 expected WS25 runtime/network identity blocker was not reproduced")
    if not string_source_identity:
        raise RuntimeError("C4 cannot prove the pinned WS25 source identity shape")
    if not ws14_integer_guard:
        raise RuntimeError("C4 cannot prove the pinned WS14 integer mob identity contract")

    return {
        "status": "EXPECTED_BLOCKER_REPRODUCED",
        "first_blocker": "MOB_RUNTIME_NETWORK_IDENTITY_AUTHORITY",
        "ws25_snapshot_has_integer_runtime_identity": False,
        "ws25_source_identity": "groupId/spawnId string id",
        "ws14_requires_integer_instanceId_nid_or_id": True,
        "ws50_invented_runtime_id": False,
        "MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY": "OPEN",
    }


def composition_checks(tree: Path, document: dict, *, env: dict) -> dict:
    counts = {}
    for ws, test_dir in [
        ("WS03", "tests/ko1298-session"),
        ("WS14", "tests/ko1298-world"),
        ("WS15", "tests/ko1298-movement"),
        ("WS16", "tests/ko1298-npc"),
        ("WS45", "tests/session-ownership"),
    ]:
        if ws in provider_map(document):
            counts[ws] = node_test_dir(tree, test_dir, env=env)

    if "WS25" in provider_map(document):
        counts["WS25"] = node_test_dir(tree, "tests/ko1298-mobs", env=env)

    composed = tree / "tests/ko1298-session/composed-contracts.contract.js"
    if not composed.exists():
        raise RuntimeError("WS03 composed-contract test missing from exact candidate")
    run(["node", "--test", str(composed.relative_to(tree))], cwd=tree, env=env)

    result = {
        "provider_test_files_executed": counts,
        "ws03_real_provider_composed_contract": "PASS",
    }
    if document["set_id"] == "WS50-C4":
        result.update({
            "real_moradon_smd_injected": True,
            "authoritative_npc_materialization": "PASS",
            "authoritative_mob_materialization": "PASS",
            "WORLD_TERRAIN_HEIGHT_AUTHORITY": "CLOSED",
        })
    return result


def requested_flow(document: dict, contract: dict | None) -> list[dict]:
    if document["set_id"] != "WS50-C4":
        return []
    blocker = contract["first_blocker"]
    return [
        {"step": "auth/world session", "status": "PASS", "evidence": "exact WS03/WS14/WS15 regression composition"},
        {"step": "GAMESTART loading", "status": "BLOCKED", "blocker": blocker,
         "detail": "WS14 nearby mob normalization requires integer instanceId/nid/id before region bootstrap"},
        {"step": "authoritative NPC materialization", "status": "PASS_PRECOMPOSITION",
         "evidence": "real WS14 SMD -> WS16 integration test"},
        {"step": "authoritative mob materialization", "status": "PASS_PRECOMPOSITION",
         "evidence": "real WS14 SMD -> WS25 135-slot integration test"},
        {"step": "combined 0x1C region list", "status": "NOT_RUN_AFTER_FIRST_BLOCKER"},
        {"step": "simulated client 0x1D request", "status": "NOT_RUN_AFTER_FIRST_BLOCKER"},
        {"step": "exact NPC details", "status": "NOT_RUN_AFTER_FIRST_BLOCKER"},
        {"step": "exact mob details", "status": "NOT_RUN_AFTER_FIRST_BLOCKER"},
        {"step": "NPC/mob incremental 0x0A IN/OUT", "status": "NOT_RUN_AFTER_FIRST_BLOCKER"},
        {"step": "WORLD_READY", "status": "NOT_RUN_AFTER_FIRST_BLOCKER"},
        {"step": "disconnect cleanup", "status": "NOT_RUN_AFTER_FIRST_BLOCKER"},
    ]


def run_candidate(repo: Path, document: dict, output_dir: Path) -> dict:
    providers = provider_map(document)
    main = providers.get("MAIN")
    if not main:
        raise RuntimeError("candidate requires MAIN provider")
    output_dir.mkdir(parents=True, exist_ok=True)

    temp_root = Path(tempfile.mkdtemp(prefix=f"ws50-{document['set_id'].lower()}-"))
    tree = temp_root / "candidate"
    try:
        run(["git", "worktree", "add", "--detach", str(tree), main["exact_sha"]], cwd=repo)
        checkout_surfaces(tree, document)
        run(["git", "diff", "--cached", "--check"], cwd=tree)
        env = c4_env(tree, document)

        composition = composition_checks(tree, document, env=env)
        protocol = protocol_checks(tree, document, env=env)
        data = data_checks(tree, document)
        contract = c4_contract_checks(tree, document)

        browser_ready = document.get("readiness", {}).get("BROWSER_READY") == "NEEDS_WS10"
        receipt = {
            "schema_version": "ws50-candidate-runtime-receipt/v2" if document["set_id"] == "WS50-C4" else "ws50-candidate-runtime-receipt/v1",
            "set_id": document["set_id"],
            "immutable_key": document["immutable_key"],
            "provider_set_content_hash": document["content_hash"],
            "candidate_result": document["candidate_result"],
            "composition_checks": composition,
            "protocol_checks": protocol,
            "data_checks": data,
            "contract_checks": contract,
            "requested_visibility_flow": requested_flow(document, contract) if contract else [],
            "parent_blocker_closure": document.get("parent_blocker_closure"),
            "readiness": document.get("readiness"),
            "first_failing_boundary": document["first_failing_boundary"],
            "blocker_owner": document["blocker_owner"],
            "browser_proven": False,
            "browser_gate_ready_for_ws10": browser_ready,
            "provider_branch_resolution_during_candidate": False,
        }
        path = output_dir / f"{document['set_id']}-receipt.json"
        path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"WS50_CANDIDATE_REPRODUCED {document['set_id']} result={document['candidate_result']} receipt={path}")
        return receipt
    finally:
        if tree.exists():
            subprocess.run(
                ["git", "worktree", "remove", "--force", str(tree)],
                cwd=repo,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        shutil.rmtree(temp_root, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    document = load_set(args.manifest)
    validate_set(document, args.manifest)
    run_candidate(repo, document, Path(args.output).resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
