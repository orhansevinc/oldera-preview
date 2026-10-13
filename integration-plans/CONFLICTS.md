# WS40 Integration Conflicts

Assessment scope: WS01-WS39 against `main@a1c1d6b3e9aeb07fd066cee8a41714685557dddf`.  
This report is advisory only. WS40 did not modify product code and did not merge/rebase any product branch.

## Severity legend

- **CRITICAL** - can make an end-to-end gate invalid or corrupt/lose state if integrated without resolution.
- **HIGH** - breaking contract or branch-history collision requiring an explicit integration decision.
- **MEDIUM** - integration/adoption mismatch that can safely wait behind earlier gates but must be resolved before release.
- **LOW** - documentation/tooling overlap or a nonfatal runtime warning.

## Conflict register

| ID | Severity | Producers / consumers | Conflict | Release impact | Required resolution |
|---|---|---|---|---|---|
| C-01 | **CRITICAL** | WS08 / WS17 / WS33 / WS07 | **Inn capacity contract differs.** WS08 documents 192 slots (8x24); WS17/WS33 use 196, with WS33 explicitly 7x28; WS07 schema permits page `0..31` and slot `0..63`. | RC7, RC10 | Choose one source-backed 1298 Inn model, publish it through WS39, enforce identical API/domain bounds, and make the WS07 repository adapter reject every out-of-contract coordinate. |
| C-02 | **HIGH** | WS01 / WS04 vs `main` | **Browser branch ancestry is heavily divergent.** Both workstreams inherit the old `openko-browser-port` line, so a normal full-branch merge would carry a large unrelated historical diff into `main`. | RC0-RC4, merge safety | Do not whole-branch merge. Replay/cherry-pick only WS-owned commits/deltas onto an integration branch and manually review documented shared-file patches. Preserve a known-good immutable browser package for rollback. |
| C-03 | **HIGH** | WS05 / WS11 | These branch tips equal the old `openko-browser-port` baseline and contain no WS-specific completion evidence. Treating the branches as deliverables would accidentally import the baseline rather than a finished workstream. | RC4; protocol confidence | Keep on HOLD. Require real WS-owned commits, STATUS, tests and integration handoff before any merge consideration. |
| C-04 | **HIGH** | WS03 / WS04 / WS34 / WS14 | Character lifecycle ownership crosses services: WS04 emits/consumes `0x0C` list, `0x02` create and `0x04` select; WS03 authenticates/validates; WS34 is intended to own creation rules; WS14 owns successful selected-character world initialization. WS34 lacks completion evidence. | RC3-RC4 | Freeze request/response schemas and ownership in WS39. WS03 must validate account/session and delegate create rules to WS34; only validated selection may enter WS14. Add contract tests spanning all four boundaries. |
| C-05 | **HIGH** | WS14 vs legacy assumptions/integration code | Verified 1298 GAMESTART is two phase: client `[0x0D,0x01]`, server `[0x0D]`, client `[0x0D,0x02]`. Legacy name-bearing GAMESTART framing is incompatible. | RC4-RC5 | Make the WS14 1298 packet shape canonical in WS39 and reject legacy framing in integration tests. Do not add compatibility translation that hides a wrong protocol version. |
| C-06 | **HIGH** | WS03 / WS11 / WS39 | `_CRYPTION` / encryption-handshake behavior still lacks a completed protocol-lab/central contract decision. WS11 and WS39 are not delivered. | RC2-RC5, interoperability | Pin source/packet evidence, publish one versioned protocol contract and test raw gateway byte preservation plus handshake behavior before release. |
| C-07 | **HIGH** | WS07 / WS27 / WS31 | WS07 schema hard-checks level `1..83`, while WS27 explicitly says authoritative max-level/XP/reward behavior still needs source validation and WS31 is not delivered. | RC6-RC8 | Validate the 1298 level cap/table through WS31 before accepting the DB constraint as authoritative. If different, change via an owned future migration/integration decision, not WS40. |
| C-08 | **HIGH** | WS17 / WS19 / WS25 / WS26 / WS27 / WS31 | Gameplay services can run with fixtures or incomplete tables, but authoritative 1298 item, skill, mob, drop, XP and respawn data is not centrally validated because WS31 is absent. | RC7-RC8 | Block production adapters from fixture data; require WS31 provenance/cross-reference validation and WS39 contract coverage before activation. |
| C-09 | **HIGH** | WS04 / WS10 | WS04 latest HEAD workflow fails; WS10 E2E also fails at/after M12 character-selectable proof. Independent failures agree that Character Create/Select is not release-ready. | RC3+ | Repair in owning workstreams, obtain green HEAD workflows and rerun WS10 M12 before integrating later world features. |
| C-10 | **HIGH** | WS20 / WS08 | WS20 reports predictable admin session signing fallback as HIGH severity; latest WS20 workflow is not green. | RC9-RC10 | Remove predictable fallback, require explicit production secret material through WS35 contract, then rerun security/reliability tests on the immutable candidate. |
| C-11 | **MEDIUM** | WS12 / WS38 / WS09 | WS38 defines immutable manifest/integrity/CDN publication, while WS12 and production infra have not yet adopted that contract. | RC9 | Make WS38 manifest the launcher/publisher source of truth; verify MIME/cache/complete-marker/rollback-pointer behavior in staging before DNS cutover. |
| C-12 | **MEDIUM** | WS35 vs existing services/WS09 | Central `OLDKO_` typed config/secret contract is additive; existing services and infra were built independently and do not yet all consume it. | RC9-RC10 | Create integration-layer adapters/config mapping; eliminate duplicate env names and literal production secrets. No service may silently use a conflicting default. |
| C-13 | **MEDIUM** | WS29 vs existing services/WS20 | Common structured logging, metrics, readiness and shutdown contracts exist but product services have not adopted them. | RC9-RC10 | Instrument all release services, then run WS20 reliability tests against the same readiness/shutdown semantics. |
| C-14 | **MEDIUM** | WS28 / WS08 | Admin API and command bus are separately green but there is no production command mapping/execution path proving authorization -> command -> game effect -> audit. | RC10 | Compose through a narrow adapter, preserve idempotency/audit IDs, and add E2E tests before enabling mutating admin commands. |
| C-15 | **MEDIUM** | WS30 / WS07 | Backup/recovery tooling is green against its test setup but the finalized release migration/schema set is not frozen. | RC9-RC10 | Rerun full backup -> integrity -> clean restore -> constraint/application smoke after final WS07/integration migrations are frozen. |
| C-16 | **MEDIUM** | WS18 / WS32 | WS32 exposes friend/block relationship rules intended to constrain WS18 private messaging, but the adapter is not composed. | Social correctness; later release hardening | Route private-message authorization through WS32 relationship query and contract-test block/unblock plus online/offline transitions. |
| C-17 | **MEDIUM** | WS14 / WS15 / WS16 / WS24 / WS36 | World, movement, NPC, zone rules and clock are separately tested but no assembled router/lifecycle proves consistent world-ready ordering and shared authoritative state. | RC5+ | Compose only after WS14 reaches `WORLD_READY`; route opcode ownership explicitly; test movement/NPC/time/weather/zone state on one session lifecycle. |
| C-18 | **LOW** | WS01 browser runtime | Nonfatal main-loop warning and cursor path (`/data/ui/cursor.uif`) issue remain in evidence. | Cosmetic/diagnostic, unless behavior regresses | Track in QA; do not elevate to release blocker unless it becomes fatal or affects required interaction. |

