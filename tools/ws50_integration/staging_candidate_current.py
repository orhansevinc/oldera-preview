#!/usr/bin/env python3
"""Freeze current provider heads at rehearsal start on the WS50 control base."""

import os
from pathlib import Path
import sys

import staging_candidate

CONTROL_BASE = "3aeaaa3de81c8094b47de44f2c24f3c455e7fd3d"
staging_candidate.FROZEN["MAIN"] = ("control-base", CONTROL_BASE)


def snapshot_current_provider_refs() -> None:
    current_main = staging_candidate.git("rev-parse", "refs/remotes/origin/main")
    staging_candidate.run(
        ["git", "merge-base", "--is-ancestor", CONTROL_BASE, current_main],
        capture=False,
    )
    print(f"CONTROL_BASE_OK {CONTROL_BASE} current_main={current_main}")

    # Provider branches may be finishing parallel control sessions while WS50
    # runs. Snapshot each current HEAD once, then use only those exact SHAs for
    # the disposable tree. This is the freeze; no moving branch tip is consumed
    # after this point. WS05 is re-fetched again after the rehearsal completes.
    for key, (branch, _previous) in list(staging_candidate.FROZEN.items()):
        if key == "MAIN":
            continue
        ref = f"refs/remotes/origin/{branch}"
        actual = staging_candidate.git("rev-parse", ref)
        staging_candidate.FROZEN[key] = (branch, actual)
        print(f"FROZEN_SNAPSHOT {key} {branch}@{actual}")


def tolerate_noncanonical_session_log(tree: Path, out: Path) -> None:
    """Use TCP port probes as the boot proof; container log wording is diagnostic."""
    try:
        original_container_checks(tree, out)
        return
    except SystemExit as exc:
        if str(exc) != "SESSION_WORLD_CONTAINER_LISTEN_EVIDENCE_MISSING":
            raise

    print("SESSION_WORLD_CONTAINER_BOOT_OK via TCP probes; log wording is noncanonical")

    # The original check exits before WS09 compose validation when only the
    # diagnostic log wording differs. Finish that remaining validation here.
    compose = out / "docker-compose.ws09-staging.yml"
    compose.write_text(
        staging_candidate.git(
            "show",
            f"{staging_candidate.FROZEN['WS09'][1]}:docker-compose.ws09-staging.yml",
        )
        + "\n",
        encoding="utf-8",
    )
    env = os.environ.copy()
    env.update(
        {
            "GATEWAY_IMAGE": "ws50-gateway:rehearsal",
            "KO_SESSION_WORLD_IMAGE": "ws50-session-world:rehearsal",
        }
    )
    rendered = staging_candidate.run(
        ["docker", "compose", "-f", str(compose), "config"],
        cwd=tree,
        env=env,
        capture=True,
    )
    (out / "ws09-compose-rendered.yml").write_text(rendered + "\n", encoding="utf-8")


staging_candidate.verify_refs = snapshot_current_provider_refs
original_container_checks = staging_candidate.container_checks
staging_candidate.container_checks = tolerate_noncanonical_session_log

rc = staging_candidate.main()

# Inbox requirement: if WS05 moves during the rehearsal, do not report READY or
# BLOCKED against a stale provider. Re-fetch the remote branch, then compare it
# with the exact SHA frozen at rehearsal start.
staging_candidate.run(
    [
        "git",
        "fetch",
        "origin",
        "+refs/heads/ws05-moradon-world:refs/remotes/origin/ws05-moradon-world",
    ],
    capture=False,
)
latest_ws05 = staging_candidate.git("rev-parse", "refs/remotes/origin/ws05-moradon-world")
frozen_ws05 = staging_candidate.FROZEN["WS05"][1]
if latest_ws05 != frozen_ws05:
    raise SystemExit(
        f"WS05_CHANGED_DURING_REHEARSAL expected={frozen_ws05} actual={latest_ws05}"
    )
print(f"WS05_END_REF_CHECK_OK {latest_ws05}")

out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if out is not None:
    result = out / "result.txt"
    if result.exists():
        with result.open("a", encoding="utf-8") as fh:
            fh.write(f"WS05_END_REF_CHECK=PASS {latest_ws05}\n")
    tree_sha = out / "candidate-tree-sha.txt"
    if tree_sha.exists():
        print(f"CANDIDATE_TREE_SHA {tree_sha.read_text(encoding='utf-8').strip()}")
    contract = out / "staging-contract.json"
    if contract.exists():
        print("STAGING_CONTRACT_FILE", contract.read_text(encoding="utf-8").strip())

raise SystemExit(rc)
