WS03

# Status

- Workstream: `WS03`
- Branch: `ws03-ko1298-session`
- State: `TAMAMLANDI`
- Moradon critical-path readiness: `M1 COMPLETE / READY FOR INTEGRATED M2 E2E`
- Implementation commit: `6dfb73e61d14676559d786baf332632cfd15de9d`
- Control snapshot: `main@6bf5ffa72585249ded580645bcbdb53359838953`

## Inbox completion

The current `coordination/inbox/WS03.md` task is implemented within WS03 ownership:

- existing auth server-list/login/news behavior retained;
- GAME version remains exactly 1298;
- actual WASM JvCryption requirement resolved from WS11 evidence: `_CRYPTION` is compiled, response includes `publicKey:u64`, and WS03 sends a zero key so the verified client remains plaintext;
- existing GAME login/nation behavior retained;
- successful three-slot `WIZ_ALLCHAR_INFO_REQ (0x0C)` response implemented;
- occupied/createable slot model implemented;
- `WIZ_NEW_CHAR (0x02)` request parse + repository create + exact success `02 00` implemented;
- successful create is persisted before the client's refreshed `0x0C`, so the occupied slot appears immediately;
- `WIZ_SEL_CHAR (0x04)` validates authenticated account ownership and `zoneInit`;
- select success is not fabricated by WS03: validated selection invokes WS14 `beginSelectedCharacter({ accountId, characterId, socketId })` and relays its packet;
- post-select WS14-owned `0x0D`, `0x16`, `0x1D`, and `0x27` packets are routed to `handleClientPacket()`;
- stable uint16 GAME socket IDs are allocated by the standalone server;
- missing WS14 composition returns select failure instead of duplicating world logic.

## Verification

Local Node 20-compatible suite run against the implementation tree:

```text
Command: cd services/ko1298-session && npm test
Result: 10 tests / 10 pass / 0 fail
```

Additional local checks:

```text
node --check services/ko1298-session/*.js
node --check tests/ko1298-session/*.js
trailing-whitespace scan: clean
```

The tests cover:

- AA55 framing and fragmented TCP input;
- AUTH server list/login fixture behavior;
- version `1298` + eight-byte zero JV public key;
- unchanged plaintext GAME login/nation selection;
- empty three-slot character list with 173-byte payload / 179-byte full frame;
- real WS04 create request layout and exact `02 00` success;
- refreshed occupied slot after create;
- account/character ownership rejection paths;
- WS14 `beginSelectedCharacter()` invocation with stable socket ID;
- exact WS14 Moradon select-success packet relay in the contract test;
- forwarding of the subsequent `0D 01` GAMESTART packet to the WS14 dispatcher;
- framed create -> refresh -> select sequence.

The GitHub commit-status surface returned no published status contexts for the implementation commit at closure time, so this report does not invent a GitHub Actions PASS claim. The deterministic local suite above is the executed evidence for this control session.

## Furthest verified protocol state

**WS03-owned automated verification now reaches successful character create -> refreshed occupied character list -> validated `WIZ_SEL_CHAR` -> invocation of the WS14 selection boundary, then routes the first post-select `WIZ_GAMESTART 0D 01` into the WS14 dispatcher contract.**

This is the closure condition from the WS03 inbox. It is not a claim that a live browser has already rendered Moradon.

## Exact remaining blocker to real Moradon entry

The immediate remaining proof is integrated M2/M3 composition, not another WS03 packet implementation:

1. compose WS02 transport + this WS03 commit + WS14 world service;
2. provide the production/integration world repository snapshot required by WS14 for `MYINFO`/GAMESTART fields rather than the intentionally minimal WS03 memory fixture;
3. run WS04's real WASM browser flow and capture genuine `WIZ_NEW_CHAR` + `WIZ_SEL_CHAR` evidence against that integrated stack;
4. run the later WS05 authentic Moradon render/spawn gate.

For production multi-process safety, WS45's character/account lease policy also remains a composition requirement before world spawn; WS03 does not duplicate that domain or invent unverified KO numeric mappings for WS45 semantic errors.

## Dependency evidence

Frozen provider commits and readiness are recorded in `workstreams/ws03/DEPENDENCY_SNAPSHOT.md`:

- WS04 `fffbd9372b67c2aaef600f7e50595bec7e23fe88`
- WS11 `05562662d9d3f13a4b0500d0478e065fd802cfd0`
- WS14 `82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b`
- WS50 `9112bb4e326d016f3ca8a2a56495e3421ffa76c5`

WS14's earlier WS50 missing-evidence objection is resolved by its later revalidation branch head; no actual Git merge conflict was reported for WS03/WS14 in that rehearsal.

## Explicitly not claimed

- no merge to `main`;
- no client/WASM edits;
- no WS14 world logic copied into WS03;
- no production DB implementation in the memory fixture;
- no claim of live-browser Moradon render;
- no non-zero JV crypt implementation.

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
