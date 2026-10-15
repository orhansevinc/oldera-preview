'use strict';

const {
  LEGACY_STACK_LIMIT,
  LEGACY_ATTACH_POINTS,
  EQUIPMENT_SLOTS,
  HAND_POLICY,
  ITEM_CLASS_IDS,
} = require('./constants');
const { fail } = require('./errors');

const OPENKO_1298_ITEM_SOURCE = 'Open-KO/ko-client-assets@b4636332c7cd818b0ce171eccc973dd3d6b2e56d:Data/Item_Org_us.tbl.csv';
const OPENKO_1298_ITEM_STRUCT = 'Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5:src/Client/WarFare/GameDef.h';

class ItemTemplateRegistry {
  constructor(adapter, { requireVerifiedProvenance = false } = {}) {
    if (!adapter || typeof adapter.get !== 'function') {
      fail('INVALID_TEMPLATE_ADAPTER', 'Template adapter must expose get(itemId).');
    }
    this.adapter = adapter;
    this.requireVerifiedProvenance = requireVerifiedProvenance;
  }

  async get(itemId) {
    const requestedId = normalizePositiveInt(itemId, 'itemId');
    const raw = await this.adapter.get(requestedId);
    if (!raw) fail('ITEM_TEMPLATE_NOT_FOUND', `Unknown item template: ${requestedId}`);

    const id = normalizePositiveInt(raw.id ?? raw.Num ?? raw.dwID ?? requestedId, 'template id');
    if (id !== requestedId) {
      fail('ITEM_ID_PROVENANCE_MISMATCH', 'Requested item id does not match the source row id.', { requestedId, sourceId: id });
    }

    const provenance = normalizeProvenance(raw.provenance ?? raw.source ?? raw.sources ?? []);
    const verified = raw.verified === true || provenance.some(x => x.patch === '1298' || /1298|Item_Org_us\.tbl/i.test(x.ref));
    if (this.requireVerifiedProvenance && !verified) {
      fail('UNVERIFIED_ITEM_TEMPLATE', `Item ${id} has no verified 1298 provenance.`, { itemId: id, provenance });
    }

    const stackable = toBoolean(raw.stackable ?? raw.countable ?? raw.Countable ?? raw.m_bCountable ?? false);
    let maxStack = Number(raw.maxStack ?? (stackable ? LEGACY_STACK_LIMIT : 1));
    if (!Number.isInteger(maxStack) || maxStack < 1) fail('INVALID_ITEM_TEMPLATE', 'maxStack must be a positive integer.', { itemId: id });
    if (!stackable) maxStack = 1;

    const maxDurability = nullableNonNegativeInt(raw.maxDurability ?? raw.Duration ?? raw.duration ?? raw.siMaxDurability ?? raw.m_sDuration, 'maxDurability', id);
    const weight = nonNegativeInt(raw.weight ?? raw.Weight ?? raw.siWeight ?? raw.m_sWeight ?? 0, 'weight', id);
    const attachPoint = nullableInt(raw.attachPoint ?? raw.byAttachPoint ?? raw.equipPositionId ?? raw.equip_position_id ?? raw.m_bSlot);
    const itemClassId = nullableInt(raw.itemClassId ?? raw.item_class_id ?? raw.byClass ?? raw.Kind ?? raw.m_bKind);

    const requirements = normalizeRequirements(raw.requirements ?? {
      minLevel: raw.ReqLevel ?? raw.reqLevel ?? raw.byReqLevel ?? raw.m_bReqLevel,
      maxLevel: raw.ReqLevelMax ?? raw.reqLevelMax ?? raw.m_bReqLevelMax,
      stats: {
        str: raw.ReqStr ?? raw.reqStr ?? raw.m_bReqStr,
        sta: raw.ReqSta ?? raw.reqSta ?? raw.m_bReqSta,
        dex: raw.ReqDex ?? raw.reqDex ?? raw.m_bReqDex,
        int: raw.ReqIntel ?? raw.reqIntel ?? raw.m_bReqIntel,
        cha: raw.ReqCha ?? raw.reqCha ?? raw.m_bReqCha,
      },
      classIds: raw.classRequirementIds,
      raceIds: raw.raceRestrictionIds,
      nationIds: raw.nationRestrictionIds,
    });

    const template = {
      id,
      name: String(raw.name ?? raw.strName ?? raw.szName ?? `item-${id}`),
      category: String(raw.category ?? deriveCategory(itemClassId)),
      itemClassId,
      attachPoint,
      stackable,
      maxStack,
      maxDurability,
      weight,
      weightUnit: 'legacy-tenths',
      allowedEquipmentSlots: normalizeSlots(raw.allowedEquipmentSlots ?? resolveLegacyAttachPoint(attachPoint)),
      handPolicy: raw.handPolicy ?? handPolicyForAttachPoint(attachPoint),
      requirements,
      modifiers: freezePlain(raw.modifiers ?? {}),
      weapon: freezePlain(raw.weapon ?? normalizeWeapon(raw)),
      armor: freezePlain(raw.armor ?? normalizeArmor(raw)),
      provenance,
      verified,
      raw,
    };
    return Object.freeze(template);
  }
}

