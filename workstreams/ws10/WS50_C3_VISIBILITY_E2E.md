# WS10 frozen WS50-C3 visibility E2E result

Date: 2026-10-14

## Scope

This result is intentionally pinned to the WS50 current-candidate that was resolved once at task start. No later provider HEAD was adopted.

- Provider set: `WS50-C3`
- Immutable key: `WS50-C3@sha256:a9c808898bd1cb9f3cadfb44ddbabadaf34448f9aef0a4990ca91958053458aa`
- WS50 freeze commit: `15eb5b83bfadb7bb9ad131997730ef5adf0abcc8`
- WS10 frozen harness/provider identity: `4a81c6cf7e11514ca01f0730ecc57010c9ea37fb`
- Gate implementation commit: `c8ef2774d007d6c7cf07db9a1c430b74938a4fc6`
- Workflow run: `38591410967`
- Workflow run #1 conclusion: `failure` by design at the first real frozen-C3 visibility boundary.

## Canonical browser regression

The historical canonical client was reused unchanged; there was no gameplay client rebuild.

- Client artifact: `ws10-moradon-passing-client-26`
- Artifact id: `11867980473`
- Artifact ZIP SHA-256: `ff9fb679ad1b3caa184ad098cff81cfb5469b0698d5e5f3b76ef4fab2ea775b3`
- Source run: `38505039290`
- Real browser job: `canonical-browser-regression` = `success`
- Terrain = PASS
- Shapes = PASS
- Local player = PASS
- Native non-black framebuffer = PASS (`108300/786432`, ratio `0.1377`)
- Canonical NPC wire regression = PASS: server `0x1C`, client `0x1D`, server `0x1D`
- Client crash = none

This historical regression still contains the canonical synthetic NPC fixture and is therefore explicitly regression-only. It is not accepted as production NPC/mob visibility proof.

Regression evidence artifact:

- `ws10-ws50-c3-canonical-regression-1`
- artifact id `11906774777`
- ZIP SHA-256 `c81c930cbb2c519226a91073e2eddc508c32e9d88a98490120361cd768152d25`

## Frozen C3 visibility boundary

The exact C3 provider pins were staged and checked without resolving later branch HEADs:

- WS14 `c1a1d454285db02c6de0c087a2d65434bfb4593b`
- WS16 `234657c1264ead6b8828425ae9e7fcdca0cca5c8`
- WS25 `a42b489e1a17d7c2889cfd92909ddd45c65e825e`
- WS31 `546d2ab62cd46a97f3385ebcddbe0c775a02c2eb`

First real failing boundary: `SERVER`.

First blocker: `WORLD_TERRAIN_HEIGHT_AUTHORITY`.

Source-backed reasons:

1. Frozen WS16 requires authoritative terrain+shape Y and fails closed when height is unresolved. Frozen C3 does not contain the resolved authority in its immutable composition.
2. Frozen WS14 expects an injected `buildMobBootstrap` port for mob bootstrap packets.
3. Frozen WS25 provides mob domain/AI runtime but does not own/provide the KO1298 visibility packet encoder required by that WS14 port.
4. The frozen C3 candidate itself records `WORLD_TERRAIN_HEIGHT_AUTHORITY`, `NPC_REGION_BODY_AUTHORITY`, and `MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY` as blockers.

Therefore verified C3 NPC/mob wire delivery was not reached, and client entity-create/model/render evidence cannot honestly be claimed. Movement/region-change acceptance for this candidate is also not reached.

Boundary evidence artifact:

- `ws10-ws50-c3-visibility-boundary-1`
- artifact id `11908280660`
- ZIP SHA-256 `da075d073999056f5bb5de6ad6b5f1fcad6fcc4fdafc0b7560dba485abe9a991`

## Anti-fake gate

No JS DOM entity, HTML overlay, Three.js entity, or synthetic fixture was accepted as new visibility PASS evidence.

## Decision

`FAIL / SERVER` for frozen `WS50-C3` visibility E2E.

Canonical Moradon browser regression remains GREEN, but `WS50-C3` is not publication-ready for verified NPC + mob visibility. No PASS artifact was produced for the new visibility milestone.
