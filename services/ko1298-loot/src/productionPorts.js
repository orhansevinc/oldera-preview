import { fail } from './errors.js';

function requireMethod(port, method, name) {
  if (!port || typeof port[method] !== 'function') {
    fail('INVALID_PRODUCTION_LOOT_PORT', `${name} must implement ${method}().`, { name, method });
  }
}

export function validateProductionLootPorts(ports) {
  requireMethod(ports.dropTables, 'findForMob', 'dropTables');
  requireMethod(ports.ownership, 'resolveOwners', 'ownership');
  requireMethod(ports.ownership, 'canPickup', 'ownership');
  requireMethod(ports.playerState, 'getLootState', 'playerState');
  requireMethod(ports.distance, 'canPickup', 'distance');
  requireMethod(ports.itemTemplates, 'exists', 'itemTemplates');
  requireMethod(ports.inventory, 'canAccept', 'inventory');
  requireMethod(ports.items, 'grant', 'items');
  requireMethod(ports.serials, 'createForDrop', 'serials');
  requireMethod(ports.serialGuard, 'reserve', 'serialGuard');
  requireMethod(ports.serialGuard, 'commit', 'serialGuard');
  requireMethod(ports.serialGuard, 'release', 'serialGuard');
  if (ports.coins) requireMethod(ports.coins, 'grant', 'coins');
  requireMethod(ports.transactions, 'run', 'transactions');
  requireMethod(ports.lootStore, 'loadDeathRewards', 'lootStore');
  requireMethod(ports.lootStore, 'persistDeathRewards', 'lootStore');
  requireMethod(ports.lootStore, 'markClaimed', 'lootStore');
  requireMethod(ports.lootStore, 'despawn', 'lootStore');
  requireMethod(ports.replay, 'begin', 'replay');
  requireMethod(ports.replay, 'commit', 'replay');
  requireMethod(ports.replay, 'release', 'replay');
  requireMethod(ports.audit, 'append', 'audit');
  return ports;
}

export class InMemoryTransactionalSerialGuard {
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
    this.#states.delete(serial);
  }

  stateOf(serial) {
    return this.#states.get(serial) ?? null;
  }
}

export class InMemoryReplayGuard {
  #states = new Map();

  async begin(key) {
    if (typeof key !== 'string' || key.length === 0) {
      fail('INVALID_REPLAY_KEY', 'Replay key must be a non-empty string.', { key });
    }
    if (this.#states.has(key)) {
      fail('PICKUP_REPLAY', 'Pickup request was already seen.', {
        key,
        state: this.#states.get(key)
      });
    }
    this.#states.set(key, 'reserved');
  }

  async commit(key) {
    if (this.#states.get(key) !== 'reserved') {
      fail('PICKUP_REPLAY_STATE', 'Pickup replay reservation is missing.', { key });
    }
    this.#states.set(key, 'committed');
  }

  async release(key) {
    this.#states.delete(key);
  }

  stateOf(key) {
    return this.#states.get(key) ?? null;
  }
}

export class InMemoryLootStore {
  #deathRewards = new Map();
  #claims = new Map();
  #despawned = new Set();

  async loadDeathRewards(eventId) {
    if (!this.#deathRewards.has(eventId)) return null;
    const records = this.#deathRewards.get(eventId);
    return Object.freeze(records.filter(
      (record) => !this.#claims.has(record.lootId) && !this.#despawned.has(record.lootId)
    ));
  }

  async persistDeathRewards({ eventId, records }) {
    if (this.#deathRewards.has(eventId)) {
      fail('DUPLICATE_DEATH_TRANSACTION', 'Death rewards already persisted.', { eventId });
    }
    this.#deathRewards.set(eventId, Object.freeze([...records]));
  }

  async markClaimed(claim) {
    if (this.#claims.has(claim.lootId)) {
      fail('DUPLICATE_LOOT_CLAIM', 'Loot was already claimed.', { lootId: claim.lootId });
    }
    this.#claims.set(claim.lootId, Object.freeze({ ...claim }));
  }

  async despawn({ lootIds }) {
    for (const lootId of lootIds) this.#despawned.add(lootId);
  }

  claimOf(lootId) {
    return this.#claims.get(lootId) ?? null;
  }

  wasDespawned(lootId) {
    return this.#despawned.has(lootId);
  }
}

export class InlineTransactionPort {
  async run({ transactionId }, fn) {
    return fn(Object.freeze({ transactionId }));
  }
}

export class NoopAuditPort {
  async append() {}
}
