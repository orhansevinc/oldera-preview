import { badRequest } from './errors.js';

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GAME_PASSWORD_RE = /^[\x21-\x7e]{10,12}$/;
const COMMON = new Set(['password123', '1234567890', 'qwerty12345', 'knightonline', 'oldko12345']);

export const CREDENTIAL_POLICY = Object.freeze({
  usernameMinBytes: 4,
  usernameMaxBytes: 20,
  passwordMinBytes: 10,
  passwordMaxBytes: 12,
  passwordEncoding: 'ASCII'
});

export function normalizeUsername(value) {
  if (typeof value !== 'string') throw badRequest('INVALID_USERNAME', 'Username is required');
  if (value !== value.trim()) throw badRequest('INVALID_USERNAME', 'Username must not contain leading or trailing whitespace');
  if (!USERNAME_RE.test(value)) {
    throw badRequest('INVALID_USERNAME', 'Username must be 4-20 ASCII bytes, start with a letter, and contain only letters, digits or underscore');
  }
  return { username: value, canonical: value.toLowerCase() };
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') throw badRequest('INVALID_EMAIL', 'Email is required');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw badRequest('INVALID_EMAIL', 'Email address is invalid');
  return email;
}

export function isGameCompatiblePassword(password) {
  if (typeof password !== 'string' || !GAME_PASSWORD_RE.test(password)) return false;
  if (Buffer.byteLength(password, 'utf8') !== password.length) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return false;
  return !COMMON.has(password.toLowerCase());
}

export function validatePassword(password) {
  if (typeof password !== 'string') throw badRequest('INVALID_PASSWORD', 'Password is required');
  const bytes = Buffer.byteLength(password, 'utf8');
  if (!GAME_PASSWORD_RE.test(password) || bytes !== password.length || bytes < CREDENTIAL_POLICY.passwordMinBytes || bytes > CREDENTIAL_POLICY.passwordMaxBytes) {
    throw badRequest('WEAK_PASSWORD', 'Password must be 10-12 printable ASCII bytes with no spaces; it is not trimmed, normalized, or truncated', {
      minBytes: CREDENTIAL_POLICY.passwordMinBytes,
      maxBytes: CREDENTIAL_POLICY.passwordMaxBytes,
      encoding: CREDENTIAL_POLICY.passwordEncoding
    });
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) throw badRequest('WEAK_PASSWORD', 'Password must use at least three character classes');
  if (COMMON.has(password.toLowerCase())) throw badRequest('WEAK_PASSWORD', 'Password is too common');
  return password;
}

export function requireToken(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 512) throw badRequest('INVALID_TOKEN', 'Token is invalid');
  return value;
}
