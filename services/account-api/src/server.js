import { JsonAuditSink } from './audit.js';
import { SecurityGate } from './rate-limit.js';
import { AccountService } from './service.js';
import { createHttpServer } from './http.js';
import { openApiDocument } from './openapi.js';
import { buildProductionRuntime } from './production-runtime.js';

const runtime = await buildProductionRuntime(process.env);
const service = new AccountService({
  repository: runtime.repository,
  delivery: runtime.delivery,
  audit: new JsonAuditSink(),
  securityGate: new SecurityGate(runtime.rateLimitStore)
});

if (process.env.NODE_ENV === 'production') await runtime.readinessCheck();

const server = createHttpServer({
  service,
  openApiDocument,
  trustProxy: runtime.trustProxy,
  allowedOrigins: runtime.allowedOrigins,
  readinessCheck: runtime.readinessCheck
});
const port = Number(process.env.PORT || 8080);
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', service: 'oldko-account-api', port })));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: 'shutdown', service: 'oldko-account-api', signal }));
  server.close();
  await Promise.allSettled([
    runtime.rateLimitStore?.close?.(),
    runtime.repository?.db?.end?.()
  ]);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
