# WS42 — Audio / Sound / Music browser compatibility

## Scope and evidence model

WS42 does not replace, transcode, or modernize Knight Online audio assets. It provides a browser-compatibility layer, probes, tests, and integration guidance around the existing KO 1298 client audio paths.

Evidence is separated into three layers:

1. **Target browser artifact:** `openko-web/KnightOnLine.js` / `.html` from `openko-browser-port`.
2. **Client lineage reference:** Open-KO KnightOnline source used to identify the original audio subsystem and file roles.
3. **Integration boundary:** changes that would touch the common generated/client runtime are documented in `INTEGRATION_PATCH.md` instead of being made by WS42.

## Real client audio model

The reference client uses an OpenAL-style sound manager. It owns the OpenAL device/context, source pool and listener state, and releases sound objects plus the OpenAL context/device during teardown.

### Effect and UI sound path

Buffered sound assets are loaded as RIFF/WAVE PCM. The loader accepts PCM (`formatTag == 1`) mono/stereo, 8/16-bit input and uploads it to an OpenAL buffer. Invalid files, unsupported PCM layouts, failed reads and failed buffer creation return failure instead of requiring a process crash.

Discrete UI/effect sounds are created through the sound-object path (`CreateObj` and related effect calls). This matches the buffered WAV/PCM behavior and must remain distinct from streamed music.

### Login music

The login procedure identifies `BGM_Karustown.mp3` and creates it through the streaming path. Browser compatibility must therefore retain MP3 capability for the original login music rather than replacing it with WAV or another soundtrack.

### Zone music and ambience

World/zone audio is table driven. Zone BGM is opened as a stream from the zone information, while background-environment entries (`BGE1` / `BGE2`) are created as looping stream objects. WS42 treats these as original stream assets and never substitutes synthetic ambience.

## Browser restrictions and recovery

Modern browsers can create or expose an `AudioContext` in a suspended state until a user gesture occurs. The WS42 compatibility helper therefore:

- never attempts autoplay as proof of readiness;
- waits for pointer, touch, or keyboard interaction before the first resume attempt;
- reuses an existing Emscripten/SDL/OpenAL context when one is exposed;
- after the first successful user gesture, retries `resume()` on window focus or when the document becomes visible and the context is `suspended` / `interrupted`;
- does not force a suspend on blur/background because browsers have platform-specific throttling/suspension policies;
- collapses overlapping resume attempts to avoid redundant asynchronous resumes;
- removes browser listeners during teardown;
- closes an `AudioContext` only when WS42 explicitly owns it. The normal integration path must not close an engine-owned context.

## Mute and volume

`BrowserAudioCompatibility` exposes clamped volume (`0..1`) and mute state and publishes a single effective master gain. The helper intentionally does not reach into generated client internals. The integration owner must wire this callback to the actual engine/OpenAL/SDL master route. Until that wiring exists, the probe labels volume/mute as requested compatibility state rather than claiming the running game was modified.

## Missing assets and codec failures

`probeOriginalAudioAsset()` turns asset failures into diagnostic results instead of uncaught exceptions:

| Condition | Result |
| --- | --- |
| HTTP 404 / 410 | `missing-asset` |
| Other non-2xx HTTP | `http-error` |
| Network failure | `network-error` |
| Byte read failure | `read-error` |
| `decodeAudioData()` `NotSupportedError` | `unsupported-codec` |
| Other decode failure | `decode-error` |
| Fetch succeeds without decoder | `fetched` |
| Decode succeeds | `decoded` + metadata |

This is a probe contract; the production client integration should mirror the same fail-soft rule so one absent/corrupt sound cannot terminate the browser session.

## Codec compatibility report

Known client roles require at least:

- **WAV/PCM** for buffered UI/effect audio.
- **MP3** for the confirmed login BGM stream (`BGM_Karustown.mp3`).

The exact decoder implementation behind every legacy streaming path is not present in the inspected browser-port source tree, so WS42 does not claim support for an unverified codec from filename convention alone. The browser probe reports `canPlayType()` for WAV, MP3 and Ogg/Vorbis and can run `decodeAudioData()` against the original asset URL. Ogg is probed as a compatibility signal, not asserted as a required 1298 replacement format.

Unsupported original assets must be reported. They must **not** be silently transcoded or replaced by different music/sound inside this workstream.

## Target bundle static scan

`scan_browser_bundle.mjs` searches the generated JS/HTML for common Web Audio, OpenAL/Emscripten, SDL audio, HTML media and audio-extension markers. This is diagnostic only: generated/minified Emscripten code can hide or rewrite symbols, so absence of a marker is not proof that the runtime can never produce audio.

The inspected `openko-browser-port` generated JavaScript did not expose an obvious top-level `AudioContext`, `AL.currentContext`, `alcOpenDevice`, SDL-audio or HTML-audio marker through static text inspection. Runtime validation and/or a shared client rebuild with the appropriate browser audio backend may therefore be required before audio can be called fully ready.

## Manual validation sequence

1. Serve the repository over HTTP; do not open the probe with `file://`.
2. Load the real browser client and the WS42 probe in the same integration environment.
3. Inspect whether the engine exposes an existing SDL/OpenAL/Emscripten `AudioContext`.
4. Before any click/key, confirm that WS42 does not resume or autoplay.
5. Use **Unlock / resume** as an explicit user gesture and confirm the context reaches `running`.
6. Probe the original `BGM_Karustown.mp3` URL and representative original WAV UI/effect URLs. Record HTTP and decoder results.
7. Enter background and return to foreground. If the browser suspended/interrupted audio, confirm focus/visibility recovery resumes only after the original user unlock.
8. Verify missing original audio returns a soft failure and gameplay continues.
9. Verify mute/volume after the shared engine master-gain integration is applied.
10. Navigate away/tear down and verify event listeners/resources are released without closing an engine-owned context unexpectedly.

## Readiness conclusion

The compatibility contract, tests and probes are ready. Full runtime audio readiness is **conditional** on the common browser client exposing/using its actual Emscripten audio context and wiring the helper to that engine path. Those shared changes are intentionally not made by WS42; see `INTEGRATION_PATCH.md`.
