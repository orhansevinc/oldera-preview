# WS33 Integration Patch

## Merge order

Recommended dependency order:

1. WS07 database/persistence
2. WS17 item/inventory domain
3. WS16 NPC world/interaction
4. WS33 Inn Storage

WS33 itself does not require those branches to be modified. It exposes ports so integration can happen in the composition layer after branches are merged.

## WS17 item adapter

Use `createWs17CompatibleItemPort()` with WS17's existing item functions:

```js
const { createWs17CompatibleItemPort, InnStorageService } = require('./services/ko1298-inn');
const { createItemInstance, withQuantity } = require('./services/ko1298-items/item-instance');

const itemPort = createWs17CompatibleItemPort({
  templates,
  createItemInstance,
  withQuantity,
});

const inn = new InnStorageService({ repository: innRepository, items: itemPort });
```

WS33 does not call WS17's generic `moveToInn`/`moveFromInn` directly because Inn operations must atomically span **character inventory + account-scoped warehouse** and enforce account ownership/concurrency at the repository boundary.

## WS07 persistence adapter

Implement the WS33 repository interface on top of WS07 without migration changes:

```text
readInn(accountId)
transact({ accountId, characterId, signal }, work)
```

Production transaction requirements:

- SERIALIZABLE isolation (WS07 `withTransaction()` already supports this).
- Verify `oldko.characters.id = characterId` belongs to `accountId` and lock the character/account context.
- Load 28 inventory placements for the character and 7x28 Inn placements for the account.
- Lock item instances/placements touched by the transaction (`FOR UPDATE`).
- Apply the draft in the same DB transaction. When a full stack merge consumes the source stack, update the destination quantity and remove the consumed source item instance/placement atomically so no orphaned value remains.
- Rely on existing `item_instances.serial UNIQUE` and `prevent_duplicate_item_placement()` as DB-level backstops.
- Enforce WS33 bounds (`page 0..6`, `slot 0..27`) even though WS07 schema allows a wider range.
- Abort/rollback if the session cancellation signal is set before commit.

Do not add or change a WS07 migration from WS33.

## WS16 Inn Hostess interaction

WS33 exports:

```js
const { createInnHostessHandler } = require('./services/ko1298-inn');
const innHandler = createInnHostessHandler({ service: inn });
```

When WS16 has a verified 1298 Inn Hostess NPC classification, route only that interaction to `innHandler({ session, npc })`. WS33 deliberately supplies no guessed NPC ID/type and does not alter `services/ko1298-npc`.

The returned object is:

```text
{
  kind: 'inn-storage',
  interface: 'inn',
  accountId,
  characterId,
  npc,
  storage
}
```

## Economy boundary

Do not wire WS22 coin balance into WS33 item transfer methods. This implementation carries no coin field and performs no coin mutation, so item moves cannot accidentally mint/burn Noah.

## Concurrency/rollback guarantees to preserve

Any production repository adapter must preserve the guarantees tested by WS33:

- same-account transfers are serialized or conflict-detected;
- a shared Inn slot cannot be overwritten by concurrent characters;
- duplicate serial commit loses atomically and triggers the hook;
- template/service failure causes full rollback;
- disconnect/abort before commit causes full rollback;
- per-template item quantity is conserved across inventory + Inn.
