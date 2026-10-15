import { fail, LootDomainError } from './errors.js';
import { validateMobDeathEvent } from './model.js';
import { SeededRng } from './rng.js';
import { rollVerified1298DropTable } from './verified1298.js';
import { validateProductionLootPorts } from './productionPorts.js';

function defaultIdFactory() {
  let value = 0;
  return () => `loot-${++value}`;
}

function normalizeOwners(result, event) {
  if (!result || !Array.isArray(result.characterIds) || result.characterIds.length === 0) {
    fail('INVALID_LOOT_OWNERSHIP', 'Ownership resolver must return at least one character id.', {
      eventId: event.eventId,
      result
    });
  }

  const characterIds = [...new Set(result.characterIds)];
  if (characterIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
    fail('INVALID_LOOT_OWNERSHIP', 'Ownership character ids must be non-empty strings.', { result });
  }

  const publicAfterMs = result.publicAfterMs ?? null;
  if (publicAfterMs !== null && (!Number.isSafeInteger(publicAfterMs) || publicAfterMs < 0)) {
    fail('INVALID_LOOT_OWNERSHIP', 'publicAfterMs must be null or a non-negative safe integer.', { result });
  }
  if (publicAfterMs !== null && result.publicAfterVerified !== true) {
    fail('UNVERIFIED_PUBLIC_LOOT_POLICY', 'Public-after-time loot requires verified provenance.', { result });
  }

  return Object.freeze({
    characterIds: Object.freeze(characterIds),
    publicAfterMs
  });
}

function validateLifetime(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('INVALID_LOOT_CONFIG', 'lootLifetimeMs must be a positive safe integer.', { value });
  }
  return value;
}

export class ProductionLootService {
  #ports;
  #loot = new Map();
  #claims = new Map();
  #processedDeaths = new Map();
  #clock;
  #idFactory;
  #rngFactory;
  #lootLifetimeMs;

  constructor({
    ports,
    lootLifetimeMs = 60_000,
    clock = () => Date.now(),
    idFactory = defaultIdFactory(),
    rngFactory = (seed) => new SeededRng(seed)
  } = {}) {
    this.#ports = validateProductionLootPorts(ports ?? {});
    this.#lootLifetimeMs = validateLifetime(lootLifetimeMs);
    if (typeof clock !== 'function' || typeof idFactory !== 'function' || typeof rngFactory !== 'function') {
      fail('INVALID_LOOT_CONFIG', 'clock, idFactory and rngFactory must be functions.');
    }
    this.#clock = clock;
    this.#idFactory = idFactory;
    this.#rngFactory = rngFactory;
  }

  async createFromMobDeath(rawEvent, { seed } = {}) {
    const event = validateMobDeathEvent(rawEvent);
    if (this.#processedDeaths.has(event.eventId)) {
      return this.#processedDeaths.get(event.eventId);
    }

    const pending = this.#createDeathRewards(event, seed);
    this.#processedDeaths.set(event.eventId, pending);
    try {
      const result = await pending;
      this.#processedDeaths.set(event.eventId, result);
      return result;
    } catch (error) {
      if (this.#processedDeaths.get(event.eventId) === pending) {
        this.#processedDeaths.delete(event.eventId);
      }
      throw error;
    }
  }

  async #createDeathRewards(event, seed) {
    const persisted = await this.#ports.lootStore.loadDeathRewards(event.eventId);
    if (persisted !== null) {
      for (const record of persisted) this.#loot.set(record.lootId, record);
      return Object.freeze([...persisted]);
    }

    const table = await this.#ports.dropTables.findForMob(event.mobTemplateId);
    if (table === null) {
      await this.#persistDeathOutcome(event, [], null);
      return Object.freeze([]);
    }
    if (table.model !== 'ko1298-verified' || table.provenance?.classification !== 'verified-1298') {
      fail('UNVERIFIED_DROP_TABLE', 'Production loot accepts only verified 1298 drop tables.', {
        eventId: event.eventId,
        model: table.model,
        provenance: table.provenance
      });
    }

    const rng = this.#rngFactory(seed ?? this.#deriveSeed(event));
    const rewards = await rollVerified1298DropTable(table, rng);
    for (const reward of rewards) {
      if (reward.kind !== 'item') continue;
      const exists = await this.#ports.itemTemplates.exists({ itemId: reward.itemId });
      if (exists !== true) {
        fail('INVALID_DROP_ITEM', 'Generated item does not exist in verified item templates.', {
          itemId: reward.itemId,
          tableId: table.id
        });
      }
    }

