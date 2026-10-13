# WS10 integration findings

WS10 does not fix product defects. It records reproducible failures and leaves ownership with the relevant workstream.

## BUG-001 — M12 Character selectable has no end-to-end proof

- **Milestone:** M12 (blocks M13-M16)
- **Reproduce:** Run the WS10 client harness against current `openko-browser-port`; complete login -> server list -> version 1298 -> game login -> Nation Select -> Character Select -> Character Create.
- **Expected:** Create a character through the real protocol, refresh/list it, and prove the character is selectable.
- **Actual:** Current proven path reaches the real Character Create scene, but no create-success/list-refresh/selectability evidence is available. WS10 therefore fails M12 and refuses to credit downstream world milestones.
- **Log:** `artifacts/milestones.json`, `artifacts/console.log`, `artifacts/M11-character-create.png`.
- **Likely responsible workstream:** WS04 Character Select/Create (or WS03 session server if the missing piece is protocol response/persistence).

## BUG-002 — Browser runtime cannot open the 1298 cursor UIF

- **Milestone:** M3 Login scene visible (non-fatal finding; the scene can still render).
- **Reproduce:** Start the current proven `openko-browser-port` build with the canonical 1298 assets and inspect browser console output during login initialization.
- **Expected:** Required login/runtime UI assets open without an asset resolution failure.
- **Actual:** Runtime logs `[asset-open-fail] requested='/data/ui\\cursor.uif' resolved='/data/ui/cursor.uif'` while bringing up the real login scene.
- **Log:** `artifacts/console.log`; also reproduced by the successful canonical OpenKO browser CI run before `login scene: CGameProcedure brought up`.
- **Likely responsible workstream:** WS06 asset audit first; WS01 runtime/build if the asset exists but mount/case normalization is wrong.

## BUG-003 — Emscripten main-loop timing is called before a main loop exists

- **Milestone:** M1/M3 runtime initialization (non-fatal finding in the currently proven path).
- **Reproduce:** Start the current `openko-browser-port` browser client and inspect console output immediately after the login procedure comes up.
- **Expected:** Runtime main-loop scheduling initializes without an Emscripten API error.
- **Actual:** Console emits `emscripten_set_main_loop_timing: Cannot set timing mode for main loop since a main loop does not exist! Call emscripten_set_main_loop first to set one up.`
- **Log:** `artifacts/console.log`; canonical OpenKO browser CI reproduces it immediately after the login scene marker.
- **Likely responsible workstream:** WS01 runtime/build.

## Integration targets not yet classified as product bugs

M17-M20 remain FAIL when no running Admin API target/restart command is supplied. Missing service evidence is deliberately not converted to PASS or SKIP. WS10 will classify concrete API/database defects only after a test target answers the contract.

## Required bug format

Future entries must include: milestone, reproduce, expected, actual, log/artifact, and likely responsible workstream.
