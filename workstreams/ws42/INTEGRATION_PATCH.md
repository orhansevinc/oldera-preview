# WS42 integration patch request

WS42 is not permitted to edit shared client/runtime files. The following integration is required outside this branch if the generated browser client does not already provide equivalent behavior.

## 1. Reuse the engine audio context

Do **not** create a second independent `AudioContext` merely for compatibility. After Emscripten/OpenAL/SDL initializes, obtain the engine-owned context and pass it to `BrowserAudioCompatibility`.

Candidate runtime shapes handled by the helper include:

- `SDL2.audioContext`
- `SDL.audioContext`
- `AL.currentContext.ctx`

If the actual generated runtime exposes a different stable location, pass that context explicitly instead of extending gameplay/renderer code.

## 2. Install user-gesture unlock in the browser shell

After the engine context exists:

```js
import {
  BrowserAudioCompatibility,
  findEmscriptenAudioContext,
} from './tools/ws42_audio/browser_audio_compat.mjs';

const engineAudioContext = findEmscriptenAudioContext(Module, globalThis);
const audioCompatibility = new BrowserAudioCompatibility({
  audioContext: engineAudioContext,
  ownedContext: false,
  setMasterGain: (gain) => {
    // Integrator: route to the engine/OpenAL/SDL master gain.
    // Do not replace any original asset.
  },
}).attach();
```

The helper waits for a real pointer/touch/key gesture before resume. Do not simulate a gesture or force autoplay.

## 3. Wire mute/volume to the existing engine master route

The `setMasterGain(gain)` callback must change the existing KO audio graph/master level. It must not create parallel replacement playback. `gain` is already clamped to `0..1`; mute publishes `0` while preserving the stored volume for unmute.

## 4. Preserve original asset identity and formats

Keep the original asset URLs/table values, including streamed MP3 login/zone music and buffered WAV/PCM effects. No replacement music, generated silence, synthetic effects, or modernized soundtrack belongs in this patch.

## 5. Fail soft on audio asset/decoder failure

A missing, corrupt, or unsupported audio asset should be logged/reported and skipped. It must not abort the game loop, disconnect gameplay, or crash the browser page.

## 6. Resume after browser suspension

After one legitimate user unlock, allow focus / `visibilitychange -> visible` to resume an engine context left in `suspended` or `interrupted` state. Do not resume before the first gesture.

## 7. Teardown

Call `audioCompatibility.dispose()` when the client/runtime is permanently torn down. Since the context is engine-owned, keep `ownedContext: false`; let the engine perform its normal OpenAL/SDL resource destruction.

## 8. Rebuild condition

If runtime inspection confirms that `KnightOnLine.js` / WASM was built without a working Emscripten browser audio backend, rebuild the shared client with its existing OpenAL/SDL-to-Web-Audio support enabled. This is a client build/integration change outside WS42 writable scope. Do not compensate by playing substitute files through a separate HTML `<audio>` soundtrack.

## Acceptance checks

- First real user interaction unlocks engine audio.
- Original login MP3 plays if its browser decoder/path is supported.
- Original WAV UI/effect sounds play through the existing engine path.
- Zone BGM and BGE1/BGE2 ambience preserve their original streams/loop semantics.
- Focus/background round trip recovers suspended audio after unlock.
- Missing/unsupported audio is non-fatal and reported.
- Mute/volume affects the real engine master path.
- Runtime teardown leaves no WS42 listeners and does not double-close the engine context.
