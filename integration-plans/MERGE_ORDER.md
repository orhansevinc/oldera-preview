# WS40 Controlled Integration / Merge Order

**This document is a plan only. WS40 does not merge any branch.**  
Integration must occur on a dedicated control/integration branch, never directly from WS40 to `main`.

## Pre-merge rules

1. Freeze an exact candidate SHA for every workstream being integrated.
2. Require `STATUS.md` plus successful automated test evidence before treating a workstream as completed. Missing STATUS remains a hold.
3. Require WS39 compatibility tests before accepting breaking cross-service contracts.
4. Run WS10 after every user-visible wave; do not defer all E2E testing to the end.
5. For browser-line branches (`WS01`, `WS04`, and any branch inheriting `openko-browser-port`), **do not blindly merge the full branch tip into main**. Their ancestry is heavily divergent. Apply the WS-owned delta/cherry-picks onto the integration branch and manually apply documented shared-file patches.
6. Database/schema integration is one-way once candidate data has been written: snapshot first, prefer forward correction over destructive down-migration.
7. Tag every successful integration wave so rollback is one commit/tag boundary, not an ad-hoc multi-branch rebase.

## Integration waves

### Wave A - evidence, contracts and common runtime standards

`WS11 -> WS31 -> WS39 -> WS35 -> WS29`

- WS11/31/39 are currently **HOLD** until completion evidence exists.
- WS35 and WS29 can land as additive common libraries/contracts, but product services must opt in during their own composition commits.

### Wave B - persistence and account foundation

`WS07 -> WS13 -> WS30 (tooling only; final restore proof later) -> WS37`

- WS07 is **HOLD** until STATUS exists despite green PostgreSQL CI.
- WS30 may be integrated as tooling after WS07, but its release acceptance run must happen again after the final migration set.

### Wave C - browser/login/character/world critical path

`WS01 -> WS38 -> WS12 -> WS02 -> WS03 -> WS34 -> WS04 -> WS14 -> WS06 -> WS05`

- WS34, WS06 and WS05 are **HOLD** under current evidence.
- WS04 is **HOLD** until its failing HEAD workflow is green.
- After WS03/34/04 integration, run WS10 through M12 before proceeding.
- After WS14/06/05 integration, run WS10 through M15 before proceeding.

### Wave D - live world/gameplay domains

`WS24 -> WS36 -> WS15 -> WS16 -> WS17 -> WS33 -> WS22 -> WS23 -> WS18 -> WS32 -> WS21 -> WS19 -> WS25 -> WS26 -> WS27`

Required checkpoints:
- after WS15/16: WS10 M16 + NPC smoke;
- after WS17/33/22: atomic inventory/Inn/economy persistence tests;
- after WS19/25/26/27: real-data combat/loot/progression scenario, not synthetic fixtures.

### Wave E - admin, security and production composition

`WS28 -> WS08 -> WS20 -> WS09`

- Wire WS28 execution through WS08 before admin acceptance.
- WS20 must be green and its HIGH finding closed before WS09 public cutover.
- WS35/29 adoption and WS30 final-schema recovery proof are mandatory parts of this wave even though their code/contracts land earlier.

### Wave F - final candidate validation

`WS39 compatibility -> WS30 restore rehearsal -> WS20 security/reliability -> WS10 full E2E -> WS09 public smoke`

Only after all are green may an external control owner consider promotion to `main`/production.

## Per-workstream integration register

Rollback codes are defined below the table.

