import { badRequest } from './errors.js';

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COMMON = new Set(['password123', '1234567890', 'qwerty12345', 'knightonline', 'oldko12345']);

export function normalizeUsername(value) {
  if (typeof value !== 'string') throw badRequest('INVALID_USERNAME', 'Username is required');
  const username = value.trim();
  if (!USERNAME_RE.test(username)) {
    throw badRequest('INVALID_USERNAME', 'Username must be 4-20 characters, start with a letter, and contain only letters, digits or underscore');
  }
  return { username, canonical: username.toLowerCase() };
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') throw badRequest('INVALID_EMAIL', 'Email is required');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw badRequest('INVALID_EMAIL', 'Email address is invalid');
  return email;
}

export function validatePassword(password, username = '') {
  if (typeof password !== 'string') throw badRequest('INVALID_PASSWORD', 'Password is required');
  if (password.length < 10 || password.length > 128) {
    throw badRequest('WEAK_PASSWORD', 'Password must be between 10 and 128 characters');
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) throw badRequest('WEAK_PASSWORD', 'Password must use at least three character classes');
  const lowered = password.toLowerCase();
  if (username && lowered.includes(username.toLowerCase())) throw badRequest('WEAK_PASSWORD', 'Password must not contain the username');
  if (COMMON.has(lowered)) throw badRequest('WEAK_PASSWORD', 'Password is too common');
  return password;
}

export function requireToken(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 512) throw badRequest('INVALID_TOKEN', 'Token is invalid');
  return value;
}
