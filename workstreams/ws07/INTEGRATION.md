# WS07 integration contract

WS07 owns PostgreSQL schema, migration tooling and persistence adapters only. It does not edit WS03/14/17/22/27/45/46 business implementations.

Use one PostgreSQL pool from `services/oldko-data/src/index.js` and import consumer-specific adapters from `services/oldko-data/src/adapters/`. Repository details and the only known composition seam (WS03 synchronous memory call sites versus async DB I/O) are documented in `REPOSITORIES.md`.

Core transaction policy:

- default multi-row mutation isolation: `SERIALIZABLE` with retries for SQLSTATE `40001`/`40P01`;
- WS22 lock keys: sorted transaction-scoped advisory locks, then row locks inside repositories;
- WS17: account lock + character lock before shared inn/inventory mutation;
- WS14/WS27: optimistic versions reject stale saves;
- WS45: single-statement compare-and-set on `(scope, lease_key, version)`;
- operation receipts: reserve idempotency key in the same transaction as the mutation.

Migrations, schema, security and rollback guidance live in the adjacent WS07 documents. WS30 remains the owner of backup/restore execution; WS07 preserves its `_oldko_migrations` contract.
