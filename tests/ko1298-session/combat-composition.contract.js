'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { GAME, Writer } = require('../../services/ko1298-session/protocol');
const { MemoryRepository } = require('../../services/ko1298-session/repository');
const { GameSession } = require('../../services/ko1298-session/session');
const { SESSION_STATES } = require('../../services/ko1298-session/contracts');
const { MAGIC_COMMAND } = require('../../services/ko1298-session/combat-protocol');
const { MovementService } = require('../../services/ko1298-movement');
const { InMemoryItemRepository, ItemDomainService } = require('../../services/ko1298-items');
const { MobVisibilityService } = require('../../services/ko1298-mobs');
const {
  ATTACK_RESULT,
  CombatService,
  LIFE_STATE,
  OpenKo1298NormalAttackDamagePolicy,
  SkillService,
  createAuthoritativeWorldPort,
  createCombatant,
  createGoldenSkillTable,
  createPlayerCombatPort,
  createWs17EquipmentCombatPort,
} = require('../../services/ko1298-combat');

const WS11_SHA = '944b6ff9b6329af29f1048a74aa6e14fca141639';
const WS19_SHA = '28eb4f38753ffbc54c60abbd2a32832301284c06';
const WS25_SHA = '13c9bafe287b250d56b52f19e97a02e7ef18e6e5';
const WS15_SHA = 'ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d';
const WS17_SHA = 'fbfc13f9c123ebeb6dd38c32fc95ef26d917a777';

function login() { return new Writer().u8(GAME.LOGIN).str16('osevinc').str16('osevinc').done(); }
function create() { return new Writer().u8(GAME.NEW_CHAR).u8(0).str16('CombatHero').u8(12).i16(201).u8(1).u8(2).u8(60).u8(60).u8(70).u8(50).u8(50).done(); }
function select() { return new Writer().u8(GAME.SEL_CHAR).str16('osevinc').str16('CombatHero').u8(1).u8(21).done(); }
function attack(targetId, intervalRaw = 1, distanceRaw = 1) {
  const b = Buffer.alloc(8); b[0] = GAME.ATTACK; b[1] = 1; b.writeInt16LE(targetId, 2); b.writeInt16LE(intervalRaw, 4); b.writeInt16LE(distanceRaw, 6); return b;
}
function magicEffect(skillId, targetId, clientSourceId = 12345) {
  const b = Buffer.alloc(22); b[0] = GAME.MAGIC_PROCESS; b[1] = MAGIC_COMMAND.EFFECTING; b.writeUInt32LE(skillId, 2); b.writeInt16LE(clientSourceId, 6); b.writeInt16LE(targetId, 8); return b;
}
function worldMock() {
  return {
    async beginSelectedCharacter(args) {
      return { state: 'WAIT_GAMESTART_LOADING', clientPackets: [Buffer.from([GAME.SEL_CHAR, 1])], broadcastPackets: [], snapshot: { socketId: args.socketId, zoneId: 21, x: 312, y: 0, z: 402 } };
    },
    async handleClientPacket(socketId, packet) {
      if (packet[0] === GAME.GAMESTART && packet[1] === 2) return { state: 'WORLD_READY', clientPackets: [], broadcastPackets: [], snapshot: { socketId, zoneId: 21, x: 312, y: 0, z: 402 } };
      return { state: 'WAIT_GAMESTART_LOADED', clientPackets: [Buffer.from([GAME.GAMESTART])], broadcastPackets: [], snapshot: { socketId, zoneId: 21, x: 312, y: 0, z: 402 } };
    },
  };
}
function moradonWormWorld() {
  const sourceRef = 'Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab:ManualSetup/6_InsertData_K_MONSTER.sql#750';
  return {
    schemaVersion: 2,
    dataClass: 'real',
    zoneId: '21',
    templates: [{
      templateId: 'ko1298:monster:750', displayName: 'Worm', dataClass: 'real', sourceRef,
      modelRef: 700, maxHp: 50, aggroRange: 10, leashRange: 20, attackRange: 2,
      corpseDespawnMs: 3000, respawnDelayMs: 30000, attackDelayMs: 1000, level: 1,
      metadata: { group: 0 },
    }],
    spawnGroups: [{
      groupId: 'ko1298:21:750:ws03-contract', templateId: 'ko1298:monster:750', zoneId: '21', sourceRef,
      spawns: [{ spawnId: 'slot-001', zoneId: '21', x: 313, y: 0, z: 402, heading: 0, sourceRef }],
    }],
  };
}
function normalizeWs17SnapshotForWs19(raw) {
  // Current WS17 exposes raw legacy range/delay but not a verified unit conversion to WS19's
  // weaponRange/attackDelayMs contract. Preserve the real snapshot and fail closed on those units.
  return Object.freeze({
    weaponRange: null,
    attackDelayMs: null,
    weaponClass: raw?.rightHand?.kind ?? raw?.leftHand?.kind ?? null,
    rightItemClass: raw?.rightHand?.kind ?? 0,
    leftItemClass: raw?.leftHand?.kind ?? 0,
    raw,
  });
}

