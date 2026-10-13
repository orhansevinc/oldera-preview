#pragma once

#include <cstdint>

namespace oldko::rules {

enum class Nation : std::uint8_t {
    None = 0,
    Karus = 1,
    ElMorad = 2,
};

enum class ZoneId : std::uint16_t {
    Karus = 1,
    ElMorad = 2,
    KarusEslant = 11,
    ElMoradEslant = 12,
    Moradon = 21,
    Arena = 48,
    Battle = 101,
    Battle2 = 102,
    Battle3 = 103,
    SnowBattle = 111,
};

enum class RuleReason : std::uint8_t {
    Allowed,
    NeutralZone,
    FriendlyTarget,
    SelfTarget,
    SafeArea,
    PvPDisabled,
    WrongNation,
    BattleClosed,
    InvalidNation,
    UnsupportedZone,
};

struct RuleDecision {
    bool allowed{false};
    RuleReason reason{RuleReason::UnsupportedZone};

    [[nodiscard]] constexpr explicit operator bool() const noexcept { return allowed; }
};

struct ZoneRuntimeState {
    // Nation war/battle zone is open. This is deliberately supplied by the
    // world/event layer; WS24 does not own event scheduling.
    bool battle_open{false};

    // During the post-war invasion phase, the opposing nation may enter the
    // enemy home zone. The world/event layer decides when this state is true.
    bool invasion_open{false};
};

struct PlayerLocation {
    Nation nation{Nation::None};
    ZoneId zone{ZoneId::Moradon};

    // Coordinate/region safe areas are map data. The world/movement layer
    // supplies this bit without WS24 depending on either implementation.
    bool in_safe_area{false};
};

struct AttackContext {
    PlayerLocation attacker{};
    PlayerLocation target{};
    bool same_player{false};
};

enum class RespawnPolicy : std::uint8_t {
    NationHome,
    ZoneBind,
    BattleBind,
};

struct DeathRule {
    RespawnPolicy respawn{RespawnPolicy::ZoneBind};
    bool may_contribute_np{false};
};

struct NPContributionRule {
    bool eligible{false};
    RuleReason reason{RuleReason::PvPDisabled};
};

class IZoneRules {
public:
    virtual ~IZoneRules() = default;

    [[nodiscard]] virtual RuleDecision CanAttack(
        const AttackContext& context,
        const ZoneRuntimeState& state = {}) const noexcept = 0;

    [[nodiscard]] virtual RuleDecision CanEnterZone(
        Nation nation,
        ZoneId target_zone,
        const ZoneRuntimeState& state = {}) const noexcept = 0;

    [[nodiscard]] virtual bool IsSafeZone(ZoneId zone) const noexcept = 0;

    [[nodiscard]] virtual bool AreHostile(
        Nation lhs,
        Nation rhs,
        ZoneId zone,
        const ZoneRuntimeState& state = {}) const noexcept = 0;

    [[nodiscard]] virtual DeathRule GetDeathRule(
        Nation nation,
        ZoneId zone,
        const ZoneRuntimeState& state = {}) const noexcept = 0;

    [[nodiscard]] virtual NPContributionRule GetNPContributionRule(
        const AttackContext& context,
        const ZoneRuntimeState& state = {}) const noexcept = 0;
};

class ZoneRules final : public IZoneRules {
public:
    [[nodiscard]] RuleDecision CanAttack(
        const AttackContext& context,
        const ZoneRuntimeState& state = {}) const noexcept override;

    [[nodiscard]] RuleDecision CanEnterZone(
        Nation nation,
        ZoneId target_zone,
        const ZoneRuntimeState& state = {}) const noexcept override;

    [[nodiscard]] bool IsSafeZone(ZoneId zone) const noexcept override;

    [[nodiscard]] bool AreHostile(
        Nation lhs,
        Nation rhs,
        ZoneId zone,
        const ZoneRuntimeState& state = {}) const noexcept override;

    [[nodiscard]] DeathRule GetDeathRule(
        Nation nation,
        ZoneId zone,
        const ZoneRuntimeState& state = {}) const noexcept override;

    [[nodiscard]] NPContributionRule GetNPContributionRule(
        const AttackContext& context,
        const ZoneRuntimeState& state = {}) const noexcept override;

private:
    [[nodiscard]] static bool IsValidNation(Nation nation) noexcept;
    [[nodiscard]] static bool IsBattleZone(ZoneId zone) noexcept;
    [[nodiscard]] static bool IsHomeZoneFor(Nation nation, ZoneId zone) noexcept;
    [[nodiscard]] static bool IsOpposingHomeZoneFor(Nation nation, ZoneId zone) noexcept;
    [[nodiscard]] static bool IsSupportedZone(ZoneId zone) noexcept;
};

} // namespace oldko::rules
