import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool, hashPassword, PgAccountRepository, PgCharacterRepository } from '../../src/index.js';

const pool = createPool({ applicationName: 'ws07-legacy-repository-integration', max: 3 });
const suffix = `${Date.now()}${process.pid}`.slice(-10);

test('existing WS07 account and character repositories honor normalized varchar persistence', async () => {
  const accounts = new PgAccountRepository(pool);
  const characters = new PgCharacterRepository(pool);
  const passwordHash = await hashPassword(`legacy-${suffix}-password`);
  const username = ` Legacy${suffix} `;
  const account = await accounts.create({ username, passwordHash });
  assert.equal(account.username, username.trim());
  assert.equal((await accounts.findByUsername(username)).id, account.id);

  const character = await characters.createCharacter(account.id, {
    slot: 0,
    name: `L${suffix}`,
    nation: 1,
    race: 1,
    classId: 101,
  });
  assert.equal(character.name, `L${suffix}`);
  assert.equal((await characters.selectCharacter(account.id, 0)).id, character.id);
});

test.after(async () => { await pool.end(); });
