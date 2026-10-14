# WS22

## DURUM

Production transaction-domain hardening complete on `ws22-merchant-economy`; integration-ready with one explicit external data/persistence wiring condition below.

## MERCHANT

- Source-backed merchant catalog identity model with provenance enforcement.
- Verified Caspy identity: template `13001`, Moradon zone `21`, selling group `203002`.
- Verified 1298 catalog adapter implements legacy `tradeID -> sellGroup/extension` mapping and canonical client price formula.
- Buy/sell validation: positive safe quantity, canonical price, balance, ownership, unique serial, unreserved quantity, inventory capacity/stack adapter, overflow.
- Optional forwarded client price mismatch is rejected; real 1298 packet price is never authoritative.
- WS16 adapter contract covers spoofed merchant id, wrong zone and too-far requests.
- Buy/sell item+coin+audit are one transaction and roll back together.

## TRADE

- Invite / accept / reject / cancel / disconnect / timeout.
- Explicit logical escrow states: invited / holding / released / committed.
- Item and coin reservation without early physical mutation.
- Any offer change resets both confirmations.
- Two confirmations trigger one atomic swap after full revalidation.
- Recipient-full failure, duplicate serial, stale balance, transfer failure and concurrent double-confirm roll back safely.
- One active trade per player prevents same player/item entering simultaneous WS22 trades; cross-process equivalent required in persistence.
- Audit events emitted for all material state transitions.

## COIN

- BigInt arithmetic; no floating point balance math.
- Verified representational ceiling: uint32 `4,294,967,295`.
- Compatibility default `2,100,000,000` retained but explicitly not labeled as a verified 1298 gameplay cap.
- Atomic add/remove API with mandatory reason metadata.
- Negative/overflow balance rejected; active trade reservation is honored.

## ATOMICITY

Merchant and player-trade mutations require one shared `transactionManager.run()` boundary spanning coin, WS17 item mutation, trade state and audit append. WS22 does not duplicate WS16/WS17 business logic or add DB migrations.

## SOAK

- Seeded deterministic trade simulation exercises more than 1000 transaction-domain operations with coin conservation.
- Seeded fuzz-style success/rejection sequences exercise more than 1000 public trade operations while preserving total coins and non-negative balances.
- Partial-stack test proves quantity conservation and unique split serial behavior through the inventory adapter contract.

## TEST

Local Node 20-compatible suite: **33/33 PASS**.

Coverage includes merchant matrix, provenance/catalog derivation, spoof/wrong-zone/range, canonical price manipulation, quantity/overflow, stack merge capacity, buy/sell rollback, reservation conflicts, reasoned coin mutations, trade state/escrow, disconnect active stages, timeout, simultaneous invites, double confirm, recipient-full rollback, duplicate serial, item/coin conservation, deterministic soak and seeded fuzz operations.

CI workflow: `.github/workflows/ws22-economy.yml` runs syntax checks and the full `tests/ko1298-economy/*.test.cjs` suite on pushes to this branch. The exact CI command was also reproduced locally and passed 33/33.

## COMMIT

Final exact branch commit is reported by the WS22 closing response after this status is committed.

## BLOCKER

No WS22 domain-logic blocker. Production runtime still needs integration wiring for the complete real 1298 basic/extension item tables (WS31/data layer) and a WS07/WS17 shared persistence transaction adapter. WS22 deliberately does not fabricate missing catalog rows or split a multi-resource transaction.
