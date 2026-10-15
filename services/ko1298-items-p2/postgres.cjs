'use strict';
const crypto = require('node:crypto');
const { PROTOCOL_MAX_COIN_VALUE } = require('../ko1298-economy/src/domain.cjs');

class PgP208Error extends Error {
  constructor(code, message, details) { super(message); this.name = 'PgP208Error'; this.code = code; this.details = details; }
}
function safeJson(value) {
  return JSON.parse(JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
}
function opKey(operationId) {
  const hash = crypto.createHash('sha256').update(String(operationId)).digest('hex');
  return `p208:op:${hash}`;
}
function normalizeAmount(value) {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n || n > PROTOCOL_MAX_COIN_VALUE) throw new PgP208Error('COIN_RANGE', 'coin amount outside verified uint32 transport range');
  return n;
}
function placementSpec(kind) {
  if (kind === 'inventory') return { table: 'oldko.inventory', owner: 'character_id', hasPage: false, maxSlot: 27 };
  if (kind === 'equipment') return { table: 'oldko.character_items', owner: 'character_id', hasPage: false, maxSlot: 13 };
  if (kind === 'inn') return { table: 'oldko.inn_storage', owner: 'account_id', hasPage: true, maxSlot: 27 };
  throw new PgP208Error('INVALID_PLACEMENT', `unsupported placement ${kind}`);
}
function assertSlot(spec, location) {
  if (!Number.isInteger(location.slot) || location.slot < 0 || location.slot > spec.maxSlot) throw new PgP208Error('INVALID_SLOT', 'invalid placement slot');
  if (spec.hasPage && (!Number.isInteger(location.page) || location.page < 0 || location.page > 6)) throw new PgP208Error('INVALID_PAGE', 'Inn page must be 0..6');
}

class PgP208TransactionManager {
  constructor(pool, { maxRetries = 3 } = {}) { this.pool = pool; this.maxRetries = maxRetries; }
  async runOnce({ operationId, kind, lockKeys = [] }, work) {
    if (!operationId || !kind) throw new PgP208Error('INVALID_OPERATION', 'operationId and kind are required');
    let attempt = 0;
    for (;;) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        for (const key of [...new Set(lockKeys.map(String))].sort()) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
        }
        const key = opKey(operationId);
        const inserted = await client.query(
          `INSERT INTO oldko.server_state(key,value) VALUES($1,$2::jsonb) ON CONFLICT (key) DO NOTHING RETURNING key`,
          [key, JSON.stringify({ owner: 'P2-08', operationId: String(operationId), kind, state: 'running' })]
        );
        if (inserted.rowCount === 0) {
          const replay = await client.query('SELECT value FROM oldko.server_state WHERE key=$1 FOR UPDATE', [key]);
          const value = replay.rows[0]?.value;
          if (value?.owner !== 'P2-08' || value?.operationId !== String(operationId) || value?.kind !== kind) {
            throw new PgP208Error('IDEMPOTENCY_CONFLICT', 'operation id was already used for a different operation');
          }
          if (value.state !== 'committed') throw new PgP208Error('IDEMPOTENCY_INCOMPLETE', 'operation journal is not committed');
          await client.query('COMMIT');
          return { replayed: true, result: value.result };
        }
        const result = await work(client);
        await client.query('UPDATE oldko.server_state SET value=$2::jsonb,version=version+1,updated_at=now() WHERE key=$1', [
          key, JSON.stringify({ owner: 'P2-08', operationId: String(operationId), kind, state: 'committed', result: safeJson(result) })
        ]);
        await client.query('COMMIT');
        return { replayed: false, result };
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        if ((error?.code === '40001' || error?.code === '40P01') && attempt < this.maxRetries) { attempt += 1; continue; }
        throw error;
      } finally { client.release(); }
    }
  }
}

class PgCoinStore {
  async debit(client, characterId, amount) {
    const debit = normalizeAmount(amount);
    const { rows } = await client.query('SELECT gold FROM oldko.character_stats WHERE character_id=$1 FOR UPDATE', [characterId]);
    if (!rows[0]) throw new PgP208Error('CHARACTER_NOT_FOUND', 'character stats not found');
    const balance = BigInt(rows[0].gold);
    if (balance < debit) throw new PgP208Error('INSUFFICIENT_COINS', 'insufficient coin balance');
    const next = balance - debit;
    await client.query('UPDATE oldko.character_stats SET gold=$2,updated_at=now() WHERE character_id=$1', [characterId, next.toString()]);
    return next;
  }
  async credit(client, characterId, amount) {
    const credit = normalizeAmount(amount);
    const { rows } = await client.query('SELECT gold FROM oldko.character_stats WHERE character_id=$1 FOR UPDATE', [characterId]);
    if (!rows[0]) throw new PgP208Error('CHARACTER_NOT_FOUND', 'character stats not found');
    const balance = BigInt(rows[0].gold);
    const next = balance + credit;
    if (next > PROTOCOL_MAX_COIN_VALUE) throw new PgP208Error('COIN_OVERFLOW', 'coin balance exceeds verified uint32 transport range');
    await client.query('UPDATE oldko.character_stats SET gold=$2,updated_at=now() WHERE character_id=$1', [characterId, next.toString()]);
    return next;
  }
  async transfer(client, fromCharacterId, toCharacterId, amount) {
    if (String(fromCharacterId) === String(toCharacterId)) throw new PgP208Error('INVALID_TRANSFER', 'source and destination must differ');
    const ids = [String(fromCharacterId), String(toCharacterId)].sort();
    for (const id of ids) await client.query('SELECT character_id FROM oldko.character_stats WHERE character_id=$1 FOR UPDATE', [id]);
    await this.debit(client, fromCharacterId, amount);
    await this.credit(client, toCharacterId, amount);
  }
}

