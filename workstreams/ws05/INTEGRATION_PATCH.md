WS05

# Selected-character -> Moradon integration contract

WS05 is client/render-side only. It does not implement authentication, session
routing, world packets, transport, persistence, NPC logic, or movement.

## Exact handoff required from WS03/WS14

For the current Moradon milestone the real 1.298 client must receive:

1. `WIZ_SEL_CHAR (0x04)` success for the authenticated selected character:
   - result `1`
   - zone `21`
   - X `312.0`, Z `402.0`, Y `0.0`
   - default bytes: `04 01 15 30 0c b4 0f 00 00 00`
2. The selected-character success activates the real `CGameProcMain`; the client
   initializes `InitZone(currentZone, playerPosition)`.
3. Client -> server: `WIZ_GAMESTART (0x0D) 01`.
4. Server -> client, in the WS14 1298 bootstrap contract:
   - `WIZ_MYINFO (0x0E)`
   - Moradon `WIZ_ZONEABILITY (0x5E)`; default
     `5e 01 01 00 01 0a 00`
   - `WIZ_REGIONCHANGE (0x15)` nearby user IDs
   - `WIZ_NPC_REGION (0x1C)` nearby NPC IDs
   - `WIZ_GAMESTART (0x0D)` acknowledgement
5. While loading, the client may request unknown entity records:
   - `WIZ_REQ_USERIN (0x16)`
   - `WIZ_REQ_NPCIN (0x1D)`
   WS14 must answer these according to its 1298 serializers.
6. Client -> server: `0D 02`; only then may the session become `WORLD_READY`.

WS05 does not synthesize any of those packets. A fake/stub world response cannot
produce `MORADON PASS`.

## Client evidence required for MORADON PASS

The gate requires all of the following from the same browser run:

- `WS04_CHAR_SELECT_RESPONSE success=1`
- zone-table lookup reaches zone `21` and exposes non-empty terrain/color/object
  filenames from the genuine client data
- real `CN3TerrainManager::InitWorld()` executes terrain and object load calls
- real `CN3TerrainManager::RenderTerrain()` executes in zone 21
- real `CN3TerrainManager::RenderShape()` executes in zone 21
- real `CGameProcMain::Render()` executes `s_pPlayer->Render()` in zone 21
- WS04's pre-swap native GL capture returns a non-black framebuffer
- no Null renderer, browser page error, or WebGL invalid-operation marker

This intentionally requires both engine-path evidence and pixels. A DOM
reconstruction, 2D background, Three.js scene, arbitrary screenshot, or a log-only
claim cannot pass.

## Running the native gate

Use `.github/workflows/ws05-moradon-world.yml` manually with
`run_native_gate=true`, provide a reachable integrated auth/game environment, and
configure repository secrets `WS05_TEST_ID` / `WS05_TEST_PW` for an account whose
slot 0 already contains a selectable character.

The workflow uses the existing packet-agnostic WebSocket gateways only as
transport adapters. The TCP endpoints must be the actual integrated WS03/WS14
session environment; the workflow intentionally starts no fake world server.

## Genuine client asset evidence

The pinned `ko4life-net/ko-assets` 1298 tree contains the concrete Moradon client files `Zones/moradon.gtd`, `Zones/moradon.opd`, and `Zones/moradon.tct` (plus the related `.dxt/.ens/.gfo/.glo/.gmd/.opdsub` files). The WS05 build patch fails closed if the three core terrain/object/color-map files are absent; it does not substitute generated geometry or a browser background.
