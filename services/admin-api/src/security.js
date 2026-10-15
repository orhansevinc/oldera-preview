'use strict';

const crypto = require('node:crypto');

const ROLE_PERMISSIONS = Object.freeze({
  VIEWER: ['players:read', 'characters:read', 'items:read', 'audit:read'],
  MODERATOR: ['players:read', 'characters:read', 'items:read', 'audit:read', 'sanctions:write'],
  GM: ['players:read', 'characters:read', 'characters:write', 'items:read', 'audit:read', 'sanctions:write', 'commands:execute'],
  OWNER: ['players:read', 'characters:read', 'characters:write', 'items:read', 'items:write', 'audit:read', 'sanctions:write', 'commands:execute', 'commands:critical']
});

function timingSafeEqualText(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('base64url');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, encoded) {
  const [kind, salt, expected] = String(encoded || '').split('$');
  if (kind !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64).toString('base64url');
  return timingSafeEqualText(actual, expected);
}

function normalizeUser(user) {
  const roles = Array.from(new Set((user.roles || []).map((role) => String(role).toUpperCase())));
  const permissions = new Set();
  for (const role of roles) for (const permission of ROLE_PERMISSIONS[role] || []) permissions.add(permission);
  for (const permission of user.permissions || []) permissions.add(String(permission));
  return Object.freeze({
    id: String(user.id || user.username),
    username: String(user.username),
    passwordHash: String(user.passwordHash || ''),
    roles: Object.freeze(roles),
    permissions: Object.freeze([...permissions])
  });
}

function parseCookie(header) {
  const out = {};
  for (const chunk of String(header || '').split(';')) {
    const idx = chunk.indexOf('=');
    if (idx < 0) continue;
    out[chunk.slice(0, idx).trim()] = decodeURIComponent(chunk.slice(idx + 1).trim());
  }
  return out;
}

function createAuthService({ users = [], sessionSecret, ttlSeconds = 8 * 60 * 60, secureCookies = false } = {}) {
  if (!sessionSecret || Buffer.byteLength(String(sessionSecret)) < 32) throw new Error('ADMIN_SESSION_SECRET must be at least 32 bytes');
  const byUsername = new Map(users.map((u) => {
    const normalized = normalizeUser(u);
    return [normalized.username.toLowerCase(), normalized];
  }));

  function sign(data) {
    return crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');
  }

  function issue(user) {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ sub: user.id, usr: user.username, roles: user.roles, iat: now, exp: now + ttlSeconds, nonce: crypto.randomUUID() })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function verify(token) {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature || !timingSafeEqualText(sign(payload), signature)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return null;
      const user = byUsername.get(String(claims.usr || '').toLowerCase());
      if (!user || user.id !== claims.sub) return null;
      return user;
    } catch {
      return null;
    }
  }

  function authenticateRequest(req) {
    const cookies = parseCookie(req.headers.cookie);
    return verify(cookies.oldko_admin_session);
  }

  function cookie(token) {
    return `oldko_admin_session=${encodeURIComponent(token)}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${ttlSeconds}${secureCookies ? '; Secure' : ''}`;
  }

  function clearCookie() {
    return `oldko_admin_session=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies ? '; Secure' : ''}`;
  }

  function login(username, password) {
    const user = byUsername.get(String(username || '').trim().toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) return null;
    return { user, token: issue(user) };
  }

  return { authenticateRequest, login, cookie, clearCookie };
}

function hasPermission(user, permission) {
  return Boolean(user?.permissions?.includes(permission));
}

module.exports = { ROLE_PERMISSIONS, hashPassword, verifyPassword, createAuthService, hasPermission };
