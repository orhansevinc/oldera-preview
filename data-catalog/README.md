# WS31 — Knight Online 1298 Data Catalog

This directory is an integration-facing, source-backed catalog for IDs currently needed by OldKOWeb plus a verified baseline of core 1298 data. It is **not** an assertion that every row from every Knight Online table has already been imported.

## Source policy

- Promote a fact only when a concrete 1298-compatible source is recorded in `source`.
- Keep protocol/server IDs separate from client resource/model IDs.
- Keep fixture IDs out of the real-data catalog.
- Mark later-patch data `MODERN` or `OUT_OF_SCOPE`; never coerce it to 1298.
- If a fact cannot be proven, omit the optional field or use an `UNKNOWN` record rather than guessing.

Primary evidence is OpenKO source, the `openko-1298` client asset branch, and the official OpenKO database dataset. Project workstream data is read-only corroboration, never the sole authority for a 1298 fact.

## Catalog files

- `zones.json` — protocol/server zone IDs and verified client table keys where available.
- `items.json` — source-backed item IDs and selected table fields.
- `npcs.json` — K_NPC SIDs, type, resource/model ID and sourced zone associations.
- `mobs.json` — K_MONSTER SIDs, resource/model IDs and sourced zone associations.
- `skills.json` — Skill_Magic_Main IDs, class namespace, level and resource costs.
- `classes.json` — nation, race and class IDs used by character creation/protocol code.
- `quests.json` — source-backed quest IDs; NPC/event associations are intentionally not guessed.
- `client-resources.json` — NPC/monster resource IDs mapped to client asset paths.
- `out-of-scope.json` — explicitly detected later-patch markers excluded from 1298.
- `sources.json` — provenance policy and inspected source registry.

## Validation

Run:

```bash
python -m pip install 'jsonschema==4.23.0'
python tools/ws31_data/validate_catalog.py --root .
python -m unittest discover -s tests/data-catalog -p 'test_*.py' -v
```

The validator checks formal JSON Schema conformance, duplicate IDs, duplicate zones/classes, source/patch markers and cross-references among NPCs, monsters, zones, client resources, skills, classes and items.
