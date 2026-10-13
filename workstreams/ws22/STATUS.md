# WS22 Status

## State

COMPLETE

## Branch

`ws22-merchant-economy`

Base: `main`

## Delivered

- Coin balance interface with configurable cap and checked integer arithmetic.
- NPC buy with authoritative merchant pricing, capacity validation and atomic coin+item transaction.
- NPC sell with authoritative pricing, ownership/quantity validation, serial uniqueness check and overflow protection.
- Player trade invite / accept / reject.
- Item staging and coin staging.
- Two-party final confirmation.
- Offer changes clear prior confirmations.
- Cancel and disconnect cancellation behavior.
- Final trade revalidation of balance, item ownership, quantity, serial uniqueness, tradeability and receiving capacity.
- Atomic player-to-player item + coin settlement.
- Rollback behavior for injected inventory failures.
- Duplicate/invalid serial rejection.
- Negative/overflow coin protection.
- Concurrency test proving duplicate second confirmation cannot double-apply a trade.
- Adapter contracts for WS16, WS17 and DB/transaction integration.
- Dedicated GitHub Actions workflow.

## Verification

Local Node test suite:

- 17 tests
- 17 passed
- 0 failed

Coverage includes happy paths, insufficient funds, capacity failure, transaction rollback, duplicate serials, coin overflow, disconnect, stale staged balance, transfer failure and concurrent final confirmation.

## Integration note

At WS22 implementation time, the WS16 and WS17 branches were still at the same baseline as `main`; therefore WS22 does not import unfinished code from those workstreams. Integration expectations are documented in `INTEGRATION_PATCH.md` and `services/ko1298-economy/ECONOMY_MODEL.md`.
