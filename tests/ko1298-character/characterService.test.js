'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CharacterIdentityService,
  CharacterRuleError,
  CharacterRepositoryConflictError,
  ERROR_CODES,
  NATIONS,
  getCreationPreset,
  CREATION_PRESETS,
} = require('../../services/ko1298-character');

class FakeRepository {
  constructor({ nation = NATIONS.KARUS, slots = [null, null, null], names = [] } = {}) {
    this.account = { nation, slots: [...slots] };
    this.names = new Set(names);
    this.created = [];
    this.slotCharacters = new Map();
    this.createConflict = null;
  }

  async getAccountCharacterState(accountId) {
    return accountId === 'acct' ? { nation: this.account.nation, slots: [...this.account.slots] } : null;
  }

  async isCharacterNameTaken(name) {
    return this.names.has(name);
  }

  async createCharacter(record) {
    if (this.createConflict) throw this.createConflict;
    this.created.push(record);
    this.names.add(record.name);
    this.account.slots[record.slot] = record.name;
    this.slotCharacters.set(`${record.accountId}:${record.slot}`, { name: record.name });
  }

  async getCharacterAtSlot(accountId, slot) {
    return this.slotCharacters.get(`${accountId}:${slot}`) || null;
  }
}

class FakeSpawnProvider {
  async resolveStartingSpawn(identity) {
    return { zoneId: identity.nation, spawnKey: 'ZONE_INIT' };
  }
}

class FakeItemProvider {
  async resolveStartingItems(identity) {
    return [{ policy: 'TEST_FIXTURE', classId: identity.classId }];
  }
}

function makeService(repository = new FakeRepository()) {
  return {
    repository,
    service: new CharacterIdentityService({
      repository,
      startingSpawnProvider: new FakeSpawnProvider(),
      startingItemProvider: new FakeItemProvider(),
    }),
  };
}

function distributedStats(race, classId, field = 'strength') {
  const preset = getCreationPreset(race, classId);
  return { ...preset.baseStats, [field]: preset.baseStats[field] + preset.bonusPoints };
}

function validKarusRequest(overrides = {}) {
  return {
    accountId: 'acct',
    slot: 0,
    name: 'Knight_01',
    nameByteLength: 9,
    race: 1,
    classId: 101,
    face: 0,
    hair: 0,
    stats: distributedStats(1, 101),
    ...overrides,
  };
}

async function expectRuleCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof CharacterRuleError, true);
    assert.equal(error.code, code);
    return true;
  });
}

test('1298 catalog contains exactly the 14 NewChrValue race/class presets', () => {
  assert.equal(Object.keys(CREATION_PRESETS).length, 14);
  assert.deepEqual(getCreationPreset(1, 101).baseStats, {
    strength: 65, stamina: 65, dexterity: 60, intelligence: 50, magicPower: 50,
  });
  assert.equal(getCreationPreset(1, 101).bonusPoints, 10);
  assert.equal(getCreationPreset(2, 103), null);
  assert.ok(getCreationPreset(13, 201));
});

test('creates a valid character with server-owned nation and 1298 initial progression', async () => {
  const { service, repository } = makeService();
  const created = await service.createCharacter(validKarusRequest());

  assert.equal(created.nation, NATIONS.KARUS);
  assert.equal(created.level, 1);
  assert.equal(created.experience, 0);
  assert.equal(created.unspentStatPoints, 0);
  assert.equal(created.unspentSkillPoints, 0);
  assert.deepEqual(created.startingSpawn, { zoneId: 1, spawnKey: 'ZONE_INIT' });
  assert.equal(repository.created.length, 1);
});

test('accepts all 14 authoritative NewChrValue race/class pairs', async () => {
  let index = 0;
  for (const preset of Object.values(CREATION_PRESETS)) {
    const nation = preset.race < 10 ? NATIONS.KARUS : NATIONS.ELMORAD;
    const repository = new FakeRepository({ nation });
    const { service } = makeService(repository);
    const name = `C${index}_ok`;
    await service.createCharacter({
      accountId: 'acct',
      slot: 0,
      name,
      nameByteLength: name.length,
      race: preset.race,
      classId: preset.classId,
      face: 3,
      hair: 2,
      stats: { ...preset.baseStats, strength: preset.baseStats.strength + preset.bonusPoints },
    });
    index += 1;
  }
  assert.equal(index, 14);
});

test('rejects race/class pair missing from 1298 NewChrValue.tbl', async () => {
  const { service } = makeService();
  await expectRuleCode(
    service.createCharacter(validKarusRequest({ race: 2, classId: 103, stats: { strength: 60, stamina: 60, dexterity: 70, intelligence: 50, magicPower: 60 } })),
    ERROR_CODES.RACE_CLASS_MISMATCH,
  );
});

test('rejects modern or mastered class IDs', async () => {
  const { service } = makeService();
  await expectRuleCode(
    service.createCharacter(validKarusRequest({ classId: 105 })),
    ERROR_CODES.INVALID_CLASS,
  );
});

test('rejects race and class from the wrong nation', async () => {
  const { service } = makeService();
  await expectRuleCode(
    service.createCharacter(validKarusRequest({ race: 11, classId: 201, stats: distributedStats(11, 201) })),
    ERROR_CODES.NATION_RACE_MISMATCH,
  );
  await expectRuleCode(
    service.createCharacter(validKarusRequest({ classId: 201 })),
    ERROR_CODES.NATION_CLASS_MISMATCH,
  );
});

