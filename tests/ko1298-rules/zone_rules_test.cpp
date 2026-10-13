#include "ko1298_rules/zone_rules.hpp"

#include <cstdlib>
#include <iostream>
#include <string_view>

using oldko::rules::AttackContext;
using oldko::rules::Nation;
using oldko::rules::PlayerLocation;
using oldko::rules::RespawnPolicy;
using oldko::rules::RuleReason;
using oldko::rules::ZoneId;
using oldko::rules::ZoneRules;
using oldko::rules::ZoneRuntimeState;

namespace {

int failures = 0;

void expect(bool condition, std::string_view name) {
    if (!condition) {
        std::cerr << "FAIL: " << name << '\n';
        ++failures;
    }
}

AttackContext attack(Nation a, Nation b, ZoneId zone, bool a_safe = false, bool b_safe = false) {
    return {
        PlayerLocation{a, zone, a_safe},
        PlayerLocation{b, zone, b_safe},
        false,
    };
}

} // namespace

int main() {
    ZoneRules rules;
    const ZoneRuntimeState closed{};
    const ZoneRuntimeState battle_open{true, false};
    const ZoneRuntimeState invasion_open{false, true};

    expect(rules.IsSafeZone(ZoneId::Moradon), "Moradon is zone-wide safe");
    expect(!rules.IsSafeZone(ZoneId::Karus), "home zone safety is event-dependent, not zone-wide");
    expect(!rules.IsSafeZone(ZoneId::Arena), "Arena is not safe");
    expect(!rules.IsSafeZone(ZoneId::Battle), "battle zone is not zone-wide safe");

    expect(!rules.AreHostile(Nation::Karus, Nation::ElMorad, ZoneId::Moradon, closed),
           "opposite nations are neutral in Moradon");
    expect(rules.AreHostile(Nation::Karus, Nation::ElMorad, ZoneId::Battle, battle_open),
           "opposite nations are hostile in open battle");
    expect(!rules.AreHostile(Nation::Karus, Nation::Karus, ZoneId::Battle, battle_open),
           "same nation is friendly in battle");
    expect(rules.AreHostile(Nation::Karus, Nation::Karus, ZoneId::Arena, closed),
           "arena allows same-nation hostility");

    auto d = rules.CanAttack(attack(Nation::Karus, Nation::ElMorad, ZoneId::Moradon), closed);
    expect(!d.allowed && d.reason == RuleReason::NeutralZone, "cannot attack in Moradon");

    d = rules.CanAttack(attack(Nation::Karus, Nation::ElMorad, ZoneId::Battle), closed);
    expect(!d.allowed && d.reason == RuleReason::BattleClosed, "closed battle denies attack");

    d = rules.CanAttack(attack(Nation::Karus, Nation::ElMorad, ZoneId::Battle), battle_open);
    expect(d.allowed, "open battle allows enemy attack");

    d = rules.CanAttack(attack(Nation::Karus, Nation::Karus, ZoneId::Battle), battle_open);
    expect(!d.allowed && d.reason == RuleReason::FriendlyTarget, "battle has no friendly fire");

    d = rules.CanAttack(attack(Nation::Karus, Nation::Karus, ZoneId::Arena), closed);
    expect(d.allowed, "arena same-nation PvP is allowed");

    d = rules.CanAttack(attack(Nation::Karus, Nation::ElMorad, ZoneId::Battle, true, false), battle_open);
    expect(!d.allowed && d.reason == RuleReason::SafeArea, "safe-area attacker cannot attack");

    expect(rules.CanEnterZone(Nation::Karus, ZoneId::Karus, closed).allowed,
           "Karus can enter Karus home");
    expect(!rules.CanEnterZone(Nation::ElMorad, ZoneId::Karus, closed).allowed,
           "El Morad cannot enter Karus home normally");
    expect(rules.CanEnterZone(Nation::ElMorad, ZoneId::Karus, invasion_open).allowed,
           "El Morad can enter Karus home during invasion");
    expect(rules.CanEnterZone(Nation::Karus, ZoneId::Moradon, closed).allowed,
           "Karus can enter Moradon");
    expect(rules.CanEnterZone(Nation::ElMorad, ZoneId::Moradon, closed).allowed,
           "El Morad can enter Moradon");
    expect(!rules.CanEnterZone(Nation::Karus, ZoneId::Battle, closed).allowed,
           "battle transition denied while closed");
    expect(rules.CanEnterZone(Nation::Karus, ZoneId::Battle, battle_open).allowed,
           "battle transition allowed while open");

    auto np = rules.GetNPContributionRule(
        attack(Nation::Karus, Nation::ElMorad, ZoneId::Battle), battle_open);
    expect(np.eligible, "enemy battle kill may contribute NP");

    np = rules.GetNPContributionRule(
        attack(Nation::Karus, Nation::Karus, ZoneId::Arena), closed);
    expect(!np.eligible, "arena kill does not contribute NP");

    np = rules.GetNPContributionRule(
        attack(Nation::ElMorad, Nation::Karus, ZoneId::Karus), invasion_open);
    expect(np.eligible, "legal invasion kill may contribute NP");

    const auto battle_death = rules.GetDeathRule(Nation::Karus, ZoneId::Battle, battle_open);
    expect(battle_death.respawn == RespawnPolicy::BattleBind && battle_death.may_contribute_np,
           "battle death exposes battle respawn and NP interface");

    const auto moradon_death = rules.GetDeathRule(Nation::Karus, ZoneId::Moradon, closed);
    expect(moradon_death.respawn == RespawnPolicy::NationHome && !moradon_death.may_contribute_np,
           "Moradon death is non-NP");

    if (failures != 0) {
        std::cerr << failures << " test(s) failed\n";
        return EXIT_FAILURE;
    }

    std::cout << "ko1298-rules: all tests passed\n";
    return EXIT_SUCCESS;
}
