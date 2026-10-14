# WS39 STATUS — Moradon NPC/MOB Visibility Coordination Pilot

DURUM: **PILOT TOOLING READY / PRODUCT ACCEPTANCE WAITING FOR WS50 PROVIDER-SET**

WS39 remains `ws39-contract-compatibility`. The previous broad 16-boundary compatibility registry remains intact; this change adds a separate minimum coordination pilot under `contracts/pilot-moradon-visibility/**` and does not change product code.

## Pilot milestone

`MORADON NPC/MOB VISIBILITY`

Pilot provider chain: `WS03 -> WS14 -> WS15 -> WS16 -> WS25`.
Authority dependencies: WS11 protocol and WS31 data.

## Delivered

- machine-readable pilot ownership registry with branch, ownership paths, handoff location, provides/consumes and authority requirements;
- source HANDOFF manifest separated from automation-produced CI receipt identity;
- capability catalog derived from existing provider exports/behavior, with semantic version and content fingerprint separated;
- WS11/WS31 represented as protocol/data authorities rather than ordinary runtime providers;
- one-source `BLOCKED_BY_CONTRACT` records with generated owner inbox views;
- WS16 dependency discovery that returns direct contracts, authority requirements, accepted/candidate provider-set identity and open requests;
- exact pilot impact analysis for capability changes;
- ACCEPTED and CANDIDATE modeled independently and fail-closed;
- minimal shared visibility types only.

## Provider-set status

WS50 is the provider-set authority. At the observed WS50 state there is no immutable provider-set receipt covering the full visibility chain and both authorities. Therefore WS39 deliberately leaves both ACCEPTED and CANDIDATE unavailable and does not substitute latest branch HEADs.

## Blocker routing

Canonical blocker records live only in `contracts/pilot-moradon-visibility/blockers.json`. STATUS and generated inbox output do not maintain duplicate blocker bodies.

## Verification

Run:

```bash
node --test contract-tests/*.test.cjs
node contracts/pilot-moradon-visibility/tooling.cjs dependencies WS16
node contracts/pilot-moradon-visibility/tooling.cjs impact npc.nearby
```

Success is measured by whether WS16 can discover the required world/movement/protocol/data dependencies without user mediation, and whether a WS16 capability change produces exact affected pilot consumers/scenarios. Manifest count across all 50 workstreams is not a success metric.

## Boundary

No gameplay/product implementation, provider branch, database/client/admin/site code or `main` merge is part of this change.
