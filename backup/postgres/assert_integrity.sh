#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

require_cmd psql
require_env DATABASE_URL

query_scalar() {
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "$1"
}

schema_contract_count="$(query_scalar "SELECT count(*) FROM pg_catalog.pg_tables WHERE (schemaname='oldko' AND tablename IN ('accounts','characters','item_instances','character_items','inventory','inn_storage')) OR (schemaname='public' AND tablename='_oldko_migrations');")"
[[ "$schema_contract_count" == "7" ]] || die "post-restore schema contract incomplete: expected 7 critical tables, found $schema_contract_count"

migration_count="$(query_scalar "SELECT count(*) FROM public._oldko_migrations;")"
[[ "$migration_count" =~ ^[0-9]+$ ]] || die "migration table count is invalid"

account_dupes="$(query_scalar "SELECT count(*) FROM (SELECT username_key FROM oldko.accounts GROUP BY username_key HAVING count(*) > 1) d;")"
character_name_dupes="$(query_scalar "SELECT count(*) FROM (SELECT name_key FROM oldko.characters WHERE deleted_at IS NULL GROUP BY name_key HAVING count(*) > 1) d;")"
character_slot_dupes="$(query_scalar "SELECT count(*) FROM (SELECT account_id,slot FROM oldko.characters WHERE deleted_at IS NULL GROUP BY account_id,slot HAVING count(*) > 1) d;")"
serial_dupes="$(query_scalar "SELECT count(*) FROM (SELECT serial FROM oldko.item_instances GROUP BY serial HAVING count(*) > 1) d;")"
placement_dupes="$(query_scalar "WITH placements AS (SELECT item_instance_id FROM oldko.character_items UNION ALL SELECT item_instance_id FROM oldko.inventory UNION ALL SELECT item_instance_id FROM oldko.inn_storage) SELECT count(*) FROM (SELECT item_instance_id FROM placements GROUP BY item_instance_id HAVING count(*) > 1) d;")"
missing_character_accounts="$(query_scalar "SELECT count(*) FROM oldko.characters c LEFT JOIN oldko.accounts a ON a.id=c.account_id WHERE a.id IS NULL;")"
missing_placement_items="$(query_scalar "WITH placements AS (SELECT item_instance_id FROM oldko.character_items UNION ALL SELECT item_instance_id FROM oldko.inventory UNION ALL SELECT item_instance_id FROM oldko.inn_storage) SELECT count(*) FROM placements p LEFT JOIN oldko.item_instances i ON i.id=p.item_instance_id WHERE i.id IS NULL;")"

[[ "$account_dupes" == "0" ]] || die "duplicate account username_key values detected: $account_dupes"
[[ "$character_name_dupes" == "0" ]] || die "duplicate live character names detected: $character_name_dupes"
[[ "$character_slot_dupes" == "0" ]] || die "duplicate live character slots detected: $character_slot_dupes"
[[ "$serial_dupes" == "0" ]] || die "duplicate item serials detected: $serial_dupes"
[[ "$placement_dupes" == "0" ]] || die "item instance appears in multiple placement tables: $placement_dupes"
[[ "$missing_character_accounts" == "0" ]] || die "characters with missing accounts detected: $missing_character_accounts"
[[ "$missing_placement_items" == "0" ]] || die "placements with missing item instances detected: $missing_placement_items"

if [[ -n "${EXPECTED_MIGRATION_HEAD:-}" ]]; then
  actual_head="$(query_scalar "SELECT COALESCE((SELECT name FROM public._oldko_migrations ORDER BY applied_at DESC, name DESC LIMIT 1),'none');")"
  [[ "$actual_head" == "$EXPECTED_MIGRATION_HEAD" ]] || die "migration head mismatch: expected=$EXPECTED_MIGRATION_HEAD actual=$actual_head"
fi

log "post-restore integrity checks passed (migrations=$migration_count)"
