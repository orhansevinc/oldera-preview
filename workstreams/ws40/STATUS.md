WS40

# Release Readiness / Integration Planning Status

- Workstream: **WS40**
- Branch: `ws40-release-readiness`
- Base: `main@a1c1d6b3e9aeb07fd066cee8a41714685557dddf`
- Scope: WS01-WS39 release-readiness and controlled integration planning only
- State: **TAMAMLANDI**
- Product merges performed: **NONE**
- Product code changed: **NONE**
- Main changed by WS40: **NO**
- Closure validation: **PENDING WS40 readiness workflow**

## Delivered

- `release/READINESS_MATRIX.md`
- `release/RELEASE_GATES.md`
- `integration-plans/MERGE_ORDER.md`
- `integration-plans/DEPENDENCY_GRAPH.md`
- `integration-plans/CONFLICTS.md`
- `workstreams/ws40/STATUS.md`
- `.github/workflows/ws40-readiness.yml` (closure validation)

## Assessment result

- Highest credited release gate: **RC2**
- RC0: **PASS**
- RC1: **PASS**
- RC2: **PASS**
- RC3: **BLOCKED**
- RC4: **BLOCKED**
- RC5: **BLOCKED**
- RC6: **BLOCKED**
- RC7: **BLOCKED**
- RC8: **BLOCKED**
- RC9: **BLOCKED**
- RC10: **BLOCKED**
- Mandatory blocker count: **17**
- Controlled integration order ready: **EVET**

## Strict evidence policy applied

WS40 did not treat a branch as completed merely because it existed. A missing `STATUS.md` remained incomplete/unknown even when code or a workflow existed. Isolated module success was separated from release-gate success. Latest observed failing workflows were retained as blockers instead of being overridden by older local success claims.

At the assessment snapshot, insufficient completion evidence remained for WS05, WS06, WS07, WS10, WS11, WS31, WS34 and WS39. WS04, WS10 and WS20 also had failing latest workflow evidence relevant to release gating.

## Key release blockers

The detailed register is in `release/RELEASE_GATES.md`. The dominant blocker groups are:

- Character Create/Select end-to-end failure and missing WS34/WS39 closure evidence.
- Missing WS05/WS06 Moradon client/asset readiness proof.
- WS07 completion/composition evidence gap despite green PostgreSQL CI.
- Missing WS31 authoritative 1298 data catalog/validation.
- Inn storage contract conflict (192 vs 196 vs broader DB coordinate bounds).
- WS20 HIGH admin signing fallback and non-green reliability/security evidence.
- Production adoption gaps for WS29 observability, WS35 config, WS38 content publication and WS30 final-schema restore rehearsal.
- No single assembled candidate yet proves WS03 -> WS14 -> WS15/16 plus persistence as an integrated flow.

## Integration policy

The merge order is a plan for an external control/integration owner. WS40 explicitly does **not** authorize direct merging to `main`. Browser-line branches with divergent `openko-browser-port` ancestry must be replayed as narrow WS-owned deltas rather than whole-branch merges. Database changes require backup/restore-aware rollback treatment, and every integration wave has an acceptance checkpoint.

## Closure validation

`.github/workflows/ws40-readiness.yml` validates:

- all required WS40 deliverables exist;
- WS01-WS39 are represented in the readiness and merge-order documents;
- RC0-RC10 have only allowed gate states;
- the blocker register contains exactly 17 unique blockers;
- only WS40-owned paths differ from the captured `main` baseline.

The final closure response must use the green workflow result on the final branch HEAD. No product merge is part of closure.
