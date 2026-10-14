# WS50 — Immutable provider-set ladder for Moradon live visibility

## Decision

The historical browser-proven baseline is **WS50-B0** and remains the last accepted set. The current candidate is **WS50-C3**. C3 is intentionally **BLOCKED**, not silently promoted to a browser-ready set.

This work does not merge provider branches, does not write gameplay logic, and does not resolve provider branch HEADs again after the one-time snapshot recorded in `release/sets/ws50/latest-branch-snapshot.json`.

## Set identities

| Set | Parent | Purpose | Result | First domain boundary | First wire boundary |
|---|---|---|---|---|---|
| `WS50-B0` | — | Last canonical real-browser baseline | ACCEPTED | — | — |
| `WS50-C1` | `WS50-B0` | Current session/world/movement/NPC contracts | BLOCKED | verified visibility data authority not pinned | `WIZ_NPC_REGION (0x1C)` body is PARTIAL |
| `WS50-C2` | `WS50-C1` | Add current WS31 verified visibility data | BLOCKED | `WORLD_TERRAIN_HEIGHT_AUTHORITY` | `WIZ_NPC_REGION (0x1C)` body is PARTIAL |
| `WS50-C3` | `WS50-C2` | Add current WS25 real Moradon mob runtime | BLOCKED | `WORLD_TERRAIN_HEIGHT_AUTHORITY` | NPC region body partial; mob bootstrap encoder authority incomplete |

Immutable keys:

- B0: `WS50-B0@sha256:57bf3e37dd4406380e35d042d3336b9bd2f9a6295ea91be7e8b835e7c94e8fda`
- C1: `WS50-C1@sha256:7dc7ea7e4cd33720395f8c0034297d434a71be04940cc425d0c917adc0a79799`
- C2: `WS50-C2@sha256:f5d1a72446a9edb65788052b2d56d0ec8321864e675d0c06a7a4457b46c70641`
- C3: `WS50-C3@sha256:a9c808898bd1cb9f3cadfb44ddbabadaf34448f9aef0a4990ca91958053458aa`

## B0 — accepted browser baseline

B0 preserves the canonical WS10 real-browser PASS (`38505039290`, head `f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41`) and the unchanged passing client artifact digest `sha256:ff9fb679ad1b3caa184ad098cff81cfb5469b0698d5e5f3b76ef4fab2ea775b3`.

The later WS50 staging revalidation is run `38510205667`, candidate tree `d7aac0d6095d5b4eb82b352633e9988072d89a82`. B0 is historical evidence; it is never recomputed from latest branch tips.

## C1 — current session/world/movement/NPC bundle

Exact current source heads are locked once. Status-only closing commits retain their separate tested implementation SHA:

- WS03 exact `495de481726734d85cc28b3d432835799aff7e48`, tested `6fdcfff60501ea776db4205fa79f68e7d997c4d6`
- WS14 exact `c1a1d454285db02c6de0c087a2d65434bfb4593b`, tested `40c748d72b3f5ccf13bbb5aace7abcae05fd25be`
- WS15 exact `ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d`, tested `b1fee59e98a9dfa44223b090452df511c34bce76`
- WS16 exact/tested `234657c1264ead6b8828425ae9e7fcdca0cca5c8`
- WS11 exact `9ad710e54eda464217ff6cef74ae4a9cf196d68f`, tested authority `5e8a42578c7350d8b4b3a4fbae4e628e5f3b8c7e`

The WS03 composition authority already proves real WS14 + WS15 + WS16 + WS45 composition through WORLD_READY, movement/rotation, zone transition and disconnect cleanup. WS11 now resolves `0x1D WIZ_REQ_NPCIN` ownership as WS14 lifecycle + WS16 record semantics.

C1 is not a visibility PASS because its full target chain deliberately does not yet pin WS31, and WS11 still marks `0x1C WIZ_NPC_REGION` as `PARTIAL_BODY`.

## C2 — add verified visibility data

C2 adds only WS31 `546d2ab62cd46a97f3385ebcddbe0c775a02c2eb`. Both current authority workflows are GREEN.

The exact catalog says Moradon has 31 NPC templates / 39 NPC spawn groups / declared population 43, with all 39 groups still terrain-Y dependent. It also carries the 10-template / 20-row / 135-population WS25 Moradon monster slice and explicitly records that source K_NPCPOS has no Y column.

Therefore C2 stops at `WORLD_TERRAIN_HEIGHT_AUTHORITY`. WS50 does not implement or fake this owner.

## C3 — add verified attackable mobs

C3 adds only WS25 `a42b489e1a17d7c2889cfd92909ddd45c65e825e`.

The mob domain is real/source-backed and has deterministic region visibility hooks. It still needs authoritative terrain Y to initialize real positions. Separately, WS11 states that WS25 mob events reuse verified world/combat packet families but there is no complete client encoder catalog for every mob lifecycle event. WS14 exposes a `bootstrapPort.buildMobBootstrap` boundary but does not invent the encoder.

Therefore **domain-level mob readiness is not the same as browser-wire readiness**.

## Capability gate — C3

| Capability | DOMAIN_READY | CONTRACT_READY | PROTOCOL_READY | COMPOSITION_READY | BROWSER_PROVEN |
|---|---:|---:|---:|---:|---:|
| authenticated session / world lifecycle | YES | YES | YES | YES | NO |
| authoritative world position | YES | YES | YES | YES | NO |
| NPC nearby lookup | YES | YES | YES | NO | NO |
| NPC detail/bootstrap | YES | YES | YES | NO | NO |
| mob population/bootstrap | YES | YES | NO | NO | NO |
| region membership/visibility | YES | YES | NO | NO | NO |
| disconnect cleanup | YES | YES | YES | YES | NO |

## Blocking capabilities

1. `WORLD_TERRAIN_HEIGHT_AUTHORITY` — production Moradon terrain + shape-height resolver is absent. WS16 and WS25 both fail closed rather than inventing Y.
2. `NPC_REGION_BODY_AUTHORITY` — WS11 current authority still marks `WIZ_NPC_REGION (0x1C)` as `PARTIAL_BODY`; non-empty live NPC region wire output cannot be promoted by guess.
3. `MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY` — exact browser-ready mob bootstrap/lifecycle encoders are not fully frozen. WS14 has only the integration port.

## CI contract

The WS50 visibility-provider-set job:

- validates immutable manifest schema/invariants and content hashes;
- verifies every exact/tested commit exists and tested SHA is an ancestor of its status-closing exact SHA when different;
- reports branch drift without mutating or upgrading a set;
- materializes C1, C2 and C3 from their exact manifest SHAs;
- reruns provider contract/composition tests at those exact sets;
- checks WS31 terrain-Y unknowns and WS11 protocol UNKNOWN/PARTIAL gates as expected blocking evidence;
- uploads one machine-readable receipt per candidate.

A GREEN WS50 CI means **the set is immutable and the expected composition/blockers were reproduced**. It does not mean C3 is browser-ready.

## Promotion rule

`last-accepted.json` remains B0. `current-candidate.json` points to C3. A future provider branch advance creates a new child set; it never edits B0/C1/C2/C3 and never changes an in-flight candidate.
