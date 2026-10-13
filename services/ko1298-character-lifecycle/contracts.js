'use strict';

const DELETE_OPCODE = 0x03;
const CHARACTER_SLOTS_1298 = Object.freeze([0, 1, 2]);
const MAX_CONFIRMATION_KEY_BYTES_1298 = 31;

const LifecycleState = Object.freeze({
  ACTIVE: 'active',
  DELETE_IN_PROGRESS: 'delete_in_progress',
  DELETED: 'deleted'
});

const DeleteCode = Object.freeze({
  DELETED: 'DELETED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  NOT_OWNED: 'NOT_OWNED',
  CHARACTER_SELECTED: 'CHARACTER_SELECTED',
  CHARACTER_ONLINE: 'CHARACTER_ONLINE',
  CONFIRMATION_FAILED: 'CONFIRMATION_FAILED',
  DELETE_CONFLICT: 'DELETE_CONFLICT',
  DELETE_FAILED: 'DELETE_FAILED'
});

const LegacyDeletePacket1298 = Object.freeze({
  opcode: DELETE_OPCODE,
  clientRequest: [
    'uint8 slotIndex',
    'int16 characterIdLength',
    'bytes characterId',
    'int16 confirmationKeyLength',
    'bytes confirmationKey'
  ],
  clientResponse: ['uint8 result', 'uint8 slotIndexOrFF'],
  successResult: 0x01,
  failedSlot: 0xff
});

class LifecycleDomainError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'LifecycleDomainError';
    this.code = code;
    this.details = details;
  }
}

module.exports = {
  CHARACTER_SLOTS_1298,
  DELETE_OPCODE,
  MAX_CONFIRMATION_KEY_BYTES_1298,
  DeleteCode,
  LegacyDeletePacket1298,
  LifecycleDomainError,
  LifecycleState
};
