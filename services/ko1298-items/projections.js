'use strict';

const { CONTAINER_TYPES, EQUIPMENT_SLOTS, ITEM_CLASS_IDS } = require('./constants');
const { iterateItems } = require('./inventory-state');

// Exact KO1298 __TABLE_ITEM_BASIC unit semantics:
// siAttackInterval: 100 units = 1 second -> 1 raw unit = 10 ms.
// siAttackRange: effective attack range in 0.1 meter units.
const ATTACK_INTERVAL_MS_PER_RAW_UNIT = 10;
const ATTACK_RANGE_METERS_PER_RAW_UNIT = 0.1;

const WEAPON_TYPE_NAMES = Object.freeze({
  [ITEM_CLASS_IDS.DAGGER]: 'DAGGER',
  [ITEM_CLASS_IDS.SWORD]: 'SWORD',
  [ITEM_CLASS_IDS.SWORD_2H]: 'SWORD_2H',
  [ITEM_CLASS_IDS.AXE]: 'AXE',
  [ITEM_CLASS_IDS.AXE_2H]: 'AXE_2H',
  [ITEM_CLASS_IDS.MACE]: 'MACE',
  [ITEM_CLASS_IDS.MACE_2H]: 'MACE_2H',
  [ITEM_CLASS_IDS.SPEAR]: 'SPEAR',
  [ITEM_CLASS_IDS.POLEARM]: 'POLEARM',
  [ITEM_CLASS_IDS.BOW]: 'BOW',
  [ITEM_CLASS_IDS.CROSSBOW]: 'CROSSBOW',
  [ITEM_CLASS_IDS.LONGBOW]: 'LONGBOW',
  [ITEM_CLASS_IDS.LAUNCHER]: 'LAUNCHER',
  [ITEM_CLASS_IDS.STAFF]: 'STAFF',
  [ITEM_CLASS_IDS.JAVELIN]: 'JAVELIN',
});
const SUPPORTED_COMBAT_WEAPON_TYPES = new Set(Object.keys(WEAPON_TYPE_NAMES).map(Number));

async function calculateCarriedWeight(state, templates) {
  let total = 0;
  for (const { item } of iterateItems(state, [CONTAINER_TYPES.EQUIPMENT, CONTAINER_TYPES.INVENTORY])) {
    const template = await templates.get(item.templateId);
    total += template.weight * item.quantity;
  }
  return total;
}

async function buildEquipmentSnapshot(state, templates) {
  const totals = { ac: 0, hp: 0, mp: 0, str: 0, sta: 0, dex: 0, int: 0, cha: 0, hitRate: 0, evasionRate: 0, resistances: {}, weaponArmor: {} };
  const equipped = [];
  for (let slot = 0; slot < state.equipment.length; slot++) {
    const item = state.equipment[slot];
    if (!item) continue;
    const template = await templates.get(item.templateId);
    const modifiers = template.modifiers || {};
    equipped.push(Object.freeze({ slot, serial: item.serial, templateId: item.templateId, broken: item.broken === true, durability: item.durability }));
    if (item.broken) continue;
    for (const key of ['ac','hp','mp','str','sta','dex','int','cha','hitRate','evasionRate']) totals[key] += Number(modifiers[key] ?? 0);
    for (const [key, value] of Object.entries(modifiers.resistances ?? {})) totals.resistances[key] = (totals.resistances[key] ?? 0) + Number(value);
    for (const [key, value] of Object.entries(modifiers.weaponArmor ?? {})) totals.weaponArmor[key] = (totals.weaponArmor[key] ?? 0) + Number(value);
  }
  return Object.freeze({ equipped: Object.freeze(equipped), totals: deepFreeze(totals) });
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number != null && Number.isInteger(number) ? number : null;
}

function sourceRowFor(template) {
  return template?.raw?.sourceRow ?? template?.raw?.row ?? null;
}

function sourceRefFor(template) {
  const entries = Array.isArray(template?.provenance) ? template.provenance : [];
  const preferred = entries.find(entry => /Item_Org_us\.tbl/i.test(String(entry?.ref ?? ''))) ?? entries[0];
  if (!preferred?.ref) return null;
  const ref = String(preferred.ref);
  return ref.includes('#') ? ref : `${ref}#${template.id}`;
}

function resourceIdFor(template, kind) {
  const sourceRow = sourceRowFor(template) ?? {};
  const keys = kind === 'model'
    ? ['modelResourceId', 'dwIDResrc', 'resourceId', 'ItemResource']
    : ['iconResourceId', 'dwIDIcon', 'iconId', 'IconResource'];
  for (const key of keys) {
    const value = integerOrNull(template?.raw?.[key] ?? sourceRow[key]);
    if (value != null) return value;
  }
  return null;
}

