# WS30 — OldKOWeb Backup Strategy

## Scope

This workstream defines a PostgreSQL backup/restore contract for the OldKOWeb persistence layer without changing WS07 schema or migrations. WS07 currently targets PostgreSQL 16, stores game data under the `oldko` schema, and records migration name/checksum/time in `public._oldko_migrations`.

The scripts in `backup/postgres/` are safe-by-default building blocks. They do not discover or contact production on their own. A database connection must be supplied at runtime through environment/secret-management plumbing.

## Backup artifact contract

`full_backup.sh` creates three files atomically:

- `<id>.dump`: PostgreSQL custom-format logical full backup (`pg_dump -Fc`).
- `<id>.dump.meta`: non-secret recovery metadata.
- `<id>.dump.sha256`: SHA-256 checksum sidecar.

The metadata records UTC timestamp/ID, format version, PostgreSQL version, application version, migration count/head/checksum, source/dump sizes, core row counts and dump SHA-256. Connection strings, passwords, tokens and encryption keys are never written to metadata or repository files.

## Creation and validation flow

1. Confirm the WS07 contract tables and `public._oldko_migrations` exist.
2. Query source DB size and fail before dumping if destination free space is below `max(MIN_FREE_BYTES, source_db_size)`.
3. Run `pg_dump` custom format with owner/ACL data excluded.
4. Parse the archive with `pg_restore --list`.
5. Compute SHA-256 and write metadata/checksum sidecars.
6. Publish by atomic rename only after all checks pass; temporary artifacts are removed on error.

A non-zero exit from `psql`, `pg_dump`, `pg_restore`, disk checks or metadata validation is a backup failure and should alert the production backup owner.

## Restore verification

Every candidate backup should pass archive integrity (checksum + archive parse) and a disposable restore. Post-restore checks cover expected WS07 tables/migration ledger, account username uniqueness, live character name/slot uniqueness, item serial uniqueness, cross-placement item uniqueness, missing account/item references, core row counts and migration head. CI also confirms the restored item-serial unique constraint rejects a duplicate.

## Encryption at rest design

Production backups must be encrypted outside the repository using a managed key system:

1. Create the dump on an encrypted ephemeral volume.
2. Upload to object storage with provider-side envelope encryption using a dedicated KMS key (SSE-KMS or equivalent).
3. Deny unencrypted uploads with storage policy.
4. Give the backup writer minimal/encrypt-only object permissions; give restore operators decrypt through a separate role.
5. Enable immutable/object-lock retention for a short operational window (example: 7 days).
6. Never commit credentials, private keys, passphrases or plaintext production backups.

If client-side encryption is later required, add an `age`/KMS envelope adapter with key identifiers supplied at runtime. The current local/CI metadata explicitly records `encryption=none` so tests do not falsely claim production encryption.

## Retention example

`retention-policy.example.env` describes a starter GFS-style policy: daily 7 days, weekly 4 weeks, monthly 6 months, immutable 7 days. Retention deletion belongs to the storage lifecycle/orchestrator, not the backup writer, so creation credentials do not need delete permission.

## RPO / RTO

- Baseline with one full backup every 24 hours: achieved RPO is up to 24 hours. Initial measured RTO target: **<= 120 minutes**.
- Recommended production target: **RPO <= 15 minutes, RTO <= 60 minutes**. The 15-minute RPO requires PostgreSQL WAL archiving/PITR (or managed continuous backup) in addition to these full backups. Do not advertise that target until PITR is implemented and a drill passes.

## Scheduling and alerts

Record start/end/duration, backup ID/object location, bytes, migration head, checksum result, recovery-drill result and failure category. Alert on failed/missing backup windows, checksum failures, lifecycle failures and recovery-drill failures. Alert messages reference backup IDs, never credentials.

## Compatibility policy

Use a `pg_dump` client equal to or newer than the server major version. Restore drills should use the same target major version as production unless an upgrade recovery is explicitly being tested. Run a recovery drill before PostgreSQL major upgrades.
