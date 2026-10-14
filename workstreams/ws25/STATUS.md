WS25

# Status

- Workstream: `WS25`
- Branch: `ws25-mob-ai`
- State: `MORADON MOB VISIBILITY PROVIDER READY`
- Scope: verified Moradon mob population + authoritative WS14 height + shared runtime identity + exact WS11 semantic visibility surface

## Result

WS25 now exposes the real Moradon mob population to the WS14 world/bootstrap boundary without encoding protocol bytes.

The provider keeps source identity and browser/runtime identity separate:

- source identity remains `templateId`, `groupId`, `spawnId`, `sourceRef` and the stable string `id`;
- browser/runtime identity is an integer `runtimeId == instanceId == nid`;
- runtime IDs are claimed once through an injected shared `runtimeIds.claim(...)` port;
- WS25 does not own a second independent global allocator;
- runtime IDs are checked against the current WS16/WIZ_NPC signed-16 namespace convention (`10000 <= id < 30000`, and `id <= 32767`);
- duplicate IDs returned by the shared allocator fail closed inside WS25;
- the same logical source slot retains the same runtime ID across corpse/despawn/respawn within the service lifecycle.

The pinned OpenKO 1298 AI server creates NPC/monster serials in stable source-load order and reuses the same entity serial across respawn. WS25 therefore claims identity once at materialization rather than reallocating on respawn. Process-restart reproducibility remains the responsibility of the shared namespace owner, with WS25 providing stable source claim order and stable source identity.

## Collision policy

Current WS16 has an internal NPC band allocator but no cross-domain global allocator. WS25 therefore consumes an injectable shared namespace port instead of duplicating WS16 allocation logic.

The claim request carries:

- namespace `KO1298_NPC`;
- kind `mob`;
- zone ID;
- source identity;
- template/group/spawn IDs;
- source provenance.

The shared owner must reserve/claim NPC and mob IDs from the same namespace. WS25 independently rejects duplicate mob claims and out-of-band/signed-16-invalid results.

## Exact detail semantics

`detailSnapshot()` produces packet-ready semantics only; it does not serialize bytes.

For real Moradon monsters the record exposes:

- `runtime_id`;
- `template_resource_id` / `pid`;
- `npc_type`;
- `selling_group`;
- `scale`;
- `weapon_1` / `weapon_2`;
- `name`;
- `group_nation`;
- `level`;
- authoritative `x/y/z`;
- `state_gate_open`;
- `object_type`;
- `idk0` / `idk1`;
- `direction`.

Static monster fields come from pinned OpenKO-db K_MONSTER rows for the 10 verified Moradon templates. `npc_type=0`, normal-object state, AI gate state and the sender `idk0/idk1=0` semantics come from pinned OpenKO server sender/AI semantics. K_NPCPOS supplies direction and spawn source identity. WS14 supplies authoritative terrain/shape Y.

The WS11 golden monster fixture is used as exact layout/semantic-family authority only. Its documented representative values are not copied into production data. In particular the golden representative `pid=750`, `scale=100`, `y=0`, `gate=1` do not replace the real Moradon provider values such as Worm `pid=700`, `scale=120` and WS14 authoritative Y / AI normal-monster gate state.

## Public visibility surface

`MobService` now exposes:

- `getNearby({ zoneId, x, z })` using the current 48-unit, 3x3 region convention;
- `visibilitySnapshot(...)`;
- `detailSnapshot(...)`;
- semantic visibility events through `visibility.onEvent` with `IN` / `OUT`.

`getNearby()` returns the integer identity aliases required by WS14 (`instanceId`, `runtimeId`, `nid`) and exact semantic aliases matching the current WS14/WS16 consumer vocabulary (`pid`, `npcType`, `sellingGroup`, `size`, `weapon1`, `weapon2`, `name`, `group`, `level`, `x/y/z`, `gateOpen`, `objectType`, `idk0`, `idk1`, `direction`). These are semantic values, not encoded packet bytes.

## IN / OUT lifecycle

WS25 emits semantic visibility events only:

- initial spawn / respawn -> `IN` + semantic detail snapshot;
- corpse despawn -> `OUT` + runtime ID;
- per-player region/visibility entry -> scoped `IN`;
- per-player region/visibility exit -> scoped `OUT`.

No WIZ_NPC packet bytes are produced in WS25. WS11 remains wire authority and WS14/composition remains bootstrap/lifecycle encoder owner.

## Authoritative height regression

The existing production height contract remains unchanged:

1. deterministic X/Z is selected inside the verified K_NPCPOS source rectangle;
2. WS25 calls `terrain.resolveHeight(zoneId, x, z)`;
3. only `status=authoritative` with finite height is accepted;
4. there is no y=0, constant-Y, manual fixture-Y or guessed production fallback;
5. respawn re-resolves authoritative height before re-entering visibility.

Expected Moradon regression remains:

- 10 verified monster templates;
- 20 verified spawn rows/groups;
- 135 real runtime slots;
- 135/135 authoritative WS14 height resolutions.

## Pinned authorities

- WS14 world/height consumer: `ws14-world-session@9b82adefb05a3cca32f430e25f8a1d9109db93b2`
- WS11 visibility profile/golden fixture: `ws11-protocol-lab@944b6ff9b6329af29f1048a74aa6e14fca141639`
- WS31 Moradon catalog authority: `ws31-data-catalog@546d2ab62cd46a97f3385ebcddbe0c775a02c2eb`
- OpenKO server/client source: `Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5`
- OpenKO-db monster/spawn data: `Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab`

## Integration tests / CI gate

The WS25 workflow pins the authorities above and verifies:

- existing deterministic lifecycle/runtime regression;
- real WS14 SMD height resolution for all 135 slots;
- 135 unique signed-16 runtime IDs with a reserved NPC namespace slice;
- source/runtime identity separation;
- exact real Worm detail semantics;
- WS11 golden monster fixture semantic-family parity without importing representative values as production data;
- real current WS14 `WorldSessionService` consumption through `mobPort.getNearby()` and its integer `mobIdentity()` contract;
- stable runtime ID across corpse/despawn/respawn;
- deterministic re-claim under identical shared reservations/source ordering;
- duplicate runtime-ID fail-closed behavior.

`WS50-C3` is immutable and is not changed by this work. This WS25 HEAD is intended for a subsequent provider-set candidate.

## Handoff

```text
requires runtime-id.namespace       -> shared KO1298_NPC allocator owner
requires terrain.height-authority   -> WS14@9b82adefb05a3cca32f430e25f8a1d9109db93b2
requires visibility.protocol        -> WS11@944b6ff9b6329af29f1048a74aa6e14fca141639
requires WS31 monster catalog       -> WS31@546d2ab62cd46a97f3385ebcddbe0c775a02c2eb
provides WS14 mobPort.getNearby     -> integer identity + authoritative XYZ + semantic detail aliases
provides visibility lifecycle       -> semantic IN/OUT only; no packet encoding
```
