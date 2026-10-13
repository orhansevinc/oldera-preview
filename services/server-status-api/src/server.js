import { InMemoryHealthSource } from './health-source.js';
import { ServerStatusService } from './service.js';
import { createHttpServer } from './http.js';
import { openApiDocument } from './openapi.js';

const port = Number.parseInt(process.env.PORT ?? '8080', 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');

// Production integration replaces this adapter with the authoritative heartbeat source.
// Keeping the default empty avoids inventing realm health when no source is configured.
const healthSource = new InMemoryHealthSource({ realms: [] });
const service = new ServerStatusService({
  healthSource,
  exposeOnlinePlayerCount: process.env.EXPOSE_ONLINE_PLAYER_COUNT === 'true'
});

const server = createHttpServer({ service, openApiDocument });
server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'server_status_api_listening', port, targetPatch: '1298' }));
});
