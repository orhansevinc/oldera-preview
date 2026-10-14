WS10

# STATUS — QA/E2E Integration Gate

Status: **MORADON E2E: BLOCKED**

Branch: `ws10-qa-integration`
Evidence run: GitHub Actions `WS10 Moradon E2E Integration Gate` run **#16**, run id `38490102763`
Tested WS10 commit: `3c22e0e6907b74651589a18818bbcc7e930698b2`
Evidence artifact: `ws10-moradon-e2e-16` (artifact id `11862255468`)

## Furthest verified integrated state

The Priority-0 integrated browser chain now proves, in one real C++/Emscripten/WebGL2 browser session:

- real browser WASM runtime and `render backend: OpenGL`;
- WS02 WebSocket -> TCP auth/game transport;
- login, server list and game version `1298`;
- Nation Select;
- empty real Character Select list;
- real Character Create UI;
- genuine client `WIZ_NEW_CHAR (0x02)` emission;
- server create success `02 00`;
- refreshed 3-slot list with slot 0 occupied by `Ws10Hero`;
- genuine client `WIZ_SEL_CHAR (0x04)` emission;
- WS03 -> WS14 `beginSelectedCharacter()` handoff;
- select success;
- WS14 GAMESTART loading bootstrap with `MYINFO (0x0E)`, `ZONEABILITY (0x5E)`, region user IDs (`0x15`), NPC IDs (`0x1C`) and GAMESTART ack;
- NPC detail request/reply (`0x1D`);
- GAMESTART loaded phase and WS14 `WORLD_READY` broadcast;
- native main scene entry and full local-player `MYINFO` initialization.

The old WS10 M12 create/select blocker is therefore resolved by real integrated evidence.

## First true blocker

**Owner: WS05**

The server-side Moradon identifier is correctly sent as zone `21`, but this pinned OpenKO 1.298 client converts the selected-character wire zone into its native client zone namespace in `CGameProcedure::MsgRecv_CharacterSelect()`:

```text
if (N3FORMAT_VER_DEFAULT >= N3FORMAT_VER_1264)
    iZoneCur *= 10;
```

Accordingly the same run logs:

```text
WS04_CHAR_SELECT_REQUEST ... zone=21
WS04_CHAR_SELECT_RESPONSE success=1
main scene: InitUI done, InitZone starting (zone 210)
InitZone: loading world/terrain for zone 210 (terrain='Zones\Moradon_xmas.gtd')
MsgRecv_MyInfo_All: player character fully initialized
```

WS05's current browser-only probes instead hard-code native comparisons to `21` (`iZoneID == 21` and `m_InfoExt.iZoneCur == 21`). They therefore emit none of the mandatory `WS05_GATE event=moradon-* zone=21` markers after the real world transition. The official WS05 gate cannot PASS and WS10 deliberately does not synthesize replacement markers or edit the provider branch.

This is the first unresolved Moradon critical-path defect observed after the now-working create/select/world bootstrap chain.

## Decision

`MORADON E2E: BLOCKED`

Single blocker owner: **WS05**. WS05 must reconcile server zone `21` with the pinned 1.298 client's native zone `210` representation in its instrumentation/gate and revalidate the authentic Moradon asset/render path. After that provider fix, rerun this WS10 gate unchanged at the protocol/world boundaries.

No provider branch was modified, no fake packet/world server was used for PASS, and no HTML/Canvas2D/Three.js Moradon evidence was accepted.

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
