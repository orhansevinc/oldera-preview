# OldKO 1298 Economy Model — WS22

## Ownership

WS22 owns transaction orchestration for NPC merchant buy/sell, player-to-player trade state, coin arithmetic/reservations and economy audit events. It does not own NPC population/range logic (WS16), item instance/stack/serial mutation rules (WS17), database schema/migrations (WS07), or raw 1298 table acquisition (WS31).

## Verified 1298 merchant facts

The implementation is deliberately source-backed:

- `WIZ_ITEM_TRADE = 0x21`; legacy client subpackets are BUY `0x01`, SELL `0x02`, MOVE `0x03`.
- `WIZ_TRADE_NPC = 0x25` starts the NPC transaction UI.
- BUY sends `tradeID`, `npcID`, `itemID`, destination slot and quantity. SELL sends `itemID`, inventory slot and quantity. The client does **not** send an authoritative price.
- The client derives the visible merchant catalog as `basicSellGroup = floor(tradeID / 1000)` and `extensionId = tradeID % 1000`, filters item basics by `bySellGroup`, and resolves the extension row at that extension id.
- Client canonical displayed buy price is `basic.iPrice * extension.siPriceMultiply`.
- Client normal sell price is that value divided by 6 unless `SALE_TYPE_FULL`, where it is full price; verified sale types are `0=LOW`, `1=FULL`, `2=LOW_NO_REPAIR`. Premium `/4` is supported only when the integration explicitly selects it.
- OpenKO DB identifies Moradon Caspy as NPC template `13001`, zone `21`, selling group `203002`.

`Legacy1298MerchantTableAdapter` implements the verified catalog split/filter/price rules against parsed real basic/extension rows. `VerifiedMerchantCatalog` requires provenance for manually supplied identities/offers, preventing fixture data from silently becoming production merchant data.

## Merchant transaction invariants

1. NPC interaction authority comes from `merchantPort.assertInteraction()`. Spoofed NPC, wrong-zone and too-far requests must be rejected there before economic mutation.
2. Catalog membership and price come from the server-side merchant adapter. Client price is ignored; if an integration forwards one for diagnostics it must exactly match or `PRICE_MISMATCH` is returned.
3. Quantity must be a positive safe integer.
4. Buy checks authoritative balance plus active trade coin reservation before debit.
5. Inventory/stack/space checks are delegated to WS17 through `canReceiveNpcPurchase()` and the actual credit through `addNpcPurchase()`.
6. Sell requires exactly one authoritative occurrence of the serial, ownership, sufficient quantity, unreserved quantity and sellability.
7. Item mutation and coin mutation use the same `tx`; adapter failure rolls the entire transaction back.
8. Price multiplication and balance arithmetic are checked before mutation.

## Player trade / logical escrow

Trade state:

`pending -> open -> completed`

Terminal alternatives:

`pending -> rejected`

`pending/open -> cancelled`

Escrow state is explicit:

`invited -> holding -> committed`

or `invited/holding -> released` on reject/cancel/disconnect/timeout.

The escrow is a **logical reservation**, not an early physical move. Staged items remain in WS17 inventory and staged coins remain in the coin row until the second confirmation. While reserved, WS22 blocks conflicting merchant sales and coin spends. This preserves rollback simplicity: cancellation releases metadata instead of minting/restoring assets.

Any offer edit clears both confirmation flags. Finalization re-reads balances, item ownership, quantities, tradeability, serial uniqueness and recipient capacity, then swaps all item/coin state atomically. A participant may have only one active trade, which also prevents the same item being reserved into two WS22 trades. Production persistence must enforce the same active-trade uniqueness across processes.

Trades carry `expiresAt`. Expired trades are atomically cancelled with reason `timeout`; stale expired trades are cleaned before a new invite involving the same player.

## Coin model

Coins are represented as `BigInt`; floating point is never used for balances or prices.

- `PROTOCOL_MAX_COIN_VALUE = 4,294,967,295` is the verified uint32 representational ceiling from legacy `Gold` storage/transport.
- `DEFAULT_MAX_COIN_BALANCE = 2,100,000,000` is retained as a conservative compatibility policy, **not claimed as a verified 1298 gameplay cap**. Production may override `maxCoins` only from authoritative configuration/data.
- `addCoins()` and `removeCoins()` are atomic and require transaction reason metadata.
- Negative balances and arithmetic overflow are rejected.
- `removeCoins()` and merchant buy honor active trade coin reservation.

## Audit contract

`auditPort.append(event, { tx })` participates in the same transaction boundary. Events include merchant buy/sell, coin credit/debit, trade invite/accept/reject, item/coin reserve/unreserve, confirmation, completion, cancellation, timeout and disconnect cancellation.

## Persistence boundary

`transactionManager.run(lockKeys, callback)` must map to one authoritative persistence transaction shared by coin rows, WS17 item writes, trade rows and audit append. WS07 integration should use its transaction helper/locking pattern and must not perform read-delete-write outside the owning repository. Duplicate serial uniqueness remains backed by WS17/WS07 persistence constraints.
