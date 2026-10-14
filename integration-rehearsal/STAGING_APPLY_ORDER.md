# WS50 — Staging Apply Order

This is the reproducible source-composition and publication recipe for the OldKOWeb public Moradon test-link candidate. It is **not** a merge plan for `main` and it must not be used to rebuild a client after WS10 has produced a passing frozen client artifact.

## 0. Freeze once, then fail closed

The authoritative latest WS50 staging rehearsal is GitHub Actions run `38503488408` (WS50 Integration Rehearsal run 22), staging job `115655569968`.

At run start every provider ref was resolved exactly once. At run end every ref was fetched again and proved unchanged. The exact composed Git tree is:

```text
300d7e41dfb7ca84baaef0db2cef8c8a9cc1cdd6
```

Frozen refs:

```text
MAIN 5715c55abd9ecb36bb32a259d045ba9ad1dc9551
BROWSER_BASELINE openko-browser-port 18282d0e70de7ccb30244a9f09e2b3bff3040155
WS01 ws01-runtime-build 25c2fcd9c59e8f7a704f7d2ac0d5c331d0042ff9
WS02 ws02-websocket-gateway 1738f60945b24e00bdd2266e6600b5c0cf3c64cf
WS03 ws03-ko1298-session d634870bbcd2c541695516643d34e0ac119354d7
WS04 ws04-character-client 32616b1b7ccbdc3de41c0949f182a65e03450d18
WS05 ws05-moradon-world 0537c481383a69c534799b43810f35e7279c5578
WS09 ws09-production-infra bac4f9d1338e385c8aff3989becaa8ed74037b38
WS10 ws10-qa-integration 419d52b363a73c8ab77ff8ad944a30968fda967d
WS11 ws11-protocol-lab 05562662d9d3f13a4b0500d0478e065fd802cfd0
WS12 ws12-browser-launcher 77f55b2949844e0fdd279526dab0fba4e8ab4f94
WS14 ws14-world-session 82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b
WS38 ws38-client-content-pipeline 5f323f3cf055ba7f96d928605a2f2faf84e609cb
WS45 ws45-session-ownership 4a66338743553c2781c68ca84b866ff4e999c14e
OPENKO 97eb0ea20207afc0c360bfed6915113572711be3
KO_ASSETS 2055ee6ed77f1b5cfef23832dd5bc31909e14a66
EMSCRIPTEN 6.0.12
```

If any provider needed by the release moves before the final READY handoff, repeat the freeze/rehearsal. Never silently mix a newer branch tip with this exact tree.

## 1. Narrow source composition order

Start from exact `MAIN`, in a detached disposable worktree. Apply only the owned surfaces below, in this order:

1. `BROWSER_BASELINE` browser source-generation scripts.
2. `WS01`: `openko-web/index.html`, `tools/ws01_runtime/**`.
3. `WS12`: `play-shell/**`, `tools/ws12_launcher/**`, `tests/ws12-launcher/**`.
4. `WS38`: `content-pipeline/**`, `tools/ws38_content/**`, `tests/content-pipeline/**`.
5. `WS02`: `services/ko-gateway/**`, `tests/ko-gateway/**`.
6. `WS03`: `services/ko1298-session/**`, `tests/ko1298-session/**`.
7. `WS14`: `services/ko1298-world/**`, `tests/ko1298-world/**`.
8. `WS45`: `services/session-ownership/**`, `tests/session-ownership/**`.
9. `WS04`: `tools/ws04_character/**`.
10. `WS05`: `tools/ws05_moradon/**`.
11. `WS11`: `tools/ws11_protocol/**`, `protocol-lab/**`, `tests/protocol-lab/**`.
12. `WS09`: `infra/**`, `deploy/**`, `docker-compose.ws09.yml`, `docker-compose.ws09-staging.yml`.
13. `WS10`: `qa/**`, `tests/e2e/**` **only as QA/harness input**.

Do not full-merge divergent browser branches. WS10 is never a production implementation provider in this composition.