class Legacy1298TableAdapter {
  constructor({
    getRow,
    slotResolver = row => resolveLegacyAttachPoint(row.byAttachPoint ?? row.equip_position_id ?? row.m_bSlot),
    restrictionResolver = () => ({}),
    categoryResolver = row => deriveCategory(row.byClass ?? row.item_class_id ?? row.m_bKind),
    modifierResolver = () => ({}),
    provenanceResolver = row => row.source ?? row.provenance ?? [
      { kind: 'CLIENT_TBL', ref: OPENKO_1298_ITEM_SOURCE, patch: '1298' },
      { kind: 'STRUCT', ref: OPENKO_1298_ITEM_STRUCT, patch: '1298' },
    ],
  }) {
    if (typeof getRow !== 'function') fail('INVALID_TABLE_ADAPTER', 'getRow must be a function.');
    for (const [name, fn] of Object.entries({ slotResolver, restrictionResolver, categoryResolver, modifierResolver, provenanceResolver })) {
      if (typeof fn !== 'function') fail('INVALID_TABLE_ADAPTER', `${name} must be a function.`);
    }
    Object.assign(this, { getRow, slotResolver, restrictionResolver, categoryResolver, modifierResolver, provenanceResolver });
  }

  async get(itemId) {
    const row = await this.getRow(itemId);
    if (!row) return null;
    const sourceId = Number(row.Num ?? row.dwID ?? row.id ?? itemId);
    const restrictions = await this.restrictionResolver(row);
    return {
      id: sourceId,
      name: row.strName ?? row.szName ?? row.name,
      countable: row.Countable ?? row.m_bCountable ?? row.countable ?? false,
      maxStack: row.maxStack ?? LEGACY_STACK_LIMIT,
      maxDurability: row.Duration ?? row.siMaxDurability ?? row.m_sDuration ?? row.duration ?? null,
      weight: row.Weight ?? row.siWeight ?? row.m_sWeight ?? row.weight ?? 0,
      attachPoint: row.byAttachPoint ?? row.equip_position_id ?? row.m_bSlot ?? null,
      itemClassId: row.byClass ?? row.item_class_id ?? row.Kind ?? row.m_bKind ?? null,
      allowedEquipmentSlots: await this.slotResolver(row),
      requirements: {
        minLevel: row.ReqLevel ?? row.m_bReqLevel ?? null,
        maxLevel: row.ReqLevelMax ?? row.m_bReqLevelMax ?? null,
        stats: {
          str: row.ReqStr ?? row.m_bReqStr ?? 0,
          sta: row.ReqSta ?? row.m_bReqSta ?? 0,
          dex: row.ReqDex ?? row.m_bReqDex ?? 0,
          int: row.ReqIntel ?? row.m_bReqIntel ?? 0,
          cha: row.ReqCha ?? row.m_bReqCha ?? 0,
        },
        ...restrictions,
      },
      category: await this.categoryResolver(row),
      modifiers: await this.modifierResolver(row),
      weapon: normalizeWeapon(row),
      armor: normalizeArmor(row),
      provenance: await this.provenanceResolver(row),
      verified: true,
      sourceRow: row,
    };
  }
}

