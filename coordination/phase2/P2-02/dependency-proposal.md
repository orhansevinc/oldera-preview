# P2-02 dependency proposal

`coordination/phase2/CHARTER.md`, `OWNERS.json`, `CONTRACTS.md` and branch `phase2/00-integration` were not present at the pinned P2-02 base (`50ecabec15bd358d222a01891ca31359f3a928b0`). P2-02 therefore proceeded inside its stated ownership and proposes the following contracts for the coordinator to adopt/reconcile.

## P2-00 integration

- Treat the production client hotfix, not the small repository `real1298/*` snapshot, as runtime authority.
- Extract the pinned artifact and run `tools/p2-02/New-OldKOWebRuntimeManifest.ps1`; publish the generated `runtime-manifest.json` beside the exact `KnightOnLine.js/.wasm/.data` files.
- Do not patch generated JS/WASM/data in integration. Rebuild from the WS01/OpenKO chain, then regenerate the manifest.
- Establish cold/warm startup byte/time budgets only after the paired baseline in `MEASUREMENT_PROTOCOL.md` is captured.

## P2-03 / P2-10 renderer + input

- Emit `window.dispatchEvent(new CustomEvent('oldkoweb:world-ready', {detail: ...}))` only after the first frame is visibly rendered AND movement/camera/input is controllable.
- Do not emit world-ready at `onRuntimeInitialized`, login success, character select, socket open, or first draw call alone.
- P2-02 owns the overlay and loading percentage; renderer/input owners only provide the readiness fact.

## P2-12 nginx / edge headers

P2-02 does not modify nginx. Required edge contract:

- `/real1298/runtime-manifest.json`: `Cache-Control: no-store`; JSON MIME.
- `/play-cache-worker.js`, `/play-loading-v2.js`, play HTML: revalidate/no-cache or a short non-immutable policy so shell fixes take effect.
- Hash-versioned runtime URLs (`?sha256=...&bytes=...&cv=...`): may use long-lived immutable browser/proxy caching, but the origin bytes MUST match the manifest for that content version.
- `.wasm`: `Content-Type: application/wasm` so `WebAssembly.instantiateStreaming` can succeed.
- `.js`: JavaScript MIME; `.data`: `application/octet-stream`.
- Preserve `Vary: Accept-Encoding` where compression is enabled.
- Brotli/gzip for JS/WASM should be enabled only after comparing transferred bytes + CPU/time. Do not blindly recompress an already-compressed `.data` payload.
- Do not cache `/auth`, `/game`, `/api/*`, account, admin, credentials, or authenticated responses through this runtime cache policy.
- Range/206 responses are deliberately not inserted into P2-02 Cache Storage.

## P2-13 evidence

Run paired cold/warm captures on the same device, browser, network and exact content version. Export `window.oldkowebLoadingSnapshot()` plus browser transfer sizes. Required before/after fields are defined in `MEASUREMENT_PROTOCOL.md`.

## Asset authority

The pinned WS38 manifest proves the listed Bandicoot/skill-icon VFS inputs, but it does not provide a complete exact-case Moradon map/startup VFS closure. P2-00 (or the Phase-2 content owner) must publish that authoritative list before P2-02 can split a full Moradon startup/map package without guessing files. Missing assets remain a build failure; black-model/placeholder substitution is forbidden.

## Launcher visual authority

WS12 contains `assets/hero-1299-hd.jpg` and `assets/moradon-1299.jpg`, but no pinned record identifying an accepted/original launcher artwork. P2-02 currently uses `moradon-1299.jpg` only as a safe existing fallback. Integration must replace that background only when the exact accepted source is identified; loading semantics must remain unchanged.
