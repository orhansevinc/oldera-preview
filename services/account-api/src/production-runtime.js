import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { InMemoryAccountRepository } from './repository.js';
import { NullDelivery, WebhookDelivery } from './delivery.js';
import { InMemoryRateLimitStore } from './rate-limit.js';
import { PostgresRateLimitStore } from './postgres-rate-limit.js';

export const WS07_ACCOUNT_ADAPTER_AUTHORITY = Object.freeze({
  commit: '1ae85c96319cbab11648a91ed28300e17d4c607f',
  path: 'services/oldko-data/src/adapters/ws13-account-api.js',
  gitBlobSha1: '022c32abde503a6dc3af1ff9429c206a1b20ca63'
});
export const PRODUCTION_ORIGIN = 'https://oldkoweb.com';

function resolveModuleFile(modulePath) {
  if (modulePath.startsWith('file:')) return fileURLToPath(modulePath);
  return path.resolve(modulePath);
}

async function gitBlobSha1(filePath) {
  const content = await fs.readFile(filePath);
  const prefix = Buffer.from(`blob ${content.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(prefix).update(content).digest('hex');
}

export function parseAllowedOrigins(env = process.env) {
  const origins = String(env.OLDKO_ACCOUNT_ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (env.NODE_ENV === 'production' && (origins.length !== 1 || origins[0] !== PRODUCTION_ORIGIN)) {
    throw new Error(`Production OLDKO_ACCOUNT_ALLOWED_ORIGINS must be exactly ${PRODUCTION_ORIGIN}`);
  }
  return origins;
}

export function parseTrustProxy(env = process.env) {
  const raw = env.OLDKO_TRUST_PROXY;
  if (env.NODE_ENV === 'production' && raw !== '0' && raw !== '1') {
    throw new Error('Production requires explicit OLDKO_TRUST_PROXY=0 or 1');
  }
  if (raw != null && raw !== '0' && raw !== '1') throw new Error('OLDKO_TRUST_PROXY must be 0 or 1');
  return raw === '1';
}

export async function buildRepository(env = process.env) {
  const modulePath = env.OLDKO_ACCOUNT_REPOSITORY_MODULE;
  if (!modulePath) {
    if (env.NODE_ENV === 'production') throw new Error('Production requires OLDKO_ACCOUNT_REPOSITORY_MODULE');
    return new InMemoryAccountRepository();
  }

  const moduleFile = resolveModuleFile(modulePath);
  if (env.NODE_ENV === 'production') {
    const actualBlob = await gitBlobSha1(moduleFile);
    if (actualBlob !== WS07_ACCOUNT_ADAPTER_AUTHORITY.gitBlobSha1) {
      throw new Error(`Production account repository must be exact WS07 ${WS07_ACCOUNT_ADAPTER_AUTHORITY.commit} adapter`);
    }
  }

  const imported = await import(pathToFileURL(moduleFile).href);
  if (typeof imported.createAccountRepository !== 'function') throw new Error('Repository module must export createAccountRepository()');
  const repository = await imported.createAccountRepository({ env });
  if (env.NODE_ENV === 'production') {
    if (repository instanceof InMemoryAccountRepository || repository?.constructor?.name !== 'PgWs13AccountRepository' || typeof repository?.db?.query !== 'function') {
      throw new Error('Production requires the PostgreSQL WS07 PgWs13AccountRepository');
    }
  }
  return repository;
}

export function buildDelivery(env = process.env) {
  const url = env.OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL;
  const secret = env.OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET;
  if (Boolean(url) !== Boolean(secret)) throw new Error('Delivery webhook URL and secret must be configured together');
  if (!url) {
    if (env.NODE_ENV === 'production') throw new Error('Production requires delivery webhook URL and secret');
    return new NullDelivery();
  }
  const parsed = new URL(url);
  if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') throw new Error('Production delivery webhook must use HTTPS');
  return new WebhookDelivery({ url: parsed.toString(), secret });
}

export function buildRateLimitStore(env = process.env) {
  if (env.NODE_ENV === 'production') {
    if (!env.DATABASE_URL) throw new Error('Production PostgreSQL rate limiting requires DATABASE_URL');
    return new PostgresRateLimitStore({ env });
  }
  return new InMemoryRateLimitStore();
}

export function buildReadinessCheck({ repository, rateLimitStore }) {
  return async () => {
    if (typeof repository?.db?.query !== 'function') throw new Error('Persistent account repository is unavailable');
    await repository.db.query('SELECT 1');
    await rateLimitStore.ready();
    return true;
  };
}

export async function buildProductionRuntime(env = process.env) {
  const repository = await buildRepository(env);
  const delivery = buildDelivery(env);
  const rateLimitStore = buildRateLimitStore(env);
  const allowedOrigins = parseAllowedOrigins(env);
  const trustProxy = parseTrustProxy(env);
  const readinessCheck = buildReadinessCheck({ repository, rateLimitStore });
  return { repository, delivery, rateLimitStore, allowedOrigins, trustProxy, readinessCheck };
}
