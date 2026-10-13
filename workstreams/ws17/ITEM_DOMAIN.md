# WS17 — OldKO 1298 Item / Inventory / Equipment Domain

## Scope

This module is a server-side domain layer only. It owns item instances, inventory/equipment/inn placement, moves, equip/unequip validation, transaction boundaries and duplicate-serial defenses. It deliberately contains no client, combat, merchant NPC, admin or database migration logic.

## Legacy 1298-compatible shape

The domain uses the old KO server layout as its default shape:

- 14 equipment slots (`0..13`)
- 28 inventory slots (`0..27`)
- 196 inn/warehouse slots (`0..195`)
- legacy stack ceiling default: 9999

Equipment slot constants are the old ordering: right ear, head, left ear, neck, breast, shoulder, right hand, waist, left hand, right ring, leg, left ring, glove, foot.

No Cospre, magic bag, modern PUS inventory, Genie or later item-system concepts are introduced.

## Item templates and real table adapter

`ItemTemplateRegistry` consumes an adapter with `get(itemId)` and normalizes only domain facts needed by inventory logic.

`Legacy1298TableAdapter` is the bridge for parsed 1298 item table rows. It understands common legacy fields such as `Num`, `strName`, `Countable` and `Duration`. Equip-slot interpretation is intentionally delegated to a `slotResolver(row)` supplied by the table integration layer, because the raw `Slot/Kind` semantics must come from the actual 1298 table/parser rather than guessed mappings.

## Item instance

An instance contains:

- `templateId`
- `serial` as an unsigned decimal string (safe for 64-bit KO serial values)
- `quantity`
- `durability`

Non-stackable items are forced to quantity `1`. Stackable items obey the template limit (9999 by default).

When splitting a stack into an empty slot, the caller must provide a fresh `splitSerial`. This prevents the common dupe bug where two physical stacks accidentally inherit the same serial. Merging stacks keeps the destination serial and removes the source instance if fully consumed.

## Containers

Locations are expressed as `{ container, slot }`, where `container` is one of:

- `equipment`
- `inventory`
- `inn`

`equip()` and `unequip()` are convenience wrappers over the same atomic move primitive. Inn support is an interface-level container only; no merchant or NPC behavior exists here.

## Atomicity and transaction boundary

`ItemDomainService` never edits a persisted state directly. Every mutating operation runs inside `repository.transact(ownerId, work)`.

The included `InMemoryItemRepository` is a reference/test implementation:

1. lock the owner aggregate;
2. clone committed state;
3. run the domain operation on the clone;
4. validate local serial uniqueness;
5. enter a global commit lock;
6. validate global serial uniqueness and version;
7. replace the committed state and serial index;
8. discard the draft automatically if any step throws.

A production DB repository should preserve this boundary with one DB transaction and row/version locks. The service API does not depend on any DB schema.

## Dupe prevention architecture

Defense is intentionally layered:

1. serial format is normalized at item creation;
2. one serial per item instance;
3. local aggregate duplicate scan before every commit;
4. global serial index validation at commit;
5. global commit mutex in the reference repository closes cross-owner races;
6. `duplicateSerialHook(details)` emits a detection event for logging/ban/audit integration without coupling this module to admin code;
7. `scanForDuplicateSerials()` supports offline/health verification;
8. stack splits require a new serial instead of cloning the original one.

For the production DB adapter, enforce a unique index/constraint on the canonical item-instance serial column in addition to the service checks. WS17 does not add that migration because DB migrations are explicitly out of scope.

## Concurrency behavior

Concurrent operations for the same owner serialize. Concurrent creation of the same serial for different owners is resolved under a global commit section: one commit succeeds and the other fails with `DUPLICATE_SERIAL`. Failed operations do not mutate committed state.

## Public API

```js
const {
  ItemTemplateRegistry,
  Legacy1298TableAdapter,
  InMemoryItemRepository,
  ItemDomainService,
  EQUIPMENT_SLOTS,
  CONTAINER_TYPES,
} = require('./services/ko1298-items');
```

Core service methods:

- `createItem(ownerId, destination, itemInput)`
- `move(ownerId, from, to, options)`
- `equip(ownerId, inventorySlot, equipmentSlot)`
- `unequip(ownerId, equipmentSlot, inventorySlot)`
- `moveToInn(ownerId, from, innSlot, options)`
- `moveFromInn(ownerId, innSlot, to, options)`

## Error contract

Domain failures throw `ItemDomainError` with a stable `code`, including:

`INVALID_SLOT`, `SOURCE_EMPTY`, `SLOT_OCCUPIED`, `ITEM_NOT_EQUIPPABLE_HERE`, `DUPLICATE_SERIAL`, `STACK_LIMIT_EXCEEDED`, `SPLIT_SERIAL_REQUIRED`, `CONCURRENT_MODIFICATION` and other validation codes.
