# WS28 Integration Patch

This document is the handoff for WS08 / the future game-operation adapters. No WS08 or game-domain files are changed by WS28.

## Integration rules

1. Instantiate `createGmCommandBus` in trusted server code with `authorizer`, durable `auditSink`, production `idempotencyStore`, and explicit adapters.
2. WS08 must not forward the frontend command string directly. Translate a reviewed frontend action into one canonical WS28 command.
3. Build actor identity from the authenticated server session, not request-body actor fields.
4. Generate/namespace `requestId` server-side, require an operator reason, and copy only safe correlation metadata.

## Suggested compatibility translations

| Frontend reference | WS28 canonical command | Notes |
|---|---|---|
| `CUTOFF` | `player.kick` | reviewed disconnect operation |
| `SUMMONUSER` | `player.summon` | explicit source/target semantics required |
| `FORBIDUSER` / `FORBIDCONNECT` | `account.ban` | persistence remains moderation adapter responsibility |
| `FORBIDCHAT` | `chat.mute` | explicit bounded duration required |
| `PERMITCHAT` | `chat.unmute` | explicit target |
| `NOTICE` | `notice.zone` | explicit `zoneId` |
| `NOTICEALL` | `notice.global` | global notice |
| `COUNT` | `server.player-count` | read-only |

Do not map ambiguous or critical names (`ARREST`, `VIEW`, `UNVIEW`, `CLEAN`, `ATTACKDISABLE`, `ATTACKENABLE`, weather/time commands) until exact server semantics and adapter contracts are defined.

## Adapter contracts

`gameOperations`: `kickPlayer`, `previewKickPlayer`, `teleportPlayer`, `previewTeleportPlayer`, `summonPlayer`, `previewSummonPlayer`.

`moderation`: `banAccount`, `previewBanAccount`, `unbanAccount`, `previewUnbanAccount`, `mutePlayer`, `previewMutePlayer`, `unmutePlayer`, `previewUnmutePlayer`.

`notices`: `sendZoneNotice`, `sendGlobalNotice`.

`observability`: `getPlayerCount`.

Adapters should throw `ServiceUnavailableError` for known downstream availability failures and must not expose a generic `execute(commandString)` method.

## Result mapping suggestion

- `ok` / `dry-run`: HTTP 200
- `VALIDATION_ERROR`: 400
- `COMMAND_NOT_ALLOWED`: 400 or 404
- `FORBIDDEN`: 403
- `TIMEOUT`: 504
- `SERVICE_UNAVAILABLE`, `AUTHORIZATION_UNAVAILABLE`, `AUDIT_UNAVAILABLE`, `IDEMPOTENCY_UNAVAILABLE`: 503
- `EXECUTION_FAILED`: 502/500 depending on adapter semantics

WS28 is additive. Integrators should merge/cherry-pick its commit, then wire WS08 and concrete service adapters in their own allowed workstreams. No main merge is performed here.
