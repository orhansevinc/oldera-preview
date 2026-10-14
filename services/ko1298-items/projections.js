'use strict';

const { CONTAINER_TYPES, EQUIPMENT_SLOTS } = require('./constants');
const { iterateItems } = require('./inventory-state');

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

async function buildCombatItemSnapshot(state, templates) {
  const equipment = await buildEquipmentSnapshot(state, templates);
  const right = state.equipment[EQUIPMENT_SLOTS.RIGHT_HAND];
  const left = state.equipment[EQUIPMENT_SLOTS.LEFT_HAND];
  const weaponFor = async item => {
    if (!item) return null;
    const template = await templates.get(item.templateId);
    return Object.freeze({ serial: item.serial, templateId: item.templateId, broken: !!item.broken, kind: template.weapon.kind ?? template.itemClassId, damage: item.broken ? 0 : Number(template.weapon.damage ?? 0), delay: Number(template.weapon.delay ?? 0), range: Number(template.weapon.range ?? 0), durability: item.durability });
  };
  return Object.freeze({ equipment, rightHand: await weaponFor(right), leftHand: await weaponFor(left) });
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
  return Object.freeze(obj);
}

module.exports = { calculateCarriedWeight, buildEquipmentSnapshot, buildCombatItemSnapshot };
