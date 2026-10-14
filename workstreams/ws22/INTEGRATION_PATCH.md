# WS22 Integration Patch

## WS16 merchant boundary

WS16 now publishes `merchantInterface({ session, npc })` and supplies the NPC `sellingGroup` (Caspy: `203002`). Build `merchantPort.assertInteraction()` on that authoritative world entity/session context. It must reject non-merchant/spoofed id, wrong zone, excessive range and invalid interaction state. Return a merchant context containing at least runtime id, template id, zone id and selling group; pass that context to `getOffer()`.

Do not duplicate world/range logic in WS22.

## Verified 1298 catalog adapter

Wire parsed client item tables into `Legacy1298MerchantTableAdapter`:

```js
const table = new Legacy1298MerchantTableAdapter({
  basicRows: itemBasicRows,
  getExtension: (extIndex, extId) => itemExtensionTables[extIndex].get(extId),
});

const offers = table.listOffers(npc.sellingGroup);
```

The adapter implements the exact legacy client rule: `tradeID / 1000` selects `bySellGroup`; `tradeID % 1000` selects the extension id; item id is basic id + extension id; canonical prices use verified legacy price multiplier/sell ratio behavior.

`VerifiedMerchantCatalog` may be used for cached/materialized offers, but every manually injected production offer must carry provenance. Test fixtures are not production provenance.

## WS17 inventory boundary

Map WS17 without copying its business rules:

```text
canReceiveNpcPurchase({ playerId, itemTemplateId, quantity, tx })
addNpcPurchase({ playerId, itemTemplateId, quantity, sourceNpcId, tx })
getOwnedItem({ playerId, itemSerial, tx })
removeOwnedItem({ playerId, itemSerial, quantity, tx })
countSerial({ itemSerial, tx })
canReceiveTrade({ playerId, incoming, outgoing, tx })
transferItem({ fromPlayerId, toPlayerId, itemSerial, quantity, tx })
```

Capacity checks must use WS17's actual stack/slot semantics. Partial stack trade transfer must let WS17 create a fresh split serial. Never mutate WS17 storage outside the `tx` supplied by WS22.

## WS07 persistence boundary

Implement the coin/trade/audit repositories and transaction manager over one DB transaction. `setBalance()` receives `{ tx, reason, metadata }` so persistence/audit layers can retain transaction reason. Final trade must lock both participant coin/inventory domains plus the trade row. Enforce active-trade uniqueness and item serial uniqueness in persistence as defense in depth.

WS07's existing inventory move operation owns its own SERIALIZABLE transaction and must not be nested blindly. The integration adapter must expose WS17 mutations that can participate in WS22's shared transaction boundary; if the current repository API cannot do that, that adapter mismatch is an integration blocker rather than a reason to split the transaction.

## Protocol boundary

Verified legacy client protocol:

- `WIZ_NPC_EVENT 0x20`: NPC click/world interaction path.
- `WIZ_ITEM_TRADE 0x21`: NPC buy/sell/move result path.
- `WIZ_TRADE_NPC 0x25`: starts NPC trade UI.
- BUY subpacket `0x01`: tradeID, npcID, itemID, destination slot, quantity.
- SELL subpacket `0x02`: itemID, inventory slot, quantity.
- MOVE subpacket `0x03`: itemID, source slot, destination slot.

The protocol/session layer parses packets, resolves the current authoritative NPC/session context and calls WS22. It must never trust packet owner/balance/catalog/price facts. Real packets do not supply an authoritative price; `clientUnitPrice` exists only as an optional defense/test hook.
