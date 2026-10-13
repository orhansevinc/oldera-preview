# OldKO database

PostgreSQL 16 is the target database. It was chosen for transactional DDL, `FOR UPDATE` row locks, SERIALIZABLE isolation, partial/unique indexes, `inet/cidr` types, JSONB audit metadata, advisory migration locks, and mature Docker/managed-hosting support.

## Development

```bash
cd database
docker compose up -d
cd ../services/oldko-data
npm install
DATABASE_URL=postgres://oldko:oldko_dev_only@127.0.0.1:5432/oldko npm run migrate
OLDKO_ENV=development OLDKO_DEV_SEED_PASSWORD=change-me DATABASE_URL=postgres://oldko:oldko_dev_only@127.0.0.1:5432/oldko npm run seed:dev
```

Use `OLDKO_DEV_SEED_PASSWORD` only for the development seed. The repository contains no seed plaintext password. Production should supply `DATABASE_URL` and secrets through its secret manager and should not run `seed:dev`.

Migrations are ordered SQL files under `database/migrations`. The migrator records SHA-256 checksums in `public._oldko_migrations`, serializes migration runners with an advisory lock, and refuses an already-applied migration whose contents changed.
