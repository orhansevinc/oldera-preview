#include "ko1298_rules/zone_rules.hpp"

namespace oldko::rules {

bool ZoneRules::IsValidNation(Nation nation) noexcept {
    return nation == Nation::Karus || nation == Nation::ElMorad;
}

bool ZoneRules::IsBattleZone(ZoneId zone) noexcept {
    switch (zone) {
        case ZoneId::Battle:
        case ZoneId::Battle2:
        case ZoneId::Battle3:
        case ZoneId::SnowBattle:
            return true;
        default:
            return false;
    }
}

bool ZoneRules::IsHomeZoneFor(Nation nation, ZoneId zone) noexcept {
    if (nation == Nation::Karus)
        return zone == ZoneId::Karus || zone == ZoneId::KarusEslant;
    if (nation == Nation::ElMorad)
        return zone == ZoneId::ElMorad || zone == ZoneId::ElMoradEslant;
    return false;
}

bool ZoneRules::IsOpposingHomeZoneFor(Nation nation, ZoneId zone) noexcept {
    if (nation == Nation::Karus)
        return zone == ZoneId::ElMorad || zone == ZoneId::ElMoradEslant;
    if (nation == Nation::ElMorad)
        return zone == ZoneId::Karus || zone == ZoneId::KarusEslant;
    return false;
}

bool ZoneRules::IsSupportedZone(ZoneId zone) noexcept {
    switch (zone) {
        case ZoneId::Karus:
        case ZoneId::ElMorad:
        case ZoneId::KarusEslant:
        case ZoneId::ElMoradEslant:
        case ZoneId::Moradon:
        case ZoneId::Arena:
        case ZoneId::Battle:
        case ZoneId::Battle2:
        case ZoneId::Battle3:
        case ZoneId::SnowBattle:
            return true;
        default:
            return false;
    }
}

bool ZoneRules::IsSafeZone(ZoneId zone) const noexcept {
    // Zone-wide safety only. Coordinate/region safe areas are represented by
    // PlayerLocation::in_safe_area and checked by CanAttack().
    switch (zone) {
        case ZoneId::Moradon:
        case ZoneId::Karus:
        case ZoneId::ElMorad:
        case ZoneId::KarusEslant:
        case ZoneId::ElMoradEslant:
            return true;
        default:
            return false;
    }
}

bool ZoneRules::AreHostile(
    Nation lhs,
    Nation rhs,
    ZoneId zone,
    const ZoneRuntimeState& state) const noexcept {
    if (!IsValidNation(lhs) || !IsValidNation(rhs) || !IsSupportedZone(zone))
        return false;

    if (zone == ZoneId::Moradon)
        return false;

    // The 1298 arena is the explicit same-nation PvP exception.
    if (zone == ZoneId::Arena)
        return true;

    if (IsBattleZone(zone))
        return state.battle_open && lhs != rhs;

    // Home/Eslant zones are non-PvP in normal operation. Opposing nations are
    // hostile only while the world layer declares the invasion phase open.
    if (IsHomeZoneFor(lhs, zone) || IsOpposingHomeZoneFor(lhs, zone))
        return state.invasion_open && lhs != rhs;

    return false;
}

RuleDecision ZoneRules::CanAttack(
    const AttackContext& context,
    const ZoneRuntimeState& state) const noexcept {
    if (!IsValidNation(context.attacker.nation) || !IsValidNation(context.target.nation))
        return {false, RuleReason::InvalidNation};

    if (context.same_player)
        return {false, RuleReason::SelfTarget};

    if (context.attacker.zone != context.target.zone)
        return {false, RuleReason::PvPDisabled};

    const ZoneId zone = context.attacker.zone;
    if (!IsSupportedZone(zone))
        return {false, RuleReason::UnsupportedZone};

    if (context.attacker.in_safe_area || context.target.in_safe_area)
        return {false, RuleReason::SafeArea};

    if (zone == ZoneId::Moradon)
        return {false, RuleReason::NeutralZone};

    if (IsBattleZone(zone) && !state.battle_open)
        return {false, RuleReason::BattleClosed};

    if (AreHostile(context.attacker.nation, context.target.nation, zone, state))
        return {true, RuleReason::Allowed};

    if (context.attacker.nation == context.target.nation)
        return {false, RuleReason::FriendlyTarget};

    return {false, RuleReason::PvPDisabled};
}

RuleDecision ZoneRules::CanEnterZone(
    Nation nation,
    ZoneId target_zone,
    const ZoneRuntimeState& state) const noexcept {
    if (!IsValidNation(nation))
        return {false, RuleReason::InvalidNation};

    if (!IsSupportedZone(target_zone))
        return {false, RuleReason::UnsupportedZone};

    if (target_zone == ZoneId::Moradon || target_zone == ZoneId::Arena)
        return {true, RuleReason::Allowed};

    if (IsBattleZone(target_zone))
        return state.battle_open
            ? RuleDecision{true, RuleReason::Allowed}
            : RuleDecision{false, RuleReason::BattleClosed};

    if (IsHomeZoneFor(nation, target_zone))
        return {true, RuleReason::Allowed};

    if (IsOpposingHomeZoneFor(nation, target_zone))
        return state.invasion_open
            ? RuleDecision{true, RuleReason::Allowed}
            : RuleDecision{false, RuleReason::WrongNation};

    return {false, RuleReason::UnsupportedZone};
}

DeathRule ZoneRules::GetDeathRule(
    Nation nation,
    ZoneId zone,
    const ZoneRuntimeState& state) const noexcept {
    (void)nation;

    if (zone == ZoneId::Arena)
        return {RespawnPolicy::ZoneBind, false};

    if (IsBattleZone(zone) && state.battle_open)
        return {RespawnPolicy::BattleBind, true};

    if (IsSafeZone(zone))
        return {RespawnPolicy::NationHome, false};

    return {RespawnPolicy::ZoneBind, false};
}

NPContributionRule ZoneRules::GetNPContributionRule(
    const AttackContext& context,
    const ZoneRuntimeState& state) const noexcept {
    const RuleDecision attack = CanAttack(context, state);
    if (!attack.allowed)
        return {false, attack.reason};

    // Arena kills are PvP-capable but are deliberately not NP-bearing here.
    // WS24 exposes eligibility only; the combat/economy layer owns amounts.
    if (!IsBattleZone(context.attacker.zone))
        return {false, RuleReason::PvPDisabled};

    return {true, RuleReason::Allowed};
}

} // namespace oldko::rules
