# WS25 Mob Runtime Model

## Scope

`ko1298-mobs` owns deterministic monster lifecycle/orchestration only. It does not calculate movement, pathfinding, hit/damage, skill effects, drops, XP, packet encoding, or persistence.

Production composition boundaries:

- WS14: zone/region membership, player snapshots, visibility and authoritative terrain/height resolver.
- WS15: movement execution. WS25 only emits chase/return/patrol/stop intents and consumes authoritative position/movement outcomes.
- WS19: combat policy/damage. WS25 only emits attack intents and consumes authoritative absolute HP/alive/aggro checks.
- WS26: consumes the single authoritative `dead` lifecycle event for loot generation.
- WS27: consumes the same authoritative kill/death context for progression/XP.

## Data classes

Every world and template is either `fixture` or `real`.

- `fixture` IDs/zones must use the `fixture:` prefix. Fixture numbers are test-only and are never production claims.
- `real` templates require provenance.
- `loadWs31MonsterTemplates()` joins WS31 catalog rows to verified K_MONSTER stat rows and rejects name/level disagreement.
- `loadVerifiedWorldDefinition()` validates verified K_MONSTER + K_NPCPOS shaped input, duplicate monster IDs, duplicate spawn rows/geometries, unknown templates and cross-zone contamination.

The checked-in Moradon data file is `world-data/mobs/verified/moradon-zone21.verified.json`. It is a source-backed Stage 2/3 slice, not a claim that WS31's canonical catalog already contains every row in that file.

## Verified 1298 fields

Pinned database source: `Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab`.

For the committed Moradon slice:

- `K_MONSTER.bySearchRange` -> aggro/search radius.
- `K_MONSTER.byTracingRange` -> leash/chase envelope.
- `K_MONSTER.byAttackRange` -> attack-intent range.
- `K_MONSTER.sAttackDelay` -> attack-intent cadence input.
- `K_MONSTER.iHpPoint` -> max HP snapshot.
- `K_MONSTER.byGroup` + `byFamily` -> source-backed assist signal metadata.
- `K_NPCPOS.ZoneID/NpcID/NumNPC` -> spawn group membership/count.
- `K_NPCPOS.LeftX/TopZ/RightX/BottomZ` -> verified spawn rectangle.
- `K_NPCPOS.RegTime` -> regeneration delay in seconds; source AIServer converts it to milliseconds.

OpenKO's original loader randomizes X/Z inside the K_NPCPOS rectangle. WS25 deliberately replaces that random choice with a stable hash for deterministic server simulation. The rectangle and count are verified; the selected point is a deterministic runtime policy and is not claimed to reproduce the original RNG stream.

Terrain Y is not invented. Real records carry unresolved Y and `MobService.initialize()` fails closed unless WS14/world supplies `resolveSpawnPosition()`.

## Moradon reality check

Moradon is zone 21 and does contain attackable monsters in the pinned 1298 database. The committed verified slice contains these K_MONSTER templates:

- 750 Worm
- 751 Earth worm
- 752 Blood worm
- 754 Carrion crawler
- 755 Snatcher
- 850 Bandicoot
- 851 Wild Bandicoot
- 852 Scavenger Bandicoot
- 853 Rabid Bandicoot
- 854 Cannibal Bandicoot

Twenty verified K_NPCPOS rows expand to 135 deterministic runtime spawn slots. No synthetic Moradon mob is used as production data.

## Lifecycle

Runtime states:

`idle -> [patrolling] -> aggro -> chasing|attack-intent -> returning -> idle`

Death lifecycle:

`idle|patrolling|aggro|chasing|attack-intent|returning -> dead -> corpse -> despawned -> idle(respawn)`

`dead` is the authoritative one-shot kill boundary. `corpse` represents the source regeneration wait. For verified K_NPCPOS spawns, the complete source `RegTime` is used for the death/regeneration delay; WS25 does not invent a separate production corpse timeout. `despawned` is an explicit deterministic scheduler phase before respawn.

The runtime instance ID is stable for a spawn slot: `<groupId>/<spawnId>`. Respawn keeps the same ID and increments `spawnEpoch`. This mirrors OpenKO's server-side NPC serial being allocated to the instance rather than recreated as a new logical spawn identity for each life.

## Deterministic scheduler

`DeterministicMobScheduler` has no `setTimeout`, wall-clock read, or random source. The host advances caller-supplied monotonic time in fixed ticks. Catch-up count is bounded.

Target selection is deterministic:

1. world supplies candidate snapshots;
2. WS25 rejects wrong-zone/invalid/dead/combat-vetoed candidates;
3. source search range is enforced;
4. nearest distance wins;
5. lexical target ID is the stable tie-breaker.

## Movement boundary

WS25 never computes a path or mutates movement as if it were WS15. It emits:

- `movement.chase(intent)`
- `movement.returnHome(intent)`
- `movement.patrol(intent)` only when a verified/fixture patrol path exists
- `movement.stop(intent)`
- `movement.onNoPath(intent)` notification

WS15/adapters call `syncPosition()` with authoritative coordinates and `reportMovementOutcome(mobId, 'progress'|'stuck'|'no-path', atMs)` with path/movement outcomes. Consecutive stuck outcomes can trigger return-home; no pathfinder is embedded in WS25.

## Combat boundary

WS25 never computes or applies damage. It emits `combat.attackIntent()` only when the current target is valid, in source attack range and `combat.canAttack()` approves. Source attack delay gates repeated intents.

Authoritative HP is fed back with `applyHealth()`. Zero HP emits the single `dead` event.

## Target loss and leash

A target is cleared/returned from when it is missing, dead, leaves the zone, fails combat policy, or either mob/target exceeds the verified leash envelope from home. Return completion requires authoritative WS15 position sync within `returnTolerance`.

## Assist and threat fidelity

OpenKO AIServer contains `FindFriend(type=0)`, documented as help from the same group and family, and scans within `m_bySearchRange`. WS25 therefore emits a source-backed `world.onAssistSignal()` carrying group, family, search range, target and origin. It does **not** guess the remaining friend-target propagation rules; the world/integration layer can implement them when the exact region behavior is frozen.

OpenKO also has `m_DamagedUserList`, explicitly documented for experience distribution, plus a separate `ChangeTarget()` attacker-retarget routine. This is not evidence for a generic cumulative MMO threat table. WS25 therefore does not invent weighted threat/taunt scores. Exact attacker retarget scoring remains an integration TODO until the complete 1298 `ChangeTarget()` policy is frozen.

## World visibility

WS25 tracks only player snapshots supplied by WS14. It exposes deterministic hooks for:

- player enter region -> nearby mob spawn events;
- player leave region -> nearby mob despawn events and player-state cleanup;
- mob position sync -> visibility delta events;
- mob corpse despawn / respawn -> nearby despawn/spawn events.

Visibility membership itself is delegated to `world.isMobVisibleToPlayer()` so WS25 does not duplicate WS14's region-cell rules.
