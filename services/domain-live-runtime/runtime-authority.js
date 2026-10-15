'use strict';

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function ensurePatch(patch, allowed) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw codedError('INVALID_PATCH', 'patch must be an object');
  for (const key of Object.keys(patch)) if (!allowed.has(key)) throw codedError('INVALID_PATCH', `unsupported online mutation field: ${key}`);
}

function onlineEnvelope(player) {
  if (!player) return null;
  return {
    name: String(player.characterId), characterId: String(player.characterId), accountId: String(player.accountId),
    socketId: Number(player.socketId), zoneId: player.zoneId == null ? null : Number(player.zoneId),
    position: player.position || null, state: player.state || null, online: true, authority: 'WS03_SESSION_AUTHORITY'
  };
}

class AdminRuntimeAuthority {
  constructor({ sessionAuthority, repository }) {
    if (!sessionAuthority || typeof sessionAuthority.listOnlinePlayers !== 'function') throw new TypeError('sessionAuthority is required');
    if (!repository || typeof repository.getCharacter !== 'function' || typeof repository.transaction !== 'function') throw new TypeError('persistent admin repository is required');
    this.sessionAuthority = sessionAuthority;
    this.repository = repository;
  }

  listOnlineCharacters() { return this.sessionAuthority.listOnlinePlayers().map(onlineEnvelope); }
  findPlayer(name) { return this.sessionAuthority.findOnlinePlayer({ characterId: String(name) }); }
  async isCharacterOnline(identity = {}) { const name = identity.name || identity.characterId || identity.id; return Boolean(name && this.findPlayer(name)); }

  async getCharacterState(name) {
    const persisted = await this.repository.getCharacter(name);
    if (!persisted) return null;
    const player = this.findPlayer(persisted.name || name);
    return player ? { ...onlineEnvelope(player), versions: persisted.versions || null, version: persisted.version || null } : {
      name: persisted.name || String(name), online: false, authority: 'WS03_SESSION_AUTHORITY', versions: persisted.versions || null, version: persisted.version || null
    };
  }

  async mutateOnlineCharacter({ name, kind, patch, expectedVersion }) {
    const persisted = await this.repository.getCharacter(name);
    if (!persisted) throw codedError('CHARACTER_NOT_FOUND', `character not found: ${name}`);
    const player = this.findPlayer(persisted.name || name);
    if (!player) throw codedError('PLAYER_NOT_ONLINE', `character is not online: ${name}`);
    const operation = String(kind || '').toUpperCase();
    if (operation === 'CHARACTER_EDIT') ensurePatch(patch, new Set(['level', 'np', 'coin']));
    else if (operation === 'STATS_EDIT') ensurePatch(patch, new Set(['str', 'hp', 'dex', 'int', 'mp']));
    else if (operation === 'SKILLS_EDIT') ensurePatch(patch, new Set(['attack', 'defense', 'class', 'master']));
    else throw codedError('UNSUPPORTED_ONLINE_MUTATION', `unsupported runtime mutation kind: ${operation}`);

    return this.repository.transaction(async (tx) => {
      await tx.assertVersion(name, expectedVersion, 'progression');
      const { rows } = await tx.db.query(`SELECT c.id FROM oldko.characters c WHERE c.name_key=lower($1) AND c.deleted_at IS NULL FOR UPDATE`, [String(name)]);
      if (!rows[0]) throw codedError('CHARACTER_NOT_FOUND', `character not found: ${name}`);
      const characterId = rows[0].id;
      if (operation === 'CHARACTER_EDIT') {
        const fields = []; const values = [];
        const add = (column, value) => { values.push(value); fields.push(`${column}=$${values.length}`); };
        if (Object.hasOwn(patch, 'level')) { const v = Number(patch.level); if (!Number.isInteger(v) || v < 1 || v > 83) throw codedError('INVALID_LEVEL', 'level must be 1-83'); add('level', v); }
        if (Object.hasOwn(patch, 'np')) { const v = Number(patch.np); if (!Number.isSafeInteger(v) || v < 0) throw codedError('INVALID_NP', 'np must be a non-negative integer'); add('loyalty', v); }
        if (Object.hasOwn(patch, 'coin')) { const v = Number(patch.coin); if (!Number.isSafeInteger(v) || v < 0) throw codedError('INVALID_COIN', 'coin must be a non-negative integer'); add('gold', v); }
        if (fields.length) { values.push(characterId); await tx.db.query(`UPDATE oldko.character_stats SET ${fields.join(',')}, progression_version=progression_version+1, updated_at=now() WHERE character_id=$${values.length}`, values); }
      } else if (operation === 'STATS_EDIT') {
        const map = { str: 'str', hp: 'sta', dex: 'dex', int: 'intel', mp: 'cha' }; const fields = []; const values = [];
        for (const [key, column] of Object.entries(map)) if (Object.hasOwn(patch, key)) { const v = Number(patch[key]); if (!Number.isInteger(v) || v < 0 || v > 255) throw codedError('INVALID_STAT', `${key} must be 0-255`); values.push(v); fields.push(`${column}=$${values.length}`); }
        if (fields.length) { values.push(characterId); await tx.db.query(`UPDATE oldko.character_stats SET ${fields.join(',')}, progression_version=progression_version+1, updated_at=now() WHERE character_id=$${values.length}`, values); }
      } else {
        const nextSkills = {};
        for (const key of ['attack', 'defense', 'class', 'master']) if (Object.hasOwn(patch, key)) { const v = Number(patch[key]); if (!Number.isInteger(v) || v < 0 || v > 255) throw codedError('INVALID_SKILL', `${key} must be 0-255`); nextSkills[key] = v; }
        await tx.db.query(`INSERT INTO oldko.character_skills(character_id,skills) VALUES($1,$2::jsonb) ON CONFLICT(character_id) DO UPDATE SET skills=oldko.character_skills.skills || EXCLUDED.skills, updated_at=now()`, [characterId, JSON.stringify(nextSkills)]);
        await tx.db.query(`UPDATE oldko.character_stats SET progression_version=progression_version+1, updated_at=now() WHERE character_id=$1`, [characterId]);
      }
      const after = await tx.getCharacter(name);
      return { ...after, online: true, applied: true, authority: 'WS03_SESSION_AUTHORITY+WS07_POSTGRES' };
    });
  }
}

function createAdminRuntimeAuthority(options) { return new AdminRuntimeAuthority(options); }
module.exports = { AdminRuntimeAuthority, createAdminRuntimeAuthority };
