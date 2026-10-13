WS14

# Status

- Workstream: `WS14`
- Branch: `ws14-world-session`
- State: `TAMAMLANDI`
- Scope: server-side KO 1298 selected-character -> Moradon world-session initialization
- Implementation: complete within WS14 ownership
- Moradon critical-path readiness: `INTEGRATION-READY` at the WS14 boundary
- Implementation commit: `0f12a49eb72cb5e8f776193c0cce7feb7866e1cf`
- Closing evidence commit: `8f013cbeab397e03dcd1a816d7d8b93c511d3ad2`
- Closing evidence relation: the STATUS-closing commit is a direct descendant of the closing evidence commit; no missing/non-ancestor SHA is used.

## Revalidation result

Existing implementation was re-read against the current WS14 branch and the current central control/dependency evidence. No WS14 product-code defect requiring a scope expansion was found.

Complete WS14 test suite was explicitly re-run on the implementation HEAD:

```text
Workflow: WS14 world session
Run: 38475926954
Re-run job: 115578914128
Command: node --test tests/ko1298-world/*.test.js
Result: 14 tests / 14 pass / 0 fail
Commit tested: 0f12a49eb72cb5e8f776193c0cce7feb7866e1cf
```

The test coverage reconfirms:

- WS14 rejects combat/movement/inventory opcodes outside its ownership;
- obsolete pre-1298 character-name GAMESTART shape is rejected;
- Moradon is zone 21 with verified 312/402/0 spawn;
- `WIZ_SEL_CHAR` success layout matches the 1298 client parser;
- 1298 GAMESTART is the verified two-phase `[0x0D,0x01]` -> server `[0x0D]` -> `[0x0D,0x02]` flow;
- zone-change phase serialization/state transitions are exact;
- MYINFO, zone ability, region user/NPC bootstrap and detail records are covered;
- `WORLD_READY` is reached only after GAMESTART phase 2;
- repository account/character ownership boundary is enforced.

## Exact WS03 contract

After WS03 authenticates the game session, validates `WIZ_SEL_CHAR`, proves that the selected character belongs to the account, establishes a stable uint16 `socketId`, and applies duplicate-session policy, it must call:

```js
const started = await world.beginSelectedCharacter({
  accountId: authenticated.accountId,
  characterId: selectedCharacterId,
  socketId: connection.socketId,
});

for (const packet of started.clientPackets) {
  connection.send(packet);
}
```

WS14 owns the successful `WIZ_SEL_CHAR (0x04)` world-placement packet returned by this call. WS03 must not construct a competing success packet after the handoff.

Subsequent WS14-owned world-session opcodes are routed with:

```js
const outcome = await world.handleClientPacket(connection.socketId, payload);
```

Only `0x0D`, `0x16`, `0x1D`, and `0x27` belong to this WS14 dispatcher surface. Exact argument/return/repository details are pinned in `workstreams/ws14/INTEGRATION_PATCH.md` and `workstreams/ws14/DEPENDENCY_SNAPSHOT.md`.

## Delivered

- `services/ko1298-world/WORLD_SESSION_PROTOCOL.md`
- protocol-evidenced packet serializers/parsers
- two-phase 1298 GAMESTART state machine
- Moradon world initialization (zone 21, 312/402/0)
- 1298 MYINFO and Moradon zone-ability serialization
- surrounding user/NPC ID bootstrap and detail replies
- 1298 zone-change TELEPORT/LOADING/LOADED state machine
- world-ready state and USER_REGENE broadcast output
- mock repository and production repository port contract
- tests under `tests/ko1298-world/**`
- CI workflow `.github/workflows/ws14-world.yml`
- integration handoff `workstreams/ws14/INTEGRATION_PATCH.md`
- dependency evidence `workstreams/ws14/DEPENDENCY_SNAPSHOT.md`

## Dependencies / integration conditions

- WS03 `ws03-ko1298-session@3a087ab1d98969ef531ac6e3f682f4a463222f5e`: still needs successful character list/create/select and the post-select call into the exact WS14 contract above.
- WS45 `ws45-session-ownership@4a66338743553c2781c68ca84b866ff4e999c14e`: complete; duplicate-session/ownership policy should run before the WS14 handoff.
- WS07 `ws07-database@6e2585312702346dd98851bf97c9c008c51205a3`: production repository adapter remains external; STATUS evidence was still absent when checked.
- WS15/WS16/WS36 are downstream composition consumers; their code is not absorbed into WS14.
- WS05 remains a later, unproven client/render gate and is not modified here.

These are integration/composition prerequisites, not unresolved WS14 implementation defects.

## WS50 objection resolution

WS50 classified the prior WS14 closure as `missing commit` because its STATUS evidence did not identify a SHA that could be verified as a branch ancestor. This control session fixes that evidence chain: `8f013cbeab397e03dcd1a816d7d8b93c511d3ad2` is a concrete commit on `ws14-world-session` containing the refreshed dependency evidence and exact integration contract, and this STATUS update is committed directly on top of that branch history.

WS50 reported no actual Git merge conflict for WS14 and no WS14 test failure. The specific missing-commit/evidence objection is therefore resolved by this closure.

## WS39 / WS40 note

The existing WS39 ISSUE-02/03/04 snapshot predates the late WS14 provider surface and treated WS14 as missing. WS40 explicitly requires compatibility to be refreshed against frozen integration SHAs. That refresh belongs to WS39/integration control; it is not a reason to duplicate or alter WS15/WS16/WS03 code here.

## Explicitly not implemented / modified

Combat, movement, inventory mutations, NPC AI/interaction ownership, gateway transport, DB migrations, client changes, WS03 changes, WS05 changes, admin/site changes, main merge and force push.

## Verification basis

Primary packet evidence remains pinned to Open-KO/KnightOnline commit `7d6cf81093e142c928c2ac9510512b2b182178b5`, whose client source declares `CURRENT_VERSION = 1298`. Moradon zone/spawn data remains pinned to Open-KO/OpenKO-db commit `bec619466938d278339c30e5b1a4bff3c9413bab`.

The earlier legacy 1097-style GAMESTART assumption remains removed and regression-tested.

## Closure

WS14 is integration-ready for the Moradon critical path at its owned server-side world-session boundary. The next critical-path work is external composition: WS03 character-select handoff, production repository wiring, and later WS05 real-client Moradon render validation.

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
