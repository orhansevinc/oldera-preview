# WS40 Integration Conflicts

Assessment scope: WS01-WS39 against `main@a1c1d6b3e9aeb07fd066cee8a41714685557dddf`, refreshed after late WS11/WS14/WS31/WS34/WS39 closures.  
This report is advisory only. WS40 did not modify product code and did not merge/rebase any product branch.

## Severity legend

- **CRITICAL** - can invalidate a release gate or corrupt/lose state if integrated without resolution.
- **HIGH** - breaking contract or branch-history collision requiring an explicit integration decision.
- **MEDIUM** - integration/adoption mismatch that may wait behind earlier gates but must be resolved before release.
- **LOW** - nonfatal warning or low-risk tooling/docs overlap.

## Conflict register

| ID | Severity | Producers / consumers | Conflict | Release impact | Required resolution |
|---|---|---|---|---|---|
| C-01 | **CRITICAL** | WS08 / WS17 / WS33 / WS07 | **Inn capacity contract differs.** WS08 documents 192 slots (8x24); WS17/WS33 use 196, with WS33 explicitly 7x28; WS07 schema permits page `0..31` and slot `0..63`. | RC7, RC10 | Choose one source-backed 1298 Inn model, publish it through the compatibility registry, enforce identical API/domain bounds, and make WS07 reject every out-of-contract coordinate. |
| C-02 | **HIGH** | WS01 / WS04 vs `main` | **Browser branch ancestry is heavily divergent.** Both inherit the old `openko-browser-port` line, so a normal full-branch merge would carry a large unrelated historical diff into `main`. | RC0-RC4, merge safety | Do not whole-branch merge. Replay/cherry-pick only WS-owned commits/deltas onto an integration branch and manually review shared-file patches. |
| C-03 | **HIGH** | WS05 | `ws05-moradon-world` remains the old browser baseline with no STATUS or WS-specific integration handoff. Treating the branch name as a deliverable would import baseline history rather than a completed Moradon workstream. | RC4 | HOLD until real WS05 commits, STATUS, tests and integration handoff exist. |
| C-04 | **HIGH** | WS03 / WS04 / WS34 / WS14 | Character lifecycle ownership crosses services. WS34 is now COMPLETE/PASS, but WS03 packet mapping and the successful select->world handoff are still composition work. WS04 HEAD is red. | RC3-RC4 | Freeze `0x0C` list, `0x02` create and `0x04` select request/response ownership; map WS03->WS34 explicitly; allow only validated select into WS14; add refreshed WS39 contract tests and WS10 proof. |
| C-05 | **HIGH** | WS14 vs legacy assumptions | Verified 1298 GAMESTART is two phase: client `[0x0D,0x01]`, server `[0x0D]`, client `[0x0D,0x02]`. Legacy name-bearing GAMESTART framing is incompatible. | RC4-RC5 | Make WS14's verified 1298 packet shape canonical and reject legacy framing in integration tests. |
| C-06 | **HIGH** | WS39 registry vs late workstreams | WS39 tooling is COMPLETE/PASS and reports **14 breaking / 16 priority contracts**, but its own freshness note says WS14 was absent and WS34/WS38 had not advanced at audit time. The report is internally consistent but partially stale relative to the latest branches. | RC3-RC10 | Freeze current candidate SHAs and regenerate/re-review the registry before any breaking finding is cleared or any release gate is promoted. |
| C-07 | **HIGH** | WS03 -> WS34 | WS39 ISSUE-01 reports missing session-to-character-rules mapping / explicit create result. WS34 later completed, but WS03 still requires the adapter and the finding has not been refreshed. | RC3 | Implement in owning integration/product line, then re-run producer/consumer contract tests plus real create/list/select E2E. |
| C-08 | **HIGH** | WS03 -> WS14; WS14 -> WS15/WS16 | WS39 ISSUE-02/03/04 were breaking in the captured snapshot. WS14 later completed, so exact `ACTUAL` text is stale, but no refreshed compatibility proof exists. | RC4-RC5 | Re-evaluate against current WS14. Keep any still-missing selection handoff, world-position/zone-bounds, terrain-Y or opcode-dispatch boundary blocked until tests pass. |
| C-09 | **HIGH** | WS16 -> WS22 / WS23 | WS39 ISSUE-05/06 reports merchant contract lacks range/offer-price API and quest route lacks verified action/range fields. | RC7, quest correctness | Add authoritative interaction/range/offer/action contracts in owning workstreams and verify against actual NPC/session state. |
| C-10 | **HIGH** | WS17 -> WS22 | WS39 ISSUE-07 reports economy requires a caller-supplied single transaction while WS17 opens its own owner transaction; atomic coin+item trade cannot be assumed. | RC7 | Provide a compatible transaction boundary preserving serial authority and one atomic DB transaction. |
| C-11 | **HIGH** | WS19 -> WS25 -> WS26 / WS27 | WS39 ISSUE-09/10/11 reports no explicit mob-target policy, no stable death-event idempotency key and no authoritative XP output. | RC8 | Publish/implement compatible combat->mob, mob->loot and death->progression events before real reward flow is enabled. |
| C-12 | **HIGH** | WS08 -> WS28 | WS39 ISSUE-12 confirms admin commands remain `PENDING_BRIDGE`; there is no live canonical command execution path. | RC10 | Compose authorization -> canonical command -> idempotent execution -> audit result and test E2E. |
| C-13 | **HIGH** | WS07 -> WS03/08/13/17 | WS39 ISSUE-13 reports consumer-specific adapter/method-shape conflicts. WS07 CI is green but STATUS is still missing. | RC6-RC8, RC10 | Add/validate consumer adapters without breaking atomicity/auth storage; require WS07 STATUS and PostgreSQL integration proof. |
| C-14 | **HIGH** | WS12 -> WS38 | WS39 ISSUE-14 reports launcher uses required-file availability/cache busting rather than WS38 content manifest/hash integrity. WS38 later completed but WS12 adoption still has no proof. | RC9 | Make WS38 content manifest the launcher source of truth and verify integrity before launch. |
| C-15 | **HIGH** | WS18 -> WS32 | WS39 ISSUE-15 reports WS32 publishes a block query but WS18 private-message selection/delivery has no policy hook. | Social correctness | Route target selection and delivery authorization through WS32; block in either direction must deny delivery. |
| C-16 | **HIGH** | WS31 data -> legacy/product consumers | WS31 is now COMPLETE/PASS with 0 canonical collisions but reports two HIGH legacy resource-PID/entity-SID aliases. Separately, WS19/25/26/27 still advertise incomplete/synthetic production data paths. | RC7-RC8 | Consume canonical IDs only, prevent visual/resource PID use as entity SID, remove production fixture paths and source remaining formulas/tables. |
| C-17 | **HIGH** | WS20 / WS08 / WS35 | WS20 reports predictable admin session signing fallback as HIGH severity; latest relevant WS20 workflow evidence is not green. | RC9-RC10 | Require explicit production secret through WS35 contract, remove predictable fallback and rerun security/reliability on immutable candidate. |
| C-18 | **MEDIUM** | WS29 vs services | Common logging/metrics/readiness/shutdown package exists but services have not adopted it; WS39 ISSUE-16 correctly classifies this as non-breaking API-wise. | RC9-RC10 | Instrument all release services and validate readiness/shutdown semantics under WS20. |
| C-19 | **MEDIUM** | WS30 / WS07 | Backup/recovery tooling is green against its test setup but final release migrations/schema are not frozen. | RC9-RC10 | Rerun full backup -> integrity -> clean restore -> application/constraint smoke after schema freeze. |
| C-20 | **MEDIUM** | WS35 vs existing services/WS09 | Typed `OLDKO_` config/secret contract is delivered but independent services/infra still use their own assumptions/defaults. | RC9-RC10 | Converge on one validated config model; eliminate duplicate env names and production-sensitive silent defaults. |
| C-21 | **LOW** | WS01 browser runtime | Nonfatal main-loop warning and cursor path (`/data/ui/cursor.uif`) issue remain in evidence. | Cosmetic/diagnostic unless behavior regresses | Track in QA; promote only if interaction or runtime becomes fatal. |

