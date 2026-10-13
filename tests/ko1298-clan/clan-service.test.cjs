'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ClanService,
  MemoryClanRepository,
  Nation,
  ClanRole,
  ClanDuty,
  ClanLimits,
  ErrorCode,
  calculateClanGrade,
  createClanChatDirectory,
} = require('../../services/ko1298-clan/src');

function character(id, name, nation = Nation.KARUS, overrides = {}) {
  return { id, name, nation, level: 70, noah: 1_000_000, dead: false, ...overrides };
}

function fixture(characters = []) {
  const repo = new MemoryClanRepository({ characters });
  const service = new ClanService({ repository: repo, clock: () => new Date('2026-10-14T00:00:00.000Z') });
  return { repo, service };
}

async function expectClanError(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

test('creates a Karus clan with 1298 defaults and deducts 500,000 Noah', async () => {
  const { repo, service } = fixture([character('c1', 'Chief')]);
  const clan = await service.createClan({ creatorId: 'c1', name: 'Ares' });

  assert.equal(clan.id, 1);
  assert.equal(clan.nation, Nation.KARUS);
  assert.equal(clan.grade, 5);
  assert.equal(clan.ranking, 0);
  assert.equal(clan.memberCount, 1);
  assert.equal((await repo.getCharacter('c1')).noah, 500_000);
  const membership = await repo.getMembershipByCharacter('c1');
  assert.equal(membership.role, ClanRole.CHIEF);
});

test('allocates El Morad clan IDs starting at 15001', async () => {
  const { service } = fixture([character('e1', 'ElChief', Nation.ELMORAD)]);
  const clan = await service.createClan({ creatorId: 'e1', name: 'Logos' });
  assert.equal(clan.id, 15_001);
});

test('rejects duplicate clan names case-insensitively and rolls back Noah', async () => {
  const { repo, service } = fixture([character('a', 'A'), character('b', 'B')]);
  await service.createClan({ creatorId: 'a', name: 'OldKO' });
  await expectClanError(service.createClan({ creatorId: 'b', name: 'oldko' }), ErrorCode.DUPLICATE_CLAN_NAME);
  assert.equal((await repo.getCharacter('b')).noah, 1_000_000);
  assert.equal(await repo.getMembershipByCharacter('b'), null);
});

test('enforces level and Noah creation requirements', async () => {
  const low = fixture([character('l', 'Low', Nation.KARUS, { level: 19 })]);
  await expectClanError(low.service.createClan({ creatorId: 'l', name: 'LowClan' }), ErrorCode.LOW_LEVEL);

  const poor = fixture([character('p', 'Poor', Nation.KARUS, { noah: 499_999 })]);
  await expectClanError(poor.service.createClan({ creatorId: 'p', name: 'PoorClan' }), ErrorCode.LOW_NOAH);
});

test('rejects names over 30 bytes and control-character names', async () => {
  const { service } = fixture([character('c', 'Chief')]);
  await expectClanError(service.createClan({ creatorId: 'c', name: 'x'.repeat(31) }), ErrorCode.INVALID_CLAN_NAME);
  await expectClanError(service.createClan({ creatorId: 'c', name: 'Bad\u0000Name' }), ErrorCode.INVALID_CLAN_NAME);
});

test('chief or vice-chief can invite; enemy nation and offline targets are rejected', async () => {
  const { repo, service } = fixture([
    character('chief', 'Chief'),
    character('vice', 'Vice'),
    character('target', 'Target'),
    character('enemy', 'Enemy', Nation.ELMORAD),
  ]);
  const clan = await service.createClan({ creatorId: 'chief', name: 'Inviters' });
  await repo.addMembership({ clanId: clan.id, characterId: 'vice', characterName: 'Vice', role: ClanRole.VICE_CHIEF, joinedAt: 'x' });
  await repo.saveClan({ ...(await repo.getClanById(clan.id)), memberCount: 2 });

  await expectClanError(service.invite({ actorId: 'chief', targetId: 'target' }), ErrorCode.TARGET_OFFLINE);
  service.setOnlineState('target', true);
  const invite = await service.invite({ actorId: 'vice', targetId: 'target' });
  assert.equal(invite.clanId, clan.id);

  service.setOnlineState('enemy', true);
  await expectClanError(service.invite({ actorId: 'chief', targetId: 'enemy' }), ErrorCode.ENEMY_NATION);
});

test('accept and reject implement single-use invitation state', async () => {
  const { service } = fixture([character('chief', 'Chief'), character('joiner', 'Joiner'), character('rejector', 'Rejector')]);
  const clan = await service.createClan({ creatorId: 'chief', name: 'Flow' });
  service.setOnlineState('joiner', true);
  service.setOnlineState('rejector', true);

  await service.invite({ actorId: 'chief', targetId: 'joiner' });
  const joined = await service.acceptInvite({ characterId: 'joiner', clanId: clan.id });
  assert.equal(joined.role, ClanRole.KNIGHT);
  assert.equal(joined.duty, ClanDuty.KNIGHT);
  await expectClanError(service.acceptInvite({ characterId: 'joiner' }), ErrorCode.INVITE_NOT_FOUND);

  await service.invite({ actorId: 'chief', targetId: 'rejector' });
  const rejected = await service.rejectInvite({ characterId: 'rejector' });
  assert.equal(rejected.rejected, true);
  await expectClanError(service.rejectInvite({ characterId: 'rejector' }), ErrorCode.INVITE_NOT_FOUND);
});

test('enforces the 24-member 1298 clan storage limit', async () => {
  const chars = [character('chief', 'Chief'), character('target', 'Target')];
  for (let i = 1; i <= 23; i += 1) chars.push(character(`m${i}`, `Member${i}`));
  const { repo, service } = fixture(chars);
  const clan = await service.createClan({ creatorId: 'chief', name: 'Full' });
  for (let i = 1; i <= 23; i += 1) {
    await repo.addMembership({ clanId: clan.id, characterId: `m${i}`, characterName: `Member${i}`, role: ClanRole.KNIGHT, joinedAt: 'x' });
  }
  await repo.saveClan({ ...(await repo.getClanById(clan.id)), memberCount: ClanLimits.MAX_MEMBERS });
  service.setOnlineState('target', true);
  await expectClanError(service.invite({ actorId: 'chief', targetId: 'target' }), ErrorCode.CLAN_FULL);
});

test('chief can appoint up to three vice-chiefs and officers', async () => {
  const chars = [character('chief', 'Chief'), ...['a', 'b', 'c', 'd', 'o'].map((id) => character(id, id.toUpperCase()))];
  const { repo, service } = fixture(chars);
  const clan = await service.createClan({ creatorId: 'chief', name: 'Ranks' });
  for (const id of ['a', 'b', 'c', 'd', 'o']) {
    await repo.addMembership({ clanId: clan.id, characterId: id, characterName: id.toUpperCase(), role: ClanRole.KNIGHT, joinedAt: 'x' });
  }
  await repo.saveClan({ ...(await repo.getClanById(clan.id)), memberCount: 6 });

  await service.appointViceChief({ actorId: 'chief', targetId: 'a' });
  await service.appointViceChief({ actorId: 'chief', targetId: 'b' });
  await service.appointViceChief({ actorId: 'chief', targetId: 'c' });
  await expectClanError(service.appointViceChief({ actorId: 'chief', targetId: 'd' }), ErrorCode.VICE_CHIEF_LIMIT);
  const officer = await service.appointOfficer({ actorId: 'chief', targetId: 'o' });
  assert.equal(officer.role, ClanRole.OFFICER);
});

test('vice-chief may punish, but only chief may kick', async () => {
  const { repo, service } = fixture([character('chief', 'Chief'), character('vice', 'Vice'), character('member', 'Member')]);
  const clan = await service.createClan({ creatorId: 'chief', name: 'Rights' });
  await repo.addMembership({ clanId: clan.id, characterId: 'vice', characterName: 'Vice', role: ClanRole.VICE_CHIEF, joinedAt: 'x' });
  await repo.addMembership({ clanId: clan.id, characterId: 'member', characterName: 'Member', role: ClanRole.KNIGHT, joinedAt: 'x' });
  await repo.saveClan({ ...(await repo.getClanById(clan.id)), memberCount: 3 });

  const punished = await service.punishMember({ actorId: 'vice', targetId: 'member' });
  assert.equal(punished.role, ClanRole.PUNISH);
  await expectClanError(service.kick({ actorId: 'vice', targetId: 'member' }), ErrorCode.INVALID_RIGHT);
  assert.equal((await service.kick({ actorId: 'chief', targetId: 'member' })).kicked, true);
});

test('chief leave mirrors 1298 withdraw behavior by disbanding clan', async () => {
  const { repo, service } = fixture([character('chief', 'Chief'), character('member', 'Member')]);
  const clan = await service.createClan({ creatorId: 'chief', name: 'Disband' });
  await repo.addMembership({ clanId: clan.id, characterId: 'member', characterName: 'Member', role: ClanRole.KNIGHT, joinedAt: 'x' });
  await repo.saveClan({ ...(await repo.getClanById(clan.id)), memberCount: 2 });

  const result = await service.leave({ characterId: 'chief' });
  assert.equal(result.disbanded, true);
  assert.equal(await repo.getClanById(clan.id), null);
  assert.equal(await repo.getMembershipByCharacter('member'), null);
});

test('normal member leave decrements member count', async () => {
  const { repo, service } = fixture([character('chief', 'Chief'), character('member', 'Member')]);
  const clan = await service.createClan({ creatorId: 'chief', name: 'Leave' });
  await repo.addMembership({ clanId: clan.id, characterId: 'member', characterName: 'Member', role: ClanRole.KNIGHT, joinedAt: 'x' });
  await repo.saveClan({ ...(await repo.getClanById(clan.id)), memberCount: 2 });

  await service.leave({ characterId: 'member' });
  assert.equal((await repo.getClanById(clan.id)).memberCount, 1);
});

test('chief transfer updates chief ownership and demotes previous chief to knight', async () => {
  const { repo, service } = fixture([character('chief', 'Chief'), character('member', 'Member')]);
  const clan = await service.createClan({ creatorId: 'chief', name: 'Transfer' });
  await repo.addMembership({ clanId: clan.id, characterId: 'member', characterName: 'Member', role: ClanRole.KNIGHT, joinedAt: 'x' });
  await repo.saveClan({ ...(await repo.getClanById(clan.id)), memberCount: 2 });

  const next = await service.transferChief({ actorId: 'chief', targetId: 'member' });
  assert.equal(next.role, ClanRole.CHIEF);
  assert.equal((await repo.getMembershipByCharacter('chief')).role, ClanRole.KNIGHT);
  assert.equal((await repo.getClanById(clan.id)).chiefCharacterId, 'member');
});

test('grade calculation follows total NP / 24 thresholds', () => {
  assert.equal(calculateClanGrade(0), 5);
  assert.equal(calculateClanGrade(1_999 * 24), 5);
  assert.equal(calculateClanGrade(2_000 * 24), 4);
  assert.equal(calculateClanGrade(5_000 * 24), 3);
  assert.equal(calculateClanGrade(10_000 * 24), 2);
  assert.equal(calculateClanGrade(20_000 * 24), 1);
});

test('member list and WS18 chat directory expose runtime online state without persisting chat logic', async () => {
  const { repo, service } = fixture([character('chief', 'Chief'), character('member', 'Member')]);
  const clan = await service.createClan({ creatorId: 'chief', name: 'Chatters' });
  await repo.addMembership({ clanId: clan.id, characterId: 'member', characterName: 'Member', role: ClanRole.KNIGHT, joinedAt: 'x' });
  await repo.saveClan({ ...(await repo.getClanById(clan.id)), memberCount: 2 });
  service.setOnlineState('chief', true);
  service.setOnlineState('member', false);

  const all = await service.listMembers({ requesterId: 'chief' });
  assert.deepEqual(all.map((m) => [m.characterId, m.online]), [['chief', true], ['member', false]]);

  const directory = createClanChatDirectory(service);
  assert.deepEqual(await directory.listOnlineRecipients(clan.id), ['chief']);
  const context = await directory.resolveMember('chief');
  assert.equal(context.clanId, clan.id);
  assert.equal(context.duty, ClanDuty.CHIEF);
});
