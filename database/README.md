# OldKO persistence database

WS07 targets PostgreSQL 16. The database layer owns durable storage, transaction boundaries, locking primitives, constraints and repository adapters; gameplay/business rules remain in their owning workstreams.

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

Migration SQL lives in `database/migrations`. The migrator:

- serializes runners with a PostgreSQL advisory lock;
- applies each migration in its own transaction;
- stores SHA-256 checksums in `public._oldko_migrations`;
- refuses mutation of an already-applied migration;
- supports `OLDKO_MIGRATION_TARGET=<filename>` for upgrade-path testing only.

Never edit `0001_init.sql` after it has shipped. Schema hardening is additive/forward-only in `0002_persistence_hardening.sql`. Rollback and recovery policy is documented in `workstreams/ws07/MIGRATIONS.md` and delegates destructive recovery to WS30 backup/PITR procedures.

## Validation commands

```bash
npm run check
npm test
npm run migrate
npm run verify:schema
npm run test:integration
npm run explain
```

`npm run explain` checks that critical account-session, ban, live-character, session-lease and active-trade lookups can use their intended indexes. Read repositories use bounded/fixed query counts; no per-item SELECT loop is used for world or inventory snapshot loading.
