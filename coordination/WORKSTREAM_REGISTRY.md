# OldKOWeb — Workstream Registry

This registry defines workstream identity and ownership. Runtime/completion status must be verified from each WS branch and `workstreams/wsXX/STATUS.md`; do not assume a status from this index alone.

| WS | Canonical branch / role |
|---|---|
| WS01 | `ws01-runtime-build` — WASM/Emscripten/WebGL2 runtime & build |
| WS02 | `ws02-websocket-gateway` — WebSocket ↔ TCP transport gateway |
| WS03 | `ws03-ko1298-session` — 1298 auth/game session protocol |
| WS04 | `ws04-character-client` — real client Character Select/Create |
| WS05 | `ws05-moradon-world` — client-side Moradon world entry/render |
| WS06 | `ws06-asset-audit` — authentic 1298 asset audit/manifest |
| WS07 | `ws07-database` — persistence/database layer |
| WS08 | `ws08-admin-api` — admin backend API |
| WS09 | `ws09-production-infra` — deployment/domain/production infra |
| WS10 | `ws10-qa-integration` — QA/E2E milestone gates |
| WS11 | `ws11-protocol-lab` — 1298 protocol catalog/replay |
| WS12 | `ws12-browser-launcher` — browser launcher/play shell |
| WS13 | `ws13-account-api` — public player account API |
| WS14 | `ws14-world-session` — server-side world/zone session |
| WS15 | `ws15-movement-sync` — movement/position synchronization |
| WS16 | `ws16-npc-world` — NPC spawn/interaction |
| WS17 | `ws17-item-inventory` — item/inventory/equipment domain |
| WS18 | `ws18-social-core` — chat/party/social core |
| WS19 | `ws19-combat-core` — combat/stats/skill core |
| WS20 | `ws20-reliability-security` — security/load/reliability tests |
| WS21 | `ws21-clan-core` — clan/guild core |
| WS22 | `ws22-merchant-economy` — merchant/trade/coin economy |
| WS23 | `ws23-quest-events` — quests/NPC events |
| WS24 | `ws24-pvp-zone-rules` — nation/PvP/zone rules |
| WS25 | `ws25-mob-ai` — monsters/mob spawn/basic AI |
| WS26 | `ws26-drop-loot` — drop/loot/reward domain |
| WS27 | `ws27-progression` — XP/level/death/respawn progression |
| WS28 | `ws28-gm-command-bus` — server-side GM command bus |
| WS29 | `ws29-observability` — metrics/logging/health standard |
| WS30 | `ws30-backup-recovery` — backup/restore/disaster recovery |
| WS31 | `ws31-data-catalog` — 1298 data catalog/cross-reference validation |
| WS32 | `ws32-friends-messenger` — friends/block/messenger |
| WS33 | `ws33-inn-storage` — Inn Hostess/account warehouse storage |
| WS34 | `ws34-character-rules` — character creation rules/identity |
| WS35 | `ws35-runtime-config` — typed runtime config/secrets contract |
| WS36 | `ws36-world-clock` — world clock/weather/scheduled events |
| WS37 | `ws37-rankings` — public rankings read model/API |
| WS38 | `ws38-client-content-pipeline` — client content manifest/integrity/CDN |
| WS39 | `ws39-contract-compatibility` — cross-service contract compatibility |
| WS40 | `ws40-release-readiness` — release readiness/merge planning |
| WS41 | `ws41-browser-input` — browser keyboard/mouse/focus input compatibility |
| WS42 | `ws42-browser-audio` — browser audio compatibility |
| WS43 | `ws43-client-display-compat` — resolution/DPI/resize/fullscreen compatibility |
| WS44 | `ws44-server-status` — public server status/realm directory |
| WS45 | `ws45-session-ownership` — duplicate login/session ownership |
| WS46 | `ws46-character-lifecycle` — character delete/lifecycle |
| WS47 | `ws47-anticheat-signals` — server-side suspicious-state signals |
| WS48 | `ws48-abuse-protection` — reusable rate-limit/abuse protection |
| WS49 | `ws49-test-scenarios` — deterministic integration/E2E fixtures |
| WS50 | `ws50-integration-rehearsal` — isolated merge/integration rehearsal |

## High-level dependency map

### Authentic browser path
`WS06 → WS01 → WS12/WS38 → WS02 → WS03 → WS04 → WS05`

Related compatibility: `WS41`, `WS42`, `WS43`.

### Login / character / world path
`WS13/WS07 → WS03 → WS34/WS46 → WS45 → WS14 → WS15/WS16/WS36`

### Gameplay path
`WS31 → WS17 → WS22/WS33`

`WS14 → WS24 → WS19 → WS25 → WS26/WS27`

`WS16 → WS23`

`WS18 → WS21/WS32`

### Operations / production path
`WS35 → services`

`WS29 → services`

`WS48 → public/admin/gateway entry points`

`WS47 ← movement/combat/item/economy security events`

`WS08 → WS28`

`WS37/WS44 → official site consumers`

`WS07 → WS30`

`WS09 → deployable services`

### Verification / integration authority
- WS10: E2E milestone validation.
- WS11: 1298 packet/protocol evidence.
- WS20: reliability/security test evidence.
- WS31: authentic data/ID evidence.
- WS39: cross-service contract compatibility.
- WS40: release readiness and integration order.
- WS49: shared deterministic fixtures.
- WS50: disposable Git-level integration rehearsal.

## Mandatory rule

Before implementing a dependency or interface, check whether its owner WS already implemented or specified it. Reuse contracts; do not create a competing second implementation in another workstream.
