# WS40 Release Readiness Matrix

Snapshot: 2026-10-14 (Europe/Istanbul)  
Baseline: `main@a1c1d6b3e9aeb07fd066cee8a41714685557dddf`  
Scope: WS01-WS39, read-only assessment. No product branch was merged.

## Classification rules

- **Delivery COMPLETE** requires a workstream `STATUS.md` that states completion or an equivalent bounded completion state.
- Missing `STATUS.md` is **UNKNOWN** even when code or a green workflow exists.
- **Test PASS** requires explicit automated-test evidence; a completion claim alone is insufficient.
- **Integration PASS** means the capability is usable in the target release flow without a known unresolved handoff. **PARTIAL** means the isolated module is credible but composition/adapters are pending. **BLOCKED** means a known failure, missing required delivery, or breaking contract prevents release use.
- Branches still equal to `main` or to an older shared baseline are not treated as delivered work.

## Workstream matrix

| WS | Branch @ observed commit | Delivery | Test evidence | Integration | Key dependencies / blockers |
|---|---|---|---|---|---|
| WS01 | `ws01-runtime-build@5545df2273cda795055a611618c91b948063624f` | COMPLETE | PASS - real WASM Chromium/WebGL CI; run `38470465226` | PARTIAL | Canonical browser baseline must be integrated without importing unrelated legacy ancestry; nonfatal cursor/main-loop warnings remain. |
| WS02 | `ws02-websocket-gateway@1738f60945b24e00bdd2266e6600b5c0cf3c64cf` | COMPLETE | PASS - run `38470156727` | PARTIAL | Needs live WS01 -> WS02 -> WS03 proof with raw byte preservation. |
| WS03 | `ws03-ko1298-session@3a087ab1d98969ef531ac6e3f682f4a463222f5e` | COMPLETE within published scope | PASS - run `38474464804` | PARTIAL | Login/nation/version exist; character/world orchestration and live WASM path still need integration; `_CRYPTION` decision remains a protocol risk. |
| WS04 | `ws04-character-client@fffbd9372b67c2aaef600f7e50595bec7e23fe88` | PARTIAL | **FAIL** - latest run `38474741103` | **BLOCKED** | Latest HEAD CI fails; WS10 also lacks successful character create/select proof. |
| WS05 | `ws05-moradon-world@18282d0e70de7ccb30244a9f09e2b3bff3040155` | **UNKNOWN** | UNKNOWN | **BLOCKED** | No `STATUS.md`, no `INTEGRATION_PATCH.md`, and branch is the unchanged `openko-browser-port` baseline. |
| WS06 | branch not present | **UNKNOWN** | UNKNOWN | **BLOCKED** | Required asset audit/readiness evidence absent; browser asset path/case/content readiness not closed. |
| WS07 | `ws07-database@6e2585312702346dd98851bf97c9c008c51205a3` | **UNKNOWN** | PASS - PostgreSQL workflow run `38473458800` | **BLOCKED** | User rule: no STATUS => not completed. Production adapters are not composed; schema bounds also conflict with Inn-domain contracts. |
| WS08 | `ws08-admin-api@239cdacf0fb6bacde5017fb3b787451595a3be0d` | COMPLETE within scope | PASS - run `38470673396` | PARTIAL | Needs WS07 production adapter and WS28 game execution bridge; Inn capacity statement conflicts with WS17/WS33. |
| WS09 | `ws09-production-infra@8aeeb566cfa98ebd24665b1c2dbe2b133c4bad1a` | COMPLETE scaffold | PASS - run `38470942134` | PARTIAL | Public cutover requires integrated immutable images, DNS/TLS, migrations, tested restore, smoke tests. |
| WS10 | `ws10-qa-integration@21f3a2636e2a0ae6b07c88b42169f18f438205ca` | **UNKNOWN** | **FAIL** - run `38472008679` | **BLOCKED** | No STATUS; QA BUG-001 says M12 character-selectable proof is absent and M13-M16 cannot be credited. |
| WS11 | `ws11-protocol-lab@18282d0e70de7ccb30244a9f09e2b3bff3040155` | **UNKNOWN** | UNKNOWN | **BLOCKED** | No WS-specific commits/STATUS; protocol-lab evidence expected by downstream packet integrations is not delivered. |
| WS12 | `ws12-browser-launcher@e21f84e481203130522964a45e133b84038d8e17` | COMPLETE | PASS - run `38473717974` | PARTIAL | Gateway deployment and WS38 manifest/CDN contract adoption pending. |
| WS13 | `ws13-account-api@23ac239b26e0353bf2da6f9c9649710db58e3a9a` | COMPLETE | PASS - run `38473805499` | PARTIAL | Production repository and shared enforcement need WS07; WS03 access-check composition pending. |
| WS14 | `ws14-world-session@0f12a49eb72cb5e8f776193c0cce7feb7866e1cf` | COMPLETE | PASS - 14/14 and run `38475926954` | PARTIAL | Needs WS03 orchestration and production world repository; client Moradon terrain is outside WS14. |
| WS15 | `ws15-movement-sync@ba44d65628a78f475b376a3996ff32b21ff1e1ab` | COMPLETE | PASS - run `38474313726` | PARTIAL | Must be routed only after WS14 world-ready and authoritative zone/speed rules. |
| WS16 | `ws16-npc-world@e6ee973eead1dbd40f5e7a5e2eb7bc5bd29235a2` | COMPLETE | PASS - run `38473929214` | PARTIAL | Needs WS14 region/world integration and verified terrain height/Inn Hostess classification. |
| WS17 | `ws17-item-inventory@f557e91c79413960712aa621b0a034796d899c48` | COMPLETE | PASS - run `38473620771` | PARTIAL | Requires real 1298 item tables and WS07 repository; Inn contract must be reconciled. |
| WS18 | `ws18-social-core@b865246463b3d373510d03e56d8fe6cac5141060` | COMPLETE | PASS - STATUS reports 19/19 automated tests | PARTIAL | Needs session/world recipient lifecycle; WS32 friend/block adapter composition pending. |
| WS19 | `ws19-combat-core@8a74d9e5b0f78deea4ad45fc991d145bbb70fe03` | COMPLETE framework | PASS - latest observed workflow success | PARTIAL | Exact 1298 coefficients/skills/cooldowns and WS15/WS17 composition remain. |
| WS20 | `ws20-reliability-security@2406af54eb549759403b54b20813dc499ef8f788` | PARTIAL | **FAIL** - latest workflow run `38474114826` failed on earlier branch head | **BLOCKED** | HIGH predictable admin signing fallback; graceful shutdown/trust-proxy issues; no release security sign-off. |
| WS21 | `ws21-clan-core@cbc1b649eb0e5210e713fbacac2601369a03682d` | COMPLETE | PASS - run `38474504958` | PARTIAL | WS07 persistence, WS18 clan chat, world/zone presence and protocol binding pending. |
| WS22 | `ws22-merchant-economy@0503d10f55df15a50d33b5d856516aead260a3e2` | COMPLETE | PASS - run `38474267083` | PARTIAL | Atomic production transaction spans WS17 inventory + WS07 persistence + WS16 merchant authority. |
| WS23 | `ws23-quest-events@6073b687bda3f1006a37cc97ee873c36a2d4e7a8` | COMPLETE | PASS - run `38474141502` | PARTIAL | WS16 routing, WS17 items, WS22 coins, persistence/progression adapters pending. |
| WS24 | `ws24-pvp-zone-rules@4c95200b7e7eafda5f893bd62034d3727dcb9cbc` | COMPLETE | PASS - run `38474611719` | PARTIAL | World must supply safe-area/zone state; integration with WS14/WS15/WS36 pending. |
| WS25 | `ws25-mob-ai@ff1804a7d7a1328727924c50be39792d2caa2483` | COMPLETE framework | PASS - STATUS reports deterministic tests | PARTIAL | Uses synthetic fixture; real 1298 mob/spawn data and WS14/15/19 composition required. |
| WS26 | `ws26-drop-loot@24290da1c9cc2a0f0d40bf2e017cef2dcc8e0866` | COMPLETE framework | PASS - STATUS reports deterministic tests | PARTIAL | Synthetic/non-authoritative drop data must not ship; WS25 death + WS17 item adapters required. |
| WS27 | `ws27-progression@9cd78a5c9eacee0cfa737e6123ba84f55e39ab27` | COMPLETE framework | PASS - STATUS reports 14 tests | PARTIAL | Authoritative XP table, max-level/reward formulas and respawn data are still required. |
| WS28 | `ws28-gm-command-bus@c1ef0f6e84456cb38edd2f3ce2b11ca5ff7de99a` | COMPLETE | PASS - STATUS reports automated tests | PARTIAL | Real game/moderation adapters and WS08 command mapping are not wired. |
| WS29 | `ws29-observability@d26f5af7aae0892576af5f35599a9d6076daf129` | COMPLETE package | PASS - STATUS reports 9/9 tests | PARTIAL | Services have not adopted shared logging/metrics/readiness/graceful-shutdown contract. |
| WS30 | `ws30-backup-recovery@4a80cf4c117af5a0c2fd6efde15655370a05a0fa` | COMPLETE | PASS - STATUS reports recovery tests | PARTIAL | Must run after finalized WS07 migration set; replace fixture-only rehearsal with candidate-schema restore proof. |
| WS31 | `ws31-data-catalog@a1c1d6b3e9aeb07fd066cee8a41714685557dddf` | **UNKNOWN** | UNKNOWN | **BLOCKED** | Branch equals main and required STATUS/validation report are absent; authoritative 1298 data provenance remains a release blocker. |
| WS32 | `ws32-friends-messenger@26a260d41a2870d9b3dc0f454eda5661b59e80d3` | COMPLETE | PASS - run `38475465803` | PARTIAL | WS18 relationship query wiring and production persistence adapter pending. |
| WS33 | `ws33-inn-storage@cfe305f23e0541de050adee7cd0f830811be5d50` | COMPLETE | PASS - run `38475654206` | **BLOCKED** | 196-slot model conflicts with WS08 192-slot claim; WS07 schema is wider than both and needs adapter-level bounds. |
| WS34 | `ws34-character-rules@a7132eb9cd6943a4378fc22dfd07ce9e48c9148a` | **UNKNOWN** | UNKNOWN | **BLOCKED** | Branch has work but no STATUS; character-create rules cannot be release-credited. |
| WS35 | `ws35-runtime-config@5327d50906d02c829add08cf1ca73fbe978526dc` | COMPLETE | PASS - run `38475522284` | PARTIAL | Existing services/infra must adopt `OLDKO_` typed config and secret-reference rules. |
| WS36 | `ws36-world-clock@adf25c055f50f26cbbc9ba81254307019ff5bcbd` | COMPLETE | PASS - run `38475673760` | PARTIAL | WS14/WS24/WS25 integration and persistence adapter pending. |
| WS37 | `ws37-rankings@7176882743fcacf540d41fd7b3a275e0cebe9611` | COMPLETE | PASS - run `38475329273` | PARTIAL | Concrete read-only WS07 repository/schema mapping required before public site use. |
| WS38 | `ws38-client-content-pipeline@5f323f3cf055ba7f96d928605a2f2faf84e609cb` | COMPLETE | PASS - run `38475828745` | PARTIAL | WS12 must consume manifest contract; CDN/origin publication headers and promotion are external integration work. |
| WS39 | `ws39-contract-compatibility@a1c1d6b3e9aeb07fd066cee8a41714685557dddf` | **UNKNOWN** | UNKNOWN | **BLOCKED** | Branch equals main; no STATUS/registry/contract-test evidence. Breaking contracts are therefore not centrally enforced. |

## Completion/readiness summary

- Strong isolated module evidence exists across most WS01-WS30 and WS32-WS38 workstreams.
- Explicit latest workflow failures: **WS04, WS10, WS20**.
- Missing/insufficient completion evidence under the user's strict rule: **WS05, WS06, WS07, WS10, WS11, WS31, WS34, WS39**.
- Root `BUGS.md` and root `COMPATIBILITY_ISSUES.md` are not present on `main`; the actionable QA bug register currently lives on WS10 (`workstreams/ws10/BUGS.md`).
- The highest end-to-end release gate that can be credited from available evidence is **RC2**. RC3 and above remain blocked.
