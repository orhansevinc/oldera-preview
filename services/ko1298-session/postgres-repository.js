'use strict';

const REQUIRED_WS07_SHA = '1ae85c96319cbab11648a91ed28300e17d4c607f';

function canonicalUsername(value) {
  if (typeof value !== 'string') throw new TypeError('username must be a string');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 20 || !/^[A-Za-z][A-Za-z0-9_]{3,19}$/.test(trimmed)) {
    throw new TypeError('username is invalid for the shared website/KO1298 identity contract');
  }
  return trimmed.toLowerCase();
}

function initialWorldState(spec) {
  return {
    rank: 0,
    title: 0,
    points: 0,
    maxExp: 100,
    monthlyLoyalty: 0,
    city: 0,
    knightsId: 0,
    fame: 0,
    maxHp: 100,
    maxMp: 100,
    maxWeight: 2500,
    itemWeight: 0,
    itemStr: 0,
    itemSta: 0,
    itemDex: 0,
    itemIntel: 0,
    itemCha: 0,
    totalHit: 10,
    totalAc: 5,
    fireRes: 0,
    coldRes: 0,
    lightningRes: 0,
    magicRes: 0,
    diseaseRes: 0,
    poisonRes: 0,
    authority: 1,
    knightsRank: 0,
    personalRank: 0,
    skills: Array(9).fill(0),
    protocolItems: [],
    visibleEquipment: [],
    equipment: {},
    characterListEquipment: {},
    accountStatus: 0,
    premiumType: 0,
    premiumTime: 0,
    isChicken: false,
    mannerPoint: 0,
    resHpType: 1,
    abnormalType: 1,
    needParty: 1,
    isPartyLeader: false,
    invisibilityState: 0,
    direction: 0,
    stats: {
      str: spec.str,
      sta: spec.sta,
      dex: spec.dex,
      intel: spec.intel,
      magicAttack: spec.magicAttack,
    },
  };
}

function gameAccessAllowed(account) {
  return Boolean(
    account
    && account.status === 'active'
    && account.verifiedAt
    && !account.ban?.active
  );
}

class ProductionPostgresRepository {
  constructor({ pool, sessionRepository, worldRepository, accountRepository }) {
    if (!pool || !sessionRepository || !worldRepository || !accountRepository) {
      throw new TypeError('pool, sessionRepository, worldRepository and accountRepository are required');
    }
    this.pool = pool;
    this.sessionRepository = sessionRepository;
    this.worldRepository = worldRepository;
    this.accountRepository = accountRepository;
    this.providerSha = REQUIRED_WS07_SHA;
    this.npcWorld = null;
  }

  normalizeAccountId(value) {
    return canonicalUsername(value);
  }

  async getGameAccountAccess(username) {
    const canonical = canonicalUsername(username);
    const account = await this.accountRepository.findByUsernameCanonical(canonical);
    if (!account) return { allowed: false, code: 'ACCOUNT_NOT_FOUND', account: null };
    if (account.status !== 'active') return { allowed: false, code: 'ACCOUNT_INACTIVE', account };
    if (!account.verifiedAt) return { allowed: false, code: 'ACCOUNT_UNVERIFIED', account };
    if (account.ban?.active) return { allowed: false, code: account.ban.code || 'ACCOUNT_BANNED', account };
    return {
      allowed: true,
      code: 'OK',
      account,
      accountId: canonical,
      passwordVersion: Number(account.passwordVersion || 1),
    };
  }

  async authenticate(username, password) {
    const canonical = canonicalUsername(username);
    const access = await this.getGameAccountAccess(canonical);
    if (!access.allowed) return false;
    return this.sessionRepository.authenticate(canonical, password);
  }

  async assertGameAccountAccess(username, expectedPasswordVersion = null) {
    const access = await this.getGameAccountAccess(username);
    if (!access.allowed) return access;
    if (expectedPasswordVersion != null && access.passwordVersion !== Number(expectedPasswordVersion)) {
      return { ...access, allowed: false, code: 'PASSWORD_VERSION_CHANGED' };
    }
    return access;
  }

  async getNation(username) {
    return this.sessionRepository.getNation(canonicalUsername(username));
  }

  async setNation(username, nation) {
    return this.sessionRepository.setNation(canonicalUsername(username), nation);
  }

  async listCharacters(username) {
    return this.sessionRepository.listCharacters(canonicalUsername(username));
  }

