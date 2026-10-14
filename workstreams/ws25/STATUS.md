WS25

# Status

- Workstream: `WS25`
- Branch: `ws25-mob-ai`
- State: `MORADON MOB HEIGHT PASS / INTEGRATION-READY`
- Scope: verified Moradon mob population + authoritative WS14 terrain/shape height materialization

## Result

WS25 now consumes WS14 through an explicit `terrain.resolveHeight(zoneId, x, z)` dependency. It does not copy WS14 terrain/SMD logic.

For every production `dataClass=real` mob spawn:

1. WS25 keeps its deterministic X/Z projection inside the verified K_NPCPOS source rectangle.
2. WS25 calls the WS14 height resolver with exactly that zone/X/Z.
3. Only `status=authoritative` with finite `height` is accepted.
4. No y=0, constant-Y, manual source-Y or guessed fallback exists in the production path.
5. Initial materialization fails closed before emitting a spawn when height is not authoritative.
6. Respawn stays despawned/deferred and retries with a fresh WS14 height resolve until authoritative.

## Exact authorities used by CI

- WS14 height authority: `ws14-world-session@9b82adefb05a3cca32f430e25f8a1d9109db93b2`
- 1298 Moradon SMD authority: `Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5`, `assets/Server/MAP/moradon_0826.smd`
- SMD git blob: `cf47772b8e42a8bad71032419f47978c8bbd6142`
- WS31 catalog authority: `ws31-data-catalog@546d2ab62cd46a97f3385ebcddbe0c775a02c2eb`
- WS11 visibility authority: `ws11-protocol-lab@944b6ff9b6329af29f1048a74aa6e14fca141639`

## Verified Moradon regression

Current WS31/WS25 slice:

- 10 verified monster templates: 750, 751, 752, 754, 755, 850, 851, 852, 853, 854;
- 20 selected verified K_NPCPOS source rows/groups;
- 135 deterministic runtime spawn slots;
- deterministic X/Z stays inside source rectangle;
- deterministic projection is not claimed to reproduce original 1298 RNG sequence.

Real-SMD CI result:

```text
verified templates:       10
verified spawn rows:      20
deterministic slots:     135
resolved slots:          135
authoritative slots:     135
terrain surface:         130
shape surface:             5
```

All 135 slots therefore materialize with real WS14 authoritative Y. No slot used fallback height.

## Coordinate basis

Each real mob carries:

- `spawnAnchor`: deterministic verified-rectangle X/Z + heading;
- `spawnOrigin`: current authoritative materialization of that anchor;
- `position`: runtime authoritative position;
- `home`: authoritative home used by AI leash/chase/return-home.

At spawn, `position == spawnOrigin == home` after WS14 height resolution. X/Z remain equal to `spawnAnchor`.

At respawn, the same deterministic verified X/Z slot is retained, but WS14 is called again and the new authoritative Y is applied atomically to `position`, `spawnOrigin` and `home` before the spawn event.

## WS15 movement boundary

WS25 still emits only movement intents:

- chase;
- return-home;
- patrol;
- stop;
- no-path/stuck outcomes.

WS15 remains the movement authority and feeds runtime positions back through `syncPosition()`. No WS15 pathfinding/movement implementation was copied.

## WS19 combat boundary

WS25 still emits attack intents and consumes authoritative absolute HP. No WS19 damage/combat implementation was copied.

## Visibility protocol

WS25 does not encode browser packets.

Current WS11 visibility authority verifies the mob/NPC visibility family (`WIZ_NPC_REGION`, `WIZ_REQ_NPCIN`, `WIZ_NPC_INOUT`, NPC detail record) and reports no remaining WS50 visibility-evidence blocker. WS25 therefore leaves protocol encoding to the WS11/composition boundary rather than adding a local encoder.

Historical `WS50-C3` remains immutable and still records the blocker state that existed when C3 was frozen. This branch is for a subsequent provider-set candidate; C3 must not be mutated.

## Test / CI

GitHub Actions run `38585109050`, job `115924879964`:

```text
WS25 deterministic unit + lifecycle suite
25 tests / 25 pass / 0 fail

real WS14 SMD height integration
1 test / 1 pass / 0 fail
135 / 135 authoritative slots
surface split: terrain=130, shape=5
```

The workflow checks out the exact WS14 provider, exact WS31 catalog provider and pinned OpenKO Moradon SMD before running the real height integration test.

## Handoff

```text
requires terrain.height-authority -> WS14@9b82adefb05a3cca32f430e25f8a1d9109db93b2
requires visibility.protocol       -> WS11@944b6ff9b6329af29f1048a74aa6e14fca141639
requires WS31 monster catalog      -> WS31@546d2ab62cd46a97f3385ebcddbe0c775a02c2eb
```

No browser encoder, WS15 movement implementation, WS19 combat implementation, WS14 height logic copy, main merge or new workstream is part of this change.
