# WS24 Status

Status: COMPLETE

Branch: `ws24-pvp-zone-rules`
Base: `main`

## Delivered

- Isolated C++17 `ko1298-rules` service.
- `IZoneRules` integration interface for combat/world consumers.
- Decisions for `CanAttack`, `CanEnterZone`, `IsSafeZone`, and `AreHostile`.
- Death/respawn policy interface without world implementation coupling.
- NP contribution eligibility interface without reward/formula coupling.
- Karus / El Morad home-zone gating, Moradon neutrality, 1298 arena exception, battle-open gating, safe-area input.
- Standalone tests and GitHub Actions workflow.
- Historical rule notes in `services/ko1298-rules/ZONE_RULES.md`.

## Boundaries respected

No combat, movement, world, client, database, admin, website, or main-branch files were modified. No DB migration is included. No modern KO PvP zones/features were added.

## Verification

Local build/test command:

```sh
cmake -S tests/ko1298-rules -B build/ws24
cmake --build build/ws24 --parallel
ctest --test-dir build/ws24 --output-on-failure
```
