'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const codec = require('../../protocol-lab/runtime/playable-combat-codec.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const GAMEPLAY = path.join(ROOT, 'protocol-lab', 'gameplay-fixtures');
const VISIBILITY = path.join(ROOT, 'protocol-lab', 'visibility-fixtures');
const RUNTIME_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'protocol-lab', 'PLAYABLE_COMBAT_RUNTIME_CODEC.json'), 'utf8'));

function fixturePayload(dir, file) {
  const raw = fs.readFileSync(path.join(dir, file));
  // Golden fixture framing is already owned/validated by WS11's Python gameplay.build_frame/parse_frame.
  // Runtime JS stays payload-only; this test only removes the already-validated fixture envelope.
  assert.equal(raw[0], 0xaa);
  assert.equal(raw[1], 0x55);
  const size = raw.readUInt16LE(2);
  assert.equal(raw.length, size + 6);
  assert.equal(raw[raw.length - 2], 0x55);
  assert.equal(raw[raw.length - 1], 0xaa);
  return raw.subarray(4, 4 + size);
}

function assertRoundTrip(encoded, decode, encodeFromDecoded) {
  const decoded = decode(encoded);
  assert.deepEqual(encodeFromDecoded(decoded), encoded);
  return decoded;
}

test('machine-readable runtime surface manifest points at the production CommonJS module', () => {
  assert.equal(RUNTIME_MANIFEST.status, 'RESOLVED');
  assert.equal(RUNTIME_MANIFEST.runtime.module, 'protocol-lab/runtime/playable-combat-codec.cjs');
  assert.equal(RUNTIME_MANIFEST.runtime.payload_only, true);
  for (const name of RUNTIME_MANIFEST.exports) assert.equal(typeof codec[name], 'function', `${name} must be exported`);
});

test('WIZ_ATTACK S2C encoder is byte-identical to success/fail/dead golden fixtures', () => {
  const base = { attackType: 'DIRECT', attackerId: 1010, targetId: 10001 };
  assert.deepEqual(codec.encodeAttackResult({ ...base, result: 'SUCCESS' }), fixturePayload(GAMEPLAY, 'game_attack_success.bin'));
  assert.deepEqual(codec.encodeAttackResult({ ...base, result: 'FAIL' }), fixturePayload(GAMEPLAY, 'game_attack_fail.bin'));
  assert.deepEqual(codec.encodeAttackResult({ ...base, result: 'SUCCESS_AND_DEAD' }), fixturePayload(GAMEPLAY, 'game_attack_dead.bin'));
  assert.deepEqual(codec.encodeAttackResult({ attackType: 'DIRECT', result: 'SUCCESS', attackerId: 10001, targetId: 1010 }), fixturePayload(GAMEPLAY, 'game_mob_attack_player_success.bin'));

  assertRoundTrip(
    codec.encodeAttackResult({ ...base, result: 'SUCCESS' }),
    codec.decodeAttackResult,
    (d) => codec.encodeAttackResult(d),
  );
});

test('WIZ_TARGET_HP C2S decode and S2C codec are exact', () => {
  assert.deepEqual(codec.decodeTargetHpQuery(Buffer.from('22112701', 'hex')), { targetId: 10001, updateImmediately: 1 });

  const initial = { targetId: 10001, updateImmediately: 1, maxHp: 100, currentHp: 100, hpDelta: 0 };
  const update = { targetId: 10001, updateImmediately: 0, maxHp: 100, currentHp: 70, hpDelta: -30 };
  assert.deepEqual(codec.encodeTargetHp(initial), fixturePayload(GAMEPLAY, 'game_target_hp_initial.bin'));
  assert.deepEqual(codec.encodeTargetHp(update), fixturePayload(GAMEPLAY, 'game_target_hp_update.bin'));
  assertRoundTrip(codec.encodeTargetHp(update), codec.decodeTargetHp, codec.encodeTargetHp);
});

test('WIZ_DEAD, player HP and player MSP match golden fixtures and round-trip', () => {
  const dead = codec.encodeDead({ targetId: 10001 });
  assert.deepEqual(dead, fixturePayload(GAMEPLAY, 'game_mob_dead.bin'));
  assertRoundTrip(dead, codec.decodeDead, codec.encodeDead);

  const hp = codec.encodePlayerHp({ maxHp: 100, currentHp: 75 });
  assert.deepEqual(hp, fixturePayload(GAMEPLAY, 'game_player_hp_damage.bin'));
  assertRoundTrip(hp, codec.decodePlayerHp, codec.encodePlayerHp);

  const msp = codec.encodePlayerMsp({ maxMsp: 100, currentMsp: 96 });
  assert.deepEqual(msp, fixturePayload(GAMEPLAY, 'game_msp_after_slash.bin'));
  assertRoundTrip(msp, codec.decodePlayerMsp, codec.encodePlayerMsp);
});

