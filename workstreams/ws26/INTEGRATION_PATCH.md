# WS26 Integration Patch

WS26 stays isolated from WS17, WS19, WS22, WS25 and WS07 implementation code. Production integration is adapter-based; do not copy business logic between workstreams.

## WS25 / WS19 -> WS26 death boundary

On an authoritative mob-death transition call:

```js
await productionLootService.createFromMobDeath({
  eventId,
  mobInstanceId,
  mobTemplateId,
  killerCharacterId,
  zoneId,
  position: { x, z },
  diedAt,
  context
});
```

`eventId` is the death idempotency key. WS26 persists even an empty no-drop outcome so redelivery/restart cannot reroll rewards.

## WS31 verified drop adapter

Production uses `Verified1298DropTableAdapter` with:
- `monsterMappings`: `K_MONSTER.sSid -> K_MONSTER.sItem`, plus `K_MONSTER.iMoney`;
- `dropTables`: the five item/chance slots from `K_MONSTER_ITEM`;
- `itemGroups`: the 30 entries from `MAKE_ITEM_GROUP`;
- pinned `verified-1298` provenance.

`ProductionLootService` rejects non-verified tables. The old weighted `LootService` remains fixture/back-compat only.

## Required production ports

- `dropTables.findForMob(monsterTemplateId)` — WS31 adapter.
- `itemTemplates.exists({ itemId })` — verified WS31/WS17 item existence.
- `ownership.resolveOwners(event)` / `ownership.canPickup(...)` — killer/party ownership adapter.
- `playerState.getLootState({ characterId })` — authoritative alive/worldReady/connected/zone/position state from WS19/WS14/WS15 integration.
- `distance.canPickup(...)` — WS15 authoritative pickup-range adapter.
- `inventory.canAccept(...)` — WS17 capacity/stack contract.
- `serials.createForDrop(...)`, `serialGuard.reserve/commit/release(...)` — WS17 serial invariant.
- `items.grant(...)` — WS17 inventory mutation using the supplied transaction handle.
- `coins.grant(...)` — WS22 coin mutation using the supplied transaction handle.
- `transactions.run({ transactionId }, fn)` — WS07 durable transaction boundary.
- `lootStore.loadDeathRewards/persistDeathRewards/markClaimed/despawn` — WS07 persistence adapter.
- `replay.begin/commit/release` — persistent pickup replay/idempotency adapter.
- `audit.append(event)` — audit sink, transaction-aware where supported.

### Durable rehydration invariant

`lootStore.loadDeathRewards(eventId)` has three-state semantics:
- return `null` only when the death outcome has never been persisted;
- return `[]` when the death outcome exists but produced no loot **or** every produced loot record has already been claimed/despawned;
- otherwise return only still-live ground-loot records.

`markClaimed()` and `despawn()` must atomically make those loot IDs ineligible for later rehydration. A service restart followed by redelivery of the same death event must never resurrect consumed loot.

## Pickup request

Production request shape:

```js
await productionLootService.pickup({
  lootId,
  characterId,
  requestId
});
```

Do not trust packet zone/position. WS26 obtains authoritative player state from `playerState` and passes that to the WS15 distance adapter. The state is checked again inside the claim transaction so a disconnect or zone transition between validation and commit fails closed.

## Atomic claim contract

Claim transaction ID is stable: `loot-claim:<lootId>`.

Within one WS07 transaction WS26 orchestrates:
1. authoritative player-state recheck;
2. WS17 capacity/stack acceptance;
3. serial reservation when required;
4. WS17 item grant **or** WS22 coin grant;
5. serial commit for item rewards;
6. persisted loot claim/uniqueness check;
7. replay-key commit;
8. audit event.

The WS07 adapter must rollback every transaction-aware participant if persistence/commit fails. WS26 restores only its transient in-memory claim state; it intentionally does not reimplement WS17 or WS22 rollback logic.

## Ownership / party

No party distribution algorithm is embedded in WS26. Round-robin/random/public-after-time behavior must remain adapter-controlled and disabled unless exact 1298 behavior is verified.

If an ownership adapter supplies `publicAfterMs`, it must also set `publicAfterVerified: true`; otherwise production loot rejects the policy.

## Ground-loot expiry

Expiry/despawn is persisted under `loot-despawn:<lootId>` before the in-memory ground record is removed. The configured lifetime is runtime policy unless/until an exact historical 1298 value is verified.
