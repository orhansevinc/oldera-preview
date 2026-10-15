class ProgressionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ProgressionError';
    this.code = code;
    this.details = details;
  }
}

function invariant(condition, code, message, details) {
  if (!condition) throw new ProgressionError(code, message, details);
}

module.exports = { ProgressionError, invariant };
