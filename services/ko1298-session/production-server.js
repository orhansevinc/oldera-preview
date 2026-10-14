'use strict';

const { startServers } = require('./server');
const { createProductionPostgresRepository } = require('./postgres-repository');

async function startProductionServers({ env = process.env, ...serverOptions } = {}) {
  const repository = await createProductionPostgresRepository({ env });
  try {
    const servers = startServers({ ...serverOptions, repository });
    for (const server of [servers.auth, servers.game]) {
      server.on('close', () => {
        if (!servers.auth.listening && !servers.game.listening) void repository.close();
      });
    }
    return { ...servers, repository };
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
