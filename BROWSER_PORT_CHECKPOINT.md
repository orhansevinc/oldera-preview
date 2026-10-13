# OldERA browser port — 2026-10-13 checkpoint

## Working agreement

Work in blocks of at most 15 minutes, return a short verified result, then wait for the user to say continue. Keep intermediate updates short. Do not claim that compilation proves login, Moradon or a live server.

## Canonical source

- Repository: orhansevinc/oldera-preview
- Active implementation branch: openko-browser-port
- Do not resume the old Three.js/DOM reconstruction on main.
- Upstream client: luisfelipe18/old-school-openko, feature/port-posix; inspected commit 97eb0ea20207afc0c360bfed6915113572711be3.
- Browser patcher: tools/patch_openko_browser.py
- CI: .github/workflows/openko-browser-port.yml

## Verified failure and fix

Run 38440247468, commit f8c46832f7bc283c08f3fde7fc75192a1d835eb0:
- Real C++ WarFare build and JS/WASM/DATA package verification passed.
- Chrome initialized WASM and found /data.
- Actual WebGL2/OpenGL renderer initialized at 1024x768; no Null fallback.
- Startup failed with std::system_error: thread constructor failed: Not supported, before login scene completion.
- Login publication was skipped by the failed runtime gate.

Fix commit a29155981b6511e9555a16557b8653feb58573fc:
- In non-pthread Emscripten builds, CN3SndMgr::InitOpenAL returns through sound-unavailable handling before native AudioThread starts.
- Native/pthread audio code is retained. Browser audio remains unfinished; this milestone is silent.
- Patcher applied successfully to the inspected upstream checkout; Python syntax and extracted C++ browser guard compilation/execution passed.
- The original patcher has a pre-existing non-idempotent WarFareMainSDL anchor; use a fresh upstream checkout for each complete application.
- Follow-up CI run 38443198960 completed: build and the original runtime gate passed; binaries committed by CI as 74068a4. The audio-thread exception is gone and both login initialization markers were reached.
- IMPORTANT: manual review of browser-runtime.png shows a fully BLACK framebuffer. The runtime log contains invalid texture format, unsupported sampler parameters, GL_BGRA vertex attribute size and missing vertex buffer errors. The original gate was a false positive for rendered login. Do NOT describe this as a visible or playable login screen.
- Hardened the workflow gate to reject page errors and WebGL INVALID errors. Verified that the new gate rejects the actual failed-render log. The gate change is saved with [skip ci]; no additional long run started in this time block.
- Next block: fix WebGL2 pixel/vertex format conversion and unsupported sampler parameters in RHIDeviceGL/GLLoader, then run the tightened gate and inspect its screenshot. In RHIDeviceGL.cpp, GL_BGRA is currently passed as VertexAttribPointer size; WebGL2 requires size 1–4 and color channel conversion. A raw format substitution also needs correct BGRA/RGBA color swizzling. Texture uploads report INVALID_ENUM and must be checked separately.
- Audio remains unavailable. Gateway/server authentication/Moradon are still incomplete.
- CI artifact ID: 11836598785. Local inspection: /workspace/scratch/961e7882a157/ci-result/. Source checkout: /workspace/projects/oldera-browser-port/.

## Scope still incomplete

The login connection is explicitly deferred to a WebSocket-to-TCP gateway in GameProcLogIn_1298. No real account authentication, server selection round-trip, character creation or Moradon gameplay is established by this build. Audio needs a browser-compatible implementation. DrawElementsBaseVertex currently ignores nonzero baseVertex and must be addressed before world rendering is accepted.

## WebLegendKO inspection

Visited https://weblegendko.com/ and /rehber on 2026-10-13. The pages show beta status, official launch 24 October 2026 at 19:00, online counters, rankings, drop/farm/upgrade/master guides, level 83 and newer premium systems. The page reports five players online during this inspection; this is a site-reported figure, not an independently verified server count. Oyna opened an empty tab / returned to the landing page in this browser. No account was created and no gameplay or internal engine architecture was verified. A recent launch does not establish how long development took.
