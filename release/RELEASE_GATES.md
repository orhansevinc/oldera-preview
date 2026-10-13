# WS40 Release Gates

Baseline assessed: `main@a1c1d6b3e9aeb07fd066cee8a41714685557dddf` plus read-only evidence from WS01-WS39 branches. The snapshot was refreshed after late WS11/WS14/WS31/WS34/WS39 closure evidence appeared.  
No merge was performed by WS40.

## Gate policy

A gate is **PASS** only when its user-visible/server-visible outcome has successful evidence. Passing isolated module tests does not automatically pass a release gate. A green contract-registry test means the registry is self-consistent; it does not mean the product has no breaking contracts. A later gate cannot be credited merely because its implementation modules exist when an earlier end-to-end prerequisite is blocked.

| Gate | Required acceptance evidence | Status | Evidence / reason |
|---|---|---|---|
| RC0 | Reproducible real browser package builds; real `KnightOnLine.js/.wasm/.data`; Chromium starts without fatal renderer/runtime error. | **PASS** | WS01 real WASM build + browser CI succeeded; package/runtime evidence is explicit. |
| RC1 | Real WASM reaches the authentic login scene, not a fake DOM/client scene. | **PASS** | WS01 Chromium evidence reaches `CGameProcedure`; no null renderer/fake scene accepted. |
| RC2 | Real login -> server list -> GAME version 1298 -> game login succeeds through the 1298 protocol path. | **PASS** | WS03 protocol CI passes; WS04/WS10 evidence reaches later nation/character scenes, which subsumes the RC2 path. WS11 protocol lab is now complete and green. |
| RC3 | Nation flow plus real Character Select/Create is functional end-to-end: create request, success, list refresh, occupied slot, select request/success. | **BLOCKED** | WS34 rules are now complete/green, but WS04 latest CI run `38474741103` fails, WS10 M12 has no selectable-character proof, and WS39 reports the WS03->WS34 handoff breaking in its captured registry. |
| RC4 | Character selection transitions to zone 21, real Moradon terrain is rendered, authoritative player spawn is visible. | **BLOCKED** | WS14 server world-session now passes, but WS05 has no delivery/STATUS, WS06 asset audit is absent, and WS10 M13-M15 cannot be credited. WS39's WS03->WS14/WS14->WS15/16 findings require refresh against the late WS14 branch. |
| RC5 | Live movement packets update/broadcast position and real NPCs spawn/select/interact in Moradon. | **BLOCKED** | WS15/WS16 isolated tests pass, but RC4 is blocked and WS39 still reports breaking world/NPC/merchant/quest boundaries pending a fresh compatibility pass. |
| RC6 | Account/character/world state survives restart and is served from the production DB adapter; QA persistence restart passes. | **BLOCKED** | WS07 has green PostgreSQL CI but no STATUS; WS39 ISSUE-13 reports consumer-adapter/method-shape conflicts; WS10 persistence milestone is not credited. |
| RC7 | Inventory/equipment/Inn/economy operations are persisted, atomic and contract-compatible. | **BLOCKED** | WS17/WS22/WS33 modules are individually strong, but WS39 ISSUE-07 blocks one-transaction economy composition, Inn capacity conflicts remain, and the production WS07 adapter is unresolved. |
| RC8 | Real mobs -> combat -> death -> loot -> XP/level/respawn works with authoritative 1298 data. | **BLOCKED** | WS31 catalog is now complete/green, but WS19/25/26/27 still expose synthetic/incomplete production data paths and WS39 ISSUE-09/10/11 report breaking combat/mob/loot/progression handoffs. |
| RC9 | Public deployment serves launcher/client/gateway/services over production DNS/TLS with immutable content, rollback and smoke proof. | **BLOCKED** | WS09 is infrastructure scaffold only; WS39 ISSUE-14 confirms WS12 does not yet consume WS38 manifest/hash verification; integrated images, DNS/TLS, migration/restore rehearsal and public smoke proof are absent. |
| RC10 | Admin operations, monitoring/readiness, backup/restore and security validation all pass on the release candidate. | **BLOCKED** | WS20 has a HIGH admin-signing finding and non-green workflow evidence; WS39 ISSUE-12 reports no live WS08<->WS28 bridge; WS29 adoption and WS30 final-schema restore proof are pending. |

## Mandatory blocker register

The following **17 blocker groups** must be closed or explicitly accepted by the control/integration owner before a public release candidate can advance through the affected gates.

