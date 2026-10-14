# WS39 — Moradon NPC/MOB Visibility Coordination Pilot

This directory is the minimum coordination pilot for the first playable visibility milestone. It does **not** replace `coordination/WORKSTREAM_REGISTRY.md` or the existing broad WS39 compatibility registry.

## Single sources of truth

- `registry.json`: pilot ownership, real capability surfaces, authority relations, scenarios and shared type boundary.
- `source-manifests.json`: provider/authority declarations. Source HEAD/SHA is deliberately forbidden here.
- `provider-sets.json`: ACCEPTED and CANDIDATE identities. WS50 is the only authority allowed to populate an immutable provider-set receipt.
- `blockers.json`: `BLOCKED_BY_CONTRACT` records. Owner inboxes are generated views; they are not separate maintained records.
- `schema/`: minimal machine-readable schemas for registry, source handoff, CI receipt, blocker and provider-set state.
- `tooling.cjs`: dependency discovery, impact analysis, generated owner inbox and contract fingerprint functions.

A CI receipt is intentionally separate from a source manifest. It records the exact implementation SHA, provider-set ID, resolved dependencies, contract fingerprints, test/run IDs, artifacts and blockers after automation resolves the immutable composition.

## Discovery

```bash
node contracts/pilot-moradon-visibility/tooling.cjs dependencies WS16
node contracts/pilot-moradon-visibility/tooling.cjs impact npc.nearby
node contracts/pilot-moradon-visibility/tooling.cjs inbox UNASSIGNED
```

The WS16 discovery answer includes direct world/movement capabilities, WS11 protocol requirements, WS31 data requirements, ACCEPTED/CANDIDATE provider-set identities, and open contract requests without reading all workstream status files.

## WS50 rule

WS39 does not infer a provider-set from current branch HEADs. If WS50 has not published an immutable visibility provider-set receipt covering WS03/WS14/WS15/WS16/WS25 plus the WS11/WS31 authority snapshot, both ACCEPTED and CANDIDATE remain `UNAVAILABLE`.

## Evidence-derived status

The pilot is structurally ready when schemas/tests/discovery/impact pass. Product compatibility is not declared accepted until WS50 supplies the immutable provider-set receipt and the milestone blockers attached to that set are satisfied by evidence.
