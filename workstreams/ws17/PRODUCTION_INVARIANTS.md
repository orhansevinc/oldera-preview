# WS17 Production Invariants

## Scope

WS17 owns the server-side OldKO 1298 item instance, inventory, equipment and mutation boundaries. It does not own client code, merchant pricing/business rules, combat formulas, DB migrations, NPC interaction rules, coin arithmetic or packet encoding.

## Verified 1298 data boundary

Production item templates must enter through `Legacy1298TableAdapter` / `ItemTemplateRegistry` with provenance. The canonical references used by the adapter are pinned to:

- `Open-KO/ko-client-assets@b4636332c7cd818b0ce171eccc973dd3d6b2e56d:Data/Item_Org_us.tbl.csv`
- `Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5:src/Client/WarFare/GameDef.h`

The requested item ID must equal the source row ID. Production callers may enable `requireVerifiedProvenance`; an unverified row fails closed. WS31 catalog data is source metadata, not a replacement for the complete real item table.

Verified client attach-point values are preserved (`DUAL=0`, right/left hand `1/2`, two-hand `3/4`, armor `5..9`, jewelry/accessory `10..14`, inventory `15`). Item class categories use the OpenKO 1298 class enum. Race/nation restrictions are never inferred from guessed columns: a table integration must provide them through `restrictionResolver` only when the source mapping is verified.

## Placement and serial invariants

- Exactly 14 legacy equipment slots, 28 character inventory slots and 196 legacy Inn slots exist in the WS17 aggregate shape.
- One slot contains zero or one item instance.
- A physical item instance has one canonical unsigned decimal serial string.
- A serial may occur at most once inside an owner aggregate and at most once globally.
- Stack split creates a fresh serial; it never clones the source serial.
- Full stack merge keeps the destination serial and consumes the source instance when the remainder is zero.
- The production repository must additionally enforce serial uniqueness at persistence level. SQLSTATE `23505` is mapped to `PERSISTENCE_UNIQUENESS_VIOLATION` and the mutation is rolled back.
- `countSerial()` must be authoritative storage/global-index backed. It must not consult only a session inventory cache.

## Quantity and stack invariants

- Non-stackable items always have quantity `1`.
- Stackable quantity is `1..maxStack`; legacy default ceiling is `9999` only when the real template does not provide a narrower limit.
- Merge cannot exceed `maxStack`; excess remains in the source stack.
- Partial swap into an occupied incompatible slot is rejected.
- Move/swap/merge/split operations conserve quantity by template unless the operation is an explicit insertion/removal boundary.

## Equip invariants

- Equipment compatibility is derived from the verified 1298 attach point, not guessed from names.
- Equip validates level, class, verified race/nation restrictions and required stats against authoritative character context.
- If a template carries requirements and no authoritative character context is available, equip fails closed.
- Two-hand-right and two-hand-left policies require the opposite hand to be empty; a one-hand item cannot be equipped against an already equipped two-hand item.
- Requirement/equip failure leaves the committed state unchanged.

## Durability and broken-state contract

- Durable instances default to template maximum durability.
- Durability is always `0..maxDurability`.
- A durable item with durability `0` is `broken=true`.
- Repair above zero clears the broken flag; positive repair is capped at template maximum.
- WS17 does not invent a combat formula for broken gear. Its read-only projection excludes broken-item stat modifiers and reports broken weapon damage as zero so WS19 receives an explicit safe state.

## Snapshot ports

`getEquipmentModifierSnapshot()` exposes equipped item modifiers as a read-only aggregate. `getCombatItemSnapshot()` exposes right/left weapon identity/kind/damage/delay/range/durability plus the equipment aggregate; WS19 remains the combat-formula owner. Equipping/unequipping does not mutate base character stats in WS17; consumers rebuild or apply the immutable snapshot.

## Weight invariants

- Item weight uses the legacy table integer unit (`siWeight`, tenths shown by the 1298 client).
- Carried weight = equipment + character inventory. Inn contents are not carried weight.
- Stack weight = template weight × quantity.
- Create, pickup, merchant insertion, loot insertion, trade receive and Inn→inventory/equipment transitions enforce authoritative `maxWeight` when character context provides it.
- Pure carried-container rearrangement does not make an already-overweight legacy state impossible to repair; only a transition that increases carried weight above the maximum is rejected.

## Atomicity and idempotency

- Every repository-owned mutation edits a draft and becomes visible only after commit validation.
- Same-owner operations serialize. Multi-owner trade escrow locks owners in stable order and commits both drafts or neither.
- Abort/disconnect signal before commit produces `OPERATION_ABORTED` and no committed mutation.
- Journal records are appended only for committed operations.
- Idempotency keys are supported by single-owner merchant/loot boundaries and multi-owner trade escrow. Re-delivery returns the committed prior result without replaying the item mutation.

## WS22 economy boundary

`createEconomyItemPort()` provides the WS22-facing item adapter. Write methods require the **outer** WS22 transaction's item draft; they do not open an independent WS17 transaction. Therefore coin rows, item rows and trade state can commit or roll back together in the integration transaction. WS17 performs no pricing or coin arithmetic.

The preflight `canReceiveTrade()` applies outgoing removals to a cloned draft before simulating incoming items, so slots freed by the same trade and stack merging are considered. Final authority remains the outer transaction/DB locks.

## WS26 loot boundary

`createLootItemPort()` exposes capacity preflight, serial generation and transaction-aware item grant. Loot event/death idempotency remains owned by WS26; item grant can participate in the same supplied item draft. Production serial reservation/unique constraints remain repository/DB responsibilities; WS17 never treats a test-only in-memory guard as authoritative persistence.

## WS33 Inn boundary

The generic 196-slot `inn` container remains for legacy aggregate compatibility/tests. Production account-scoped Inn transfer must use WS33's account+character SERIALIZABLE transaction so character inventory and shared account warehouse are locked and committed together. WS17 must not independently commit a character-local move inside that outer WS33 transaction.

## Trade escrow boundary

`transferTradeEscrow()` is an in-domain multi-owner reference boundary. `transferBetweenDrafts()` is the external transaction variant used when WS22 owns the outer transaction. Partial stack transfer mints a fresh serial and conserves total quantity. Target failure leaves source ownership unchanged.

## Persistence, validation and recovery

- `saveSnapshot()` / `loadSnapshot()` form the repository snapshot contract.
- Load validates before import; corrupt snapshots fail closed.
- `validateInventory()` detects invalid serials, duplicate serials, invalid quantity/durability and invalid equipment placement.
- `findOrphanedItems()` identifies item instances whose template cannot be resolved.
- DB adapters should preserve SERIALIZABLE/row-lock semantics and the existing WS07 unique serial/placement constraints; WS17 adds no migration.

## Soak invariants

Deterministic randomized operation sequences must finish with:

1. global serial uniqueness;
2. no duplicate placement/slot occupancy;
3. item quantity conservation for pure moves/swaps/merges/splits;
4. stack limits respected;
5. corruption validator clean;
6. no partial visibility after failed/aborted transactions.
