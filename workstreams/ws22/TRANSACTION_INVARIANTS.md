# WS22 Transaction Invariants

1. **No money from client input.** Merchant price is canonical server data; real 1298 BUY/SELL packets do not carry a trusted price.
2. **No negative/overflow coin.** Every balance and transaction amount is integer `BigInt` within configured cap.
3. **Coin conservation in player trade.** Final `A + B` coin total equals pre-trade `A + B` coin total.
4. **Item conservation in player trade.** Final item quantity equals pre-trade quantity; WS17 owns split serial creation.
5. **One serial, one physical item instance.** `countSerial() !== 1` rejects sell/trade staging/finalization.
6. **One active trade per player.** Prevents parallel escrow and same-item double reservation within WS22; DB integration must enforce cross-process equivalent.
7. **Reservation before settlement.** Staged coin/items are logical escrow; conflicting WS22 spend/sell is rejected until release/commit.
8. **Offer mutation invalidates confirmation.** Any staged item/coin change resets both confirmations.
9. **Finalization revalidates everything.** Balance, ownership, quantity, tradeability, serial uniqueness and capacity are checked again under final locks.
10. **Single atomic boundary.** Merchant item+coin and trade item+coin+state+audit either all commit or all roll back.
11. **Timeout/disconnect are release-only.** Since assets were not physically escrowed, cancel paths never create compensating assets.
12. **NPC authority is external but mandatory.** WS16 adapter must prove merchant identity, zone, range and current interaction validity.
13. **Inventory authority stays in WS17.** WS22 never reimplements slot, stack, split-serial or item-instance business logic.
14. **Persistence authority stays in WS07.** WS22 supplies lock keys and `tx`; repository adapters own SQL isolation/constraints.
15. **Unverified data fails closed.** Manual merchant offers require provenance; real catalog construction uses verified 1298 table semantics.
