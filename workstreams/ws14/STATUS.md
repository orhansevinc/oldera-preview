WS14

# Status

- Workstream: WS14
- Branch: `ws14-world-session`
- Base: `main`
- Scope: server-side KO 1298 selected-character -> Moradon world-session initialization
- Implementation: complete within WS14 ownership
- Automated tests: PASS (`14/14`)
- Integration: conditional on the WS03 orchestration surface being committed

## Delivered

- `services/ko1298-world/WORLD_SESSION_PROTOCOL.md`
- protocol-evidenced packet serializers/parsers
- two-phase 1298 GAMESTART state machine
- Moradon world initialization (zone 21, 312/402/0)
- 1298 MYINFO and Moradon zone-ability serialization
- surrounding user/NPC ID bootstrap and detail replies
- 1298 zone-change TELEPORT/LOADING/LOADED state machine
- world-ready state and USER_REGENE broadcast output
- mock repository
- tests under `tests/ko1298-world/**`
- CI workflow `.github/workflows/ws14-world.yml`
- integration handoff `workstreams/ws14/INTEGRATION_PATCH.md`

## Explicitly not implemented

Combat, movement, inventory mutations, NPC AI, gateway transport, DB migrations, client changes, WS03 changes, WS05 changes, admin/site changes, main merge and force push.

## Verification basis

Primary packet evidence is pinned to Open-KO/KnightOnline commit `7d6cf81093e142c928c2ac9510512b2b182178b5`, whose client source declares `CURRENT_VERSION = 1298`. Moradon zone/spawn data is pinned to Open-KO/OpenKO-db commit `bec619466938d278339c30e5b1a4bff3c9413bab`.

The earlier legacy 1097-style GAMESTART assumption was removed during verification and has a regression test proving that obsolete packet shape is rejected.
