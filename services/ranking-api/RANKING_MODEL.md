# Ranking read model

## Scope

WS37 owns a public, read-only projection. It does not award XP/NP, mutate characters or clans, or define game rules. Authoritative game domains remain elsewhere.

## Character ranking

Canonical public fields: `rank`, `characterId`, `name`, `nation`, `classCode`, `level`, `nationalPoints`, optional `clanName`.

Supported ranking metrics:

- `level`: descending `level`
- `national_points`: descending `nationalPoints`

Filtering is applied before ranking: optional nation, class, and case-insensitive name search. Pagination is applied after ranking.

## Clan ranking

Canonical public fields: `rank`, `clanId`, `name`, `nation`, `points`, `memberCount`, optional `chiefName`.

Clan order is descending `points` with optional nation and case-insensitive name search filters.

## Stable ordering and ties

WS37 uses competition ranking (`1, 2, 2, 4`). Rows sharing the same primary metric receive the same public rank. Equal-score rows are deterministically ordered by case-insensitive display name and then stable entity ID. This makes page boundaries reproducible while preserving the tie.

Production repository adapters must reproduce this order before applying `OFFSET/LIMIT` (or equivalent cursor/page slicing). Suggested SQL shape is a `RANK() OVER (ORDER BY metric DESC)` for public rank plus `ORDER BY metric DESC, lower(name) ASC, id ASC` for deterministic row order.

## Snapshot timestamp

Every repository result must return `updatedAt`, representing the freshness of the underlying ranking snapshot/read model. The API exposes it unchanged as ISO-8601. It is not generated per request.

## Cache contract

Public ranking responses: `Cache-Control: public, max-age=30, stale-while-revalidate=60`.

OpenAPI document: `public, max-age=300`.

Health and error responses: `no-store`.

## Privacy boundary

Repository rows are treated as untrusted internal data. The service builds output from a positive public-field whitelist. Fields such as account username, email, IP, ban reason, password/auth data, and private admin metadata cannot pass through implicitly.
