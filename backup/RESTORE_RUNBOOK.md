# WS30 — Domain-Live Restore Runbook

## 0. Preconditions

Use this only for an authorized incident or scheduled recovery drill. Record incident/change ID, DB owner, selected backup ID, expected recovery point, previous compatible app release, and application write/maintenance state. Do not point the disposable rehearsal at production.

Current release authority is pinned to WS07 `eaac4700c3535c449f6a2b7d20c925bc61382c35` and WS13 `e53966d9f882d98e2a5b4746262f38355dfda848`. The WS07 migrations are forward-only; rollback is backup + previous app release, not fabricated down SQL.

## 1. Contain and choose the recovery point

Stop/isolate writes if corruption is possible. Preserve failed storage for forensics. Select the newest known-good backup before the fault. Compare its metadata timestamp, migration ledger fingerprint, schema fingerprint, source pins and PostgreSQL version with the incident timeline. If PITR exists, select the WAL target; otherwise the full-backup timestamp is the recovery point.

## 2. Verify the archive before touching a target

Materialize/decrypt onto encrypted ephemeral storage and run:

```bash
backup/postgres/verify_backup.sh /secure/path/oldko-full_YYYYMMDDTHHMMSSZ.dump
```

STOP if the SHA-256 sidecar/metadata disagree, metadata v2 is invalid, the schema/ledger fingerprints are missing, or `pg_restore --list` cannot parse the archive.

## 3. Prepare a clean replacement target

Prefer a new PostgreSQL 16 database/cluster. Keep application traffic away until all checks pass. Never use `postgres`, `template0` or `template1` as restore targets.

Disposable example:

```bash
BACKUP_FILE=/path/to/backup.dump \
TARGET_DATABASE_URL='postgresql://.../oldko_restore_candidate' \
TARGET_ENVIRONMENT=ci \
RESTORE_TARGET_MARKER=disposable \
RESTORE_CONFIRM_DATABASE=oldko_restore_candidate \
ALLOW_DESTRUCTIVE_RESTORE=YES \
backup/postgres/restore.sh
```

A production incident additionally requires:

```text
TARGET_ENVIRONMENT=production
RESTORE_TARGET_MARKER=approved-production
RESTORE_CONFIRM_DATABASE=<exact current_database()>
ALLOW_DESTRUCTIVE_RESTORE=YES
ALLOW_PRODUCTION_RESTORE=YES_I_HAVE_AN_APPROVED_INCIDENT
```

If any token is missing or the confirmed DB name differs, STOP.

## 4. Restore

`restore.sh` verifies first, then runs `pg_restore --clean --if-exists --exit-on-error --single-transaction --no-owner --no-privileges`. It then checks the expected migration head, migration-ledger fingerprint, schema fingerprint and metadata row counts.

On any error, do not attach application traffic. Preserve logs, discard/reset the failed candidate target, correct the cause and retry from a known verified archive.

## 5. Post-restore integrity

Run explicitly when needed:

```bash
DATABASE_URL='postgresql://.../restored_db' \
  backup/postgres/assert_integrity.sh

DATABASE_URL='postgresql://.../restored_db' \
  backup/postgres/assert_metadata_counts.sh /path/to/backup.dump.meta
```

For the domain-live schema, verify account↔character, account/admin sessions, action tokens, rate-limit state, character world/save/stat/skill state, item serial placements, durable admin idempotency, command status and audit history. Verify service reads through the pinned WS07 account/admin adapters before cutover.

## 6. Migration rollback procedure

For a failed forward-only schema rollout:

1. stop writes/traffic to the failed release;
2. select the verified backup taken immediately before migration;
3. restore it into a clean/replacement PostgreSQL 16 target using the safety gates above;
4. run full integrity and adapter reads;
5. deploy the previous compatible application release;
6. canary, then cut traffic to the verified replacement;
7. keep the failed target isolated for forensics until rollback risk is accepted.

Do not attempt an unowned `DOWN` migration.

## 7. Cutover and record RPO/RTO

After a clean restore and service checks, repoint the application binding/secret to the replacement, canary, verify login/account/character/admin reads and error rates, then restore traffic gradually.

Record actual recovery point/data loss (RPO), incident-to-restored duration (RTO), backup ID/SHA-256, PostgreSQL version, source pins, migration ledger and schema fingerprint, rejected recovery points and corrective actions. A daily logical backup alone is up to 24h RPO; <=15m RPO requires PITR/continuous backup. Do not report target RPO/RTO as achieved unless a timed environment drill proves it.