function resolveLegacyAttachPoint(value) {
  if (value == null) return [];
  switch (Number(value)) {
    case LEGACY_ATTACH_POINTS.DUAL: return [EQUIPMENT_SLOTS.RIGHT_HAND, EQUIPMENT_SLOTS.LEFT_HAND];
    case LEGACY_ATTACH_POINTS.RIGHT_HAND:
    case LEGACY_ATTACH_POINTS.TWO_HAND_RIGHT: return [EQUIPMENT_SLOTS.RIGHT_HAND];
    case LEGACY_ATTACH_POINTS.LEFT_HAND:
    case LEGACY_ATTACH_POINTS.TWO_HAND_LEFT: return [EQUIPMENT_SLOTS.LEFT_HAND];
    case LEGACY_ATTACH_POINTS.UPPER: return [EQUIPMENT_SLOTS.BREAST];
    case LEGACY_ATTACH_POINTS.LOWER: return [EQUIPMENT_SLOTS.LEG];
    case LEGACY_ATTACH_POINTS.HEAD: return [EQUIPMENT_SLOTS.HEAD];
    case LEGACY_ATTACH_POINTS.GLOVES: return [EQUIPMENT_SLOTS.GLOVE];
    case LEGACY_ATTACH_POINTS.SHOES: return [EQUIPMENT_SLOTS.FOOT];
    case LEGACY_ATTACH_POINTS.EAR: return [EQUIPMENT_SLOTS.RIGHT_EAR, EQUIPMENT_SLOTS.LEFT_EAR];
    case LEGACY_ATTACH_POINTS.NECK: return [EQUIPMENT_SLOTS.NECK];
    case LEGACY_ATTACH_POINTS.FINGER: return [EQUIPMENT_SLOTS.RIGHT_RING, EQUIPMENT_SLOTS.LEFT_RING];
    case LEGACY_ATTACH_POINTS.SHOULDER: return [EQUIPMENT_SLOTS.SHOULDER];
    case LEGACY_ATTACH_POINTS.BELT: return [EQUIPMENT_SLOTS.WAIST];
    case LEGACY_ATTACH_POINTS.INVENTORY: return [];
    default: return [];
  }
}

function handPolicyForAttachPoint(value) {
  switch (Number(value)) {
    case LEGACY_ATTACH_POINTS.DUAL: return HAND_POLICY.DUAL;
    case LEGACY_ATTACH_POINTS.RIGHT_HAND: return HAND_POLICY.RIGHT;
    case LEGACY_ATTACH_POINTS.LEFT_HAND: return HAND_POLICY.LEFT;
    case LEGACY_ATTACH_POINTS.TWO_HAND_RIGHT: return HAND_POLICY.TWO_HAND_RIGHT;
    case LEGACY_ATTACH_POINTS.TWO_HAND_LEFT: return HAND_POLICY.TWO_HAND_LEFT;
    default: return HAND_POLICY.NONE;
  }
}

function deriveCategory(itemClassId) {
  const id = Number(itemClassId);
  if ([11,21,22,31,32,41,42,51,52,70,71,80,100,110,130].includes(id)) return 'weapon';
  if (id === ITEM_CLASS_IDS.SHIELD) return 'shield';
  if ([91,92,93,94].includes(id)) return 'jewelry';
  if ([210,220,230,240].includes(id)) return 'armor';
  if ([97,98,255].includes(id)) return 'consumable';
  if (id === 120) return 'ammunition';
  if ([95,96,251].includes(id)) return 'misc';
  return 'unknown';
}

