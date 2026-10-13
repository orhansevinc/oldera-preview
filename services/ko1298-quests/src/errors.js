'use strict';

class QuestError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'QuestError';
    this.code = code;
    this.details = details;
  }
}

module.exports = { QuestError };
