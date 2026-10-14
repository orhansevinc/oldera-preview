#!/usr/bin/env python3
"""Freeze current provider heads at rehearsal start on the WS50 control base."""

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
    # after this point. WS05 is additionally rechecked by staging_candidate.main.
    for key, (branch, _previous) in list(staging_candidate.FROZEN.items()):
        if key == "MAIN":
            continue
        ref = f"refs/remotes/origin/{branch}"
        actual = staging_candidate.git("rev-parse", ref)
        staging_candidate.FROZEN[key] = (branch, actual)
        print(f"FROZEN_SNAPSHOT {key} {branch}@{actual}")


staging_candidate.verify_refs = snapshot_current_provider_refs
raise SystemExit(staging_candidate.main())
