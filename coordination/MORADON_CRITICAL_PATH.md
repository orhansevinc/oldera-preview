# OldKOWeb — Moradon Critical Path

Primary user milestone: real browser client reaches authentic KO 1298 Moradon with a selected/created character.

This path temporarily outranks non-critical feature integration work.

## Current verified state

### Client baseline / WS04
- Real login -> server list -> version 1298 -> game login.
- Real Nation Select.
- Nation Select -> real Character Select scene.
- Genuine 1298 Character Select UIF/assets load.
- Client sends WIZ_ALLCHAR_INFO_REQ (0x0C) and can receive three empty slots.
- Empty slot opens the real Character Create scene.
- Client-side driver is designed to continue through WIZ_NEW_CHAR emission when server support exists.
- Not yet proven end-to-end: create success -> refreshed occupied slot -> WIZ_SEL_CHAR -> world transition.

### Session server / WS03
Implemented:
- auth login/server list/news
- game version 1298
- game login
- nation selection
- AA55 framing/reassembly

Missing for Moradon critical path:
- successful character-list record
- WIZ_NEW_CHAR create success response
- refreshed occupied character list
- WIZ_SEL_CHAR success response
- post-select MYINFO/GAMESTART handoff into WS14
- verify/resolve JV cryption requirement for the actual WASM build

### World session / WS14
Implementation exists and automated tests report PASS 14/14 for:
- selected-character world initialization
- two-phase 1298 GAMESTART state machine
- Moradon zone 21 bootstrap
- MYINFO / zone ability
- surrounding entity bootstrap
- zone-change loading state machine
- world-ready / USER_REGENE flow

WS50 requires WS14 to be re-closed with valid branch-head evidence before integration.

### Moradon client loader / WS05
No valid workstreams/ws05/STATUS.md exists. Treat WS05 as UNPROVEN until the branch is re-opened/revalidated and a real render gate is produced.

## Mandatory execution order

### M0 — Evidence repair
1. WS14: rerun tests, update STATUS with valid branch-head commit, close cleanly.
2. WS05: recover/revalidate branch, create STATUS, identify exact client-side world-loading state and blockers.

### M1 — Character-to-world server bridge
3. WS03: consume WS04 server contract + WS14 world-session contract.
4. Implement and test character list/create/select sequence.
5. Implement post-select handoff to WS14.
6. Resolve actual WASM cryption requirement rather than guessing.

### M2 — Real client E2E gate
7. WS04: run real browser flow against integrated WS02 + WS03 (+ WS14 handoff):
   login -> server -> nation -> character create/list -> character select.
8. Require real WIZ_NEW_CHAR and WIZ_SEL_CHAR evidence, not stubbed UI state.

### M3 — Authentic Moradon render
9. WS05: run selected-character world transition against integrated server flow.
10. PASS requires authentic 1298 Moradon terrain/shape render + player spawn in real WASM client.
11. Record console/render/network evidence and exact test run.

## Definition of MORADON PASS

All of the following must be true in one integrated test path:
- real C++/WASM/WebGL client
- authentic 1298 assets
- login succeeds
- server list succeeds
- version = 1298
- nation flow succeeds
- character exists or is created
- WIZ_SEL_CHAR succeeds
- WS14 world bootstrap succeeds
- Moradon zone 21 loads
- terrain/shapes render
- player character visibly spawns
- no Null renderer / fatal WebGL failure

Only after this definition passes should Ana Kontrol Hattı say the user can "Moradon'a indi".

## Non-critical work

Clan, ranking, backup, social, economy, admin enhancements and other features may continue independently, but they must not block the Moradon critical path unless they are a hard dependency discovered by evidence.
