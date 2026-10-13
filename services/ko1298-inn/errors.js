'use strict';

class InnStorageError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'InnStorageError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new InnStorageError(code, message, details);
}

module.exports = { InnStorageError, fail };
