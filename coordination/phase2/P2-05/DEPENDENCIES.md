# P2-05 dependency proposal

P2-05 owns NPC data binding, dialogue/option routing and quest/event state orchestration. It does not take ownership of inventory/currency, database transactions, combat/skills or zone transitions.

## P2-10 protocol/UI contract

Use the existing 1298 client protocol; do not add an HTTP/game endpoint.

- Client NPC click: `WIZ_NPC_EVENT (0x20)` + `u16 runtimeNpcId`.
- Merchant open: `WIZ_TRADE_NPC (0x25)` + `u32 sellingGroup`.
- Tinker/repair open: `WIZ_REPAIR_NPC (0x3A)` + `u32 sellingGroup`.
- Innkeeper landing window: `WIZ_WAREHOUSE (0x45)` + `N3_SP_WARE_INN (0x10)`.
- Quest choice window: server `WIZ_SELECT_MSG (0x55)` using the client `UIQuestMenu` layout; client reply is `WIZ_SELECT_MSG (0x55)` + `u8 offeredOptionIndex`.
- The 1298 client resolves quest dialogue/menu ids from its `QUEST_TALK` and `QUEST_MENU` tables. P2-10 must verify those tables and the UIQuestMenu asset are present in the WASM package before enabling quest interaction.
- P2-05 `OfferedOptionLedger` must be consulted before dispatching a returned option index. The client cannot choose an event id, reward, price or result.

Sources are pinned to `Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5` (`GameProcMain.cpp`, `UIQuestMenu.cpp`, `PacketDef.h`, `packets.h`).

## P2-08 inventory/economy

P2-05 opens merchant/repair/inn windows only. Buy/sell, potion purchase, storage deposit/withdraw, repair mutation, anvil/upgrade item consumption and currency changes must be P2-08 authoritative operations. No P2-05 handler returns success for a mutation that P2-08 did not commit.

## P2-11 transaction/persistence

The imported WS23 quest state machine is retry-safe only when its repository mutation and reward gateway are backed by production atomic/idempotent persistence. P2-11 must provide durable character quest state + revision/CAS, atomic item turn-in + quest transition, idempotent reward grant keyed by the WS23 completion key, and an authoritative player snapshot containing level/nation/class.

Until this composition exists, source-backed quest NPCs remain fail-closed.

## P2-04 world transition

Gate/teleport actions require a P2-04 transition function that validates destination/source zone and eligibility and returns the existing game protocol transition. P2-05 will not invent a warp endpoint.

## P2-07 skill/master

Master/skill NPC actions require P2-07 authoritative class/skill eligibility and mutation. P2-05 only owns NPC option routing.

## Source blockers found in current Moradon catalog

- `Miraselth[Warehouse Keeper]` is `npcType=29`, while the pinned client enum identifies warehouse as type `31` and type `29` as `NPC_OPERATOR`. It is not silently wired as storage.
- `Aban[Battlefield Gate-keeper]` is `npcType=136` with route `world`, while the pinned client enum identifies teleport gate as type `28` and type `136` as `NPC_COLISEUM_ARTES`. It is not silently wired as teleport.
- Official Moradon quest/event source exists at `assets/Server/QUESTS/21.evt` in the pinned Open-KO tree, but the current OldKOWeb release has no production EVT-to-route binding or production quest persistence/reward adapters.

## Exhaustive NPC register

Run `node scripts/phase2/p2-05-npc-scope.js`. It reads the canonical checked-in `world-data/npc/moradon.json` and emits one record for every template plus every spawn anchor, including source, role, route, prerequisites, service, result, test/binding status and named blocker. This avoids a hand-maintained shortlist silently omitting NPCs.
