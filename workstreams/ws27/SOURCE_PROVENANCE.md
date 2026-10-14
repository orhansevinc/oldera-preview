# WS27 Source Provenance

Target: OldKO / Knight Online 1298 behavior. No community/private-server XP curve is promoted as production data.

## Pinned source

Repository: `Open-KO/KnightOnline`

Pinned commit used during this WS27 pass:

`7d6cf81093e142c928c2ac9510512b2b182178b5`

### XP / level transition

- `src/Server/Ebenezer/User.cpp`
  - `ExpChange()` suppresses negative XP below level 6.
  - `ExpChange()` performs one level-down or one level-up and returns.
  - Level threshold is loaded from the level-up table rather than synthesized from a formula.
  - `LevelChange()` applies point eligibility, recalculates abilities/vitals and emits level-change synchronization.

### Maximum level

- `src/shared/globals.h`
  - pinned source constant: `MAX_LEVEL = 80`.

### Level point awards

- `src/Server/Ebenezer/User.cpp`, `LevelChange()`
  - +3 stat points only while total stored/base stat accounting remains below `300 + 3 * (level - 1)`.
  - +2 skill points for level > 9 only while accumulated skill points remain below `2 * (level - 9)`.

### HP / MP recalculation

- `src/Server/Ebenezer/User.cpp`, `SetMaxHp()` / `SetMaxMp()`
  - formulas depend on class coefficients, level, base/item/buff stats and modifiers.
  - WS27 therefore exposes `VitalsPort`; it does not duplicate incomplete formulas without the owning inputs.

### NPC death XP loss

- `src/Server/Ebenezer/AISocket.cpp`
- `src/Server/Ebenezer/MagicProcess.cpp`

Observed source branches include `m_iMaxExp / 100` (1%) and `m_iMaxExp / 20` (5%). Because the exact path selection depends on combat/zone context, WS27 requires an explicit verified divisor and otherwise applies zero loss.

### Respawn / blink

- `src/Server/Ebenezer/User.cpp`, `Regene()` and attack/liveness guards.
- `src/Server/Ebenezer/Define.h`, `BLINK_TIME`.

Normal regene restores HP and enters blinking. The pinned source uses a 10-second blink interval. Combat is rejected while blinking/dead. Normal-regene MP refill is not established by the inspected path, so WS27 preserves MP unless another verified resurrection adapter supplies a different rule.

## Cross-workstream provenance

- WS19: combat/death contract owns damage and combat death; WS27 consumes authoritative death transition only.
- WS25: mob runtime owns mob death identity/lifecycle.
- WS26: loot uses a stable mob-death `eventId`; WS27 reuses stable death identity for replay safety but does not treat loot tables as XP tables.
- WS14: world/zone owns authoritative respawn point selection.
- WS15: movement owns actual position/baseline mutation.
- WS07: persistence owns atomic storage/CAS implementation.
- WS31: current catalog does not contain an authoritative progression `LEVEL_UP.RequiredExp` dataset.

## UNKNOWN (kept behind adapters)

1. Exact verified 1298 XP threshold rows.
2. Exact verified mob reward XP dataset/mapping.
3. Exact verified party XP split/eligibility formula.
4. Exact integration mapping selecting 1% vs 5% NPC-death XP-loss branch for every zone/combat path.
5. Item-loss-on-death behavior; no implementation is present.
