WS10

# Integration findings

WS10 does not fix product/provider defects. It records reproducible failures and leaves ownership with the relevant workstream.

## BUG-MORADON-001 — WS05 gate compares the native 1.298 zone against wire zone `21`

- **Severity:** Priority-0 critical-path blocker.
- **Blocked gate:** native Moradon zone/terrain/shape/local-player/native-GL evidence.
- **Single owner:** **WS05**.
- **Reproduce:** Run `.github/workflows/ws10-e2e.yml` on `ws10-qa-integration`; canonical evidence is run #16 (`38490102763`) at tested harness commit `3c22e0e6907b74651589a18818bbcc7e930698b2`.
- **Expected:** After real `WIZ_SEL_CHAR` succeeds with server/wire zone `21`, the genuine client world transition should satisfy WS05's Moradon probes, producing zone-begin, assets-loaded, terrain-rendered, shapes-rendered, local-player-rendered and accepted non-black native GL evidence in the same run.
- **Actual:** The integrated path successfully creates `Ws10Hero`, refreshes the occupied slot, sends real `0x04`, completes WS03 -> WS14 selection, GAMESTART/MYINFO/ZONEABILITY/region/NPC bootstrap, enters `CGameProcMain`, loads a world and fully initializes the local player. The client logs `InitZone starting (zone 210)` and loads `Zones\Moradon_xmas.gtd`; none of WS05's required zone-21 markers can fire, and the browser driver times out waiting for `WS05_GATE event=moradon-zone-begin zone=21`.
- **Root-cause evidence:** The pinned OpenKO 1.298 `CGameProcedure::MsgRecv_CharacterSelect()` multiplies the received zone by 10 for `N3FORMAT_VER_DEFAULT >= N3FORMAT_VER_1264`, so wire `21` becomes native `210`. WS05's current browser probes hard-code `iZoneID == 21` / `m_InfoExt.iZoneCur == 21`.
- **Artifacts:** `ws10-moradon-e2e-16` (artifact id `11862255468`), especially `browser-console.log`, `browser-result.json`, `composition-server.log`, provider test logs and build/configure logs.
- **Resolution boundary:** WS10 will not patch WS05 or fake the missing marker. WS05 must reconcile its native-zone predicate with the pinned client and revalidate the authentic Moradon asset/render path; then WS10 reruns the integrated gate.

## Resolved historical finding — old M12 create/select gap

The earlier WS10 `BUG-001` describing missing character create/list/select E2E evidence is **resolved by run 16**. The same real browser run proves:

- `WIZ_NEW_CHAR (0x02)` emitted by the real client;
- exact create success accepted;
- refreshed occupied character list;
- `WIZ_SEL_CHAR (0x04)` emitted by the real client;
- successful WS03 -> WS14 handoff and world bootstrap.

It is no longer the Moradon critical-path blocker.

## Non-blocking historical runtime observations

Earlier browser work recorded cursor-UI asset resolution and Emscripten main-loop timing warnings. Run 16 proceeds through login, character creation/selection and native main/world initialization despite those observations, so they are not promoted over BUG-MORADON-001 as the single current Priority-0 blocker.
