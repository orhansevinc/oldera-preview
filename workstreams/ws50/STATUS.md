# WS50 STATUS

## Identity / scope

WS50 remains the existing **integration rehearsal** workstream. This control session did not create a new workstream.

Task executed: **Moradon test-link staging integration rehearsal** from `coordination/inbox/WS50.md`.

No merge to `main`, no provider-branch write, no force push, and no provider/product implementation fix was performed.

## Decision

**STAGING INTEGRATION CANDIDATE: BLOCKED**

**Single staging-tree blocker owner: WS01.**

The real browser transport patch used by the current OpenKO/Emscripten line constructs only `ws://<server-ip>:<port>`. It does not provide explicit `wss://` support or `/auth` / `/game` path routing, while WS09's intended public test topology requires HTTPS/WSS with same-host `/auth` and `/game`. WS12 can resolve/probe those URLs but does not rewrite native C++ `CAPISocket` transport.

WS50 therefore cannot declare the candidate publishable as the intended public HTTPS test link.

## Successful disposable staging rehearsal

GitHub Actions evidence:

- run: `38494620556` (WS50 Integration Rehearsal run 15)
- staging job: `115627453667`
- result: **SUCCESS**
- artifact: `11863028321` (`ws50-staging-candidate`)
- artifact digest: `sha256:de96d231cac38c54361c605a9dd8bd1e71f79f494225bb70dafbb56f3c73b2ed`
- exact disposable candidate tree: `72a72d5565b7945c9dcf8f54b4148acec31b5876`

Passing checks inside that exact tree:

- WS12 launcher: 11/11
- WS02 gateway: 7/7
- WS03 session: 10/10
- WS14 world: 14/14
- WS38 content pipeline: 15/15
- WS05 Moradon static gate: 8/8
- WS10 server/browser harness syntax: PASS
- WS03 -> sibling `../ko1298-world` runtime require: PASS
- WS02 Docker image build: PASS
- integration-only WS03+WS14 Docker image build: PASS
- auth/game TCP listener boot: PASS
- WS09 staging compose render: PASS
- end-of-run fresh WS05 fetch/ref equality: PASS

## Exact provider freeze used by successful run

```text
CONTROL_BASE 3aeaaa3de81c8094b47de44f2c24f3c455e7fd3d
BROWSER_BASELINE openko-browser-port 18282d0e70de7ccb30244a9f09e2b3bff3040155
WS01 ws01-runtime-build 5545df2273cda795055a611618c91b948063624f
WS02 ws02-websocket-gateway 1738f60945b24e00bdd2266e6600b5c0cf3c64cf
WS03 ws03-ko1298-session d634870bbcd2c541695516643d34e0ac119354d7
WS04 ws04-character-client fffbd9372b67c2aaef600f7e50595bec7e23fe88
WS05 ws05-moradon-world 6ca101f3390e0a0f6b056afea99b45ec8d4f67be
WS09 ws09-production-infra afca7e7e578a81b8b5852f8a1b3d15a233348847
WS10 ws10-qa-integration 34c551518aad87a9fd03d392f193d354483c95a0
WS12 ws12-browser-launcher 77f55b2949844e0fdd279526dab0fba4e8ab4f94
WS14 ws14-world-session 82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b
WS38 ws38-client-content-pipeline 5f323f3cf055ba7f96d928605a2f2faf84e609cb
OPENKO 97eb0ea20207afc0c360bfed6915113572711be3
KO_ASSETS 2055ee6ed77f1b5cfef23832dd5bc31909e14a66
EMSCRIPTEN 6.0.12
```

The control base is the WS50 inbox-assignment commit and was verified as an ancestor of the current `main` observed by the successful run (`24778282c31d3126f6fe9776359da64cb4ffdf07`). Provider refs were snapshotted once at rehearsal start and then consumed by exact SHA.

WS05 was explicitly re-fetched at the end of the run and remained `6ca101f3390e0a0f6b056afea99b45ec8d4f67be`.

## Browser-line composition rule

Do not full-merge divergent WS01 / WS04 / WS05 browser branches. The successful WS50 tree uses narrow provider paths/scripts only, as documented in:

- `integration-rehearsal/STAGING_CANDIDATE.md`
- `integration-rehearsal/STAGING_APPLY_ORDER.md`

`openko-web/index.html` stays WS01 canonical. The actual OpenKO and KO1298 asset repos stay externally pinned.

## WS03 / WS14 integration result

The same integrated tree contains:

```text
services/ko1298-session/**
services/ko1298-world/**
```

and directly verifies that `services/ko1298-session/server.js` can runtime-load sibling `../ko1298-world` and obtain `WorldSessionService`. The integration-only container also boots both auth and game listeners successfully.

## Latest Moradon E2E prerequisite

WS50 re-ran the unchanged WS10 native browser gate against corrected WS05 head during this control session.

Evidence:

- workflow run: `38490102763`
- rerun job: `115625184048`
- corrected WS05 ref in artifact: `6ca101f3390e0a0f6b056afea99b45ec8d4f67be`
- rerun evidence artifact: `11862962736`

The previous WS05 wire/native-zone defect is resolved in this rerun. The real browser reaches:

```text
zone=21 native_zone=210
moradon-assets-loaded
moradon-terrain-rendered
moradon-shapes-rendered
moradon-local-player-rendered
```

The run still does **not** produce a WS10 PASS. It fails at the next evidence step:

```text
timeout waiting for WS04_GL_CAPTURE id=1010 ok=1
```

That is an upstream Moradon evidence-gate issue, not a failure of the composed staging source tree itself. Publication remains closed until WS10 has a current PASS.

## Additional deployment follow-up

WS12 staging config enables strict WS38 content-type verification. WS38 declares `KnightOnLine.js` as `text/javascript; charset=utf-8`; current WS09 MIME mapping declares `.js/.mjs` as `application/javascript`. WS09 must align this deployment contract before strict publication. WS50 did not alter WS09.

## Outputs added/updated in this control session

- `integration-rehearsal/STAGING_CANDIDATE.md`
- `integration-rehearsal/STAGING_APPLY_ORDER.md`
- `workstreams/ws50/STATUS.md`
- `tools/ws50_integration/staging_candidate.py`
- `tools/ws50_integration/staging_candidate_current.py`
- `.github/workflows/ws50-rehearsal.yml` staging-candidate job

Historical full-program rehearsal outputs remain available separately (`REHEARSAL_REPORT.md`, `SAFE_BATCHES.md`, `FAILED_BRANCHES.md`, `CONFLICTS.md`) and are not the decision source for this Moradon staging control session.
