# WS31 — 1298 Data Validation Report

## Result

**Validation: PASS**

The checked-in catalog contains **134 records**: **133 source-backed 1298 records** plus **1 explicitly separated MODERN/OUT_OF_SCOPE marker**. No catalog record is promoted from a fixture-only source.

## Counts

| Metric | Count |
| --- | ---: |
| Total catalog records | 134 |
| Source-backed 1298 records | 133 |
| UNKNOWN records | 0 |
| ID collisions | 0 |
| MODERN / OUT_OF_SCOPE records | 1 |
| Missing source markers | 0 |
| CRITICAL catalog errors | 0 |
| Reported suspicious hard-coded ID issues | 2 |

### Records by catalog

| Catalog | Records |
| --- | ---: |
| Zones | 16 |
| Items | 13 |
| NPCs | 4 |
| Monsters | 9 |
| Skills | 16 |
| Nation / Race / Class | 33 |
| Quests | 26 |
| Client resources | 16 |
| Modern / out-of-scope markers | 1 |

## Validated categories

### Zone

Protocol/server IDs are kept distinct from the client `Zones.tbl` row key. Verified mappings include Karus 1, El Morad 2, Eslant 11/12, Moradon 21, Delos 30, Bifrost 31, Abyss 32/33, Arena 48, nation-war zones 101/102/103, Snow Battle 111 and Frontier 201. Where the corresponding client table row was directly checked, `client_table_id` is stored separately (for example Moradon protocol zone 21 vs client row 210).

### Item

Selected integration-facing item IDs are taken directly from `Item_Org_us.tbl.csv`, with column meanings cross-checked against `__TABLE_ITEM_BASIC`. The catalog includes ID, name, item class, stackability when proven, equip-position field and resource/icon identifiers where directly present in the table. Skill-to-item consumption is cross-referenced; base Archery consumes item 391010000 (Arrow).

### NPC

NPC identity is the database `K_NPC.sSid`; visual identity is the separate `sPid` / client resource ID. Selected NPCs are cross-referenced with `K_NPCPOS` for sourced zone associations and with `NPC_Looks.tbl` for resource existence.

### Monster

Monster identity is the database `K_MONSTER.sSid`; model/resource is `sPid`. This distinction detects the legacy prototype's aliasing of resource IDs 700 and 100 as if they were unique monster identities.

### Skill

Selected `Skill_Magic_Main_us.tbl` rows are cataloged with skill ID, required level, class namespace and MP/item consumption where the source exposes it. Column semantics come from `__TABLE_UPC_SKILL`.

### Class / Race / Nation

Nation IDs 1/2, race IDs 1/2/3/4 and 11/12/13, and class IDs 101–112 / 201–212 are source-backed from OpenKO's shared/server definitions.

### Quest / Event

Twenty-six quest IDs are source-backed from the 1298-compatible source enum. NPC/event associations are not inferred when a trustworthy one-to-one mapping has not been established. WS23 `quest-data/fixtures` is explicitly synthetic (`fixture.*`, `syntheticFixture=true`) and is therefore not promoted into the real-data catalog.

### Client resource

Sixteen NPC/monster resource IDs are mapped to `NPC_Looks.tbl` joint/animation paths or source-backed resource rows. The catalog keeps these model/resource IDs separate from NPC/monster SIDs.

## Fixture separation

- WS23 quest fixtures: excluded from real catalog.
- WS25 mob lifecycle fixture: excluded from real catalog.
- WS22 economy in-memory test values: not used as 1298 truth.

## MODERN / OUT_OF_SCOPE

One marker is intentionally retained as negative evidence: NPC type 162 (`Chaotic Generator`) is labeled in source as a newer NPC type and is therefore marked `MODERN`, not 1298.

## Suspicious hard-coded IDs in project code

Two HIGH-severity legacy-main findings are recorded in `workstreams/ws31/ISSUES.md`:

1. `npc_v25.js` uses resource/model PID 700 for Worm, Earth worm and Blood worm. Real K_MONSTER SIDs are 700, 701 and 702 respectively while the shared model PID is 700.
2. `npc_v25.js` uses resource/model PID 100 for Kekurikekukaka; real K_MONSTER SID is 111 and resource PID is 100.

These files are read-only for WS31 and were not modified.

## CRITICAL records before integration

**None inside the WS31 catalog.** All schema, source-marker, duplicate and current cross-reference checks pass. Integration is **conditional** only because the two HIGH-severity legacy prototype identity/resource aliases must not be consumed as canonical gameplay IDs.

## Automated validation

The validator and tests cover:

- formal Draft 2020-12 JSON Schema validation;
- malformed entries;
- missing source markers;
- invalid patch markers;
- duplicate IDs;
- duplicate zones;
- duplicate class IDs;
- unresolved NPC resource/zone references;
- unresolved monster resource/zone references;
- unresolved skill → class/item references.

Latest local run: **11 tests PASS; catalog validator PASS; 134 records; 0 UNKNOWN; 0 collisions; 0 missing-source records.**
