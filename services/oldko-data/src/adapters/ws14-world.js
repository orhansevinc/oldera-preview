import { DataConflictError, NotFoundError, ValidationError, withTransaction } from '../index.js';

export class PgWs14WorldRepository {
  constructor(pool) { this.pool = pool; }

  async getCharacterForWorld(accountId, characterId) {
    const { rows } = await this.pool.query(WORLD_QUERY, [String(accountId), String(characterId)]);
    return rows[0] ? projectWorld(rows[0]) : null;
  }

  async saveWorldPosition({ accountId, characterId, zoneId, x, y, z, expectedWorldVersion = null }) {
    validatePosition(zoneId, x, y, z);
    return withTransaction(this.pool, async (db) => {
      const current = await db.query(
        `SELECT c.id,c.world_version FROM oldko.characters c JOIN oldko.accounts a ON a.id=c.account_id
         WHERE (a.id::text=$1 OR a.username_key=lower($1))
           AND (c.id::text=$2 OR c.name_key=lower($2)) AND c.deleted_at IS NULL FOR UPDATE`,
        [String(accountId), String(characterId)],
      );
      if (!current.rows[0]) throw new NotFoundError('world character not found');
      const version = Number(current.rows[0].world_version);
      if (expectedWorldVersion != null && Number(expectedWorldVersion) !== version) {
        throw new DataConflictError('world snapshot version changed');
      }
      const { rows } = await db.query(
        `UPDATE oldko.characters SET zone_id=$2,pos_x=$3,pos_y=$4,pos_z=$5,
           world_version=world_version+1,last_world_saved_at=now(),updated_at=now()
         WHERE id=$1 RETURNING world_version,last_world_saved_at`,
        [current.rows[0].id, zoneId, x, y, z],
      );
      return { worldVersion: Number(rows[0].world_version), savedAt: rows[0].last_world_saved_at };
    }, { isolationLevel: 'SERIALIZABLE', maxRetries: 3 });
  }

  async saveWorldState({ accountId, characterId, state, expectedWorldVersion = null }) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new ValidationError('world state must be an object');
    return withTransaction(this.pool, async (db) => {
      const current = await db.query(
        `SELECT c.id,c.world_version FROM oldko.characters c JOIN oldko.accounts a ON a.id=c.account_id
         WHERE (a.id::text=$1 OR a.username_key=lower($1))
           AND (c.id::text=$2 OR c.name_key=lower($2)) AND c.deleted_at IS NULL FOR UPDATE`,
        [String(accountId), String(characterId)],
      );
      if (!current.rows[0]) throw new NotFoundError('world character not found');
      if (expectedWorldVersion != null && Number(expectedWorldVersion) !== Number(current.rows[0].world_version)) {
        throw new DataConflictError('world snapshot version changed');
      }
      const { rows } = await db.query(
        `UPDATE oldko.characters SET world_state=$2::jsonb,world_version=world_version+1,
           last_world_saved_at=now(),updated_at=now() WHERE id=$1
         RETURNING world_version,last_world_saved_at`,
        [current.rows[0].id, JSON.stringify(state)],
      );
      return { worldVersion: Number(rows[0].world_version), savedAt: rows[0].last_world_saved_at };
    }, { isolationLevel: 'SERIALIZABLE', maxRetries: 3 });
  }

  async loadReconnectSnapshot(accountId, characterId) {
    return this.getCharacterForWorld(accountId, characterId);
  }
}

const WORLD_QUERY = `
SELECT a.username,c.id,c.slot,c.name,c.nation,c.race,c.class_id,c.face,c.hair,c.zone_id,
       c.pos_x,c.pos_y,c.pos_z,c.world_version,c.world_state,
       s.level,s.experience,s.hp,s.mp,s.str,s.sta,s.dex,s.intel,s.cha,s.stat_points,s.skill_points,
       s.loyalty,s.gold,s.progression_version,
       cl.id AS clan_id,cl.name AS clan_name,cl.grade AS clan_grade,cl.ranking_points AS clan_ranking_points
FROM oldko.accounts a
JOIN oldko.characters c ON c.account_id=a.id AND c.deleted_at IS NULL
JOIN oldko.character_stats s ON s.character_id=c.id
LEFT JOIN oldko.clan_members cm ON cm.character_id=c.id
LEFT JOIN oldko.clans cl ON cl.id=cm.clan_id
WHERE a.deleted_at IS NULL
  AND (a.id::text=$1 OR a.username_key=lower($1))
  AND (c.id::text=$2 OR c.name_key=lower($2))
LIMIT 1`;

function projectWorld(row) {
  const extra = row.world_state ?? {};
  const character = {
    ...structuredClone(extra),
    accountId: row.username,
    characterId: row.name,
    databaseCharacterId: String(row.id),
    slot: Number(row.slot), nation: Number(row.nation), race: Number(row.race), classId: Number(row.class_id),
    level: Number(row.level), face: Number(row.face), hair: Number(row.hair), zone: Number(row.zone_id), zoneId: Number(row.zone_id),
    x: Number(row.pos_x), y: Number(row.pos_y), z: Number(row.pos_z),
    exp: Number(row.experience), hp: Number(row.hp), mp: Number(row.mp),
    str: Number(row.str), sta: Number(row.sta), dex: Number(row.dex), intel: Number(row.intel), cha: Number(row.cha),
    loyalty: Number(row.loyalty), gold: Number(row.gold),
    worldVersion: Number(row.world_version), progressionVersion: Number(row.progression_version),
  };
  character.stats = { str: character.str, sta: character.sta, dex: character.dex, intel: character.intel, magicAttack: character.cha };
  character.skills = Array.isArray(extra.skills) ? [...extra.skills] : Array(9).fill(0);
  character.protocolItems = Array.isArray(extra.protocolItems) ? extra.protocolItems.map(v => ({ ...v })) : [];
  character.visibleEquipment = Array.isArray(extra.visibleEquipment) ? extra.visibleEquipment.map(v => ({ ...v })) : [];
  character.equipment = structuredClone(extra.equipment ?? {});
  character.clan = row.clan_id ? {
    id: Number(row.clan_id), name: row.clan_name, grade: Number(row.clan_grade), ranking: Number(row.clan_ranking_points),
    ...(extra.clan ?? {}),
  } : null;
  return character;
}

function validatePosition(zoneId, x, y, z) {
  if (!Number.isInteger(zoneId) || zoneId <= 0 || zoneId > 32767) throw new ValidationError('zoneId is invalid');
  for (const [name, value] of Object.entries({ x, y, z })) if (!Number.isFinite(value)) throw new ValidationError(`${name} must be finite`);
}