    const ownership = normalizeOwners(await this.#ports.ownership.resolveOwners(event), event);
    const now = this.#clock();
    if (!Number.isFinite(now)) fail('INVALID_CLOCK', 'Clock must return a finite epoch timestamp.', { now });

    const spawned = rewards.map((reward) => {
      const lootId = this.#idFactory();
      if (typeof lootId !== 'string' || lootId.trim() === '' || this.#loot.has(lootId)) {
        fail('INVALID_LOOT_ID', 'idFactory must return a unique non-empty string.', { lootId });
      }
      return Object.freeze({
        lootId,
        state: 'available',
        claimed: false,
        sourceEventId: event.eventId,
        sourceMobInstanceId: event.mobInstanceId,
        sourceMobTemplateId: event.mobTemplateId,
        killerCharacterId: event.killerCharacterId,
        tableId: table.id,
        provenance: table.provenance,
        zoneId: event.zoneId,
        position: event.position,
        reward,
        ownerCharacterIds: ownership.characterIds,
        createdAt: now,
        publicAt: ownership.publicAfterMs === null ? null : now + ownership.publicAfterMs,
        expiresAt: now + this.#lootLifetimeMs
      });
    });

    await this.#persistDeathOutcome(event, spawned, table);
    for (const record of spawned) this.#loot.set(record.lootId, record);
    return Object.freeze(spawned);
  }

