#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/backup/lib/common.sh"
require_cmd psql pg_dump pg_restore git node mktemp cmp cp
require_env PG_TEST_ADMIN_URL
require_env WS07_PROVIDER_ROOT
require_env WS13_PROVIDER_ROOT
[[ "${WS30_DISPOSABLE_REHEARSAL:-}" == "YES" ]] || die "recovery rehearsal requires WS30_DISPOSABLE_REHEARSAL=YES"

WS07_PIN='eaac4700c3535c449f6a2b7d20c925bc61382c35'
WS13_PIN='e53966d9f882d98e2a5b4746262f38355dfda848'
MIGRATION_0001_SHA='88f0c4c4d92f8dd5602a87707d689f9364b793274b58eb68372483a333a3ef8a'
MIGRATION_0002_SHA='86ee8d6bbd83bf7be4134030f2967874902f13de5a4eb1c5d1c14ed04ba17314'
MIGRATION_0003_SHA='24c3e52086e6197d1a998cdd4604531418af92b7f6dd37f5d5a1c725939f590f'
MIGRATION_0004_SHA='66ac0374b0373f7ae7b064c0254762425da1b7da3e1c2073e5ce566f4d817b45'
RATE_LIMIT_SHA='c7319604db165e2aa75280612e1da7912966b6d78c579c362b80ea145923026c'

src_db="${WS30_SOURCE_DB:-oldko_ws30_domain_src}"
dst_db="${WS30_RESTORE_DB:-oldko_ws30_domain_restored}"
[[ "$src_db" =~ ^[A-Za-z0-9_]+$ && "$dst_db" =~ ^[A-Za-z0-9_]+$ ]] || die "rehearsal database names must be alphanumeric/underscore"
[[ "$src_db" != "$dst_db" ]] || die "source and restore database names must differ"

ws07_head="$(git -C "$WS07_PROVIDER_ROOT" rev-parse HEAD)"
ws13_head="$(git -C "$WS13_PROVIDER_ROOT" rev-parse HEAD)"
[[ "$ws07_head" == "$WS07_PIN" ]] || die "WS07 provider pin mismatch: expected=$WS07_PIN actual=$ws07_head"
[[ "$ws13_head" == "$WS13_PIN" ]] || die "WS13 provider pin mismatch: expected=$WS13_PIN actual=$ws13_head"

assert_sha() {
  local file="$1" expected="$2"
  local actual
  actual="$(sha256_file "$file")"
  [[ "$actual" == "$expected" ]] || die "source hash mismatch for $file: expected=$expected actual=$actual"
}
assert_blob() {
  local file="$1" expected="$2"
  local actual
  actual="$(git -C "$WS07_PROVIDER_ROOT" hash-object "$WS07_PROVIDER_ROOT/$file")"
  [[ "$actual" == "$expected" ]] || die "provider adapter blob mismatch for $file: expected=$expected actual=$actual"
}

assert_sha "$WS07_PROVIDER_ROOT/database/migrations/0001_init.sql" "$MIGRATION_0001_SHA"
assert_sha "$WS07_PROVIDER_ROOT/database/migrations/0002_persistence_hardening.sql" "$MIGRATION_0002_SHA"
assert_sha "$WS07_PROVIDER_ROOT/database/migrations/0003_public_account_api.sql" "$MIGRATION_0003_SHA"
assert_sha "$WS07_PROVIDER_ROOT/database/migrations/0004_admin_persistence.sql" "$MIGRATION_0004_SHA"
assert_sha "$WS13_PROVIDER_ROOT/services/account-api/sql/0001_postgres_rate_limit.sql" "$RATE_LIMIT_SHA"
assert_blob 'services/oldko-data/src/adapters/ws13-account-api.js' '022c32abde503a6dc3af1ff9429c206a1b20ca63'
assert_blob 'services/oldko-data/src/adapters/ws08-admin.js' '221114aa464e5f6175b36e266a722b0eb771c579'
assert_blob 'services/oldko-data/src/adapters/ws08-admin-shared.js' 'c736f22a14aa7260b5279de8d35e3ba4eace83aa'
assert_blob 'services/oldko-data/src/adapters/ws08-admin-read.js' '1832ded43f9fd9af6e3ae65c6b1c053098a09ca6'
assert_blob 'services/oldko-data/src/adapters/ws08-admin-write.js' '945de2cb406ea691f9670d66980b828242d572e5'
assert_blob 'services/oldko-data/src/adapters/ws08-admin-extra.js' '8aac4c22ee13ee9aea8f2ac1c64915609e0af511'

