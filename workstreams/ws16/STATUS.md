WS16

# STATUS

DURUM: MORADON_NPC_HEIGHT_AUTHORITY_READY — WS16 consumes WS14's public `resolveHeight(zoneId, x, z)` authority and fails closed before NPC visibility if the result is not authoritative.

## Dependency snapshot

- `terrain.height-authority`: WS14 `ws14-world-session@9b82adefb05a3cca32f430e25f8a1d9109db93b2`.
- `protocol NPC visibility profile`: WS11 `ws11-protocol-lab@944b6ff9b6329af29f1048a74aa6e14fca141639` (`WIZ_NPC_REGION` region-ID list verified; `WIZ_REQ_NPCIN` detail recovery collision resolved; `WIZ_NPC_INOUT` visibility verified).
- `data WS31 NPC catalog`: WS31 `ws31-data-catalog@546d2ab62cd46a97f3385ebcddbe0c775a02c2eb`.
- WS50-C3 remains immutable historical evidence. Its terrain/protocol blocker fields were produced against older provider SHAs; WS16 does not edit C3. A successor provider-set must pin this WS16 commit plus the resolved WS14/WS11 authorities.

## Verified Moradon population

- Patch/data target: KO 1298 / Moradon zone 21.
- Source pin: `Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab`.
- `K_NPC` verified templates: **31 unique SIDs**.
- `K_NPCPOS` verified static spawn groups: **39**.
- Source-declared `NumNPC` population: **43**.
- Source-verifiable X/Z path anchors: **37**.
- `16082` and `16083` remain catalog-only because their source rows have rectangles but no source path point; WS16 does not invent placement.
- `NumNPC > 1` groups retain source population metadata; WS16 does not clone guessed individual positions.

## Authoritative height contract

`K_NPCPOS` has no Y. WS16 no longer implements terrain/shape selection logic and no longer accepts `terrainY`, constant Y, manual fixture Y or guessed Y as a production materialization input.

`materializeNpcPopulation(document, { heightAuthority })` requires a dependency with:

```text
resolveHeight(zoneId, x, z) -> { status, height, ... }
```

Only `status === "authoritative"` plus a finite `height` is accepted. Missing, invalid, unresolved or thrown authority results raise `NpcHeightAuthorityError` before runtime IDs are allocated or NPCs are inserted into `NpcWorld`.

Every runtime record carries:

- `templateSid`: source template identity;
- `sourceInstanceKey` / `identity.instanceKey`: source spawn-group identity;
- `instanceId` / `runtimeId`: allocated runtime/network identity;
- authoritative top-level `x/y/z`;
- immutable `position { zoneId, x, y, z }`;
- `positionAuthority { dependency: terrain.height-authority, status: authoritative, ... }`.

`NpcWorld` independently rejects records without authoritative position metadata, so a finite but untrusted Y cannot enter nearby/region/detail visibility. Runtime `setState()` cannot replace identity or X/Y/Z.

## Region / detail semantic surface

- Existing packet encoders were not expanded or rewritten in this change.
- `detailSnapshot(instanceId)`, `nearbySnapshot(zoneId,x,z)` and `regionDeltaSnapshot(...)` expose packet-ready semantic NPC records with authoritative X/Y/Z and separated identities.
- Existing `nearby()` / `regionDelta()` records are also authority-gated because only authoritative records can enter `NpcWorld`.

## Real integration acceptance

`.github/workflows/ws16-npc.yml` pins and checks out:

- WS14 `9b82adefb05a3cca32f430e25f8a1d9109db93b2` public world module;
- Open-KO/KnightOnline `7d6cf81093e142c928c2ac9510512b2b182178b5` `moradon_0826.smd`;
- WS31 `546d2ab62cd46a97f3385ebcddbe0c775a02c2eb` NPC catalog.

The integration test calls the real WS14 `createMoradonHeightResolver()` and then WS16 materialization across every source-backed Moradon X/Z anchor. It verifies authoritative finite Y, WS31 Caspy identity/provenance cross-check, and authoritative detail/nearby snapshots.

## Remaining non-height unknowns

1. Two catalogued spawn groups (`16082`, `16083`) have no source path anchor; their X/Z placement remains unresolved and they produce no visibility.
2. Exact KO 1298 server interaction-distance threshold remains outside this task; production interaction still requires injected verified range/policy.
3. Quest/gate/special-store business semantics remain owned by their respective domains and stay fail-closed where unverified.
4. `WIZ_TARGET_HP` broad S2C authority remains partial in WS11 but is non-blocking for NPC entity visibility.

## Handoff

requires:
- `terrain.height-authority` — WS14 public resolver, exact provider pin required.
- `protocol NPC visibility profile` — WS11 authority for region IDs, detail recovery and NPC IN/OUT; WS16 does not invent packet layouts.
- `data WS31 NPC catalog` — verified 1298 NPC identity/data provenance.

WS14/WS50 composition should load the WS16 catalog through `materializeNpcPopulation()` before `NpcWorld.reloadZone()`. Any non-authoritative height result aborts materialization; no partial visibility set is published.
