# WS24 Integration Patch

WS24 is intentionally dependency-free. Do not copy implementation into combat/world; consume `IZoneRules`.

## Combat-side adapter (illustrative only)

```cpp
oldko::rules::AttackContext ctx{
    {ToRulesNation(attacker.nation), ToRulesZone(attacker.zone), attacker.in_safe_area},
    {ToRulesNation(target.nation), ToRulesZone(target.zone), target.in_safe_area},
    attacker.id == target.id,
};

oldko::rules::ZoneRuntimeState state{
    world.IsBattleOpen(),
    world.IsInvasionOpen(),
};

const auto decision = zoneRules.CanAttack(ctx, state);
if (!decision.allowed)
    return AttackRejected;
```

For a legal player kill, combat may ask:

```cpp
const auto np = zoneRules.GetNPContributionRule(ctx, state);
if (np.eligible)
    npService.Contribute(/* amount/formula owned elsewhere */);
```

## World-side adapter (illustrative only)

Before committing a warp/zone transition:

```cpp
const auto decision = zoneRules.CanEnterZone(
    ToRulesNation(character.nation),
    ToRulesZone(targetZone),
    {world.IsBattleOpen(), world.IsInvasionOpen()});

if (!decision.allowed)
    return ZoneTransitionRejected;
```

On death:

```cpp
const auto death = zoneRules.GetDeathRule(
    ToRulesNation(character.nation),
    ToRulesZone(character.zone),
    {world.IsBattleOpen(), world.IsInvasionOpen()});

// World resolves NationHome/ZoneBind/BattleBind to actual 1298 start/bind coordinates.
```

## Safe-area ownership

`PlayerLocation::in_safe_area` is intentionally an input. Map/region geometry belongs to world data. WS24 will not create a second coordinate source of truth.

## Mapping guidance

Keep conversion functions at integration boundaries. Do not make combat/world include WS24's numeric enums throughout their internals. Unknown/unmapped zones should remain denied until their 1298 behavior is verified.
