# WS26 Loot Model

## Scope

This module owns the server-side **Drop / Loot / Reward domain** for OldKO 1298. It does not implement combat, mobs, inventory, parties, persistence, the client, or verified historical drop data.

No authoritative KO 1298 drop dataset was available in the WS26 starting branch. Therefore **no production mob -> item/coin values are asserted here**. `world-data/drops/fixture.synthetic.json` is synthetic test-only data and is explicitly marked as a fixture.

## Event boundary

WS25 (mob domain) should emit a mob-death event to `LootService.createFromMobDeath()` with:

- `eventId`: stable/idempotency key for the death
- `mobInstanceId`
- `mobTemplateId`
- `killerCharacterId`
- `zoneId`
- `position: { x, z }`
- optional `diedAt` and opaque `context`

Repeated calls with the same `eventId` return the first result and do not roll a second reward.

## Drop table

A table has:

- `id`: stable table id
- `rolls`: positive integer number of weighted draws
- `entries`: one or more weighted entries

Entry kinds:

- `item`: `itemId`, `weight`, `minQuantity`, `maxQuantity`
- `coin`: `weight`, `minQuantity`, `maxQuantity`
- `none`: `weight` only; represents a draw that produces no ground loot

Weights are relative positive integers. For each roll, one ticket in `[1, sum(weights)]` is selected. Quantity is then selected uniformly and inclusively in `[minQuantity, maxQuantity]`.

This is a deterministic domain model for integration and testing. It must not be interpreted as a claim that these exact table semantics or any fixture weights match the historical 1298 server until verified source data is supplied.

Invalid/impossible definitions are rejected before rolling: empty tables, unknown kinds, zero/negative/non-integer weights, zero/negative/non-integer quantities, `minQuantity > maxQuantity`, invalid item ids, unsafe totals, and non-positive roll counts.

## RNG

`SeededRng` is a deterministic xorshift32 generator. Tests can pass an explicit numeric seed to `createFromMobDeath(event, { seed })`. Production can inject a different `rngFactory`; WS26 does not require a specific cryptographic/random provider.

## Ground loot lifecycle

Each non-`none` reward becomes one ground-loot record with:

- source death/mob/table ids
- zone and position
- reward (`item` or `coin`)
- owner character ids
- optional `publicAt`
- `expiresAt`

The default lifetime is 60 seconds but is configuration, **not a historical 1298 claim**. Expired loot cannot be picked up and `sweepExpired()` despawns available expired records.

## Ownership / party boundary

Ownership is a port, not embedded party logic. `KillerOwnershipPolicy` is a safe default that grants the killer ownership and never opens the loot publicly. WS18 can provide a party-aware policy implementing:

- `resolveOwners(event) -> { characterIds, publicAfterMs }`
- `canPickup({ loot, characterId, now }) -> boolean`

This allows round-robin, leader, random member, contributor, or other verified rules to be added later without changing WS26.

## Pickup validation

Pickup is denied unless all applicable checks pass:

1. loot exists and is not busy/expired;
2. character zone matches the loot zone;
3. ownership policy permits the character;
4. injected distance validator permits the pickup;
5. for items, injected inventory-capacity check permits the grant.

The actual 1298 pickup radius is intentionally not hardcoded because it was not verified in WS26.

## WS17 item boundary

WS26 never mutates inventory directly. Item pickup uses four injected ports:

- `inventory.canAccept(...)`
- `serials.createForDrop(...) -> serial | null`
- `serialGuard.reserve/commit/release(serial)`
- `items.grant(...)`

The serial factory may return `null` for item types that do not require a unique serial. Non-null serials are reserved before grant; duplicate reservation fails; a failed item grant releases the reservation. `InMemorySerialGuard` exists for tests/reference, while WS17 should back this with its authoritative transaction/duplicate-serial mechanism.

## Coin boundary

Coin rewards require an injected `coins.grant(...)` port. If no coin port is configured, coin pickup fails explicitly with `COIN_PORT_REQUIRED` rather than silently losing or inventing currency state.

## Concurrency

A pickup marks the record `claiming` before the first grant-side effect. A concurrent second pickup receives `LOOT_BUSY`. On a failed grant, the original `available` record is restored so a later retry is possible.
