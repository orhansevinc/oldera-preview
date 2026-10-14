import { DataConflictError, ValidationError, verifyPassword, withTransaction } from '../index.js';
import { conflictFromUnique } from './shared.js';

const CREATE_OK = 0;
const CREATE_FAILED = 1;

export class PgWs03SessionRepository {
  constructor(pool) { this.pool = pool; }

  async authenticate(username, password) {
    const key = normalizeUsername(username);
    const { rows } = await this.pool.query(
      `SELECT password_hash, status FROM oldko.accounts
       WHERE username_key=lower($1) AND deleted_at IS NULL`, [key],
    );
    const account = rows[0];
    if (!account || account.status !== 'active') return false;
    return verifyPassword(password, account.password_hash);
  }

  async getNation(username) {
    const { rows } = await this.pool.query(
      `SELECT nation FROM oldko.accounts WHERE username_key=lower($1) AND deleted_at IS NULL`,
      [normalizeUsername(username)],
    );
    return Number(rows[0]?.nation ?? 0);
  }

  async setNation(username, nation) {
    if (nation !== 1 && nation !== 2) return false;
    const result = await this.pool.query(
      `UPDATE oldko.accounts SET nation=$2, updated_at=now()
       WHERE username_key=lower($1) AND deleted_at IS NULL AND status='active'`,
      [normalizeUsername(username), nation],
    );
    return result.rowCount === 1;
  }

  async listCharacters(username) {
    const { rows } = await this.pool.query(
      `SELECT c.id,c.slot,c.name,c.nation,c.race,c.class_id,c.face,c.hair,c.zone_id,c.world_state,
              s.level
       FROM oldko.accounts a
       JOIN oldko.characters c ON c.account_id=a.id AND c.deleted_at IS NULL
       JOIN oldko.character_stats s ON s.character_id=c.id
       WHERE a.username_key=lower($1) AND a.deleted_at IS NULL
       ORDER BY c.slot`, [normalizeUsername(username)],
    );
    const slots = Array(3).fill(null);
    for (const row of rows) slots[row.slot] = toCharacterListRecord(row);
    return slots;
  }

  async createCharacter(username, spec) {
    validateCreateSpec(spec);
    try {
      return await withTransaction(this.pool, async (db) => {
        const accountResult = await db.query(
          `SELECT id,nation,status FROM oldko.accounts
           WHERE username_key=lower($1) AND deleted_at IS NULL FOR UPDATE`,
          [normalizeUsername(username)],
        );
        const account = accountResult.rows[0];
        if (!account || account.status !== 'active' || ![1,2].includes(Number(account.nation))) {
          return { ok: false, code: CREATE_FAILED };
        }
        const characterResult = await db.query(
          `INSERT INTO oldko.characters
             (account_id,slot,name,name_key,nation,race,class_id,face,hair,zone_id,pos_x,pos_y,pos_z)
           VALUES ($1,$2,$3,lower($3),$4,$5,$6,$7,$8,21,312,0,402)
           RETURNING id,slot,name,nation,race,class_id,face,hair,zone_id,world_state`,
          [account.id,spec.slot,spec.name,account.nation,spec.race,spec.classId,spec.face,spec.hair],
        );
        const character = characterResult.rows[0];
        await db.query(
          `INSERT INTO oldko.character_stats
             (character_id,hp,mp,str,sta,dex,intel,cha)
           VALUES ($1,100,100,$2,$3,$4,$5,$6)`,
          [character.id,spec.str,spec.sta,spec.dex,spec.intel,spec.magicAttack],
        );
        return { ok: true, code: CREATE_OK, character: { ...toCharacterListRecord({ ...character, level: 1 }), accountId: username } };
      }, { isolationLevel: 'SERIALIZABLE', maxRetries: 3 });
    } catch (error) {
      const mapped = conflictFromUnique(error, 'character name or slot already exists');
      if (mapped instanceof DataConflictError) return { ok: false, code: CREATE_FAILED };
      throw mapped;
    }
  }

  async getCharacter(username, characterId) {
    const { rows } = await this.pool.query(
      `SELECT c.id,c.slot,c.name,c.nation,c.race,c.class_id,c.face,c.hair,c.zone_id,c.world_state,s.level
       FROM oldko.accounts a
       JOIN oldko.characters c ON c.account_id=a.id AND c.deleted_at IS NULL
       JOIN oldko.character_stats s ON s.character_id=c.id
       WHERE a.username_key=lower($1) AND a.deleted_at IS NULL AND c.name_key=lower($2)`,
      [normalizeUsername(username), String(characterId)],
    );
    return rows[0] ? { ...toCharacterListRecord(rows[0]), accountId: username } : null;
  }
}

function normalizeUsername(value) {
  if (typeof value !== 'string') throw new ValidationError('username must be a string');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 32) throw new ValidationError('username is invalid');
  return trimmed;
}

function validateCreateSpec(spec) {
  if (!spec || !Number.isInteger(spec.slot) || spec.slot < 0 || spec.slot > 2) throw new ValidationError('character slot is invalid');
  if (typeof spec.name !== 'string' || spec.name.length < 1 || spec.name.length > 20) throw new ValidationError('character name is invalid');
  for (const key of ['race','classId','face','hair','str','sta','dex','intel','magicAttack']) {
    if (!Number.isInteger(spec[key])) throw new ValidationError(`${key} must be an integer`);
  }
}

function toCharacterListRecord(row) {
  const world = row.world_state ?? {};
  return {
    characterId: row.name,
    databaseCharacterId: String(row.id),
    slot: Number(row.slot),
    nation: Number(row.nation),
    race: Number(row.race),
    classId: Number(row.class_id),
    level: Number(row.level),
    face: Number(row.face),
    hair: Number(row.hair),
    zone: Number(row.zone_id),
    equipment: structuredClone(world.characterListEquipment ?? {}),
  };
}

export class PgAccountSessionRepository {
  constructor(pool) { this.pool = pool; }
  async create({ accountId, tokenHash, sourceIp = null, userAgent = null, expiresAt }) {
    if (!Buffer.isBuffer(tokenHash) || tokenHash.length < 16) throw new ValidationError('tokenHash must be a non-trivial Buffer');
    const { rows } = await this.pool.query(
      `INSERT INTO oldko.account_sessions(account_id,token_hash,source_ip,user_agent,expires_at,last_seen_at)
       VALUES($1,$2,$3::inet,$4,$5,now()) RETURNING id,account_id,created_at,expires_at`,
      [accountId,tokenHash,sourceIp,userAgent,expiresAt],
    );
    return rows[0];
  }
  async getActiveByTokenHash(tokenHash) {
    const { rows } = await this.pool.query(
      `SELECT id,account_id,source_ip,user_agent,created_at,expires_at,last_seen_at
       FROM oldko.account_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()`, [tokenHash],
    );
    return rows[0] ?? null;
  }
  async touch(sessionId) {
    const result = await this.pool.query(
      `UPDATE oldko.account_sessions SET last_seen_at=now() WHERE id=$1 AND revoked_at IS NULL AND expires_at>now()`, [sessionId],
    );
    return result.rowCount === 1;
  }
  async revoke(sessionId) {
    const result = await this.pool.query(
      `UPDATE oldko.account_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1`, [sessionId],
    );
    return result.rowCount === 1;
  }
}
