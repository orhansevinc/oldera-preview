# WS31 UNRESOLVED REPORT

Machine-readable unresolved rows: `data-catalog/generated/unresolved.json`.

Current unresolved/reference issue count: **221**.
Current conflict count: **221**.

By kind:
- drop_reference_missing: 2
- merchant_group_without_items: 16
- monster_drop_table_missing: 76
- npc_drop_table_missing: 119
- path_whitespace: 2
- skill_invalid_class: 6

Expected structural UNKNOWNs such as K_NPCPOS terrain Y are reported in coverage metadata and are not fabricated.
Missing/ambiguous cross-references are retained here and are never silently converted to zero/default production data.
