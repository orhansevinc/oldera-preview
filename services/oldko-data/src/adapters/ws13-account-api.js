import { createPool } from '../index.js';

const toDate = (value) => value == null ? null : new Date(value);
const toMs = (value) => value == null ? null : new Date(value).getTime();
const tokenBuffer = (digest) => Buffer.from(digest, 'hex');

function conflictCode(error) {
  if (error?.code !== '23505') return null;
  const name = String(error.constraint || '');
  if (name.includes('username')) return 'USERNAME_TAKEN';
  if (name.includes('email')) return 'EMAIL_TAKEN';
  return null;
}

function mapAccount(row) {
  if (!row) return null;
  const statusBan = row.status && row.status !== 'active';
  const activeDbBan = Boolean(row.ban_active);
  return {
    id: String(row.id),
    username: row.username,
    usernameCanonical: row.username_key,
    email: row.email,
    passwordHash: row.password_hash,
    verifiedAt: toMs(row.verified_at),
    passwordVersion: Number(row.password_version || 1),
    status: row.status,
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at),
    lastLoginAt: toMs(row.last_login_at),
    ban: {
      active: statusBan || activeDbBan,
      code: statusBan ? `ACCOUNT_${String(row.status).toUpperCase()}` : (activeDbBan ? 'ACCOUNT_BANNED' : null),
      until: activeDbBan ? toMs(row.ban_expires_at) : null
    }
  };
}

const ACCOUNT_SELECT = `
SELECT a.id,a.username,a.username_key,a.password_hash,a.email,a.status,a.created_at,a.updated_at,a.last_login_at,
       a.verified_at,a.password_version,
       (b.id IS NOT NULL) AS ban_active,b.expires_at AS ban_expires_at
FROM oldko.accounts a
LEFT JOIN LATERAL (
  SELECT id,expires_at FROM oldko.bans
  WHERE account_id=a.id AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())
  ORDER BY created_at DESC LIMIT 1
) b ON true`;

export class PgWs13AccountRepository {
  constructor(db) { this.db = db; }

  async createAccount(account) {
    try {
      const { rows } = await this.db.query(`
        INSERT INTO oldko.accounts(username,username_key,password_hash,email,status,verified_at,password_version,created_at,updated_at,last_login_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id`, [account.username, account.usernameCanonical, account.passwordHash, account.email, account.status || 'active', toDate(account.verifiedAt), account.passwordVersion || 1, toDate(account.createdAt), toDate(account.updatedAt), toDate(account.lastLoginAt)]);
      return this.findById(rows[0].id);
    } catch (error) {
      const code = conflictCode(error);
      if (code) { const wrapped = new Error(code); wrapped.code = code; throw wrapped; }
      throw error;
    }
  }

  async findByUsernameCanonical(canonical) {
    const { rows } = await this.db.query(`${ACCOUNT_SELECT} WHERE a.username_key=$1 AND a.deleted_at IS NULL`, [canonical]);
    return mapAccount(rows[0]);
  }

  async findByEmail(email) {
    const { rows } = await this.db.query(`${ACCOUNT_SELECT} WHERE lower(a.email)=lower($1) AND a.deleted_at IS NULL`, [email]);
    return mapAccount(rows[0]);
  }

  async findById(id) {
    const { rows } = await this.db.query(`${ACCOUNT_SELECT} WHERE a.id=$1 AND a.deleted_at IS NULL`, [id]);
    return mapAccount(rows[0]);
  }

  async updateAccount(id, patch) {
    const fields = [];
    const values = [];
    const add = (column, value) => { values.push(value); fields.push(`${column}=$${values.length}`); };
    if (Object.hasOwn(patch, 'passwordHash')) add('password_hash', patch.passwordHash);
    if (Object.hasOwn(patch, 'verifiedAt')) add('verified_at', toDate(patch.verifiedAt));
    if (Object.hasOwn(patch, 'passwordVersion')) add('password_version', patch.passwordVersion);
    if (Object.hasOwn(patch, 'lastLoginAt')) add('last_login_at', toDate(patch.lastLoginAt));
    if (Object.hasOwn(patch, 'status')) add('status', patch.status);
    if (Object.hasOwn(patch, 'updatedAt')) add('updated_at', toDate(patch.updatedAt));
    if (!fields.length) return this.findById(id);
    values.push(id);
    await this.db.query(`UPDATE oldko.accounts SET ${fields.join(',')} WHERE id=$${values.length} AND deleted_at IS NULL`, values);
    return this.findById(id);
  }

