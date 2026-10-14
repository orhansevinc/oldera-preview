WS03

# STATUS — production gameplay session coordinator

State: IMPLEMENTED / CI-VERIFYING
Branch: `ws03-ko1298-session`
Starting head for this control task: `237c4a613e94434baae656c1399cb449e7b78067`

## Result

WS03 is no longer only the M1 character-select bridge. It now provides the authenticated long-lived GAME connection dispatcher/session coordinator while preserving the canonical login -> character -> WS14 Moradon path.

Implemented in WS03 scope:

- canonical session FSM: `CONNECTED -> AUTHENTICATED -> CHARACTER_SELECTED -> WORLD_LOADING -> WORLD_READY -> DISCONNECTING -> CLOSED`;
- one canonical identity record for socket/account/character/zone/runtime entity;
- verified opcode ownership matrix with no guessed WS17/WS19/WS22 opcodes;
- WS14 world lifecycle regression-preserving route;
- raw WS15 `WIZ_MOVE (0x06)` / `WIZ_ROTATE (0x09)` routing, world-ready registration, zone-transition teleport baseline reset, cleanup;
- raw WS16 `WIZ_NPC_EVENT (0x20)` / `WIZ_TARGET_HP (0x22)` routing with immutable authenticated actor context;
- explicit guarded `0x1D` WS14/WS16 ownership boundary, defaulting to WS14;
- WS17 inventory, WS19 combat, WS22 economy trusted domain ports without packet-number invention;
- standardized WS25/WS26/WS27 outbound event encoder port;
- WS45 account/character acquisition boundary and duplicate-session-compatible disconnect release;
- stable WS45 string session id `game:<socketId>` while retaining uint16 runtime `socketId`;
- deterministic/idempotent downstream cleanup sequence;
- classified malformed/downstream/ownership/backpressure/transport failures;
- fail-closed malformed packet behavior;
- controlled unknown/unowned opcode ignore;
- per-session ordered async dispatcher with queue byte/packet limits;
- disconnect-vs-pending-operation race handling;
- collision-safe active socket-id pool;
- socket pause/resume transport backpressure;
- safe opt-in packet metadata trace with no payload/password/secret logging.

## Regression evidence retained

The implementation preserves the wire behavior covered by the previous 10 WS03 tests: frame fragmentation, AUTH server list/login, version 1298 + zero JV key, nation, three-slot character list, create-refresh, select ownership, WS14 handoff, and byte-framed character sequence.

Latest previously proven external evidence consumed:

- WS10 canonical Moradon E2E PASS: run `#26` / `38505039290`.
- WS50 READY handoff: `9e0fc1822351965755fc490c2d2abf34d40f430d`.
- latest public WS09 ephemeral staging PASS observed: run `#6` / `38515548307` using pre-hardening WS03 `237c4a...`; tunnel later expired by design.

## Tests

Local Node 20-compatible suite before commit:

```text
37 tests
37 pass
0 fail
0 skipped
```

Coverage includes login/character regression, state transitions, wrong-state handling, malformed packet, unknown opcode, WS15 movement/rotate mocks, WS14->WS15 zone transition, WS16 NPC mocks, 0x1D guard, WS17/19/22 actor trust boundary, WS25/26/27 delivery, WS45 duplicate policy, deterministic + duplicate cleanup, downstream exceptions, async ordering, disconnect race, backpressure, rapid disconnect, concurrent sessions, socket-id allocation, safe logging, public staging protocol contract, and the requested deterministic `login -> char select -> world ready -> movement -> NPC -> disconnect` fixture.

CI additionally materializes pinned **real** WS14 + WS15 + WS16 + WS45 service trees read-only and runs `composed-contracts.contract.js` against their actual APIs.

## Direct integration readiness

- WS14: YES for begin/select + world packet lifecycle. Cleanup hook still missing in current WS14 public contract.
- WS15: YES, direct `MovementService` API.
- WS16: YES for `0x20`/`0x22`; `0x1D` stays guarded pending ownership resolution.
- WS45: YES, direct `SessionOwnershipService` API.
- WS17: actor/domain port ready; inbound packet binding blocked on verified opcode/payload contract.
- WS19: actor/domain port ready; inbound packet binding blocked on verified opcode/payload contract.
- WS22: actor/domain port ready; inbound packet binding blocked on verified opcode/payload contract.
- WS25/WS26/WS27: outbound event port ready; client encoders/opcodes remain downstream/composition evidence work.

## Concrete remaining blockers

1. **WS14 disconnect cleanup contract:** current `WorldSessionService` exposes no public disconnect/cleanup method, so WS03 will call the hook when provided but will not reach into WS14's internal `sessions` map.
2. **`0x1D WIZ_REQ_NPCIN` ownership collision:** WS14 currently owns it for the proven Moradon bootstrap while WS16 also claims it. Default remains WS14 until central integration resolves the split and reruns Moradon.
3. **WS17/WS19/WS22 inbound packet evidence:** no verified 1298 opcode/payload mapping in the consumed integration contracts; WS03 refuses to guess.
4. **WS25/WS26/WS27 client encoding:** standardized delivery exists, but verified event-to-packet encoders are not supplied by those contracts.
5. **Fresh public staging proof for this new WS03 head:** latest public PASS used `237c4a...`; after CI this head must be promoted through WS50/WS09 for a new external WSS proof.
