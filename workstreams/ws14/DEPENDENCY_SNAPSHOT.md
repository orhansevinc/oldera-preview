WS14

# Dependency Snapshot

## SELF

- Workstream: `WS14`
- Branch: `ws14-world-session`
- Revalidation starting HEAD: `0f12a49eb72cb5e8f776193c0cce7feb7866e1cf`
- Main observed during control session: `6bf5ffa72585249ded580645bcbdb53359838953`
- Branch relation at revalidation start: ahead 1 / behind 10, merge base `a1c1d6b3e9aeb07fd066cee8a41714685557dddf`.
- No rebase, force-push, main merge, WS03 change, or WS05 change is part of this control session.

## UPSTREAM

### WS03 — KO 1298 session orchestration

- Branch: `ws03-ko1298-session`
- Observed HEAD: `3a087ab1d98969ef531ac6e3f682f4a463222f5e`
- Status: PARTIAL for the Moradon critical path.
- Existing auth/version/game-login/nation framing is present, but successful character list/create/select and post-select world handoff are still external to WS14.
- WS03 must validate authenticated ownership/selection and then call the WS14 contract documented below.

### WS45 — session ownership

- Branch: `ws45-session-ownership`
- Observed HEAD: `4a66338743553c2781c68ca84b866ff4e999c14e`
- Status: COMPLETE / integration-ready with a production shared atomic lease-store condition.
- Duplicate/disallowed ownership decisions must be resolved before the WS03 -> WS14 selected-character handoff.

### WS07 — persistence

- Branch: `ws07-database`
- Observed HEAD: `6e2585312702346dd98851bf97c9c008c51205a3`
- Status evidence: `workstreams/ws07/STATUS.md` is absent at this observation point; central task queue classifies WS07 as Priority-0 evidence repair.
- WS14 intentionally depends on a repository port and ships `MockWorldRepository`; a production `getCharacterForWorld(accountId, characterId)` adapter remains external integration work.

## DOWNSTREAM

### WS15 — movement synchronization

- Branch: `ws15-movement-sync`
- Observed HEAD: `ba44d65628a78f475b376a3996ff32b21ff1e1ab`
- Status: COMPLETE / HAZIR.
- Consumer contract: register the authoritative world spawn after WS14 world entry; world composition must also provide zone bounds and authoritative teleport baseline updates.

### WS16 — NPC world

- Branch: `ws16-npc-world`
- Observed HEAD: `e6ee973eead1dbd40f5e7a5e2eb7bc5bd29235a2`
- Status: implementation complete, integration conditional on world/session terrain-Y and socket opcode routing.
- WS14 does not absorb WS16 NPC interaction ownership.

### WS36 — world clock

- Branch: `ws36-world-clock`
- Observed HEAD: `adf25c055f50f26cbbc9ba81254307019ff5bcbd`
- Status: TAMAMLANDI.
- Time/weather composition is downstream integration work and does not change the WS14 selected-character bootstrap contract.

### WS05 — Moradon client loader

- Central Moradon critical-path status: UNPROVEN because a valid WS05 `STATUS.md` is absent.
- WS05 is a later client/render consumer; no WS05 file is modified by WS14.

## CONTRACTS

### Exact WS03 -> WS14 selected-character handoff

After WS03 has authenticated the game session, validated the `WIZ_SEL_CHAR` request, verified that `characterId` belongs to `accountId`, established a stable uint16 game `socketId`, and applied duplicate-session policy, it must call:

```js
const started = await world.beginSelectedCharacter({
  accountId,
  characterId,
  socketId,
});
```

`world` is an instance of `WorldSessionService` from `services/ko1298-world` with a repository implementing:

```js
getCharacterForWorld(accountId, characterId) -> Promise<Character|null>
getSurroundingUsers(query) -> Promise<User[]>
getSurroundingNpcs(query) -> Promise<Npc[]>
```

On success, `started.clientPackets` contains the WS14-authored 1298 `WIZ_SEL_CHAR (0x04)` success packet for Moradon zone 21/spawn. WS03 must send those packets unchanged and must not construct a competing world-placement success packet.

After that handoff, only WS14-owned world-session opcodes are routed to:

```js
const outcome = await world.handleClientPacket(socketId, payload);
```

Owned opcodes are `0x0D` GAMESTART, `0x16` request-user-detail, `0x1D` request-NPC-detail, and `0x27` zone-change phase. `outcome.clientPackets` go to the selected client; `outcome.broadcastPackets` go to the world/region broadcaster. Movement/combat/inventory/NPC interaction ownership stays outside WS14.

### 1298 state invariant

- `beginSelectedCharacter()` creates state `WAIT_GAMESTART_LOADING`.
- Client `[0x0D, 0x01]` produces MYINFO, Moradon zone ability, nearby ID bootstrap, and server `[0x0D]`, then state `WAIT_GAMESTART_LOADED`.
- Client `[0x0D, 0x02]` advances to `WORLD_READY` and emits USER_REGENE broadcast output.
- Legacy character-name GAMESTART packets are rejected.

## CONTROL / REHEARSAL EVIDENCE

- WS50 classifies the old WS14 closure as `missing commit`, not as a product-code conflict or test failure: the old STATUS evidence did not reference a verifiable branch ancestor.
- WS39 ISSUE-02/03/04 was generated from stale observations that treated the later WS14 provider surface as missing; WS40 explicitly requires refreshed compatibility review after late WS14 advancement.
- WS40 planned WS14 in the browser/login/character/world critical path after character selection and before WS05 render integration.

## BLOCKERS

- WS14 implementation/test blocker: NONE found in this revalidation.
- External composition prerequisites: WS03 must publish/wire character select handoff; WS07 must supply the production repository adapter; WS05 must later prove authentic client Moradon render.
- Those external conditions do not require expanding WS14 scope in this control session.

## TEST EVIDENCE

- Workflow: `WS14 world session`
- Run: `38475926954`
- Re-run job: `115578914128`
- Command: `node --test tests/ko1298-world/*.test.js`
- Result: `14 tests / 14 pass / 0 fail` on `0f12a49eb72cb5e8f776193c0cce7feb7866e1cf`.

## LAST_SYNC

2026-10-14 (Europe/Istanbul control session), against the branch and central-control evidence listed above.
