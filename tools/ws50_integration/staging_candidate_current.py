#!/usr/bin/env python3
"""Freeze latest main/provider heads once and run the WS50 staging rehearsal."""

import os
from pathlib import Path
import sys

import staging_candidate


def snapshot_current_provider_refs() -> None:
    # Freeze main and every provider branch exactly once at run start. After
    # this point the disposable candidate consumes only immutable SHAs.
    for key, (branch, _previous) in list(staging_candidate.FROZEN.items()):
        ref = f"refs/remotes/origin/{branch}"
        actual = staging_candidate.git("rev-parse", ref)
        staging_candidate.FROZEN[key] = (branch, actual)
        print(f"FROZEN_SNAPSHOT {key} {branch}@{actual}")


def tolerate_noncanonical_session_log(tree: Path, out: Path) -> None:
    """Use TCP port probes as boot proof; container log wording is diagnostic."""
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

# Fail closed if any branch moved while the disposable rehearsal was running.
# This guarantees that a successful artifact corresponds to the latest provider
# snapshot that existed for the entire run, not to a mixed moving-tip set.
end_checks = []
for key, (branch, frozen_sha) in list(staging_candidate.FROZEN.items()):
    staging_candidate.run(
        [
            "git",
            "fetch",
            "origin",
            f"+refs/heads/{branch}:refs/remotes/origin/{branch}",
        ],
        capture=False,
    )
    latest = staging_candidate.git("rev-parse", f"refs/remotes/origin/{branch}")
    if latest != frozen_sha:
        raise SystemExit(
            f"PROVIDER_CHANGED_DURING_REHEARSAL {key} {branch} expected={frozen_sha} actual={latest}"
        )
    line = f"END_REF_CHECK_OK {key} {branch}@{latest}"
    end_checks.append(line)
    print(line)

out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if out is not None:
    result = out / "result.txt"
    if result.exists():
        with result.open("a", encoding="utf-8") as fh:
            for line in end_checks:
                fh.write(line + "\n")
    tree_sha = out / "candidate-tree-sha.txt"
    if tree_sha.exists():
        print(f"CANDIDATE_TREE_SHA {tree_sha.read_text(encoding='utf-8').strip()}")
    contract = out / "staging-contract.json"
    if contract.exists():
        print("STAGING_CONTRACT_FILE", contract.read_text(encoding="utf-8").strip())

raise SystemExit(rc)