work_dir="$(mktemp -d)"
backup_dir="$work_dir/backups"
gate_backup_dir="$work_dir/gate-backups"
evidence_dir="${WS30_EVIDENCE_DIR:-$ROOT/recovery-artifacts}"
rm -rf "$evidence_dir"
mkdir -p "$backup_dir" "$gate_backup_dir" "$evidence_dir"

admin_psql() {
  psql "$PG_TEST_ADMIN_URL" -X -v ON_ERROR_STOP=1 "$@"
}

drop_db() {
  local name="$1"
  admin_psql -Atqc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$name' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  admin_psql -c "DROP DATABASE IF EXISTS \"$name\";" >/dev/null
}

cleanup() {
  drop_db "$src_db" >/dev/null 2>&1 || true
  drop_db "$dst_db" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

drop_db "$src_db"
drop_db "$dst_db"
admin_psql -c "CREATE DATABASE \"$src_db\";"

base_url="${PG_TEST_ADMIN_URL%/*}"
src_url="$base_url/$src_db"
dst_url="$base_url/$dst_db"

server_major="$(psql "$src_url" -X -Atqc "SELECT current_setting('server_version_num')::int/10000;")"
[[ "$server_major" == "16" ]] || die "rehearsal requires PostgreSQL 16"

log "applying real WS07 migration runner at exact source pin"
DATABASE_URL="$src_url" node "$WS07_PROVIDER_ROOT/services/oldko-data/src/scripts/migrate.js"
log "applying WS13 service-owned rate-limit migration (outside public._oldko_migrations by contract)"
psql "$src_url" -X -v ON_ERROR_STOP=1 -f "$WS13_PROVIDER_ROOT/services/account-api/sql/0001_postgres_rate_limit.sql"

expected_ledger=$'0001_init.sql|88f0c4c4d92f8dd5602a87707d689f9364b793274b58eb68372483a333a3ef8a\n0002_persistence_hardening.sql|86ee8d6bbd83bf7be4134030f2967874902f13de5a4eb1c5d1c14ed04ba17314\n0003_public_account_api.sql|24c3e52086e6197d1a998cdd4604531418af92b7f6dd37f5d5a1c725939f590f\n0004_admin_persistence.sql|66ac0374b0373f7ae7b064c0254762425da1b7da3e1c2073e5ce566f4d817b45'
actual_ledger="$(migration_ledger_text "$src_url")"
[[ "$actual_ledger" == "$expected_ledger" ]] || die "real WS07 migration ledger differs from pinned handoff"

schema_inventory "$src_url" > "$evidence_dir/schema-before.inventory"
schema_before_sha="$(schema_fingerprint "$src_url")"
printf '%s\n' "$actual_ledger" > "$evidence_dir/migration-ledger.txt"

log "seeding only columns/tables present in the pinned real schema"
psql "$src_url" -X -v ON_ERROR_STOP=1 -f "$ROOT/recovery-tests/sql/domain_live_seed.sql"
DATABASE_URL="$src_url" EXPECTED_MIGRATION_HEAD='0004_admin_persistence.sql' "$ROOT/backup/postgres/assert_integrity.sh"

backup_file="$(
  DATABASE_URL="$src_url" \
  BACKUP_DIR="$backup_dir" \
  MIN_FREE_BYTES=0 \
  BACKUP_APP_VERSION='oldkoweb-domain-live-20261015' \
  WS30_SOURCE_PIN_WS07="$WS07_PIN" \
  WS30_SOURCE_PIN_WS13="$WS13_PIN" \
  WS30_MIGRATION_0001_SHA256="$MIGRATION_0001_SHA" \
  WS30_MIGRATION_0002_SHA256="$MIGRATION_0002_SHA" \
  WS30_MIGRATION_0003_SHA256="$MIGRATION_0003_SHA" \
  WS30_MIGRATION_0004_SHA256="$MIGRATION_0004_SHA" \
  WS30_RATE_LIMIT_MIGRATION_SHA256="$RATE_LIMIT_SHA" \
    "$ROOT/backup/postgres/full_backup.sh"
)"
"$ROOT/backup/postgres/verify_backup.sh" "$backup_file"
pg_restore --list "$backup_file" > "$evidence_dir/archive.list"
cp "$backup_file" "$evidence_dir/"
cp "${backup_file}.meta" "$evidence_dir/"
cp "${backup_file}.sha256" "$evidence_dir/"

backup_sha="$(sha256_file "$backup_file")"
metadata_schema_sha="$(metadata_value "${backup_file}.meta" schema_fingerprint_sha256)"
[[ "$metadata_schema_sha" == "$schema_before_sha" ]] || die "backup metadata schema fingerprint differs from pre-backup schema"

log "destroying disposable source database before restore"
drop_db "$src_db"
src_exists="$(admin_psql -Atqc "SELECT count(*) FROM pg_database WHERE datname='$src_db';")"
[[ "$src_exists" == "0" ]] || die "source database still exists after destructive rehearsal reset"

