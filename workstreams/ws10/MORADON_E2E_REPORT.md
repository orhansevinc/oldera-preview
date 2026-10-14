WS10

# MORADON E2E REPORT

## Decision

**MORADON E2E: BLOCKED**

Single blocker owner: **WS05**.

Canonical evidence is GitHub Actions run **#16** (`38490102763`) at WS10 harness commit `3c22e0e6907b74651589a18818bbcc7e930698b2`. The run builds and executes the real C++/Emscripten/WASM/WebGL2 client and uses genuine KO 1298 assets.

## Test command / workflow

The execution path is defined by `.github/workflows/ws10-e2e.yml` and runs:

1. WS10 harness self-tests / syntax checks.
2. Exact provider-ref resolution into isolated worktrees.
3. WS02, WS03 and WS14 provider test suites.
4. Genuine OpenKO + KO 1298 asset checkout and identity checks.
5. WS04 + WS05 browser instrumentation on the temporary OpenKO checkout.
6. Real WarFare Emscripten build.
7. WS10 deterministic composition server using the real WS03 and WS14 classes.
8. Two real WS02 gateways for AUTH and GAME TCP endpoints.
9. One Playwright Chromium session through the genuine client UI.
10. WS05 native Moradon gate and evidence upload.

## Run 16 results

| Critical-path step | Result | Evidence |
|---|---|---|
| WASM runtime | PASS | `WASM_RUNTIME_READY` |
| Native renderer | PASS | `render backend: OpenGL`; no Null renderer before blocker. |
| AUTH / server list | PASS | Real WS02 gateway + WS03 `AuthSession`. |
| Version | PASS | Client/server agree on `1298`. |
| Game login | PASS | Nation starts at `0`. |
| Nation Select | PASS | Real El Morad transition. |
| Empty Character Select | PASS | `WS04_CHAR_LIST parsed result=1 slots=3 occupied=0`. |
| Character Create UI | PASS | Genuine 1298 create scene. |
| Real `WIZ_NEW_CHAR (0x02)` | PASS | `WS04_CHAR_CREATE_SENT opcode=0x02 bytes=22`. |
| Create response | PASS | `WS04_CHAR_CREATE_RESPONSE code=0`. |
| Occupied-list refresh | PASS | `occupied=1`, slot 0 `Ws10Hero`. |
| Real `WIZ_SEL_CHAR (0x04)` | PASS | `WS04_CHAR_SELECT_REQUEST index=0 id='Ws10Hero' zone=21`. |
| WS03 -> WS14 handoff | PASS | Select success generated through real `beginSelectedCharacter()`. |
| GAMESTART loading | PASS | Client sends `0D 01`. |
| MYINFO | PASS | Server sends `0x0E` (577 bytes); client fully initializes the player. |
| ZONEABILITY | PASS | Server sends `0x5E`. |
| Region IDs | PASS | Server sends user IDs `0x15` and NPC IDs `0x1C`. |
| NPC detail | PASS | Client requests `0x1D`; server replies `0x1D`. |
| GAMESTART loaded / world ready | PASS | Client sends second `0x0D`; WS14 broadcasts USER_INOUT in `WORLD_READY`. |
| Native main/world entry | PASS | `CGameProcMain::Init` and `InitZone` reached. |
| WS05 zone/terrain/shape/player markers | **FAIL** | No required WS05 marker is emitted because its probe compares the native zone to `21`. |
| Accepted WS05 native non-black framebuffer gate | **NOT REACHED** | WS10 does not synthesize or bypass missing WS05 provider evidence. |

## Packet evidence from the same browser run

The WS10 composition log records this single sequence:

```text
game-rx opcode=0x2b -> game-tx opcode=0x2b bytes=11
game-rx opcode=0x01 -> game-tx opcode=0x01
game-rx opcode=0x05 -> game-tx opcode=0x05
game-rx opcode=0x0c -> game-tx opcode=0x0c bytes=173
game-rx opcode=0x02 bytes=22
character-created slot=0 name=Ws10Hero
game-tx opcode=0x02 bytes=2
game-rx opcode=0x0c -> game-tx opcode=0x0c bytes=181
game-rx opcode=0x04 bytes=22
game-tx opcode=0x04 bytes=10
game-rx opcode=0x0d bytes=2
game-tx opcode=0x0e bytes=577
game-tx opcode=0x5e bytes=7
game-tx opcode=0x15 bytes=3
game-tx opcode=0x1c bytes=5
game-tx opcode=0x0d bytes=1
game-rx opcode=0x1d bytes=5
game-tx opcode=0x1d bytes=58
game-rx opcode=0x0d bytes=2
world-broadcast opcode=0x07 state=WORLD_READY
```

This closes the previously missing real create -> refresh -> select -> world-bootstrap integration path.

## Native client evidence at the blocker

The same browser console records:

```text
WS04_CHAR_SELECT_REQUEST index=0 id='Ws10Hero' zone=21
WS04_CHAR_SELECT_RESPONSE success=1
scene change: character-select -> main
entering main scene: CGameProcMain::Init starting
main scene: InitUI done, InitZone starting (zone 210)
InitZone: loading world/terrain for zone 210 (terrain='Zones\Moradon_xmas.gtd')
MsgRecv_MyInfo_All: received - initializing player character
MsgRecv_MyInfo_All: InitChr starting (race 12)
MsgRecv_MyInfo_All: InitChr done
MsgRecv_MyInfo_All: player character fully initialized
```

## Root cause classification

The pinned OpenKO 1.298 client parses the server's character-select success zone as a byte and then applies its native zone namespace conversion:

```cpp
int iZoneCur = pkt.read<uint8_t>();
...
if (N3FORMAT_VER_DEFAULT >= N3FORMAT_VER_1264)
    iZoneCur *= 10;
s_pPlayer->m_InfoExt.iZoneCur = iZoneCur;
```

Therefore server/wire Moradon zone `21` becomes native client zone `210` before `CGameProcMain::InitZone()`.

WS05's current `patch_moradon_client.py` probes instead require `iZoneID == 21` and `s_pPlayer->m_InfoExt.iZoneCur == 21` for the zone-begin, assets-loaded, terrain-rendered, shapes-rendered and local-player-rendered evidence. In this exact client these predicates cannot become true after a valid selected-character transition, so the official WS05 gate times out before its framebuffer proof.

## Required provider action

WS10 does not edit WS05. The provider must reconcile **wire zone 21** with the pinned 1.298 client's **native zone 210** representation in its instrumentation/gate, then revalidate the authentic Moradon asset/render identity observed by that native path (run 16 currently resolves `Zones\Moradon_xmas.gtd`). After the WS05 provider correction, this WS10 integration gate should be rerun without changing the protocol/world boundaries.

Until the WS05 zone + terrain + shapes + local-player + non-black native GL evidence succeeds in the same real browser run, WS10 will not declare Moradon PASS.