## Same-file / ownership collision analysis

### 1. Browser lineage: merge-level collision

`ws01-runtime-build` and `ws04-character-client` are not clean feature branches from the current `main`; they inherit a large `openko-browser-port` history. Therefore a comparison of each branch tip directly against `main` produces many overlapping files that are **not owned changes of the respective WS**. This is a history collision, not proof that both workstreams intentionally edited all those files.

Safe integration rule:

1. use `openko-browser-port` as the temporary comparison base only to isolate each WS-owned delta;
2. replay only the commits/files that belong to the workstream's declared ownership;
3. manually apply any documented shared-file patch (for example browser entry/config changes) onto the integration branch;
4. build the real WASM package again after each replay;
5. never resolve the conflict by accepting an entire side (`ours`/`theirs`) over the browser tree.

Known meaningful shared browser surface: WS01 modifies the browser bootstrap/entry surface (`openko-web/index.html`) in its own delta. WS04's own delta is predominantly character-client tooling/tests/workflow/docs; inherited browser files must not be mistaken for WS04-owned edits.

### 2. Branch aliases that must not be merged as completed work

At the snapshot:

- `ws05-moradon-world` == `openko-browser-port@18282d0e70de7ccb30244a9f09e2b3bff3040155`
- `ws11-protocol-lab` == the same old baseline
- `ws31-data-catalog` == `main@a1c1d6b3e9aeb07fd066cee8a41714685557dddf`
- `ws39-contract-compatibility` == `main@a1c1d6b3e9aeb07fd066cee8a41714685557dddf`

These names do not represent mergeable completed deltas at this snapshot.

### 3. Database ownership

Only WS07 owns schema/migrations among the assessed domain lines. WS17/21/22/33/37 deliberately expose repository contracts instead of changing migrations. That is the correct ownership boundary. The conflict is therefore **semantic**: production adapters must map stricter domain bounds onto the broader WS07 schema without allowing invalid states.

### 4. Workflow files

Each workstream generally owns a distinct `.github/workflows/wsXX-*.yml`; these are low direct-conflict risk. The higher risk is aggregate CI cost/order and assuming a green isolated workflow equals green integration. WS39 compatibility and WS10 E2E must act as cross-workstream gates after composition.

## Breaking contracts requiring explicit acceptance before integration

1. **Inn storage geometry/capacity** - unresolved; blocking.
2. **Character Create/Select orchestration ownership** - unresolved until WS34/WS39 complete and WS04 turns green.
3. **1298 GAMESTART packet shape** - WS14's verified two-phase framing must supersede legacy assumptions.
4. **Protocol crypto/handshake choice** - unresolved central evidence while WS11/WS39 are absent.
5. **Level cap/XP schema assumptions** - cannot be treated authoritative until WS31 validates data.
6. **Client content publication contract** - WS38 exists but WS12/WS09 adoption is pending.
7. **Runtime configuration/secrets** - WS35 exists but consumers must converge on one naming/validation contract.
8. **Observability/readiness semantics** - WS29 exists but adoption must precede WS20/production sign-off.

## Conflict-resolution acceptance rule

A conflict is considered closed only when all of the following are true:

- one owner/source of truth is named;
- the contract is versioned/documented;
- producer and consumer automated tests agree;
- WS39 compatibility tests cover the boundary when WS39 is available;
- WS10 or a targeted integration test proves the user-visible/runtime flow where applicable;
- rollback behavior for the integration wave is documented in `MERGE_ORDER.md`.

No conflict in this file authorizes WS40 to edit the owning product code.
