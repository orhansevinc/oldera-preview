# WS40 Release Gates

Baseline assessed: `main@a1c1d6b3e9aeb07fd066cee8a41714685557dddf` plus read-only evidence from WS01-WS39 branches.  
No merge was performed by WS40.

## Gate policy

A gate is **PASS** only when its user-visible/server-visible outcome has successful evidence. Passing isolated module tests does not automatically pass a release gate. A later gate cannot be credited merely because its implementation modules exist when an earlier end-to-end prerequisite is blocked.

| Gate | Required acceptance evidence | Status | Evidence / reason |
|---|---|---|---|
| RC0 | Reproducible real browser package builds; real `KnightOnLine.js/.wasm/.data`; Chromium starts without fatal renderer/runtime error. | **PASS** | WS01 real WASM build + browser CI succeeded; package/runtime evidence is explicit. |
| RC1 | Real WASM reaches the authentic login scene, not a fake DOM/client scene. | **PASS** | WS01 Chromium evidence reaches `CGameProcedure`; no null renderer/fake scene accepted. |
| RC2 | Real login -> server list -> GAME version 1298 -> game login succeeds through the 1298 protocol path. | **PASS** | WS03 protocol CI passes; WS04/WS10 evidence reaches later nation/character scenes, which subsumes the RC2 path. |
| RC3 | Nation flow plus real Character Select/Create is functional end-to-end: create request, success, list refresh, occupied slot, select request/success. | **BLOCKED** | WS04 latest CI run `38474741103` fails; WS10 BUG-001/M12 has no selectable-character proof; WS34 lacks STATUS. |
| RC4 | Character selection transitions to zone 21, real Moradon terrain is rendered, authoritative player spawn is visible. | **BLOCKED** | WS14 server world-session now passes, but WS05 has no delivery/STATUS, WS06 asset audit is absent, and WS10 M13-M15 cannot be credited. |
| RC5 | Live movement packets update/broadcast position and real NPCs spawn/select/interact in Moradon. | **BLOCKED** | WS15/WS16 isolated tests pass, but RC4 and WS14 composition into the live session/router are not proven. |
| RC6 | Account/character/world state survives restart and is served from the production DB adapter; QA persistence restart passes. | **BLOCKED** | WS07 has green PostgreSQL CI but no STATUS; production adapters are not composed; WS10 persistence milestone is not credited. |
| RC7 | Inventory/equipment/Inn/economy operations are persisted, atomic and contract-compatible. | **BLOCKED** | WS17/WS22/WS33 are strong modules, but Inn capacity conflicts (192 vs 196 vs wider DB bounds), real item data and WS07 adapters are unresolved. |
| RC8 | Real mobs -> combat -> death -> loot -> XP/level/respawn works with authoritative 1298 data. | **BLOCKED** | WS19/25/26/27 frameworks exist, but WS31 data catalog is not delivered; synthetic mob/drop fixtures and unverified XP/skill/respawn data cannot ship. |
| RC9 | Public deployment serves launcher/client/gateway/services over production DNS/TLS with immutable content, rollback and smoke proof. | **BLOCKED** | WS09 is infrastructure scaffold only; WS12/WS38 publication contract is not composed; integrated images, DNS/TLS, migration/restore rehearsal and public smoke proof are absent. |
| RC10 | Admin operations, monitoring/readiness, backup/restore and security validation all pass on the release candidate. | **BLOCKED** | WS20 has a HIGH admin-signing finding and failing workflow; WS28<->WS08 execution is not wired; WS29 adoption and WS30 final-schema restore proof are pending. |

## Mandatory blocker register

The following **17 blockers** must be closed or explicitly waived by the control/integration owner before a public release candidate can advance beyond the indicated boundaries.

