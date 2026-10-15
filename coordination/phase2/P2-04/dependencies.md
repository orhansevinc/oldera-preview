# P2-04 dependency proposal

The base commit `50ecabec15bd358d222a01891ca31359f3a928b0` does not contain `coordination/phase2/CHARTER.md`, `OWNERS.json`, or `CONTRACTS.md`. This file is a proposal only and does not claim coordinator authority.

## P2-02 loading/assets
P2-04 requires the exact source-pinned client zone files listed in `services/ko1298-world/data/world-scope.1298.json` and the exact server SMDs below to be materialized/mounted without variant substitution: `karus_0730.smd`, `elmorad_1220.smd`, `k_eslant.smd`, `e_eslant.smd`, `moradon_0826.smd`, `freezone_1217.smd`. P2-02 should report the runtime path and content identity. Missing files must stay missing/fail-closed rather than falling back to similarly named maps.

## P2-01 movement / P2-07 combat
Use WS14's existing world-state gate. Movement/combat are permitted only for the current transition generation in `WORLD_READY`; `REQUESTED/AUTHORIZED/LEAVING_SOURCE/TELEPORT/LOADING/LOADED` must reject or queue according to the owning service contract. P2-04 owns zone membership cleanup and target membership activation; P2-01/P2-07 own their packet/action queues.

## P2-05 NPC / P2-06 mobs
P2-05/P2-06 provide source-backed spawn positions and source identities. Both must use the existing shared `KO1298_NPC` signed-i16 allocator (`createSharedNpcRuntimeIdNamespace`) so NPC and mob runtime IDs cannot collide. P2-04 consumes the resulting entities in one shared zone/AOI world; it does not generate fake per-player populations.

## P2-09 zone rules
P2-09 must provide the authoritative `zonePolicy.canEnter({character, sourceZone, targetZone, reason})` decisions including nation/level/event gates and any source-backed zone-ability values needed by the 1.298 client. P2-04 deliberately leaves non-Moradon zones fail-closed until that contract is supplied.

## Persistence / relog
The authoritative repository must persist the accepted target zone and collision-resolved position only after the existing WS14 zone-change lifecycle reaches the commit point. Reconnect must continue through `restoreAuthoritativeSession`; no Moradon fallback is allowed when persisted state is missing/invalid.
