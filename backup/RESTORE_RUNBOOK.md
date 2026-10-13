# WS30 — Disaster Recovery / Restore Runbook

## Preconditions

This runbook is for an authorized incident or scheduled recovery drill. The repository contains no production credentials and scripts do not select a production target automatically. Record incident/change ID, incident commander, DB owner, selected backup ID, expected recovery point and application write/maintenance state.

## 1. Contain and choose a recovery point

1. Stop/isolate application writes if the current DB is corrupt or inconsistent.
2. Preserve failed storage for forensics; do not overwrite it by default.
3. Select the newest backup before the loss/corruption event.
4. Compare timestamp/migration head with the incident timeline.
5. If PITR exists, choose the WAL target timestamp/LSN; otherwise the full-backup timestamp is the recovery point.

## 2. Verify before touching the target

Materialize/decrypt onto encrypted ephemeral storage and run:

```bash
backup/postgres/verify_backup.sh /secure/path/oldko-full_YYYYMMDDTHHMMSSZ.dump
```

Do not continue if checksum, metadata version, archive format or `pg_restore --list` validation fails. Try the next valid recovery point and record the rejected backup ID.

## 3. Prepare a replacement database

Prefer a new PostgreSQL database/cluster instead of overwriting the failed primary. Match the intended PostgreSQL major version, ensure disk headroom, and keep application traffic away until verification passes.

Local/test drill example:

```bash
BACKUP_FILE=/path/to/backup.dump \
TARGET_DATABASE_URL='postgresql://.../disposable_db' \
TARGET_ENVIRONMENT=ci \
RESTORE_TARGET_MARKER=disposable \
ALLOW_DESTRUCTIVE_RESTORE=YES \
backup/postgres/restore.sh
```

A production incident additionally requires `TARGET_ENVIRONMENT=production`, `RESTORE_TARGET_MARKER=approved-production`, `ALLOW_DESTRUCTIVE_RESTORE=YES`, and `ALLOW_PRODUCTION_RESTORE=YES_I_HAVE_AN_APPROVED_INCIDENT`. These flags are guardrails, not authorization; credentials/approval come from the deployment platform and incident process.

## 4. Restore

`restore.sh` verifies first, then uses `pg_restore --clean --if-exists --exit-on-error --single-transaction --no-owner --no-privileges`, followed by integrity and metadata-count checks. On failure, do not connect application traffic; preserve logs and retry only into a clean target after the cause is understood.

## 5. Required validation before cutover

```bash
DATABASE_URL='postgresql://.../restored_db' backup/postgres/assert_integrity.sh
DATABASE_URL='postgresql://.../restored_db' backup/postgres/assert_metadata_counts.sh /path/to/backup.dump.meta
```

Also perform service-level checks when owning services exist: read a known test account, read its character list, resolve inventory/inn item placements, ensure fresh session behavior and confirm health/readiness. Never use a real player's password as a recovery fixture.

## 6. Cutover

Take a final forensic snapshot if safe, repoint the application binding/secret to the verified replacement, canary application instances if supported, validate login/character select/inventory/error rate, gradually restore traffic, and keep the old system isolated until rollback risk is accepted.

## 7. After recovery

Record actual recovery point/data loss (RPO), incident-to-restored duration (RTO), backup ID/checksum/migration head/PostgreSQL version, rejected recovery points, verification evidence and corrective actions. If measured RPO/RTO misses target, open follow-up work rather than changing the report.

## Recovery drill cadence

Run disposable CI recovery on every WS30 change; environment-level restore monthly once staging/DR exists; full incident simulation quarterly once production is live; and re-run after PostgreSQL major upgrades, backup/migration tooling changes, or encryption/storage changes.