| ID | Blocker | Gates affected | Closure evidence required |
|---|---|---|---|
| BLK-01 | WS04 branch HEAD CI fails and character create/select success is not proven. | RC3+ | Green WS04 run on HEAD plus real `0x02` create success/list refresh and `0x04` select success evidence. |
| BLK-02 | WS05 has no WS-specific delivery, STATUS or integration handoff; branch is only the old browser baseline. | RC4+ | Completed WS05 STATUS + tests proving real Moradon terrain after selected-character world entry. |
| BLK-03 | WS06 asset-audit branch/delivery is absent. | RC4, RC9 | Asset manifest/audit proving required Character/Moradon assets, path case correctness and package completeness. |
| BLK-04 | WS07 has green CI but no STATUS and no accepted production composition. | RC6+ | STATUS, finalized schema contract and real WS13/14/17/22/30 adapters tested against PostgreSQL. |
| BLK-05 | WS10 latest end-to-end workflow fails; M12 blocks M13-M16. | RC3-RC6 and regression confidence thereafter | Green E2E milestone run through at least M16, then persistence/admin milestones as gates advance. |
| BLK-06 | WS11 protocol lab has no WS-specific commit/STATUS; unresolved protocol decisions remain (`_CRYPTION`, packet ownership evidence). | RC2-RC5, RC10 contract safety | Protocol evidence/STATUS or explicit source-backed decisions incorporated into WS39 contracts. |
| BLK-07 | WS31 data catalog branch equals main; no STATUS/validation report. | RC7-RC8 | Versioned real-1298 catalog + automated cross-reference report for item/NPC/mob/drop/skill/XP/zone IDs. |
| BLK-08 | WS34 has branch work but no STATUS/test evidence. | RC3+ | STATUS + CI evidence for server-side character creation/identity rules and WS03/WS04 contract handoff. |
| BLK-09 | WS39 contract registry/tests are not delivered; branch equals main. | RC3-RC10 | Contract registry, version/ownership rules and green compatibility tests, especially WS03->WS34, WS17->WS33, WS18->WS32, WS12->WS38. |
| BLK-10 | Inn contract disagreement: WS08 documents 192 slots; WS17/WS33 use 196 (7x28); WS07 schema permits 32x64 coordinates. | RC7, RC10 | One authoritative 1298 Inn contract adopted by WS08/17/33 and enforced by WS07 adapter/tests. |
| BLK-11 | Authoritative gameplay datasets/formulas are still missing from production paths (mob/drop/skill/XP/respawn/item tables). | RC7-RC8 | WS31-validated sources wired into WS17/19/25/26/27; synthetic fixtures prohibited in production config. |
| BLK-12 | WS20 security/reliability line is not release-clean: HIGH predictable admin signing fallback; latest workflow failure. | RC10, also RC9 go-live approval | Remove predictable fallback, fix CI, validate graceful shutdown/proxy assumptions and rerun security suite. |
| BLK-13 | WS29 observability contract is not adopted by production services. | RC9-RC10 | Integrated structured logs, metrics, liveness/readiness, redaction and graceful shutdown for release services. |
| BLK-14 | WS30 recovery proof is not yet against the finalized WS07 migration/candidate schema. | RC10, RC9 go-live safety | Full backup -> integrity verify -> clean restore -> constraint/application smoke using final release schema. |
| BLK-15 | WS28 command bus is not wired to WS08 and real game/moderation adapters. | RC10 | Admin command request -> authorized command bus -> game effect -> audit result E2E proof. |
| BLK-16 | Public publication stack is incomplete: WS09 cutover prerequisites plus WS12<->WS38 manifest/CDN adoption are not proven. | RC9 | Immutable content version, correct WASM MIME/cache, signed/pinned manifest policy, TLS/DNS, rollback pointer and live smoke. |
| BLK-17 | No assembled release-candidate composition has yet proven WS03 -> WS14 -> WS15/16 plus persistence routing as one process/system. | RC4-RC8 | Dedicated integration candidate with contract tests and WS10 green milestones through world, movement/NPC and persistence. |

## Gate progression rule

Current highest credited gate: **RC2**.

Do not promote RC3 until BLK-01, BLK-05, BLK-08 and the applicable character contracts from BLK-09 are closed. Do not promote RC4 merely because WS14 is green: RC4 explicitly requires the client-side real Moradon terrain and spawn outcome. RC9/RC10 require a fresh security/recovery/observability pass on the exact immutable candidate that is being deployed.
