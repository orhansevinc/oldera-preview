# WS07 status

- Workstream: `WS07`
- Branch: `ws07-database`
- State: `PASS / PRODUCTION PERSISTENCE FOUNDATION READY`
- Database: PostgreSQL 16
- Verified implementation commit: `12213278673210c65b8c1514c025838ca542296b`
- GitHub Actions push run: `38522512065`
- GitHub Actions job: `115715241396` — `success`

## Scope completed

- Audited the existing `0001` schema and retained it checksum-stable.
- Added forward migration `0002_persistence_hardening.sql` for account nation/lifecycle safety, independent world/progression/item versions, exact WS17 persistence slot bounds, WS22 trade persistence, WS45 CAS leases and cross-domain operation receipts.
- Added separate adapters for WS03, WS14, WS17, WS22, WS27, WS45 and WS46 plus idempotency receipts for loot/economy composition.
- Hardened the pre-existing WS07 account/character/inventory facades so normalized varchar binding and WS17 persistence capacities agree with the production schema.
- Added deterministic non-production fixture (`ws07test / WS07Hero`) with environment-supplied password only.
- Added real PostgreSQL integration tests for concurrent inventory/coin writes, optimistic stale writes, rollback injection, global serial uniqueness, CAS leases, operation idempotency, audit immutability, account-delete protection, legacy repository compatibility and connection interruption/recovery.
- CI tests fresh migration, migration idempotency, real `0001 -> current` upgrade, schema verification and EXPLAIN index plans on PostgreSQL 16.
- Added schema, migration/rollback, repository-matrix and least-privilege/security documentation.

## CI evidence

The authoritative PostgreSQL 16 push run for implementation commit `12213278673210c65b8c1514c025838ca542296b` completed successfully:

- syntax/static check: PASS;
- unit tests: `6/6` PASS;
- fresh migration: `0001_init.sql` + `0002_persistence_hardening.sql` PASS;
- second migration run/idempotency: PASS;
- deterministic development fixture: PASS;
- schema verification: `18 tables`, `8 critical indexes`, `2 migrations` PASS;
- DB integration tests: `15/15` PASS;
- concurrency and transaction-failure scenarios: PASS;
- connection interruption/pool recovery: PASS;
- EXPLAIN: intended indexes selected for active sessions, account bans, live characters, session ownership and active trade lookup;
- upgrade rehearsal: disposable DB `0001 -> 0002 -> idempotent rerun -> schema verify` PASS.

## Composition boundary / blocker

The current WS03 memory repository call sites invoke repository methods synchronously. PostgreSQL I/O is asynchronous, so WS07 publishes the production async `PgWs03SessionRepository` but deliberately does not edit WS03. Before the browser/runtime can remove the WS03 in-memory fixture completely, the WS03 owner/integration workstream must make those existing repository calls awaitable and inject this adapter.

This is an external composition blocker only; there is no unresolved WS07 schema, migration, repository, concurrency or CI failure.

## Notes

- No other workstream implementation was modified by WS07.
- The GitHub-hosted runner emitted a non-blocking warning that some third-party Actions still target deprecated internal Node 20 and are forced onto Node 24. The project test runtime itself was explicitly set up as Node 22 and passed.
