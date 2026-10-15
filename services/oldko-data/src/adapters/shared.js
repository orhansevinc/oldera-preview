import { DataConflictError, NotFoundError, ValidationError, withTransaction } from '../index.js';

export function dbFor(pool, tx) {
  return tx ?? pool;
}

export async function inSerializableTransaction(pool, tx, work) {
  if (tx) return work(tx);
  return withTransaction(pool, work, { isolationLevel: 'SERIALIZABLE', maxRetries: 3 });
}

export function assertPositiveDbId(value, name = 'id') {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/.test(text)) throw new ValidationError(`${name} must be a positive database id`);
  return text;
}

export async function resolveCharacterId(db, playerId, { forUpdate = false } = {}) {
  const id = assertPositiveDbId(playerId, 'playerId');
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const { rows } = await db.query(
    `SELECT id, account_id FROM oldko.characters WHERE id=$1 AND deleted_at IS NULL${suffix}`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError('character not found');
  return rows[0];
}

export function jsonWithBigInt(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
}

export function parseJsonBigIntTrade(payload) {
  const value = typeof payload === 'string' ? JSON.parse(payload) : structuredClone(payload);
  if (value?.offers && typeof value.offers === 'object') {
    for (const offer of Object.values(value.offers)) {
      if (offer && typeof offer === 'object' && offer.coins != null) offer.coins = BigInt(offer.coins);
    }
  }
  return value;
}

export function conflictFromUnique(error, message) {
  if (error?.code === '23505') return new DataConflictError(message, { cause: error });
  return error;
}
