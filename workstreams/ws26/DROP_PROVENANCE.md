# WS26 Drop Provenance

## Classification rule

WS26 separates drop inputs into explicit classes:

- `verified-1298`: behavior/data backed by pinned OpenKO 1.298/1.299-era source/database evidence.
- `verified-1298-sample`: a small regression sample copied from verified data; useful for tests, **not** a complete production catalog.
- `synthetic`: developer fixtures. They remain supported by the legacy fixture service only and are not accepted by `ProductionLootService`.

## Pinned database evidence

Database repository commit:
`Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab`

Relevant files:
- `ManualSetup/6_InsertData_K_MONSTER.sql`
- `ManualSetup/6_InsertData_K_MONSTER_ITEM.sql`
- `ManualSetup/6_InsertData_MAKE_ITEM_GROUP.sql`
- schema files for `K_MONSTER`, `K_MONSTER_ITEM`, `MAKE_ITEM_GROUP`

Verified sample in this branch: `world-data/drops/verified1298.sample.json`.
It contains the source-backed Kecoon row (`sSid=100`, `iMoney=73`, `sItem=100`), `K_MONSTER_ITEM` row 100, and `MAKE_ITEM_GROUP` rows 130/140 from the pinned DB commit.

## Pinned runtime behavior evidence

Source repository commit:
`Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5`

Relevant implementation:
`src/Server/AIServer/Npc.cpp` (`CNpc::GiveNpcHaveItem`, `GetItemGroupNumber`).

Behavior represented by WS26:
- each non-empty monster-item slot rolls independently on `1..10000`;
- slot 1 (index 0) uses `ItemProdution` when code `< 100`, otherwise item-group resolution;
- slot 2 (index 1) uses item-group resolution;
- slots 3..5 are direct item IDs;
- `MAKE_ITEM_GROUP` selection follows `myrand(0,10000) % 30`;
- direct arrow IDs in the legacy arrow range produce quantity 20, other direct item drops quantity 1;
- monster coin uses random 70..100 percent of base money, with the legacy high-value cap behavior.

## Intentionally unverified / disabled

- Exact `ItemProdution` behavior is not recreated here. Rows that hit it require a separately verified resolver and otherwise fail closed.
- Public-after-N-ms loot ownership is not assumed. It is accepted only when an ownership adapter explicitly marks that rule as verified.
- Party round-robin/random distribution is not assumed. WS26 exposes ownership/distribution adapters only.
