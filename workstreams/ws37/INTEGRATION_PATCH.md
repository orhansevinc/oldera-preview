# WS37 Integration Patch

## Purpose

Connect the public Ranking API to the persistence/read-model source after WS07 is available on the integration branch. WS37 itself intentionally has no direct DB dependency or migration.

## Required adapter

Implement `RankingRepository` from `services/ranking-api/src/repository.js` in integration-owned code or inside the ranking service after the relevant WS07 schema is merged.

The adapter must implement:

- `fetchCharacterRanking({ metric, nation, classCode, search, offset, limit })`
- `fetchClanRanking({ nation, search, offset, limit })`

Each returns `{ items, total, updatedAt }`.

## Ordering contract

Filtering happens first. Ranking/order happens next. Pagination happens last.

Character order:

- metric DESC
- `lower(character_name)` ASC
- stable character ID ASC

Clan order:

- points DESC
- `lower(clan_name)` ASC
- stable clan ID ASC

Public rank uses SQL-style competition ranking (`RANK()` semantics) on the primary metric only. Equal metric values share the same rank while deterministic secondary ordering preserves stable pages.

## Suggested read-only SQL approach

Use a CTE/view with `RANK() OVER (ORDER BY <metric> DESC)` and a separate final `ORDER BY <metric> DESC, lower(name), id`. Apply nation/class/search predicates before the window function. Use a second `COUNT(*)` or `COUNT(*) OVER()` for `total`.

The DB credential used by this service should have SELECT-only access to the minimal read model. Do not grant mutation permissions.

## Privacy mapping

It is acceptable for the adapter query to join internal tables, but the service response is hard-whitelisted. Do not add account username, email, IP, ban reason, password/auth fields, or admin metadata to public DTO whitelists.

## Website integration

The official site can call:

- `/v1/rankings/levels`
- `/v1/rankings/national-points`
- `/v1/rankings/clans`

or the generic `/v1/rankings/characters?metric=...` endpoint. Respect `updatedAt` and the response cache headers; the frontend does not need to poll faster than the cache freshness window.

## Integration condition

Ready after a concrete WS07 schema/read-replica shape is present. No migration from WS37 is required.
