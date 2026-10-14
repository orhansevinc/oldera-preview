import { DataConflictError, NotFoundError, ValidationError, withTransaction } from '../index.js';

export class PgWs46CharacterLifecycleRepository {
  constructor(pool) { this.pool = pool; }

  async findOwnedCharacter({ accountId, characterId, slotIndex }) {
    const { rows } = await this.pool.query(OWNED_QUERY, [String(accountId),String(characterId),slotIndex]);
    return rows[0] ? project(rows[0]) : null;
  }

  async runDeleteTransaction(context, callback) {
    if (typeof callback !== 'function') throw new TypeError('callback is required');
    return withTransaction(this.pool, async (db) => {
      const unit = makeUnit(db, context);
      return callback(unit);
    }, { isolationLevel: 'SERIALIZABLE', maxRetries: 3 });
  }
}

function makeUnit(db, context) {
  const args = [String(context.accountId),String(context.characterId),context.slotIndex];
  let lockedCharacterId = null;
  return {
    tx: db,
    async lockOwnedCharacter() {
      const { rows } = await db.query(`${OWNED_QUERY} FOR UPDATE OF c`, args);
      if (!rows[0]) throw new NotFoundError('owned character not found');
      lockedCharacterId = rows[0].id;
      return project(rows[0]);
    },
    async setLifecycleState(state) {
      if (!['active','deleting','deleted'].includes(state)) throw new ValidationError('invalid lifecycle state');
      const result = await db.query(
        `UPDATE oldko.characters c SET lifecycle_state=$4,updated_at=now()
         FROM oldko.accounts a WHERE c.account_id=a.id
           AND (a.id::text=$1 OR a.username_key=lower($1))
           AND (c.id::text=$2 OR c.name_key=lower($2)) AND c.slot=$3 AND c.deleted_at IS NULL`,
        [...args,state],
      );
      if (result.rowCount !== 1) throw new NotFoundError('owned character not found');
    },
    async releaseCharacterName() {
      const result = lockedCharacterId == null
        ? await db.query(
          `UPDATE oldko.characters c SET name=('~'||c.id::text),name_key=('~'||c.id::text),name_released_at=now(),updated_at=now()
           FROM oldko.accounts a WHERE c.account_id=a.id
             AND (a.id::text=$1 OR a.username_key=lower($1))
             AND (c.id::text=$2 OR c.name_key=lower($2)) AND c.slot=$3 AND c.deleted_at IS NULL
           RETURNING c.id`, args)
        : await db.query(
          `UPDATE oldko.characters SET name=('~'||id::text),name_key=('~'||id::text),name_released_at=now(),updated_at=now()
           WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [lockedCharacterId]);
      if (!result.rows[0]) throw new NotFoundError('owned character not found');
    },
    async deleteCharacter() {
      const current = lockedCharacterId == null
        ? await db.query(
          `SELECT c.id FROM oldko.characters c JOIN oldko.accounts a ON a.id=c.account_id
           WHERE (a.id::text=$1 OR a.username_key=lower($1))
             AND (c.id::text=$2 OR c.name_key=lower($2)) AND c.slot=$3 AND c.deleted_at IS NULL FOR UPDATE OF c`, args)
        : await db.query(`SELECT id FROM oldko.characters WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [lockedCharacterId]);
      if (!current.rows[0]) throw new NotFoundError('owned character not found');
      const characterDbId = current.rows[0].id;
      const remaining = await db.query(
        `SELECT
          EXISTS(SELECT 1 FROM oldko.character_items WHERE character_id=$1) AS equipment,
          EXISTS(SELECT 1 FROM oldko.inventory WHERE character_id=$1) AS inventory,
          EXISTS(SELECT 1 FROM oldko.clan_members WHERE character_id=$1) AS clan`, [characterDbId],
      );
      if (remaining.rows[0].equipment || remaining.rows[0].inventory || remaining.rows[0].clan) {
        throw new DataConflictError('character-scoped cleanup must finish before lifecycle deletion');
      }
      await db.query(
        `UPDATE oldko.characters SET lifecycle_state='deleted',deleted_at=now(),updated_at=now() WHERE id=$1`, [characterDbId],
      );
      return { characterId: String(characterDbId), deleted: true };
    },
    async appendAuditEvent(event) {
      if (!event || typeof event.action !== 'string' || !event.action) throw new ValidationError('audit action is required');
      await db.query(
        `INSERT INTO oldko.audit_log(actor_account_id,action,target_type,target_id,request_id,details)
         VALUES($1,$2,'character',$3,$4,$5::jsonb)`,
        [event.actorAccountId??null,event.action,String(context.characterId),event.requestId??null,JSON.stringify(event.details??{})],
      );
    },
  };
}

const OWNED_QUERY = `
SELECT c.id,c.account_id,c.slot,c.name,c.lifecycle_state,c.deleted_at
FROM oldko.characters c JOIN oldko.accounts a ON a.id=c.account_id
WHERE (a.id::text=$1 OR a.username_key=lower($1))
  AND (c.id::text=$2 OR c.name_key=lower($2))
  AND c.slot=$3 AND c.deleted_at IS NULL`;
function project(row) { return { characterId:String(row.id),accountId:String(row.account_id),slotIndex:Number(row.slot),name:row.name,lifecycleState:row.lifecycle_state }; }
