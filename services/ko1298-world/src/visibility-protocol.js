'use strict';

const { PacketWriter, assertIntegerRange } = require('./packet-writer');
const { OPCODE } = require('./constants');

const NPC_INOUT = Object.freeze({ IN: 0x01, OUT: 0x02 });
const I16_MIN = -0x8000;
const I16_MAX = 0x7fff;
const MAX_NAME_BYTES = 0xff;

function required(value, label) {
  if (value === undefined || value === null) throw new TypeError(`${label} is required`);
  return value;
}

function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in [${min}, ${max}], got ${String(value)}`);
  }
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function pick(primary, fallback, ...names) {
  for (const name of names) {
    if (primary && primary[name] !== undefined && primary[name] !== null) return primary[name];
    if (fallback && fallback[name] !== undefined && fallback[name] !== null) return fallback[name];
  }
  return undefined;
}

function semanticDetail(record) {
  if (!record || typeof record !== 'object') throw new TypeError('NPC visibility record is required');
  return record.visibilityRecord || record.detailRecord || record.packetReadyDetail || record;
}

function runtimeIdOf(record) {
  const detail = semanticDetail(record);
  const id = pick(record, detail, 'runtimeId', 'instanceId', 'nid');
  return integer(required(id, 'runtimeId'), I16_MIN, I16_MAX, 'runtimeId');
}

function assertAuthoritativePosition(record, detail, position) {
  const authority = detail.positionAuthority || record.positionAuthority || detail.heightAuthority || record.heightAuthority;
  if (authority && authority.status !== 'authoritative') {
    throw new Error(`runtimeId ${runtimeIdOf(record)} has non-authoritative Y (${String(authority.status)})`);
  }
  finite(position.x, 'position.x');
  finite(position.z, 'position.z');
  finite(position.y, 'position.y');
}

function latin1Name(value) {
  if (typeof value !== 'string') throw new TypeError('name must be a string');
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0xff) throw new RangeError('name must be latin1 encodable');
  }
  const bytes = Buffer.from(value, 'latin1');
  if (bytes.length > MAX_NAME_BYTES) throw new RangeError(`name exceeds ${MAX_NAME_BYTES} bytes`);
  return bytes;
}

// Exact 1298 CNpc::GetNpcInfo quirk: cast/truncate the semantic coordinate first,
// then multiply by 10. This is intentionally not Math.trunc(value * 10).
function quantizeNpcCoord(value, { signed = false, label }) {
  finite(value, label);
  const encoded = Math.trunc(value) * 10;
  const min = signed ? I16_MIN : 0;
  const max = signed ? I16_MAX : 0xffff;
  return integer(encoded, min, max, `${label} encoded`);
}

function canonicalNpcDetailRecord(record) {
  const detail = semanticDetail(record);
  const position = detail.position || record.position || detail;
  const runtimeId = runtimeIdOf(record);
  assertAuthoritativePosition(record, detail, position);

  const canonical = {
    runtimeId,
    templateResourceId: integer(required(pick(detail, record, 'templateResourceId', 'resourceId', 'pid'), 'templateResourceId'), I16_MIN, I16_MAX, 'templateResourceId'),
    npcType: integer(required(pick(detail, record, 'npcType'), 'npcType'), 0, 0xff, 'npcType'),
    sellingGroup: integer(required(pick(detail, record, 'sellingGroup'), 'sellingGroup'), 0, 0xffffffff, 'sellingGroup'),
    scale: integer(required(pick(detail, record, 'scale', 'scalePercent', 'size'), 'scale'), I16_MIN, I16_MAX, 'scale'),
    weapon1: integer(required(pick(detail, record, 'weapon1'), 'weapon1'), 0, 0xffffffff, 'weapon1'),
    weapon2: integer(required(pick(detail, record, 'weapon2'), 'weapon2'), 0, 0xffffffff, 'weapon2'),
    name: required(pick(detail, record, 'name'), 'name'),
    groupNation: integer(required(pick(detail, record, 'groupNation', 'group'), 'groupNation'), 0, 0xff, 'groupNation'),
    level: integer(required(pick(detail, record, 'level'), 'level'), 0, 0xff, 'level'),
    x: position.x,
    z: position.z,
    y: position.y,
    stateGateOpen: integer(required(pick(detail, record, 'stateGateOpen', 'gateOpen'), 'stateGateOpen'), 0, 0xffffffff, 'stateGateOpen'),
    objectType: integer(required(pick(detail, record, 'objectType'), 'objectType'), 0, 0xff, 'objectType'),
    clientIdk0: integer(pick(detail, record, 'clientIdk0', 'idk0') ?? 0, I16_MIN, I16_MAX, 'clientIdk0'),
    clientIdk1: integer(pick(detail, record, 'clientIdk1', 'idk1') ?? 0, I16_MIN, I16_MAX, 'clientIdk1'),
    direction: integer(required(pick(detail, record, 'direction'), 'direction'), 0, 0xff, 'direction'),
  };
  latin1Name(canonical.name);
  quantizeNpcCoord(canonical.x, { label: 'x' });
  quantizeNpcCoord(canonical.z, { label: 'z' });
  quantizeNpcCoord(canonical.y, { signed: true, label: 'y' });
  return Object.freeze(canonical);
}

function writeNpcDetailRecord(writer, input) {
  const record = canonicalNpcDetailRecord(input);
  const name = latin1Name(record.name);
  writer
    .i16(record.runtimeId)
    .i16(record.templateResourceId)
    .u8(record.npcType)
    .u32(record.sellingGroup)
    .i16(record.scale)
    .u32(record.weapon1)
    .u32(record.weapon2)
    .u8(name.length)
    .bytes(name)
    .u8(record.groupNation)
    .u8(record.level)
    .u16(quantizeNpcCoord(record.x, { label: 'x' }))
    .u16(quantizeNpcCoord(record.z, { label: 'z' }))
    .i16(quantizeNpcCoord(record.y, { signed: true, label: 'y' }))
    .u32(record.stateGateOpen)
    .u8(record.objectType)
    .i16(record.clientIdk0)
    .i16(record.clientIdk1)
    .u8(record.direction);
  return writer;
}

function encodeNpcDetailRecord(record) {
  return writeNpcDetailRecord(new PacketWriter(), record).toBuffer();
}

function normalizeIdList(items) {
  if (!Array.isArray(items)) throw new TypeError('NPC ID list must be an array');
  integer(items.length, 0, I16_MAX, 'NPC count');
  return items.map((item) => {
    if (Number.isInteger(item)) return integer(item, I16_MIN, I16_MAX, 'runtimeId');
    return runtimeIdOf(item);
  });
}

function buildRegionNpcIds(records = []) {
  const ids = normalizeIdList(records);
  const writer = new PacketWriter().u8(OPCODE.REGION_NPC_IDS).i16(ids.length);
  for (const id of ids) writer.i16(id);
  return writer.toBuffer();
}

function parseNpcInRequest(packet) {
  const p = Buffer.from(packet);
  if (p.length < 3 || p[0] !== OPCODE.REQUEST_NPC_IN) throw new Error('not WIZ_REQ_NPCIN');
  const count = p.readInt16LE(1);
  if (count < 0) throw new Error('WIZ_REQ_NPCIN has negative count');
  const expected = 3 + count * 2;
  if (p.length !== expected) throw new Error(`WIZ_REQ_NPCIN must be exactly ${expected} bytes`);
  const ids = [];
  for (let offset = 3; offset < expected; offset += 2) ids.push(p.readInt16LE(offset));
  return ids;
}

function buildSurroundingNpcs(records = []) {
  if (!Array.isArray(records)) throw new TypeError('NPC detail records must be an array');
  integer(records.length, 0, I16_MAX, 'NPC detail count');
  const writer = new PacketWriter().u8(OPCODE.REQUEST_NPC_IN).i16(records.length);
  for (const record of records) writeNpcDetailRecord(writer, record);
  return writer.toBuffer();
}

function buildNpcIn(record) {
  return Buffer.concat([
    Buffer.from([OPCODE.NPC_INOUT, NPC_INOUT.IN]),
    encodeNpcDetailRecord(record),
  ]);
}

function buildNpcOut(runtimeId) {
  const id = integer(runtimeId, I16_MIN, I16_MAX, 'runtimeId');
  return new PacketWriter().u8(OPCODE.NPC_INOUT).u8(NPC_INOUT.OUT).i16(id).toBuffer();
}

function assertUniqueRuntimeIds(npcs = [], mobs = []) {
  const seen = new Map();
  for (const [kind, records] of [['npc', npcs], ['mob', mobs]]) {
    for (const record of records) {
      const id = runtimeIdOf(record);
      if (seen.has(id)) throw new Error(`runtime ID collision ${id}: ${seen.get(id)} vs ${kind}`);
      seen.set(id, kind);
    }
  }
  return true;
}

module.exports = {
  NPC_INOUT,
  I16_MIN,
  I16_MAX,
  canonicalNpcDetailRecord,
  runtimeIdOf,
  quantizeNpcCoord,
  encodeNpcDetailRecord,
  buildRegionNpcIds,
  parseNpcInRequest,
  buildSurroundingNpcs,
  buildNpcIn,
  buildNpcOut,
  assertUniqueRuntimeIds,
};
