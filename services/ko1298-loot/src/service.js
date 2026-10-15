import { fail, LootDomainError } from './errors.js';
import { rollDropTable, validateDropTable, validateMobDeathEvent } from './model.js';
import { SeededRng } from './rng.js';
import { validatePorts } from './ports.js';

function normalizeOwners(result, event) {
  if (!result || !Array.isArray(result.characterIds) || result.characterIds.length === 0) {
    fail('INVALID_LOOT_OWNERSHIP', 'Ownership resolver must return at least one character id.', {
      eventId: event.eventId,
      result
    });
  }
  const ids = [...new Set(result.characterIds)];
  if (ids.some((id) => typeof id !== 'string' || id.trim() === '')) {
    fail('INVALID_LOOT_OWNERSHIP', 'Ownership character ids must be non-empty strings.', { result });
  }
  const publicAfterMs = result.publicAfterMs ?? null;
  if (publicAfterMs !== null && (!Number.isSafeInteger(publicAfterMs) || publicAfterMs < 0)) {
    fail('INVALID_LOOT_OWNERSHIP', 'publicAfterMs must be null or a non-negative safe integer.', { result });
  }
  return { characterIds: Object.freeze(ids), publicAfterMs };
}

function ensurePositiveLifetime(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('INVALID_LOOT_CONFIG', 'lootLifetimeMs must be a positive safe integer.', { value });
  }
  return value;
}

function defaultIdFactory() {
  let value = 0;
  return () => `loot-${++value}`;
}

export class LootService {
  #ports;
  #loot = new Map();
  #processedDeathEvents = new Map();
  #clock;
  #idFactory;
  #rngFactory;
  #lootLifetimeMs;

  constructor({ ports, lootLifetimeMs = 60_000, clock = () => Date.now(), idFactory = defaultIdFactory(), rngFactory } = {}) {
    this.#ports = validatePorts(ports ?? {});
    this.#lootLifetimeMs = ensurePositiveLifetime(lootLifetimeMs);
    if (typeof clock !== 'function' || typeof idFactory !== 'function') {
      fail('INVALID_LOOT_CONFIG', 'clock and idFactory must be functions.');
    }
    this.#clock = clock;
    this.#idFactory = idFactory;
    this.#rngFactory = rngFactory ?? ((seed) => new SeededRng(seed));
  }

  async createFromMobDeath(rawEvent, { seed } = {}) {
    const event = validateMobDeathEvent(rawEvent);
    if (this.#processedDeathEvents.has(event.eventId)) {
      return this.#processedDeathEvents.get(event.eventId);
    }

    const pending = this.#createDeathRewards(event, seed);
    this.#processedDeathEvents.set(event.eventId, pending);
    try {
      const result = await pending;
      this.#processedDeathEvents.set(event.eventId, result);
      return result;
    } catch (error) {
      if (this.#processedDeathEvents.get(event.eventId) === pending) {
        this.#processedDeathEvents.delete(event.eventId);
      }
      throw error;
    }
  }

  async #createDeathRewards(event, seed) {
    const rawTable = await this.#ports.dropTables.findForMob(event.mobTemplateId);
    if (rawTable == null) return Object.freeze([]);

    const table = validateDropTable(rawTable);
    const rng = this.#rngFactory(seed ?? this.#deriveSeed(event));
    const rewards = rollDropTable(table, rng);
    const ownership = normalizeOwners(await this.#ports.ownership.resolveOwners(event), event);
    const now = this.#clock();
    if (!Number.isFinite(now)) fail('INVALID_CLOCK', 'Clock must return a finite epoch timestamp.', { now });

    const spawned = rewards.map((reward) => {
      const lootId = this.#idFactory();
      if (typeof lootId !== 'string' || lootId.trim() === '' || this.#loot.has(lootId)) {
        fail('INVALID_LOOT_ID', 'idFactory must return a unique non-empty string.', { lootId });
      }
      const record = Object.freeze({
        lootId,
        state: 'available',
        sourceEventId: event.eventId,
        sourceMobInstanceId: event.mobInstanceId,
        sourceMobTemplateId: event.mobTemplateId,
        killerCharacterId: event.killerCharacterId,
        tableId: table.id,
        zoneId: event.zoneId,
        position: event.position,
        reward,
        ownerCharacterIds: ownership.characterIds,
        createdAt: now,
        publicAt: ownership.publicAfterMs === null ? null : now + ownership.publicAfterMs,
        expiresAt: now + this.#lootLifetimeMs
      });
      this.#loot.set(lootId, record);
      return record;
    });

    return Object.freeze(spawned);
  }

