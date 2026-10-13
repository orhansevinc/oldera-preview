'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SocialService,
  OPCODES,
  CHAT_TYPES,
  PARTY_SUBOPCODES,
} = require('../../services/ko1298-social');

function lp(text) {
  const bytes = Buffer.from(text, 'latin1');
  const len = Buffer.alloc(2);
  len.writeUInt16LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

function chat(type, text) {
  return Buffer.concat([Buffer.from([OPCODES.CHAT, type]), lp(text)]);
}

function target(name) {
  return Buffer.concat([Buffer.from([OPCODES.CHAT_TARGET]), lp(name)]);
}

function partyName(subopcode, name) {
  return Buffer.concat([Buffer.from([OPCODES.PARTY, subopcode]), lp(name)]);
}

function permit(accepted) {
  return Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.PERMIT, accepted ? 1 : 0]);
}

function remove(sid) {
  const packet = Buffer.alloc(4);
  packet[0] = OPCODES.PARTY;
  packet[1] = PARTY_SUBOPCODES.REMOVE;
  packet.writeInt16LE(sid, 2);
  return packet;
}

function createHarness(options = {}) {
  const deliveries = [];
  const nearby = new Map();
  const service = new SocialService({
    send(session, packet, meta) {
      deliveries.push({ to: session.sessionId, packet, meta });
    },
    nearbyRecipients(session) {
      return nearby.get(session.sessionId) ?? [];
    },
    ...options,
  });

  const add = (sessionId, sid, name, nation = 1) => service.registerSession({
    sessionId, sid, name, nation,
    level: 60, classId: 106, maxHp: 1200, hp: 1100, maxMp: 600, mp: 550,
  });

  return { service, deliveries, nearby, add };
}

test('GENERAL_CHAT routes only to sender plus integration-provided near-region recipients', () => {
  const { service, deliveries, nearby, add } = createHarness();
  add('a', 100, 'Alpha');
  add('b', 101, 'Bravo');
  add('c', 102, 'Charlie');
  nearby.set('a', ['b']);

  const result = service.handlePacket('a', chat(CHAT_TYPES.GENERAL, 'hello'));
  assert.equal(result.ok, true);
  assert.deepEqual(deliveries.map((d) => d.to).sort(), ['a', 'b']);
  assert.equal(deliveries[0].packet[0], OPCODES.CHAT);
  assert.equal(deliveries[0].packet[1], CHAT_TYPES.GENERAL);
  const textLength = deliveries[0].packet.readUInt16LE(5);
  assert.equal(deliveries[0].packet.subarray(7, 7 + textLength).toString('latin1'), 'Alpha : hello');
});

test('chat validation rejects invalid length and flood hook can reject without broadcasting', () => {
  let floodCalls = 0;
  const { service, deliveries, add } = createHarness({
    allowChat() { floodCalls++; return false; },
  });
  add('a', 100, 'Alpha');

  const flood = service.handlePacket('a', chat(CHAT_TYPES.GENERAL, 'spam'));
  assert.equal(flood.code, 'FLOOD_REJECTED');
  assert.equal(floodCalls, 1);
  assert.equal(deliveries.length, 0);

  const len = Buffer.alloc(2);
  len.writeUInt16LE(513);
  const invalid = service.handlePacket('a', Buffer.concat([
    Buffer.from([OPCODES.CHAT, CHAT_TYPES.GENERAL]), len, Buffer.alloc(513, 0x41),
  ]));
  assert.equal(invalid.code, 'INVALID_MESSAGE_LENGTH');
  assert.equal(deliveries.length, 0);
});

test('WIZ_CHAT_TARGET selects case-insensitive active target; private chat echoes to target and sender', () => {
  const { service, deliveries, add } = createHarness();
  add('a', 100, 'Alpha');
  add('b', 101, 'Bravo');

  const selected = service.handlePacket('a', target('bravo'));
  assert.equal(selected.ok, true);
  assert.equal(deliveries.at(-1).packet[0], OPCODES.CHAT_TARGET);
  assert.equal(deliveries.at(-1).packet.readUInt16LE(1), 5);

  deliveries.length = 0;
  const result = service.handlePacket('a', chat(CHAT_TYPES.PRIVATE, 'secret'));
  assert.equal(result.ok, true);
  assert.deepEqual(deliveries.map((d) => d.to), ['b', 'a']);
  assert.equal(deliveries[0].packet[1], CHAT_TYPES.PRIVATE);
});

test('invalid private target returns legacy zero-length target response', () => {
  const { service, deliveries, add } = createHarness();
  add('a', 100, 'Alpha');

  const result = service.handlePacket('a', target('Missing'));
  assert.equal(result.code, 'INVALID_PRIVATE_TARGET');
  assert.deepEqual(deliveries[0].packet, Buffer.from([OPCODES.CHAT_TARGET, 0x00, 0x00]));
  assert.equal(service.handlePacket('a', chat(CHAT_TYPES.PRIVATE, 'x')).code, 'INVALID_PRIVATE_TARGET');
});

test('PARTY_CREATE -> PARTY_PERMIT -> accept creates two-member party and party chat', () => {
  const { service, deliveries, add } = createHarness();
  add('leader', 100, 'Leader');
  add('member', 101, 'Member');

  const created = service.handlePacket('leader', partyName(PARTY_SUBOPCODES.CREATE, 'Member'));
  assert.equal(created.code, 'PARTY_CREATED_INVITE_SENT');
  assert.equal(deliveries.at(-1).to, 'member');
  assert.equal(deliveries.at(-1).packet[1], PARTY_SUBOPCODES.PERMIT);

  const accepted = service.handlePacket('member', permit(true));
  assert.equal(accepted.code, 'PARTY_INVITE_ACCEPTED');
  assert.equal(service.getPartyForSession('leader').members.length, 2);

  deliveries.length = 0;
  const partyChat = service.handlePacket('member', chat(CHAT_TYPES.PARTY, 'party-msg'));
  assert.equal(partyChat.ok, true);
  assert.deepEqual(deliveries.map((d) => d.to).sort(), ['leader', 'member']);
});

