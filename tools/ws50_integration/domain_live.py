#!/usr/bin/env python3
"""WS50 domain-live release discovery.

This coordinator freezes only owner-tested implementation SHAs declared in the
common domain-live handoff contract. Branch tips are observations, never release
pins. Missing/blocked handoffs produce a resumable BLOCKED state rather than a
false release candidate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

RELEASE_ID = "oldkoweb-domain-live-20261015"
BASELINE = {
    "website_source": "5f9a4f0ccd3d7d06e8b407bfca35266f1b2d3516",
    "website_handoff": "8370de2ebfdfd319cf8a719da79cbdef9853fd2f",
    "parent_provider_set": "WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e",
    "ws50_handoff": "7497087d4cf67e4e05a3a090f6edad3d206078cb",
    "ws10_run_id": 38604174659,
    "client_artifact_id": 11915666463,
    "client_artifact_digest": "sha256:f749750fc5bb0249a67b712bd4e1a03847773d8845fd209508b8c95f6c447a83",
}
OWNERS = {
    "WEBSITE": "official-site-domain-release",
    "WS13": "ws13-account-api",
    "WS07": "ws07-database",
    "WS03": "ws03-ko1298-session",
    "WS08": "ws08-admin-api",
    "WS09": "ws09-production-infra",
    "WS10": "ws10-qa-integration",
}
REQUIRED_FIELDS = (
    "schema_version", "release_id", "owner", "branch", "source_commit",
    "input_pins", "contracts", "artifacts", "checks", "blockers",
)
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SUCCESS = {"PASS", "PASSED", "SUCCESS", "SUCCEEDED"}
C5_WS16 = "5ed48ff32187000312652838674388df52fc3fb7"
OLD_WS16_COMPOSITION = "234657c1264ead6b8828425ae9e7fcdca0cca5c8"


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=repo, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, check=check,
    )


def rev(repo: Path, ref: str) -> str | None:
    p = git(repo, "rev-parse", "--verify", ref, check=False)
    value = p.stdout.strip()
    return value if p.returncode == 0 and SHA_RE.fullmatch(value) else None


def show(repo: Path, commit: str, path: str) -> str | None:
    p = git(repo, "show", f"{commit}:{path}", check=False)
    return p.stdout if p.returncode == 0 else None


def ancestor(repo: Path, older: str, newer: str) -> bool:
    return git(repo, "merge-base", "--is-ancestor", older, newer, check=False).returncode == 0


def validate_check(owner: str, source_commit: str, item: Any) -> str | None:
    if not isinstance(item, dict):
        return f"{owner}: check must be object"
    name = item.get("name") or item.get("test")
    url = item.get("url") or item.get("run_url") or item.get("job_url")
    tested = item.get("tested_sha") or item.get("tested_commit") or item.get("sha")
    result = str(item.get("result") or item.get("conclusion") or "").upper()
    if not isinstance(name, str) or not name.strip():
        return f"{owner}: check name missing"
    if not isinstance(url, str) or not url.startswith("https://github.com/orhansevinc/oldera-preview/actions/"):
        return f"{owner}: check {name} has no real GitHub Actions run/job URL"
    if tested != source_commit:
        return f"{owner}: check {name} tested SHA {tested!r} != source_commit {source_commit}"
    if result not in SUCCESS:
        return f"{owner}: check {name} result {result or '<missing>'} is not successful"
    return None


def inspect_ws03_pin(repo: Path, source_commit: str) -> dict[str, Any]:
    path = "workstreams/ws03/PRODUCTION_POSTGRES_COMPOSITION.json"
    raw = show(repo, source_commit, path)
    result: dict[str, Any] = {
        "path": path,
        "c5_ws16": C5_WS16,
        "expected_preserved_composition_pin": OLD_WS16_COMPOSITION,
        "requires_c5_visibility_regression": True,
    }
    if raw is None:
        result["state"] = "COMPOSITION_FILE_MISSING"
        return result
    try:
        doc = json.loads(raw)
        ws16 = doc["taskStartResolvedDirectProviders"]["WS16"]
        result.update({
            "state": "INSPECTED",
            "resolved_head": ws16.get("resolvedHead"),
            "composition_pin": ws16.get("compositionPin"),
            "upgrade_applied": ws16.get("upgradeApplied"),
            "pin_is_preserved_old_composition": ws16.get("compositionPin") == OLD_WS16_COMPOSITION,
            "c5_provider_is_newer_than_composition": ws16.get("resolvedHead") == C5_WS16 and ws16.get("compositionPin") != C5_WS16,
        })
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        result.update({"state": "COMPOSITION_PARSE_ERROR", "error": str(exc)})
    return result


def discover(repo: Path) -> tuple[dict[str, Any], bool]:
    owners: dict[str, Any] = {}
    release_pins: dict[str, str] = {}
    blockers: list[dict[str, str]] = []

    for owner, branch in OWNERS.items():
        remote_ref = f"refs/remotes/origin/{branch}"
        tip = rev(repo, remote_ref)
        handoff_path = f"coordination/handoffs/domain-live/{owner}.json"
        row: dict[str, Any] = {
            "owner": owner,
            "branch": branch,
            "observed_branch_head": tip,
            "handoff_path": handoff_path,
            "state": "UNRESOLVED",
        }
        owners[owner] = row
        if tip is None:
            row["state"] = "BRANCH_UNAVAILABLE"
            blockers.append({"id": f"{owner}_BRANCH_UNAVAILABLE", "owner": owner, "required_action": f"make {branch} fetchable"})
            continue
        raw = show(repo, tip, handoff_path)
        if raw is None:
            row["state"] = "HANDOFF_MISSING"
            blockers.append({"id": f"{owner}_DOMAIN_LIVE_HANDOFF_MISSING", "owner": owner, "required_action": f"write {handoff_path} on {branch} for {RELEASE_ID}"})
            continue
        try:
            handoff = json.loads(raw)
        except json.JSONDecodeError as exc:
            row.update({"state": "HANDOFF_INVALID", "error": str(exc)})
            blockers.append({"id": f"{owner}_HANDOFF_INVALID_JSON", "owner": owner, "required_action": "fix owner handoff JSON"})
            continue

        missing = [k for k in REQUIRED_FIELDS if k not in handoff]
        errors: list[str] = []
        if missing:
            errors.append("missing fields: " + ", ".join(missing))
        if handoff.get("release_id") != RELEASE_ID:
            errors.append(f"release_id must be {RELEASE_ID}")
        if handoff.get("owner") != owner:
            errors.append(f"owner must be {owner}")
        if handoff.get("branch") != branch:
            errors.append(f"branch must be {branch}")
        source_commit = handoff.get("source_commit")
        if not isinstance(source_commit, str) or not SHA_RE.fullmatch(source_commit):
            errors.append("source_commit must be exact 40-char SHA")
        elif rev(repo, source_commit) is None:
            errors.append("source_commit is not available as a commit")
        elif not ancestor(repo, source_commit, tip):
            errors.append("source_commit is not ancestor/equal of observed owner branch head")

        checks = handoff.get("checks")
        if not isinstance(checks, list) or not checks:
            errors.append("checks must contain at least one real CI check")
        elif isinstance(source_commit, str):
            for check in checks:
                err = validate_check(owner, source_commit, check)
                if err:
                    errors.append(err)

        owner_blockers = handoff.get("blockers")
        if not isinstance(owner_blockers, list):
            errors.append("blockers must be a list")
        elif owner_blockers:
            for index, blocker in enumerate(owner_blockers):
                if isinstance(blocker, dict):
                    blockers.append({
                        "id": str(blocker.get("id") or f"{owner}_BLOCKER_{index+1}"),
                        "owner": str(blocker.get("owner") or owner),
                        "required_action": str(blocker.get("required_action") or blocker.get("action") or "resolve owner blocker"),
                    })
                else:
                    blockers.append({"id": f"{owner}_BLOCKER_{index+1}", "owner": owner, "required_action": str(blocker)})

        if errors:
            row.update({"state": "HANDOFF_INVALID", "errors": errors})
            blockers.append({"id": f"{owner}_HANDOFF_CONTRACT_INVALID", "owner": owner, "required_action": "repair common domain-live handoff contract"})
            continue

        row.update({
            "state": "ACCEPTED" if not owner_blockers else "ACCEPTED_BLOCKED",
            "source_commit": source_commit,
            "input_pins": handoff["input_pins"],
            "contracts": handoff["contracts"],
            "artifacts": handoff["artifacts"],
            "checks": checks,
            "blockers": owner_blockers,
        })
        release_pins[owner] = source_commit

    accepted = all(owners[o]["state"] == "ACCEPTED" for o in OWNERS)
    pin_payload = json.dumps(release_pins, sort_keys=True, separators=(",", ":")).encode()
    pin_digest = "sha256:" + hashlib.sha256(pin_payload).hexdigest()
    ws03 = inspect_ws03_pin(repo, release_pins["WS03"]) if "WS03" in release_pins else {
        "state": "WAITING_FOR_WS03_HANDOFF", "requires_c5_visibility_regression": True,
        "c5_ws16": C5_WS16, "expected_preserved_composition_pin": OLD_WS16_COMPOSITION,
    }

    state: dict[str, Any] = {
        "schema_version": "ws50-domain-live-state/v1",
        "release_id": RELEASE_ID,
        "baseline": BASELINE,
        "discovery_policy": "owner source_commit pins only; branch heads are observation-only; no silent upgrades",
        "owners": owners,
        "candidate": {
            "ready": accepted and not blockers,
            "source_pins": release_pins,
            "source_pin_digest": pin_digest,
            "immutable_child_candidate": None,
            "note": "WS50 child candidate is minted only after every upstream handoff is accepted and integration tests pass.",
        },
        "ws03_c5_visibility_compatibility": ws03,
        "verification": {
            "CI_VERIFIED": False,
            "INTEGRATION_VERIFIED": False,
            "DOMAIN_VERIFIED": False,
        },
        "blockers": blockers,
        "resume": {
            "when": "all upstream owner handoffs are ACCEPTED with zero blockers",
            "next_gate": "exact isolated integration candidate, including WS03 persistence + preserved C5 NPC/mob visibility regression",
            "then": "WS10 real-browser gate -> WS09 deployment receipt -> WS10 real-domain acceptance receipt",
        },
    }
    return state, state["candidate"]["ready"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    parser.add_argument("--output", required=True)
    parser.add_argument("--github-output")
    args = parser.parse_args()
    repo = Path(args.repo).resolve()
    try:
        state, ready = discover(repo)
    except (OSError, subprocess.CalledProcessError, ValueError) as exc:
        print(f"WS50_DOMAIN_LIVE_ERROR {exc}", file=sys.stderr)
        return 1
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.github_output:
        with Path(args.github_output).open("a", encoding="utf-8") as fh:
            fh.write(f"ready={'true' if ready else 'false'}\n")
            fh.write(f"blocker_count={len(state['blockers'])}\n")
            fh.write(f"pin_digest={state['candidate']['source_pin_digest']}\n")
    print(f"DOMAIN_LIVE_DISCOVERY release={RELEASE_ID} ready={str(ready).lower()} blockers={len(state['blockers'])}")
    for blocker in state["blockers"]:
        print(f"BLOCKER {blocker['id']} owner={blocker['owner']} action={blocker['required_action']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
