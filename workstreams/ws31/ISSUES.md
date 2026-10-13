# WS31 Data Issues

## Issue 1 — legacy main prototype aliases monster resource ID 700 as multiple monster identities

AFFECTED_WS: LEGACY_MAIN (no owning WS branch identified)
FILE: npc_v25.js
ID: 700
EXPECTED: Gameplay/entity identity must use the K_MONSTER SID. OpenKO K_MONSTER uses SID 700 = Worm, SID 701 = Earth worm, SID 702 = Blood worm; all three share resource/model PID 700.
ACTUAL: The SPAWNS array uses `pid:700` for labels `Earth worm`, `Blood worm`, and `Worm`, and passes that PID directly to the client-resource template loader.
SOURCE: Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab:ManualSetup/6_InsertData_K_MONSTER.sql; Open-KO/ko-client-assets@b4636332c7cd818b0ce171eccc973dd3d6b2e56d:Data/NPC_Looks.tbl.csv
SEVERITY: HIGH
NOTES: The legacy file appears visual/prototype-oriented, so WS31 does not modify it. Integration code must not reuse the visual resource PID as the authoritative monster SID.

## Issue 2 — legacy main prototype labels resource ID 100 as Kekurikekukaka identity

AFFECTED_WS: LEGACY_MAIN (no owning WS branch identified)
FILE: npc_v25.js
ID: 100
EXPECTED: K_MONSTER SID 111 identifies Kekurikekukaka; its client resource/model PID is 100.
ACTUAL: The SPAWNS array uses `pid:100` for `Kekurikekukaka`, which can be mistaken for the entity/monster ID even though 100 is also the Kecoon monster SID and the shared Kecoon-family resource/model ID.
SOURCE: Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab:ManualSetup/6_InsertData_K_MONSTER.sql; Open-KO/ko-client-assets@b4636332c7cd818b0ce171eccc973dd3d6b2e56d:Data/NPC_Looks.tbl.csv
SEVERITY: HIGH
NOTES: Keep `monsterSid`/entity ID separate from `resourceId`/model PID in any integration layer. WS31 reports only; no product file was changed.

## Read-only workstream checks with no blocking discrepancy

- WS16: `world-data/npc/moradon.json` explicitly cites OpenKO K_NPC/K_NPCPOS provenance. Caspy SID 13001, resource 22000 and Moradon zone 21 cross-check successfully.
- WS17: item domain uses an adapter boundary rather than claiming its tests as 1298 table truth; no catalog-breaking hard-coded item ID was identified in the inspected adapter.
- WS22: inspected economy test fixture is in-memory test data and is not promoted to the real catalog.
- WS23: `quest-data/fixtures/*` uses `fixture.*` IDs and `syntheticFixture=true`; it is correctly excluded from real 1298 catalog records.
- WS24: nation IDs 1/2 and zone IDs 1,2,11,12,21,48,101,102,103,111 match the source-backed 1298 catalog.
- WS25: `world-data/mobs/fixtures/*` declares `dataClass: fixture`; synthetic mob values are correctly separated from real 1298 data.
