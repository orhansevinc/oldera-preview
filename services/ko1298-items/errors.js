'use strict';

class ItemDomainError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ItemDomainError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new ItemDomainError(code, message, details);
};

module.exports = { ItemDomainError, fail };
