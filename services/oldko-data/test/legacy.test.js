import test from 'node:test';
import assert from 'node:assert/strict';
import { PgInventoryRepository, ValidationError } from '../src/index.js';

test('legacy inventory facade rejects locations outside WS17 persistence capacities before SQL', async () => {
  const never = { connect: async () => { throw new Error('database must not be touched'); } };
  const repo = new PgInventoryRepository(never);
  await assert.rejects(
    repo.moveItem({ itemInstanceId: 1, from: { kind:'inventory', ownerId:1, slot:28 }, to: { kind:'inventory', ownerId:1, slot:0 } }),
    error => error instanceof ValidationError,
  );
  await assert.rejects(
    repo.moveItem({ itemInstanceId: 1, from: { kind:'inn', ownerId:1, page:7, slot:0 }, to: { kind:'inventory', ownerId:1, slot:0 } }),
    error => error instanceof ValidationError,
  );
});
