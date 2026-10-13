# WS25 Status

Status: **implementation complete on `ws25-mob-ai`**

## Delivered

- Deterministic monster template / instance model.
- Zone spawn groups with stable instance IDs.
- Idle, chasing, returning, dead and despawned lifecycle states.
- Deterministic nearest-target selection with lexical tie-break.
- Aggro policy hooks owned by the WS19 adapter.
- Chase/return/stop intents owned by the WS15 adapter.
- Leash and return-home behavior using authoritative position sync.
- Absolute HP input, death, corpse despawn and respawn lifecycle.
- WS14 world hooks for spawn/state/despawn and target snapshots.
- Strict fixture-vs-real-data validation; no claimed real 1298 IDs.
- Synthetic Moradon lifecycle fixture.
- Unit tests covering spawn IDs, targeting, combat veto, leash, return-home, death/despawn/respawn, invalid target cleanup and data validation.
- Dedicated GitHub Actions workflow.

## Explicitly out of scope

- Damage formulas, attack cooldowns, skills, drops and rewards.
- Pathfinding/navmesh and movement simulation.
- World session implementation or packets.
- Database persistence/migrations.
- Real monster/model/stat tables until verified source data is available.
- Advanced AI (patrols, assist, threat tables, scripted bosses, group tactics).

## Verification

Run from repository root:

```bash
node --test tests/ko1298-mobs/*.test.cjs
```

Or:

```bash
npm --prefix services/ko1298-mobs test
```

The tests are dependency-free and use Node's built-in test runner.
