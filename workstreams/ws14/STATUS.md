WS14

# STATUS — KO 1298 World + Moradon Visibility Composition

DURUM: **MORADON VISIBILITY COMPOSITION READY / CI GREEN**

Branch: `ws14-world-session`
Visibility implementation commit: `1b7a7c0191caade57c00cbab7ab5d2c2ae516fc3`
Visibility CI: Actions run `38598291937`, job `115970599000` — **SUCCESS (54/54)**

## Exact pinned authorities

- WS11 protocol authority: `944b6ff9b6329af29f1048a74aa6e14fca141639`
- WS16 NPC authority: `5ed48ff32187000312652838674388df52fc3fb7`
- WS25 mob visibility authority: `13c9bafe287b250d56b52f19e97a02e7ef18e6e5`
- WS31 data authority: `546d2ab62cd46a97f3385ebcddbe0c775a02c2eb`
- Open-KO Moradon SMD authority: `7d6cf81093e142c928c2ac9510512b2b182178b5`

No provider branch is resolved dynamically inside the acceptance test. The workflow checks out the exact SHAs above.

## Current visibility composition

WS14 now composes the current real WS25 `MobVisibilityService` rather than the stale pre-runtime-ID mob snapshot.

The world/composition boundary owns one shared `KO1298_NPC` signed-i16 runtime namespace:

1. real WS16 materialized NPC runtime IDs are reserved first;
2. WS25 receives the same namespace through its existing `runtimeIds.claim` port;
3. WS25 claims deterministic collision-free mob runtime IDs;
4. no second WS16 allocator or synthetic runtime-ID truth is copied into WS14.

Real composition path under test:

`real Moradon SMD -> WS16 materialized NPCs -> shared runtime namespace -> WS25 MobVisibilityService -> WS14 VisibilityWorldSessionService`

## Acceptance evidence

Run `38598291937` produced:

- authoritative WS16 NPC runtime identities: **37**;
- authoritative WS25 mob runtime identities: **135**;
- cross-domain runtime ID collisions: **0**;
- deterministic source-backed overlap probe: `x=223`, `y=6.694880247116089`, `z=309`;
- nearby real WS16 NPCs in that probe region: **1**;
- nearby real WS25 mobs in that probe region: **54**;
- unified `WIZ_NPC_REGION (0x1C)` IDs emitted: **55**;
- exact `WIZ_REQ_NPCIN (0x1D)` detail recovery for both NPC and mob: PASS;
- NPC and mob `WIZ_NPC_INOUT (0x0A)` IN/OUT: PASS;
- `WORLD_READY`: PASS;
- movement registration regression: PASS;
- disconnect cleanup: PASS.

WS11 independent golden byte parity remains GREEN. Existing multi-zone/world transition, terrain/shape height authority, fail-closed coordinate/Y behavior and 120-session regression remain GREEN.

## Terrain/shape authority retained

`createMoradonHeightResolver()` still consumes the pinned real `moradon_0826.smd`; missing, changed, invalid or out-of-bounds authority fails closed and does not invent Y. Current coverage remains:

- WS16 source-anchored NPC height coverage: **37/37 authoritative**;
- WS25 verified monster rectangle samples: **100/100 authoritative**.

## Boundary

WS14 owns world/session composition, height authority and visibility wire/session integration. It does not own mob AI, NPC catalog/lifecycle, protocol evidence, combat, inventory or client rendering. No synthetic NPC/mob provider is accepted as production visibility evidence.