  async pickup({ lootId, characterId, zoneId, position }) {
    if (typeof lootId !== 'string' || typeof characterId !== 'string' || characterId.trim() === '') {
      fail('INVALID_PICKUP_REQUEST', 'lootId and characterId must be non-empty strings.');
    }
    const loot = this.#loot.get(lootId);
    if (!loot) fail('LOOT_NOT_FOUND', 'Loot does not exist or is no longer available.', { lootId });

    const now = this.#clock();
    if (now >= loot.expiresAt) {
      this.#loot.delete(lootId);
      fail('LOOT_EXPIRED', 'Loot has expired.', { lootId, expiresAt: loot.expiresAt, now });
    }
    if (loot.state !== 'available') {
      fail('LOOT_BUSY', 'Loot is already being claimed.', { lootId, state: loot.state });
    }
    if (zoneId !== loot.zoneId) {
      fail('PICKUP_ZONE_MISMATCH', 'Character and loot must be in the same zone.', { lootId, expectedZoneId: loot.zoneId, zoneId });
    }

    // Reserve the loot synchronously before any external async validation.
    // This prevents two concurrent pickup calls from both reaching grant side effects.
    this.#loot.set(lootId, Object.freeze({ ...loot, state: 'claiming' }));
    try {
      const owned = await this.#ports.ownership.canPickup({ loot, characterId, now });
      if (!owned) fail('LOOT_NOT_OWNED', 'Character is not allowed to pick up this loot.', { lootId, characterId });

      const inRange = await this.#ports.distance.canPickup({
        characterId,
        zoneId,
        characterPosition: position,
        lootPosition: loot.position,
        loot
      });
      if (!inRange) fail('LOOT_OUT_OF_RANGE', 'Character is outside the allowed pickup distance.', { lootId, characterId });

      const receipt = loot.reward.kind === 'item'
        ? await this.#pickupItem(loot, characterId)
        : await this.#pickupCoin(loot, characterId);
      this.#loot.delete(lootId);
      return Object.freeze({ lootId, characterId, ...receipt });
    } catch (error) {
      if (this.#loot.has(lootId)) this.#loot.set(lootId, loot);
      throw error;
    }
  }

  async #pickupItem(loot, characterId) {
    const capacity = await this.#ports.inventory.canAccept({
      characterId,
      itemId: loot.reward.itemId,
      quantity: loot.reward.quantity,
      loot
    });
    if (capacity !== true && capacity?.ok !== true) {
      fail('INVENTORY_CAPACITY', 'Inventory cannot accept the dropped item.', {
        lootId: loot.lootId,
        characterId,
        capacity
      });
    }

    const serial = await this.#ports.serials.createForDrop({
      characterId,
      itemId: loot.reward.itemId,
      quantity: loot.reward.quantity,
      loot
    });
    let reserved = false;
    try {
      if (serial !== null && serial !== undefined) {
        await this.#ports.serialGuard.reserve(serial);
        reserved = true;
      }
      await this.#ports.items.grant({
        characterId,
        itemId: loot.reward.itemId,
        quantity: loot.reward.quantity,
        serial: serial ?? null,
        source: { type: 'mob-loot', lootId: loot.lootId, mobInstanceId: loot.sourceMobInstanceId }
      });
      if (reserved) await this.#ports.serialGuard.commit(serial);
      return { kind: 'item', itemId: loot.reward.itemId, quantity: loot.reward.quantity, serial: serial ?? null };
    } catch (error) {
      if (reserved) {
        try { await this.#ports.serialGuard.release(serial); } catch { /* preserve original failure */ }
      }
      throw error;
    }
  }

  async #pickupCoin(loot, characterId) {
    if (!this.#ports.coins) {
      fail('COIN_PORT_REQUIRED', 'A coin grant port is required to claim coin loot.', { lootId: loot.lootId });
    }
    await this.#ports.coins.grant({
      characterId,
      amount: loot.reward.quantity,
      source: { type: 'mob-loot', lootId: loot.lootId, mobInstanceId: loot.sourceMobInstanceId }
    });
    return { kind: 'coin', quantity: loot.reward.quantity };
  }

  sweepExpired(now = this.#clock()) {
    if (!Number.isFinite(now)) fail('INVALID_CLOCK', 'Clock must return a finite epoch timestamp.', { now });
    const removed = [];
    for (const [lootId, loot] of this.#loot.entries()) {
      if (loot.state === 'available' && now >= loot.expiresAt) {
        this.#loot.delete(lootId);
        removed.push(lootId);
      }
    }
    return Object.freeze(removed);
  }

  getLoot(lootId) {
    return this.#loot.get(lootId) ?? null;
  }

  listLoot() {
    return Object.freeze([...this.#loot.values()]);
  }

  #deriveSeed(event) {
    let hash = 2166136261;
    const text = `${event.eventId}|${event.mobInstanceId}|${event.mobTemplateId}`;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
}

export function isLootDomainError(error, code = undefined) {
  return error instanceof LootDomainError && (code === undefined || error.code === code);
}