test('never trusts a packet-supplied nation over repository nation', async () => {
  const { service } = makeService();
  await expectRuleCode(
    service.createCharacter(validKarusRequest({ nation: NATIONS.ELMORAD })),
    ERROR_CODES.NATION_RACE_MISMATCH,
  );
});

test('allows underscore but rejects the 1298 special-character blacklist and whitespace bypasses', async () => {
  const { service } = makeService();
  await service.createCharacter(validKarusRequest({ name: 'A_B', nameByteLength: 3 }));

  const cases = ['A B', 'A-B', 'A.B', 'A@B', 'A\tB', 'A\nB'];
  for (const name of cases) {
    const { service: isolated } = makeService();
    await expectRuleCode(
      isolated.createCharacter(validKarusRequest({ name, nameByteLength: name.length })),
      ERROR_CODES.INVALID_NAME_CHARACTER,
    );
  }
});

test('enforces non-empty and 20-byte legacy name boundary', async () => {
  const { service } = makeService();
  await expectRuleCode(service.createCharacter(validKarusRequest({ name: '' , nameByteLength: 0 })), ERROR_CODES.INVALID_NAME);

  const { service: tooLong } = makeService();
  await expectRuleCode(
    tooLong.createCharacter(validKarusRequest({ name: 'abcdefghijklmnopqrstu', nameByteLength: 21 })),
    ERROR_CODES.INVALID_NAME_LENGTH,
  );

  const { service: forgedLength } = makeService();
  await expectRuleCode(
    forgedLength.createCharacter(validKarusRequest({ name: 'abcdefghijklmnopqrstu', nameByteLength: 1 })),
    ERROR_CODES.INVALID_NAME_LENGTH,
  );
});

test('rejects duplicate names before persistence', async () => {
  const { service } = makeService(new FakeRepository({ names: ['Knight_01'] }));
  await expectRuleCode(service.createCharacter(validKarusRequest()), ERROR_CODES.DUPLICATE_NAME);
});

test('enforces exactly three account slots and rejects occupied slot', async () => {
  const { service: occupied } = makeService(new FakeRepository({ slots: ['Taken', null, null] }));
  await expectRuleCode(occupied.createCharacter(validKarusRequest()), ERROR_CODES.SLOT_OCCUPIED);

  const { service: full } = makeService(new FakeRepository({ slots: ['A', 'B', 'C'] }));
  await expectRuleCode(full.createCharacter(validKarusRequest({ slot: 2 })), ERROR_CODES.ACCOUNT_CHARACTER_LIMIT);

  const { service: invalid } = makeService();
  await expectRuleCode(invalid.createCharacter(validKarusRequest({ slot: 3 })), ERROR_CODES.INVALID_SLOT);
});

test('enforces face 0..3 and hair 0..2', async () => {
  const { service } = makeService();
  await expectRuleCode(service.createCharacter(validKarusRequest({ face: 4 })), ERROR_CODES.INVALID_FACE);

  const { service: hairService } = makeService();
  await expectRuleCode(hairService.createCharacter(validKarusRequest({ hair: 3 })), ERROR_CODES.INVALID_HAIR);
});

test('rejects manipulated stats below base, unspent bonus, overspent bonus and non-integers', async () => {
  const base = getCreationPreset(1, 101).baseStats;

  const { service: below } = makeService();
  await expectRuleCode(
    below.createCharacter(validKarusRequest({ stats: { ...base, strength: base.strength - 1, stamina: base.stamina + 11 } })),
    ERROR_CODES.INVALID_STAT_DISTRIBUTION,
  );

  const { service: unspent } = makeService();
  await expectRuleCode(
    unspent.createCharacter(validKarusRequest({ stats: { ...base, strength: base.strength + 9 } })),
    ERROR_CODES.INVALID_STAT_DISTRIBUTION,
  );

  const { service: overspent } = makeService();
  await expectRuleCode(
    overspent.createCharacter(validKarusRequest({ stats: { ...base, strength: base.strength + 11 } })),
    ERROR_CODES.INVALID_STAT_DISTRIBUTION,
  );

  const { service: fractional } = makeService();
  await expectRuleCode(
    fractional.createCharacter(validKarusRequest({ stats: { ...base, strength: 65.5, stamina: 74.5 } })),
    ERROR_CODES.INVALID_STATS,
  );
});

test('maps atomic repository duplicate/slot conflicts back to domain errors', async () => {
  const duplicateRepo = new FakeRepository();
  duplicateRepo.createConflict = new CharacterRepositoryConflictError(ERROR_CODES.DUPLICATE_NAME, 'race lost');
  const { service } = makeService(duplicateRepo);
  await expectRuleCode(service.createCharacter(validKarusRequest()), ERROR_CODES.DUPLICATE_NAME);
});

test('delete preparation validates slot ownership but never performs destructive delete', async () => {
  const repository = new FakeRepository();
  repository.slotCharacters.set('acct:1', { name: 'DeleteMe' });
  const { service } = makeService(repository);

  const plan = await service.prepareDeleteCharacter({ accountId: 'acct', slot: 1, characterName: 'DeleteMe' });
  assert.deepEqual(plan, {
    accountId: 'acct', slot: 1, characterName: 'DeleteMe', destructiveDeleteEnabled: false,
  });

  await expectRuleCode(
    service.prepareDeleteCharacter({ accountId: 'acct', slot: 1, characterName: 'Other' }),
    ERROR_CODES.CHARACTER_IDENTITY_MISMATCH,
  );
});
