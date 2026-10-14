# WS07 migrations and recovery

| Migration | Purpose | Upgrade behavior |
| --- | --- | --- |
| `0001_init.sql` | Baseline accounts, sessions, characters/stats, item placements, clans, bans, audit, server state | Immutable baseline; checksum protected |
| `0002_persistence_hardening.sql` | Nation persistence, versions/world state, exact WS17 slot bounds, WS22 trades, WS45 leases, transaction receipts, account-delete guard | Transactional; intentionally fails rather than silently rewrite invalid legacy item slots |

## Fresh database

Run `npm run migrate` against an empty PostgreSQL 16 database. CI then runs it a second time and verifies that no migration is re-applied.

## Upgrade database

CI creates a second disposable database, applies only `0001_init.sql` using `OLDKO_MIGRATION_TARGET`, then applies the full migration set twice. This proves the real `0001 -> current` path instead of testing only fresh creation.

Before a production `0002` deployment, run preflight queries for equipment slots `>=14`, inventory slots `>=28`, and inn positions that cannot map into the internal 196-slot storage. Any result requires explicit data repair by the owning item workstream; the migration must not renumber player items silently.

## Rollback strategy

Migrations are forward-only. An in-process SQL "down" migration is deliberately not supplied for persistence hardening because dropping new tables/columns can destroy committed gameplay state.

1. If a migration statement fails, PostgreSQL rolls that migration transaction back automatically and the migration ledger is not advanced.
2. If application rollout must be reverted while the schema is backward compatible, roll back application code and leave the additive schema in place.
3. If data/schema restoration is required, stop writers and use the WS30 backup/PITR recovery contract against a disposable verification restore before replacing production.
4. Never edit an applied migration to "undo" it; checksum enforcement treats that as corruption.

`public._oldko_migrations(name, checksum, applied_at)` remains compatible with the WS30 recovery contract.
