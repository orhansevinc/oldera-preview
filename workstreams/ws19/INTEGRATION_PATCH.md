# WS19 Integration Patch

## Public module

Use `services/ko1298-combat/index.js`.

Important exports:

- `CombatService`
- `OpenKo1298NormalAttackDamagePolicy`
- `OpenKo1298PvpPhysicalSkillDamagePolicy`
- `SkillService`
- `Verified1298SkillTableAdapter`
- `createGoldenSkillTable`
- `createAuthoritativeWorldPort`
- `createWs17EquipmentCombatPort`
- `createWs25MobCombatPort`
- `createPlayerCombatPort`
- `decodeMagicProcessPayload`
- `encodeMagicProcessPayload`
- `toClientSkillResult`

## WS15 world integration

Provide a stable authoritative position snapshot:

```js
const worldPort = createAuthoritativeWorldPort({
  getSnapshot(id) {
    // { zoneId, position: { x, y, z } }
  },
  distance(a, b) {
    // canonical WS15/world distance contract
  }
});
```

Do not pass client packet distance as authority.

## WS17 equipment integration

```js
const equipmentPort = createWs17EquipmentCombatPort({
  getEquipmentSnapshot(entityId) {
    return {
      weaponRange,
      attackDelayMs,
      leftItemClass,
      rightItemClass,
      // optional verified item-domain combat values
    };
  }
});
```

`attackDelayMs` must already be authoritative. WS19 intentionally does not guess the conversion from a raw item delay field.

For normal attack / physical skill item semantics, inject verified adapters into the damage policies. Do not copy synthetic item constants into WS19.

## WS25 mob integration

```js
const mobCombat = createWs25MobCombatPort({ combatService, getEntity });
const out = mobCombat.normalAttack({ mobId, targetId, requestKey });

// out.absoluteTargetHp is authoritative WS19 HP.
// out.deathEvent is the one WS19 live->dead transition.
```

WS25 remains owner of target selection/AI. WS19 remains owner of hit/damage/HP/death.

## Player/session integration

```js
const playerCombat = createPlayerCombatPort({
  combatService,
  skillService,
  getEntity
});
```

Ingress must provide a stable packet/request key so duplicate network delivery cannot hit twice.

## Skill data integration

Production data must use `Verified1298SkillTableAdapter` rows parsed from source-backed 1298 tables. `InMemorySkillTableAdapter` is tagged `SYNTHETIC_TEST_ONLY` and must not be presented as production skill data.

Current verified golden source set is documented in `VERIFIED_1298_SKILLS.md`.

## Skill cooldown

Do **not** automatically enforce `clientRecastMs` as server cooldown.

If a verified server policy is available, inject:

```js
const skillService = new SkillService({
  table,
  cooldownPolicy: {
    resolveCooldownMs({ skill, caster, target, context }) {
      return authoritativeMs;
    }
  }
});
```

Without that port, recast remains client metadata and WS19 reports `UNVERIFIED_NOT_ENFORCED`.

## Type1 / Type2 PvP integration

```js
const physicalSkillDamagePort = new OpenKo1298PvpPhysicalSkillDamagePolicy({
  magicDamageAdapter,   // verified GetMagicDamage / item-elemental projection
  weaponArmorAdapter   // verified WS17 target armor projection
});
```

This policy is source-backed for the PvP `Ebenezer/User.cpp::GetDamage()` path only. Do not reuse it for NPC/mob skills unless that equivalence is separately proven.

## Type3 magic damage integration

Negative Type3 HP damage requires a `magicDamagePort.resolveType3()` implementation so elemental/resistance behavior is not guessed. Positive HP healing and the source two-second duration scheduler are implemented directly.

## Type4 stat integration

WS19 stores exact Type4 modifier state and calls `effectPort.onType4Applied/onType4Expired`. The stat/equipment owner may project those modifiers. This avoids duplicating derived-stat ownership inside the skill service.

## Death / progression handoff

Consume WS19 `DEATH` events in WS27. WS19 intentionally does not award XP, perform respawn, or persist progression.

## Test command

```bash
node --test tests/ko1298-combat/*.test.js
```

Current local evidence: 56/56 pass.
