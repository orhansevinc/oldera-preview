export class LootDomainError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'LootDomainError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new LootDomainError(code, message, details);
}