class PgItemPlacementStore {
  async lockInstance(client, serial) {
    const { rows } = await client.query('SELECT id,serial,item_template_id,stack_count,durability,flags,custom_data FROM oldko.item_instances WHERE serial=$1 FOR UPDATE', [serial]);
    if (!rows[0]) throw new PgP208Error('ITEM_NOT_FOUND', 'item instance not found');
    return rows[0];
  }
  async locationOf(client, itemInstanceId) {
    const { rows } = await client.query(`
      SELECT 'equipment' kind,character_id::text owner_id,NULL::int page,slot FROM oldko.character_items WHERE item_instance_id=$1
      UNION ALL SELECT 'inventory',character_id::text,NULL::int,slot FROM oldko.inventory WHERE item_instance_id=$1
      UNION ALL SELECT 'inn',account_id::text,page,slot FROM oldko.inn_storage WHERE item_instance_id=$1`, [itemInstanceId]);
    if (rows.length > 1) throw new PgP208Error('DUPLICATE_PLACEMENT', 'item exists in more than one placement');
    return rows[0] ?? null;
  }
  async move(client, { serial, from, to }) {
    const item = await this.lockInstance(client, serial);
    const current = await this.locationOf(client, item.id);
    if (!current || current.kind !== from.kind || String(current.owner_id) !== String(from.ownerId) || Number(current.slot) !== Number(from.slot) || (from.kind === 'inn' && Number(current.page) !== Number(from.page))) {
      throw new PgP208Error('STALE_ITEM_LOCATION', 'item is not at expected source');
    }
    const fromSpec = placementSpec(from.kind), toSpec = placementSpec(to.kind);
    assertSlot(fromSpec, from); assertSlot(toSpec, to);
    const deleteSql = fromSpec.hasPage
      ? `DELETE FROM ${fromSpec.table} WHERE ${fromSpec.owner}=$1 AND page=$2 AND slot=$3 AND item_instance_id=$4`
      : `DELETE FROM ${fromSpec.table} WHERE ${fromSpec.owner}=$1 AND slot=$2 AND item_instance_id=$3`;
    const deleteArgs = fromSpec.hasPage ? [from.ownerId, from.page, from.slot, item.id] : [from.ownerId, from.slot, item.id];
    const removed = await client.query(deleteSql, deleteArgs);
    if (removed.rowCount !== 1) throw new PgP208Error('STALE_ITEM_LOCATION', 'source placement changed');
    const insertSql = toSpec.hasPage
      ? `INSERT INTO ${toSpec.table}(${toSpec.owner},page,slot,item_instance_id) VALUES($1,$2,$3,$4)`
      : `INSERT INTO ${toSpec.table}(${toSpec.owner},slot,item_instance_id) VALUES($1,$2,$3)`;
    const insertArgs = toSpec.hasPage ? [to.ownerId, to.page, to.slot, item.id] : [to.ownerId, to.slot, item.id];
    await client.query(insertSql, insertArgs);
    return item;
  }
  async setDurability(client, { serial, durability }) {
    if (!Number.isSafeInteger(durability) || durability < 0) throw new PgP208Error('INVALID_DURABILITY', 'durability must be a non-negative integer');
    const item = await this.lockInstance(client, serial);
    const { rows } = await client.query('UPDATE oldko.item_instances SET durability=$2,updated_at=now() WHERE id=$1 RETURNING *', [item.id, durability]);
    return rows[0];
  }
  async assertGlobalPlacementInvariant(client) {
    const { rows } = await client.query(`SELECT item_instance_id,count(*)::int copies FROM (
      SELECT item_instance_id FROM oldko.character_items UNION ALL SELECT item_instance_id FROM oldko.inventory UNION ALL SELECT item_instance_id FROM oldko.inn_storage
    ) p GROUP BY item_instance_id HAVING count(*)>1 LIMIT 1`);
    if (rows[0]) throw new PgP208Error('DUPLICATE_PLACEMENT', 'database contains duplicate item placement', rows[0]);
    return true;
  }
}

module.exports = { PgP208Error, PgP208TransactionManager, PgCoinStore, PgItemPlacementStore, opKey };
