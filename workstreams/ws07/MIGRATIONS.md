# WS07 migrations and recovery

| Migration | Purpose | Upgrade behavior |
| --- | --- | --- |
| `0001_init.sql` | Baseline accounts, sessions, characters/stats, item placements, clans, bans, audit, server state | Immutable baseline; checksum protected |
| `0002_persistence_hardening.sql` | Nation persistence, versions/world state, exact WS17 slot bounds, WS22 trades, WS45 leases, transaction receipts, account-delete guard | Transactional; intentionally fails rather than silently rewrite invalid legacy item slots |
| `0003_public_account_api.sql` | WS13 public-account verification/password/session action-token persistence | Additive; preserves existing account identity in `oldko.accounts` |
| `0004_admin_persistence.sql` | WS08 PostgreSQL admin contract: skill state, privileged actor/session store, sanction provenance, item moderation/history, command outbox and restart-safe idempotency receipts | Additive and forward-only; does not seed production identities and does not modify 0001-0003 |

## Fresh database

Run `npm run migrate` against an empty PostgreSQL 16 database. CI then runs it a second time and verifies that no migration is re-applied.

## Upgrade database

CI creates a second disposable database, applies only `0001_init.sql` using `OLDKO_MIGRATION_TARGET`, then applies the full migration set twice. This proves the real `0001 -> current` path instead of testing only fresh creation.

Before a production `0002` deployment, run preflight queries for equipment slots `>=14`, inventory slots `>=28`, and inn positions that cannot map into the internal 196-slot storage. Any result requires explicit data repair by the owning item workstream; the migration must not renumber player items silently.

## Domain-live migration order

WS09 is the production migration executor for `oldkoweb-domain-live-20261015`. Apply exactly:

1. `database/migrations/0001_init.sql`
2. `database/migrations/0002_persistence_hardening.sql`
3. `database/migrations/0003_public_account_api.sql`
4. `database/migrations/0004_admin_persistence.sql`
5. WS13 service-owned `services/account-api/sql/0001_postgres_rate_limit.sql`

Step 5 remains owned by WS13 and is not copied into the WS07 migration ledger. It is deliberately applied after the shared WS07 schema exists. The WS07 migrator records/checksums only numbered files under `database/migrations/`.

`0004` creates no demo actor and imports no `ADMIN_USERS_JSON`. `oldko.admin_actors` is a privileged identity store, not a duplicate player table; player identity remains `oldko.accounts`.

## Online-authority rule

`session_leases`/WS45 (or a supplied runtime resolver) is the online-state source. WS07 does not introduce an `online` player flag. `PgWs08AdminRepository` rejects direct persistent character/stat/skill/zone mutations while an active character lease exists. WS08/WS03 must route such writes through the game authority / durable outbox with the captured world/progression/item CAS versions.

## Rollback strategy

Migrations are forward-only. An in-process SQL "down" migration is deliberately not supplied because dropping new tables/columns can destroy committed player/admin state.

1. If a migration statement fails, PostgreSQL rolls that migration transaction back automatically and the migration ledger is not advanced.
2. If application rollout must be reverted while the schema is backward compatible, roll back application code and leave the additive schema in place.
3. If data/schema restoration is required, stop writers and use the WS30 backup/PITR recovery contract against a disposable verification restore before replacing production.
4. Never edit an applied migration to "undo" it; checksum enforcement treats that as corruption.

`public._oldko_migrations(name, checksum, applied_at)` remains compatible with the WS30 recovery contract. WS30 full logical backups cover the entire database, so all `oldko` tables added by `0004` are included automatically; restore validation still relies on the migration ledger plus service-level verification.
