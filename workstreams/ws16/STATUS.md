# WS16

## Status

State: implementation complete; integration is conditional on the world-session owner providing terrain height and wiring three packet opcodes into the existing game socket dispatcher.

### Delivered

- NPC template + NPC instance data split.
- Verified Moradon zone id 21 seed.
- Verified Caspy template (`sSid 13001`, `sPid 22000`) and Moradon position/path source.
- `WIZ_NPC_INOUT` spawn/despawn serialization.
- `WIZ_NPC_REGION` nearby id packet.
- `WIZ_REQ_NPCIN` request parsing and response serialization.
- `WIZ_NPC_EVENT` interaction request parsing/routing.
- Merchant callback boundary.
- Quest callback boundary.
- `WIZ_TARGET_HP` request parse + static target HP response.
- 48-unit region partition and 3x3 nearby lookup.
- Runtime NPC id allocation in the verified NPC band.
- Y-coordinate safety: unresolved real terrain height is rejected rather than guessed.
- CI workflow scoped to WS16 paths.

### Tests

Local Node 20-compatible test run: **11/11 PASS**.

Coverage includes spawn record byte layout, despawn, region ids, detail request/response, interaction packet, target HP packet, verified Moradon seed, terrain-Y rejection, nearby region logic, merchant routing and wrong-zone rejection.

### Integration condition

Live rendering still requires WS14/world-session integration to provide the real zone terrain Y and send/receive the WS16 packets on the authenticated game socket. This condition does not require a WS16 code change unless the integration owner exposes a different adapter signature.

### No forbidden changes

No client, world-session implementation, movement implementation, combat, inventory, admin/site, DB migration or main merge changes are included.
