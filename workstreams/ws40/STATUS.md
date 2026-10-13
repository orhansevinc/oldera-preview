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
- Closure validation: **PENDING final WS40 readiness workflow on final HEAD**

## Delivered

- `release/READINESS_MATRIX.md`
- `release/RELEASE_GATES.md`
- `integration-plans/MERGE_ORDER.md`
- `integration-plans/DEPENDENCY_GRAPH.md`
- `integration-plans/CONFLICTS.md`
- `workstreams/ws40/STATUS.md`
- `.github/workflows/ws40-readiness.yml`

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

WS40 did not treat a branch as completed merely because it existed. A missing `STATUS.md` remained incomplete/unknown even when code or a green workflow existed. Isolated module success was separated from release-gate success. Latest observed failing workflows were retained as blockers instead of being overridden by older local claims.

The audit was refreshed while parallel work continued. WS11, WS14, WS31, WS34 and WS39 advanced and their new STATUS/test evidence was incorporated before closure. At the final refreshed assessment, insufficient completion evidence remained only for **WS05, WS06, WS07 and WS10**. Relevant failing/non-green evidence remained for **WS04, WS10 and WS20**.

## Important refreshed findings

- WS11 protocol lab: COMPLETE/PASS; source-pinned framing/JvCryption evidence is available.
- WS14 world session: COMPLETE/PASS; 1298 selected-character world bootstrap is available server-side.
- WS31 data catalog: COMPLETE/PASS; 134 catalog records, 0 canonical collisions, 2 HIGH legacy PID/SID alias risks.
- WS34 character rules: COMPLETE/PASS; 15/15 and green Actions, but WS03/repository/world/item adapters remain external.
- WS39 contract compatibility: COMPLETE/PASS as tooling; current report is **14 breaking / 16 priority contracts**.
- WS39's own freshness note predates late WS14/WS31/WS34/WS38 advances, so the compatibility report must be regenerated/re-reviewed against frozen integration SHAs before release decisions.

## Dominant release blockers

The canonical 17 blocker groups are in `release/RELEASE_GATES.md`. Dominant groups are:

- WS04 Character Create/Select CI failure and WS10 M12 E2E failure.
- Missing WS05 Moradon client delivery and WS06 asset audit.
- WS07 completion/production adapter gap despite green PostgreSQL CI.
- WS39 freshness requirement plus 14 reported breaking cross-service contracts.
- Inn storage geometry conflict: 192 vs 196 vs much wider DB coordinate bounds.
- Canonical data activation gaps: WS31 is green, but two HIGH legacy ID aliases and synthetic/incomplete downstream gameplay data/formulas remain.
- WS20 HIGH admin-signing fallback and non-green reliability/security evidence.
- WS29 observability, WS35 runtime config, WS38 manifest and WS30 final-schema recovery are not yet adopted/validated as one production candidate.
- No single assembled candidate yet proves character -> world -> movement/NPC -> persistence with refreshed contracts.

## Integration policy

The merge order is a plan for an external control/integration owner. WS40 explicitly does **not** authorize direct merging to `main`. Browser-line branches with divergent `openko-browser-port` ancestry must be replayed as narrow WS-owned deltas rather than whole-branch merges. Database changes require backup/restore-aware rollback treatment, and every integration wave has an acceptance checkpoint.

## Closure validation

`.github/workflows/ws40-readiness.yml` validates:

- all required WS40 deliverables exist;
- WS01-WS39 are represented in the readiness and merge-order documents;
- RC0-RC10 have only allowed gate states;
- the blocker register contains exactly 17 unique blocker groups;
- `workstreams/ws40/STATUS.md` is marked TAMAMLANDI and reports the same blocker count;
- only WS40-owned paths differ from the captured `main` baseline.

The final closure response must use a green WS40 readiness workflow result on the final branch HEAD. No product merge is part of closure.
