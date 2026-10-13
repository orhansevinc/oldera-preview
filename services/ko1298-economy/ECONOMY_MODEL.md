# OldKO 1298 Economy Model (WS22)

## Scope

This domain owns merchant pricing decisions, coin balance safety, NPC buy/sell orchestration and player-to-player trade state. It does **not** own item persistence, NPC world logic, database migrations, client packets, combat, admin or website behavior.

## Security invariants

1. Client-supplied prices are never accepted. NPC buy/sell prices come only from `merchantPort.getOffer()` inside the transaction.
2. Coins are handled as integer `BigInt` values. Negative balances, negative staged amounts and balances above the configured cap are rejected before mutation.
3. Default coin cap is `2,100,000,000`; the integration adapter may supply the authoritative 1298 cap explicitly.
4. A sell/trade item serial must exist exactly once in authoritative inventory storage. `countSerial() !== 1` rejects the operation.
5. WS22 never generates production item serials. Serial creation/split semantics belong to WS17's item service.
6. NPC item+coin mutations and final player trade item+coin mutations must execute in one shared transaction boundary.
7. Trade staging is metadata only. No coin or item is removed during staging, invite, accept or first confirmation.
8. Final trade commit re-reads current balances, ownership, quantities, serial uniqueness, tradeability and receiving capacity. Stale staged data cannot bypass current state.
9. Any staged-offer change clears both final confirmations.
10. A player may participate in only one active (`pending` or `open`) trade.
11. Trade finalization locks the trade plus both player/inventory domains. Duplicate concurrent confirmations cannot apply the exchange twice.
12. Disconnect/cancel marks the trade inactive. Because staging never escrowed assets, rollback has no compensating coin/item creation step.

## Transaction model

`transactionManager.run(lockKeys, work)` is the mandatory mutation boundary. Production integration must map this to the same authoritative transaction used by coin persistence, WS17 inventory writes and trade repository writes (for example a DB transaction plus row/advisory locks).

A callback receives `tx`. Every mutating repository/port call in that callback receives the same `tx` object. If any validation or write throws, the transaction manager must roll back **all** writes from the callback.

Lock keys are semantic and deterministic:

- `player:<id>` protects coin/trade participation state.
- `inventory:<id>` protects inventory capacity and item movement.
- `trade:<id>` serializes trade state/confirmation changes.
- `serial:<serial>` may be used by adapters for serial-level locking; WS22 also requires authoritative serial uniqueness validation.

## Ports

### `coinRepository`

- `getBalance(playerId, { tx }) -> BigInt-compatible integer`
- `setBalance(playerId, balance, { tx })`

`setBalance` is called only with a validated value between `0` and `maxCoins` inclusive.

### `merchantPort` (WS16 adapter)

- `assertInteraction({ playerId, npcId, tx })`
- `getOffer({ npcId, itemTemplateId, tx }) -> { npcSellPrice, npcBuyPrice, canBuy?, canSell? }`

Naming is from the NPC perspective:

- `npcSellPrice`: player pays this amount per unit when buying from NPC.
- `npcBuyPrice`: player receives this amount per unit when selling to NPC.

`assertInteraction` must enforce that the entity is a valid merchant and that the player may currently interact with it (zone/range/state as decided by WS16).

### `inventoryPort` (WS17 adapter)

- `canReceiveNpcPurchase({ playerId, itemTemplateId, quantity, tx }) -> { ok, reason? }`
- `addNpcPurchase({ playerId, itemTemplateId, quantity, sourceNpcId, tx })`
- `getOwnedItem({ playerId, itemSerial, tx })`
- `removeOwnedItem({ playerId, itemSerial, quantity, tx })`
- `countSerial({ itemSerial, tx }) -> integer`
- `canReceiveTrade({ playerId, incoming, outgoing, tx }) -> { ok, reason? }`
- `transferItem({ fromPlayerId, toPlayerId, itemSerial, quantity, tx })`

The WS17 adapter owns stack rules, equipment/inventory slot rules, item metadata and serial generation. If a partial stack transfer requires a new serial, WS17 must create it atomically and preserve uniqueness.

### `tradeRepository`

- `create(trade, { tx })`
- `get(tradeId, { tx })`
- `save(trade, { tx })`
- `findActiveByPlayer(playerId, { tx })`

The production repository must participate in the same transaction as coin/item mutations. An index/constraint or equivalent locking strategy should prevent multiple active trades per player across processes.

## NPC buy flow

1. Validate IDs and positive integer quantity.
2. Lock player + inventory.
3. Validate merchant interaction through WS16 adapter.
4. Read canonical `npcSellPrice` from merchant adapter.
5. Checked multiply price × quantity.
6. Read and validate current coin balance.
7. Validate destination capacity through WS17 adapter.
8. Stage coin debit and WS17 item credit in the same transaction.
9. Commit once; any failure rolls both back.

## NPC sell flow

1. Lock player + inventory + serial domain.
2. Validate merchant interaction.
3. Require serial occurrence count exactly `1`.
4. Require item ownership and sufficient quantity.
5. Read canonical `npcBuyPrice` using authoritative item template ID.
6. Reject non-sellable item.
7. Checked-add proceeds to balance; reject overflow before item removal.
8. Remove item/quantity and credit coins in the same transaction.

## Player trade state machine

`pending -> open -> completed`

Alternative terminal states:

- `pending -> rejected`
- `pending/open -> cancelled`

While `open`, each participant has:

- staged item serial + quantity entries
- staged coin amount
- one final-confirmation flag

Any offer edit clears both confirmation flags.

On the second final confirmation, WS22 revalidates both offers and atomically performs all transfers. The coin equation is zero-sum:

- A final = A balance - A staged coins + B staged coins
- B final = B balance - B staged coins + A staged coins

Both results must remain in `[0, maxCoins]`.

## Failure behavior

Validation errors throw `EconomyError` with stable `code` values such as:

- `INSUFFICIENT_COINS`
- `COIN_OVERFLOW`
- `NEGATIVE_COIN`
- `INVENTORY_CAPACITY`
- `INVALID_ITEM_SERIAL`
- `ITEM_NOT_OWNED`
- `ITEM_NOT_TRADEABLE`
- `PLAYER_ALREADY_TRADING`
- `TRADE_NOT_OPEN`

Unexpected adapter failures are allowed to propagate. The transaction manager is responsible for rollback in both expected and unexpected failures.
