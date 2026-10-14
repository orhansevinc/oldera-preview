WS03

# STATUS — production gameplay session coordinator

State: **PASS / INTEGRATION-READY**
Branch: `ws03-ko1298-session`
CI-tested implementation/composition head: `6fdcfff60501ea776db4205fa79f68e7d997c4d6`
Canonical verification workflow: `WS03 KO1298 Session`
Canonical GREEN run: **#6** / run id `38560508370`

## Final provider snapshot tested by composed contracts

- WS14 `ws14-world-session`: `c1a1d454285db02c6de0c087a2d65434bfb4593b`
- WS15 `ws15-movement-sync`: `ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d`
- WS16 `ws16-npc-world`: `234657c1264ead6b8828425ae9e7fcdca0cca5c8`
- WS45 `ws45-session-ownership`: `4a66338743553c2781c68ca84b866ff4e999c14e`

The composed-contract workflow now resolves each provider branch HEAD at run start, records the exact immutable SHA in `artifacts/ws03/resolved-providers.json`, materializes those exact service trees read-only, executes the real composition test, and uploads the resolved dependency report. `workstreams/ws03/DEPENDENCY_MANIFEST.json` retains the last-tested exact SHAs as the human/repository baseline; provider drift is reported and tested rather than failing only because a branch advanced.

Run #6 artifact: `ws03-resolved-providers-6`, artifact id `11891788779`, digest `sha256:5090991a6d554138b0c3c6a966eeb526095d405822176c7179dd4b48585533e2`.

## Result

The existing production gameplay-session coordinator remains the canonical implementation:

- FSM: `CONNECTED -> AUTHENTICATED -> CHARACTER_SELECTED -> WORLD_LOADING -> WORLD_READY -> DISCONNECTING -> CLOSED`;
- WS14 world routing;
- WS15 movement/rotation routing;
- WS16 NPC routing;
- WS17 inventory trusted port;
- WS19 combat trusted port;
- WS22 economy trusted port;
- WS25/26/27 outbound event boundary;
- WS45 duplicate-session ownership boundary;
- deterministic cleanup;
- ordered async packet dispatch/backpressure;
- safe packet metadata logging.

This closure task did not copy provider product logic into WS03. Provider services continue to be consumed through their public contracts.

## CI / test evidence

Run #6 (`38560508370`) is fully GREEN:

- normal `test` job `115840131210`: **SUCCESS**;
- syntax check: **SUCCESS**;
- WS03 regression/production-session suite: **37/37 PASS**;
- `composed-contracts` job `115840131643`: **SUCCESS**;
- live provider HEAD resolution: **SUCCESS**;
- exact provider read-only materialization: **SUCCESS**;
- real downstream contract composition: **1/1 PASS**;
- resolved dependency artifact upload: **SUCCESS**.

The 37-test suite continues to cover auth, version 1298, nation, character list/create/select, WS14 handoff, GAMESTART/MYINFO/WORLD_READY, movement, NPC, duplicate-session ownership, deterministic disconnect, queue ordering, malformed/wrong-state handling, downstream failures, races and backpressure.

The real composition test additionally exercises the current provider code for:

- WS14 selected-character bootstrap and current generic zone-transition surface;
- WS15 registration, WORLD_READY movement, move, rotate, transition freeze/reset and disconnect;
- WS16 current fail-closed interaction contract using an injected policy rather than inventing an interaction-distance constant;
- WS45 account ownership acquisition/release;
- real WS14 disconnect cleanup removing the world session;
- guarded `0x1D WIZ_REQ_NPCIN` default ownership remaining with WS14.

## Resolved

1. **Stale provider SHA CI failure — RESOLVED.** Run #5 failed before composition because the workflow asserted obsolete WS14/WS15/WS16 SHAs. The workflow now resolves live provider HEADs, preserves exact tested SHA evidence and no longer breaks solely because a provider branch advances.
2. **WS14 public disconnect cleanup — RESOLVED.** Current WS14 exposes `disconnect(socketId, reason)`. WS03 now binds that exact contract, and the real composition test verifies WS14 session cleanup on WS03 disconnect.
3. **WS16 contract drift — RESOLVED for composition.** Current WS16 requires a verified interaction policy/range and fails closed otherwise. The composition test injects a policy explicitly; WS03 does not invent the unverified 1298 distance constant.

## Remaining blockers / guarded boundaries

1. **`0x1D WIZ_REQ_NPCIN` ownership collision — BLOCKED / GUARDED.** Current WS14 handles `0x1D` in its world bootstrap/detail path and current WS16 also declares `0x1D`. There is still no source-backed central single-owner decision. WS03 therefore keeps the guarded default route to WS14; the composed test asserts WS16 is not silently called for the default `0x1D` route.
2. **WS17/WS19/WS22 inbound packet opcode/payload binding — BLOCKED ON VERIFIED EVIDENCE.** Trusted domain ports are ready, but WS03 will not guess 1298 packet numbers or payloads.
3. **WS25/WS26/WS27 event-to-client packet encoding — BLOCKED ON VERIFIED ENCODERS.** Outbound event delivery boundary exists; no fabricated client opcode/encoder is introduced.
4. **Fresh external public staging proof for this hardened WS03 line — FOLLOW-UP, not a composed-contract blocker.** Canonical genuine browser Moradon evidence remains WS10 run #26 (`38505039290`). A later WS50/WS09 promotion can provide a new public WSS proof for the final WS03 line.

## Regression authority

Canonical genuine browser Moradon gate remains WS10 run **#26** / `38505039290` (`MORADON E2E: PASS`). The WS03 changes in this closure are limited to dependency/composition verification plus the exact WS14 disconnect contract binding; no guessed gameplay opcode, fake provider implementation or synthetic replacement for the real provider composition was added.

## Integration readiness

**YES — WS03 is integration-ready for the contracts proven above.**

The remaining guarded items are explicit cross-workstream protocol/encoder ownership gaps; they do not invalidate the now-GREEN WS03 session coordinator or its current WS14/WS15/WS16/WS45 composition.
