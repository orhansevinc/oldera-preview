import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { InMemoryAccountRepository } from './repository.js';
import { JsonAuditSink } from './audit.js';
import { NullDelivery, WebhookDelivery } from './delivery.js';
import { AccountService } from './service.js';
import { createHttpServer } from './http.js';
import { openApiDocument } from './openapi.js';

async function buildRepository() {
  const modulePath = process.env.OLDKO_ACCOUNT_REPOSITORY_MODULE;
  if (modulePath) {
    const imported = await import(modulePath.startsWith('file:') ? modulePath : pathToFileURL(path.resolve(modulePath)).href);
    if (typeof imported.createAccountRepository !== 'function') throw new Error('Repository module must export createAccountRepository()');
    return imported.createAccountRepository({ env: process.env });
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Production requires OLDKO_ACCOUNT_REPOSITORY_MODULE');
  return new InMemoryAccountRepository();
}

function buildDelivery() {
  const url = process.env.OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL;
  const secret = process.env.OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET;
  if (url && secret) return new WebhookDelivery({ url, secret });
  if (process.env.NODE_ENV === 'production') throw new Error('Production requires delivery webhook URL and secret');
  return new NullDelivery();
}

const repository = await buildRepository();
const service = new AccountService({ repository, delivery: buildDelivery(), audit: new JsonAuditSink() });
const allowedOrigins = (process.env.OLDKO_ACCOUNT_ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
const server = createHttpServer({ service, openApiDocument, trustProxy: process.env.OLDKO_TRUST_PROXY === '1', allowedOrigins });
const port = Number(process.env.PORT || 8080);
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', service: 'oldko-account-api', port })));
