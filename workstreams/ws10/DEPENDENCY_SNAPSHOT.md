WS10

# DEPENDENCY SNAPSHOT — Final Moradon E2E run 26

The WS10 integration workflow froze the following provider refs before the final passing execution. Provider branches were consumed read-only in isolated worktrees; WS10 did not merge or push to any provider branch.

## SELF

- Workstream: `WS10`
- Branch: `ws10-qa-integration`
- Tested harness commit: `f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41`
- Workflow: `WS10 Moradon E2E Integration Gate`
- Canonical run: **#26**, run id `38505039290`
- Harness self-test job: `115660485382` — **SUCCESS**
- Native Moradon E2E job: `115660485730` — **SUCCESS**
- Decision: **MORADON E2E: PASS**

## UPSTREAM PROVIDERS

| Provider | Branch / source | Exact SHA | Run 26 evidence |
|---|---|---|---|
| WS02 | `ws02-websocket-gateway` | `1738f60945b24e00bdd2266e6600b5c0cf3c64cf` | Real browser WebSocket -> TCP AUTH/GAME transport; provider tests PASS. |
| WS03 | `ws03-ko1298-session` | `d634870bbcd2c541695516643d34e0ac119354d7` | Real auth/session/create/list/select path; provider tests PASS; live `0x02` create and `0x04` select observed. |
| WS04 | `ws04-character-client` | `32616b1b7ccbdc3de41c0949f182a65e03450d18` | Genuine character UI probes + native GL capture contract; world proof id `1010` serviced by real `Present()`. |
| WS05 | `ws05-moradon-world` | `0537c481383a69c534799b43810f35e7279c5578` | Wire zone 21/native zone 210 probes, genuine world preload/render gate; `WS05_MORADON_GATE=PASS`. |
| WS11 | `ws11-protocol-lab` | `05562662d9d3f13a4b0500d0478e065fd802cfd0` | Frozen protocol evidence dependency. |
| WS14 | `ws14-world-session` | `82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b` | Real `WorldSessionService`; GAMESTART/MYINFO/ZONEABILITY/region/NPC bootstrap observed; provider tests PASS. |
| WS45 | `ws45-session-ownership` | `4a66338743553c2781c68ca84b866ff4e999c14e` | Frozen session-ownership dependency for the deterministic single-instance E2E composition. |

## EXTERNAL PINNED INPUTS

| Input | Exact identity | Run 26 use |
|---|---|---|
| OpenKO browser source | `luisfelipe18/old-school-openko@97eb0ea20207afc0c360bfed6915113572711be3` | Real C++ WarFare client built to Emscripten/WASM/WebGL2. |
| KO 1298 assets | `ko4life-net/ko-assets@2055ee6ed77f1b5cfef23832dd5bc31909e14a66` | Genuine 1298 assets; identity verified in CI. |
| KO 1298 asset tree | `705874881c8308e0a45a0c849e4b3881088d8138` | Exact asset tree verified before build. |
| Emscripten | `6.0.12` | Toolchain used by the real passing build. |

## FINAL CONTRACT EVIDENCE

The same browser session proves:

- server/wire Moradon zone: `21`;
- pinned native client Moradon zone: `210`;
- `moradon-assets-loaded`;
- Present-only capture request `1010` armed by the WS10 entry bootstrap;
- genuine `WS04_GL_CAPTURE id=1010 ok=1 ... source=present`;
- terrain rendered;
- shapes rendered;
- local player rendered;
- native GL framebuffer 1024x768;
- non-black pixels `108300/786432`, ratio `0.1377`;
- `WS10_MORADON_E2E_PASS`;
- `WS05_MORADON_GATE=PASS`.

The world phase required roughly 82 seconds before the final native render/capture markers, validating the WS10 `600000 ms` world deadline over the obsolete fixed 60-second window. Console observation during this phase is Node-side only; WS10 does not repeatedly interrupt synchronous WASM preload with `page.evaluate()` polling.

## EXACT PASSING BUILD IDENTITY

Frozen Actions artifact:

- name: `ws10-moradon-passing-client-26`
- artifact id: `11867980473`
- artifact size: `623185661` bytes
- digest: `sha256:ff9fb679ad1b3caa184ad098cff81cfb5469b0698d5e5f3b76ef4fab2ea775b3`
- passing `KnightOnLine.js`: `1493510` bytes
- passing `KnightOnLine.wasm`: `5631727` bytes
- passing `KnightOnLine.data`: `615930538` bytes
- entry: `ws10-moradon.html`
- includes provider refs, PASS metadata/logs/native frame and SHA256 manifest.

Evidence artifact:

- name: `ws10-moradon-e2e-26`
- artifact id: `11867553862`
- digest: `sha256:912319f5aafb7ac66fcc6a2578f8a0efdebc0564c5ce1962ed99e3f66b8c4abb`

## DOWNSTREAM

- WS50 can now consume the exact passing client artifact/ref set for `STAGING_LINK_HANDOFF` and latest staging candidate.
- WS09 can publish that frozen candidate through the separate ephemeral HTTPS/WSS test-link pipeline once the WS50 handoff is ready.

## BLOCKERS

- WS10 Track-A blocker: **NONE**.
- No provider change is requested by this final PASS.
- Public test-link publication remains downstream WS50/WS09 work and is not a WS10 blocker.

## LAST_SYNC

2026-10-14 — canonical evidence synchronized from successful run #26 (`38505039290`).
