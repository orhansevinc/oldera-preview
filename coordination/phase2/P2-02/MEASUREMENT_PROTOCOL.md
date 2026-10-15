# P2-02 loading measurement protocol

The user's reported 6–7 minute wait is a useful symptom, not a controlled baseline. Do not compare it with optimized runs as if it were measured evidence.

## Fixed test identity

Record for every run:

- device + CPU/RAM
- OS and browser exact version
- connection type and, if available, DevTools throttling profile
- `release_id`, `content_version`, source commit, runtime artifact id/digest
- service-worker state and whether the run is `cold` or `warm`

Do not change device, browser, network/throttling, content version, renderer settings or account between paired before/after runs.

## Cold run

1. Open a clean test profile or DevTools Application storage for `play.oldkoweb.com`.
2. Remove only OldKOWeb runtime Cache Storage/service-worker state needed for the test. Do not clear or inspect passwords/credentials as evidence.
3. Enable DevTools Network `Preserve log`; keep browser HTTP cache behavior documented.
4. Navigate to the exact play URL and login normally.
5. Wait until the character is visibly in-world and movement/camera is controllable. P2-03/10 must emit `oldkoweb:world-ready` at that point.
6. Export/copy `window.oldkowebLoadingSnapshot()` and the Network HAR/transfer summary.

## Warm run

1. Keep the exact same content version and browser profile.
2. Leave the P2-02 runtime Cache Storage intact.
3. Logout/re-enter by the normal supported flow or perform the agreed fresh navigation; document which action is used and keep it identical before/after.
4. Repeat the capture through the same `oldkoweb:world-ready` point.

## Required measurements

For both cold and warm capture:

- manifest duration
- runtime requested bytes (`KnightOnLine.js/.wasm/.data`, plus any startup packs)
- network transferred bytes from DevTools/HAR
- cache hit/miss/bypass/error counts
- JS/data download completion
- WASM compile duration and mode (`streaming` or fallback)
- asset/dependency preparation duration
- auth socket start/open
- game socket start/open
- runtime initialized time
- world-ready / first controllable frame time
- errors/retries

If decompression/open time cannot be isolated by the browser/Emscripten build, report it as `NOT_SEPARATELY_OBSERVABLE` instead of folding it into a fabricated number. A future source-level instrumentation hook may split it from asset preparation.

## Before/after evidence table

P2-13 should produce one row per run with at least:

`build | cold/warm | startup requested bytes | transferred bytes | cache hit/miss | manifest ms | download ms | wasm compile ms | asset prep ms | auth-open ms | game-open ms | first-controllable-frame ms | errors`

Use at least 3 paired runs if the environment permits and report individual runs plus median; do not discard slow runs without a stated cause.

## Cache failure cases

Also exercise separately from the performance sample:

- current content version warm hit
- content version changed (new hash URL; old version retained for rollback)
- interrupted/partial request (206/Range is not cached by P2-02 worker)
- Cache Storage quota/write failure (runtime must continue from network and report cache error)
- stale cache key from a previous version (must not satisfy the new hash/version URL)

The runtime cache must never contain account/admin API responses, `/auth`, `/game`, cookies, credentials or login payloads.
