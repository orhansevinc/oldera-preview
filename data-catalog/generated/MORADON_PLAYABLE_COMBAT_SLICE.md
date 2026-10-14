# Moradon Playable Combat Slice

- Authority: `MORADON_PLAYABLE_COMBAT_SLICE`
- Patch: `1298`
- JSON SHA-256: `96cf090a3413687825cf0599437a3d910772c8b6e9052a9b3fd596e21e241aa2`
- Data authority ready: `true`
- Browser playable slice ready: `false`

## Test character

`Karus` / `KARUS_BIG` / `Karus Warrior` / level `3`.

## Starter equipment and normal attack

- Right hand: `120010000` Short Sword (SWORD)
- Weapon damage: `4`
- Attack delay: `114` = `1140 ms`
- Range: `10` = `1.0 m`
- Durability: `5000`
- Normal-attack source data ready: `true`

## Active hostile skill

- Skill: `101003` slash
- Requirement: level `3`, mode `BASE_LEVEL`, skill points `0`
- Cost: `4` resource, HP `0`
- Moral: `7` `ENEMY_ONLY`
- Type: `1` / damage modifier `120%`
- Client recast: `31` = `3100 ms`
- Effective server range: `null` (raw valid-distance `0`)
- Skill icon: `UI/skillicon_03_1010.dxt` -> `missing` in current browser preload manifest

## Target mob

- `850` Bandicoot / PID `800` / level `2`
- HP `11`, AC `10`, sAtk `0`, sDamage `3`
- Attack range `5`, attack delay `1700 ms`
- Spawn `npcpos21-850-a`: rectangle X `193..238`, Z `298..326`, population `5`, respawn `20 s`

## Player start to target

- START_POSITION center: `(306, 352)`, raw range fields X/Z `10/10`
- Movement required: `true`
- Nearest verified rectangle point from nominal center: `(238, 326)`
- Nominal horizontal straight-line distance: `72.801099` world-coordinate units
- Navigable/path distance: `null`

## Mob model assets

- K_MONSTER PID / NPC_Looks ID: `800` / `800` -> `match`
- Joint: `chr/mob_bandicoot.n3joint`
- Animation: `chr/mob_bandicoot.n3anim`
- Browser preload manifest: `missing`

## Consumer projections

- `ws10` `ws10-qa-integration@163f2ebf81e750bf746fdaa277695329a0682e22` -> test_character, starter_equipment, active_skill, target_mob, player_start_to_mob, skill_client_assets, mob_model_assets; parse ready `true`
- `ws17` `ws17-item-inventory@fbfc13f9c123ebeb6dd38c32fc95ef26d917a777` -> starter_equipment; parse ready `true`
- `ws19` `ws19-combat-core@28eb4f38753ffbc54c60abbd2a32832301284c06` -> normal_attack, active_skill, target_mob; parse ready `true`
- `ws25` `ws25-mob-ai@13c9bafe287b250d56b52f19e97a02e7ef18e6e5` -> target_mob, player_start_to_mob, mob_model_assets; parse ready `true`

## Unknowns / blockers

- `starter_equipment.right_hand.attack_power_field` = `null` — `ITEM_TABLE_HAS_WEAPON_DAMAGE_BUT_NO_STANDALONE_ATTACK_POWER_FIELD; AP_FORMULA_IS_WS19_OWNED`
- `starter_equipment.right_hand.client_refs.model_filename` = `null` — `ITEM_RESOURCE_ID_TO_FILENAME_NOT_RESOLVED_IN_CURRENT_SOURCE_SET`
- `starter_equipment.right_hand.client_refs.icon_filename` = `null` — `ITEM_ICON_RESOURCE_ID_TO_FILENAME_NOT_RESOLVED_IN_CURRENT_SOURCE_SET`
- `normal_attack.attack_power_formula` = `null` — `PRODUCT_FORMULA_OWNED_BY_WS19_NOT_WS31`
- `active_skill.skill_point_slot` = `null` — `BASE_LEVEL_SKILL_HAS_NO_SKILL_POINT_SLOT`
- `active_skill.range.effective_meters` = `null` — `RAW_VALID_DISTANCE_IS_ZERO; CURRENT_WS19_SKIPS_RANGE_VALIDATION_FOR_ZERO_AND_NO_SERVER_DISTANCE_SEMANTIC_IS_PROVEN`
- `active_skill.recast.server_authoritative_cooldown_ms` = `null` — `CLIENT_RECAST_31_IS_PROVEN; CURRENT_WS19_ENFORCES_COOLDOWN_ONLY_VIA_INJECTED_POLICY`
- `active_skill.animation_fx.self_fx_1_resource` = `null` — `FX_ID_TO_RESOURCE_FILENAME_CHAIN_NOT_IN_CURRENT_WS31_SOURCE_SET`
- `active_skill.animation_fx.target_fx_resource` = `null` — `FX_ID_TO_RESOURCE_FILENAME_CHAIN_NOT_IN_CURRENT_WS31_SOURCE_SET`
- `target_mob.spawn.path` = `null` — `SOURCE_K_NPCPOS_PATH_IS_NULL`
- `player_start_to_mob.start_position.karus_center.y` = `null` — `START_POSITION_HAS_NO_Y; AUTHORITATIVE_TERRAIN_RESOLVER_REQUIRED`
- `player_start_to_mob.start_position.elmorad_center.y` = `null` — `START_POSITION_HAS_NO_Y; AUTHORITATIVE_TERRAIN_RESOLVER_REQUIRED`
- `player_start_to_mob.nearest_verified_rectangle_point_from_center.y` = `null` — `K_NPCPOS_HAS_NO_Y; AUTHORITATIVE_TERRAIN_RESOLVER_REQUIRED`
- `player_start_to_mob.navigable_path_distance` = `null` — `NO_AUTHORITATIVE_NAV_PATH_DISTANCE_IN_WS31_SOURCE_SET`

## Integration blockers

- `SKILL_ICON_BROWSER_ASSET_MISSING` (integration): Derived 101003 icon path is absent from the current real1298 preload manifest.
- `SKILL_TABLE_BROWSER_ASSET_MISSING` (integration): Skill_Magic_Main is source-backed but absent from the current real1298 preload manifest.
- `SKILL_TYPE1_BROWSER_ASSET_MISSING` (integration): Skill_Magic_1 is source-backed but absent from the current real1298 preload manifest.
- `MOB_MODEL_BROWSER_ASSET_MISSING` (integration): Bandicoot NPC_Looks chain is source-backed and PID-matched, but mob_bandicoot paths are absent from the current real1298 preload manifest.
- `AUTHORITATIVE_Y_REQUIRED` (runtime): WS31 does not invent terrain Y; runtime terrain authority must resolve it.
- `SLASH_EFFECTIVE_RANGE_UNPROVEN` (runtime): Raw valid-distance field is 0 and no exact server-side distance semantic is proven by WS31.
- `SLASH_SERVER_COOLDOWN_POLICY_UNPROVEN` (runtime): Client 3.1s recast is exact; WS19 current server enforcement is policy-injected, not a WS31 data fact.

> The JSON file is the single machine-readable authority. This Markdown report is deterministically rendered from it.
