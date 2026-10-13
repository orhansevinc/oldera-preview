import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRankingRepository } from '../../services/ranking-api/src/repository.js';
import { RankingService } from '../../services/ranking-api/src/service.js';
import { createHttpServer } from '../../services/ranking-api/src/http.js';
import { openApiDocument } from '../../services/ranking-api/src/openapi.js';

const updatedAt = '2026-10-14T00:00:00.000Z';
const characters = [
  { characterId: '3', name: 'Zulu', nation: 'karus', classCode: 'rogue', level: 70, nationalPoints: 500, clanName: 'A', accountUsername: 'secret-user', email: 'private@example.test', ip: '10.0.0.1', banReason: 'private' },
  { characterId: '2', name: 'bravo', nation: 'el_morad', classCode: 'mage', level: 70, nationalPoints: 900, clanName: 'B' },
  { characterId: '1', name: 'Alpha', nation: 'karus', classCode: 'rogue', level: 71, nationalPoints: 500, clanName: 'A' },
  { characterId: '4', name: 'alpha', nation: 'karus', classCode: 'mage', level: 70, nationalPoints: 100, clanName: 'C' }
];
const clans = [
  { clanId: 'c2', name: 'Wolves', nation: 'karus', points: 1000, memberCount: 20, chiefName: 'Chief2', adminNote: 'hide' },
  { clanId: 'c1', name: 'Angels', nation: 'el_morad', points: 1000, memberCount: 18, chiefName: 'Chief1' },
  { clanId: 'c3', name: 'Zero', nation: 'karus', points: 10, memberCount: 3, chiefName: 'Chief3' }
];

function service() {
  return new RankingService({ repository: new InMemoryRankingRepository({ characters, clans, updatedAt }) });
}

test('level ranking uses competition ties and deterministic tie ordering', async () => {
  const result = await service().characterRanking({ metric: 'level', page: 1, pageSize: 10 });
  assert.deepEqual(result.items.map((x) => [x.rank, x.name]), [[1, 'Alpha'], [2, 'alpha'], [2, 'bravo'], [2, 'Zulu']]);
  assert.equal(result.updatedAt, updatedAt);
});

test('national point ranking, nation filter, class filter, search and pagination work together', async () => {
  const result = await service().characterRanking({ metric: 'national_points', nation: 'karus', classCode: 'rogue', search: 'l', page: 1, pageSize: 1 });
  assert.equal(result.pagination.total, 2);
  assert.equal(result.pagination.totalPages, 2);
  assert.deepEqual(result.items.map((x) => [x.rank, x.name]), [[1, 'Alpha']]);
});

test('public character projection strips private repository fields', async () => {
  const result = await service().characterRanking({ metric: 'level', page: 1, pageSize: 10 });
  const serialized = JSON.stringify(result);
  for (const forbidden of ['accountUsername', 'secret-user', 'email', 'private@example.test', 'ip', '10.0.0.1', 'banReason']) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test('clan ranking supports ties and strips extra internal fields', async () => {
  const result = await service().clanRanking({ page: 1, pageSize: 10 });
  assert.deepEqual(result.items.map((x) => [x.rank, x.name]), [[1, 'Angels'], [1, 'Wolves'], [3, 'Zero']]);
  assert.equal(JSON.stringify(result).includes('adminNote'), false);
});

test('HTTP API is read-only, emits cache headers, validates input, and serves OpenAPI', async (t) => {
  const server = createHttpServer({ service: service(), openApiDocument });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const ranking = await fetch(`${base}/v1/rankings/levels?nation=karus&pageSize=2`);
  assert.equal(ranking.status, 200);
  assert.equal(ranking.headers.get('cache-control'), 'public, max-age=30, stale-while-revalidate=60');
  const body = await ranking.json();
  assert.equal(body.pagination.pageSize, 2);
  assert.ok(body.items.every((x) => x.nation === 'karus'));

  const invalid = await fetch(`${base}/v1/rankings/levels?nation=orc`);
  assert.equal(invalid.status, 400);

  const writeAttempt = await fetch(`${base}/v1/rankings/levels`, { method: 'POST' });
  assert.equal(writeAttempt.status, 405);
  assert.equal(writeAttempt.headers.get('cache-control'), 'no-store');

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: 'oldko-ranking-api', readOnly: true });

  const spec = await fetch(`${base}/openapi.json`);
  assert.equal(spec.status, 200);
  const specBody = await spec.json();
  assert.ok(specBody.paths['/v1/rankings/clans']);
  assert.ok(specBody.paths['/v1/rankings/national-points']);
});