  async #persistDeathOutcome(event, records, table) {
    await this.#ports.transactions.run(
      { transactionId: `loot-death:${event.eventId}` },
      async (tx) => {
        await this.#ports.lootStore.persistDeathRewards({ eventId: event.eventId, records }, { tx });
        await this.#ports.audit.append({
          type: records.length === 0 ? 'loot.death.no-drop' : 'loot.spawn',
          eventId: event.eventId,
          tableId: table?.id ?? null,
          provenance: table?.provenance ?? null,
          lootIds: records.map((record) => record.lootId)
        }, { tx });
      }
    );
  }

  async pickup({ lootId, characterId, requestId }) {
    if (
      typeof lootId !== 'string' || lootId.trim() === '' ||
      typeof characterId !== 'string' || characterId.trim() === '' ||
      typeof requestId !== 'string' || requestId.trim() === ''
    ) {
      fail('INVALID_PICKUP_REQUEST', 'lootId, characterId and requestId must be non-empty strings.');
    }

    const replayKey = `${characterId}:${requestId}`;
    await this.#ports.replay.begin(replayKey);

    let loot = null;
    let serial = null;
    let serialReserved = false;
    try {
      loot = this.#loot.get(lootId) ?? null;
      if (!loot) {
        fail(
          this.#claims.has(lootId) ? 'LOOT_ALREADY_CLAIMED' : 'LOOT_NOT_FOUND',
          'Loot does not exist or is no longer available.',
          { lootId }
        );
      }

      const now = this.#clock();
      if (now >= loot.expiresAt) {
        await this.#despawnOne(loot, 'expired', now);
        fail('LOOT_EXPIRED', 'Loot has expired.', { lootId, expiresAt: loot.expiresAt, now });
      }
      if (loot.state !== 'available') {
        fail('LOOT_BUSY', 'Loot is already being claimed.', { lootId, state: loot.state });
      }

      // Synchronous in-process reservation before external async work.
      this.#loot.set(lootId, Object.freeze({ ...loot, state: 'claiming' }));

      const state = await this.#requirePlayerState(characterId, loot);
      const owned = await this.#ports.ownership.canPickup({ loot, characterId, now });
      if (!owned) {
        fail('LOOT_NOT_OWNED', 'Character is not allowed to pick up this loot.', { lootId, characterId });
      }

      const inRange = await this.#ports.distance.canPickup({
        characterId,
        zoneId: state.zoneId,
        characterPosition: state.position,
        lootPosition: loot.position,
        loot
      });
      if (!inRange) {
        fail('LOOT_OUT_OF_RANGE', 'Character is outside the allowed pickup distance.', { lootId, characterId });
      }

      const transactionId = `loot-claim:${lootId}`;
      const { receipt, claim } = await this.#ports.transactions.run(
        { transactionId },
        async (tx) => {
          // Re-check inside the durable transaction for disconnect/zone-transition races.
          await this.#requirePlayerState(characterId, loot);

          let receipt;
          if (loot.reward.kind === 'item') {
            const capacity = await this.#ports.inventory.canAccept({
              characterId,
              itemId: loot.reward.itemId,
              quantity: loot.reward.quantity,
              loot,
              tx
            });
            if (capacity !== true && capacity?.ok !== true) {
              fail('INVENTORY_CAPACITY', 'Inventory cannot accept the dropped item.', {
                lootId,
                characterId,
                capacity
              });
            }

            serial = await this.#ports.serials.createForDrop({
              characterId,
              itemId: loot.reward.itemId,
              quantity: loot.reward.quantity,
              loot,
              tx
            });
            if (serial !== null && serial !== undefined) {
              await this.#ports.serialGuard.reserve(serial, { tx });
              serialReserved = true;
            }

            await this.#ports.items.grant({
              characterId,
              itemId: loot.reward.itemId,
              quantity: loot.reward.quantity,
              serial: serial ?? null,
              source: { type: 'mob-loot', lootId, mobInstanceId: loot.sourceMobInstanceId },
              tx
            });
            if (serialReserved) await this.#ports.serialGuard.commit(serial, { tx });

            receipt = Object.freeze({
              kind: 'item',
              itemId: loot.reward.itemId,
              quantity: loot.reward.quantity,
              serial: serial ?? null
            });
          } else {
            if (!this.#ports.coins) {
              fail('COIN_PORT_REQUIRED', 'A coin grant port is required to claim coin loot.', { lootId });
            }
            await this.#ports.coins.grant({
              characterId,
              amount: loot.reward.quantity,
              source: { type: 'mob-loot', lootId, mobInstanceId: loot.sourceMobInstanceId },
              tx
            });
            receipt = Object.freeze({ kind: 'coin', quantity: loot.reward.quantity });
          }

          const claim = Object.freeze({
            lootId,
            characterId,
            claimed: true,
            transactionId,
            requestId,
            claimedAt: this.#clock(),
            reward: loot.reward
          });
          await this.#ports.lootStore.markClaimed(claim, { tx });
          await this.#ports.replay.commit(replayKey, { tx });
          await this.#ports.audit.append({ type: 'loot.claim', ...claim }, { tx });
          return { receipt, claim };
        }
      );

      this.#loot.delete(lootId);
      this.#claims.set(lootId, claim);
      return Object.freeze({ lootId, characterId, ...receipt });
    } catch (error) {
      if (serialReserved) {
        try { await this.#ports.serialGuard.release(serial); } catch { /* preserve original failure */ }
      }
      try { await this.#ports.replay.release(replayKey); } catch { /* preserve original failure */ }
      if (loot && this.#loot.has(lootId)) this.#loot.set(lootId, loot);
      throw error;
    }
  }

  async #requirePlayerState(characterId, loot) {
    const state = await this.#ports.playerState.getLootState({ characterId });
    if (!state || state.alive !== true) {
      fail('PLAYER_NOT_ALIVE', 'Dead players cannot pick up loot.', { characterId });
    }
    if (state.worldReady !== true) {
      fail('PLAYER_NOT_WORLD_READY', 'Player session is not world-ready.', { characterId });
    }
    if (state.connected === false) {
      fail('PLAYER_DISCONNECTED', 'Disconnected players cannot pick up loot.', { characterId });
    }
    if (state.zoneId !== loot.zoneId) {
      fail('PICKUP_ZONE_MISMATCH', 'Character and loot must be in the same zone.', {
        lootId: loot.lootId,
        expectedZoneId: loot.zoneId,
        zoneId: state.zoneId
      });
    }
    if (!state.position || !Number.isFinite(state.position.x) || !Number.isFinite(state.position.z)) {
      fail('INVALID_PLAYER_POSITION', 'Authoritative player position is missing.', { characterId });
    }
    return state;
  }

  async #despawnOne(loot, reason, now) {
    await this.#ports.transactions.run(
      { transactionId: `loot-despawn:${loot.lootId}` },
      async (tx) => {
        await this.#ports.lootStore.despawn({ lootIds: [loot.lootId], reason, at: now }, { tx });
        await this.#ports.audit.append({
          type: 'loot.despawn',
          lootId: loot.lootId,
          reason,
          at: now
        }, { tx });
      }
    );
    this.#loot.delete(loot.lootId);
  }

  async sweepExpired(now = this.#clock()) {
    if (!Number.isFinite(now)) fail('INVALID_CLOCK', 'Clock must return a finite epoch timestamp.', { now });
    const removed = [];
    for (const loot of [...this.#loot.values()]) {
      if (loot.state !== 'available' || now < loot.expiresAt) continue;
      await this.#despawnOne(loot, 'expired', now);
      removed.push(loot.lootId);
    }
    return Object.freeze(removed);
  }

  getLoot(lootId) {
    return this.#loot.get(lootId) ?? null;
  }

  getClaim(lootId) {
    return this.#claims.get(lootId) ?? null;
  }

  listLoot() {
    return Object.freeze([...this.#loot.values()]);
  }

  #deriveSeed(event) {
    let hash = 2166136261;
    const text = `${event.eventId}|${event.mobInstanceId}|${event.mobTemplateId}`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
}

export function isProductionLootDomainError(error, code = undefined) {
  return error instanceof LootDomainError && (code === undefined || error.code === code);
}
