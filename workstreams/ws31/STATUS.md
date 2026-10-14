# WS31 STATUS

DURUM: DATA AUTHORITY GENERATED — pinned 1298 sources, deterministic output, explicit UNKNOWN/conflict reporting.

## VERIFIED COUNTS
- zones: 20
- NPC templates / spawn rows: 474 / 455
- monster templates / spawn rows: 723 / 1275
- items: 61530
- skills: 1522
- merchants: 16
- item groups: 46
- drop tables: 868
- progression rows: 90
- unknown/unresolved: 221
- conflicts: 221

## MORADON SOURCE SLICES
- NPC: 31 templates, 39 K_NPCPOS groups, declared population 43.
- NPC terrain Y: source K_NPCPOS has no Y column; 39 groups remain runtime height-resolver dependent.
- Monsters: 10 templates; full pinned source has 26 Moradon rows for those IDs; WS25 verified slice is 20 rows / declared population 135.
- Monster runtime deterministic rectangle expansion is explicitly DERIVED and is not claimed to reproduce original 1298 RNG positions.

## ITEM SCHEMA EVIDENCE
- Required intelligence stat: `ReqIntel`.
- Intelligence bonus DB column: `IntelB`.
- Server semantic: `IntelligenceBonus`.
- Missing required item fields fail generation; no missing field is coerced to zero.

## DOWNSTREAM SURFACES
- WS17: complete source-backed ITEM parse including requirements, bonuses, durability, price, weight and client model/icon refs when matched.
- WS19: MAGIC main + Type1..4 source tables and six golden skills.
- WS22: source-derived merchant groups; Caspy 13001 -> group 203002 asserted.
- WS25: Moradon source rectangles/counts separated from runtime deterministic projections.
- WS26: K_MONSTER/K_NPC drop tables + MAKE_ITEM_GROUP + item cross-reference coverage.
- WS27: LEVEL_UP levels 1..90 from source `Exp`; no synthetic XP curve.

Machine-readable authority: `data-catalog/generated/`.
`hash-manifest.json` is the committed byte-stability authority.
`catalog-summary.json`, `cross-reference-report.json`, `drop-coverage.json`, and `unresolved.json` retain machine-readable coverage/conflict state.
