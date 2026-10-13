# WS17 Integration Patch

## Integration status

Ready as an isolated domain/service module. No main merge is performed by WS17.

## Required production adapters

1. **1298 item table adapter**
   - Parse/load the real 1298 item table in the owning data layer.
   - Construct `Legacy1298TableAdapter({ getRow, slotResolver })`.
   - `slotResolver` must map the real 1298 table `Slot/Kind` semantics to the 14 legacy equipment slot indexes; do not guess or import modern slot rules.

2. **Persistence repository**
   - Implement `read(ownerId)` and `transact(ownerId, work)` with the same semantics as `InMemoryItemRepository`.
   - Keep inventory + equipment + inn changes in one DB transaction.
   - Use row/version locking or an equivalent optimistic concurrency guard.
   - Roll back on any thrown domain error.

3. **Serial uniqueness**
   - Back the domain checks with a DB-level unique constraint/index on canonical item serial storage.
   - Wire `duplicateSerialHook` to audit/telemetry; do not put ban/admin behavior inside this module.

4. **Session/protocol layer**
   - Translate 1298 item-move packets into `ItemDomainService.move/equip/unequip` calls.
   - Convert `ItemDomainError.code` to protocol-appropriate failure responses in the session layer.
   - Do not let the protocol/session layer mutate inventory state directly.

## Suggested wiring

```js
const adapter = new Legacy1298TableAdapter({
  getRow: itemTable.get,
  slotResolver: resolve1298EquipmentSlots,
});
const templates = new ItemTemplateRegistry(adapter);
const repository = new SqlItemRepository(db);
const items = new ItemDomainService({ repository, templates });
```

## Integration invariants

- One committed serial may exist in only one physical item instance.
- Stack split requires a fresh serial.
- All moves are atomic.
- Equip compatibility is checked before commit.
- Inventory is 28 slots, equipment is 14 slots, inn is 196 slots unless the authoritative 1298 server data adapter proves otherwise and integration explicitly overrides the storage mapping outside this domain.
- No modern inventory systems are to be layered into WS17.
