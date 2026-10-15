'use strict';

const fs = require('node:fs');
const http = require('node:http');
const { startProductionServers } = require('../ko1298-session/production-server');
const { createAdminRepository } = require('../admin-api/src/ws07-admin-repository-module');
const { createProductionAdminApi } = require('../admin-api/src/production-app');
const { createWs28CommandExecutor } = require('../admin-api/src/ws28-command-executor');
const { createAdminRuntimeAuthority } = require('./runtime-authority');
const { createAdminCommandBus } = require('./command-bus');

function readSecret(path, name) {
  if (!path) throw new Error(`${name} file is required`);
  const value = fs.readFileSync(path, 'utf8').trim();
  if (!value) throw new Error(`${name} file is empty`);
  return value;
}

function parseOrigins(value) {
  return String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(() => resolve()));
}

async function main(env = process.env) {
  const usersPath = env.ADMIN_USERS_JSON_FILE;
  const users = JSON.parse(readSecret(usersPath, 'ADMIN_USERS_JSON'));
  if (!Array.isArray(users) || users.length < 1) throw new Error('ADMIN_USERS_JSON must contain at least one admin identity');
  env.ADMIN_USERS_JSON = JSON.stringify(users);
  const sessionSecret = readSecret(env.ADMIN_SESSION_SECRET_FILE, 'ADMIN_SESSION_SECRET');
  const rootOwnerId = String(env.ADMIN_ROOT_OWNER_ID || '').trim();
  if (!rootOwnerId) throw new Error('ADMIN_ROOT_OWNER_ID is required');
  const allowedOrigins = parseOrigins(env.ADMIN_ALLOWED_ORIGINS);
  if (!allowedOrigins.length) throw new Error('ADMIN_ALLOWED_ORIGINS is required');

  const game = await startProductionServers({ env });
  let adminRepository;
  let adminServer;
  try {
    adminRepository = await createAdminRepository({ env });
    const runtimeAuthority = createAdminRuntimeAuthority({ sessionAuthority: game.sessionAuthority, repository: adminRepository });
    const commandBus = createAdminCommandBus({ sessionAuthority: game.sessionAuthority, repository: adminRepository });
    const commandExecutor = createWs28CommandExecutor({ repository: adminRepository, commandBus });
    const api = createProductionAdminApi({
      repository: adminRepository,
      runtimeAuthority,
      commandExecutor,
      users,
      rootOwnerId,
      sessionSecret,
      allowedOrigins,
      secureCookies: env.ADMIN_SECURE_COOKIES !== '0'
    });
    const adminPort = Number(env.ADMIN_PORT || 8088);
    adminServer = http.createServer(api.handler);
    await new Promise((resolve, reject) => {
      adminServer.once('error', reject);
      adminServer.listen(adminPort, '0.0.0.0', resolve);
    });
    console.log(JSON.stringify({ event: 'listening', service: 'oldkoweb-domain-runtime', adminPort, authPort: Number(env.AUTH_PORT || 15100), gamePort: Number(env.GAME_PORT || 15001), persistence: 'postgres', adminRuntimeAuthority: 'WS03_SESSION_AUTHORITY', commandBus: 'WS28_REAL_DOWNSTREAM' }));

    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(JSON.stringify({ event: 'shutdown', service: 'oldkoweb-domain-runtime', signal }));
      await Promise.allSettled([closeServer(adminServer), closeServer(game.auth), closeServer(game.game)]);
      await adminRepository?.close?.().catch(() => {});
    };
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
    return { game, adminRepository, adminServer, runtimeAuthority, commandBus, commandExecutor };
  } catch (error) {
    await Promise.allSettled([closeServer(adminServer), closeServer(game.auth), closeServer(game.game)]);
    await adminRepository?.close?.().catch(() => {});
    throw error;
  }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});

module.exports = { main };
