'use strict';

const { SessionError, ERROR_CATEGORY } = require('./errors');
const { OWNER } = require('./contracts');

function validateNpcRequestPacket(packet) {
  if (packet.length < 3) throw malformedPacket(new Error('WIZ_REQ_NPCIN missing count'), packet[0], packet.length, 'game');
  const count = packet.readUInt16LE(1);
  if (packet.length !== 3 + count * 2) {
    throw malformedPacket(new Error('WIZ_REQ_NPCIN count does not match payload length'), packet[0], packet.length, 'game');
  }
}

function clientPacketsFrom(outcome) {
  if (!outcome) return [];
  if (Buffer.isBuffer(outcome)) return [Buffer.from(outcome)];
  const source = Array.isArray(outcome.clientPackets)
    ? outcome.clientPackets
    : Array.isArray(outcome.packets)
      ? outcome.packets
      : [];
  return source.filter(Buffer.isBuffer).map(Buffer.from);
}

function malformedPacket(error, opcode, length, channel) {
  if (error instanceof SessionError) return error;
  return new SessionError('MALFORMED_PACKET', error?.message || 'malformed packet', {
    category: ERROR_CATEGORY.MALFORMED_PACKET,
    fatal: true,
    details: { opcode: Number.isInteger(opcode) ? opcode : null, length, channel },
    cause: error,
  });
}

function domainOwner(domain) {
  if (domain === 'inventory') return OWNER.WS17;
  if (domain === 'combat') return OWNER.WS19;
  if (domain === 'economy') return OWNER.WS22;
  return domain;
}

module.exports = { validateNpcRequestPacket, clientPacketsFrom, malformedPacket, domainOwner };
