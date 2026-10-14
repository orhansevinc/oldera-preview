#!/usr/bin/env python3
"""WS50 immutable provider-set validation and drift evidence.

Provider branches are observations. This tool never edits a manifest and never
upgrades an exact SHA to a branch tip.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
CAP_KEYS = ("DOMAIN_READY", "CONTRACT_READY", "PROTOCOL_READY", "COMPOSITION_READY", "BROWSER_PROVEN")
REQUIRED = (
    "schema_version", "set_id", "parent_set_id", "purpose", "baseline_browser_proof",
    "client_artifact", "composition_recipe_version", "providers", "protocol_authority",
    "data_authority", "runtime_build_identity", "db_schema_identity", "feature_profile",
    "created_by", "created_at", "candidate_result", "delta_from_parent",
    "first_failing_boundary", "blocker_owner", "capabilities", "evidence_refs",
    "content_hash", "immutable_key",
)


def canonical_hash(document: dict) -> str:
    payload = copy.deepcopy(document)
    payload.pop("content_hash", None)
    payload.pop("immutable_key", None)
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def load_set(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def validate_set(document: dict, path: str = "<memory>") -> None:
    missing = [key for key in REQUIRED if key not in document]
    if missing:
        raise ValueError(f"{path}: missing required keys: {', '.join(missing)}")
    if document["schema_version"] != "ws50-provider-set/v1":
        raise ValueError(f"{path}: unsupported schema_version")
    if not re.fullmatch(r"WS50-[BC][0-9]+", document["set_id"]):
        raise ValueError(f"{path}: invalid set_id {document['set_id']!r}")
    if document["parent_set_id"] is not None and not re.fullmatch(r"WS50-[BC][0-9]+", document["parent_set_id"]):
        raise ValueError(f"{path}: invalid parent_set_id")
    if not isinstance(document["providers"], list) or not document["providers"]:
        raise ValueError(f"{path}: providers must be a non-empty list")

    seen_ws = set()
    seen_branch = set()
    for provider in document["providers"]:
        for key in ("ws", "branch", "exact_sha"):
            if not isinstance(provider.get(key), str) or not provider[key]:
                raise ValueError(f"{path}: provider missing {key}")
        if provider["ws"] in seen_ws:
            raise ValueError(f"{path}: duplicate provider ws {provider['ws']}")
        if provider["branch"] in seen_branch:
            raise ValueError(f"{path}: duplicate provider branch {provider['branch']}")
        seen_ws.add(provider["ws"])
        seen_branch.add(provider["branch"])
        if not SHA_RE.fullmatch(provider["exact_sha"]):
            raise ValueError(f"{path}: invalid exact_sha for {provider['ws']}")
        tested = provider.get("tested_implementation_sha")
        if tested is not None and not SHA_RE.fullmatch(tested):
            raise ValueError(f"{path}: invalid tested_implementation_sha for {provider['ws']}")

    if not isinstance(document["capabilities"], dict) or not document["capabilities"]:
        raise ValueError(f"{path}: capabilities must be non-empty")
    for name, capability in document["capabilities"].items():
        for key in CAP_KEYS:
            if not isinstance(capability.get(key), bool):
                raise ValueError(f"{path}: capability {name} {key} must be boolean")
        if not isinstance(capability.get("blockers", []), list):
            raise ValueError(f"{path}: capability {name} blockers must be a list")

    expected = canonical_hash(document)
    if document["content_hash"] != expected:
        raise ValueError(f"{path}: content_hash mismatch expected={expected} actual={document['content_hash']}")
    if not HASH_RE.fullmatch(document["content_hash"]):
        raise ValueError(f"{path}: invalid content_hash")
    expected_key = f"{document['set_id']}@{document['content_hash']}"
    if document["immutable_key"] != expected_key:
        raise ValueError(f"{path}: immutable_key mismatch expected={expected_key}")


def validate_lineage(documents: list[dict]) -> None:
    by_id = {doc["set_id"]: doc for doc in documents}
    if len(by_id) != len(documents):
        raise ValueError("duplicate set_id across supplied manifests")
    for doc in documents:
        parent = doc["parent_set_id"]
        if parent is not None and parent not in by_id:
            raise ValueError(f"{doc['set_id']}: parent {parent} not supplied to lineage validation")
        if parent:
            parent_map = {p["ws"]: p for p in by_id[parent]["providers"]}
            child_map = {p["ws"]: p for p in doc["providers"]}
            for ws in parent_map:
                if ws not in child_map:
                    raise ValueError(f"{doc['set_id']}: parent provider {ws} was removed")
            declared = {d["ws"] for d in doc["delta_from_parent"]}
            actual = {
                ws for ws in child_map
                if ws not in parent_map or child_map[ws]["exact_sha"] != parent_map[ws]["exact_sha"]
            }
            if declared != actual:
                raise ValueError(
                    f"{doc['set_id']}: delta_from_parent mismatch declared={sorted(declared)} actual={sorted(actual)}"
                )


def run_git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=repo, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, check=check,
    )


def verify_git(document: dict, repo: Path) -> dict:
    verified = []
    for provider in document["providers"]:
        exact = provider["exact_sha"]
        run_git(repo, "cat-file", "-e", exact + "^{commit}")
        tested = provider.get("tested_implementation_sha")
        tested_is_ancestor = None
        if tested:
            run_git(repo, "cat-file", "-e", tested + "^{commit}")
            if tested != exact:
                ancestor = run_git(repo, "merge-base", "--is-ancestor", tested, exact, check=False)
                tested_is_ancestor = ancestor.returncode == 0
                if not tested_is_ancestor:
                    raise ValueError(
                        f"{document['set_id']} {provider['ws']}: tested SHA {tested} is not an ancestor of exact SHA {exact}"
                    )
            else:
                tested_is_ancestor = True
        verified.append({
            "ws": provider["ws"], "branch": provider["branch"], "exact_sha": exact,
            "tested_implementation_sha": tested, "tested_is_ancestor_or_equal": tested_is_ancestor,
        })
    return {"set_id": document["set_id"], "provider_sha_evidence": verified}


def drift_report(document: dict, repo: Path) -> dict:
    rows = []
    for provider in document["providers"]:
        ref = f"refs/remotes/origin/{provider['branch']}"
        observed = run_git(repo, "rev-parse", "--verify", ref, check=False)
        observed_sha = observed.stdout.strip() if observed.returncode == 0 else None
        rows.append({
            "ws": provider["ws"],
            "branch": provider["branch"],
            "candidate_exact_sha": provider["exact_sha"],
            "observed_branch_sha": observed_sha,
            "drifted": observed_sha is None or observed_sha != provider["exact_sha"],
        })
    return {
        "set_id": document["set_id"],
        "immutable_key": document["immutable_key"],
        "candidate_mutated": False,
        "drift_is_observation_only": True,
        "providers": rows,
    }


def cmd_validate(args: argparse.Namespace) -> int:
    documents = []
    for path in args.manifests:
        doc = load_set(path)
        validate_set(doc, path)
        documents.append(doc)
        print(f"SCHEMA_HASH_OK {doc['immutable_key']}")
    validate_lineage(documents)
    print("LINEAGE_OK " + " -> ".join(doc["set_id"] for doc in documents))
    return 0


def cmd_verify_git(args: argparse.Namespace) -> int:
    doc = load_set(args.manifest)
    validate_set(doc, args.manifest)
    result = verify_git(doc, Path(args.repo).resolve())
    text = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def cmd_drift(args: argparse.Namespace) -> int:
    doc = load_set(args.manifest)
    validate_set(doc, args.manifest)
    result = drift_report(doc, Path(args.repo).resolve())
    text = json.dumps(result, indent=2, sort_keys=True)
    Path(args.output).write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    validate = sub.add_parser("validate")
    validate.add_argument("manifests", nargs="+")
    validate.set_defaults(func=cmd_validate)

    verify = sub.add_parser("verify-git")
    verify.add_argument("--manifest", required=True)
    verify.add_argument("--repo", default=".")
    verify.add_argument("--output")
    verify.set_defaults(func=cmd_verify_git)

    drift = sub.add_parser("drift")
    drift.add_argument("--manifest", required=True)
    drift.add_argument("--repo", default=".")
    drift.add_argument("--output", required=True)
    drift.set_defaults(func=cmd_drift)

    args = parser.parse_args()
    try:
        return args.func(args)
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        print(f"WS50_PROVIDER_SET_ERROR {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