## WS39 captured breaking-contract inventory

WS39 currently records 14 breaking contracts. Because late workstreams advanced after that audit, this list is a **must-refresh blocker set**, not an assertion that every `ACTUAL` field is still current:

| WS39 issue | Boundary | WS40 disposition |
|---|---|---|
| ISSUE-01 | WS03 -> WS34 | Still release-blocking until adapter + refreshed proof. |
| ISSUE-02 | WS03 -> WS14 | WS14 later completed; refresh required; handoff composition still unproven. |
| ISSUE-03 | WS14 -> WS15 | Refresh required against late WS14. |
| ISSUE-04 | WS14 -> WS16 | Refresh required against late WS14. |
| ISSUE-05 | WS16 -> WS22 | Breaking until range/offer contract is resolved. |
| ISSUE-06 | WS16 -> WS23 | Breaking until action/range contract is resolved. |
| ISSUE-07 | WS17 -> WS22 | Breaking transaction-boundary mismatch. |
| ISSUE-09 | WS19 -> WS25 | Breaking target-policy handoff. |
| ISSUE-10 | WS25 -> WS26 | Breaking death-event idempotency handoff. |
| ISSUE-11 | WS19/25 -> WS27 | Breaking authoritative XP/reward handoff. |
| ISSUE-12 | WS08 -> WS28 | Breaking live command bridge. |
| ISSUE-13 | WS07 -> WS03/08/13/17 | Breaking repository adapter shapes. |
| ISSUE-14 | WS12 -> WS38 | WS38 later completed; launcher adoption still unproven and refresh required. |
| ISSUE-15 | WS18 -> WS32 | Breaking private-message policy hook. |

