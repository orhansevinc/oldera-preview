# WS50 STATUS — immutable Moradon visibility provider-set

State: **C4 CANDIDATE BLOCKED / TWO C3 AUTHORITIES CLOSED**

Branch: `ws50-integration-rehearsal`

## Parent and current candidate

- Parent: `WS50-C3@sha256:a9c808898bd1cb9f3cadfb44ddbabadaf34448f9aef0a4990ca91958053458aa`
- Child: `WS50-C4@sha256:9ab09b5c0e819b6379a3a9152f1e7eafd50df9eeeb3db8946638fd95008f3049`
- Last accepted browser baseline remains `WS50-B0@sha256:57bf3e37dd4406380e35d042d3336b9bd2f9a6295ea91be7e8b835e7c94e8fda`.

C3 is unchanged. C4 changes exactly four provider pins captured once at task start:

- WS11 `9ad710e... -> 944b6ff9b6329af29f1048a74aa6e14fca141639`
- WS14 `c1a1d45... -> 9b82adefb05a3cca32f430e25f8a1d9109db93b2`
- WS16 `234657c... -> 5ed48ff32187000312652838674388df52fc3fb7`
- WS25 `a42b489... -> a334f54f9a6bd3ac416bd099cc48060f88a7e7fd`

WS03, WS15, WS31, browser baseline, runtime build identity and client artifact remain exactly C3-pinned.

## C3 blocker closure on C4

| Historical C3 blocker | C4 state | Evidence |
|---|---|---|
| `WORLD_TERRAIN_HEIGHT_AUTHORITY` | **CLOSED** | exact WS14 Moradon SMD authority is consumed by exact WS16 and WS25 real materialization tests in the C4 receipt |
| `NPC_REGION_BODY_AUTHORITY` | **CLOSED** | exact WS11 profile + validator + golden `0x1C/0x1D/0x0A` fixtures |
| `MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY` | **OPEN** | blocked earlier by missing WS25 integer runtime/network identity |

## Exact first blocker

`MOB_RUNTIME_NETWORK_IDENTITY_AUTHORITY`

Pinned WS14 requires every nearby mob to expose an integer `instanceId`, `nid`, or `id`. Pinned WS25 still exposes its source/runtime domain identity as the string `groupId/spawnId` and its `snapshotMob()` has no integer `runtimeId` / `instanceId`.

WS50 does not allocate or guess that identity. Therefore the exact composed flow stops fail-closed during `GAMESTART` loading before a combined `WIZ_NPC_REGION (0x1C)` can be emitted.

Provider preflight can still prove:

- real WS14 SMD -> WS16 authoritative NPC materialization;
- real WS14 SMD -> WS25 authoritative 135-slot mob materialization;
- WS11 visibility golden packet authority parity.

The downstream combined `0x1C -> 0x1D -> 0x0A -> WORLD_READY -> cleanup` path is **NOT RUN after the first blocker**, rather than fake-passed.

## Readiness

- `DOMAIN_READY = READY`
- `CONTRACT_READY = BLOCKED`
- `PROTOCOL_READY = READY`
- `COMPOSITION_READY = BLOCKED`
- `BROWSER_READY = BLOCKED`
- `WS49 READY = false`
- `WS10 READY = false`

`BROWSER_READY = NEEDS_WS10` is reserved for a future candidate whose contract and composition gates are already green.

## Files

- `release/sets/ws50/C4.json`
- `release/sets/ws50/current-candidate.json`
- `integration-rehearsal/visibility-evidence-receipt.json`
- `integration-rehearsal/VISIBILITY_CANDIDATE_REPORT.md`
- `tools/ws50_integration/visibility_candidate.py`
- `.github/workflows/ws50-provider-sets.yml`

## Rule

Provider drift is observation only. C4 never re-resolves WS11/WS14/WS16/WS25 after the task-start snapshot. Any later provider advance requires a new child candidate; C3 and C4 stay immutable.
