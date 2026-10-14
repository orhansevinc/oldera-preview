# WS26 Drop Data

`fixture.synthetic.json` is synthetic fixture data only. Its IDs, weights, quantities and coin values are invented to exercise the legacy weighted model and must never be promoted as 1298 production data.

`verified1298.sample.json` is a **small source-backed regression sample**, not the full drop catalog. It pins:
- Kecoon (`K_MONSTER.sSid=100`, `iMoney=73`, `sItem=100`),
- `K_MONSTER_ITEM.sIndex=100`,
- `MAKE_ITEM_GROUP` rows 130 and 140,
from `Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab`.

Production should populate `Verified1298DropTableAdapter` from the complete WS31 verified catalog. `ProductionLootService` accepts only verified 1298 tables; the old weighted `LootService` is not the production path.

See `workstreams/ws26/DROP_PROVENANCE.md` for pinned runtime behavior sources and rules that remain intentionally disabled until verified.