| WS | Branch @ commit | Dependencies before integration | Current blocker | Order | Rollback |
|---|---|---|---|---|---|
| WS01 | `ws01-runtime-build@5545df2273cda795055a611618c91b948063624f` | canonical browser baseline | divergent browser ancestry; apply narrow delta | C01 | R2 |
| WS02 | `ws02-websocket-gateway@1738f60945b24e00bdd2266e6600b5c0cf3c64cf` | WS01 runtime endpoint contract | live WASM roundtrip pending | C04 | R1 |
| WS03 | `ws03-ko1298-session@3a087ab1d98969ef531ac6e3f682f4a463222f5e` | WS02; WS13 for production auth; WS11/39 protocol contracts | char/world composition pending | C05 | R1 |
| WS04 | `ws04-character-client@fffbd9372b67c2aaef600f7e50595bec7e23fe88` | WS01, WS03, WS34 | **latest CI FAIL**; divergent browser ancestry | C07 HOLD | R2 |
| WS05 | `ws05-moradon-world@18282d0e70de7ccb30244a9f09e2b3bff3040155` | WS14, WS06, WS04 | no STATUS/no WS-specific delta | C10 HOLD | R2 |
| WS06 | branch absent | client asset sources | no branch/STATUS/test evidence | C09 HOLD | R5 |
| WS07 | `ws07-database@6e2585312702346dd98851bf97c9c008c51205a3` | contract review/WS39 | no STATUS; schema/domain bounds need reconciliation | B01 HOLD | R3 |
| WS08 | `ws08-admin-api@239cdacf0fb6bacde5017fb3b787451595a3be0d` | WS07, WS28, WS29/35 adoption | Inn mismatch; real command bridge pending | E02 | R1/R3 |
| WS09 | `ws09-production-infra@8aeeb566cfa98ebd24665b1c2dbe2b133c4bad1a` | all candidate services, WS12/38, WS20/29/30/35 | no production-ready integrated candidate | E04 HOLD until RC8 | R4 |
| WS10 | `ws10-qa-integration@21f3a2636e2a0ae6b07c88b42169f18f438205ca` | integrated checkpoints | no STATUS; latest CI FAIL | F04 tooling/HOLD acceptance | R5 |
| WS11 | `ws11-protocol-lab@18282d0e70de7ccb30244a9f09e2b3bff3040155` | source evidence | no STATUS/no WS-specific delta | A01 HOLD | R5 |
| WS12 | `ws12-browser-launcher@e21f84e481203130522964a45e133b84038d8e17` | WS01, WS38, WS02 deployment | manifest/CDN adoption pending | C03 | R2 |
| WS13 | `ws13-account-api@23ac239b26e0353bf2da6f9c9649710db58e3a9a` | WS07, WS35, WS29 | production repository/shared controls pending | B02 | R1 |
| WS14 | `ws14-world-session@0f12a49eb72cb5e8f776193c0cce7feb7866e1cf` | WS03 selection orchestration, WS07 repository | composition pending | C08 | R1 |
| WS15 | `ws15-movement-sync@ba44d65628a78f475b376a3996ff32b21ff1e1ab` | WS14, WS24 | live world router pending | D03 | R1 |
| WS16 | `ws16-npc-world@e6ee973eead1dbd40f5e7a5e2eb7bc5bd29235a2` | WS14, WS15, validated NPC data | production world/terrain/Inn routing pending | D04 | R1 |
| WS17 | `ws17-item-inventory@f557e91c79413960712aa621b0a034796d899c48` | WS07, WS31 data | real item catalog; Inn contract conflict | D05 | R1/R3 |
| WS18 | `ws18-social-core@b865246463b3d373510d03e56d8fe6cac5141060` | session/world presence | production lifecycle wiring | D09 | R1 |
| WS19 | `ws19-combat-core@8a74d9e5b0f78deea4ad45fc991d145bbb70fe03` | WS15, WS17, WS31 | authoritative combat/skill data incomplete | D12 | R1 |
| WS20 | `ws20-reliability-security@2406af54eb549759403b54b20813dc499ef8f788` | assembled candidate, WS08/29/30 | HIGH signing fallback; latest workflow failure | E03 HOLD | R5/R4 |
| WS21 | `ws21-clan-core@cbc1b649eb0e5210e713fbacac2601369a03682d` | WS07, WS18, WS14/15, protocol evidence | persistence/chat/packet binding pending | D11 | R1/R3 |
| WS22 | `ws22-merchant-economy@0503d10f55df15a50d33b5d856516aead260a3e2` | WS16, WS17, WS07 | production atomic transaction adapter | D07 | R1/R3 |
| WS23 | `ws23-quest-events@6073b687bda3f1006a37cc97ee873c36a2d4e7a8` | WS16, WS17, WS22, persistence/progression | real data/script adapters pending | D08 | R1 |
| WS24 | `ws24-pvp-zone-rules@4c95200b7e7eafda5f893bd62034d3727dcb9cbc` | WS14 world composition | safe-area/zone source integration | D01 | R1 |
| WS25 | `ws25-mob-ai@ff1804a7d7a1328727924c50be39792d2caa2483` | WS14/15/19, WS31 | synthetic mob fixture; real data absent | D13 | R1 |
| WS26 | `ws26-drop-loot@24290da1c9cc2a0f0d40bf2e017cef2dcc8e0866` | WS25, WS17, WS31 | synthetic/non-authoritative drops | D14 | R1 |
| WS27 | `ws27-progression@9cd78a5c9eacee0cfa737e6123ba84f55e39ab27` | WS19/25/26/24, WS31 | XP/max-level/reward/respawn data unresolved | D15 | R1/R3 |
| WS28 | `ws28-gm-command-bus@c1ef0f6e84456cb38edd2f3ce2b11ca5ff7de99a` | WS35/29 common contracts; game adapters | real execution adapters pending | E01 | R1 |
| WS29 | `ws29-observability@d26f5af7aae0892576af5f35599a9d6076daf129` | none as package | service adoption pending | A05 | R1 |
| WS30 | `ws30-backup-recovery@4a80cf4c117af5a0c2fd6efde15655370a05a0fa` | WS07 finalized schema | final migration-set restore proof pending | B03 tooling; F02 acceptance | R3/R5 |
| WS31 | `ws31-data-catalog@a1c1d6b3e9aeb07fd066cee8a41714685557dddf` | authoritative source collection | branch equals main; no STATUS/validation report | A02 HOLD | R5 |
| WS32 | `ws32-friends-messenger@26a260d41a2870d9b3dc0f454eda5661b59e80d3` | WS18, persistence composition | relationship/persistence adapters pending | D10 | R1 |
| WS33 | `ws33-inn-storage@cfe305f23e0541de050adee7cd0f830811be5d50` | WS07, WS17, WS16 | 196 vs 192 contract disagreement | D06 HOLD until contract resolved | R1/R3 |
| WS34 | `ws34-character-rules@a7132eb9cd6943a4378fc22dfd07ce9e48c9148a` | WS03, WS07, WS39 | no STATUS/test credit | C06 HOLD | R1 |
| WS35 | `ws35-runtime-config@5327d50906d02c829add08cf1ca73fbe978526dc` | none | consumers not yet adopted | A04 | R1 |
| WS36 | `ws36-world-clock@adf25c055f50f26cbbc9ba81254307019ff5bcbd` | WS14/24; optional WS28 control | persistence/world composition pending | D02 | R1 |
| WS37 | `ws37-rankings@7176882743fcacf540d41fd7b3a275e0cebe9611` | WS07 | concrete read-only SQL repository pending | B04 | R1 |
| WS38 | `ws38-client-content-pipeline@5f323f3cf055ba7f96d928605a2f2faf84e609cb` | WS01 package identity/publisher | WS12/infra adoption pending | C02 | R2 |
| WS39 | `ws39-contract-compatibility@a1c1d6b3e9aeb07fd066cee8a41714685557dddf` | published contracts from all providers | branch equals main; no registry/STATUS/tests | A03 HOLD; F01 acceptance | R5 |

