# WS07 status

- Workstream: `WS07`
- Branch: `ws07-database`
- State: `IMPLEMENTED / CI VERIFICATION REQUIRED ON COMMIT`
- Database: PostgreSQL 16

## Scope completed

- Audited the existing `0001` schema and retained it checksum-stable.
- Added forward migration `0002_persistence_hardening.sql` for account nation/lifecycle safety, independent world/progression/item versions, exact WS17 persistence slot bounds, WS22 trade persistence, WS45 CAS leases and cross-domain operation receipts.
- Added separate adapters for WS03, WS14, WS17, WS22, WS27, WS45 and WS46 plus idempotency receipts for loot/economy composition.
- Added deterministic non-production fixture (`ws07test / WS07Hero`) with environment-supplied password only.
- Added real PostgreSQL integration tests for concurrent inventory/coin writes, optimistic stale writes, rollback injection, global serial uniqueness, CAS leases, operation idempotency, audit immutability, account-delete protection and connection interruption/recovery.
- CI now tests fresh migration, migration idempotency, real `0001 -> current` upgrade, schema verification and EXPLAIN index plans on PostgreSQL 16.
- Added schema, migration/rollback, repository-matrix and least-privilege/security documentation.

## Composition boundary

The current WS03 memory repository methods are called synchronously by WS03. PostgreSQL I/O is asynchronous, so WS07 publishes the production async adapter but does not edit WS03. The integration owner must make those existing repository call sites awaitable before replacing the memory fixture. No other workstream implementation is changed here.

## Local verification before push

- `node --check` passed for every newly added adapter, script and integration-test source.
- The DB-backed suite cannot be executed in this tool container because no PostgreSQL server/client is installed; the branch workflow uses a PostgreSQL 16 service container and is the authoritative DB execution evidence.

## CI evidence

Pending the implementation commit/workflow run. This section must not be interpreted as a fabricated PASS. The final handoff should cite the actual GitHub Actions run/status if GitHub publishes one.
