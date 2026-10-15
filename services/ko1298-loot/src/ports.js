import { fail } from './errors.js';

function requireMethod(port, method, name) {
  if (!port || typeof port[method] !== 'function') {
    fail('INVALID_LOOT_PORT', `${name} must implement ${method}().`, { name, method });
  }
}

export function validatePorts(ports) {
  requireMethod(ports.dropTables, 'findForMob', 'dropTables');
  requireMethod(ports.ownership, 'resolveOwners', 'ownership');
  requireMethod(ports.ownership, 'canPickup', 'ownership');
  requireMethod(ports.distance, 'canPickup', 'distance');
  requireMethod(ports.inventory, 'canAccept', 'inventory');
  requireMethod(ports.items, 'grant', 'items');
  requireMethod(ports.serials, 'createForDrop', 'serials');
  requireMethod(ports.serialGuard, 'reserve', 'serialGuard');
  requireMethod(ports.serialGuard, 'commit', 'serialGuard');
  requireMethod(ports.serialGuard, 'release', 'serialGuard');
  if (ports.coins) requireMethod(ports.coins, 'grant', 'coins');
  return ports;
}

export class KillerOwnershipPolicy {
  async resolveOwners(event) {
    return { characterIds: [event.killerCharacterId], publicAfterMs: null };
  }

  async canPickup({ loot, characterId, now }) {
    if (loot.ownerCharacterIds.includes(characterId)) return true;
    return loot.publicAt !== null && now >= loot.publicAt;
  }
}

export class InMemorySerialGuard {
  #states = new Map();

  async reserve(serial) {
    if (typeof serial !== 'string' || serial.length === 0) {
      fail('INVALID_ITEM_SERIAL', 'Item serial must be a non-empty string.', { serial });
    }
    if (this.#states.has(serial)) {
      fail('DUPLICATE_ITEM_SERIAL', 'Item serial is already reserved or committed.', { serial });
    }
    this.#states.set(serial, 'reserved');
  }

  async commit(serial) {
    if (this.#states.get(serial) !== 'reserved') {
      fail('SERIAL_RESERVATION_MISSING', 'Cannot commit an item serial that is not reserved.', { serial });
    }
    this.#states.set(serial, 'committed');
  }

  async release(serial) {
    if (this.#states.get(serial) === 'reserved') this.#states.delete(serial);
  }

  stateOf(serial) {
    return this.#states.get(serial) ?? null;
  }
}
