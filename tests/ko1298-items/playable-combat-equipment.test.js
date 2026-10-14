'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contract = require('../../workstreams/ws17/PLAYABLE_COMBAT_EQUIPMENT_CONTRACT.json');
const {
  ATTACK_INTERVAL_MS_PER_RAW_UNIT,
  ATTACK_RANGE_METERS_PER_RAW_UNIT,
  CONTAINER_TYPES,
  EQUIPMENT_SLOTS,
  ItemTemplateRegistry,
  Legacy1298TableAdapter,
  InMemoryItemRepository,
  ItemDomainService,
} = require('../../services/ko1298-items');

const inv = slot => ({ container: CONTAINER_TYPES.INVENTORY, slot });

function createCanonicalService() {
  const sourceWeapon = contract.canonicalStarterWeapon;
  const adapter = new Legacy1298TableAdapter({
    getRow: async itemId => Number(itemId) === sourceWeapon.itemId ? { ...sourceWeapon.sourceRow } : null,
  });
  const templates = new ItemTemplateRegistry(adapter, { requireVerifiedProvenance: true });
  const repository = new InMemoryItemRepository();
  const characterContext = async () => ({
    level: 3,
    classId: 101,
    raceId: 1,
    nationId: 1,
    stats: { str: 0, sta: 0, dex: 0, int: 0, cha: 0 },
    maxWeight: 1000,
  });
  const service = new ItemDomainService({ repository, templates, characterContext });
  return { service, repository, templates };
}

test('exact 1298 unit authority is explicit and deterministic', () => {
  assert.equal(ATTACK_INTERVAL_MS_PER_RAW_UNIT, 10);
  assert.equal(ATTACK_RANGE_METERS_PER_RAW_UNIT, 0.1);
  assert.equal(contract.canonicalStarterWeapon.rawDelay * ATTACK_INTERVAL_MS_PER_RAW_UNIT, 1140);
  assert.equal(contract.canonicalStarterWeapon.rawRange * ATTACK_RANGE_METERS_PER_RAW_UNIT, 1.0);
});

test('real WS17 composition exposes canonical Short Sword normalized combat authority', async () => {
  const { service } = createCanonicalService();
  const item = contract.canonicalStarterWeapon;

  await service.createItem('ws31-karus-warrior', inv(0), { templateId: item.itemId, serial: '120010000-1' });
  await service.equip('ws31-karus-warrior', 0, EQUIPMENT_SLOTS.RIGHT_HAND);

  const snapshot = await service.getCombatItemSnapshot('ws31-karus-warrior');
  assert.equal(snapshot.playable, true);
  assert.equal(snapshot.authorityStatus, 'SOURCE_BACKED');
  assert.equal(snapshot.authorityReason, null);

  assert.equal(snapshot.rightHand.itemId, 120010000);
  assert.equal(snapshot.rightHand.name, 'Short Sword');
  assert.equal(snapshot.rightHand.weaponType, 'SWORD');
  assert.equal(snapshot.rightHand.weaponTypeId, 21);
  assert.equal(snapshot.rightHand.damage, 4);
  assert.equal(snapshot.rightHand.rawRange, 10);
  assert.equal(snapshot.rightHand.weaponRange, 1.0);
  assert.equal(snapshot.rightHand.weaponRangeMeters, 1.0);
  assert.equal(snapshot.rightHand.rawDelay, 114);
  assert.equal(snapshot.rightHand.attackDelayMs, 1140);
  assert.equal(snapshot.rightHand.durability, 5000);
  assert.deepEqual(snapshot.rightHand.requirements, { class: 0, level: 1, STR: 0, DEX: 0, INT: 0 });
  assert.equal(snapshot.rightHand.modelResourceId, 12011000);
  assert.equal(snapshot.rightHand.iconResourceId, 12011000);
  assert.equal(snapshot.rightHand.sourceRef, 'Open-KO/ko-client-assets@b4636332c7cd818b0ce171eccc973dd3d6b2e56d:Data/Item_Org_us.tbl.csv#120010000');
});

test('WS19 compatibility surface needs no range or delay unit guessing', async () => {
  const { service } = createCanonicalService();
  const itemId = contract.canonicalStarterWeapon.itemId;
  await service.createItem('ws19-consumer', inv(0), { templateId: itemId, serial: 'ws19-weapon' });
  await service.equip('ws19-consumer', 0, EQUIPMENT_SLOTS.RIGHT_HAND);
  const snapshot = await service.getCombatItemSnapshot('ws19-consumer');

  // Mirrors ws19 createWs17EquipmentCombatPort@28eb4f3: direct top-level read only.
  const ws19View = Object.freeze({
    weaponRange: snapshot.weaponRange ?? null,
    attackDelayMs: snapshot.attackDelayMs ?? null,
  });
  assert.deepEqual(ws19View, { weaponRange: 1.0, attackDelayMs: 1140 });
});

test('missing right-hand weapon fails closed instead of looking playable', async () => {
  const { service } = createCanonicalService();
  const snapshot = await service.getCombatItemSnapshot('empty-player');
  assert.equal(snapshot.playable, false);
  assert.equal(snapshot.authorityStatus, 'FAIL_CLOSED');
  assert.equal(snapshot.authorityReason, 'RIGHT_HAND_WEAPON_MISSING');
  assert.equal(snapshot.rightHand, null);
  assert.equal(snapshot.weaponRange, null);
  assert.equal(snapshot.attackDelayMs, null);
});

test('broken canonical weapon preserves durability state but removes playable timing/range authority', async () => {
  const { service } = createCanonicalService();
  const itemId = contract.canonicalStarterWeapon.itemId;
  await service.createItem('broken-player', inv(0), { templateId: itemId, serial: 'broken-weapon', durability: 0 });
  await service.equip('broken-player', 0, EQUIPMENT_SLOTS.RIGHT_HAND);
  const snapshot = await service.getCombatItemSnapshot('broken-player');
  assert.equal(snapshot.playable, false);
  assert.equal(snapshot.authorityReason, 'RIGHT_HAND_WEAPON_BROKEN');
  assert.equal(snapshot.rightHand.damage, 0);
  assert.equal(snapshot.rightHand.attackDelayMs, null);
  assert.equal(snapshot.rightHand.weaponRange, null);
  assert.equal(snapshot.weaponRange, null);
  assert.equal(snapshot.attackDelayMs, null);
});