  async createActionToken(record) {
    await this.db.query(`INSERT INTO oldko.account_action_tokens(id,kind,account_id,token_hash,created_at,expires_at,consumed_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [record.id, record.kind, record.accountId, tokenBuffer(record.digest), toDate(record.createdAt), toDate(record.expiresAt), toDate(record.consumedAt)]);
  }

  async consumeActionToken(kind, digest, now) {
    const { rows } = await this.db.query(`UPDATE oldko.account_action_tokens SET consumed_at=$3 WHERE kind=$1 AND token_hash=$2 AND consumed_at IS NULL AND expires_at>$3 RETURNING id,kind,account_id,created_at,expires_at,consumed_at`, [kind, tokenBuffer(digest), toDate(now)]);
    const row = rows[0];
    return row ? { id: row.id, kind: row.kind, accountId: String(row.account_id), createdAt: toMs(row.created_at), expiresAt: toMs(row.expires_at), consumedAt: toMs(row.consumed_at) } : null;
  }

  async createSession(record) {
    const { rows } = await this.db.query(`INSERT INTO oldko.account_sessions(account_id,token_hash,source_ip,user_agent,created_at,expires_at,revoked_at,last_seen_at,password_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [record.accountId, tokenBuffer(record.digest), record.sourceIp === 'unknown' ? null : record.sourceIp, record.userAgent, toDate(record.createdAt), toDate(record.expiresAt), toDate(record.revokedAt), toDate(record.lastSeenAt), record.passwordVersion]);
    return { ...record, id: String(rows[0].id) };
  }

  async findSessionByDigest(digest, now) {
    const { rows } = await this.db.query(`SELECT id,account_id,password_version,created_at,expires_at,revoked_at,last_seen_at FROM oldko.account_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>$2 LIMIT 1`, [tokenBuffer(digest), toDate(now)]);
    const row = rows[0];
    return row ? { id: String(row.id), accountId: String(row.account_id), passwordVersion: Number(row.password_version || 1), createdAt: toMs(row.created_at), expiresAt: toMs(row.expires_at), revokedAt: toMs(row.revoked_at), lastSeenAt: toMs(row.last_seen_at) } : null;
  }

  async revokeSessionByDigest(digest, now) {
    const result = await this.db.query(`UPDATE oldko.account_sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE token_hash=$1 AND revoked_at IS NULL`, [tokenBuffer(digest), toDate(now)]);
    return result.rowCount > 0;
  }

  async touchSession(digest, now) {
    const result = await this.db.query(`UPDATE oldko.account_sessions SET last_seen_at=$2 WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>$2`, [tokenBuffer(digest), toDate(now)]);
    return result.rowCount > 0;
  }

  async listCharactersByAccount(accountId) {
    const { rows } = await this.db.query(`
      SELECT c.id,c.slot,c.name,c.nation,c.class_id,s.level,s.loyalty,cl.name AS clan_name
      FROM oldko.characters c
      JOIN oldko.character_stats s ON s.character_id=c.id
      LEFT JOIN oldko.clan_members cm ON cm.character_id=c.id
      LEFT JOIN oldko.clans cl ON cl.id=cm.clan_id
      WHERE c.account_id=$1 AND c.deleted_at IS NULL
      ORDER BY c.slot`, [accountId]);
    return rows.map((row) => ({ id: String(row.id), slot: Number(row.slot), name: row.name, nation: Number(row.nation), classId: Number(row.class_id), level: Number(row.level), np: Number(row.loyalty), clan: row.clan_name ? { name: row.clan_name } : null }));
  }
}

export function createAccountRepository({ env = process.env } = {}) {
  const pool = createPool({ connectionString: env.DATABASE_URL, applicationName: 'oldko-account-api' });
  return new PgWs13AccountRepository(pool);
}
