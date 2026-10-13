export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (code = 'INVALID_CREDENTIALS', message = 'Invalid credentials') => new AppError(401, code, message);
export const forbidden = (code, message) => new AppError(403, code, message);
export const locked = (code, message, details) => new AppError(423, code, message, details);
export const conflict = (code, message) => new AppError(409, code, message);
export const tooMany = (retryAfterSeconds) => new AppError(429, 'RATE_LIMITED', 'Too many requests', { retryAfterSeconds });
