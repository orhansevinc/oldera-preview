import { DataConflictError, NotFoundError, ValidationError } from '../index.js';
import { dbFor, inSerializableTransaction, assertPositiveDbId } from './shared.js';

const EQUIPMENT_SLOTS = 14;
const INVENTORY_SLOTS = 28;
const INN_SLOTS = 196;

export class PgWs17ItemRepository {
  constructor(pool, { duplicateSerialHook = null } = {}) {
    this.pool = pool;
    this.duplicateSerialHook = duplicateSerialHook;
  }

  async read(ownerId, options = {}) {
    const id = assertPositiveDbId(ownerId, 'ownerId');
    return loadState(dbFor(this.pool, options.tx), id, false);
  }

  async transact(ownerId, work, options = {}) {
    const id = assertPositiveDbId(ownerId, 'ownerId');
    if (typeof work !== 'function') throw new TypeError('work must be a function');
    return inSerializableTransaction(this.pool, options.tx, async (db) => {
      const identity = await db.query(
        `SELECT c.id,c.account_id FROM oldko.characters c WHERE c.id=$1 AND c.deleted_at IS NULL`, [id],
      );
      if (!identity.rows[0]) throw new NotFoundError('inventory owner not found');
      await db.query(`SELECT id FROM oldko.accounts WHERE id=$1 FOR UPDATE`, [identity.rows[0].account_id]);
      const locked = await db.query(
        `SELECT id FROM oldko.characters WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [id, identity.rows[0].account_id],
      );
      if (!locked.rows[0]) throw new NotFoundError('inventory owner changed during lock acquisition');

      const before = await loadState(db, id, false);
      const draft = cloneState(before);
      const result = await work(draft);
      validateState(draft, id);
      await persistState(db, before, draft, identity.rows[0].account_id, this.duplicateSerialHook);
      await db.query(`UPDATE oldko.characters SET item_version=item_version+1,updated_at=now() WHERE id=$1`, [id]);
      await db.query(`UPDATE oldko.accounts SET inn_version=inn_version+1,updated_at=now() WHERE id=$1`, [identity.rows[0].account_id]);
      return result;
    });
  }

  async scanForDuplicateSerials(options = {}) {
    const { rows } = await dbFor(this.pool, options.tx).query(
      `SELECT serial,count(*)::int AS copies FROM oldko.item_instances GROUP BY serial HAVING count(*)>1 ORDER BY copies DESC,serial`,
    );
    return rows.map(row => ({ serial: String(row.serial), copies: Number(row.copies) }));
  }
}

async function loadState(db, ownerId, lockItems) {
  const owner = await db.query(
    `SELECT c.id,c.account_id,c.item_version FROM oldko.characters c WHERE c.id=$1 AND c.deleted_at IS NULL`, [ownerId],
  );
  if (!owner.rows[0]) throw new NotFoundError('inventory owner not found');
  const suffix = lockItems ? ' FOR UPDATE OF i' : '';
  const { rows } = await db.query(
    `SELECT p.container,p.slot,i.serial,i.item_template_id,i.stack_count,i.durability
     FROM (
       SELECT 'equipment'::text AS container,ci.slot::int AS slot,ci.item_instance_id
         FROM oldko.character_items ci WHERE ci.character_id=$1
       UNION ALL
       SELECT 'inventory'::text,iv.slot::int,iv.item_instance_id
         FROM oldko.inventory iv WHERE iv.character_id=$1
       UNION ALL
       SELECT 'inn'::text,ins.flat_slot::int,ins.item_instance_id
         FROM oldko.inn_storage ins WHERE ins.account_id=$2
     ) p
     JOIN oldko.item_instances i ON i.id=p.item_instance_id
     ORDER BY p.container,p.slot${suffix}`,
    [ownerId, owner.rows[0].account_id],
  );
  const state = emptyState(ownerId, Number(owner.rows[0].item_version));
  for (const row of rows) {
    const item = Object.freeze({
      templateId: String(row.item_template_id),
      serial: String(row.serial),
      quantity: Number(row.stack_count),
      durability: row.durability == null ? null : Number(row.durability),
    });
    state[row.container][Number(row.slot)] = item;
  }
  return state;
}

async function persistState(db, before, draft, accountId, duplicateSerialHook) {
  const previousSerials = new Set(listItems(before).map(v => v.item.serial));
  const nextEntries = listItems(draft);
  const nextSerials = new Set(nextEntries.map(v => v.item.serial));

  const serials = [...nextSerials];
  let existingRows = [];
  if (serials.length) {
    const result = await db.query(
      `SELECT id,serial FROM oldko.item_instances WHERE serial=ANY($1::bigint[]) FOR UPDATE`, [serials],
    );
    existingRows = result.rows;
  }
  const existingBySerial = new Map(existingRows.map(row => [String(row.serial), row]));
  for (const [serial] of existingBySerial) {
    if (!previousSerials.has(serial)) {
      duplicateSerialHook?.({ serial, attemptedOwner: draft.ownerId });
      throw new DataConflictError(`serial ${serial} already exists outside owner state`);
    }
  }

  await db.query(`DELETE FROM oldko.character_items WHERE character_id=$1`, [draft.ownerId]);
  await db.query(`DELETE FROM oldko.inventory WHERE character_id=$1`, [draft.ownerId]);
  await db.query(`DELETE FROM oldko.inn_storage WHERE account_id=$1`, [accountId]);

  const removed = [...previousSerials].filter(serial => !nextSerials.has(serial));
  if (removed.length) await db.query(`DELETE FROM oldko.item_instances WHERE serial=ANY($1::bigint[])`, [removed]);

  const idBySerial = new Map();
  for (const entry of nextEntries) {
    const { item } = entry;
    const templateId = positiveDecimal(item.templateId, 'templateId');
    const serial = positiveDecimal(item.serial, 'serial');
    let row = existingBySerial.get(serial);
    if (row) {
      const updated = await db.query(
        `UPDATE oldko.item_instances SET item_template_id=$2,stack_count=$3,durability=$4,
           version=version+1,updated_at=now() WHERE id=$1 RETURNING id`,
        [row.id, templateId, item.quantity, item.durability],
      );
      row = updated.rows[0];
    } else {
      try {
        const inserted = await db.query(
          `INSERT INTO oldko.item_instances(serial,item_template_id,stack_count,durability)
           VALUES($1,$2,$3,$4) RETURNING id`, [serial,templateId,item.quantity,item.durability],
        );
        row = inserted.rows[0];
      } catch (error) {
        if (error?.code === '23505') {
          duplicateSerialHook?.({ serial, attemptedOwner: draft.ownerId });
          throw new DataConflictError(`serial ${serial} already exists`, { cause: error });
        }
        throw error;
      }
    }
    idBySerial.set(serial, row.id);
  }

  for (const entry of nextEntries) {
    const itemId = idBySerial.get(entry.item.serial);
    if (entry.container === 'equipment') {
      await db.query(`INSERT INTO oldko.character_items(character_id,slot,item_instance_id) VALUES($1,$2,$3)`, [draft.ownerId,entry.slot,itemId]);
    } else if (entry.container === 'inventory') {
      await db.query(`INSERT INTO oldko.inventory(character_id,slot,item_instance_id) VALUES($1,$2,$3)`, [draft.ownerId,entry.slot,itemId]);
    } else {
      await db.query(`INSERT INTO oldko.inn_storage(account_id,page,slot,item_instance_id) VALUES($1,$2,$3,$4)`, [accountId,Math.floor(entry.slot/28),entry.slot%28,itemId]);
    }
  }
}

function emptyState(ownerId, version = 0) {
  return { ownerId: String(ownerId), version, equipment: Array(EQUIPMENT_SLOTS).fill(null), inventory: Array(INVENTORY_SLOTS).fill(null), inn: Array(INN_SLOTS).fill(null) };
}

function cloneState(state) {
  return {
    ownerId: state.ownerId,
    version: state.version,
    equipment: state.equipment.map(cloneItem), inventory: state.inventory.map(cloneItem), inn: state.inn.map(cloneItem),
  };
}
function cloneItem(value) { return value == null ? null : Object.freeze({ ...value }); }

function validateState(state, ownerId) {
  if (String(state.ownerId) !== String(ownerId)) throw new ValidationError('ownerId cannot change inside transaction');
  if (!Array.isArray(state.equipment) || state.equipment.length !== EQUIPMENT_SLOTS) throw new ValidationError('equipment must contain 14 slots');
  if (!Array.isArray(state.inventory) || state.inventory.length !== INVENTORY_SLOTS) throw new ValidationError('inventory must contain 28 slots');
  if (!Array.isArray(state.inn) || state.inn.length !== INN_SLOTS) throw new ValidationError('inn must contain 196 slots');
  const seen = new Set();
  for (const { item } of listItems(state)) {
    positiveDecimal(item.serial, 'serial'); positiveDecimal(item.templateId, 'templateId');
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new ValidationError('item quantity must be positive');
    if (item.durability != null && (!Number.isInteger(item.durability) || item.durability < 0)) throw new ValidationError('durability is invalid');
    if (seen.has(item.serial)) throw new DataConflictError(`duplicate serial inside owner state: ${item.serial}`);
    seen.add(item.serial);
  }
}

function listItems(state) {
  const out = [];
  for (const container of ['equipment','inventory','inn']) {
    state[container].forEach((item, slot) => { if (item) out.push({ container, slot, item }); });
  }
  return out;
}

function positiveDecimal(value, name) {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/.test(text)) throw new ValidationError(`${name} must be a positive decimal identifier`);
  return text;
}

export const WS17_STORAGE_CAPACITY = Object.freeze({ equipment: EQUIPMENT_SLOTS, inventory: INVENTORY_SLOTS, inn: INN_SLOTS });
