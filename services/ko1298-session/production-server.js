'use strict';

const { startServers } = require('./server');
const { createProductionPostgresRepository } = require('./postgres-repository');
const { createProductionProviderComposition } = require('./production-composition');
const { createP207CombatComposition } = require('./p2-07-combat-composition');
const { SessionAuthority } = require('./session-authority');
const { createProductionNpcRuntime } = require('../ko1298-npc/production');

async function startProductionServers({ env = process.env, providerOptions = {}, npcOptions = {}, ...serverOptions } = {}) {
  const repository = await createProductionPostgresRepository({ env });
  try {
    const { combatOptions = null, ...worldProviderOptions } = providerOptions;
    const providers = createProductionProviderComposition({
      repository,
      env,
      ...worldProviderOptions,
    });
    const npcRuntime = createProductionNpcRuntime({
      world: providers.npcWorld,
      ...npcOptions,
    });
    const combat = combatOptions
      ? createP207CombatComposition({ mobService: providers.mobService, ...combatOptions })
      : null;
    const sessionAuthority = serverOptions.sessionAuthority || new SessionAuthority();
    const gameOptions = {
      ...(serverOptions.gameOptions || {}),
      movementSession: providers.movementSession,
      npcRouter: npcRuntime.router,
    };
    if (!gameOptions.combatAdapter && combat?.combatAdapter) gameOptions.combatAdapter = combat.combatAdapter;
    const servers = startServers({
      ...serverOptions,
      repository,
      worldSession: providers.worldSession,
      sessionAuthority,
      gameOptions,
    });
    for (const server of [servers.auth, servers.game]) {
      server.on('close', () => {
        if (!servers.auth.listening && !servers.game.listening) void repository.close();
      });
    }
    return {
      ...servers,
      repository,
      providers: Object.freeze({
        ...providers,
        combatAdapter: combat?.combatAdapter || null,
        combatService: combat?.service || null,
      }),
      npcRuntime,
      sessionAuthority,
    };
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
