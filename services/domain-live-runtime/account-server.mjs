import { JsonAuditSink } from '../account-api/src/audit.js';
import { AccountService } from '../account-api/src/service.js';
import { createHttpServer } from '../account-api/src/http.js';
import { openApiDocument } from '../account-api/src/openapi.js';
import { NullDelivery } from '../account-api/src/delivery.js';
import { SecurityGate } from '../account-api/src/rate-limit.js';
import { PostgresRateLimitStore } from '../account-api/src/postgres-rate-limit.js';
import { createAccountRepository } from '../oldko-data/src/adapters/ws13-account-api.js';

const env = process.env;
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const repository = createAccountRepository({ env });
const rateLimitStore = new PostgresRateLimitStore({ env });
const allowedOrigins = String(env.OLDKO_ACCOUNT_ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
if (!allowedOrigins.length) throw new Error('OLDKO_ACCOUNT_ALLOWED_ORIGINS is required');
const service = new AccountService({
  repository,
  delivery: new NullDelivery(),
  audit: new JsonAuditSink(),
  securityGate: new SecurityGate(rateLimitStore)
});
const readinessCheck = async () => {
  await repository.db.query('SELECT 1');
  await rateLimitStore.ready();
  return true;
};
await readinessCheck();
const server = createHttpServer({ service, openApiDocument, trustProxy: env.OLDKO_TRUST_PROXY === '1', allowedOrigins, readinessCheck });
const port = Number(env.ACCOUNT_PORT || 8081);
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', service: 'oldko-account-api', port, persistence: 'postgres', delivery: 'disabled-until-domain-mail-provider' })));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: 'shutdown', service: 'oldko-account-api', signal }));
  server.close();
  await Promise.allSettled([rateLimitStore.close?.(), repository.db.end?.()]);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
