'use strict';

const http = require('node:http');
const path = require('node:path');
const { createAdminApi } = require('./app');
const { MemoryAdminRepository } = require('./repository');
const { createProductionAdminApi } = require('./production-app');
const { createWs28CommandExecutor } = require('./ws28-command-executor');
const { assertProductionRepository, assertRuntimeAuthority, assertCommandBus } = require('./production-contract');

const BUNDLED_WS07_REPOSITORY_MODULE = path.join(__dirname, 'ws07-admin-repository-module.js');

function loadUsers() {
  const raw = process.env.ADMIN_USERS_JSON;
  if (!raw) throw new Error('ADMIN_USERS_JSON is required');
  const users = JSON.parse(raw);
  if (!Array.isArray(users) || !users.length) throw new Error('ADMIN_USERS_JSON must contain at least one explicit admin identity');
  return users;
}

function requireModule(envName, fallback = null) {
  const configured = process.env[envName] || fallback;
  if (!configured) throw new Error(`${envName} is required in production`);
  const resolved = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  return require(resolved);
}

async function callFactory(mod, factoryName, label) {
  const factory = mod?.[factoryName];
  if (typeof factory !== 'function') throw new Error(`${label} must export ${factoryName}()`);
  return factory({ env: process.env });
}

async function createProductionComposition() {
  const repository = assertProductionRepository(await callFactory(requireModule('ADMIN_REPOSITORY_MODULE', BUNDLED_WS07_REPOSITORY_MODULE), 'createAdminRepository', 'WS07 admin adapter module'));
  const runtimeAuthority = assertRuntimeAuthority(await callFactory(requireModule('ADMIN_RUNTIME_AUTHORITY_MODULE'), 'createAdminRuntimeAuthority', 'WS03/WS45 runtime module'));
  const commandBus = assertCommandBus(await callFactory(requireModule('ADMIN_COMMAND_BUS_MODULE'), 'createAdminCommandBus', 'WS28 command composition module'));
  const commandExecutor = createWs28CommandExecutor({ repository, commandBus });
  const allowedOrigins = String(process.env.ADMIN_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return createProductionAdminApi({
    repository,
    runtimeAuthority,
    commandExecutor,
    users: loadUsers(),
    rootOwnerId: process.env.ADMIN_ROOT_OWNER_ID,
    sessionSecret: process.env.ADMIN_SESSION_SECRET,
    allowedOrigins,
    secureCookies: true
  });
}

async function main() {
  let api;
  if (process.env.NODE_ENV === 'production') {
    api = await createProductionComposition();
  } else {
    const repository = new MemoryAdminRepository();
    api = createAdminApi({ repository, users: loadUsers(), sessionSecret: process.env.ADMIN_SESSION_SECRET, secureCookies: false });
  }
  const port = Number(process.env.PORT || 8088);
  http.createServer(api.handler).listen(port, '0.0.0.0', () => console.log(`OldKOWeb admin-api listening on :${port}`));
}

main().catch((error) => {
  console.error('OldKOWeb admin-api refused to start:', error.message);
  process.exitCode = 1;
});