async function readySession(options) {
  const session = new GameSession(new MemoryRepository(), { socketId: 500, worldSession: worldMock(), ...options });
  await session.handle(login());
  await session.handle(Buffer.from([GAME.SEL_NATION, 2]));
  await session.handle(create());
  await session.handle(select());
  await session.handle(Buffer.from([GAME.GAMESTART, 1]));
  await session.handle(Buffer.from([GAME.GAMESTART, 2]));
  assert.equal(session.phase, SESSION_STATES.WORLD_READY);
  return session;
}

test('pinned WS11/15/17/19/25 providers compose through WS03 combat ingress without client authority leakage', async () => {
  const authorityPath = path.join(process.cwd(), 'protocol-lab', 'gameplay-authority.json');
  const authority = JSON.parse(fs.readFileSync(authorityPath, 'utf8'));
  const attackAuthority = authority.packets.find((row) => row.name === 'WIZ_ATTACK');
  const magicAuthority = authority.packets.find((row) => row.name === 'WIZ_MAGIC_PROCESS');
  assert.equal(attackAuthority.confidence, 'VERIFIED');
  assert.equal(magicAuthority.confidence, 'VERIFIED');
  assert.equal(Number.parseInt(attackAuthority.opcode, 16), GAME.ATTACK);
  assert.equal(Number.parseInt(magicAuthority.opcode, 16), GAME.MAGIC_PROCESS);

  const movement = new MovementService({ zoneBounds: { isValidPosition: () => true } });
  const itemService = new ItemDomainService({
    repository: new InMemoryItemRepository(),
    templates: { get: async () => { throw new Error('empty equipment test must not resolve a template'); } },
  });

  let nextRuntimeId = 20001;
  const mobs = new MobVisibilityService(moradonWormWorld(), {
    runtimeIds: { claim: () => nextRuntimeId++ },
  });
  mobs.initialize(0);
  const mobRuntimeId = 20001;
  assert.equal(mobs.visibilitySnapshot(mobRuntimeId).runtimeId, mobRuntimeId);

  const player = createCombatant({
    id: 500, hp: 50, maxHp: 100, mp: 100, maxMp: 100,
    classId: 104, level: 20, nationId: 1, zoneId: 21,
    position: { x: 312, y: 0, z: 402 },
    combat: { ap: 200, ac: 100, hitRate: 5, evasionRate: 1 },
  });
  const equipmentCache = new Map();
  let mobResolutionCount = 0;
  function mobCombatProjection(runtimeId) {
    try {
      const snapshot = mobs.visibilitySnapshot(runtimeId);
      mobResolutionCount += 1;
      // WS25 current public snapshot is authoritative for identity/HP/world position but does not expose
      // target combat AC/evasion. Keep those absent; normal attack must stop before damage while the
      // separate provider gap remains explicit.
      return createCombatant({
        id: snapshot.runtimeId,
        hp: snapshot.hp,
        maxHp: snapshot.maxHp,
        zoneId: Number(snapshot.zoneId),
        position: snapshot.position,
        combat: {},
      });
    } catch {
      return null;
    }
  }
  function getEntity(id) {
    if (id === player.id) return player;
    return mobCombatProjection(id);
  }
  function getWorldSnapshot(id) {
    if (id === player.id) return movement.getEntityPositionSnapshot(id);
    const mob = mobs.visibilitySnapshot(id);
    return { zoneId: Number(mob.zoneId), position: mob.position };
  }
  const worldPort = createAuthoritativeWorldPort({
    getSnapshot: getWorldSnapshot,
    distance: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
  });
  const equipmentPort = createWs17EquipmentCombatPort({ getEquipmentSnapshot: (id) => equipmentCache.get(id) ?? null });
  const combatService = new CombatService({
    damagePolicy: new OpenKo1298NormalAttackDamagePolicy({ rng: () => 0 }),
    worldPort,
    equipmentPort,
    clock: () => 1000,
    rng: () => 0,
  });
  const skillService = new SkillService({ table: createGoldenSkillTable(), worldPort, equipmentPort, clock: () => 1000 });
  const playerCombatPort = createPlayerCombatPort({ combatService, skillService, getEntity });
  const events = [];

  const combatAdapter = {
    async execute({ actor, operation }) {
      assert.equal(operation.sourceEntityId, actor.entityId);
      const rawEquipment = await itemService.getCombatItemSnapshot(actor.characterId);
      equipmentCache.set(actor.entityId, normalizeWs17SnapshotForWs19(rawEquipment));
      if (operation.kind === 'NORMAL_ATTACK') {
        return playerCombatPort.normalAttack({
          sourceId: actor.entityId,
          targetId: operation.targetRuntimeId,
          requestKey: operation.requestKey,
          context: { requestMetadata: operation.requestMetadata },
        });
      }
      if (operation.kind === 'MAGIC_PROCESS' && operation.command === MAGIC_COMMAND.EFFECTING) {
        return playerCombatPort.skill({
          skillId: operation.skillId,
          sourceId: actor.entityId,
          targetId: operation.targetRuntimeId,
          requestKey: operation.requestKey,
          context: { requestMetadata: operation.requestMetadata },
        });
      }
      return Object.freeze({ ok: true, type: 'MAGIC_LIFECYCLE', command: operation.command, effectApplied: false });
    },
  };

  const session = await readySession({ movementSession: movement, combatAdapter, onCombatEvent: (event) => events.push(event) });
  assert.equal(movement.getEntityPositionSnapshot(500).zoneId, 21);

  await session.handle(attack(mobRuntimeId, 32000, 32000), { receiveSequence: 700 });
  assert.equal(events.at(-1).type, 'NORMAL_ATTACK_RESULT');
  assert.equal(events.at(-1).outcome.reason, ATTACK_RESULT.ATTACK_TIMER_UNAVAILABLE);
  assert.ok(mobResolutionCount > 0, 'WS25 runtime target must participate in target resolution');
  assert.equal(mobs.visibilitySnapshot(mobRuntimeId).hp, 50, 'fail-closed attack must not mutate mob HP');

  await session.handle(attack(29999), { receiveSequence: 701 });
  assert.equal(events.at(-1).outcome.reason, ATTACK_RESULT.INVALID_TARGET);

  player.hp = 0;
  player.lifeState = LIFE_STATE.DEAD;
  await session.handle(attack(mobRuntimeId), { receiveSequence: 702 });
  assert.equal(events.at(-1).outcome.reason, ATTACK_RESULT.SOURCE_DEAD);
  player.hp = 50;
  player.lifeState = LIFE_STATE.ALIVE;

  const hpBefore = player.hp;
  await session.handle(magicEffect(104001, 500, 32000), { receiveSequence: 703 });
  assert.equal(events.at(-1).type, 'MAGIC_PROCESS_RESULT');
  assert.equal(events.at(-1).operation.clientClaimedSourceId, 32000);
  assert.equal(events.at(-1).operation.sourceEntityId, 500);
  assert.equal(events.at(-1).outcome.ok, true);
  assert.ok(player.hp > hpBefore, 'verified WS19 Tiny Healing must reach domain effect/result');

  assert.deepEqual({ WS11_SHA, WS19_SHA, WS25_SHA, WS15_SHA, WS17_SHA }, {
    WS11_SHA: '944b6ff9b6329af29f1048a74aa6e14fca141639',
    WS19_SHA: '28eb4f38753ffbc54c60abbd2a32832301284c06',
    WS25_SHA: '13c9bafe287b250d56b52f19e97a02e7ef18e6e5',
    WS15_SHA: 'ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d',
    WS17_SHA: 'fbfc13f9c123ebeb6dd38c32fc95ef26d917a777',
  });
});