  async createCharacter(username, spec) {
    const accountId = canonicalUsername(username);
    const result = await this.sessionRepository.createCharacter(accountId, spec);
    if (!result?.ok || !result.character) return result;

    await this.worldRepository.saveWorldState({
      accountId,
      characterId: result.character.characterId,
      state: initialWorldState(spec),
    });
    return result;
  }

  async getCharacter(username, characterId) {
    const accountId = canonicalUsername(username);
    const character = await this.sessionRepository.getCharacter(accountId, characterId);
    if (!character) return null;
    return { ...character, accountId };
  }

  async getCharacterForWorld(accountId, characterId) {
    const canonicalAccountId = canonicalUsername(accountId);
    const character = await this.worldRepository.getCharacterForWorld(canonicalAccountId, characterId);
    if (!character) return null;
    return { ...character, accountId: canonicalAccountId };
  }

  async saveWorldPosition(input) {
    return this.worldRepository.saveWorldPosition({
      ...input,
      accountId: canonicalUsername(input.accountId),
    });
  }

  async saveWorldState(input) {
    return this.worldRepository.saveWorldState({
      ...input,
      accountId: canonicalUsername(input.accountId),
    });
  }

  async loadReconnectSnapshot(accountId, characterId) {
    const canonicalAccountId = canonicalUsername(accountId);
    const character = await this.worldRepository.loadReconnectSnapshot(canonicalAccountId, characterId);
    if (!character) return null;
    return { ...character, accountId: canonicalAccountId };
  }

  async getAuthoritativeWorldState(accountId, characterId) {
    return this.loadReconnectSnapshot(accountId, characterId);
  }

  setNpcWorld(npcWorld) {
    if (!npcWorld || typeof npcWorld.nearby !== 'function') {
      throw new TypeError('npcWorld.nearby(zoneId, x, z) is required');
    }
    this.npcWorld = npcWorld;
    return this;
  }

  async getSurroundingUsers() {
    return [];
  }

  async getSurroundingNpcs({ zoneId, x, z } = {}) {
    if (!this.npcWorld) {
      const error = new Error('production NPC visibility provider is not configured');
      error.code = 'PRODUCTION_NPC_PROVIDER_REQUIRED';
      throw error;
    }
    return this.npcWorld.nearby(Number(zoneId), Number(x), Number(z));
  }

  async close() {
    await this.pool.end();
  }
}

async function loadWs07Persistence() {
  let data;
  let adapters;
  let ws13Adapter;
  try {
    [data, adapters, ws13Adapter] = await Promise.all([
      import('../oldko-data/src/index.js'),
      import('../oldko-data/src/adapters/index.js'),
      import('../oldko-data/src/adapters/ws13-account-api.js'),
    ]);
  } catch (error) {
    const wrapped = new Error(
      `WS07 persistent provider ${REQUIRED_WS07_SHA} is required at services/oldko-data for production composition`,
      { cause: error },
    );
    wrapped.code = 'WS07_PROVIDER_MISSING';
    throw wrapped;
  }

  if (typeof data.createPool !== 'function'
      || typeof adapters.PgWs03SessionRepository !== 'function'
      || typeof adapters.PgWs14WorldRepository !== 'function'
      || typeof ws13Adapter.PgWs13AccountRepository !== 'function') {
    throw new Error('WS07 persistent provider does not expose the required WS03/WS13/WS14 PostgreSQL adapters');
  }
  return { ...data, ...adapters, ...ws13Adapter };
}

async function createProductionPostgresRepository({ env = process.env, poolOptions = {} } = {}) {
  if (!env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is required for the production PostgreSQL repository');
    error.code = 'DATABASE_URL_REQUIRED';
    throw error;
  }
  const {
    createPool,
    PgWs03SessionRepository,
    PgWs14WorldRepository,
    PgWs13AccountRepository,
  } = await loadWs07Persistence();

  const pool = createPool({
    connectionString: env.DATABASE_URL,
    applicationName: 'ko1298-session',
    ...poolOptions,
  });
  return new ProductionPostgresRepository({
    pool,
    sessionRepository: new PgWs03SessionRepository(pool),
    worldRepository: new PgWs14WorldRepository(pool),
    accountRepository: new PgWs13AccountRepository(pool),
  });
}

module.exports = {
  REQUIRED_WS07_SHA,
  canonicalUsername,
  gameAccessAllowed,
  ProductionPostgresRepository,
  createProductionPostgresRepository,
};
