# WS50 STATUS

## Identity / scope

WS50 remains the existing **integration rehearsal** workstream. No new workstream number was created.

This control session completed the public-test staging task from `coordination/TEST_LINK_SPRINT.md` and `coordination/inbox/WS50.md` on the existing `ws50-integration-rehearsal` branch.

No merge to `main`, no provider-branch write, no force push, and no provider/product implementation change was performed.

## Decision

**STAGING LINK CANDIDATE: READY_PENDING_WS10**

The WS50-owned work is complete. The source/staging candidate passes the required integration rehearsal. The former WS01 WSS transport and WS09 strict-MIME blockers are resolved in the latest provider set.

**Single remaining release-gate owner: WS10.**

The public test link is intentionally not released until an exact completed successful WS10 Moradon E2E run publishes explicit PASS evidence and the frozen passing `KnightOnLine.js` / `.wasm` / `.data` artifact.

## Latest successful staging candidate

Authoritative GitHub Actions evidence:

```text
workflow: WS50 Integration Rehearsal
run: 38503488408 (run 22)
staging job: 115655569968
result: SUCCESS
artifact: ws50-staging-candidate / 11866703844
artifact zip sha256: f6780a3ab98b5576727a420aa7c4dfaf9249221dd19e119dac6b44d9d6fadd1c
candidate tree: 300d7e41dfb7ca84baaef0db2cef8c8a9cc1cdd6
```

All provider refs were frozen at run start and explicitly re-fetched at run end; no ref moved during the successful staging rehearsal.

Exact freeze:

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

## What the candidate proves

On the exact tree above, run 22 passed:

- WS01 transport tests: 9/9.
- WS12 launcher tests: 11/11.
- WS02 gateway tests: 7/7.
- WS03 session tests: 10/10.
- WS14 world tests: 14/14.
- WS45 session-ownership tests: 16/16.
- WS38 content-pipeline tests: 15/15.
- WS11 protocol-lab tests: 15/15.
- WS05 Moradon static gates: 8/8.
- WS03 -> sibling `../ko1298-world` runtime load.
- WS02 Docker image build.
- integrated WS03+WS14+WS45 rehearsal image build and auth/game TCP boot probes.
- WS09 production/staging configuration validation and staging compose render.
- combined source contract for WS01 config-driven WSS, same-origin `/auth` + `/game`, WS12 strict publication, and WS09 exact JS/WASM/DATA MIME.

The final staging contract reports `all_required_contracts=true` and `blocker_owner=null` for the WS50 composition itself.

## WS10 status at close

The latest completed WS10 Moradon run available before this session's close is run #24 / `38501204665`, and it is a failure. It reaches the real Moradon path through zone begin and assets loaded after the genuine large preload, but does not produce the required final PASS.

The latest attempt is:

```text
run: 38503397843 (#25)
head: 419d52b363a73c8ab77ff8ad944a30968fda967d
message: test(ws10): harden genuine Moradon preload timing
state at handoff preparation: IN_PROGRESS
```

Therefore WS50 correctly remains `READY_PENDING_WS10`; no exact PASS run/artifact identity is fabricated.

## Handoff complete

The current control session has prepared/updated:

- `integration-rehearsal/STAGING_CANDIDATE.md`
- `integration-rehearsal/STAGING_APPLY_ORDER.md`
- `integration-rehearsal/STAGING_LINK_HANDOFF.md`
- `workstreams/ws50/STATUS.md`
- `tools/ws50_integration/staging_candidate.py`
- `tools/ws50_integration/staging_candidate_current.py`

The rehearsal harness now composes the full narrow provider order, includes WS45/WS11/WS09 deployment surfaces, validates the WSS/MIME/publication contracts, and fails closed if any frozen provider branch moves during the rehearsal.

`STAGING_LINK_HANDOFF.md` contains the exact provider SHAs, launcher/static publication order, backend/session/world composition, public `/play-shell/` + `/auth` + `/game` contract, and the one-shot WS09 public smoke recipe. Its four WS10 PASS fields are deliberately `REQUIRED` until the gate succeeds.

When WS10 PASS exists, this same WS50 handoff is updated with the exact successful run/head/artifact identities and changes from `READY_PENDING_WS10` to `READY`. The passing client artifact is consumed unchanged; it is not rebuilt.

## Boundaries preserved

- no fake HTML/iframe/Three.js client
- no fake Moradon PASS
- no public URL invented
- no `main` merge
- no provider-branch push
- no force push
- no new WS number

**BU SOHBETE ARTIK GEREK VAR MI?: HAYIR**
