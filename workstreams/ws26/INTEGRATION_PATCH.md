# WS26 Integration Patch

WS26 is intentionally isolated from WS17, WS18, WS19 and WS25 implementation code. Integration should be done by adapters in the eventual integration branch; do not copy domain logic between workstreams.

## WS25 -> WS26 mob death adapter

On the authoritative WS25 mob-death transition, call:

```js
await lootService.createFromMobDeath({
  eventId,             // stable, unique death-event id
  mobInstanceId,
  mobTemplateId,
  killerCharacterId,
  zoneId,
  position: { x, z },
  diedAt
});
```

If WS25 has contributors/damage metadata, pass it under `context`; WS26 will not interpret it until the ownership/reward rule is verified.

`eventId` is the idempotency boundary. Re-delivery of the same death event does not generate a second set of loot.

## Drop-table repository adapter

Provide:

```js
const dropTables = {
  async findForMob(mobTemplateId) {
    // Return null for no configured table.
    // Return { id, rolls, entries } only from verified production data.
  }
};
```

Do not promote `world-data/drops/fixture.synthetic.json` to production data.

## WS17 inventory/item adapter

Provide four ports:

```js
const inventory = {
  async canAccept({ characterId, itemId, quantity }) {
    // Delegate to WS17 authoritative capacity/slot rules.
    return { ok: true }; // example shape only
  }
};

const serials = {
  async createForDrop({ itemId, quantity, loot }) {
    // Delegate item metadata/serial rules to WS17.
    // Return null only when WS17 says this grant needs no unique serial.
    return generatedSerial;
  }
};

const serialGuard = {
  async reserve(serial) { /* authoritative duplicate prevention */ },
  async commit(serial) { /* finalize with successful item transaction */ },
  async release(serial) { /* rollback reservation after failed grant */ }
};

const items = {
  async grant({ characterId, itemId, quantity, serial, source }) {
    // Perform WS17 atomic inventory mutation.
  }
};
```

The ideal final adapter should execute serial reservation + inventory mutation in the same authoritative transaction boundary. `InMemorySerialGuard` is only a reference/test implementation.

## WS18 party adapter

Replace `KillerOwnershipPolicy` with an adapter implementing:

```js
const ownership = {
  async resolveOwners(event) {
    return {
      characterIds: eligibleCharacterIds,
      publicAfterMs: null // or a verified value/rule
    };
  },
  async canPickup({ loot, characterId, now }) {
    // Apply WS18 party loot mode and ownership state.
    return trueOrFalse;
  }
};
```

WS26 intentionally does not invent party loot modes or historical ownership timers.

## Distance adapter

Provide:

```js
const distance = {
  async canPickup({ characterId, zoneId, characterPosition, lootPosition }) {
    // Use authoritative world/movement position and verified 1298 pickup radius.
    return trueOrFalse;
  }
};
```

No numeric pickup radius is hardcoded in WS26.

## Coin economy adapter

If verified drop tables contain coin entries, provide:

```js
const coins = {
  async grant({ characterId, amount, source }) {
    // Delegate to the authoritative coin/economy transaction service.
  }
};
```

Without this adapter, coin pickup fails with `COIN_PORT_REQUIRED`.

## Composition

```js
const lootService = new LootService({
  ports: {
    dropTables,
    ownership,
    distance,
    inventory,
    serials,
    serialGuard,
    items,
    coins
  },
  lootLifetimeMs: verifiedOrConfiguredLifetime
});
```

The default 60-second lifetime is configuration convenience, not a verified historical value. Set an authoritative value during integration if/when confirmed.
