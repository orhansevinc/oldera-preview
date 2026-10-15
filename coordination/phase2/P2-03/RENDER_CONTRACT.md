# P2-03 Render Contract v1

## Scope

P2-03 owns OpenKO C++/WASM/WebGL renderer sizing, framebuffer/backing-store resolution, viewport/projection compatibility, browser render-quality policy, and render telemetry. It does not own loader HTML/CSS (P2-02), gameplay/UI input behavior (P2-10), final client artifacts (P2-00), or deployment.

## Coordinate spaces

The browser client has two intentionally different spaces:

1. **Logical viewport** = the canvas CSS rectangle in CSS pixels. `CN3Base::s_Options.iViewWidth/iViewHeight`, D3D viewport, UI layout, camera aspect/projection, and gameplay mouse/picking use this space.
2. **Physical backing store** = logical size multiplied by `renderScale`. WebGL `drawingBufferWidth/Height`, GL viewport/scissor and rasterization use this space.

P2-10 must convert browser pointer coordinates exactly once:

```text
logicalX = (clientX - canvasRect.left) * logicalWidth  / canvasRect.width
logicalY = (clientY - canvasRect.top)  * logicalHeight / canvasRect.height
```

Do **not** multiply pointer/picking coordinates by DPR or by `renderScale`. If SDL/Emscripten already supplies logical canvas coordinates, P2-10 must not rescale them again.

P2-03 publishes the read-only runtime object `window.__OLDKO_RENDER_METRICS__`; P2-10 may consume `logicalWidth`/`logicalHeight` from it but must not write renderer state.

## Resize and projection

`tools/p2_03_patch_openko_render.py` removes the WS05 Emscripten-only 1024x768 option lock. Every browser frame it compares the current canvas CSS rectangle with the last logical surface. On change it:

- updates the Emscripten canvas backing store;
- updates the engine logical width/height;
- updates the D3D logical viewport;
- leaves the accepted camera behavior intact so `CN3Camera::Tick()` derives aspect from the updated viewport;
- updates `CN3Base::s_fPixelDensity` and the GL drawable metrics from the actual canvas backing size before drawing.

This is renderer resize, not CSS-only stretching.

## Quality policy

No mode silently renders below the logical canvas size.

| Mode | DPR cap | Backing-pixel budget | Intended use |
|---|---:|---:|---|
| `performance` | 1.00 | 2.1 Mpx | lowest GPU/memory load, still 1:1 logical |
| `balanced` | 1.25 | 3.2 Mpx | integrated-GPU/general fallback |
| `sharp` | 1.50 | 4.7 Mpx | default; suitable target for RTX4050-class PC while server is running |
| `native` | 2.00 | 8.3 Mpx | opt-in high-DPR mode |

Selection order: `?renderQuality=` query -> `window.OLDKO_RENDER_QUALITY` -> `localStorage['oldkoweb.renderQuality']` -> `sharp`.

The pixel budget may cap the requested scale, but the renderer never chooses a scale below 1.0. The policy therefore avoids both the old hidden low-resolution stretch and an unconditional maximum-DPR memory cost.

## Texture, UI and mipmap authority

P2-03 does not replace genuine KO textures with unsourced HD art and does not globally override the engine's D3D sampler state. A global forced linear/nearest policy would alter original art direction and can create atlas bleeding.

Instead the renderer fixes the physical raster target first and records texture evidence at creation time: texture count, maximum texture width/height, maximum mip level count and number of textures with mipmaps. Existing `RHIDeviceGL::ApplyTexturesAndSamplers()` remains the sampler/mipmap authority. If a remaining blur is proven to originate in a specific genuine low-resolution atlas or sampler state after framebuffer correction, that follow-up must name the exact asset/state rather than masking it with fabricated HD content.

## Runtime telemetry

`window.__OLDKO_RENDER_METRICS__` contains, when available:

- `cssWidth`, `cssHeight`
- `logicalWidth`, `logicalHeight`
- `backingWidth`, `backingHeight`
- `drawingBufferWidth`, `drawingBufferHeight`
- `devicePixelRatio`, `renderScale`, `quality`
- EMA `frameTimeMs`, `fps`
- `wasmHeapBytes`, Chromium `jsHeapBytes` when exposed
- `renderTargetsEstimateBytes` (minimum color+depth estimate, not a claim of exact GPU VRAM usage)
- `textureCreateCount`, `maxTextureWidth`, `maxTextureHeight`, `maxMipLevels`, `texturesWithMipmaps`

WebGL does not expose reliable exact per-process GPU VRAM usage; the handoff must not invent one.

## Required matrix

`qa/p2-03/render_probe.mjs` is the acceptance harness for the integrated candidate. It covers:

- physical display models 1366x768 and 1920x1080;
- Windows/browser scale models 100%, 125%, 150%;
- windowed and DOM fullscreen;
- actual CSS/logical/backing/drawing-buffer dimensions;
- no hidden render downscale;
- clipping bounds;
- frame time/FPS and browser/WASM/render-target memory telemetry;
- screenshots and JSON/console evidence per case.

Run the same candidate/camera twice with `P2_03_LABEL=before` and `P2_03_LABEL=after` when producing the visual acceptance bundle. P2-00/P2-13 must use the real reconciled WASM build for final evidence.