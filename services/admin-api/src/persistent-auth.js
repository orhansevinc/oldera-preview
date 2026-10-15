'use strict';

const crypto = require('node:crypto');
const { verifyPassword } = require('./security');

const ROLE_PERMISSIONS = Object.freeze({
  VIEWER: ['players:read', 'characters:read', 'items:read', 'audit:read'],
  MODERATOR: ['players:read', 'characters:read', 'items:read', 'audit:read', 'sanctions:write', 'gm.account.ban', 'gm.account.unban', 'gm.chat.mute', 'gm.chat.unmute'],
  GM: ['players:read', 'characters:read', 'characters:write', 'items:read', 'audit:read', 'sanctions:write', 'commands:execute', 'gm.player.kick', 'gm.player.teleport', 'gm.player.summon', 'gm.account.ban', 'gm.account.unban', 'gm.chat.mute', 'gm.chat.unmute', 'gm.notice.zone', 'gm.notice.global', 'gm.server.read'],
  OWNER: ['players:read', 'characters:read', 'characters:write', 'items:read', 'items:write', 'audit:read', 'sanctions:write', 'commands:execute', 'commands:critical', 'gm.player.kick', 'gm.player.teleport', 'gm.player.summon', 'gm.account.ban', 'gm.account.unban', 'gm.chat.mute', 'gm.chat.unmute', 'gm.notice.zone', 'gm.notice.global', 'gm.server.read']
});

function timingSafeEqualText(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function parseCookie(header) {
  const out = {};
  for (const chunk of String(header || '').split(';')) {
    const i = chunk.indexOf('=');
    if (i < 0) continue;
    out[chunk.slice(0, i).trim()] = decodeURIComponent(chunk.slice(i + 1).trim());
  }
  return out;
}

function normalizeUsers(users, rootOwnerId) {
  if (!rootOwnerId) throw new Error('ADMIN_ROOT_OWNER_ID is required');
  const seen = new Set();
  let ownerMatches = 0;
  const normalized = users.map((raw) => {
    const id = String(raw.id || '').trim();
    const username = String(raw.username || '').trim();
    if (!id || !username || !raw.passwordHash) throw new Error('Every admin identity requires id, username and passwordHash');
    if (seen.has(id)) throw new Error(`Duplicate admin id: ${id}`);
    seen.add(id);
    const requested = new Set((raw.roles || []).map((r) => String(r).toUpperCase()));
    requested.delete('OWNER');
    if (id === String(rootOwnerId)) { requested.add('OWNER'); ownerMatches += 1; }
    const permissions = new Set();
    for (const role of requested) for (const p of ROLE_PERMISSIONS[role] || []) permissions.add(p);
    for (const p of raw.permissions || []) permissions.add(String(p));
    return Object.freeze({ id, username, passwordHash: String(raw.passwordHash), roles: Object.freeze([...requested]), permissions: Object.freeze([...permissions]) });
  });
  if (ownerMatches !== 1) throw new Error('ADMIN_ROOT_OWNER_ID must match exactly one configured admin identity');
  return normalized;
}

function createPersistentAuth({ repository, users, rootOwnerId, sessionSecret, ttlSeconds = 8 * 60 * 60, secureCookies = true } = {}) {
  if (!sessionSecret || Buffer.byteLength(String(sessionSecret)) < 32) throw new Error('ADMIN_SESSION_SECRET must be at least 32 bytes');
  const identities = normalizeUsers(users || [], rootOwnerId);
  const byUsername = new Map(identities.map((u) => [u.username.toLowerCase(), u]));
  const byId = new Map(identities.map((u) => [u.id, u]));
  const digestHex = (label, value) => crypto.createHmac('sha256', sessionSecret).update(`${label}:${String(value)}`).digest('hex');
  const csrfForToken = (token) => crypto.createHmac('sha256', sessionSecret).update(`csrf:${String(token)}`).digest('base64url');

  function sessionCookie(token) {
    return `oldko_admin_session=${encodeURIComponent(token)}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${ttlSeconds}${secureCookies ? '; Secure' : ''}`;
  }
  function csrfCookie(token) {
    return `oldko_admin_csrf=${encodeURIComponent(token)}; Path=/api/admin; SameSite=Strict; Max-Age=${ttlSeconds}${secureCookies ? '; Secure' : ''}`;
  }
  function clearCookies() {
    const suffix = secureCookies ? '; Secure' : '';
    return [
      `oldko_admin_session=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${suffix}`,
      `oldko_admin_csrf=; Path=/api/admin; SameSite=Strict; Max-Age=0${suffix}`
    ];
  }

  async function login(username, password, context = {}) {
    const user = byUsername.get(String(username || '').trim().toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = csrfForToken(token);
    const now = Date.now();
    const session = await repository.createAdminSession({
      userId: user.id,
      tokenHash: digestHex('session', token),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
      sourceIp: context.sourceIp || null,
      userAgent: context.userAgent || null
    });
    return { user, session, cookies: [sessionCookie(token), csrfCookie(csrf)], csrfToken: csrf };
  }

  async function authenticateRequest(req) {
    const cookies = parseCookie(req.headers.cookie);
    const token = cookies.oldko_admin_session;
    if (!token) return null;
    const session = await repository.getAdminSession(digestHex('session', token));
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) return null;
    const user = byId.get(String(session.userId || session.actorId));
    if (!user) return null;
    return { user, session, csrfCookie: cookies.oldko_admin_csrf || '', expectedCsrf: csrfForToken(token) };
  }

  function verifyCsrf(req, authn) {
    const header = String(req.headers['x-csrf-token'] || '');
    const cookie = String(authn?.csrfCookie || '');
    const expected = String(authn?.expectedCsrf || '');
    return Boolean(header && cookie && expected && timingSafeEqualText(header, cookie) && timingSafeEqualText(header, expected));
  }

  async function logout(authn) {
    if (authn?.session?.id) await repository.revokeAdminSession(authn.session.id, 'LOGOUT');
  }

  return { login, authenticateRequest, verifyCsrf, logout, clearCookies, hasPermission: (user, p) => Boolean(user?.permissions?.includes(p)) };
}

module.exports = { ROLE_PERMISSIONS, createPersistentAuth, normalizeUsers, parseCookie };
