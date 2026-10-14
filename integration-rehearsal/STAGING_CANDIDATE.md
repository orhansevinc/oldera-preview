# WS50 — Moradon Test-Link Staging Candidate

## Decision

**STAGING INTEGRATION CANDIDATE: BLOCKED**

**Single staging-tree blocker owner: WS01.**

The disposable integrated source tree is reproducibly defined and its static/service/container rehearsal passes, but the browser-native `CAPISocket` transport currently injected by the browser baseline/WS01 path still constructs only:

```cpp
ws://<server-ip>:<port>
```

It has no `wss://` selection and no `/auth` / `/game` path support. WS09's public staging edge contract is HTTPS/WSS and routes browser WebSockets through same-host `/auth` and `/game`. Therefore this exact candidate cannot be published as the intended public HTTPS test link without changing provider-owned browser transport code. WS50 does not patch provider/product code.

This is an independent staging-tree blocker even if the Moradon visual gate becomes PASS.

## Rehearsal evidence

GitHub Actions:

- workflow: `WS50 Integration Rehearsal`
- run: `38494620556` (run 15)
- job: `staging-candidate-rehearsal` / `115627453667`
- job result: **SUCCESS**
- artifact: `ws50-staging-candidate` / `11863028321`
- artifact SHA-256: `de96d231cac38c54361c605a9dd8bd1e71f79f494225bb70dafbb56f3c73b2ed`
- disposable candidate Git tree: `72a72d5565b7945c9dcf8f54b4148acec31b5876`

The run used read-only provider refs and a detached disposable worktree. It did not update `main` or any provider branch.

## Exact frozen source snapshot

WS50 control base was kept at the inbox-assignment commit and verified to remain an ancestor of current `main` during the successful run:

| Role | Ref | Exact SHA |
|---|---|---|
| WS50 control base | `main` assignment point | `3aeaaa3de81c8094b47de44f2c24f3c455e7fd3d` |
| Browser baseline | `openko-browser-port` | `18282d0e70de7ccb30244a9f09e2b3bff3040155` |
| WS01 | `ws01-runtime-build` | `5545df2273cda795055a611618c91b948063624f` |
| WS02 | `ws02-websocket-gateway` | `1738f60945b24e00bdd2266e6600b5c0cf3c64cf` |
| WS03 | `ws03-ko1298-session` | `d634870bbcd2c541695516643d34e0ac119354d7` |
| WS04 | `ws04-character-client` | `fffbd9372b67c2aaef600f7e50595bec7e23fe88` |
| WS05 | `ws05-moradon-world` | `6ca101f3390e0a0f6b056afea99b45ec8d4f67be` |
| WS09, read-only deployment contract | `ws09-production-infra` | `afca7e7e578a81b8b5852f8a1b3d15a233348847` |
| WS10 harness/evidence | `ws10-qa-integration` | `34c551518aad87a9fd03d392f193d354483c95a0` |
| WS12 | `ws12-browser-launcher` | `77f55b2949844e0fdd279526dab0fba4e8ab4f94` |
| WS14 | `ws14-world-session` | `82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b` |
| WS38 | `ws38-client-content-pipeline` | `5f323f3cf055ba7f96d928605a2f2faf84e609cb` |

External immutable build inputs:

| Input | Exact pin |
|---|---|
| OpenKO source | `97eb0ea20207afc0c360bfed6915113572711be3` |
| Genuine KO 1298 assets | `2055ee6ed77f1b5cfef23832dd5bc31909e14a66` |
| Emscripten | `6.0.12` |

At the end of the successful rehearsal WS50 explicitly re-fetched `ws05-moradon-world`; it was still `6ca101f3390e0a0f6b056afea99b45ec8d4f67be`, so this report is not based on a stale WS05 ref.

## Narrow composition used

Because WS01 / WS04 / WS05 are divergent browser-line branches, WS50 did **not** merge their full histories. The disposable tree took only the provider-described narrow inputs:

- browser baseline: `tools/patch_openko_browser.py`, `tools/patch_openko_browser_gateway.py`, `tools/fix_browser_server_ini_case.py`, `tools/patch_openko_browser_serverlist_probe.py`, `tools/patch_openko_browser_auth_probe.py`
- WS01: `openko-web/index.html`, `tools/ws01_runtime/**`
- WS38: `content-pipeline/**`, `tools/ws38_content/**`, `tests/content-pipeline/**`
- WS12: `play-shell/**`, `tools/ws12_launcher/**`, `tests/ws12-launcher/**`
- WS02: `services/ko-gateway/**`, `tests/ko-gateway/**`
- WS03: `services/ko1298-session/**`, `tests/ko1298-session/**`
- WS04: `tools/ws04_character/**`
- WS14: `services/ko1298-world/**`, `tests/ko1298-world/**`
- WS05: `tools/ws05_moradon/**`
- WS10 integration-only: `qa/**`, `tests/e2e/**`
- WS09: consumed read-only for staging compose/Nginx contract; not merged into the candidate source tree.

