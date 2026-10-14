#!/usr/bin/env python3
"""Current frozen control baseline for the WS50 staging rehearsal."""

import staging_candidate

# WS50 was assigned at this main commit. Later main movement is allowed when this
# control baseline remains an ancestor; only the actual provider heads are frozen
# by exact equality for the staging candidate.
CONTROL_BASE = "3aeaaa3de81c8094b47de44f2c24f3c455e7fd3d"
staging_candidate.FROZEN["MAIN"] = ("control-base", CONTROL_BASE)


def verify_control_and_provider_refs() -> None:
    current_main = staging_candidate.git("rev-parse", "refs/remotes/origin/main")
    staging_candidate.run(
        ["git", "merge-base", "--is-ancestor", CONTROL_BASE, current_main],
        capture=False,
    )
    print(f"CONTROL_BASE_OK {CONTROL_BASE} current_main={current_main}")

    for key, (branch, expected) in staging_candidate.FROZEN.items():
        if key == "MAIN":
            continue
        ref = f"refs/remotes/origin/{branch}"
        actual = staging_candidate.git("rev-parse", ref)
        if actual != expected:
            raise SystemExit(
                f"FROZEN_REF_CHANGED {key} {branch} expected={expected} actual={actual}"
            )
        print(f"FROZEN_OK {key} {branch}@{actual}")


staging_candidate.verify_refs = verify_control_and_provider_refs
raise SystemExit(staging_candidate.main())
