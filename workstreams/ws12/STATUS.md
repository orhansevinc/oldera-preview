# WS12 Status

## Scope
Browser launcher/play shell for the real Knight Online 1298 WASM package.

## Implemented
- OldKOWeb / OldKO branding and OYNA / START flow.
- WebAssembly and WebGL2 capability checks before launch.
- Config-driven client entry/build/package URLs; no client package URL is hardcoded in launcher JavaScript.
- Real package availability checks for HTML, JS, WASM and DATA using HEAD requests; 404/network failures are surfaced clearly.
- BUILD.txt parsing and source commit/version display.
- Cache version query-busting plus version-change detection and launcher cache cleanup hook.
- Optional WebSocket gateway reachability probe with understandable unavailable state.
- Mobile detection with explicit desktop-control warning and configurable warn/block policy.
- Real client launch in iframe; no Three.js, fake KO scene or fake loading percentage.
- Runtime status monitoring through config-driven selector/text from the real client wrapper; runtime errors/timeouts are surfaced.
- Unit tests for successful preflight, missing WASM, missing WebGL2, client 404 and cache-version change.
- CI workflow with syntax/config/unit tests and HTTP smoke checks against the inherited real1298 package.

## Integration
Ready to integrate conditionally with the deployment layer. `play-shell/config.json` must receive the deployed gateway URL when WS02/production gateway is available; until then launcher reports gateway as not configured and does not fabricate reachability.

## Boundaries respected
No changes to real client/WASM, admin, official website, gateway/server/database. No merge to main and no force push.