test('party invite rejects cross-nation target using legacy -3 result', () => {
  const { service, deliveries, add } = createHarness();
  add('leader', 100, 'Leader', 1);
  add('enemy', 101, 'Enemy', 2);

  const result = service.handlePacket('leader', partyName(PARTY_SUBOPCODES.CREATE, 'Enemy'));
  assert.equal(result.code, 'PARTY_NATION_MISMATCH');
  assert.equal(deliveries[0].to, 'leader');
  assert.equal(deliveries[0].packet[0], OPCODES.PARTY);
  assert.equal(deliveries[0].packet[1], PARTY_SUBOPCODES.INSERT);
  assert.equal(deliveries[0].packet.readInt16LE(2), -3);
});

test('party compatibility hook is a validation seam for legacy level/rule policy', () => {
  const { service, deliveries, add } = createHarness({ canPartyTogether: () => false });
  add('leader', 100, 'Leader');
  add('member', 101, 'Member');
  const result = service.handlePacket('leader', partyName(PARTY_SUBOPCODES.CREATE, 'Member'));
  assert.equal(result.code, 'PARTY_COMPATIBILITY_REJECTED');
  assert.equal(deliveries[0].packet.readInt16LE(2), -1);
});

test('invite reject removes a just-created leader-only party cleanly', () => {
  const { service, add } = createHarness();
  add('leader', 100, 'Leader');
  add('member', 101, 'Member');
  service.handlePacket('leader', partyName(PARTY_SUBOPCODES.CREATE, 'Member'));
  const rejected = service.handlePacket('member', permit(false));
  assert.equal(rejected.code, 'PARTY_INVITE_REJECTED');
  assert.equal(service.getPartyForSession('leader'), null);
  assert.equal(service.getSession('leader').partyId, null);
});

test('leader can invite and kick; non-leader cannot kick another member', () => {
  const { service, deliveries, add } = createHarness();
  add('leader', 100, 'Leader');
  add('m1', 101, 'Member1');
  add('m2', 102, 'Member2');

  service.handlePacket('leader', partyName(PARTY_SUBOPCODES.CREATE, 'Member1'));
  service.handlePacket('m1', permit(true));
  service.handlePacket('leader', partyName(PARTY_SUBOPCODES.INSERT, 'Member2'));
  service.handlePacket('m2', permit(true));
  assert.equal(service.getPartyForSession('leader').members.length, 3);

  const forbidden = service.handlePacket('m1', remove(102));
  assert.equal(forbidden.code, 'NOT_PARTY_LEADER');
  assert.equal(service.getPartyForSession('leader').members.length, 3);

  deliveries.length = 0;
  const kicked = service.handlePacket('leader', remove(102));
  assert.equal(kicked.code, 'PARTY_MEMBER_REMOVED');
  assert.equal(service.getSession('m2').partyId, null);
  assert.equal(service.getPartyForSession('leader').members.length, 2);
  assert.ok(deliveries.some((d) => d.packet[1] === PARTY_SUBOPCODES.REMOVE));
});

test('member leave that leaves leader alone dissolves party, matching legacy lifecycle', () => {
  const { service, add } = createHarness();
  add('leader', 100, 'Leader');
  add('member', 101, 'Member');
  service.handlePacket('leader', partyName(PARTY_SUBOPCODES.CREATE, 'Member'));
  service.handlePacket('member', permit(true));

  const result = service.handlePacket('member', remove(101));
  assert.equal(result.code, 'PARTY_MEMBER_REMOVED_AND_PARTY_DELETED');
  assert.equal(service.getPartyForSession('leader'), null);
  assert.equal(service.getSession('member').partyId, null);
});

test('leader PARTY_DELETE dissolves group; non-leader delete is rejected', () => {
  const { service, add } = createHarness();
  add('leader', 100, 'Leader');
  add('member', 101, 'Member');
  service.handlePacket('leader', partyName(PARTY_SUBOPCODES.CREATE, 'Member'));
  service.handlePacket('member', permit(true));

  const forbidden = service.handlePacket('member', Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.DELETE]));
  assert.equal(forbidden.code, 'NOT_PARTY_LEADER');
  const deleted = service.handlePacket('leader', Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.DELETE]));
  assert.equal(deleted.code, 'PARTY_DELETED');
  assert.equal(service.getPartyForSession('leader'), null);
});

test('disconnect cleanup removes member and dissolves leader-owned party without stale membership', () => {
  const { service, add } = createHarness();
  add('leader', 100, 'Leader');
  add('member', 101, 'Member');
  service.handlePacket('leader', partyName(PARTY_SUBOPCODES.CREATE, 'Member'));
  service.handlePacket('member', permit(true));

  const result = service.disconnect('leader');
  assert.equal(result.ok, true);
  assert.equal(service.getSession('leader'), null);
  assert.equal(service.getSession('member').partyId, null);
  assert.equal(service.parties.size, 0);
});

test('disconnect clears private-target references so stale private messages fail safely', () => {
  const { service, add } = createHarness();
  add('a', 100, 'Alpha');
  add('b', 101, 'Bravo');
  service.handlePacket('a', target('Bravo'));
  service.disconnect('b');
  assert.equal(service.handlePacket('a', chat(CHAT_TYPES.PRIVATE, 'hello')).code, 'INVALID_PRIVATE_TARGET');
});
