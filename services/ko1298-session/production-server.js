'use strict';

const { startServers } = require('./server');
const { createProductionPostgresRepository } = require('./postgres-repository');
const { createProductionProviderComposition } = require('./production-composition');
const { SessionAuthority } = require('./session-authority');

async function startProductionServers({ env = process.env, providerOptions = {}, ...serverOptions } = {}) {
  const repository = await createProductionPostgresRepository({ env });
  try {
    const providers = createProductionProviderComposition({
      repository,
      env,
      ...providerOptions,
    });
    const sessionAuthority = serverOptions.sessionAuthority || new SessionAuthority();
    const servers = startServers({
      ...serverOptions,
      repository,
      worldSession: providers.worldSession,
      sessionAuthority,
      gameOptions: {
        ...(serverOptions.gameOptions || {}),
        movementSession: providers.movementSession,
      },
    });
    for (const server of [servers.auth, servers.game]) {
      server.on('close', () => {
        if (!servers.auth.listening && !servers.game.listening) void repository.close();
      });
    }
    return { ...servers, repository, providers, sessionAuthority };
  } catch (error) {
    await repository.close().catch(() => {});
    throw error;
  }
}

if (require.main === module) {
  startProductionServers().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { startProductionServers };
