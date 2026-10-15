# P2-07 dependency proposal

The coordinator files `coordination/phase2/CHARTER.md`, `OWNERS.json` and `CONTRACTS.md` were absent on `phase2/00-integration` when P2-07 started. This file is therefore the P2-07 proposed contract surface; it does not claim coordinator acceptance.

## Ownership

P2-07 is the only authority for resolved damage/healing, combat HP transition, live->dead transition, skill validation/effects and progression math. It must not own movement coordinates, mob AI/target selection, item/inventory mutation, PvP policy or client UI/assets.

## P2-01 movement contract — `combat.speed-effect.v1`

P2-07 emits `{operationId, characterId, skillId, effectKey, moveSpeedPct, appliedAtMs, expiresAtMs}` only after a verified Type4 effect is accepted. P2-01 remains authoritative for movement validation and effective speed. Expiry/cancel uses the same `effectKey`; P2-07 never writes coordinates or bypasses P2-01 movement checks.

## P2-06 mob contract — `combat.mob-authority.v1`

P2-06 sends an immutable attack intent containing `{operationId, mobRuntimeId, targetRuntimeId, observedAtMs}` plus its authoritative mob combat snapshot. P2-07 resolves hit/miss/damage and returns `{operationId, sourceId, targetId, hitOutcome, damage, absoluteHp, deathTransition, deathSequence}`. P2-06 applies the returned absolute HP through its existing single `applyCombatResult()` surface. P2-06 must not independently calculate combat HP or award progression.

A mob death reward uses a stable event ID derived from the single live->dead transition, e.g. `mob-death:<runtimeId>:<deathSequence>`. Replays with that operation ID must return the existing receipt and must not award XP twice.

## P2-09 PvP contract — `combat.pvp-policy.v1`

P2-07 requires an injected PvP policy before player-vs-player resolution. Required surface: `validateTarget({source,target,zone,skill})`, `resolveRewardPolicy(context)` and `resolveDeathLossPolicy(context)`. Missing policy is fail-closed. P2-07 will not infer hostile zones, nation-point rules or PvP death-loss rules from PvE behavior.

## P2-08 / P2-11 item and atomic-result contract — `combat.result-transaction.v1`

Item/equipment owners provide a combat projection with authoritative `weaponRange`, `attackDelayMs`, item class, weapon attack/elemental fields and armor fields. Skill item consumption is requested as data, never directly mutated by P2-07.

A committed result must have one stable `operationId/requestKey` and a single SERIALIZABLE transaction/receipt boundary covering the applicable progression change and P2-08/11 item/resource mutation. Required mutation envelope:

```text
operationId
characterId
expectedProgressionVersion
expectedItemVersion
hp/resource absolute result or delta
item consumptions[]
progression mutation/reward
result receipt
```

The existing `PgOperationReceiptRepository` / `oldko.persistence_operations` is the replay fence used by P2-07 progression. Cross-domain item + progression commit remains owned by P2-08/11; P2-07 must not create a second inventory transaction authority.

## P2-10 skill visibility/UI contract

P2-10 should consume the P2-07 generated player skill catalog. Visibility is split into independent causes:

- **server eligibility:** exact class/promoted class namespace, level/skill-point requirement, target/moral, resource/HP/item requirement;
- **client data:** the pinned `Skill_Magic_Main_us.tbl.csv` row exists;
- **UI binding:** skill tree/hotkey binding and page logic belongs to P2-10;
- **icon/animation/FX:** binary resource mapping belongs to P2-10/P2-02.

A skill being absent from UI must not be reported as a P2-07 combat-rule failure until the catalog row and eligibility pass.

## Exact P2-10 / P2-02 asset blockers inherited from WS38 evidence

`Slash (101003)` icon is source-verified as `UI/skillicon_03_1010.dxt`. The following exact mappings remain unresolved and must not be guessed:

- `SLASH_ANIMATION_ID_TO_BINARY_UNRESOLVED`: Skill 101003 action `128` / self animation `26` -> exact animation binary filename unresolved.
- `SLASH_SELF_FX_ID_TO_BINARY_UNRESOLVED`: Skill 101003 self FX `2601` -> exact binary filename unresolved.
- `SLASH_TARGET_FX_ID_TO_BINARY_UNRESOLVED`: Skill 101003 target FX `10002` -> exact binary filename unresolved.
- `SHORT_SWORD_RESOURCE_ID_TO_BINARY_UNRESOLVED`: starter item `120010000`, resource `12011000` -> exact model filename unresolved.
- `SHORT_SWORD_ICON_RESOURCE_ID_TO_BINARY_UNRESOLVED`: starter item `120010000`, icon resource `12011000` -> exact icon filename unresolved.

For every non-Slash catalog record, P2-07 only guarantees the skill-table identifiers and generic `WIZ_MAGIC_PROCESS` frame until the exact animation/self-FX/target-FX/icon resource mapping and per-effect result payload are source-backed. Those mappings are P2-10/P2-02 work, not invented P2-07 data.

## Known source-rule gaps kept fail-closed

- Type5+ skill semantics are cataloged by source type code but are not declared executable by the imported WS19 engine unless their server rule is implemented and tested. The pinned server source explicitly identifies Type5 remove-Type3/remove-Type4/resurrection/self-resurrection/remove-bless operations, but P2-07 does not generalize that into unverified Type6/8/9/10 behavior.
- Negative Type3 elemental/magic damage requires an injected verified resistance/magic-damage port.
- PvP physical formulas require P2-09 policy plus verified item/armor projections.
- Client recast metadata is not silently promoted to a server cooldown. A verified server cooldown policy must be injected; otherwise that skill is not advertised as production-ready.
- Area/corpse/undead target enumeration and line-of-sight require P2-04/P2-06 authoritative world queries.