function requirementsFor(template) {
  const requirements = template?.requirements ?? {};
  const stats = requirements.stats ?? {};
  const classIds = Array.isArray(requirements.classIds) ? requirements.classIds : [];
  return Object.freeze({
    class: classIds.length === 1 ? Number(classIds[0]) : 0,
    level: Number(requirements.minLevel ?? 0),
    STR: Number(stats.str ?? 0),
    DEX: Number(stats.dex ?? 0),
    INT: Number(stats.int ?? 0),
  });
}

function classifyCombatWeapon(item, template) {
  const weapon = template?.weapon ?? {};
  const weaponTypeId = integerOrNull(weapon.kind ?? template?.itemClassId);
  const rawDamage = numberOrNull(weapon.damage);
  const rawDelay = numberOrNull(weapon.delay);
  const rawRange = numberOrNull(weapon.range);
  const sourceRef = sourceRefFor(template);
  const supported = template?.category === 'weapon' && weaponTypeId != null && SUPPORTED_COMBAT_WEAPON_TYPES.has(weaponTypeId);
  const sourceBacked = template?.verified === true && sourceRef != null;
  const unitsComplete = rawDamage != null && rawDelay != null && rawDelay > 0 && rawRange != null && rawRange > 0;

  let reason = null;
  if (!supported) reason = 'UNSUPPORTED_RIGHT_HAND_WEAPON';
  else if (!sourceBacked) reason = 'RIGHT_HAND_WEAPON_SOURCE_UNVERIFIED';
  else if (!unitsComplete) reason = 'RIGHT_HAND_WEAPON_UNIT_DATA_MISSING';
  else if (item.broken === true) reason = 'RIGHT_HAND_WEAPON_BROKEN';

  const playable = reason == null;
  const attackDelayMs = playable ? rawDelay * ATTACK_INTERVAL_MS_PER_RAW_UNIT : null;
  const weaponRangeMeters = playable ? rawRange * ATTACK_RANGE_METERS_PER_RAW_UNIT : null;

  return Object.freeze({
    serial: item.serial,
    templateId: item.templateId,
    itemId: template.id,
    name: template.name,
    broken: item.broken === true,
    playable,
    authorityStatus: playable ? 'SOURCE_BACKED' : 'FAIL_CLOSED',
    authorityReason: reason,
    kind: weaponTypeId,
    weaponType: weaponTypeId == null ? null : (WEAPON_TYPE_NAMES[weaponTypeId] ?? null),
    weaponTypeId,
    damage: item.broken === true ? 0 : rawDamage,
    rawRange,
    range: rawRange,
    weaponRange: weaponRangeMeters,
    weaponRangeMeters,
    rawDelay,
    delay: rawDelay,
    attackDelayMs,
    durability: item.durability,
    requirements: requirementsFor(template),
    modelResourceId: resourceIdFor(template, 'model'),
    iconResourceId: resourceIdFor(template, 'icon'),
    sourceRef,
  });
}

async function projectEquippedItem(item, templates) {
  if (!item) return null;
  const template = await templates.get(item.templateId);
  return classifyCombatWeapon(item, template);
}

async function buildCombatItemSnapshot(state, templates) {
  const equipment = await buildEquipmentSnapshot(state, templates);
  const right = state.equipment[EQUIPMENT_SLOTS.RIGHT_HAND];
  const left = state.equipment[EQUIPMENT_SLOTS.LEFT_HAND];
  const rightHand = await projectEquippedItem(right, templates);
  const leftHand = await projectEquippedItem(left, templates);

  const playable = rightHand?.playable === true;
  return Object.freeze({
    playable,
    authorityStatus: playable ? 'SOURCE_BACKED' : 'FAIL_CLOSED',
    authorityReason: playable ? null : (rightHand?.authorityReason ?? 'RIGHT_HAND_WEAPON_MISSING'),
    equipment,
    rightHand,
    leftHand,
    // Direct WS19 compatibility surface. These are intentionally null when WS17
    // cannot prove an equipped source-backed right-hand weapon and exact units.
    weaponRange: playable ? rightHand.weaponRange : null,
    attackDelayMs: playable ? rightHand.attackDelayMs : null,
    weaponClass: playable ? rightHand.weaponTypeId : null,
  });
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
  return Object.freeze(obj);
}

module.exports = {
  ATTACK_INTERVAL_MS_PER_RAW_UNIT,
  ATTACK_RANGE_METERS_PER_RAW_UNIT,
  WEAPON_TYPE_NAMES,
  calculateCarriedWeight,
  buildEquipmentSnapshot,
  buildCombatItemSnapshot,
};
