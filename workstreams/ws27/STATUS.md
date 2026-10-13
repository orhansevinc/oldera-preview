# WS27 Status

## Identity

- Workstream: WS27
- Branch: `ws27-progression`
- Base: `main`
- Scope: Experience / Level / Death / Respawn progression

## Completed

- [x] Progression service under `services/ko1298-progression/`.
- [x] XP normalized to `bigint`; unsafe number input rejected.
- [x] Level thresholds delegated to `LevelTablePort`.
- [x] Target max level delegated to verified patch data; not hard-coded.
- [x] Mob-kill XP ingress.
- [x] Party-XP allocation interface.
- [x] Multi-level gain and max-level saturation.
- [x] Level-up reward interface without guessed stat/skill values.
- [x] Death state and respawn transition.
- [x] Respawn-point interface.
- [x] Conservative verified PvE death-loss policy: 1% current-level cap, level 6+, monster death only.
- [x] Zone/rules XP-loss suppression seam.
- [x] Nation-point handoff seam only.
- [x] 14 tests covering gain, level-up, saturation, validation, death loss, level-down, party allocation, respawn and NP handoff.
- [x] Dedicated GitHub Actions workflow.

## Fidelity decisions

- Exact XP thresholds: adapter/TODO.
- Exact target max level: adapter/TODO.
- Stat/skill awards: `LevelRewardPort`.
- Party split formula: `PartyXpPort`.
- PvP XP loss: intentionally not guessed.
- Respawn coordinates: `RespawnPointPort`.

## Boundaries respected

No changes to WS19, WS24, WS25, DB migrations, client, admin/site, or `main`. No merge to `main`; no force push.
