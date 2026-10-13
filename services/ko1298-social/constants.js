'use strict';

const OPCODES = Object.freeze({
  CHAT: 0x10,
  PARTY: 0x2f,
  CHAT_TARGET: 0x35,
});

const CHAT_TYPES = Object.freeze({
  GENERAL: 0x01,
  PRIVATE: 0x02,
  PARTY: 0x03,
});

const PARTY_SUBOPCODES = Object.freeze({
  CREATE: 0x01,
  PERMIT: 0x02,
  INSERT: 0x03,
  REMOVE: 0x04,
  DELETE: 0x05,
});

const LIMITS = Object.freeze({
  MAX_MESSAGE_BYTES: 512,
  MAX_NAME_BYTES: 30,
  MAX_PARTY_MEMBERS: 8,
});

const PARTY_RESULT = Object.freeze({
  GENERIC_FAILURE: -1,
  NATION_MISMATCH: -3,
});

module.exports = {
  OPCODES,
  CHAT_TYPES,
  PARTY_SUBOPCODES,
  LIMITS,
  PARTY_RESULT,
};
