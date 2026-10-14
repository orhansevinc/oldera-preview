# WS08 — Admin API Status

Release: `oldkoweb-domain-live-20261015`

## Current implementation

WS08 now has a separate fail-closed production composition under `services/admin-api/src/production-app.js` and `src/server.js`.

Implemented on this branch:

- production startup refuses MemoryAdminRepository/demo fallback;
- production repository/runtime/command modules are explicit required dependencies;
- persistent, revocable server-side admin session contract;
- same-origin allowlist plus CSRF protection for unsafe authenticated requests;
- ROOT OWNER is bound only to immutable `ADMIN_ROOT_OWNER_ID`; requested OWNER role on another configured identity is stripped;
- authenticated actor/role/body spoof fields are not authorization inputs;
- overview/player online state is overlaid exclusively from authoritative WS03/WS45 runtime adapter data;
- online character mutation goes through `mutateOnlineCharacter` and never the offline repository SQL mutation path;
- offline character/stat/skill mutations require optimistic `expectedVersion`, durable idempotency and audit;
- item moderation requires optimistic item version;
- real read surfaces remain defined for players, character, inventory, inn, transactions, sanctions, item search/history/duplicates and audit;
- command translation consumes the WS28 semantic command bus interface instead of forwarding raw browser command strings;
- durable public command states are `PENDING`, `SUCCEEDED`, `FAILED`, `UNSUPPORTED`;
- no downstream execution is represented by the old `202 + game.forwarded=false` success-like response;
- unsupported legacy commands are explicit and machine-readable.

## Reviewed WS28 command support

Supported legacy translation:

- `CUTOFF` -> `player.kick`
- `SUMMONUSER` -> `player.summon` (requires explicit `toPlayerId` in frontend `arg`)
- `FORBIDUSER`, `FORBIDCONNECT` -> `account.ban`
- `FORBIDCHAT` -> `chat.mute`
- `PERMITCHAT` -> `chat.unmute`
- `NOTICE` -> `notice.zone`
- `NOTICEALL` -> `notice.global`
- `COUNT` -> `server.player-count`

Not claimed supported: `INVISIBLE`, `CLEAN`, `RAINING`, `SNOWING`, `TIME`, `ARREST`, `VIEW`, `UNVIEW`, `ATTACKDISABLE`, `ATTACKENABLE`, `PROGRAMLISTCHECK`.

Server restart/shutdown and arbitrary shell/process control are not exposed by WS08.

## Production owner contracts

See `workstreams/ws08/PRODUCTION_INTEGRATION_CONTRACT.md` for the exact WS07 repository methods, WS03/WS45 runtime methods, WS28 command composition, WS09 environment/secret list, and frontend request/response changes.

The accepted `admin/**` v10 frontend was read only and was not modified.

## Verified external blockers

### WS07

Current WS07 pin `1ae85c96319cbab11648a91ed28300e17d4c607f` has no WS08/admin adapter in `services/oldko-data/src/adapters/`. Its existing schema has accounts/characters/items/bans/audit, WS45 leases and generic persistence operation receipts, but there is no shipped production admin session repository or durable admin command outbox/status adapter.

Therefore this branch cannot truthfully claim a real PostgreSQL admin E2E yet. Production startup intentionally refuses to substitute memory storage. The exact adapter contract has been handed to WS07/WS50.

### WS03 / WS45

The runtime authority must expose authoritative online state plus online mutation delegation. WS45 provides shared session lease semantics; the WS08-specific runtime adapter is still an integration responsibility of WS03/WS45/WS50.

### WS28

WS08 consumes the reviewed `execute()` command-bus contract. Actual game/moderation/notices/observability adapters must be present in the WS28 composition module selected at deploy time; WS08 does not fake absent handlers.

### WS09

Production environment must provide `ADMIN_USERS_JSON`, `ADMIN_ROOT_OWNER_ID`, `ADMIN_SESSION_SECRET`, `ADMIN_ALLOWED_ORIGINS`, `ADMIN_REPOSITORY_MODULE`, `ADMIN_RUNTIME_AUTHORITY_MODULE`, `ADMIN_COMMAND_BUS_MODULE` and the WS07 database secret/config dependency.

## Tests

GitHub Actions run `38654675678`: **SUCCESS** at implementation commit `97771268f37735e6ebaad9ed48a6927438f65f59`.

The existing 13 tests remain green. Added production tests cover server-side owner binding, forged OWNER stripping, authoritative online filtering, CSRF enforcement, CAS/idempotent audited mutation, online runtime mutation routing, successful/unsupported/failed WS28 result separation, and server-side logout revocation.

A real-PostgreSQL restart-persistence test is still blocked by the verified missing WS07 admin adapter and is not reported as passed.

## Delivery claim

WS08 production backend wiring/security/authority boundaries are implemented and tested with durable-contract fixtures. **The panel is not claimed fully production-live yet** because the WS07 admin persistence adapter, WS03/WS45 admin runtime adapter, WS28 downstream composition, WS09 secrets/deploy, official frontend CSRF/version wiring, and WS10 live-domain verification are external release blockers.