function normalizeRequirements(input = {}) {
  const stats = input.stats ?? {};
  return Object.freeze({
    minLevel: nonNegativeInt(input.minLevel ?? 0, 'minLevel'),
    maxLevel: nullableNonNegativeInt(input.maxLevel, 'maxLevel'),
    classIds: normalizeIdList(input.classIds),
    raceIds: normalizeIdList(input.raceIds),
    nationIds: normalizeIdList(input.nationIds),
    stats: Object.freeze({
      str: nonNegativeInt(stats.str ?? 0, 'req.str'),
      sta: nonNegativeInt(stats.sta ?? 0, 'req.sta'),
      dex: nonNegativeInt(stats.dex ?? 0, 'req.dex'),
      int: nonNegativeInt(stats.int ?? 0, 'req.int'),
      cha: nonNegativeInt(stats.cha ?? 0, 'req.cha'),
    }),
  });
}

function normalizeWeapon(raw) {
  const damage = raw.damage ?? raw.Damage ?? raw.siDamage ?? raw.m_sDamage;
  const delay = raw.delay ?? raw.Delay ?? raw.siAttackInterval ?? raw.m_sDelay;
  const range = raw.range ?? raw.Range ?? raw.siAttackRange ?? raw.m_sRange;
  if (damage == null && delay == null && range == null) return {};
  return { damage: Number(damage ?? 0), delay: Number(delay ?? 0), range: Number(range ?? 0), kind: raw.weaponKind ?? raw.itemClassId ?? raw.byClass ?? raw.m_bKind ?? null };
}

function normalizeArmor(raw) {
  const ac = raw.ac ?? raw.Ac ?? raw.siDefense ?? raw.m_sAc;
  if (ac == null) return {};
  return { ac: Number(ac) };
}

function normalizeSlots(slots) {
  if (slots == null) return [];
  if (!Array.isArray(slots)) fail('INVALID_ITEM_TEMPLATE', 'allowedEquipmentSlots must be an array.');
  const normalized = [...new Set(slots.map(Number))];
  for (const slot of normalized) if (!Number.isInteger(slot) || slot < 0 || slot > 13) fail('INVALID_ITEM_TEMPLATE', 'Equipment slot must be between 0 and 13.', { slot });
  return Object.freeze(normalized);
}

function normalizeIdList(value) {
  if (value == null) return Object.freeze([]);
  const values = Array.isArray(value) ? value : [value];
  const normalized = [...new Set(values.map(Number).filter(Number.isInteger))];
  return Object.freeze(normalized);
}

function normalizeProvenance(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return Object.freeze(list.map(entry => typeof entry === 'string' ? Object.freeze({ ref: entry }) : Object.freeze({ ...entry })));
}

function toBoolean(value) { return value === true || value === 1 || value === '1'; }
function nullableInt(value) { return value == null || value === '' ? null : Number(value); }
function normalizePositiveInt(value, name) { const n = Number(value); if (!Number.isInteger(n) || n <= 0) fail('INVALID_ITEM_TEMPLATE', `${name} must be a positive integer.`, { value }); return n; }
function nonNegativeInt(value, name, itemId) { const n = Number(value); if (!Number.isInteger(n) || n < 0) fail('INVALID_ITEM_TEMPLATE', `${name} must be a non-negative integer.`, { itemId, value }); return n; }
function nullableNonNegativeInt(value, name, itemId) { return value == null || value === '' ? null : nonNegativeInt(value, name, itemId); }
function freezePlain(value) { return Object.freeze({ ...(value || {}) }); }

module.exports = {
  ItemTemplateRegistry,
  Legacy1298TableAdapter,
  resolveLegacyAttachPoint,
  handPolicyForAttachPoint,
  deriveCategory,
  OPENKO_1298_ITEM_SOURCE,
  OPENKO_1298_ITEM_STRUCT,
};
