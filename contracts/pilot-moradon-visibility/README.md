# WS39 — Moradon NPC/MOB Visibility Coordination Pilot

This directory is the minimum coordination pilot for the first playable visibility milestone. It does **not** replace the broad WS39 compatibility registry and it does not change product code.

## Single sources of truth

- `registry.json`: pilot ownership, contract identities, authority relations, scenarios and the minimal shared-type boundary.
- `source-manifests.json`: provider/authority declarations only. Source HEAD/SHA and blocker bodies are deliberately not maintained here.
- `provider-sets.json`: WS39 view pointers to immutable WS50 receipts. ACCEPTED is exactly `WS50-B0`; CANDIDATE is exactly `WS50-C3`.
- `release/sets/ws50/B0.json` and `C3.json`: exact WS50 receipts copied from WS50 commit `15eb5b83bfadb7bb9ad131997730ef5adf0abcc8`; discovery never re-resolves branch HEADs.
- `blockers.json`: the single central routing source for C3 blockers. Owner inboxes are generated views.
- `tooling.cjs`: dependency discovery, impact analysis, immutable provider coordinates, generated owner inbox and validation.

## Immutable-set rule

`WS50-C3` remains historically immutable. Its three blockers remain attached to C3 even when a newer provider branch supplies evidence that could resolve one of them. Such evidence is represented as `RESOLVED_BY_PROVIDER_CANDIDATE` plus the exact provider SHA and stays `NOT_IN_WS50_C3` until WS50 creates a successor candidate.

Current terrain evidence is `WS14@810a58f1bd71037597b896eac32d0139a463d227` with CI run `38576683261`; the current WS14 documentation HEAD is `9b82adefb05a3cca32f430e25f8a1d9109db93b2`.

## Discovery

```bash
node contracts/pilot-moradon-visibility/tooling.cjs dependencies WS16
node contracts/pilot-moradon-visibility/tooling.cjs dependencies WS25
node contracts/pilot-moradon-visibility/tooling.cjs impact terrain.height-authority
node contracts/pilot-moradon-visibility/tooling.cjs inbox WS11
node contracts/pilot-moradon-visibility/tooling.cjs validate-routing
```

Dependency output exposes the accepted/candidate set identity, exact provider SHA, semantic-version + contract fingerprint, protocol/data authority coordinates, provider-candidate resolution evidence and central blockers without asking the user to broker workstream state.

## Blocker routing

The canonical C3 blocker IDs are derived from the immutable `C3.json` receipt and must match `blockers.json` exactly:

- `WORLD_TERRAIN_HEIGHT_AUTHORITY` → WS14. C3 remains blocked; newer WS14 evidence is recorded as provider-candidate resolution only.
- `NPC_REGION_BODY_AUTHORITY` → WS11.
- `MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY` → WS11.

No separate inbox file is maintained.

## Boundary

No gameplay implementation, provider branch, database/client/admin/site code or `main` merge is part of this pilot.
