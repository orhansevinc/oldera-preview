# WS23 Integration Patch

WS23 deliberately contains **no direct edits/imports** from WS16, WS17, WS22, client, DB migrations, admin or website code. Integrate through adapters after the owning branches land.

## WS16 NPC -> WS23 event route

At the verified NPC interaction boundary, map the server-owned NPC identity and the verified interaction/menu action to:

```js
const result = await questRouter.route({
  npcId: npcTemplateId,
  action: verifiedAction,
  characterId: character.id,
  player: {
    level: character.level,
    classId: character.classId,
    nationId: character.nationId
  }
});
```

Do not pass an arbitrary client-provided NPC template ID without WS16 validating that the selected NPC instance is interactable/in-range. Do not invent 1.298 menu action IDs in WS23; the protocol/NPC owner must provide the verified mapping.

## Gameplay progress -> WS23

Authoritative server domains publish facts such as:

```js
await questService.recordProgress(character.id, questId, {
  type: 'npc_defeated',
  targetId: npcTemplateId,
  count: 1
});
```

The exact event names are integration contracts, not 1.298 wire constants. Never accept progress counters directly from the client.

## WS17 item reward adapter

Implement the `RewardGateway` item portion using WS17's atomic inventory transaction boundary once its public interface is finalized. Requirements:

- resolve each `itemId` through WS17-owned item data;
- validate capacity/stack rules in WS17;
- preserve unique serial rules in WS17;
- make the operation idempotent by WS23 `idempotencyKey`;
- surface failure so WS23 does not commit quest completion.

WS23 must not duplicate item logic.

## WS22 coin reward adapter

Implement coin grants through WS22's balance interface. Requirements:

- use WS23 `idempotencyKey` for retry safety;
- perform overflow/range validation in WS22;
- do not let quest JSON mutate coin storage directly.

WS23 must not duplicate economy logic.

## XP reward adapter

Route XP through the eventual authoritative character/stat progression owner. The WS23 contract is only a non-negative integer `xp` amount plus an idempotency key. Level-up side effects stay outside WS23.

## Persistent quest repository

Replace `InMemoryQuestStateRepository` with a DB-backed implementation of:

- `get(characterId, questId)`
- `mutate(characterId, questId, mutator)` atomic per character+quest

No schema change is included here. Coordinate the concrete table/document mapping with the DB workstream.

## 1.298 EVT bridge

A later verified bridge may translate authentic 1.298 EVT data into WS23 definitions/events. It should:

1. parse only confirmed 1.298 EVT constructs;
2. reject unsupported/unknown operations loudly;
3. map dialogue/state checks to WS23 allowlisted operations where semantics match;
4. keep packet/opcode numeric mappings outside the quest core;
5. add golden tests from verified captures/source before enabling production data.

Open-KO's 1.298 EVT tracking is useful evidence for supported historical concepts, but WS23 intentionally avoids guessing numeric opcodes or unverified semantics.
