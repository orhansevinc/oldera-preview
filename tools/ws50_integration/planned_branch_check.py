#!/usr/bin/env python3
"""WS50 preflight: verify every WS named by WS40 has a Git branch."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

WST = re.compile(r"\bWS(\d{2})\b", re.I)
BRANCH = re.compile(r"^ws(\d{2})-")


def git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ("git", *args),
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def planned_ids(repo: Path, plan_ref: str) -> list[str]:
    p = git(repo, "show", f"{plan_ref}:integration-plans/MERGE_ORDER.md")
    if p.returncode:
        raise RuntimeError(f"cannot read WS40 MERGE_ORDER from {plan_ref}: {p.stderr.strip()}")
    out: list[str] = []
    for m in WST.finditer(p.stdout):
        ws = f"WS{m.group(1)}"
        if ws != "WS40" and ws not in out:
            out.append(ws)
    return out


def present_ids(repo: Path) -> set[str]:
    p = git(
        repo,
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
        "refs/remotes/origin",
    )
    if p.returncode:
        raise RuntimeError(p.stderr.strip())
    found: set[str] = set()
    for raw in p.stdout.splitlines():
        name = raw.rsplit("/", 1)[-1]
        m = BRANCH.match(name)
        if m:
            found.add(f"WS{m.group(1)}")
    return found


def check(repo: Path, plan_ref: str) -> dict[str, object]:
    planned = planned_ids(repo, plan_ref)
    present = present_ids(repo)
    missing = [ws for ws in planned if ws not in present]
    return {
        "plan_ref": plan_ref,
        "planned_count": len(planned),
        "missing_branches": missing,
        "missing_count": len(missing),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--plan-ref", default="refs/remotes/origin/ws40-release-readiness")
    args = ap.parse_args()
    result = check(Path(args.repo).resolve(), args.plan_ref)
    print("WS50_BRANCH_CHECK=" + json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
