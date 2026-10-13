WS05

# STATUS — Moradon world control session

Status: **IMPLEMENTED GATE / MORADON PASS BLOCKED BY LIVE SESSION HANDOFF**

## Branch recovery

The existing branch was not a completed Moradon implementation. Its pre-control
head was `18282d0e70de7ccb30244a9f09e2b3bff3040155`, matching the old WS04 baseline,
and it contained no `workstreams/ws05` implementation/evidence set.

During this control session it was safely fast-forwarded, without force, to the
verified WS04 client head `fffbd9372b67c2aaef600f7e50595bec7e23fe88`.
That recovery imports the real character-select/create instrumentation and the
native pre-swap GL framebuffer capture WS05 needs.

## What WS05 adds

- `tools/ws05_moradon/patch_moradon_client.py`
  - adds the genuine 1298 world asset roots to the WASM preload
  - instruments the real `CN3TerrainManager::InitWorld()` zone-table/load path
  - instruments real terrain and shape render calls
  - instruments the real local-player render call
  - all probes are browser-only and do not alter packet/world/render decisions
- `tools/ws05_moradon/browser_moradon_driver.cjs`
  - drives an existing-character selection through the genuine canvas UI
  - waits for the real selected-character response and native Moradon markers
  - captures the native pre-swap GL framebuffer; no DOM/2D reconstruction
- `tools/ws05_moradon/moradon_gate.py`
  - fails closed unless selection, zone 21, terrain, shapes, local player and
    non-black native GL evidence all occur in one run
  - rejects Null-renderer/page/WebGL error evidence
- `.github/workflows/ws05-moradon-world.yml`
  - runs static gate tests on the WS05 branch
  - exposes a manual native gate that connects only to a real integrated TCP
    environment; it starts no fake world server
- `DEPENDENCY_SNAPSHOT.md` and `INTEGRATION_PATCH.md`
  - pin the recovery/dependency evidence and exact WS03/WS14 contract

## Revalidated real client path

Canonical 1.298 behavior and the browser-port source agree on the transition:

`WIZ_SEL_CHAR success`
-> Character Select activates `CGameProcMain`
-> `CGameProcMain::Init()`
-> `InitZone(s_pPlayer->m_InfoExt.iZoneCur, s_pPlayer->Position())`
-> active world `InitWorld(21)`
-> zone table supplies genuine terrain/color/object paths
-> terrain/object loaders
-> main render calls `RenderTerrain`, `RenderShape`, other-player render, and
   `s_pPlayer->Render`.

Moradon is zone `21`. WS14's pinned milestone placement is X `312.0`, Z `402.0`,
Y `0.0`.

## Furthest verified real-client state

The inherited WS04 evidence reaches the real Character Select/Create client and
proves genuine `WIZ_NEW_CHAR (0x02)` emission. WS04's own status does not claim a
successful create response/list refresh/occupied-slot `WIZ_SEL_CHAR`; its base
GAME stub intentionally does not implement those responses.

Therefore this WS05 control session **does not claim that Moradon has rendered
yet**. The new render gate is implementation-complete, but its native PASS has
not been observed against an integrated WS03+WS14 runtime.

## Precise MORADON PASS blocker

The missing evidence is a reachable integrated session path that supplies a real,
authenticated occupied character through:

`WIZ_SEL_CHAR success -> 0D 01 -> MYINFO + ZONEABILITY + REGION + NPC + 0D ack
-> optional 0x16/0x1D detail replies -> 0D 02`.

Until that environment drives the real WASM client into zone 21 and the WS05 gate
captures genuine terrain + shape + local-player pixels, status remains
**BLOCKED**, not PASS.

No server implementation was added by WS05 and no fake Moradon evidence is
accepted.

## Asset identity check

The pinned 1298 asset tree was rechecked and contains genuine `Zones/moradon.gtd`, `Zones/moradon.opd`, and `Zones/moradon.tct`. WS05 explicitly requires these files before build/preload so an empty or fabricated world package cannot satisfy the gate.
