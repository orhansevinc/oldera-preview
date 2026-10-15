'use strict';

class ItemDomainError extends Error {
  constructor(code, message, details = undefined, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ItemDomainError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details, cause) => {
  throw new ItemDomainError(code, message, details, cause);
};

module.exports = { ItemDomainError, fail };
