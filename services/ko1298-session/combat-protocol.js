'use strict';

// Inbound-only strict KO1298 combat decoders.
// Authority: WS11@944b6ff9b6329af29f1048a74aa6e14fca141639
// protocol-lab/gameplay-authority.json. No outbound encoder is duplicated here.

const ATTACK_PAYLOAD_BYTES = 8;
const MAGIC_PROCESS_PAYLOAD_BYTES = 22;

const MAGIC_COMMAND = Object.freeze({
  CASTING: 1,
  FLYING: 2,
  EFFECTING: 3,
  FAIL: 4,
  DURATION_EXPIRED: 5,
  CANCEL: 6,
});

const MAGIC_COMMAND_NAME = Object.freeze(Object.fromEntries(
  Object.entries(MAGIC_COMMAND).map(([name, value]) => [value, name]),
));

function parseAttackPacket(packet, opcode) {
  const p = Buffer.from(packet || []);
  if (p.length !== ATTACK_PAYLOAD_BYTES) {
    throw new RangeError(`WIZ_ATTACK C2S must be exactly ${ATTACK_PAYLOAD_BYTES} bytes including opcode`);
  }
  if (p[0] !== opcode) throw new RangeError('WIZ_ATTACK opcode mismatch');
  const attackType = p.readUInt8(1);
  if (attackType !== 1) throw new RangeError('WIZ_ATTACK C2S normal attack_type must be 1');
  const targetRuntimeId = p.readInt16LE(2);
  const clientIntervalRaw = p.readInt16LE(4);
  const clientDistanceRaw = p.readInt16LE(6);
  return Object.freeze({
    attackType,
    targetRuntimeId,
    clientObservation: Object.freeze({
      intervalRaw: clientIntervalRaw,
      intervalSeconds: clientIntervalRaw * 0.01,
      distanceRaw: clientDistanceRaw,
      distance: clientDistanceRaw * 0.1,
      authoritative: false,
    }),
  });
}

function parseMagicProcessPacket(packet, opcode) {
  const p = Buffer.from(packet || []);
  if (p.length !== MAGIC_PROCESS_PAYLOAD_BYTES) {
    throw new RangeError(`WIZ_MAGIC_PROCESS C2S must be exactly ${MAGIC_PROCESS_PAYLOAD_BYTES} bytes including opcode`);
  }
  if (p[0] !== opcode) throw new RangeError('WIZ_MAGIC_PROCESS opcode mismatch');
  const command = p.readUInt8(1);
  if (!MAGIC_COMMAND_NAME[command]) throw new RangeError(`unsupported WIZ_MAGIC_PROCESS command ${command}`);
  const skillId = p.readUInt32LE(2);
  const clientSourceId = p.readInt16LE(6);
  const targetRuntimeId = p.readInt16LE(8);
  const data = [];
  for (let offset = 10; offset < MAGIC_PROCESS_PAYLOAD_BYTES; offset += 2) data.push(p.readInt16LE(offset));
  return Object.freeze({
    command,
    commandName: MAGIC_COMMAND_NAME[command],
    skillId,
    clientSourceId,
    targetRuntimeId,
    data: Object.freeze(data),
  });
}

module.exports = {
  ATTACK_PAYLOAD_BYTES,
  MAGIC_PROCESS_PAYLOAD_BYTES,
  MAGIC_COMMAND,
  MAGIC_COMMAND_NAME,
  parseAttackPacket,
  parseMagicProcessPacket,
};