WS39 ISSUE-08 (`WS17 -> WS33`) is non-breaking. ISSUE-16 (WS29 adoption) is also non-breaking at API level, though WS40 still requires observability adoption for RC9/RC10.

## Same-file / ownership collision analysis

### 1. Browser lineage: merge-level collision

`ws01-runtime-build` and `ws04-character-client` are not clean feature branches from the current `main`; they inherit a large `openko-browser-port` history. A direct branch-tip comparison against `main` therefore shows many overlapping files that are **not owned changes of the respective WS**. This is a history collision, not proof that both workstreams intentionally edited all those files.

Safe integration rule:

1. use `openko-browser-port` only as a temporary comparison base to isolate each WS-owned delta;
2. replay only commits/files that belong to declared workstream ownership;
3. manually apply documented shared-file patches onto the integration branch;
4. rebuild the real WASM package after each replay;
5. never resolve the conflict by accepting an entire side over the browser tree.

Known meaningful shared browser surface: WS01 modifies the browser bootstrap/entry surface (`openko-web/index.html`) in its own delta. WS04's own delta is predominantly character-client tooling/tests/workflow/docs; inherited browser files must not be mistaken for WS04-owned edits.

### 2. Branch alias that must not be merged as completed work

At the refreshed snapshot, `ws05-moradon-world` still equals the old `openko-browser-port@18282d0e70de7ccb30244a9f09e2b3bff3040155` baseline and has no STATUS. Earlier aliases WS11, WS31, WS34 and WS39 advanced during the audit and are no longer classified as empty workstreams.

### 3. Database ownership

WS07 owns schema/migrations among the assessed domain lines. WS17/21/22/33/37 expose repository contracts instead of changing migrations, which preserves ownership. The conflict is semantic: production adapters must map stricter domain contracts onto WS07 without allowing invalid state and must satisfy WS39 ISSUE-13.

### 4. Workflow files

Workstreams generally own distinct `.github/workflows/wsXX-*.yml`, so direct workflow-file conflict is low. The higher risk is treating green isolated CI as green integration. Refreshed WS39 compatibility and WS10 E2E are mandatory cross-workstream gates.

## Breaking contracts requiring explicit acceptance before integration

1. Character create/session-to-rules and select-to-world orchestration.
2. World -> movement/NPC handoffs after late WS14 refresh.
3. NPC -> merchant/quest interaction authority, range, offers and actions.
4. Item/economy transaction ownership.
5. Combat/mob/loot/progression target, death and reward events.
6. Admin API -> GM command bus live execution.
7. WS07 consumer repository adapters.
8. Launcher -> WS38 manifest/hash publication contract.
9. Social -> friends/block private-message authorization.
10. Inn storage geometry/capacity outside current WS39 ISSUE-08 payload compatibility.
11. Canonical data/resource identity and remaining source-backed gameplay formulas.
12. Runtime configuration/secrets and observability adoption for production.

## Conflict-resolution acceptance rule

A conflict is closed only when all of the following are true:

- one owner/source of truth is named;
- the contract is versioned/documented;
- producer and consumer automated tests agree on the frozen candidate SHAs;
- refreshed WS39 compatibility covers the boundary where applicable;
- WS10 or a targeted integration test proves the runtime/user-visible flow where applicable;
- rollback behavior for the integration wave is documented in `MERGE_ORDER.md`.

No conflict in this file authorizes WS40 to edit the owning product code.
