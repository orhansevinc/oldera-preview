# WS50 — Public Test-Link Staging Candidate

## Decision

**STAGING LINK CANDIDATE: READY_PENDING_WS10**

The latest WS50 source/staging composition is reproducible and all WS50-owned integration checks pass. The former WS01 WSS and WS09 strict-MIME blockers are closed in the latest provider set.

**Single remaining release-gate owner: WS10.**

No public test URL may be released until WS10 supplies an exact completed successful Moradon E2E run plus the frozen passing client artifact. WS50 will not rebuild that client.

## Authoritative staging rehearsal

GitHub Actions evidence:

```text
workflow: WS50 Integration Rehearsal
run:      38503488408 (run 22)
job:      staging-candidate-rehearsal / 115655569968
result:   SUCCESS
artifact: ws50-staging-candidate / 11866703844
artifact zip sha256: f6780a3ab98b5576727a420aa7c4dfaf9249221dd19e119dac6b44d9d6fadd1c
candidate tree: 300d7e41dfb7ca84baaef0db2cef8c8a9cc1cdd6
```

Every provider ref was snapshotted once at run start and re-fetched at run end. All exact refs remained unchanged for the complete rehearsal.

## Exact provider snapshot

| Role | Ref | Exact SHA |
|---|---|---|
| main base | `main` | `5715c55abd9ecb36bb32a259d045ba9ad1dc9551` |
| browser baseline | `openko-browser-port` | `18282d0e70de7ccb30244a9f09e2b3bff3040155` |
| WS01 | `ws01-runtime-build` | `25c2fcd9c59e8f7a704f7d2ac0d5c331d0042ff9` |
| WS02 | `ws02-websocket-gateway` | `1738f60945b24e00bdd2266e6600b5c0cf3c64cf` |
| WS03 | `ws03-ko1298-session` | `d634870bbcd2c541695516643d34e0ac119354d7` |
| WS04 | `ws04-character-client` | `32616b1b7ccbdc3de41c0949f182a65e03450d18` |
| WS05 | `ws05-moradon-world` | `0537c481383a69c534799b43810f35e7279c5578` |
| WS09 | `ws09-production-infra` | `bac4f9d1338e385c8aff3989becaa8ed74037b38` |
| WS10 current harness | `ws10-qa-integration` | `419d52b363a73c8ab77ff8ad944a30968fda967d` |
| WS11 | `ws11-protocol-lab` | `05562662d9d3f13a4b0500d0478e065fd802cfd0` |
| WS12 | `ws12-browser-launcher` | `77f55b2949844e0fdd279526dab0fba4e8ab4f94` |
| WS14 | `ws14-world-session` | `82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b` |
| WS38 | `ws38-client-content-pipeline` | `5f323f3cf055ba7f96d928605a2f2faf84e609cb` |
| WS45 | `ws45-session-ownership` | `4a66338743553c2781c68ca84b866ff4e999c14e` |

External immutable inputs:

```text
OPENKO    97eb0ea20207afc0c360bfed6915113572711be3
KO_ASSETS 2055ee6ed77f1b5cfef23832dd5bc31909e14a66
EMSCRIPTEN 6.0.12
```

## What passed on this exact tree

The run-22 staging job passed the complete narrow composition, including:

- WS01 WSS/config-driven transport: **9/9 PASS**; HTTPS resolves to same-origin WSS, AUTH/GAME map to `/auth` and `/game`, insecure `ws://` under HTTPS fails closed.
- WS12 launcher: **11/11 PASS** with WS38 strict publication and same-origin auth/game readiness.
- WS02 gateway: **7/7 PASS**, including byte-identical binary roundtrip and origin rejection.
- WS03 session: **10/10 PASS**.
- WS14 world: **14/14 PASS**, including Moradon zone 21 / native 210 and world handshake contracts.
- WS45 ownership: **16/16 PASS**.
- WS38 content pipeline: **15/15 PASS**.
- WS11 protocol lab: **15/15 PASS**.
- WS05 Moradon static gate: **8/8 PASS**.
- WS03 runtime loading sibling `../ko1298-world`: **PASS**.
- WS02 Docker build: **PASS**.
- integrated WS03+WS14+WS45 rehearsal container build: **PASS**.
- auth `15100` and game `15001` TCP boot probes: **PASS**.
- WS09 production+staging config validation: **PASS**.
- WS09 staging compose render: **PASS**.
- combined WSS/MIME/publication staging contract: **PASS** with `blocker_owner=null`.

The exact staging contract reported all required flags true: WS01 config-driven WSS, WS01 `/auth`+`/game`, WS09 auth/game edge, JS/WASM/DATA MIME, WS12 auth/game readiness, and WS12 strict publication.

## WS10 gate status

Last completed real Moradon gate before this candidate was WS10 run `38501204665` (run 24), which failed after genuine 587 MB client preload had reached the real browser Moradon path through `moradon-zone-begin` and `moradon-assets-loaded`, but before the required terrain-render marker completed inside the old capture timeout.

The latest run is:

```text
WS10 run: 38503397843 (run 25)
head:     419d52b363a73c8ab77ff8ad944a30968fda967d
purpose:  harden genuine Moradon preload timing
state at WS50 handoff preparation: IN_PROGRESS
```

Therefore the exact PASS fields remain intentionally unset. `READY_PENDING_WS10` is the only valid decision until that run, or a later exact compatible WS10 run, completes successfully and publishes both PASS evidence and the passing client artifact.

## Publication consequence

WS09 already has the fail-closed ephemeral HTTPS/WSS publisher. It rejects a WS50 handoff containing `READY_PENDING_WS10`, rejects a non-successful WS10 run, and rejects missing/non-live PASS or client artifacts.

When WS10 PASS exists, `integration-rehearsal/STAGING_LINK_HANDOFF.md` is the single publication handoff. The passing `KnightOnLine.js`, `.wasm`, and `.data` must be taken directly from that WS10 artifact; **no WS50 or WS09 rebuild is allowed**.

No public link was fabricated or released by WS50.
