# WS08 production integration contract

Release: `oldkoweb-domain-live-20261015`

WS08 production fails closed unless a persistent admin repository, authoritative WS03/WS45 runtime source, and reviewed WS28 command bus composition are configured. `MemoryAdminRepository`, demo seeds and silent fallbacks are test/development only.

## Input pins verified at task start

- WS08: `239cdacf0fb6bacde5017fb3b787451595a3be0d`
- WS07: `1ae85c96319cbab11648a91ed28300e17d4c607f`
- WS03: `7c5f5f3584e7d3621aa5a318ad65c011bd77276f`
- WS28: `c1ef0f6e84456cb38edd2f3ce2b11ca5ff7de99a`
- WS35: `5327d50906d02c829add08cf1ca73fbe978526dc`
- WS45: `4a66338743553c2781c68ca84b866ff4e999c14e`
- WS48: `d3ec3873d4e7d6c254897e591addd0c220508914`

## WS07 exact missing production adapter contract

Current WS07 `services/oldko-data/src/adapters/index.js` has no WS08/admin adapter. WS08 therefore does not guess or add WS07-owned migrations. The future module selected by `ADMIN_REPOSITORY_MODULE` must export:

```js
async function createAdminRepository({ env }) { return repository; }
```

The returned repository must implement:

```text
transaction
 overview
 listPlayers
 getCharacter
 updateCharacter
 updateStats
 updateSkills
 getInventory
 getInn
 getTransactions
 getSanctions
 searchItems
 itemHistory
 itemAction
 findDuplicateSerials
 createSanction
 removeSanction
 appendAudit
 listAudit
 createAdminSession
 getAdminSession
 revokeAdminSession
 runIdempotent
 enqueueCommand
 updateCommand
 getCommand
```

Required semantics:

- reads use real `oldko.accounts`, `characters`, `character_stats`, inventory/item/inn, sanctions and append-only audit data;
- update methods accept `{ expectedVersion }` and must perform optimistic CAS, returning/throwing a deterministic version conflict rather than last-write-wins;
- `runIdempotent({key,actorId,kind}, work)` is durable across process restart and concurrent requests and replays one committed result without applying `work` twice;
- admin sessions are durable/revocable and must survive admin-api restart;
- command rows are durable and expose only `PENDING`, `SUCCEEDED`, `FAILED`, `UNSUPPORTED` as public state;
- `enqueueCommand` must commit `PENDING`/`UNSUPPORTED` before downstream execution; `updateCommand` persists semantic result/error; `getCommand` reads it after restart;
- audit remains append-only and records authenticated actor identity, not browser-supplied labels.

WS07 currently has suitable base account/character/item/ban/audit tables, WS45 lease persistence, and `PgOperationReceiptRepository`, but no production admin session/outbox/result adapter. Those are the exact DB-owner gaps; WS08 does not create competing schema.

## WS03 / WS45 authoritative runtime contract

The module selected by `ADMIN_RUNTIME_AUTHORITY_MODULE` must export:

```js
async function createAdminRuntimeAuthority({ env }) { return runtimeAuthority; }
```

Required methods:

```text
listOnlineCharacters()
getCharacterState(name)
mutateOnlineCharacter({name,kind,patch,expectedVersion,operationId,actorId,reason})
```

`listOnlineCharacters` and `getCharacterState` must be based on the authoritative game/session owner (WS03 plus WS45 lease ownership), not a stale DB `online` column or example value. `mutateOnlineCharacter` must enter the existing game/domain mutation path and persist through that authority; WS08 deliberately does not issue direct SQL for an online character.

## WS28 command composition contract

The module selected by `ADMIN_COMMAND_BUS_MODULE` must export:

```js
async function createAdminCommandBus({ env }) { return ws28CommandBus; }
```

The object must be the existing WS28 command bus (or its composition wrapper) and expose `execute(request)`. WS08 does not implement a second command framework.

Reviewed frontend translations are limited to:

| v10 command | WS28 command |
| --- | --- |
| `CUTOFF` | `player.kick` |
| `SUMMONUSER` | `player.summon` |
| `FORBIDUSER` / `FORBIDCONNECT` | `account.ban` |
| `FORBIDCHAT` | `chat.mute` |
| `PERMITCHAT` | `chat.unmute` |
| `NOTICE` | `notice.zone` |
| `NOTICEALL` | `notice.global` |
| `COUNT` | `server.player-count` |

`INVISIBLE`, `CLEAN`, `RAINING`, `SNOWING`, `TIME`, `ARREST`, `VIEW`, `UNVIEW`, `ATTACKDISABLE`, `ATTACKENABLE`, `PROGRAMLISTCHECK` are `UNSUPPORTED` until their domain owner supplies exact semantics/handler authority. A downstream WS28 failure becomes `FAILED`; it is never represented as successful HTTP 202 with `game.forwarded=false`.

## Admin identity/session security

Production requires these WS09-managed values:

```text
ADMIN_USERS_JSON
ADMIN_ROOT_OWNER_ID
ADMIN_SESSION_SECRET
ADMIN_ALLOWED_ORIGINS=https://admin.oldkoweb.com
ADMIN_REPOSITORY_MODULE
ADMIN_RUNTIME_AUTHORITY_MODULE
ADMIN_COMMAND_BUS_MODULE
DATABASE_URL (consumed by WS07 composition, not exposed to browser)
```

`OWNER` is not granted by username, first configured record, frontend label, or a body field. The server strips requested `OWNER` roles and grants it only to the configured identity whose immutable `id` equals `ADMIN_ROOT_OWNER_ID`; exactly one identity must match or startup fails.

Admin session cookies are opaque; their server-side session record is persistent and revocable. Unsafe authenticated operations require both an allowed `Origin` and `X-CSRF-Token` matching the session-bound CSRF secret. Login also requires an allowed Origin. Logout revokes the server-side session before clearing cookies.

## Frontend owner contract

The accepted v10 frontend remains read-only to WS08. The website/admin frontend owner must wire these backend requirements:

- `POST /api/admin/session/login` returns `user`, `csrfToken`, and `capabilities`; save the CSRF token in memory and send `X-CSRF-Token` on every POST/PATCH/DELETE after login.
- `GET /api/admin/session` returns the current `csrfToken` again for page reload recovery.
- All unsafe requests must send an `Idempotency-Key` of 8-128 stable characters; retrying the same user action must reuse the same key.
- Character/stat/skill and item mutation payloads must include `expectedVersion` from the latest read; HTTP 409 `VERSION_CONFLICT` means reload before retry.
- Command responses use `game.status` = `SUCCEEDED|FAILED|UNSUPPORTED`; do not show a success toast for anything except `SUCCEEDED`.
- `GET /api/admin/commands/:id` returns durable command state; `GET /api/admin/capabilities` exposes supported/unsupported command names.
- `SUMMONUSER` requires explicit `target` and `arg` (`toPlayerId`); `FORBIDCHAT` requires bounded `durationSeconds`; `NOTICE` requires `zoneId` plus message in `arg`.

Important error codes for the frontend: `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `ORIGIN_REJECTED` (403), `CSRF_REJECTED` (403), `IDEMPOTENCY_KEY_REQUIRED` (428), `EXPECTED_VERSION_REQUIRED` (428), `VERSION_CONFLICT` (409), `AUDIT_REASON_REQUIRED` (422), command `UNSUPPORTED` (422), and WS28/service failure (502/503/504 according to semantic error).

This file is intentionally owned by WS08 and does not modify WS07, WS03, WS28, WS35, WS45, WS48 or WS09-owned files.
