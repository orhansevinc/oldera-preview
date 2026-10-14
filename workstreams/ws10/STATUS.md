WS10

# STATUS — Final Moradon QA/E2E Integration Gate

Status: **MORADON E2E: PASS**

Branch: `ws10-qa-integration`
Canonical workflow: `WS10 Moradon E2E Integration Gate`
Canonical run: **#26** / run id `38505039290`
Tested WS10 harness commit: `f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41`
Harness self-test job: `115660485382` — **SUCCESS**
Native Moradon E2E job: `115660485730` — **SUCCESS**

## Final decision

Run #26 proves the required final Moradon path in one genuine C++/Emscripten/WASM/WebGL2 browser session using genuine KO 1298 assets:

- real WASM runtime and `render backend: OpenGL`;
- login -> server list -> version `1298` -> Nation Select;
- genuine Character Create UI and real `WIZ_NEW_CHAR (0x02)`;
- create success and refreshed occupied slot (`Ws10Hero`);
- real `WIZ_SEL_CHAR (0x04)` with wire/server zone `21`;
- WS03 -> WS14 selected-character/world handoff and two-phase GAMESTART bootstrap;
- native client world zone `210`;
- `moradon-assets-loaded`;
- `moradon-terrain-rendered`;
- `moradon-shapes-rendered`;
- `moradon-local-player-rendered`;
- `WS04_GL_CAPTURE id=1010 ... source=present` from the genuine native GL backbuffer;
- native framebuffer `1024x768`, non-black `108300/786432`, ratio `0.1377`;
- `WS05_MORADON_VISUAL_OK source=pre-swap-gl ratio=0.1377`;
- `WS10_MORADON_E2E_PASS`;
- provider-owned `WS05_MORADON_GATE=PASS`.

## WS10 harness correction

The genuine client data package is `615930538` bytes (~587 MiB). Runs #23/#24 showed the fixed 60-second world-marker window was too short around synchronous preload/render work; this was a WS10 evidence-timing problem, not a reason to rewrite provider logic.

The final WS10-only correction:

- gives the world render phase a deterministic `600000 ms` deadline;
- polls already-collected console evidence only from Node/Playwright with 15-second progress heartbeats instead of repeatedly injecting `page.evaluate()` calls during synchronous WASM work;
- arms native capture id `1010` synchronously from the WS10-generated entry page when `moradon-assets-loaded` is printed;
- explicitly sets that request Present-only, so the timer fallback cannot read the framebuffer during preload;
- still requires a real `source=present` native capture and does not relax any terrain/shape/player/non-black gate.

Run #25 proved the long preload/capture path itself succeeded and exposed only an overly strict WS10 log substring ordering check. Commit `f0cadfb...` accepts additive capture metadata while independently requiring `source=present`; run #26 then passed unchanged provider code.

## Frozen exact passing client

The same successful run staged and uploaded the exact passing build as:

- artifact: `ws10-moradon-passing-client-26`
- artifact id: `11867980473`
- artifact size: `623185661` bytes
- digest: `sha256:ff9fb679ad1b3caa184ad098cff81cfb5469b0698d5e5f3b76ef4fab2ea775b3`
- `KnightOnLine.js`: `1493510` bytes
- `KnightOnLine.wasm`: `5631727` bytes
- `KnightOnLine.data`: `615930538` bytes
- entry: `ws10-moradon.html`
- includes exact provider refs, PASS metadata/logs, native frame evidence and SHA256 manifest.

Evidence artifact:

- `ws10-moradon-e2e-26`
- artifact id: `11867553862`
- digest: `sha256:912319f5aafb7ac66fcc6a2578f8a0efdebc0564c5ce1962ed99e3f66b8c4abb`

## Boundaries

- no provider branch/code was modified by WS10;
- no fake packet/world/render evidence was accepted;
- no HTML/Canvas2D/Three.js replacement was used;
- no merge to `main`;
- no force push;
- no new workstream number.

`MORADON E2E: PASS`

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
