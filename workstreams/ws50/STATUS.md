# WS50 STATUS — immutable Moradon visibility provider-set

State: **CANDIDATE BLOCKED / GOVERNANCE READY**

Branch: `ws50-integration-rehearsal`

## Last accepted set

`WS50-B0` — `WS50-B0@sha256:57bf3e37dd4406380e35d042d3336b9bd2f9a6295ea91be7e8b835e7c94e8fda`

Canonical browser proof remains WS10 run `38505039290` / head `f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41` with client artifact digest `sha256:ff9fb679ad1b3caa184ad098cff81cfb5469b0698d5e5f3b76ef4fab2ea775b3`.

## Current candidate

`WS50-C3` — `WS50-C3@sha256:a9c808898bd1cb9f3cadfb44ddbabadaf34448f9aef0a4990ca91958053458aa`

Parent ladder: `WS50-B0 -> WS50-C1 -> WS50-C2 -> WS50-C3`.

C3 pins current WS03/11/14/15/16/25/31 exact SHAs once and keeps B0 browser/runtime providers unchanged. Status-only source commits keep a separate `tested_implementation_sha`.

## Visibility state

- session/world lifecycle: composition-ready
- authoritative movement/position: composition-ready
- verified NPC X/Z population: domain/data-ready
- verified attackable Moradon mobs: domain/data-ready
- browser-ready live visibility: **NO**

Blocking capabilities:

- `WORLD_TERRAIN_HEIGHT_AUTHORITY`
- `NPC_REGION_BODY_AUTHORITY`
- `MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY`

WS50 does not implement any of these by guessing or by fake adapter.

## Files

- `release/sets/ws50/provider-set.schema.json`
- `release/sets/ws50/B0.json`
- `release/sets/ws50/C1.json`
- `release/sets/ws50/C2.json`
- `release/sets/ws50/C3.json`
- `release/sets/ws50/latest-branch-snapshot.json`
- `release/sets/ws50/last-accepted.json`
- `release/sets/ws50/current-candidate.json`
- `integration-rehearsal/VISIBILITY_CANDIDATE_REPORT.md`
- `integration-rehearsal/visibility-evidence-receipt.json`

## Rule

Provider branch drift is observation only. It never silently upgrades an immutable set. Any new provider SHA requires a new child candidate.
