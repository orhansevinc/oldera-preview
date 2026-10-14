#!/usr/bin/env python3
"""Run a WS50 candidate against only the immutable SHAs in its manifest.

This script never resolves a provider branch for composition. Remote branch refs
are used only by provider_sets.py drift reporting.
"""
from __future__ import annotations

import argparse
import json
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


def run(cmd: list[str], *, cwd: Path, capture: bool = False) -> str:
    print("+", " ".join(cmd), flush=True)
    proc = subprocess.run(
        cmd, cwd=cwd, text=True, check=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    return (proc.stdout or "").strip()


def provider_map(document: dict) -> dict[str, dict]:
    return {provider["ws"]: provider for provider in document["providers"]}


def checkout_surfaces(tree: Path, document: dict) -> None:
    providers = provider_map(document)
    for ws, paths in SURFACES.items():
        provider = providers.get(ws)
        if not provider:
            continue
        for path in paths:
            run(["git", "checkout", provider["exact_sha"], "--", path], cwd=tree)


def node_test_dir(tree: Path, relative: str) -> int:
    root = tree / relative
    files = sorted(
        str(path.relative_to(tree))
        for path in root.iterdir()
        if path.is_file() and (path.name.endswith(".test.js") or path.name.endswith(".test.cjs"))
    )
    if not files:
        raise RuntimeError(f"no Node tests found in {relative}")
    run(["node", "--test", *files], cwd=tree)
    return len(files)


def protocol_checks(tree: Path, document: dict) -> dict:
    matrix_path = tree / "protocol-lab/PROTOCOL_OWNER_MATRIX.json"
    matrix = json.loads(matrix_path.read_text(encoding="utf-8"))
    rows = {row["opcode"]: row for row in matrix["matrix"]}
    npc_detail = rows.get("0x1D")
    npc_region = rows.get("0x1C")
    if not npc_detail or npc_detail.get("status") != "COLLISION_RESOLVED":
        raise RuntimeError("WS11 exact set no longer proves WIZ_REQ_NPCIN 0x1D collision resolution")
    if not npc_region or npc_region.get("status") != "PARTIAL_BODY":
        raise RuntimeError("expected NPC_REGION_BODY_AUTHORITY blocker is not reproduced")
    result = {
        "WIZ_REQ_NPCIN_0x1D": npc_detail["status"],
        "WIZ_NPC_REGION_0x1C": npc_region["status"],
    }
    if document["set_id"] == "WS50-C3":
        remaining = matrix.get("ws03_blockers", {}).get("remaining", [])
        mob_gap = next((item for item in remaining if "WS25 mob events" in item and "encoder" in item), None)
        if not mob_gap:
            raise RuntimeError("expected MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY blocker is not reproduced")
        result["mob_browser_encoder_authority"] = "INCOMPLETE"
    return result


def data_checks(tree: Path, document: dict) -> dict | None:
    if "WS31" not in provider_map(document):
        return None
    summary = json.loads((tree / "data-catalog/generated/catalog-summary.json").read_text(encoding="utf-8"))
    npc = summary["coverage"]["moradon_npc"]
    mobs = summary["coverage"]["moradon_monsters"]
    if npc["templates"] != 31 or npc["spawn_groups"] != 39 or npc["declared_population"] != 43:
        raise RuntimeError("WS31 Moradon NPC authority does not match pinned C2/C3 evidence")
    if npc["terrain_y_unknown_groups"] != 39:
        raise RuntimeError("expected WORLD_TERRAIN_HEIGHT_AUTHORITY NPC blocker is not reproduced")
    if mobs["templates"] != 10 or mobs["spawn_groups"] != 20 or mobs["declared_population"] != 135:
        raise RuntimeError("WS31 Moradon mob authority does not match pinned C2/C3 evidence")
    if mobs["terrain_y_status"] != "UNKNOWN_SOURCE_HAS_NO_Y_COLUMN":
        raise RuntimeError("expected WORLD_TERRAIN_HEIGHT_AUTHORITY mob blocker is not reproduced")
    return {"moradon_npc": npc, "moradon_monsters": mobs}


def composition_checks(tree: Path, document: dict) -> dict:
    counts = {}
    for ws, test_dir in [
        ("WS03", "tests/ko1298-session"),
        ("WS14", "tests/ko1298-world"),
        ("WS15", "tests/ko1298-movement"),
        ("WS16", "tests/ko1298-npc"),
        ("WS45", "tests/session-ownership"),
    ]:
        if ws in provider_map(document):
            counts[ws] = node_test_dir(tree, test_dir)

    if "WS25" in provider_map(document):
        counts["WS25"] = node_test_dir(tree, "tests/ko1298-mobs")

    composed = tree / "tests/ko1298-session/composed-contracts.contract.js"
    if not composed.exists():
        raise RuntimeError("WS03 composed-contract test missing from exact candidate")
    run(["node", "--test", str(composed.relative_to(tree))], cwd=tree)
    return {"provider_test_files_executed": counts, "ws03_real_provider_composed_contract": "PASS"}


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

        composition = composition_checks(tree, document)
        protocol = protocol_checks(tree, document)
        data = data_checks(tree, document)

        receipt = {
            "schema_version": "ws50-candidate-runtime-receipt/v1",
            "set_id": document["set_id"],
            "immutable_key": document["immutable_key"],
            "provider_set_content_hash": document["content_hash"],
            "candidate_result": document["candidate_result"],
            "composition_checks": composition,
            "protocol_checks": protocol,
            "data_checks": data,
            "first_failing_boundary": document["first_failing_boundary"],
            "blocker_owner": document["blocker_owner"],
            "browser_proven": False,
            "browser_gate_ready_for_ws10": False,
            "provider_branch_resolution_during_candidate": False,
        }
        path = output_dir / f"{document['set_id']}-receipt.json"
        path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"WS50_CANDIDATE_REPRODUCED {document['set_id']} result={document['candidate_result']} receipt={path}")
        return receipt
    finally:
        if tree.exists():
            subprocess.run(["git", "worktree", "remove", "--force", str(tree)], cwd=repo,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
