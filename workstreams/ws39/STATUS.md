# WS39 STATUS — Moradon NPC/MOB Visibility Coordination Pilot

DURUM: **IMMUTABLE PROVIDER-SET COORDINATION READY / WS50-C3 BLOCKED**

Branch: `ws39-contract-compatibility`

This remains the existing WS39 pilot. Product code and provider branches are unchanged.

## Provider-set view

- ACCEPTED: `WS50-B0@sha256:57bf3e37dd4406380e35d042d3336b9bd2f9a6295ea91be7e8b835e7c94e8fda`
- CANDIDATE: `WS50-C3@sha256:a9c808898bd1cb9f3cadfb44ddbabadaf34448f9aef0a4990ca91958053458aa`
- Canonical WS50 source commit pinned by WS39: `15eb5b83bfadb7bb9ad131997730ef5adf0abcc8`
- No dependency discovery path resolves latest branch HEAD.

## C3 blockers

Canonical blocker bodies are maintained once in `contracts/pilot-moradon-visibility/blockers.json`; the blocker ID set is checked against immutable `release/sets/ws50/C3.json`.

`WORLD_TERRAIN_HEIGHT_AUTHORITY` remains OPEN on immutable C3. New WS14 provider evidence resolves the required authority at implementation commit `810a58f1bd71037597b896eac32d0139a463d227` (CI run `38576683261`, 46/46) and current evidence/documentation HEAD `9b82adefb05a3cca32f430e25f8a1d9109db93b2`. WS39 records this only as `RESOLVED_BY_PROVIDER_CANDIDATE / NOT_IN_WS50_C3`.

`NPC_REGION_BODY_AUTHORITY` and `MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY` are routed to WS11. Owner inbox output is generated from the same central blocker file; no maintained inbox copy exists.

## Discovery

WS16 and WS25 discovery now returns:

- exact B0/C3 set identity;
- exact provider SHA per direct contract;
- semantic version + contract fingerprint;
- WS11 protocol and WS31 data authority dependencies with their set coordinates;
- relevant central blockers;
- provider-candidate resolution evidence where present.

## Impact

`terrain.height-authority` is owned by WS14. Its direct pilot consumers are WS15, WS16 and WS25, and both `moradon.npc-visibility` and `moradon.mob-visibility` scenarios are affected. Because the resolving WS14 implementation SHA is not part of immutable C3, a new WS50 candidate is required before the terrain blocker can be resolved at set level.

## Verification

```bash
node --test contract-tests/*.test.cjs
node contracts/pilot-moradon-visibility/tooling.cjs validate-routing
node contracts/pilot-moradon-visibility/tooling.cjs dependencies WS16
node contracts/pilot-moradon-visibility/tooling.cjs dependencies WS25
node contracts/pilot-moradon-visibility/tooling.cjs impact terrain.height-authority
```

## Boundary

No product/gameplay implementation, provider branch mutation, latest-HEAD composition or `main` merge is part of this change.
