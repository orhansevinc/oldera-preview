'use strict';

const { PacketWriter } = require('./packet-writer');
const { OPCODE, ZONE_ABILITY } = require('./constants');

function buildZoneAbility({
  canTradeWithOtherNation,
  abilityType,
  canTalkToOtherNation,
  tariff,
}) {
  if (typeof canTradeWithOtherNation !== 'boolean') throw new Error('zone ability trade flag is required');
  if (!Number.isInteger(abilityType) || abilityType < 0 || abilityType > 0xff) throw new Error('zone ability type must fit uint8');
  if (typeof canTalkToOtherNation !== 'boolean') throw new Error('zone ability chat flag is required');
  if (!Number.isInteger(tariff) || tariff < -0x8000 || tariff > 0x7fff) throw new Error('zone ability tariff must fit int16');

  return new PacketWriter()
    .u8(OPCODE.ZONE_ABILITY)
    .u8(ZONE_ABILITY.UPDATE)
    .u8(canTradeWithOtherNation ? 1 : 0)
    .u8(abilityType)
    .u8(canTalkToOtherNation ? 1 : 0)
    .i16(tariff)
    .toBuffer();
}

module.exports = { buildZoneAbility };
