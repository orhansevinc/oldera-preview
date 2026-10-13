# WS40 Release Readiness Matrix

Snapshot: 2026-10-14 (Europe/Istanbul), refreshed after late parallel WS11/WS14/WS31/WS34/WS39 completion evidence appeared.  
Baseline: `main@a1c1d6b3e9aeb07fd066cee8a41714685557dddf`  
Scope: WS01-WS39, read-only assessment. No product branch was merged.

## Classification rules

- **Delivery COMPLETE** requires a workstream `STATUS.md` that states completion or an equivalent bounded completion state.
- Missing `STATUS.md` is **UNKNOWN** even when code or a green workflow exists.
- **Test PASS** requires explicit automated-test evidence; a completion claim alone is insufficient.
- **Integration PASS** means the capability is usable in the target release flow without a known unresolved handoff. **PARTIAL** means the isolated module is credible but composition/adapters are pending. **BLOCKED** means a known failure, missing required delivery, or breaking contract prevents release use.
- Branches that merely alias an older shared baseline are not treated as delivered work.
- A green compatibility-test suite means the registry is internally consistent; it does **not** mean the candidate has zero breaking contracts.

## Workstream matrix

| WS | Branch @ observed commit | Delivery | Test evidence | Integration | Key dependencies / blockers |
|---|---|---|---|---|---|
| WS01 | `ws01-runtime-build@5545df2273cda795055a611618c91b948063624f` | COMPLETE | PASS - real WASM Chromium/WebGL CI; run `38470465226` | PARTIAL | Canonical browser baseline must be integrated without importing unrelated legacy ancestry; nonfatal cursor/main-loop warnings remain. |
| WS02 | `ws02-websocket-gateway@1738f60945b24e00bdd2266e6600b5c0cf3c64cf` | COMPLETE | PASS - run `38470156727` | PARTIAL | Needs live WS01 -> WS02 -> WS03 proof with raw byte preservation. |
| WS03 | `ws03-ko1298-session@3a087ab1d98969ef531ac6e3f682f4a463222f5e` | COMPLETE within published scope | PASS - run `38474464804` | PARTIAL | Login/nation/version exist; WS34 create mapping and WS14 world handoff still require composition; WS39 reports both boundaries breaking in its captured registry. |
| WS04 | `ws04-character-client@fffbd9372b67c2aaef600f7e50595bec7e23fe88` | PARTIAL | **FAIL** - latest run `38474741103` | **BLOCKED** | Latest HEAD CI fails; WS10 also lacks successful character create/select proof. |
| WS05 | `ws05-moradon-world@18282d0e70de7ccb30244a9f09e2b3bff3040155` | **UNKNOWN** | UNKNOWN | **BLOCKED** | No `STATUS.md`, no `INTEGRATION_PATCH.md`, and branch remains the unchanged `openko-browser-port` baseline. |
| WS06 | branch not present | **UNKNOWN** | UNKNOWN | **BLOCKED** | Required asset audit/readiness evidence absent; browser asset path/case/content readiness not closed. |
| WS07 | `ws07-database@6e2585312702346dd98851bf97c9c008c51205a3` | **UNKNOWN** | PASS - PostgreSQL workflow run `38473458800` | **BLOCKED** | User rule: no STATUS => not completed. WS39 ISSUE-13 reports consumer adapter/method-shape conflicts; schema bounds also conflict with Inn-domain contracts. |
| WS08 | `ws08-admin-api@239cdacf0fb6bacde5017fb3b787451595a3be0d` | COMPLETE within scope | PASS - run `38470673396` | PARTIAL | Needs WS07 production adapter and WS28 execution bridge; WS39 ISSUE-12 reports no live bridge; Inn capacity statement conflicts with WS17/WS33. |
| WS09 | `ws09-production-infra@8aeeb566cfa98ebd24665b1c2dbe2b133c4bad1a` | COMPLETE scaffold | PASS - run `38470942134` | PARTIAL | Public cutover requires integrated immutable images, DNS/TLS, migrations, tested restore, manifest publication and smoke tests. |
| WS10 | `ws10-qa-integration@21f3a2636e2a0ae6b07c88b42169f18f438205ca` | **UNKNOWN** | **FAIL** - run `38472008679` | **BLOCKED** | No STATUS; QA BUG-001 says M12 character-selectable proof is absent and M13-M16 cannot be credited. |
| WS11 | `ws11-protocol-lab@05562662d9d3f13a4b0500d0478e065fd802cfd0` | COMPLETE | PASS - run `38476192478` | PASS as standalone evidence tooling | Pinned 1298 client provenance, framing/JvCryption boundary, fixtures and replay tooling are delivered; downstream contracts must consume the evidence. |
| WS12 | `ws12-browser-launcher@e21f84e481203130522964a45e133b84038d8e17` | COMPLETE | PASS - run `38473717974` | **BLOCKED** | WS39 ISSUE-14 reports launcher does not yet consume WS38 manifest/hash verification contract. |
| WS13 | `ws13-account-api@23ac239b26e0353bf2da6f9c9649710db58e3a9a` | COMPLETE | PASS - run `38473805499` | PARTIAL | Production repository/shared enforcement needs WS07; WS39 ISSUE-13 covers repository-shape incompatibility. |
| WS14 | `ws14-world-session@0f12a49eb72cb5e8f776193c0cce7feb7866e1cf` | COMPLETE | PASS - 14/14 and run `38475926954` | PARTIAL | Server world-session is green; WS03 selection handoff and WS15/16 provider contracts need fresh compatibility re-evaluation because WS39 audited before this branch existed. |
| WS15 | `ws15-movement-sync@ba44d65628a78f475b376a3996ff32b21ff1e1ab` | COMPLETE | PASS - run `38474313726` | PARTIAL | Must be routed only after WS14 world-ready; WS39 ISSUE-03 was breaking against the pre-WS14 snapshot and requires refresh. |
| WS16 | `ws16-npc-world@e6ee973eead1dbd40f5e7a5e2eb7bc5bd29235a2` | COMPLETE | PASS - run `38473929214` | **BLOCKED** | WS39 ISSUE-05/06 report missing merchant/quest range/action/offer contracts; WS14 terrain/opcode integration also needs refresh. |
| WS17 | `ws17-item-inventory@f557e91c79413960712aa621b0a034796d899c48` | COMPLETE | PASS - run `38473620771` | **BLOCKED** | WS39 ISSUE-07 reports no caller-supplied single transaction for economy; real item data and Inn geometry must be reconciled. |
| WS18 | `ws18-social-core@b865246463b3d373510d03e56d8fe6cac5141060` | COMPLETE | PASS - STATUS reports 19/19 automated tests | **BLOCKED** | WS39 ISSUE-15 reports no WS32 private-message policy hook in WS18. |
| WS19 | `ws19-combat-core@8a74d9e5b0f78deea4ad45fc991d145bbb70fe03` | COMPLETE framework | PASS - latest observed workflow success | **BLOCKED** | WS39 ISSUE-09 reports no public mob-target policy/canAggro contract; exact 1298 combat data/tuning also remains integration work. |
| WS20 | `ws20-reliability-security@2406af54eb549759403b54b20813dc499ef8f788` | PARTIAL | **FAIL** - latest observed workflow run `38474114826` failed on earlier branch head | **BLOCKED** | HIGH predictable admin signing fallback; graceful shutdown/trust-proxy issues; no release security sign-off. |
| WS21 | `ws21-clan-core@cbc1b649eb0e5210e713fbacac2601369a03682d` | COMPLETE | PASS - run `38474504958` | PARTIAL | WS07 persistence, WS18 clan chat, world/zone presence and protocol binding pending. |
| WS22 | `ws22-merchant-economy@0503d10f55df15a50d33b5d856516aead260a3e2` | COMPLETE | PASS - run `38474267083` | **BLOCKED** | WS39 ISSUE-05 and ISSUE-07 block authoritative merchant offer/range and single-transaction item+coin composition. |
| WS23 | `ws23-quest-events@6073b687bda3f1006a37cc97ee873c36a2d4e7a8` | COMPLETE | PASS - run `38474141502` | **BLOCKED** | WS39 ISSUE-06 reports missing verified action/range contract from WS16; persistence/progression adapters remain. |
| WS24 | `ws24-pvp-zone-rules@4c95200b7e7eafda5f893bd62034d3727dcb9cbc` | COMPLETE | PASS - run `38474611719` | PARTIAL | World must supply safe-area/zone state; integration with WS14/WS15/WS36 pending. |
| WS25 | `ws25-mob-ai@ff1804a7d7a1328727924c50be39792d2caa2483` | COMPLETE framework | PASS - STATUS reports deterministic tests | **BLOCKED** | WS39 ISSUE-10/11 report unstable death-event idempotency and no authoritative XP output; synthetic fixture must not ship. |
| WS26 | `ws26-drop-loot@24290da1c9cc2a0f0d40bf2e017cef2dcc8e0866` | COMPLETE framework | PASS - STATUS reports deterministic tests | **BLOCKED** | WS39 ISSUE-10 blocks stable mob-death event handoff; synthetic/non-authoritative drop data must not ship. |
| WS27 | `ws27-progression@9cd78a5c9eacee0cfa737e6123ba84f55e39ab27` | COMPLETE framework | PASS - STATUS reports 14 tests | **BLOCKED** | WS39 ISSUE-11 plus unresolved authoritative XP/max-level/reward/respawn formulas prevent production activation. |
| WS28 | `ws28-gm-command-bus@c1ef0f6e84456cb38edd2f3ce2b11ca5ff7de99a` | COMPLETE | PASS - STATUS reports automated tests | **BLOCKED** | WS39 ISSUE-12 reports WS08 outbox remains `PENDING_BRIDGE`; no live command execution path. |
| WS29 | `ws29-observability@d26f5af7aae0892576af5f35599a9d6076daf129` | COMPLETE package | PASS - STATUS reports 9/9 tests | PARTIAL | WS39 ISSUE-16 is non-breaking but confirms product services have not adopted logging/metrics/readiness/shutdown contract. |
| WS30 | `ws30-backup-recovery@4a80cf4c117af5a0c2fd6efde15655370a05a0fa` | COMPLETE | PASS - STATUS reports recovery tests | PARTIAL | Must rerun after finalized WS07 migration set; replace fixture-only rehearsal with candidate-schema restore proof. |
| WS31 | `ws31-data-catalog@a92ed73876be604273bc97e9d1faa68ac9cdc166` | COMPLETE | PASS - 11/11 + Actions run `38476656699` on validated implementation commit | PARTIAL | 134-entry catalog, 0 canonical collisions; two HIGH legacy resource-PID/entity-SID aliases must not leak into integration, and downstream synthetic/incomplete datasets still need replacement. |
| WS32 | `ws32-friends-messenger@26a260d41a2870d9b3dc0f454eda5661b59e80d3` | COMPLETE | PASS - run `38475465803` | PARTIAL | WS32 publishes the query port, but WS18 integration is breaking per WS39 ISSUE-15. |
| WS33 | `ws33-inn-storage@cfe305f23e0541de050adee7cd0f830811be5d50` | COMPLETE | PASS - run `38475654206` | **BLOCKED** | WS17 adapter itself is WS39-compatible (ISSUE-08 non-breaking), but 196-slot model conflicts with WS08's 192-slot claim and WS07's much wider schema bounds. |
| WS34 | `ws34-character-rules@ce87542f9c86245d29b1a73d5dd25fdae6028691` | COMPLETE | PASS - 15/15 and run `38476202415` | PARTIAL | Domain is ready; WS03 packet mapping, WS07 repository, WS14 spawn and WS17 starting-item adapters remain external. WS39 ISSUE-01 must be refreshed because it captured WS34 before this completion. |
| WS35 | `ws35-runtime-config@5327d50906d02c829add08cf1ca73fbe978526dc` | COMPLETE | PASS - run `38475522284` | PARTIAL | Existing services/infra must adopt `OLDKO_` typed config and secret-reference rules. |
| WS36 | `ws36-world-clock@adf25c055f50f26cbbc9ba81254307019ff5bcbd` | COMPLETE | PASS - run `38475673760` | PARTIAL | WS14/WS24/WS25 integration and persistence adapter pending. |
| WS37 | `ws37-rankings@7176882743fcacf540d41fd7b3a275e0cebe9611` | COMPLETE | PASS - run `38475329273` | PARTIAL | Concrete read-only WS07 repository/schema mapping required before public site use. |
| WS38 | `ws38-client-content-pipeline@5f323f3cf055ba7f96d928605a2f2faf84e609cb` | COMPLETE | PASS - run `38475828745` | PARTIAL | WS12 must consume manifest contract; WS39 ISSUE-14 captured WS38 before completion and must be refreshed, but WS12 adoption is still absent. |
| WS39 | `ws39-contract-compatibility@f23ef7ebf61f4fb8af419e9db1ea84c14c89a1d3` | COMPLETE | PASS - run `38476363518` | PARTIAL | Registry/tests are delivered and internally green, but report contains **14 breaking / 16 priority contracts**. Its own freshness note predates late WS14/WS31/WS34/WS38 advances, so compatibility must be regenerated/re-reviewed before integration. |

## Completion/readiness summary

- Strong isolated module evidence exists across most WS01-WS39 workstreams.
- Explicit latest/most-relevant failing workflow evidence remains for **WS04, WS10 and WS20**.
- Insufficient completion evidence under the user's strict rule now remains for only **WS05, WS06, WS07 and WS10**.
- WS11, WS31, WS34 and WS39 completed during the WS40 audit and were reclassified from UNKNOWN to completed based on their STATUS + test evidence.
- Root `BUGS.md` and root `COMPATIBILITY_ISSUES.md` are not present on `main`; actionable QA bugs are on WS10 and the compatibility register is now on WS39 (`workstreams/ws39/COMPATIBILITY_ISSUES.md`).
- WS39's compatibility suite is PASS as tooling while the product compatibility result is **14 breaking / 16 priority contracts**; those are not contradictory states.
- The highest end-to-end release gate that can be credited from available evidence remains **RC2**. RC3 and above remain blocked.
