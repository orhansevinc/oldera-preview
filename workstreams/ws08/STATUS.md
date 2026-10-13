# WS08 — Admin API Status

## Scope

Branch: `ws08-admin-api`  
Base: `main`  
Write scope respected: `services/admin-api/**`, `tests/admin-api/**`, `workstreams/ws08/**`, `.github/workflows/ws08-admin-api.yml` only.  
`admin/**` was inspected read-only and was not modified.

## Implemented

- Server-side login/session using signed HttpOnly cookie.
- Server-side role/permission resolution. Browser-provided `actor`, `authority`, and `ROOT_OWNER` labels are never authorization inputs.
- Player search + online filter.
- Overview counters.
- Character details.
- Character level / NP / coin / zone edits with 1298-oriented validation.
- Character stat/skill mutation surfaces required by the existing character-service contract.
- Inventory (14 equipment + 28 bag slots) and Inn Hostess (192 slots / 8x24) read APIs.
- Account ban, IP ban, and ban removal.
- Item search, serial trace, duplicate serial query, and guarded moderation actions.
- Append-only audit API and mandatory non-empty audit reason for dangerous mutations.
- Compatibility exception: current frontend sends no reason in `DELETE /sanctions/:character`; the backend writes an explicit server-generated compatibility reason rather than dropping the audit reason or breaking the existing frontend contract.
- `Idempotency-Key` support for mutations.
- Transaction boundary (`repository.transaction`) around state change + audit write.
- GM command request/outbox surface. Commands are allow-listed server-side. Critical world commands require elevated `commands:critical` permission. No command is trusted/executed by the browser.
- OpenAPI 3.1 spec.
- GitHub Actions workflow.

## Frontend contract compatibility

Read-only sources reviewed:

- `admin/live-api.js`
- `admin/character-service.contract.json`
- `admin/command-registry.json`
- existing character control implementation

Compatibility target: **PASS for current live-api surface**.

The API base is `/api/admin`. Existing frontend calls are supported:

- health/session/login/logout
- overview
- players (`online`, `q`, `limit`)
- character details/inventory/inn
- commands
- account/IP sanctions + unban
- audit

The broader `character-service.contract.json` endpoints are also implemented: character PATCH, stats, skills, transactions, sanctions, item history/action/search.

## Endpoint count

**22 HTTP operations** under `/api/admin`.

## Tests

Command: `cd services/admin-api && npm test`

Local result before commit: **13 passed / 0 failed** on Node `v22.16.0`.

Coverage includes authentication, permission spoof rejection, frontend response shape, slot counts, validation, required audit reason, account/IP ban and unban, duplicate serial trace, critical command permission, idempotency, frontend contract smoke coverage, and OpenAPI operation count.

## Database / WS07 integration need

**YES — one integration step remains after WS07 is available.**

The service currently ships a deterministic `MemoryAdminRepository` for tests/development. Production integration is deliberately isolated behind `services/admin-api/src/repository.js` and requires a WS07-backed adapter implementing `REQUIRED_METHODS`.

Expected mapping:

- `accounts` / `characters` / `character_stats` -> player + character reads/edits
- `character_items` / `inventory` -> inventory and serial locations
- `inn_storage` -> 192-slot warehouse
- `bans` / `ip_bans` -> sanctions
- `audit_log` -> append-only admin audit
- durable command outbox/bridge -> `enqueueCommand`

No WS07 migrations were changed or guessed in this branch. Once WS07 schema/API is merged, wire the adapter in `src/server.js` and make the game/session service authoritative for online-character mutations.

## Remaining external dependency

Real GM command execution requires the future game-server command bridge. WS08 currently returns `202` with `game.forwarded=false` and a durable-repository-ready request object; it does not fake execution.