test('WIZ_MAGIC_PROCESS full 22-byte codec covers Slash 101003 EFFECTING success/miss and MAGIC_FAIL', () => {
  const success = codec.encodeSlash101003Result({ result: 'EFFECTING_SUCCESS', sourceId: 1010, targetId: 10001 });
  const miss = codec.encodeSlash101003Result({ result: 'EFFECTING_MISS', sourceId: 1010, targetId: 10001 });
  const fail = codec.encodeSlash101003Result({ result: 'MAGIC_FAIL', sourceId: 1010, targetId: 10001 });

  assert.equal(success.length, 22);
  assert.deepEqual(success, fixturePayload(GAMEPLAY, 'game_slash_effect_success.bin'));
  assert.deepEqual(miss, fixturePayload(GAMEPLAY, 'game_slash_effect_miss.bin'));
  assert.deepEqual(fail, fixturePayload(GAMEPLAY, 'game_slash_fail.bin'));

  assert.equal(codec.decodeSlash101003Result(success).result, 'EFFECTING_SUCCESS');
  assert.equal(codec.decodeSlash101003Result(miss).result, 'EFFECTING_MISS');
  assert.equal(codec.decodeSlash101003Result(fail).result, 'MAGIC_FAIL');

  const requestPayload = fixturePayload(GAMEPLAY, 'game_slash_effect_request.bin');
  const request = codec.decodeMagicProcess(requestPayload);
  assert.deepEqual(request, {
    command: 'EFFECTING', skillId: 101003, sourceId: 1010, targetId: 10001,
    data: [1, 1, 0, 0, 0, 0], wire: { command: 3 },
  });
  assert.deepEqual(codec.encodeMagicProcess(request), requestPayload);
});

test('WIZ_NPC_INOUT IN reuses exact NPC_DETAIL_RECORD layout for respawn visibility', () => {
  const expected = fixturePayload(VISIBILITY, 'monster_in_spawn.bin');
  const decoded = codec.decodeNpcIn(expected);
  assert.equal(decoded.inout, 'IN');
  assert.deepEqual(decoded.record, {
    runtime_id: 10100,
    template_resource_id: 750,
    npc_type: 0,
    selling_group: 0,
    scale_percent: 100,
    weapon_1_item_id: 0,
    weapon_2_item_id: 0,
    name_bytes: Buffer.from('Worm', 'latin1'),
    name: 'Worm',
    group_nation: 0,
    level: 1,
    x10: 3200,
    z10: 4100,
    y10: 0,
    state_gate_open: 1,
    object_type: 0,
    client_idk0: 0,
    client_idk1: 0,
    direction: 0,
  });
  assert.deepEqual(codec.encodeNpcIn(decoded.record), expected);
});

test('strict range checks reject overflow/truncation and unknown semantic enums', () => {
  assert.throws(() => codec.encodeAttackResult({ attackType: 'DIRECT', result: 'OUT_OF_RANGE', attackerId: 1, targetId: 2 }), /verified semantic enum/);
  assert.throws(() => codec.encodeAttackResult({ attackType: 'UNKNOWN', result: 'FAIL', attackerId: 1, targetId: 2 }), /verified semantic enum/);
  assert.throws(() => codec.encodeAttackResult({ attackType: 'DIRECT', result: 'FAIL', attackerId: 32768, targetId: 2 }), /attackerId out of range/);
  assert.throws(() => codec.encodeTargetHp({ targetId: 1, updateImmediately: 256, maxHp: 1, currentHp: 1, hpDelta: 0 }), /updateImmediately out of range/);
  assert.throws(() => codec.encodeTargetHp({ targetId: 1, updateImmediately: 1, maxHp: 0x100000000, currentHp: 1, hpDelta: 0 }), /maxHp out of range/);
  const npcRecord = {
    runtime_id: 10100, template_resource_id: 750, npc_type: 0, selling_group: 0,
    scale_percent: 100, weapon_1_item_id: 0, weapon_2_item_id: 0, name: 'Worm',
    group_nation: 0, level: 1, x10: 3200, z10: 4100, y10: 0,
    state_gate_open: 1, object_type: 0, client_idk0: 0, client_idk1: 0, direction: 0,
  };
  assert.throws(() => codec.encodeNpcIn({ ...npcRecord, x10: 65536 }), /x10 out of range/);
  assert.throws(() => codec.decodeAttackResult(Buffer.from([0x08, 1, 0])), /exactly 7 bytes/);

  const unknownAttack = Buffer.from('08090101000200', 'hex');
  assert.throws(() => codec.decodeAttackResult(unknownAttack), /unknown wire enum/);

  const unknownMagic = Buffer.alloc(22); unknownMagic[0] = 0x31; unknownMagic[1] = 7;
  assert.throws(() => codec.decodeMagicProcess(unknownMagic), /unknown wire enum/);
});

test('WS03 consumer contract: typed combat event maps explicit wire result through WS11 codec without encoding semantic reason', () => {
  const event = Object.freeze({
    owner: 'WS19',
    type: 'NORMAL_ATTACK_RESULT',
    actor: Object.freeze({ entityId: 1010 }),
    operation: Object.freeze({ kind: 'NORMAL_ATTACK', sourceEntityId: 1010, targetRuntimeId: 10001 }),
    outcome: Object.freeze({
      ok: false,
      reason: 'OUT_OF_RANGE',
      wire: Object.freeze({ attackType: 'DIRECT', result: 'FAIL' }),
    }),
  });

  assert.equal(event.outcome.reason, 'OUT_OF_RANGE');
  const encoded = codec.encodeAttackResult({
    attackType: event.outcome.wire.attackType,
    result: event.outcome.wire.result,
    attackerId: event.operation.sourceEntityId,
    targetId: event.operation.targetRuntimeId,
  });
  assert.deepEqual(encoded, fixturePayload(GAMEPLAY, 'game_attack_fail.bin'));
  assert.equal(codec.decodeAttackResult(encoded).result, 'FAIL');
});
