# WS30 — Domain-Live Recovery Status

## Scope

WS30 owns backup/recovery tooling and recovery evidence only. It does not modify WS07, WS13, WS08 or WS09 product branches and never connects to production during the CI rehearsal.

## Pinned provider authority

- WS07: `eaac4700c3535c449f6a2b7d20c925bc61382c35`
- WS13: `e53966d9f882d98e2a5b4746262f38355dfda848`
- PostgreSQL: 16
- WS07 migrations: `0001_init`, `0002_persistence_hardening`, `0003_public_account_api`, `0004_admin_persistence`
- WS13 service migration: `services/account-api/sql/0001_postgres_rate_limit.sql`, intentionally outside the WS07 numbered ledger.

## Domain-live rehearsal implementation

The previous synthetic `recovery-tests/sql/ws07_contract_fixture.sql` path is retired. CI checks out the exact pinned provider commits, verifies migration SHA-256 values and account/admin adapter blobs, applies the real migrations, inventories the resulting schema, seeds only real schema surfaces, performs a custom-format `pg_dump`, verifies SHA-256 and `pg_restore --list`, destroys the disposable source DB, restores to a clean DB, and checks metadata/schema/ledger/row integrity.

Post-restore validation includes account↔character/session/token/rate-limit state, character stat/skill/world-save state, item serial/equipment/inventory/inn placement, admin session/idempotency, command status, audit/serial history, sanctions, session lease, PK/FK/unique semantics, sequence state and immutable audit/history triggers.

Minimum application reads are executed through the exact pinned WS07 `PgWs13AccountRepository` and `PgWs08AdminRepository` implementations.

## Migration and rollback safety

`backup/postgres/backup_before_migrate.sh` implements a fail-closed preflight → disk → backup → archive integrity → optional disposable restore → migration → postcheck gate. Forward-only migration rollback is a verified pre-migration backup plus the previous compatible app release; WS30 does not invent SQL down migrations.

`restore.sh` requires destructive-restore approval, an environment marker and exact `RESTORE_CONFIRM_DATABASE`; production additionally requires the approved-incident token. Administrative databases are refused.

## Recovery contract

Machine-readable authority: `workstreams/ws30/DOMAIN_LIVE_RECOVERY_CONTRACT.json`.

Readiness is CI-gated by `.github/workflows/ws30-recovery.yml` on the final WS30 head.