## 2. Browser source-generation order

For a source rehearsal or a WS10-controlled build, use the immutable OpenKO/KO-assets pins above and apply browser patches in this exact sequence:

```text
tools/patch_openko_browser.py
tools/patch_openko_browser_gateway.py
tools/fix_browser_server_ini_case.py
tools/patch_openko_browser_serverlist_probe.py
tools/patch_openko_browser_auth_probe.py
tools/ws04_character/patch_character_client.py
tools/ws04_character/patch_frame_capture.py
tools/ws05_moradon/patch_moradon_client.py
tools/ws01_runtime/prepare_browser_source.py   # LAST
```

`prepare_browser_source.py` owns the final config-driven browser transport injection. The current WS01 contract maps AUTH `15100 -> /auth`, GAME `15001 -> /game`, upgrades HTTPS-relative endpoints to `wss://`, and fails closed on insecure `ws://` under HTTPS.

**Release rule:** once WS10 produces the exact passing `KnightOnLine.js`, `KnightOnLine.wasm`, and `KnightOnLine.data`, WS50/WS09 must consume those files unchanged. Do not rebuild them.

## 3. Required validation on the composed source tree

Run the WS01 transport tests, WS12 launcher tests, WS38 manifest tests, WS02 gateway tests, WS03 session tests, WS14 world tests, WS45 ownership tests, WS11 protocol tests, WS05 Moradon static gates, WS10 harness syntax checks, and WS09 configuration validation.

The run-22 candidate passed all of them, including:

```text
WS01 transport                  9/9 PASS
WS12 launcher                  11/11 PASS
WS02 gateway                    7/7 PASS
WS03 session                   10/10 PASS
WS14 world                     14/14 PASS
WS45 session ownership         16/16 PASS
WS38 content pipeline          15/15 PASS
WS11 protocol lab              15/15 PASS
WS05 Moradon static gate        8/8 PASS
WS03 -> ../ko1298-world load          PASS
WS09 production+staging config       PASS
```

The integrated session/world container must contain the WS03 and WS14 sibling directories together. Run 22 proved both TCP listeners are actually reachable on auth `15100` and game `15001`; TCP probes are the boot proof even if human-readable startup log wording differs.

## 4. Gateway and same-origin edge contract

WS02 is deployed as separate auth/game gateway instances. WS09 staging maps the same public HTTPS host to:

```text
/play-shell/    static launcher
/auth           WSS -> auth gateway -> session-world:15100
/game           WSS -> game gateway -> session-world:15001
```

Required public client media types are exact:

```text
KnightOnLine.js   text/javascript; charset=utf-8
KnightOnLine.wasm application/wasm
KnightOnLine.data application/octet-stream
```

Run 22 verified the WS01 WSS resolver, WS12 same-origin readiness contract, WS38 strict publication contract and latest WS09 MIME/routes together.

## 5. Static client publication order

The passing WS10 artifact is published through WS38 without rebuilding it. Use this fail-closed order:

1. copy immutable `index.html`, `KnightOnLine.js`, `KnightOnLine.wasm`, `KnightOnLine.data`, `BUILD.txt` into `/client-content/v1/<contentVersion>/`;
2. write `manifest.json`;
3. verify the manifest against immutable files;
4. write `_complete.json`;
5. verify again with the publication marker required;
6. write `/latest.json` **last**;
7. run WS12 strict preflight against `latest -> manifest -> _complete -> required files`.

Never expose `latest.json` before the immutable release is complete.

## 6. Final release gate

The source/staging composition is proven. Public-link publication remains closed until an exact successful WS10 Moradon run supplies both:

- explicit Moradon E2E PASS evidence; and
- the frozen passing client artifact containing exactly one each of `KnightOnLine.js`, `KnightOnLine.wasm`, `KnightOnLine.data`.

At this control-session close, WS10 run `38503397843` (run 25, head `419d52b363a73c8ab77ff8ad944a30968fda967d`) is still in progress, so the current decision is `READY_PENDING_WS10`.
