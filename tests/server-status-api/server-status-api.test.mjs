import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryHealthSource } from '../../services/server-status-api/src/health-source.js';
import { ServerStatusService } from '../../services/server-status-api/src/service.js';
import { createHttpServer, DIRECTORY_CACHE, REALM_CACHE } from '../../services/server-status-api/src/http.js';
import { openApiDocument } from '../../services/server-status-api/src/openapi.js';

const realms = [
  {
    realmId: 'ares-1',
    displayName: 'Ares',
    availability: 'online',
    population: 'high',
    onlinePlayerCount: 1432,
    serverVersion: '1298.2026.10.14',
    lastHeartbeat: '2026-10-14T00:00:00.000Z',
    uptimeSeconds: 7200,
    statusMessage: 'Welcome to OldKOWeb',
    minimumContentVersion: '2026.10.14.1',
    capacity: { queueSupported: true, maxPlayers: 2500, queueDepth: 12 },
    internalIp: '10.10.0.7',
    internalPort: 15001,
    databaseDsn: 'postgres://private',
    secret: 'do-not-leak',
    adminNote: 'hidden'
  },
  {
    realmId: 'beta',
    displayName: 'Beta',
    availability: 'maintenance',
    population: 'unknown',
    onlinePlayerCount: 0,
    serverVersion: '1298.2026.10.14',
    lastHeartbeat: null,
    minimumContentVersion: '2026.10.14.1',
    capacity: { queueSupported: false }
  }
];

function service(options = {}) {
  return new ServerStatusService({
    healthSource: new InMemoryHealthSource({ realms }),
    ...options
  });
}

test('public realm model exposes the required 1298 status contract', async () => {
  const result = await service().getRealm('ares-1');
  assert.equal(result.realmId, 'ares-1');
  assert.equal(result.displayName, 'Ares');
  assert.equal(result.availability, 'online');
  assert.equal(result.online, true);
  assert.equal(result.maintenance, false);
  assert.equal(result.population, 'high');
  assert.equal(result.serverVersion, '1298.2026.10.14');
  assert.equal(result.targetPatch, '1298');
  assert.equal(result.lastHeartbeat, '2026-10-14T00:00:00.000Z');
  assert.equal(result.uptimeSeconds, 7200);
  assert.equal(result.statusMessage, 'Welcome to OldKOWeb');
  assert.equal(result.client.minimumContentVersion, '2026.10.14.1');
  assert.deepEqual(result.capacity, { queueSupported: true, maxPlayers: 2500, queueDepth: 12 });
});

test('privacy projection strips internal infrastructure and count is opt-in', async () => {
  const defaultResult = await service().getRealm('ares-1');
  assert.equal('onlinePlayerCount' in defaultResult, false);
  const serialized = JSON.stringify(defaultResult);
  for (const forbidden of ['internalIp', '10.10.0.7', 'internalPort', '15001', 'databaseDsn', 'postgres://private', 'secret', 'do-not-leak', 'adminNote']) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }

  const enabled = await service({ exposeOnlinePlayerCount: true }).getRealm('ares-1');
  assert.equal(enabled.onlinePlayerCount, 1432);
});

test('directory sorts deterministically and preserves maintenance/offline semantics', async () => {
  const result = await service().listRealms();
  assert.equal(result.targetPatch, '1298');
  assert.equal(result.count, 2);
  assert.deepEqual(result.realms.map((realm) => realm.realmId), ['ares-1', 'beta']);
  assert.equal(result.realms[1].maintenance, true);
  assert.equal(result.realms[1].online, false);
});

test('health source contract rejects malformed public data instead of leaking it', async () => {
  const badSource = new InMemoryHealthSource({ realms: [{ ...realms[0], availability: 'degraded' }] });
  const badService = new ServerStatusService({ healthSource: badSource });
  await assert.rejects(() => badService.listRealms(), /availability must be online, offline, or maintenance/);
});

test('realm lookup validates IDs and returns stable public errors', async () => {
  await assert.rejects(
    () => service().getRealm('../internal'),
    (error) => error.status === 400 && error.code === 'INVALID_REALM_ID'
  );
  await assert.rejects(
    () => service().getRealm('missing'),
    (error) => error.status === 404 && error.code === 'REALM_NOT_FOUND'
  );
});

test('HTTP API is read-only, cacheable, privacy-safe, HEAD-capable, and serves OpenAPI', async (t) => {
  const server = createHttpServer({ service: service(), openApiDocument });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const directory = await fetch(`${base}/v1/realms`);
  assert.equal(directory.status, 200);
  assert.equal(directory.headers.get('cache-control'), DIRECTORY_CACHE);
  const directoryText = await directory.text();
  assert.equal(directoryText.includes('10.10.0.7'), false);
  assert.equal(directoryText.includes('do-not-leak'), false);

  const detail = await fetch(`${base}/v1/realms/ares-1`);
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get('cache-control'), REALM_CACHE);
  assert.equal((await detail.json()).realmId, 'ares-1');

  const head = await fetch(`${base}/v1/realms/ares-1`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('cache-control'), REALM_CACHE);
  assert.equal(await head.text(), '');

  const missingHead = await fetch(`${base}/v1/realms/missing`, { method: 'HEAD' });
  assert.equal(missingHead.status, 404);
  assert.equal(missingHead.headers.get('cache-control'), 'no-store');
  assert.equal(await missingHead.text(), '');

  const writeAttempt = await fetch(`${base}/v1/realms`, { method: 'POST' });
  assert.equal(writeAttempt.status, 405);
  assert.equal(writeAttempt.headers.get('cache-control'), 'no-store');

  const missing = await fetch(`${base}/v1/realms/missing`);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), 'no-store');

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: 'oldko-server-status-api', readOnly: true, targetPatch: '1298' });
  assert.equal(health.headers.get('cache-control'), 'no-store');

  const spec = await fetch(`${base}/openapi.json`);
  assert.equal(spec.status, 200);
  const specBody = await spec.json();
  assert.equal(specBody.openapi, '3.1.0');
  assert.ok(specBody.paths['/v1/realms']);
  assert.ok(specBody.paths['/v1/realms/{realmId}']);
});
