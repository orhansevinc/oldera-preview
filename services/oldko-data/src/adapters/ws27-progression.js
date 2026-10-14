import { DataConflictError, NotFoundError, ValidationError } from '../index.js';
import { assertPositiveDbId, dbFor, inSerializableTransaction } from './shared.js';

export class PgWs27ProgressionRepository {
  constructor(pool) { this.pool = pool; }

  async load(characterId, { tx } = {}) {
    const id = assertPositiveDbId(characterId, 'characterId');
    const { rows } = await dbFor(this.pool, tx).query(
      `SELECT s.character_id,s.level,s.experience,s.hp,s.mp,s.str,s.sta,s.dex,s.intel,s.cha,
              s.stat_points,s.skill_points,s.loyalty,s.gold,s.progression_version
       FROM oldko.character_stats s JOIN oldko.characters c ON c.id=s.character_id
       WHERE s.character_id=$1 AND c.deleted_at IS NULL`, [id],
    );
    return rows[0] ? project(rows[0]) : null;
  }

  async save(characterId, state, { expectedVersion = state?.version, tx } = {}) {
    const id = assertPositiveDbId(characterId, 'characterId');
    validateState(state);
    if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) <= 0) throw new ValidationError('expected progression version is required');
    return inSerializableTransaction(this.pool, tx, async (db) => {
      const { rows } = await db.query(
        `UPDATE oldko.character_stats SET level=$3,experience=$4,hp=$5,mp=$6,str=$7,sta=$8,dex=$9,intel=$10,cha=$11,
           stat_points=$12,skill_points=$13,loyalty=$14,gold=$15,progression_version=progression_version+1,updated_at=now()
         WHERE character_id=$1 AND progression_version=$2
         RETURNING progression_version`,
        [id,Number(expectedVersion),state.level,String(state.experience),state.hp,state.mp,state.str,state.sta,state.dex,state.intel,state.cha,
         state.statPoints,state.skillPoints,state.loyalty,String(state.gold)],
      );
      if (!rows[0]) {
        const exists = await db.query(`SELECT 1 FROM oldko.character_stats WHERE character_id=$1`, [id]);
        if (!exists.rows[0]) throw new NotFoundError('progression state not found');
        throw new DataConflictError('progression state changed concurrently');
      }
      return { version: Number(rows[0].progression_version) };
    });
  }
}

function project(row) {
  return {
    characterId: String(row.character_id), level: Number(row.level), experience: BigInt(row.experience), hp: Number(row.hp), mp: Number(row.mp),
    str: Number(row.str), sta: Number(row.sta), dex: Number(row.dex), intel: Number(row.intel), cha: Number(row.cha),
    statPoints: Number(row.stat_points), skillPoints: Number(row.skill_points), loyalty: Number(row.loyalty), gold: BigInt(row.gold),
    version: Number(row.progression_version),
  };
}
function validateState(state) {
  if (!state || typeof state !== 'object') throw new ValidationError('progression state is required');
  for (const key of ['level','hp','mp','str','sta','dex','intel','cha','statPoints','skillPoints','loyalty']) {
    if (!Number.isInteger(Number(state[key]))) throw new ValidationError(`${key} must be an integer`);
  }
  for (const key of ['experience','gold']) {
    try { if (BigInt(state[key]) < 0n) throw new Error(); } catch { throw new ValidationError(`${key} must be a non-negative integer`); }
  }
}
