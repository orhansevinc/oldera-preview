# WS17 Status

**Workstream:** WS17  
**Branch:** `ws17-item-inventory`  
**Scope:** production-grade OldKO 1298 item / inventory / equipment domain

## Completed

- Preserved the original 12/12 item/inventory baseline; no client, combat formula, merchant business logic or DB migration work was added.
- Production `Legacy1298TableAdapter` with pinned 1298 OpenKO source provenance and requested-ID/source-ID mismatch protection.
- Verified 1298 attach-point resolver and OpenKO item-class category model.
- Level/class/stat requirements plus fail-closed race/nation restriction resolver boundary; no unverified race/nation mapping is promoted to production data.
- Legacy equip slot compatibility and symmetric two-hand/off-hand conflict rules.
- Stack max, merge/split/remainder, fresh split serial and corner-case validation.
- Durability range, broken-state contract and repair behavior.
- Immutable equipment modifier snapshot and WS19 read-only combat item snapshot ports.
- Legacy carried-weight calculation, max-weight enforcement and pickup/trade/Inn-return capacity checks.
- Merchant buy insertion / sell removal item transaction boundaries without pricing or merchant logic.
- Loot insertion boundary and WS26-compatible capacity/serial/grant port.
- WS22 economy item port whose writes require the supplied outer transaction draft; no nested independent item commit.
- Unique serial generator boundary, local/global duplicate detection and authoritative serial count port.
- Persistence `23505` uniqueness rollback mapping.
- Single-owner and multi-owner idempotency keys.
- Concurrent move/equip/sell/pickup protections and atomic multi-owner trade escrow.
- Commit-only transaction journal/event output.
- Save/load snapshot contract, disconnect/abort rollback, corruption validator and orphaned-template utility.
- Explicit WS33 account-scoped Inn integration boundary.
- Deterministic fuzz/soak suite with 6,000 randomized move/swap/merge/split/Inn operations plus 200 concurrent source races.

## Verified source anchors

- WS31 canonical item catalog / provenance review (`ws31-data-catalog`).
- `Open-KO/ko-client-assets@b4636332c7cd818b0ce171eccc973dd3d6b2e56d:Data/Item_Org_us.tbl.csv`.
- `Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5:src/Client/WarFare/GameDef.h`.
- OpenKO 1298 client inventory/warehouse behavior for weight and stack handling.
- WS19 equipment projection contract, WS22 atomic economy contract, WS26 loot adapter contract, WS33 Inn transaction contract and WS07 persistence contract.

## Production invariants

See `workstreams/ws17/PRODUCTION_INVARIANTS.md`.

## Verification

```bash
node --test tests/ko1298-items/*.test.js
```

Local verification: **97/97 PASS** including original 12 tests and production/fuzz additions.

CI workflow remains `.github/workflows/ws17-items.yml` (Node 20) and is triggered by the final branch commit.

## Integration blockers / boundaries

- Full production template coverage still depends on wiring the complete real 1298 item table loader; WS17 deliberately does not copy the table into its branch.
- Race/nation restrictions are populated only by a verified integration resolver; no guessed raw-field semantics are accepted.
- Production account-scoped Inn persistence remains WS33+WS07 integration work.
- Coin/item atomicity requires WS22's outer transaction manager; WS17 supplies tx-aware item mutations and does not own coin rows.
- DB uniqueness remains defense-in-depth in WS07/persistence; no migration is added here.
