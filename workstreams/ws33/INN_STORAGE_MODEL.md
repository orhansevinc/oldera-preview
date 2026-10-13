# OldKO 1298 Inn Storage Model (WS33)

## Scope

WS33 owns the server-side **Inn Hostess / Account Warehouse / Inn Storage** domain. It does not own item creation, item templates, NPC spawning, coin economy, database migrations, or client protocol encoding.

## 1298 capacity

The domain uses the legacy 1298 warehouse capacity already declared by WS17: **196 total item slots**. The inventory side is **28 slots**. For the Inn UI/domain this is represented as **7 pages x 28 slots**:

- page: `0..6`
- slot within page: `0..27`
- flat Inn slot: `page * 28 + slot`, `0..195`
- inventory slot: `0..27`

The 196-slot value is also independently consistent with legacy KO shared-memory definitions (`WAREHOUSE_MAX 196`). WS07's database checks are intentionally more permissive, so WS33 performs the patch-specific 7x28 validation in the service layer without changing migrations.

## Ownership model

Inn storage is scoped to **account**, not character. Every character associated with the same account sees the same 196 Inn slots. Inventory remains character-scoped. A transfer therefore always carries both `accountId` and `characterId`, and the repository must verify that the character belongs to the account before mutation.

## Item model and WS17 boundary

WS33 treats items using the WS17-compatible shape:

```text
{ templateId, serial, quantity, durability, ... }
```

The service depends on an item port with three operations:

- `getTemplate(templateId)`
- `withQuantity(item, quantity)`
- `createSplit(template, sourceItem, quantity, serial)`

`createWs17CompatibleItemPort()` adapts the WS17 template registry, `createItemInstance()` and `withQuantity()` functions without modifying WS17.

### Serial rules

- Full slot-to-slot move preserves the exact serial.
- Partial stack split requires a caller-supplied **new positive unique serial**.
- Merge preserves the destination stack serial. If the source stack is fully consumed, that source instance ceases to be placed; no new serial is invented by WS33.
- The repository validates local and global serial uniqueness before commit and can invoke a duplicate-serial detection hook.

## Transfer semantics

Supported operations:

- inventory -> Inn (`deposit`)
- Inn -> inventory (`withdraw`)

Rules:

1. Source slot must contain an item.
2. Destination may be empty, or may contain the same stackable template.
3. Different-item destination is rejected; WS33 never performs an implicit swap.
4. Non-stackable instances transfer only as quantity 1.
5. A split into an empty destination requires `splitSerial`.
6. Stack merge is exact: if the requested amount would exceed `maxStack`, the whole operation is rejected. WS33 does not silently move a smaller quantity.
7. No transfer path handles coins. Coin/bank economy remains outside this domain.

## Atomicity, rollback and disconnects

The repository contract is transaction-oriented:

```text
transact({ accountId, characterId, signal }, work)
```

The transaction must atomically cover the character inventory and the shared account Inn state. The provided in-memory reference implementation:

- serializes all mutations for the same account;
- validates account/character ownership;
- mutates a detached draft;
- checks abort/disconnect signal before work and immediately before commit;
- checks duplicate serials;
- checks item-quantity conservation;
- commits the whole draft or commits nothing.

If template lookup, validation, duplicate checking, abort handling, or commit validation fails, the draft is discarded.

## Conservation invariant

For an Inn transfer, total quantity per `templateId` across all character inventories in the account plus the account Inn must be identical before and after the transaction. This invariant makes item creation/deletion bugs visible at the repository boundary.

Coins are not present in the WS33 state model, so the service cannot mint, burn, deposit, or withdraw coins.

## Persistence boundary (WS07)

A production WS07 adapter should execute the WS33 repository contract in a SERIALIZABLE transaction and lock the relevant account/character/item placement rows. Existing WS07 storage maps correctly to:

- `oldko.inventory.character_id + slot`
- `oldko.inn_storage.account_id + page + slot`
- `oldko.item_instances` for serial/template/stack/durability

WS07 already has unique item serials and a cross-placement duplicate-prevention trigger. WS33 adds stricter patch-specific page/slot and ownership validation above that layer.

## NPC boundary (WS16)

`createInnHostessHandler()` is a WS16-style interaction adapter. It accepts `{ session, npc }`, resolves the authenticated account and selected character, opens the account warehouse, and returns `kind: 'inn-storage'` / `interface: 'inn'`.

WS33 intentionally does **not** invent an Inn Hostess NPC ID or modify WS16 routing/spawn data. WS16 can bind the handler once an authenticated 1298 Inn Hostess NPC definition is available.
