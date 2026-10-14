WS25

# Status

- Workstream: `WS25`
- Branch: `ws25-mob-ai`
- State: `STAGE 2/3 IMPLEMENTED / INTEGRATION-READY WITH DATA CAVEATS`
- Scope: deterministic production mob runtime and source-backed monster/spawn adapters

## Delivered

### Real data boundary

- strict `fixture` vs `real` validation retained and hardened;
- WS31 monster catalog -> verified K_MONSTER template loader;
- source-backed K_MONSTER/K_NPCPOS world loader;
- duplicate monster ID, spawn row, spawn geometry, spawn ID and cross-zone validation;
- unsafe integer rejection on runtime data paths;
- real terrain Y fails closed until an authoritative resolver is supplied;
- source K_NPCPOS spawn rectangles converted to deterministic X/Z slots without claiming original RNG equivalence.

### Verified Moradon slice

Pinned source: `Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab`.

Moradon zone 21 is verified to contain attackable mobs. Checked-in production-source slice:

- 10 K_MONSTER templates: 750, 751, 752, 754, 755, 850, 851, 852, 853, 854;
- 20 K_NPCPOS source rows;
- 135 expanded deterministic spawn slots;
- source HP, attack delay, attack/search/tracing ranges, group/family and RegTime provenance.

The old `fixture:moradon` data remains synthetic test-only data and is not promoted to production.

### Lifecycle / AI

States:

`idle`, `patrolling`, `aggro`, `chasing`, `attack-intent`, `returning`, `dead`, `corpse`, `despawned`.

Implemented:

- deterministic fixed-tick scheduler with bounded catch-up;
- deterministic nearest-target selection + lexical ID tie break;
- wrong-zone/dead/missing target rejection;
- source-backed aggro/search, attack and tracing/leash values;
- attack-intent cadence from source attack delay;
- return-home lifecycle;
- target lost/dead/zone-leave handling;
- stuck count and no-path outcome handling via movement adapter only;
- optional patrol intent only when a path is supplied;
- stable instance ID + respawn `spawnEpoch`;
- source-backed assist signal using OpenKO same group/family + search-range evidence;
- no invented generic threat table.

OpenKO's `m_DamagedUserList` is documented for XP distribution, while attacker retargeting is a separate `ChangeTarget()` path. Exact level/HP retarget scoring is therefore intentionally not guessed.

### World hooks

- player enter/leave region;
- multiple tracked players;
- nearby mob spawn/despawn;
- mob visibility delta after authoritative position sync;
- corpse despawn and respawn visibility events;
- region/cell membership stays owned by WS14 through `isMobVisibleToPlayer()`.

### Movement/combat boundaries

- WS15 movement implementation is not copied. WS25 emits chase/return/patrol/stop intents and consumes authoritative `syncPosition()` / movement outcomes.
- WS19 damage implementation is not copied. WS25 emits attack intents and consumes authoritative absolute HP.
- WS26 integration point is the one-shot `dead` event; no drop logic is embedded.
- WS27 integration point is the same authoritative death context; no XP formula is embedded.

## Test / load result

Local Node.js `v22.16.0`:

```text
node --test tests/ko1298-mobs/*.test.cjs
23 tests / 23 pass / 0 fail
```

Coverage includes lifecycle transitions, real-data provenance/validation, source-backed Moradon expansion, terrain fail-closed behavior, deterministic targeting, combat/movement boundaries, assist signal, region visibility, player cleanup, scheduler monotonicity, multiple players, stuck/no-path, death/respawn churn and stable IDs.

Latest local load diagnostic from the test suite (not a production SLA):

```text
100 mobs  x 50 ticks: ~10 ms
500 mobs  x 50 ticks: ~22 ms
1000 mobs x 50 ticks: ~35 ms
```

A 500-mob death -> corpse -> despawn -> respawn churn test returns to exactly 500 live instances with cleared death/target state; 50 tracked players enter/leave with tracked-player count returning to zero.

## CI

Dedicated workflow remains `.github/workflows/ws25-mobs.yml` and runs the complete `tests/ko1298-mobs/*.test.cjs` suite on Node 22 for WS25 paths.

## Data/source caveats

1. WS31's current canonical `data-catalog/mobs.json` does not yet include the committed Moradon 750-854 subset. The WS25 data is directly source-backed, but remains marked `upstream-verified-pending-ws31-catalog-expansion` until WS31 imports those IDs.
2. Exact terrain Y for K_NPCPOS rectangles is not present in this dataset; production initialization requires the WS14/world height resolver.
3. K_NPCPOS defines spawn rectangles and counts; OpenKO randomizes points inside those rectangles. WS25 uses a deterministic hash inside the same verified rectangles, not the original RNG sequence.
4. Exact attacker retarget scoring from OpenKO `ChangeTarget()` is not yet frozen into WS25. No synthetic threat scores were added.
5. Assist is exposed as a source-backed signal; the remaining friend-target propagation should be wired only after the exact region behavior is frozen.

## Boundary audit

No WS14/WS15/WS19/WS26/WS27 implementation code, DB migration, client, admin/site, or `main` merge is part of this change. No force push is required.
