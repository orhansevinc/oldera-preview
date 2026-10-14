# WS14 — Moradon-specific assumptions catalog

This catalog records what was Moradon-specific in the pre-multi-zone WS14 implementation and how it is handled now.

| Previous assumption | Multi-zone treatment |
|---|---|
| `zoneId` always `21` | `ZoneDefinition.zoneId`; legacy `beginSelectedCharacter()` still deliberately targets 21 |
| spawn always `(312,402,0)` | per-zone `ZoneDefinition.spawn`; Moradon value retained exactly |
| map/terrain implicit | `ZoneDefinition.mapRef`; WS14 does not load/render terrain |
| neutral zone ability hardcoded | Moradon keeps exact `buildMoradonZoneAbility`; other zones require verified data |
| character select always emits Moradon | generic `beginWorldEntry` selects a verified production-ready zone |
| zone change always changes to Moradon | `requestZoneChange` accepts any production-ready `targetZoneId` |
| session coordinates overwritten before target load | source snapshot and pending target are separate until client `LOADING` |
| no source membership lifecycle | source membership is deterministically removed before target membership can be added |
| no target runtime boundary | one `ZoneRuntime` per definition |
| nearby users/NPCs only | ordered USERS -> NPCS -> MOBS bootstrap hooks |
| no stale-region contract | `clientEntityCleanup` + source `USER_OUT` broadcast contract |
| no movement baseline reset | WS15-compatible `movementPort.teleport` at accepted target `LOADING` |
| no region subscription lifecycle | explicit subscribe/unsubscribe port |
| no reconnect placement | repository-authoritative reconnect port, no Moradon fallback |
| no rollback | transition transaction restores source state/membership/subscription/baseline |
| no concurrent request policy | second active request is rejected |
| `WORLD_READY` only informal | movement/combat capability is false until exact final `LOADED` |
| warp/teleport/respawn conflated | explicit transition reason enum + `planWorldReposition` |
| no audit history | ordered per-session transition audit events |

The objective is not to make Moradon generic by weakening its known behavior; it is to keep Moradon as an exact regression fixture while moving zone-dependent facts into verified data/contracts.
