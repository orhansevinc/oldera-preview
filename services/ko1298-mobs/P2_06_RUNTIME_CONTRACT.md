# P2-06 Mob Runtime Contract

Owner: P2-06 (`phase2/06-mobs`)

Baseline: `ws50-integration-rehearsal@50ecabec15bd358d222a01891ca31359f3a928b0`

Continues:

- WS25 mob authority: `18c9e9b8439fef88fc93d74bfec7981b0cb41958`
- WS36 world-clock mechanics: `adf25c055f50f26cbbc9ba81254307019ff5bcbd`

This provider does **not** edit the P2-00-owned `services/ko1298-session/production-composition.js`, dispatcher, domain runtime, deploy files, browser binaries, or P2-04 world implementation.

## 1. Moradon invisibility root cause

The verified zone-21 input is present and valid: 10 K_MONSTER rows, 20 active K_NPCPOS rows and 135 deterministic runtime slots. The current login coordinate is `(312, 402)`. Every verified Moradon monster source rectangle in the current slice has `z <= 329`. WS25 `getNearby()` uses the existing 48-unit region / current-plus-one-neighbor AOI contract. Therefore the initial login AOI contains zero of the 135 mob slots.

The wire path itself exists in WS14: `VisibilityWorldSessionService` merges `mobPort.getNearby()` into `WIZ_NPC_REGION (0x1C)` and serves requested details through `WIZ_REQ_NPCIN (0x1D)`. At login this correctly has no mob IDs because `getNearby()` is empty.

The actual runtime break after the player walks toward a monster field is composition: Phase-1 production composition creates only `new MobVisibilityService(...)`, initializes it once, and supplies it as `mobPort`. It does not run the combat/AI service, does not own one central mob tick, does not feed P2-04 player region changes into `playerEnteredRegion/playerLeftRegion`, and does not route resulting WS25 visibility events to `VisibilityWorldSessionService.consumeMobVisibilityEvent(...)`. Consequently a player who starts with zero mobs does not receive later dynamic mob IN/OUT through the current live composition.

P2-06 fixes the provider side with `createMobProductionRuntime()`; P2-00 must perform the shared runtime wiring described below.

## 2. Provider API

```js
const {
  createMobProductionRuntime,
  loadVerifiedWorldDefinition,
} = require('../ko1298-mobs');

const runtime = createMobProductionRuntime(worldDefinition, ports);
runtime.initialize(nowMs);
```

The runtime wraps the existing `MobCombatService`; it is not a second mob implementation.

### Required P2-04/world ports

```text
terrain.resolveHeight(zoneId, x, z)
runtimeIds.claim(identity)
world.visibilityKey(player) -> stable AOI/region key
world.isMobVisibleToPlayer(player, mob) -> boolean
movement.chase(intent)
movement.returnHome(intent)
movement.stop(intent)
movement.patrol(intent)
```

Optional world methods `listAggroCandidates(request)` and `getTargetSnapshot(id)` may replace the adapter's injected player snapshots. P2-04 remains authoritative for zone/region/collision/path results and common entity ID allocation.

P2-04 calls:

```text
runtime.playerUpsert(playerSnapshot, nowMs)
runtime.playerDisconnected(playerId, nowMs)
runtime.syncMobPosition(runtimeIdOrSourceIdentity, authoritativeXYZ, nowMs)
runtime.reportMovementOutcome(runtimeIdOrSourceIdentity, progress|stuck|no-path, nowMs)
```

The adapter never invents a path or wall bypass. A no-path result returns the existing mob AI to its sourced home/leash flow.

### Required P2-07/combat port

```text
combat.attackIntent(intent)
```

Optional `isTargetAlive`, `canAggro`, and `canAttack` predicates may be supplied by P2-07. P2-06 never calculates or applies damage from its own attack intent.

P2-07 returns authoritative absolute HP through:

```text
runtime.applyCombatResult(runtimeIdOrSourceIdentity, {
  ok: true,
  requestKey,
  attackerId,
  targetId,
  absoluteTargetHp
}, nowMs)
```

The inherited WS25 combat-result ledger rejects replay of the same attacker/request/target tuple.

### P2-08/death event

A successful zero-HP transition emits exactly one provider event per accepted combat request:

```text
kind: mob-death
payload.eventId: ko1298-mob-death:<runtimeId>:<requestKey>
```

P2-08 must persist/dedupe this `eventId` before reward/drop application. Reprocessing the same event must not create another reward. P2-06 does not implement items or drops.

### Visibility events for the real client

`events.onEvent(event)` receives:

```text
visibility-in  -> { player, snapshot, event }
visibility-out -> { player, snapshot, event }
```

P2-00 shared composition routes these to the already-existing WS14 API:

```text
worldSession.consumeMobVisibilityEvent(player.id, snapshot, event)
```

and sends the returned `clientPackets` through the owning socket. Packet bytes remain P2-04/WS14 authority; P2-06 emits semantic mob records/events only.

## 3. Single-timer CPU model

`runtime.start()` owns one interval for the complete population (default 100 ms), not one timer per mob. Calling `start()` twice returns the same timer. `benchmarkTicks()` measures the shared loop without embedding a hardware-specific pass/fail threshold. The exact Windows-PC CPU number must be collected by P2-00/P2-13 on the intended machine; a GitHub/Linux timing number is not substituted for that requirement.

## 4. Source boundaries and unresolved production facts

`world-data/mobs/P2-06_SOURCE_AUDIT.json` separates source-backed data, browser assets and unresolved facts.

- Current Moradon slice: 10 normal monsters / 135 slots, no source-backed boss row or boss schedule.
- PID 800 Bandicoot client model/joint/animation/parts/textures are source-verified by the WS38 asset manifest.
- PID 700 Worm-family client binary mapping is not closed by the inspected asset manifest.
- Exact animation-state IDs for all ten rows are not inferred.
- WS36 proves deterministic world-clock/schedule mechanics. It does not prove any boss spawn time. P2-06 therefore exposes no fabricated timed boss.

A sourced boss schedule can be connected only after an authoritative boss row/schedule source is supplied. The final composition must use a durable schedule/lease authority so restart cannot create two instances from one schedule event.

## 5. P2-00 shared-file request

Replace the production-only `MobVisibilityService` construction with `createMobProductionRuntime(worldDefinition, ports)`, keep its `.getNearby()` surface as the world session `mobPort`, start exactly one tick loop, feed P2-04 player/region and movement results into the runtime, route `visibility-in/out` to `VisibilityWorldSessionService.consumeMobVisibilityEvent`, route `attack-intent` to P2-07, and route `mob-death.eventId` to P2-08.

Do not change the accepted website/admin UI, camera, browser renderer or HTML. Do not widen AOI or move monster source coordinates inside P2-06 to make login screenshots look populated; any world-region policy change belongs to P2-04.
