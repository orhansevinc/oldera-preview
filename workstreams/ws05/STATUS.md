WS05

# STATUS — Moradon world control session

Status: **READY FOR UNCHANGED WS10 E2E RERUN / MORADON PASS PENDING**

Branch: `ws05-moradon-world`
Implementation commit: `c72346b84c19db43452e0b1739bd53d2bff4c804`
Static validation: GitHub Actions `WS05 Moradon World` run **#2**, run id `38492131244`, `ws05-contract-gate` = **SUCCESS**

## Control evidence consumed

The resumed WS05 task was driven by the current `main` inbox plus WS10 run #16 evidence. WS10 proved a real C++/Emscripten/WebGL2 session through character create, refreshed occupied slot, genuine `WIZ_SEL_CHAR`, WS03 -> WS14 handoff, GAMESTART/MYINFO/ZONEABILITY/region/NPC bootstrap, native main-scene entry and local-player initialization.

The first true blocker in that run was WS05's browser-only zone predicate: server/wire Moradon remained authentic zone `21`, while the pinned OpenKO 1.298 client converted the selected-character zone to native client zone `210` before `CGameProcMain::InitZone()`. The same run loaded `Zones\\Moradon_xmas.gtd` at native zone 210.

Canonical upstream evidence:

- WS10 Actions run #16: `38490102763`
- WS10 tested harness commit: `3c22e0e6907b74651589a18818bbcc7e930698b2`
- WS10 current branch evidence head: `34c551518aad87a9fd03d392f193d354483c95a0`
- WS03 current branch head checked: `d634870bbcd2c541695516643d34e0ac119354d7`
- WS14 current branch head checked: `82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b`

## Fix implemented

WS05 now models the two zone namespaces explicitly:

- **wire/server Moradon zone:** `21` — unchanged, source-verified, still owned by WS03/WS14 protocol/world semantics;
- **pinned 1.298 native client world zone:** `210` — used by WS05 browser-only world/render comparisons after the authentic client-side `* 10` conversion.

`tools/ws05_moradon/patch_moradon_client.py` now compares `CN3TerrainManager::InitWorld()` / player render state against native `210`. Evidence markers preserve `zone=21` as the wire identity and append `native_zone=210`, for example:

```text
WS05_GATE event=moradon-zone-begin zone=21 native_zone=210 ...
WS05_GATE event=moradon-terrain-rendered zone=21 native_zone=210
WS05_GATE event=moradon-shapes-rendered zone=21 native_zone=210
WS05_GATE event=moradon-local-player-rendered zone=21 native_zone=210
```

This keeps the current WS10 driver's existing `... zone=21` substring waits compatible while making the actual native predicate and provider gate authentic.

`tools/ws05_moradon/moradon_gate.py` now fails closed unless the same run proves both wire `21` and native `210`, plus:

- successful real character selection;
- authentic zone-table filenames;
- terrain load/render;
- shape load/render;
- local-player render;
- non-black native pre-swap GL framebuffer;
- no Null renderer, page error, or forbidden WebGL/GL errors.

No Three.js, Canvas2D world, DOM reconstruction, fake marker path, synthetic packet or synthetic PASS was added.

## Verification

GitHub Actions run #2 executed the branch workflow's static/unit gate at implementation commit `c72346b84c19db43452e0b1739bd53d2bff4c804`:

```text
python3 -m py_compile tools/ws05_moradon/patch_moradon_client.py tools/ws05_moradon/moradon_gate.py
python3 tools/ws05_moradon/test_moradon_gate.py
```

Result: `ws05-contract-gate` **SUCCESS**. The unit suite now contains 8 tests, including regression checks that old native-zone-21 probes cannot satisfy the contract and that both wire 21 / native 210 are required.

The workflow's `native-moradon-render` job was **skipped**, not failed, because this validation was triggered by a normal branch push; that job is intentionally restricted to manual `workflow_dispatch` with `run_native_gate=true` and reachable integrated auth/game inputs.

## Current blocker / readiness decision

No further WS05 implementation blocker is known after the 21/210 correction. A new full native Moradon PASS is **not claimed** until the integrated browser E2E is rerun.

**WS05 is ready for an unchanged WS10 E2E rerun.** WS10 should keep server/wire Moradon zone `21`, consume this WS05 branch, and rerun the same authentic create -> select -> world -> native render gate without changing WS03/WS14 packet semantics or relaxing the framebuffer/render requirements.

If that rerun exposes another failure, only the first newly observed real blocker should be reported.
