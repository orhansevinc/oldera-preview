import { DataConflictError, ValidationError } from '../index.js';
import { inSerializableTransaction, resolveCharacterId } from './shared.js';

const CONTENT_KINDS = new Set(['world','npc','mob','skill','economy']);
const SECRET_KEY = /(secret|password|passwd|token|private[_-]?key|credential|api[_-]?key)/i;

function nonBlank(value, name, max = 192) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new ValidationError(`${name} must be 1..${max} characters`);
  return text;
}

function jsonObject(value, name = 'value') {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${name} must be an object`);
  return value;
}

export function assertRuntimeConfigKey(value) {
  const key = nonBlank(value, 'runtime config key', 160);
  if (SECRET_KEY.test(key)) throw new ValidationError('secret-bearing runtime config keys are forbidden; use WS35 secret references');
  return key;
}

export function isRealApplyProof(result) {
  return result?.status === 'ok' && result?.forwarded !== false && (result?.applied === true || result?.data?.applied === true);
}

export function projectServerStatus(row, { now = Date.now(), maxAgeMs = 30_000 } = {}) {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new ValidationError('maxAgeMs must be positive');
  if (!row) return { availability: 'offline', online: false, maintenance: false, population: 'unknown', stale: true, lastHeartbeat: null };
  const heartbeatMs = new Date(row.last_heartbeat).getTime();
  const stale = !Number.isFinite(heartbeatMs) || now - heartbeatMs > maxAgeMs || heartbeatMs > now + 5_000;
  const availability = stale ? 'offline' : row.availability;
  const output = {
    realmId: row.realm_id,
    availability,
    online: availability === 'online',
    maintenance: availability === 'maintenance',
    population: stale ? 'unknown' : populationFor(row.player_count),
    stale,
    lastHeartbeat: row.last_heartbeat ? new Date(row.last_heartbeat).toISOString() : null,
  };
  if (!stale && row.player_count != null) output.onlinePlayerCount = Number(row.player_count);
  if (row.server_version) output.serverVersion = row.server_version;
  if (row.target_patch) output.targetPatch = row.target_patch;
  if (row.status_message) output.statusMessage = row.status_message;
  return output;
}

function populationFor(value) {
  if (value == null) return 'unknown';
  const count = Number(value);
  if (count <= 0) return 'empty';
  if (count < 100) return 'low';
  if (count < 500) return 'medium';
  if (count < 1000) return 'high';
  return 'full';
}

export class PgP2DataAdminRepository {
  constructor(pool) { this.pool = pool; }

  transaction(work, { tx = null } = {}) {
    if (typeof work !== 'function') throw new TypeError('work must be a function');
    return inSerializableTransaction(this.pool, tx, work);
  }

  async getSchemaVersion({ tx = null } = {}) {
    const db = tx ?? this.pool;
    const { rows } = await db.query(`SELECT name,checksum,applied_at FROM public._oldko_migrations ORDER BY name DESC LIMIT 1`);
    return rows[0] ?? null;
  }

  async saveQuestState({ characterId, questKey, state, expectedVersion = 0, tx = null }) {
    const key = nonBlank(questKey, 'questKey', 128);
    jsonObject(state, 'state');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new ValidationError('expectedVersion must be a non-negative integer');
    return inSerializableTransaction(this.pool, tx, async (db) => {
      const character = await resolveCharacterId(db, characterId, { forUpdate: true });
      let result;
      if (expectedVersion === 0) {
        result = await db.query(
          `INSERT INTO oldko.character_quests(character_id,quest_key,state) VALUES($1,$2,$3::jsonb)
           ON CONFLICT DO NOTHING RETURNING character_id,quest_key,state,version,updated_at`,
          [character.id, key, JSON.stringify(state)],
        );
      } else {
        result = await db.query(
          `UPDATE oldko.character_quests SET state=$3::jsonb,version=version+1,updated_at=now()
           WHERE character_id=$1 AND quest_key=$2 AND version=$4
           RETURNING character_id,quest_key,state,version,updated_at`,
          [character.id, key, JSON.stringify(state), expectedVersion],
        );
      }
      if (!result.rows[0]) throw new DataConflictError('quest state version conflict');
      return result.rows[0];
    });
  }

  async saveBossState({ authority, bossKey, zoneId = null, state, nextTransitionAt = null, expectedVersion = 0, tx = null }) {
    const source = nonBlank(authority, 'authority', 96);
    const key = nonBlank(bossKey, 'bossKey', 128);
    jsonObject(state, 'state');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new ValidationError('expectedVersion must be a non-negative integer');
    return inSerializableTransaction(this.pool, tx, async (db) => {
      let result;
      if (expectedVersion === 0) {
        result = await db.query(
          `INSERT INTO oldko.boss_runtime_state(authority,boss_key,zone_id,state,next_transition_at)
           VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING
           RETURNING authority,boss_key,zone_id,state,version,next_transition_at,observed_at`,
          [source, key, zoneId, JSON.stringify(state), nextTransitionAt],
        );
      } else {
        result = await db.query(
          `UPDATE oldko.boss_runtime_state SET zone_id=$3,state=$4::jsonb,next_transition_at=$5,
             version=version+1,observed_at=now(),updated_at=now()
           WHERE authority=$1 AND boss_key=$2 AND version=$6
           RETURNING authority,boss_key,zone_id,state,version,next_transition_at,observed_at`,
          [source, key, zoneId, JSON.stringify(state), nextTransitionAt, expectedVersion],
        );
      }
      if (!result.rows[0]) throw new DataConflictError('boss state version conflict');
      return result.rows[0];
    });
  }

  async setRuntimeConfig({ key, value, actorAdminId, requiresRestart = false, expectedVersion = 0, tx = null }) {
    const configKey = assertRuntimeConfigKey(key);
    const actor = nonBlank(actorAdminId, 'actorAdminId', 128);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new ValidationError('expectedVersion must be a non-negative integer');
    return inSerializableTransaction(this.pool, tx, async (db) => {
      let result;
      if (expectedVersion === 0) {
        result = await db.query(
          `INSERT INTO oldko.runtime_config(key,value,requires_restart,updated_by_admin_id)
           VALUES($1,$2::jsonb,$3,$4) ON CONFLICT DO NOTHING
           RETURNING key,value,version,requires_restart,updated_by_admin_id,updated_at`,
          [configKey, JSON.stringify(value), Boolean(requiresRestart), actor],
        );
      } else {
        result = await db.query(
          `UPDATE oldko.runtime_config SET value=$2::jsonb,requires_restart=$3,updated_by_admin_id=$4,
             version=version+1,updated_at=now() WHERE key=$1 AND version=$5
           RETURNING key,value,version,requires_restart,updated_by_admin_id,updated_at`,
          [configKey, JSON.stringify(value), Boolean(requiresRestart), actor, expectedVersion],
        );
      }
      if (!result.rows[0]) throw new DataConflictError('runtime config version conflict');
      await db.query(
        `INSERT INTO oldko.audit_log(actor_admin_id,action,target_type,target_id,details)
         VALUES($1,'runtime.config.changed','runtime_config',$2,$3::jsonb)`,
        [actor, configKey, JSON.stringify({ version: Number(result.rows[0].version), requiresRestart: Boolean(requiresRestart) })],
      );
      return result.rows[0];
    });
  }

  async recordRuntimeConfigApply({ key, version, service, applied, evidence = {}, tx = null }) {
    const configKey = assertRuntimeConfigKey(key);
    const source = nonBlank(service, 'service', 128);
    jsonObject(evidence, 'evidence');
    if (!Number.isSafeInteger(version) || version < 1) throw new ValidationError('version must be positive');
    const db = tx ?? this.pool;
    const { rows } = await db.query(
      `INSERT INTO oldko.runtime_config_apply_receipts(config_key,config_version,service,applied,evidence)
       VALUES($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT(config_key,config_version,service) DO UPDATE SET applied=EXCLUDED.applied,evidence=EXCLUDED.evidence,observed_at=now()
       RETURNING config_key,config_version,service,applied,evidence,observed_at`,
      [configKey, version, source, Boolean(applied), JSON.stringify(evidence)],
    );
    return rows[0];
  }

  async recordServerHeartbeat({ source, realmId, availability, playerCount = null, serverVersion = null, targetPatch = null, statusMessage = null, lastHeartbeat = new Date(), tx = null }) {
    const producer = nonBlank(source, 'source', 128);
    const realm = nonBlank(realmId, 'realmId', 96);
    if (!['online','offline','maintenance'].includes(availability)) throw new ValidationError('invalid availability');
    if (playerCount != null && (!Number.isSafeInteger(playerCount) || playerCount < 0)) throw new ValidationError('playerCount must be null or a non-negative integer');
    const db = tx ?? this.pool;
    const { rows } = await db.query(
      `INSERT INTO oldko.server_runtime_heartbeats(source,realm_id,availability,player_count,server_version,target_patch,status_message,last_heartbeat)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(source,realm_id) DO UPDATE SET availability=EXCLUDED.availability,player_count=EXCLUDED.player_count,
         server_version=EXCLUDED.server_version,target_patch=EXCLUDED.target_patch,status_message=EXCLUDED.status_message,
         last_heartbeat=EXCLUDED.last_heartbeat,observed_at=now()
       WHERE EXCLUDED.last_heartbeat >= oldko.server_runtime_heartbeats.last_heartbeat
       RETURNING *`,
      [producer, realm, availability, playerCount, serverVersion, targetPatch, statusMessage, lastHeartbeat],
    );
    return rows[0] ?? null;
  }

  async getServerStatus({ realmId, maxAgeMs = 30_000, now = Date.now(), tx = null }) {
    const realm = nonBlank(realmId, 'realmId', 96);
    const db = tx ?? this.pool;
    const { rows } = await db.query(
      `SELECT * FROM oldko.server_runtime_heartbeats WHERE realm_id=$1 ORDER BY last_heartbeat DESC LIMIT 1`,
      [realm],
    );
    return projectServerStatus(rows[0] ?? null, { now, maxAgeMs });
  }

  async recordContentObservation({ source, kind, entityKey, payload, revision = null, observedAt = new Date(), tx = null }) {
    const producer = nonBlank(source, 'source', 128);
    if (!CONTENT_KINDS.has(kind)) throw new ValidationError('invalid content observation kind');
    const key = nonBlank(entityKey, 'entityKey', 192);
    jsonObject(payload, 'payload');
    const db = tx ?? this.pool;
    const { rows } = await db.query(
      `INSERT INTO oldko.runtime_content_observations(source,kind,entity_key,payload,revision,observed_at)
       VALUES($1,$2,$3,$4::jsonb,$5,$6)
       ON CONFLICT(source,kind,entity_key) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision,observed_at=EXCLUDED.observed_at
       WHERE EXCLUDED.observed_at >= oldko.runtime_content_observations.observed_at
       RETURNING *`,
      [producer, kind, key, JSON.stringify(payload), revision, observedAt],
    );
    return rows[0] ?? null;
  }

  async listContentObservations({ kind, maxAgeMs = 60_000, now = Date.now(), tx = null }) {
    if (!CONTENT_KINDS.has(kind)) throw new ValidationError('invalid content observation kind');
    const db = tx ?? this.pool;
    const { rows } = await db.query(`SELECT * FROM oldko.runtime_content_observations WHERE kind=$1 ORDER BY entity_key`, [kind]);
    return rows.map((row) => ({ ...row, stale: now - new Date(row.observed_at).getTime() > maxAgeMs }));
  }

  async confirmAdminCommand({ commandId, result, source, tx = null }) {
    const id = nonBlank(commandId, 'commandId', 64);
    const producer = nonBlank(source, 'source', 128);
    jsonObject(result, 'result');
    if (!isRealApplyProof(result)) throw new ValidationError('runtime command result is not proven applied');
    return inSerializableTransaction(this.pool, tx, async (db) => {
      const { rows } = await db.query(
        `INSERT INTO oldko.admin_runtime_command_confirmations(command_id,source,runtime_result,applied)
         VALUES($1::uuid,$2,$3::jsonb,true)
         ON CONFLICT(command_id) DO UPDATE SET source=EXCLUDED.source,runtime_result=EXCLUDED.runtime_result,applied=true,confirmed_at=now()
         RETURNING command_id,source,runtime_result,applied,confirmed_at`,
        [id, producer, JSON.stringify(result)],
      );
      await db.query(
        `UPDATE oldko.admin_command_outbox SET status='succeeded',completed_at=now(),updated_at=now(),last_error=NULL WHERE id=$1::uuid`,
        [id],
      );
      return rows[0];
    });
  }

  async persistenceSnapshot(characterId, { tx = null } = {}) {
    const db = tx ?? this.pool;
    const character = await resolveCharacterId(db, characterId);
    const { rows } = await db.query(
      `SELECT c.id,c.account_id,c.slot,c.name,c.nation,c.class_id,c.zone_id,c.pos_x,c.pos_y,c.pos_z,c.world_version,
              s.level,s.exp,s.progression_version,
              (SELECT count(*)::int FROM oldko.character_quests q WHERE q.character_id=c.id) AS quest_count,
              (SELECT count(*)::int FROM oldko.inventory i WHERE i.character_id=c.id) AS inventory_count,
              (SELECT cm.clan_id FROM oldko.clan_members cm WHERE cm.character_id=c.id LIMIT 1) AS clan_id
       FROM oldko.characters c JOIN oldko.character_stats s ON s.character_id=c.id
       WHERE c.id=$1 AND c.deleted_at IS NULL`,
      [character.id],
    );
    return rows[0] ?? null;
  }
}
