import { fail } from './errors.js';

const ENTRY_KINDS = new Set(['item', 'coin', 'none']);

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_DROP_TABLE', `${field} must be a non-empty string.`, { field, value });
  }
  return value;
}

function requirePositiveSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('INVALID_DROP_TABLE', `${field} must be a positive safe integer.`, { field, value });
  }
  return value;
}

function normalizeQuantity(entry) {
  const min = entry.minQuantity ?? 1;
  const max = entry.maxQuantity ?? min;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min <= 0 || max <= 0 || min > max) {
    fail('INVALID_DROP_TABLE', 'Drop quantity range must use positive safe integers with min <= max.', {
      minQuantity: min,
      maxQuantity: max,
      entry
    });
  }
  return { minQuantity: min, maxQuantity: max };
}

export function validateDropTable(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('INVALID_DROP_TABLE', 'Drop table must be an object.');
  }

  const id = requireNonEmptyString(input.id, 'id');
  const rolls = requirePositiveSafeInteger(input.rolls ?? 1, 'rolls');
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    fail('INVALID_DROP_TABLE', 'Drop table entries must be a non-empty array.', { id });
  }

  let totalWeight = 0;
  const entries = input.entries.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail('INVALID_DROP_TABLE', 'Drop entry must be an object.', { id, index });
    }
    if (!ENTRY_KINDS.has(raw.kind)) {
      fail('INVALID_DROP_TABLE', 'Drop entry kind must be item, coin, or none.', { id, index, kind: raw.kind });
    }
    const weight = requirePositiveSafeInteger(raw.weight, `entries[${index}].weight`);
    totalWeight += weight;
    if (!Number.isSafeInteger(totalWeight)) {
      fail('INVALID_DROP_TABLE', 'Total drop weight exceeds safe integer range.', { id });
    }

    if (raw.kind === 'none') {
      return Object.freeze({ kind: 'none', weight });
    }

    const quantity = normalizeQuantity(raw);
    if (raw.kind === 'item') {
      const itemId = requirePositiveSafeInteger(raw.itemId, `entries[${index}].itemId`);
      return Object.freeze({ kind: 'item', weight, itemId, ...quantity });
    }

    return Object.freeze({ kind: 'coin', weight, ...quantity });
  });

  if (totalWeight <= 0) {
    fail('INVALID_DROP_TABLE', 'Drop table total weight must be positive.', { id });
  }

  return Object.freeze({ id, rolls, totalWeight, entries: Object.freeze(entries) });
}

export function rollDropTable(tableInput, rng) {
  const table = validateDropTable(tableInput);
  if (!rng || typeof rng.nextIntInclusive !== 'function') {
    fail('INVALID_RNG', 'A RNG implementing nextIntInclusive(min, max) is required.');
  }

  const rewards = [];
  for (let roll = 0; roll < table.rolls; roll += 1) {
    const ticket = rng.nextIntInclusive(1, table.totalWeight);
    let cursor = 0;
    let selected;
    for (const entry of table.entries) {
      cursor += entry.weight;
      if (ticket <= cursor) {
        selected = entry;
        break;
      }
    }
    if (!selected) {
      fail('DROP_ROLL_INVARIANT', 'Weighted drop selection failed despite a validated table.', {
        tableId: table.id,
        ticket,
        totalWeight: table.totalWeight
      });
    }
    if (selected.kind === 'none') continue;

    const quantity = rng.nextIntInclusive(selected.minQuantity, selected.maxQuantity);
    rewards.push(Object.freeze(
      selected.kind === 'item'
        ? { kind: 'item', itemId: selected.itemId, quantity }
        : { kind: 'coin', quantity }
    ));
  }
  return Object.freeze(rewards);
}

export function validateMobDeathEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    fail('INVALID_MOB_DEATH_EVENT', 'Mob death event must be an object.');
  }
  for (const field of ['eventId', 'mobInstanceId', 'killerCharacterId']) {
    if (typeof event[field] !== 'string' || event[field].trim() === '') {
      fail('INVALID_MOB_DEATH_EVENT', `${field} must be a non-empty string.`, { field, value: event[field] });
    }
  }
  if (!Number.isSafeInteger(event.mobTemplateId) || event.mobTemplateId <= 0) {
    fail('INVALID_MOB_DEATH_EVENT', 'mobTemplateId must be a positive safe integer.', { value: event.mobTemplateId });
  }
  if (!Number.isSafeInteger(event.zoneId) || event.zoneId <= 0) {
    fail('INVALID_MOB_DEATH_EVENT', 'zoneId must be a positive safe integer.', { value: event.zoneId });
  }
  const { position } = event;
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) {
    fail('INVALID_MOB_DEATH_EVENT', 'position.x and position.z must be finite numbers.', { position });
  }

  return Object.freeze({
    eventId: event.eventId,
    mobInstanceId: event.mobInstanceId,
    mobTemplateId: event.mobTemplateId,
    killerCharacterId: event.killerCharacterId,
    zoneId: event.zoneId,
    position: Object.freeze({ x: position.x, z: position.z }),
    diedAt: event.diedAt ?? null,
    context: event.context ?? null
  });
}