| ID | Blocker | Gates affected | Closure evidence required |
|---|---|---|---|
| BLK-01 | WS04 branch HEAD CI fails and Character Create/Select success is not proven. | RC3+ | Green WS04 run on current HEAD plus real `0x02` create success/list refresh and `0x04` select success evidence. |
| BLK-02 | WS05 has no WS-specific delivery, STATUS or integration handoff; branch is only the old browser baseline. | RC4+ | Completed WS05 STATUS + tests proving real Moradon terrain after selected-character world entry. |
| BLK-03 | WS06 asset-audit branch/delivery is absent. | RC4, RC9 | Asset manifest/audit proving required Character/Moradon assets, path case correctness and package completeness. |
| BLK-04 | WS07 has green CI but no STATUS and no accepted production composition. | RC6+ | STATUS, finalized schema contract and real WS13/14/17/22/30 consumer adapters tested against PostgreSQL. |
| BLK-05 | WS10 latest end-to-end workflow fails; M12 character-selectable proof is absent, so M13-M16 are not credited. | RC3-RC6 and regression confidence thereafter | Completed WS10 STATUS and a green E2E milestone run through the gate being promoted. |
| BLK-06 | WS39's registry is internally green but its freshness note predates late WS14, WS31, WS34 and WS38 advances. Some `ACTUAL` descriptions are therefore stale by construction. | RC3-RC10 | Regenerate/re-review the compatibility registry against the exact frozen integration-candidate SHAs before using it as a release decision. |
| BLK-07 | WS39 currently reports **14 breaking / 16 priority contracts** (ISSUE-01..07, 09..15). These include character/world, movement/NPC, merchant/quest, inventory/economy, combat/mob/loot/progression, admin command, persistence, content and social handoffs. | RC3-RC10 | On the refreshed candidate, every breaking boundary must either become compatible with green producer/consumer contract tests or receive an explicit, documented release-blocking waiver from the integration owner. |
| BLK-08 | Inn contract disagreement: WS08 documents 192 slots; WS17/WS33 use 196 (WS33 7x28); WS07 schema permits much wider coordinates. | RC7, RC10 | One source-backed 1298 Inn geometry adopted by WS08/17/33 and enforced by WS07 repository tests. |
| BLK-09 | Authoritative data activation is incomplete despite WS31 completion. WS31 found two HIGH legacy PID/SID alias risks, while WS19/25/26/27 still document incomplete or synthetic skill/mob/drop/XP/respawn paths. | RC7-RC8 | Production adapters consume validated canonical IDs/data, synthetic fixtures are impossible in production config, the two PID/SID aliases cannot bind as entity IDs, and remaining formulas/tables have source provenance. |
| BLK-10 | WS20 release security/reliability line is not clean: HIGH predictable admin signing fallback and non-green workflow evidence. | RC9-RC10 | Remove predictable fallback, use WS35-backed explicit production secret material, fix reliability findings and rerun WS20 on the immutable candidate. |
| BLK-11 | WS29 observability contract is not adopted by production services. | RC9-RC10 | Integrated structured logs, metrics, liveness/readiness, redaction and graceful shutdown for every release service, followed by reliability validation. |
| BLK-12 | WS30 recovery proof is not yet against the finalized WS07 migration/candidate schema. | RC9-RC10 | Full backup -> integrity verify -> clean restore -> constraint/application smoke using the final release schema and candidate versions. |
| BLK-13 | WS28 command bus is not wired live through WS08 to real game/moderation adapters; WS39 ISSUE-12 confirms `PENDING_BRIDGE`. | RC10 | Admin request -> authenticated/authorized command bus -> game effect -> idempotent audited result E2E proof. |
| BLK-14 | WS12 launcher has not adopted the completed WS38 manifest/hash contract; CDN/origin publication is also not proven. | RC9 | WS38 content version/manifest is the launch source of truth; integrity is checked before launch; correct WASM MIME/cache/complete-marker/rollback-pointer behavior passes staging smoke. |
| BLK-15 | WS35 typed runtime config/secret contract is delivered but existing services/infra have not converged on it. | RC9-RC10 | Release services use one validated `OLDKO_` configuration model with explicit secret references and no conflicting silent defaults. |
| BLK-16 | No assembled candidate proves the core chain `WS03 -> WS34/WS14 -> WS15/16 -> WS07 persistence` as one coherent runtime with refreshed WS39 contracts. | RC3-RC8 | Dedicated integration candidate passes contract tests and WS10 milestones through character selection, world entry, movement/NPC and restart persistence. |
| BLK-17 | Public cutover itself is unproven: WS09 still lacks an exact integrated immutable candidate with DNS/TLS, migration, rollback and post-deploy smoke evidence. | RC9-RC10 | Staging/prod candidate deployment using frozen SHAs/images/content, migration+restore rehearsal, DNS/TLS checks, smoke tests and documented rollback target. |

## WS39 breaking-contract priority map

WS39's current report is a **captured compatibility assessment**, not the final truth after late parallel completions. Until refreshed, none of its 14 breaking findings can be silently cleared. Highest-priority boundaries by gate are:

- RC3: ISSUE-01 `WS03 -> WS34` character-create rules handoff.
- RC4/RC5: ISSUE-02 `WS03 -> WS14`, ISSUE-03 `WS14 -> WS15`, ISSUE-04 `WS14 -> WS16`.
- RC7: ISSUE-05 `WS16 -> WS22`, ISSUE-07 `WS17 -> WS22`.
- Quest readiness: ISSUE-06 `WS16 -> WS23`.
- RC8: ISSUE-09 `WS19 -> WS25`, ISSUE-10 `WS25 -> WS26`, ISSUE-11 `WS19/25 -> WS27`.
- RC10: ISSUE-12 `WS08 -> WS28`.
- RC6+: ISSUE-13 `WS07 -> WS03/08/13/17`.
- RC9: ISSUE-14 `WS12 -> WS38`.
- Social compatibility: ISSUE-15 `WS18 -> WS32`.

WS39 ISSUE-08 (`WS17 -> WS33`) and ISSUE-16 (WS29 adoption) are currently non-breaking in the registry; the latter still remains a production-readiness blocker under RC9/RC10 because adoption has not occurred.

## Gate progression rule

Current highest credited gate: **RC2**.

Do not promote RC3 until BLK-01, BLK-05, BLK-06 and the RC3 portion of BLK-07 are closed. Do not promote RC4 merely because WS14 is green: RC4 explicitly requires the client-side real Moradon terrain and spawn outcome, therefore BLK-02/03 also matter. RC9/RC10 require a fresh WS39 compatibility pass plus WS20/WS30/WS29/WS35 validation on the exact immutable candidate that is being deployed.
