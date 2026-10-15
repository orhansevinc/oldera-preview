# WS30 — Domain-Live PostgreSQL Backup Strategy

## Authority and scope

This contract is pinned to release `oldkoweb-domain-live-20261015` and does not follow moving provider branch heads during a rehearsal.

- WS07 source: `eaac4700c3535c449f6a2b7d20c925bc61382c35`
- WS13 source: `e53966d9f882d98e2a5b4746262f38355dfda848`
- PostgreSQL major: 16
- WS07 migration ledger: `public._oldko_migrations`
- WS07 ordered migrations: `0001_init.sql`, `0002_persistence_hardening.sql`, `0003_public_account_api.sql`, `0004_admin_persistence.sql`
- WS13 service-owned migration: `services/account-api/sql/0001_postgres_rate_limit.sql`; it is intentionally **not** inserted into the WS07 numbered ledger.

WS30 does not own or modify WS07, WS13, WS08 or WS09 product code. CI checks out the exact provider commits into isolated directories and consumes their migrations/adapters read-only.

## Real-schema rehearsal

`recovery-tests/run_recovery_test.sh` creates a disposable PostgreSQL 16 source database, runs the pinned WS07 migration runner, applies the pinned WS13 rate-limit migration, inventories tables/constraints/indexes, seeds only fields that exist in that real schema, takes a full custom-format backup, destroys the source database, creates a clean target, restores, and verifies relational/application integrity.

The obsolete synthetic `ws07_contract_fixture.sql` is not used. CI fails if provider commit/hash/blob pins differ from the handoffs.

The seed covers the available domain-live surfaces: account, account session, action token, shared rate-limit state, character/stat/skill/world-save state, item serial/equipment/inventory/inn placement, admin actor/session, durable admin idempotency receipt, command outbox/status, persistence operation/idempotency, audit/serial history, sanction and session lease.

## Backup artifact contract

`backup/postgres/full_backup.sh` atomically publishes:

- `<id>.dump` — PostgreSQL custom-format full logical backup (`pg_dump -Fc`).
- `<id>.dump.meta` — non-secret recovery metadata, version 2.
- `<id>.dump.sha256` — SHA-256 sidecar.

Metadata records PostgreSQL version, exact WS07/WS13 source pins, migration hashes, migration names/head/checksum and ledger fingerprint, schema table/constraint/index counts, schema fingerprint, selected domain row counts, source/dump sizes, backup hash and the encryption contract. No URL, password, token or encryption key is recorded.

`verify_backup.sh` requires matching SHA-256 metadata/sidecar and a successful non-empty `pg_restore --list` parse.

## Backup-before-migrate STOP gate

Every production schema migration must be wrapped by `backup/postgres/backup_before_migrate.sh` (or an orchestration layer that enforces the same stages):

1. preflight connectivity, PostgreSQL 16 and current integrity;
2. disk headroom check;
3. full custom-format backup;
4. SHA-256/archive integrity validation, plus disposable restore when a verification target is supplied;
5. explicitly supplied migration command;
6. post-migration integrity check.

The gate is fail-closed under `set -Eeuo pipefail`. Any failed stage stops before subsequent stages. It requires `WS30_MIGRATION_SAFETY_TOKEN=BACKUP_VERIFIED_BEFORE_MIGRATION` so an ad-hoc invocation cannot silently bypass the backup-first contract.

## Restore integrity

Restore validation covers the real current schema rather than a representative fixture:

- primary-key presence and validated constraints on critical domain-live tables;
- account username, live character name/slot, item serial, action-token, admin username, command trace and rate-limit uniqueness;
- account↔character/session/token relationships and item/admin foreign-key relationships;
- cross-placement item uniqueness;
- serial sequence positions not regressing behind restored IDs;
- migration ledger names/checksums/fingerprint;
- full schema fingerprint and core row counts;
- account session, rate-limit, character world/save, admin session/idempotency, command status and audit state in the rehearsal;
- append-only audit and item-serial-history triggers;
- minimum logical reads through the exact pinned WS07 `PgWs13AccountRepository` and `PgWs08AdminRepository`.

## Restore safety

`restore.sh` is destructive and refuses to run unless all required gates are explicit. Disposable targets require `ALLOW_DESTRUCTIVE_RESTORE=YES`, `RESTORE_TARGET_MARKER=disposable`, and `RESTORE_CONFIRM_DATABASE` exactly matching `current_database()`. Administrative databases `postgres`, `template0` and `template1` are refused.

Production additionally requires `TARGET_ENVIRONMENT=production`, `RESTORE_TARGET_MARKER=approved-production`, and `ALLOW_PRODUCTION_RESTORE=YES_I_HAVE_AN_APPROVED_INCIDENT`. These tokens are technical guardrails, not authorization. Prefer restoring into a replacement database/cluster instead of overwriting the failed primary.

## Rollback reality

The pinned migrations are forward-only. WS30 does **not** invent SQL down migrations. A schema-release rollback is: restore a known verified pre-migration backup into a clean/replacement target, then deploy the previous compatible application release and cut traffic only after post-restore verification.

## Encryption at rest

CI/local rehearsal metadata truthfully records `encryption=none`. Production backup storage must use encrypted ephemeral staging plus managed provider/KMS envelope encryption, policy-enforced rejection of unencrypted uploads, separated backup-writer/decrypt roles and immutable/object-lock retention. Secrets and plaintext production backups must never be committed.

## RPO / RTO

A daily full backup alone provides a worst-case RPO of up to 24 hours. The operational target remains **RTO <= 120 minutes** until environment drills demonstrate a better figure. A desired **RPO <= 15 minutes / RTO <= 60 minutes** requires WAL archiving/PITR or equivalent managed continuous backup plus a successful timed drill; do not claim those targets as achieved from this logical-backup rehearsal alone.

Run disposable CI on every WS30 change, environment restore monthly once staging/DR exists, and a full incident simulation quarterly once production is live. Re-run after PostgreSQL major changes, migration tooling changes, backup storage/encryption changes, or material schema additions.
