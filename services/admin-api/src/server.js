'use strict';

const http = require('node:http');
const { createAdminApi } = require('./app');
const { MemoryAdminRepository } = require('./repository');

function loadUsers() {
  const raw = process.env.ADMIN_USERS_JSON;
  if (!raw) throw new Error('ADMIN_USERS_JSON is required. Example: [{"id":"owner-1","username":"ORHAN","passwordHash":"scrypt$...","roles":["OWNER"]}]');
  const users = JSON.parse(raw);
  if (!Array.isArray(users) || !users.length) throw new Error('ADMIN_USERS_JSON must contain at least one user');
  return users;
}

function loadRepository() {
  // WS07 integration point: replace this factory with a repository implementing
  // services/admin-api/src/repository.js REQUIRED_METHODS. Admin API contains no DB migrations.
  const mode = process.env.ADMIN_REPOSITORY || (process.env.NODE_ENV === 'production' ? 'ws07' : 'memory');
  if (mode === 'memory') {
    if (process.env.NODE_ENV === 'production') throw new Error('Refusing to start production admin-api with MemoryAdminRepository');
    return new MemoryAdminRepository();
  }
  if (mode === 'ws07') throw new Error('WS07 repository adapter is not wired yet; refusing to start with fake production persistence');
  throw new Error(`Unknown ADMIN_REPOSITORY=${mode}`);
}

const repository = loadRepository();
const api = createAdminApi({ repository, users: loadUsers(), sessionSecret: process.env.ADMIN_SESSION_SECRET, secureCookies: process.env.NODE_ENV === 'production' });
const port = Number(process.env.PORT || 8088);
http.createServer(api.handler).listen(port, '0.0.0.0', () => console.log(`OldKOWeb admin-api listening on :${port}`));
