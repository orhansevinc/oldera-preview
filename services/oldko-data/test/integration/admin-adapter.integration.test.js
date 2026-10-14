import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPool, DataConflictError } from '../../src/index.js';
import { PgWs08AdminRepository, WS08_REQUIRED_METHODS } from '../../src/adapters/ws08-admin.js';

const pool = createPool({ applicationName: 'ws07-ws08-admin-integration', max: 8 });
const stamp = `${Date.now()}${process.pid}`.slice(-12);
const username = `adm${stamp}`.slice(0, 30);
const character = `Admin${stamp.slice(-7)}`.slice(0, 20);
const actorId = `owner-${stamp}`;
const actorName = `OWNER${stamp}`.slice(0, 64);
const repo = new PgWs08AdminRepository(pool);
let accountId;
let characterId;

await test('WS08 production PostgreSQL adapter contract', async (t) => {
  const fixture = await pool.query(
    `INSERT INTO oldko.accounts(username,username_key,password_hash,email,status,nation,verified_at)
     VALUES($1,$2,'fixture-hash',$3,'active',1,now()) RETURNING id`,
    [username, username.toLowerCase(), `${username}@example.test`],
  );
  accountId = fixture.rows[0].id;
  const created = await pool.query(
    `INSERT INTO oldko.characters(account_id,slot,name,name_key,nation,race,class_id,zone_id,pos_x,pos_y,pos_z)
     VALUES($1,0,$2,$3,1,1,101,21,321,0,654) RETURNING id`,
    [accountId, character, character.toLowerCase()],
  );
  characterId = created.rows[0].id;
  await pool.query(`INSERT INTO oldko.character_stats(character_id,level,loyalty,gold,str,sta,dex,intel,cha) VALUES($1,3,111,222,60,61,62,63,64)`, [characterId]);
  await pool.query(`INSERT INTO oldko.account_sessions(account_id,token_hash,source_ip,expires_at,last_seen_at,password_version) VALUES($1,$2,'203.0.113.44',now()+interval '1 day',now(),1)`, [accountId, createHash('sha256').update(`player-${stamp}`).digest()]);
  await repo.upsertAdminActor({ id: actorId, username: actorName, passwordHash: 'scrypt$fixture$hash', roles: ['OWNER'] });

  await t.test('implements exact WS08 methods and reads shared account/character', async () => {
    for (const method of WS08_REQUIRED_METHODS) assert.equal(typeof repo[method], 'function', method);
    const value = await repo.getCharacter(character);
    assert.equal(value.account, username);
    assert.equal(value.className, 'Warrior');
    assert.equal(value.zone, 'Moradon');
    assert.equal(value.ip, '203.0.113.44');
    assert.deepEqual(value.stats, { str: 60, hp: 61, dex: 62, int: 63, mp: 64 });
  });

  await t.test('offline state is versioned, audited and restart-visible', async () => {
    await repo.transaction(async (tx) => {
      await tx.updateCharacter(character, { level: 4, np: 222, coin: 333, zone: 'Moradon' });
      await tx.updateStats(character, { str: 70, hp: 71, dex: 72, int: 73, mp: 74 });
      await tx.updateSkills(character, { basic: 2, attack: 1 });
      await tx.appendAudit({ actor: actorName, actorId, roles: ['OWNER'], action: 'TEST_MUTATE', target: character, reason: 'integration', traceId: `mutate-${stamp}` });
    });
    const restarted = new PgWs08AdminRepository(pool);
    const value = await restarted.getCharacter(character);
    assert.equal(value.level, 4);
    assert.equal(value.np, 222);
    assert.equal(value.coin, 333);
    assert.deepEqual(value.stats, { str: 70, hp: 71, dex: 72, int: 73, mp: 74 });
    assert.deepEqual(value.skills, { basic: 2, attack: 1 });
    assert.ok(value.versions.progression > 1);
  });

  await t.test('failed transaction rolls mutation and audit back together', async () => {
    const before = await repo.getCharacter(character);
    await assert.rejects(repo.transaction(async (tx) => {
      await tx.updateCharacter(character, { level: before.level + 1 });
      await tx.appendAudit({ actor: actorName, actorId, roles: ['OWNER'], action: 'ROLLBACK_SENTINEL', target: character, reason: 'rollback', traceId: `rollback-${stamp}` });
      throw new Error('injected failure');
    }));
    assert.equal((await repo.getCharacter(character)).level, before.level);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM oldko.audit_log WHERE request_id=$1`, [`rollback-${stamp}`])).rows[0].n, 0);
  });

  await t.test('online state comes from WS45 lease and direct persistent mutation is rejected', async () => {
    const now = Date.now();
    await pool.query(
      `INSERT INTO oldko.session_leases(scope,lease_key,session_id,server_id,state,account_id,character_id,generation,acquired_at,heartbeat_at,lease_until,version,payload)
       VALUES('character',$1,$2,'game-1','active',$3,$4,1,$5,$5,$6,1,'{}'::jsonb)`,
      [String(characterId), `online-${stamp}`, String(accountId), String(characterId), now, now + 60_000],
    );
    assert.equal((await repo.getCharacter(character)).online, true);
    await assert.rejects(repo.transaction((tx) => tx.updateCharacter(character, { level: 9 })), (error) => error instanceof DataConflictError && /online/.test(error.message));
    await pool.query(`DELETE FROM oldko.session_leases WHERE scope='character' AND lease_key=$1`, [String(characterId)]);
  });

  await t.test('inventory/inn and item history use shared item tables', async () => {
    const base = BigInt(Date.now()) * 100000n + BigInt(process.pid % 10000) * 10n;
    const ids = [];
    for (let i = 1; i <= 4; i++) {
      const row = await pool.query(`INSERT INTO oldko.item_instances(serial,item_template_id,stack_count,durability) VALUES($1,$2,1,100) RETURNING id`, [(base + BigInt(i)).toString(), 120010000 + i]);
      ids.push(row.rows[0].id);
    }
    await pool.query(`INSERT INTO oldko.character_items(character_id,slot,item_instance_id) VALUES($1,0,$2)`, [characterId, ids[0]]);
    await pool.query(`INSERT INTO oldko.inventory(character_id,slot,item_instance_id) VALUES($1,1,$2)`, [characterId, ids[1]]);
    await pool.query(`INSERT INTO oldko.inn_storage(account_id,page,slot,item_instance_id) VALUES($1,0,0,$2),($1,6,27,$3)`, [accountId, ids[2], ids[3]]);
    assert.equal((await repo.getInventory(character)).equipment[0].serial, (base + 1n).toString());
    const inn = await repo.getInn(character);
    assert.equal(inn.slots.length, 192);
    assert.equal(inn.slots[0].serial, (base + 3n).toString());
    assert.ok(!inn.slots.some((slot) => slot.serial === (base + 4n).toString()));
    const serial = (base + 1n).toString();
    const result = await repo.transaction(async (tx) => {
      const value = await tx.itemAction(serial, { action: 'FLAG', note: 'integration flag', actor: actorName });
      await tx.appendAudit({ actor: actorName, actorId, roles: ['OWNER'], action: 'ITEM_FLAG', target: serial, reason: 'integration', traceId: `item-${stamp}` });
      return value;
    });
    assert.equal(result.flag.state, 'flagged');
    assert.ok((await repo.itemHistory(serial)).some((entry) => entry.action === 'ADMIN_FLAG'));
    assert.equal((await repo.findDuplicateSerials()).duplicates.length, 0);
  });

  await t.test('sanction shares account row and command outbox is idempotent/concurrent-safe', async () => {
    const trace = `ban-${stamp}`;
    await repo.transaction(async (tx) => {
      const sanction = await tx.createSanction({ character, type: 'ACCOUNT', reason: 'integration ban', actor: actorName, traceId: trace });
      assert.equal(sanction.account, username);
      await tx.appendAudit({ actor: actorName, actorId, roles: ['OWNER'], action: 'ACCOUNT_BAN', target: character, reason: 'integration', traceId: trace });
    });
    assert.equal((await repo.getCharacter(character)).banned, true);
    await repo.removeSanction({ character, type: 'ACCOUNT' });
    const first = await repo.enqueueCommand({ command: 'NOTICE', target: '', arg: 'one', requestedBy: actorName, traceId: `cmd-${stamp}-1`, source: 'integration' });
    assert.equal((await repo.enqueueCommand({ command: 'NOTICE', target: '', arg: 'one', requestedBy: actorName, traceId: `cmd-${stamp}-1`, source: 'integration' })).id, first.id);
    await repo.enqueueCommand({ command: 'NOTICE', target: '', arg: 'two', requestedBy: actorName, traceId: `cmd-${stamp}-2`, source: 'integration' });
    const [a, b] = await Promise.all([repo.claimCommands({ workerId: `w1-${stamp}`, limit: 1 }), repo.claimCommands({ workerId: `w2-${stamp}`, limit: 1 })]);
    assert.equal(a.length, 1); assert.equal(b.length, 1); assert.notEqual(a[0].id, b[0].id);
  });

  await t.test('durable idempotency and admin sessions survive repository recreation', async () => {
    const key = `idem-${stamp}`;
    assert.equal((await repo.reserveAdminOperation({ actorId, idempotencyKey: key, request: { action: 'x', value: 1 } })).duplicate, false);
    await repo.completeAdminOperation({ actorId, idempotencyKey: key, response: { ok: true } });
    const restarted = new PgWs08AdminRepository(pool);
    assert.equal((await restarted.reserveAdminOperation({ actorId, idempotencyKey: key, request: { action: 'x', value: 1 } })).duplicate, true);
    await assert.rejects(restarted.reserveAdminOperation({ actorId, idempotencyKey: key, request: { action: 'x', value: 2 } }), DataConflictError);
    assert.equal((await restarted.getAdminActorByUsername(actorName.toLowerCase())).id, actorId);
    const tokenHash = createHash('sha256').update(`admin-token-${stamp}`).digest();
    const session = await restarted.createAdminSession({ actorId, tokenHash, expiresAt: new Date(Date.now() + 60_000), sourceIp: '198.51.100.77', userAgent: 'integration' });
    assert.equal((await restarted.getAdminSessionByTokenHash(tokenHash)).actorId, actorId);
    assert.equal(await restarted.revokeAdminSession(session.id), true);
  });

  await t.test('audit and item serial histories are append-only', async () => {
    const audit = await pool.query(`INSERT INTO oldko.audit_log(actor_admin_id,action,target_type,target_id,details) VALUES($1,'IMMUTABLE_ADMIN_TEST','test',$2,'{}') RETURNING id`, [actorId, stamp]);
    await assert.rejects(pool.query(`UPDATE oldko.audit_log SET action='mutated' WHERE id=$1`, [audit.rows[0].id]));
    const event = await pool.query(`SELECT id FROM oldko.item_serial_events ORDER BY id DESC LIMIT 1`);
    assert.ok(event.rows[0]);
    await assert.rejects(pool.query(`DELETE FROM oldko.item_serial_events WHERE id=$1`, [event.rows[0].id]));
  });
});

test.after(async () => { await pool.end(); });
