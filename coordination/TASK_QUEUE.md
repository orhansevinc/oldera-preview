# OldKOWeb — Central Task Queue

Generated from WS50 integration rehearsal results.

## Priority 0 — Integration evidence repair

These workstreams must be repaired/revalidated before they can enter controlled integration:

- WS05 — missing `workstreams/ws05/STATUS.md`.
- WS06 — branch absent; recreate only if Ana Kontrol Hattı explicitly decides the workstream is still needed.
- WS07 — missing `workstreams/ws07/STATUS.md`.
- WS10 — missing `workstreams/ws10/STATUS.md`.
- WS14 — STATUS references a commit SHA that is not a verifiable ancestor of its branch; re-close with a valid branch-head commit and rerun tests.
- WS19 — STATUS references a commit SHA that is not a verifiable ancestor of its branch; re-close with a valid branch-head commit and rerun tests.
- WS40 — STATUS references a commit SHA that is not a verifiable ancestor of its branch; re-close with a valid branch-head commit and refresh readiness outputs.

## Priority 1 — Trivial test hygiene failures

Fix only the reported formatting/check failure, rerun checks, update STATUS, and do not expand scope:

- WS17 — trailing whitespace in `workstreams/ws17/STATUS.md`.
- WS29 — trailing whitespace in `observability/OBSERVABILITY_STANDARD.md`.
- WS35 — trailing whitespace in `config/CONFIG_STANDARD.md` and `workstreams/ws35/STATUS.md`.
- WS39 — extra blank line at EOF in `workstreams/ws39/COMPATIBILITY_ISSUES.md`.
- WS41 — trailing whitespace in `workstreams/ws41/INTEGRATION_PATCH.md`.

## Priority 2 — Dependency-unblock order

After Priority 0/1 evidence is valid, unblock in this order:

1. WS07 and WS14 become integration-ready.
2. Re-evaluate WS03, WS08, WS15, WS16, WS33, WS45.
3. Re-evaluate WS17.
4. Re-evaluate WS22.
5. Re-evaluate WS23.
6. Re-evaluate WS34.
7. Re-evaluate WS38 after WS12 is integrated in the planned order.

## Already cleanly integratable according to WS50

WS01, WS02, WS04, WS09, WS11, WS12, WS13, WS18, WS20, WS21, WS24, WS25, WS26, WS27, WS28, WS30, WS31, WS32, WS36, WS37, WS42, WS43, WS44, WS46, WS47, WS48, WS49.

## Safe integration batches from WS50

- Batch 1: WS01, WS31, WS13, WS30, WS37, WS12, WS02, WS24, WS36, WS18, WS32, WS21, WS25, WS26, WS27, WS28, WS20, WS09, WS44, WS46, WS47, WS48, WS49
- Batch 2: WS04
- Batch 3: WS11
- Batch 4: WS42
- Batch 5: WS43

## Execution rule

Do not merge to `main` from this file alone. Ana Kontrol Hattı decides when a repair or integration wave starts. Every resumed WS must read `coordination/MASTER_CONTROL.md`, `coordination/BROADCAST.md`, `coordination/WORKSTREAM_REGISTRY.md`, and this file before acting.
