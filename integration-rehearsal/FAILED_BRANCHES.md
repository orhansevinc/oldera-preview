# WS50 Failed / Blocked Branches

This file combines the disposable merge rehearsal with the WS40 planned-branch existence preflight.

- WS39 `ws39-contract-compatibility` — **test failure**: `git diff --check` reports a new blank line at EOF in `workstreams/ws39/COMPATIBILITY_ISSUES.md`.
- WS10 `ws10-qa-integration` — **missing commit**: missing `workstreams/ws10/STATUS.md`.
- WS35 `ws35-runtime-config` — **test failure**: trailing whitespace in `config/CONFIG_STANDARD.md` and `workstreams/ws35/STATUS.md`.
- WS29 `ws29-observability` — **test failure**: trailing whitespace in `observability/OBSERVABILITY_STANDARD.md`.
- WS14 `ws14-world-session` — **missing commit**: STATUS references a commit SHA that is not a verifiable ancestor.
- WS34 `ws34-character-rules` — **blocked dependency**: unready dependencies WS03, WS07, WS14, WS17.
- WS38 `ws38-client-content-pipeline` — **blocked dependency**: WS12 is not ready at WS38's planned integration position.
- WS07 `ws07-database` — **missing commit**: missing `workstreams/ws07/STATUS.md`.
- WS03 `ws03-ko1298-session` — **blocked dependency**: unready dependency WS14.
- WS06 `(branch absent)` — **missing commit**: WS40 explicitly lists WS06 in the merge plan and records no branch/STATUS/test evidence.
- WS05 `ws05-moradon-world` — **missing commit**: missing `workstreams/ws05/STATUS.md`.
- WS17 `ws17-item-inventory` — **test failure**: trailing whitespace in `workstreams/ws17/STATUS.md`.
- WS15 `ws15-movement-sync` — **blocked dependency**: unready dependency WS14.
- WS16 `ws16-npc-world` — **blocked dependency**: unready dependency WS14.
- WS33 `ws33-inn-storage` — **blocked dependency**: unready dependency WS07.
- WS22 `ws22-merchant-economy` — **blocked dependency**: unready dependencies WS16, WS17.
- WS23 `ws23-quest-events` — **blocked dependency**: unready dependencies WS16, WS17, WS22.
- WS19 `ws19-combat-core` — **missing commit**: STATUS references a commit SHA that is not a verifiable ancestor.
- WS08 `ws08-admin-api` — **blocked dependency**: unready dependency WS07.
- WS40 `ws40-release-readiness` — **missing commit**: STATUS references a commit SHA that is not a verifiable ancestor.
- WS41 `ws41-browser-input` — **test failure**: trailing whitespace in `workstreams/ws41/INTEGRATION_PATCH.md`.
- WS45 `ws45-session-ownership` — **blocked dependency**: unready dependencies WS03, WS07.

No workstream is classified as an actual Git merge conflict or stale branch in this snapshot.