log "creating clean restore target"
admin_psql -c "CREATE DATABASE \"$dst_db\";"
BACKUP_FILE="$backup_file" \
TARGET_DATABASE_URL="$dst_url" \
TARGET_ENVIRONMENT=ci \
RESTORE_TARGET_MARKER=disposable \
RESTORE_CONFIRM_DATABASE="$dst_db" \
ALLOW_DESTRUCTIVE_RESTORE=YES \
  "$ROOT/backup/postgres/restore.sh"

schema_inventory "$dst_url" > "$evidence_dir/schema-after.inventory"
cmp "$evidence_dir/schema-before.inventory" "$evidence_dir/schema-after.inventory"
DATABASE_URL="$dst_url" "$ROOT/backup/postgres/assert_metadata_counts.sh" "${backup_file}.meta"

assert_one() {
  local sql="$1" label="$2"
  local value
  value="$(psql "$dst_url" -X -v ON_ERROR_STOP=1 -Atqc "$sql")"
  [[ "$value" == "1" ]] || die "$label integrity check failed (actual=$value)"
}
assert_one "SELECT count(*) FROM oldko.accounts a JOIN oldko.characters c ON c.account_id=a.id WHERE a.username_key='recoveryuser' AND c.name_key='recoveryhero';" "account-character"
assert_one "SELECT count(*) FROM oldko.account_sessions s JOIN oldko.accounts a ON a.id=s.account_id WHERE a.username_key='recoveryuser' AND s.revoked_at IS NULL AND s.password_version=a.password_version;" "account-session"
assert_one "SELECT count(*) FROM oldko.account_action_tokens t JOIN oldko.accounts a ON a.id=t.account_id WHERE a.username_key='recoveryuser' AND t.kind='account_verification' AND t.consumed_at IS NULL;" "action-token"
assert_one "SELECT count(*) FROM oldko.account_rate_limits WHERE bucket_hash=repeat('a',64) AND count=3;" "rate-limit"
assert_one "SELECT count(*) FROM oldko.characters WHERE name_key='recoveryhero' AND world_version=5 AND item_version=4 AND world_state->>'checkpoint'='moradon';" "world-save"
assert_one "SELECT count(*) FROM oldko.character_stats s JOIN oldko.characters c ON c.id=s.character_id WHERE c.name_key='recoveryhero' AND s.progression_version=7 AND s.level=3;" "character-stats"
assert_one "SELECT count(*) FROM oldko.character_skills s JOIN oldko.characters c ON c.id=s.character_id WHERE c.name_key='recoveryhero' AND s.skills->>'101003'='1';" "character-skills"
assert_one "SELECT count(*) FROM oldko.character_items ci JOIN oldko.item_instances i ON i.id=ci.item_instance_id WHERE i.serial=930000000001;" "equipment-serial"
assert_one "SELECT count(*) FROM oldko.inventory iv JOIN oldko.item_instances i ON i.id=iv.item_instance_id WHERE i.serial=930000000002;" "inventory-serial"
assert_one "SELECT count(*) FROM oldko.inn_storage ins JOIN oldko.item_instances i ON i.id=ins.item_instance_id WHERE i.serial=930000000003;" "inn-serial"
assert_one "SELECT count(*) FROM oldko.admin_sessions s JOIN oldko.admin_actors a ON a.id=s.actor_id WHERE a.username_key='recoveryadmin' AND s.revoked_at IS NULL;" "admin-session"
assert_one "SELECT count(*) FROM oldko.admin_operation_receipts WHERE actor_id='recovery-admin' AND state='completed';" "admin-idempotency"
assert_one "SELECT count(*) FROM oldko.admin_command_outbox WHERE trace_id='ws30-recovery-command-1' AND status='succeeded' AND completed_at IS NOT NULL;" "command-status"
assert_one "SELECT count(*) FROM oldko.audit_log WHERE request_id='ws30-recovery-audit-1' AND actor_admin_id='recovery-admin';" "audit"
assert_one "SELECT count(*) FROM oldko.persistence_operations WHERE operation_id='ws30-recovery-operation-1' AND committed_at IS NOT NULL;" "persistence-idempotency"
assert_one "SELECT count(*) FROM oldko.session_leases WHERE scope='character' AND lease_key='2001' AND session_id='ws30-session';" "session-lease"

DATABASE_URL="$dst_url" WS07_PROVIDER_ROOT="$WS07_PROVIDER_ROOT" node "$ROOT/recovery-tests/adapter_reads.mjs" > "$evidence_dir/adapter-reads.json"

