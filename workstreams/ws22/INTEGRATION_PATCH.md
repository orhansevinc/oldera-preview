# WS22 Integration Patch

## Current branch situation

WS22 starts from `main` as requested. At implementation time, `ws16-npc-world` and `ws17-item-inventory` still point to the same baseline commit as `main`, so there is no concrete WS16/WS17 service API to import yet. WS22 therefore publishes strict adapter contracts instead of modifying or guessing either workstream's implementation.

## Required WS17 adapter

Create an adapter outside WS22 or during integration that maps WS17's final API to:

```text
canReceiveNpcPurchase({ playerId, itemTemplateId, quantity, tx })
addNpcPurchase({ playerId, itemTemplateId, quantity, sourceNpcId, tx })
getOwnedItem({ playerId, itemSerial, tx })
removeOwnedItem({ playerId, itemSerial, quantity, tx })
countSerial({ itemSerial, tx })
canReceiveTrade({ playerId, incoming, outgoing, tx })
transferItem({ fromPlayerId, toPlayerId, itemSerial, quantity, tx })
```

Integration requirements:

- WS17 remains the sole authority for item instance creation and serial generation.
- `countSerial()` must query authoritative storage, not only the caller's inventory cache.
- `transferItem()` must preserve unique serial semantics. Partial-stack split serial behavior belongs to WS17.
- Capacity checks must account for outgoing slots and stack merging before final trade commit.
- All WS17 writes must use the `tx` supplied by WS22; do not open an independent transaction inside the adapter.

## Required WS16 adapter

Map the final WS16 merchant/NPC API to:

```text
assertInteraction({ playerId, npcId, tx })
getOffer({ npcId, itemTemplateId, tx })
```

`assertInteraction()` should reject invalid NPC type, invalid zone/range and disallowed interaction state.

`getOffer()` must return server-authoritative prices:

```text
{
  npcSellPrice,  // player buys from NPC
  npcBuyPrice,   // player sells to NPC
  canBuy,
  canSell
}
```

Do not pass a client-declared price into WS22.

## Required DB/repository adapter

WS22 deliberately adds no migration. Integration needs repositories that implement:

```text
coinRepository.getBalance(playerId, { tx })
coinRepository.setBalance(playerId, balance, { tx })
tradeRepository.create(trade, { tx })
tradeRepository.get(tradeId, { tx })
tradeRepository.save(trade, { tx })
tradeRepository.findActiveByPlayer(playerId, { tx })
transactionManager.run(lockKeys, callback)
```

The transaction manager must provide a single atomic boundary for:

- coin row writes
- WS17 inventory/item writes
- trade state writes

Recommended integration behavior (owned by the DB/integration workstream, not WS22):

- lock both player coin rows before final trade arithmetic;
- lock inventory/item rows being moved;
- enforce unique item serial at persistence level in addition to WS22 runtime checks;
- enforce non-negative coin and authoritative coin cap at persistence level as defense in depth;
- prevent two active trades for one player via transactional locking/constraint strategy;
- commit only after all item, coin and trade-state writes succeed.

## Packet/server integration

WS22 is a domain service and does not implement KO packet opcodes. The session/protocol layer should translate validated 1298 packet fields into WS22 method calls and map `EconomyError.code` values to protocol responses. Never treat a packet's item price, owner, balance or serial validity as authoritative.
