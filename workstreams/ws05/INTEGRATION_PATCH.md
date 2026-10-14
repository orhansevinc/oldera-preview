WS05

# Selected-character -> Moradon integration contract

WS05 is client/render-side only. It does not implement authentication, session routing, world packets, transport, persistence, NPC logic, movement, or server zone semantics.

Implementation commit for this correction: `c72346b84c19db43452e0b1739bd53d2bff4c804`.

## Authoritative zone mapping

For authentic KO 1.298 Moradon there are two representations in this path:

1. **Server/wire zone = 21.** WS03/WS14 continue to serialize Moradon as source-verified zone `21` in `WIZ_SEL_CHAR` / world state.
2. **Pinned native client zone = 210.** In the consumed OpenKO 1.298 client, `CGameProcedure::MsgRecv_CharacterSelect()` reads the selected-character zone and, for this format generation, multiplies it by 10 before assigning `s_pPlayer->m_InfoExt.iZoneCur`. `CGameProcMain::InitZone()` therefore enters Moradon with native zone `210`.

WS05 must observe that real client behavior. It must not ask WS03 or WS14 to send `210` over the wire merely to satisfy a browser gate.

## WS05 browser-only instrumentation contract

The probes now use native `210` for actual C++ state comparisons while preserving wire identity in the marker:

```text
WS05_GATE event=moradon-zone-begin zone=21 native_zone=210 terrain='<real filename>' colormap='<real filename>' objects='<real filename>'
WS05_GATE event=moradon-assets-loaded zone=21 native_zone=210
WS05_GATE event=moradon-terrain-rendered zone=21 native_zone=210
WS05_GATE event=moradon-shapes-rendered zone=21 native_zone=210
WS05_GATE event=moradon-local-player-rendered zone=21 native_zone=210
WS05_MORADON_VISUAL_OK source=pre-swap-gl ratio=<non-black ratio>
```

The run must also include `WS04_CHAR_SELECT_RESPONSE success=1` and must not contain Null-renderer/page/WebGL fatal evidence.

The instrumentation remains under `#ifdef __EMSCRIPTEN__`; it records the real loader/render path and does not change packet handling, world placement, render decisions or desktop behavior.

## Backward compatibility with current WS10 harness

The current WS10 browser E2E waits for the existing `WS05_GATE ... zone=21` strings using substring matching. Appending `native_zone=210` therefore keeps those waits unchanged. Its workflow grep for `moradon-local-player-rendered zone=21` also remains valid.

WS10 then invokes WS05's provider-owned `moradon_gate.py`. That gate has been tightened to require the complete `zone=21 native_zone=210` markers, so an old probe that still compares the native client to 21 cannot pass accidentally.

**Required integration action: rerun WS10 unchanged with `moradon_ref=ws05-moradon-world`. No WS10 protocol/world-boundary edit is required for this fix.**

## Server handoff remains unchanged

The expected authentic sequence remains:

1. Server returns successful `WIZ_SEL_CHAR (0x04)` with wire zone `21` and Moradon placement.
2. Client performs its native 1.298 zone conversion and enters `CGameProcMain` with native zone `210`.
3. Client sends `WIZ_GAMESTART (0x0D) 01`.
4. WS14 returns MYINFO, ZONEABILITY, region/NPC bootstrap and GAMESTART acknowledgement according to its existing contract.
5. Client completes loading / detail requests and sends GAMESTART loaded phase.
6. WS05 accepts PASS only after real terrain, real shapes, real local player and a non-black native pre-swap GL framebuffer are all evidenced in that same browser run.

WS10 run #16 (`38490102763`) already proved steps 1-5 far enough to show native main-scene entry, local-player initialization and `InitZone(... zone 210)` loading `Zones\\Moradon_xmas.gtd`; the missing markers were caused by WS05's old native-zone-21 comparisons.

## Verification evidence

At implementation commit `c72346b84c19db43452e0b1739bd53d2bff4c804`, GitHub Actions `WS05 Moradon World` run #2 (`38492131244`) completed `ws05-contract-gate` successfully. The workflow compiled the Python instrumentation/gate and ran the regression suite.

The native-render job was skipped on that push because it is intentionally manual-only. The next authoritative integrated render evidence should come from the unchanged WS10 E2E rerun.

## Non-negotiable PASS rules

No Three.js, DOM reconstruction, Canvas2D fake world, synthetic packet flow, fake markers, arbitrary screenshot, or log-only synthetic PASS is accepted. Server wire zone stays `21`; native WS05 comparisons follow the real 1.298 client zone `210` behavior.