if psql "$dst_url" -X -v ON_ERROR_STOP=1 -c "INSERT INTO oldko.item_instances(serial,item_template_id) VALUES (930000000001,999999999);" >/dev/null 2>&1; then
  die "restored database accepted a duplicate item serial"
fi
if psql "$dst_url" -X -v ON_ERROR_STOP=1 -c "UPDATE oldko.audit_log SET action='tampered' WHERE request_id='ws30-recovery-audit-1';" >/dev/null 2>&1; then
  die "restored audit log lost append-only protection"
fi
if psql "$dst_url" -X -v ON_ERROR_STOP=1 -c "UPDATE oldko.item_serial_events SET action='tampered' WHERE trace_id='ws30-recovery-serial-1';" >/dev/null 2>&1; then
  die "restored item serial history lost append-only protection"
fi

corrupt="$work_dir/corrupt.dump"
cp "$backup_file" "$corrupt"
cp "${backup_file}.meta" "${corrupt}.meta"
cp "${backup_file}.sha256" "${corrupt}.sha256"
printf 'corruption' >> "$corrupt"
if "$ROOT/backup/postgres/verify_backup.sh" "$corrupt" >/dev/null 2>&1; then
  die "corrupted backup unexpectedly passed verification"
fi

if BACKUP_FILE="$backup_file" TARGET_DATABASE_URL="$dst_url" TARGET_ENVIRONMENT=ci RESTORE_CONFIRM_DATABASE="$dst_db" "$ROOT/backup/postgres/restore.sh" >/dev/null 2>&1; then
  die "restore safety gate unexpectedly allowed an unapproved destructive restore"
fi
if BACKUP_FILE="$backup_file" TARGET_DATABASE_URL="$dst_url" TARGET_ENVIRONMENT=ci RESTORE_TARGET_MARKER=disposable ALLOW_DESTRUCTIVE_RESTORE=YES RESTORE_CONFIRM_DATABASE='wrong_db' "$ROOT/backup/postgres/restore.sh" >/dev/null 2>&1; then
  die "restore target-name confirmation gate unexpectedly accepted a mismatch"
fi

space_fail_dir="$work_dir/space-fail"
mkdir -p "$space_fail_dir"
if DATABASE_URL="$dst_url" BACKUP_DIR="$space_fail_dir" MIN_FREE_BYTES=999999999999999999 "$ROOT/backup/postgres/full_backup.sh" >/dev/null 2>&1; then
  die "backup unexpectedly succeeded with impossible MIN_FREE_BYTES"
fi
if find "$space_fail_dir" -maxdepth 1 -name '*.dump' -print -quit | grep -q .; then
  die "failed backup published a final .dump artifact"
fi

log "exercising backup-before-migrate STOP gate with a no-op migration command"
DATABASE_URL="$dst_url" \
BACKUP_DIR="$gate_backup_dir" \
MIN_FREE_BYTES=0 \
BACKUP_APP_VERSION='oldkoweb-domain-live-20261015' \
WS30_SOURCE_PIN_WS07="$WS07_PIN" \
WS30_SOURCE_PIN_WS13="$WS13_PIN" \
WS30_MIGRATION_0001_SHA256="$MIGRATION_0001_SHA" \
WS30_MIGRATION_0002_SHA256="$MIGRATION_0002_SHA" \
WS30_MIGRATION_0003_SHA256="$MIGRATION_0003_SHA" \
WS30_MIGRATION_0004_SHA256="$MIGRATION_0004_SHA" \
WS30_RATE_LIMIT_MIGRATION_SHA256="$RATE_LIMIT_SHA" \
WS30_MIGRATION_SAFETY_TOKEN=BACKUP_VERIFIED_BEFORE_MIGRATION \
  "$ROOT/backup/postgres/backup_before_migrate.sh" -- psql "$dst_url" -X -v ON_ERROR_STOP=1 -c 'SELECT 1;' >/dev/null

cat > "$evidence_dir/rehearsal-summary.env" <<SUMMARY
release_id=oldkoweb-domain-live-20261015
postgres_major=16
pinned_ws07=$WS07_PIN
pinned_ws13=$WS13_PIN
migration_head=0004_admin_persistence.sql
rate_limit_migration_sha256=$RATE_LIMIT_SHA
schema_fingerprint_sha256=$schema_before_sha
backup_sha256=$backup_sha
archive_integrity=PASS
restore=PASS
account_integrity=PASS
character_integrity=PASS
admin_integrity=PASS
session_integrity=PASS
command_audit=PASS
adapter_reads=PASS
backup_before_migrate_gate=PASS
source_database_destroyed_before_restore=YES
SUMMARY

log "domain-live real-schema backup/destroy/restore/integrity rehearsal passed"