## Rollback codes

- **R1 - Additive service/library:** unregister the adapter/route/feature flag and revert the integration commit. Preserve persistent data unless a separate data migration was explicitly approved.
- **R2 - Browser/content:** keep the previous immutable package/manifest and launcher config; revert the narrow WS-owned commit or repoint the publication pointer. Never rollback by mixing files from two content versions.
- **R3 - Persistence/data:** take a verified backup before migration/composition. After writes occur, prefer a forward corrective migration; destructive schema rollback requires an explicit restore decision.
- **R4 - Infrastructure/security:** redeploy the previous immutable image/config bundle; keep DNS/TLS changes reversible and do not delete the last known-good deployment until smoke/restore pass.
- **R5 - Test/evidence-only:** revert the tooling/docs commit if necessary; never suppress a failing gate to make the candidate appear green.

## Promotion checkpoints

1. **Checkpoint C-RC2:** WS01/02/03 path remains green after common config/content integration.
2. **Checkpoint C-RC3:** WS34 + WS04 + WS03 create/select path; WS10 M12 green.
3. **Checkpoint C-RC4:** WS14 + WS06 + WS05; WS10 M13-M15 green.
4. **Checkpoint C-RC5:** WS15/16 live movement/NPC smoke.
5. **Checkpoint C-RC6:** WS07-backed restart/persistence proof.
6. **Checkpoint C-RC7:** item/Inn/economy atomicity against PostgreSQL after Inn contract resolution.
7. **Checkpoint C-RC8:** real-data mob/combat/loot/progression scenario.
8. **Checkpoint C-RC9/10:** exact immutable candidate passes WS39, WS30, WS20, WS10, then public smoke.
