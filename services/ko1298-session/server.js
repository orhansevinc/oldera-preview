'use strict';

const core = require('./server-core');

if (require.main === module) {
  require('./production-server').startProductionServers().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = core;
