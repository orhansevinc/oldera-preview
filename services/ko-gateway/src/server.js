'use strict';

const { parseConfig } = require('./config');
const { createGateway } = require('./gateway');

async function main() {
  const config = parseConfig(process.env);
  const gateway = createGateway(config);
  await gateway.listen();

  const shutdown = async (signal) => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'shutdown', signal }));
    try { await gateway.close(); } finally { process.exit(0); }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'startup_failed', message: err.message }));
  process.exit(1);
});