## Static / build / runtime rehearsal result

| Check | Result |
|---|---|
| staged diff whitespace check | PASS |
| WS12 config contract | PASS |
| WS12 launcher tests | **11/11 PASS** |
| WS02 gateway tests | **7/7 PASS** |
| WS03 session tests | **10/10 PASS** |
| WS14 world tests | **14/14 PASS** |
| WS38 content-pipeline tests | **15/15 PASS** |
| WS05 Moradon static gate | **8/8 PASS** |
| WS10 integration server syntax | PASS |
| WS10 browser E2E harness syntax | PASS |
| `services/ko1298-session` -> `../ko1298-world` runtime require | **PASS** |
| WS02 gateway Docker image build | PASS |
| integration-only WS03+WS14 Docker image build | PASS |
| integrated auth listener TCP boot | PASS |
| integrated game listener TCP boot | PASS |
| WS09 `docker compose config` with rehearsal images | PASS |
| end-of-run fresh WS05 ref check | PASS |

The session/world container's human-readable startup log text was not treated as a protocol contract; both TCP ports were opened successfully and are the runtime boot evidence.

## Public-staging compatibility finding

The successful rehearsal records:

```text
browser_transport_hardcoded_plain_ws_host_port = true
browser_transport_explicit_wss_support = false
browser_transport_auth_game_path_support = false
ws09_staging_requires_auth_game_paths = true
blocker_owner = WS01
```

The relevant provider boundary is clear:

- WS02 already supports separate auth/game gateway modes.
- WS09 already defines `/auth` and `/game` WebSocket proxy locations and expects TLS/WSS termination for an Internet-facing test URL.
- WS12 can resolve same-origin `/auth` and `/game` to WSS under HTTPS, but launcher readiness probes cannot rewrite the native C++ `CAPISocket` URL.
- the current browser-native socket patch remains `ws://host:port` only.

Required provider action is therefore WS01/browser-runtime ownership: make the real Emscripten transport consume a staging-safe WebSocket endpoint contract that supports HTTPS/WSS and auth/game routing without changing KO packet semantics.

## Moradon PASS prerequisite status

WS50 also re-ran the unchanged WS10 Moradon native E2E against corrected WS05 head `6ca101f3390e0a0f6b056afea99b45ec8d4f67be` (same workflow run `38490102763`, rerun job `115625184048`). The old `21` vs native `210` defect is resolved in the rerun: the browser emitted all of these from the real client path:

```text
WS05_GATE event=moradon-zone-begin zone=21 native_zone=210
WS05_GATE event=moradon-assets-loaded zone=21 native_zone=210
WS05_GATE event=moradon-terrain-rendered zone=21 native_zone=210
WS05_GATE event=moradon-shapes-rendered zone=21 native_zone=210
WS05_GATE event=moradon-local-player-rendered zone=21 native_zone=210
```

The rerun nevertheless did **not** become a WS10 PASS. Its browser result is:

```text
FAIL: timeout waiting for WS04_GL_CAPTURE id=1010 ok=1
```

That timeout belongs to the upstream Moradon evidence gate, not to WS50's static staging-tree composition. Therefore WS50 still cannot say the "PASS arrived" publication precondition is satisfied. Separately, even after that evidence gate clears, the WS01 public-WSS transport incompatibility above remains the single WS50 staging-tree blocker.

## Additional integration note — MIME

WS12's staging example enables strict WS38 content-type validation. WS38 currently declares `KnightOnLine.js` as `text/javascript; charset=utf-8`, while WS09's checked-in MIME map serves `.js/.mjs` as `application/javascript`. Before strict WS38 publication is enabled, the publishing edge must make those contracts identical. This is recorded as a WS09 deployment follow-up; it does not change the WS50 decision owner because the browser transport is already a hard structural blocker before public HTTPS/WSS gameplay can connect.

## Safety / ownership

- no merge to `main`
- no push to any provider branch
- no force push
- no provider/product code fix inside WS50
- only WS50-owned rehearsal tooling, workflow, and reports were changed
