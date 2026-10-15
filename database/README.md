# OldKO persistence database

P2-11 continues WS07 on PostgreSQL 16. The database layer owns durable storage, transaction boundaries, locking primitives, constraints and repository adapters; gameplay/business rules remain in their owning workstreams. Production authority is one PostgreSQL database and the `oldko` schema; browser localStorage and process memory are never persistence authorities.

## Canonical migration order

All production schema mutation is forward-only through `services/oldko-data/src/scripts/migrate.js` and `public._oldko_migrations`:

1. `0001_init.sql`
2. `0002_persistence_hardening.sql`
3. `0003_public_account_api.sql`
4. `0004_admin_persistence.sql`
5. `0005_phase2_data_admin.sql`

`0005` folds the historical WS13 `account_rate_limits` table into this canonical sequence and adds generic persistence surfaces for quest state, boss/event timing state, non-secret runtime configuration, runtime apply receipts, heartbeat-backed server status, admin content observations and runtime-confirmed privileged-command results. The historical `services/account-api/sql/0001_postgres_rate_limit.sql` remains as source history only; its compatibility command is verification-only and refuses to mutate a database that has not reached canonical `0005`.

Live application is intentionally not performed by P2-11. P2-00/P2-12 must back up the real database, run the canonical migrator once, verify its checksum ledger and then perform restore/restart validation.

## Local development

```bash
cd database
docker compose up -d
cd ../services/oldko-data
npm install
DATABASE_URL=postgres://oldko:oldko_dev_only@127.0.0.1:5432/oldko npm run migrate
OLDKO_ENV=development OLDKO_DEV_SEED_PASSWORD='<local-only-secret>' \
  DATABASE_URL=postgres://oldko:oldko_dev_only@127.0.0.1:5432/oldko npm run seed:dev
DATABASE_URL=postgres://oldko:oldko_dev_only@127.0.0.1:5432/oldko npm run test:integration
```

The deterministic fixture is `ws07test / WS07Hero`; its password is always supplied by `OLDKO_DEV_SEED_PASSWORD`. Production refuses `seed:dev`.

## Migration guarantees

The migrator serializes runners with a PostgreSQL advisory lock, applies each migration in its own transaction, stores SHA-256 checksums in `public._oldko_migrations`, refuses mutation of an already-applied migration and supports `OLDKO_MIGRATION_TARGET=<filename>` for upgrade-path testing only. `0005` deliberately contains no transaction control statements because the canonical migrator owns the boundary.

Never edit an applied migration. Add a new forward migration. Destructive recovery remains delegated to P2-12/WS30 backup and restore procedures.

## Validation commands

```bash
npm run check
npm test
npm run migrate
npm run verify:schema
npm run test:integration
npm run explain
```

`verify:schema` requires the exact `0001..0005` ledger. P2-13 must additionally verify persistence across a real service/PostgreSQL restart for account, character position, items, quest, progression and clan membership, plus unauthorized admin access denial.
