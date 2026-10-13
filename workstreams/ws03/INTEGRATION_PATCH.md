WS03

# Integration handoff

This branch owns KO 1298 AUTH/GAME session orchestration through character validation and the call into WS14. It does not absorb WS04 client code, WS14 world logic, gateway code, database migrations, or production session-ownership storage.

## What WS03 now provides

`services/ko1298-session` provides:

- AA55 frame encode/decode with TCP fragmentation support;
- login server list/login/news behavior retained from the prior WS03 implementation;
- GAME version `1298` plus source-verified zero JV public key;
- GAME login and nation selection retained;
- exact three-slot `WIZ_ALLCHAR_INFO_REQ` success serialization;
- `WIZ_NEW_CHAR` parse/create/success and repository persistence;
- refreshed occupied character list after create;
- authenticated/owned `WIZ_SEL_CHAR` validation;
- stable uint16 socket ID allocation in the standalone server;
- WS14 `beginSelectedCharacter()` handoff rather than local world-success fabrication;
- forwarding of WS14-owned `0x0D`, `0x16`, `0x1D`, and `0x27` packets after selection.

## WS04 contract

The server sequence expected by the real client is now:

```text
client  0C                         -> server
server  0C 01 <three slots>        -> client
client  02 <create body>           -> server
server  02 00                      -> client
client  0C                         -> server
server  0C 01 <occupied slot>      -> client
client  04 <account/char/zone>     -> server
WS03 validates account ownership
WS03 -> WS14 beginSelectedCharacter(...)
WS14  -> WIZ_SEL_CHAR success      -> client through WS03 transport
```

The real client, not WS03, owns the scene transition and automatic list refresh after create success.

## WS14 composition

After branches are composed, `server.js` detects `services/ko1298-world` and constructs one shared `WorldSessionService` with the session repository. The `GameSession` itself accepts any object implementing the exact WS14 methods, which keeps tests and production composition explicit:

```js
new GameSession(repository, {
  worldSession,
  socketId,
  onWorldBroadcast,
})
```

Character selection calls:

```js
await worldSession.beginSelectedCharacter({
  accountId,
  characterId,
  socketId,
})
```

World packets call:

```js
await worldSession.handleClientPacket(socketId, payload)
```

WS03 requires WS14 to return `WIZ_SEL_CHAR` success as the first packet from the selection handoff. A missing WS14 provider produces `04 00`; there is no fallback fake Moradon packet.

## Repository boundary

`MemoryRepository` remains a deterministic development fixture for `osevinc / osevinc`. It supports nation + three character slots and proves create/list/select ownership. It is not a production database adapter.

Its `getCharacterForWorld()` is intentionally only sufficient to prove that WS03 invokes the WS14 repository boundary with the selected identity. WS14's subsequent `WIZ_GAMESTART` / `MYINFO` path requires the production world snapshot fields described by the WS14 repository contract. Those fields must come from the persistence/integration layer rather than being invented as WS03 defaults.

## Duplicate-session policy

WS03 proves account/character ownership locally before the WS14 handoff. The cross-process duplicate-account/duplicate-character lease policy remains the WS45 composition boundary. WS45's own contract requires `acquireCharacter()` after character validation and before world spawn. No unverified KO numeric error mapping is fabricated in this branch.

## Integration gate

After WS03 + WS14 are composed with a production world repository, rerun WS04's real browser character gate against the integrated gateway/session server. Passing the WS03 unit/integration suite alone is not evidence that the real WASM rendered Moradon; that later proof belongs to the M2/M3 control gates.
