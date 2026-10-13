# WS07 integration contract

WS07 does not modify the gateway, KO protocol server, admin frontend, website, or client. Consumers instantiate one PostgreSQL pool and repositories from `services/oldko-data/src/index.js`.

## Character/auth service

Use `PgAccountRepository` for `findByUsername`, `findById`, `create`, and `getBanState`. Password verification is `verifyPassword(plain, account.password_hash)`. Store session tokens only after hashing them into `account_sessions.token_hash`.

Use `PgCharacterRepository` for `listByAccount(accountId)`, `selectCharacter(accountId, slot)`, and `createCharacter(accountId, input)`. Character creation locks the account row and relies on DB uniqueness for three live slots and unique live names. The protocol service remains responsible for mapping 1298 packet fields to repository input.

## Inventory/game service

Use `PgInventoryRepository.moveItem({ itemInstanceId, from, to, actorAccountId })`. Locations are `{kind:'equipment'|'inventory'|'inn', ownerId, slot, page?}`. Do not implement a read-delete-write sequence outside this repository. The operation uses SERIALIZABLE transaction retries plus `SELECT ... FOR UPDATE` on the canonical `item_instances` row; DB triggers reject cross-location duplicate placement.

`item_instances.item_template_id` is deliberately not yet a foreign key so the future real 1298 item table can be imported without coupling WS07 to a guessed schema. Add the FK only after the authoritative item-table workstream publishes its key contract.

## Admin API

Use `PgAdminRepository` for account overview, account ban/unban, IP/CIDR ban/unban, and generic audit append. The admin API supplies `actorAccountId`, `requestId`, and source IP where available. UI code must not connect directly to PostgreSQL.

## Schema

- `accounts`: identity, password hash, account state.
- `account_sessions`: hashed session token, IP/user-agent, expiry/revocation.
- `characters`: 3 slots/account, nation/race/class/appearance/zone position.
- `character_stats`: level/EXP/HP/MP/base stats/points/loyalty/gold.
- `item_instances`: canonical unique item serial and mutable instance state; future real 1298 item-template link.
- `character_items`, `inventory`, `inn_storage`: item placement tables.
- `clans`, `clan_members`: minimal clan foundation.
- `bans`, `ip_bans`: expiring/revocable enforcement records.
- `audit_log`: append-only operator/security log.
- `server_state`: versioned JSONB global state.

## Transaction boundary

For new multi-step persistence operations, use `withTransaction(pool, fn)`. Inventory moves already own their SERIALIZABLE transaction and must not be nested. Dynamic SQL values must remain parameterized; the only dynamic transaction isolation string is allow-listed inside `withTransaction`.

## Environment

- PostgreSQL 16+
- `DATABASE_URL`
- optional `OLDKO_DB_SSL=require`
- `OLDKO_DEV_SEED_PASSWORD` only in development/test when seeding `osevinc`

## Delivery / validation

Branch: `ws07-database`

```bash
cd services/oldko-data
npm run check
npm test
DATABASE_URL=postgres://... npm run migrate
```

CI starts PostgreSQL 16, applies migrations twice to validate migration bookkeeping, runs the development seed with an environment-supplied password, verifies required tables, and proves duplicate item serial plus cross-location duplicate placement are rejected with PostgreSQL SQLSTATE `23505`.
