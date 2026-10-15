import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool, hashPassword, withTransaction, DataConflictError } from '../../src/index.js';
import { PgWs03SessionRepository, PgAccountSessionRepository } from '../../src/adapters/ws03-auth-session.js';
import { PgWs14WorldRepository } from '../../src/adapters/ws14-world.js';
import { PgWs17ItemRepository } from '../../src/adapters/ws17-inventory.js';
import { PgEconomyTransactionManager, PgCoinRepository, PgTradeRepository } from '../../src/adapters/ws22-economy.js';
import { PgWs27ProgressionRepository } from '../../src/adapters/ws27-progression.js';
import { PgWs45LeaseStore } from '../../src/adapters/ws45-session-ownership.js';
import { PgWs46CharacterLifecycleRepository } from '../../src/adapters/ws46-character-lifecycle.js';
import { PgOperationReceiptRepository } from '../../src/adapters/operation-receipts.js';

const pool = createPool({ applicationName: 'ws07-integration-tests', max: 8 });
const stamp = `${Date.now()}${process.pid}`.slice(-12);
const password = `integration-${stamp}-password`;

await test('WS07 production persistence contracts', async (t) => {
  const fixture = await createFixture(`it${stamp}`, ['Alpha','Bravo','Charlie'].map(v => `${v}${stamp.slice(-5)}`));
  const secondary = await createFixture(`ix${stamp}`, [`Delete${stamp.slice(-5)}`]);

  await t.test('schema has hardening tables, exact item capacities and unique serial', async () => {
    const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='oldko'`);
    const names = new Set(tables.rows.map(r => r.table_name));
    for (const name of ['economy_trades','economy_trade_participants','session_leases','persistence_operations']) assert.ok(names.has(name), name);
    const checks = await pool.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace='oldko'::regnamespace`);
    const text = checks.rows.map(r => r.def).join('\n');
    assert.match(text,/slot >= 0.*slot <= 13/i);
    assert.match(text,/slot >= 0.*slot <= 27/i);
    await pool.query(`INSERT INTO oldko.item_instances(serial,item_template_id) VALUES($1,1001)`, [(900000000000000000n-BigInt(stamp)).toString()]);
    await assert.rejects(pool.query(`INSERT INTO oldko.item_instances(serial,item_template_id) VALUES($1,1002)`, [(900000000000000000n-BigInt(stamp)).toString()]), e => e.code === '23505');
  });

  await t.test('account lifecycle blocks accidental hard delete', async () => {
    await assert.rejects(pool.query(`DELETE FROM oldko.accounts WHERE id=$1`, [fixture.accountId]), e => e.code === '55000');
  });

  await t.test('WS03 async auth/session adapter persists nation and hashed sessions', async () => {
    const repo = new PgWs03SessionRepository(pool);
    assert.equal(await repo.authenticate(fixture.username, password), true);
    assert.equal(await repo.authenticate(fixture.username, 'wrong-value'), false);
    assert.equal(await repo.setNation(fixture.username, 2), true);
    assert.equal(await repo.getNation(fixture.username), 2);
    assert.equal((await repo.listCharacters(fixture.username)).filter(Boolean).length, 3);
    const sessions = new PgAccountSessionRepository(pool);
    const tokenHash = Buffer.alloc(32, 7);
    const created = await sessions.create({ accountId: fixture.accountId, tokenHash, expiresAt: new Date(Date.now()+60_000) });
    assert.equal((await sessions.getActiveByTokenHash(tokenHash)).id, created.id);
    assert.equal(await sessions.revoke(created.id), true);
    assert.equal(await sessions.getActiveByTokenHash(tokenHash), null);
  });

  await t.test('WS17 read/transact is atomic, exact-shape and safe under concurrent writes', async () => {
    const repo = new PgWs17ItemRepository(pool);
    const owner = fixture.characterIds[0];
    const serial0 = `${BigInt(Date.now())*100000n+11n}`;
    await repo.transact(owner, state => { state.inventory[0] = { templateId:'1001',serial:serial0,quantity:1,durability:10 }; });
    let state = await repo.read(owner);
    assert.equal(state.equipment.length,14); assert.equal(state.inventory.length,28); assert.equal(state.inn.length,196);
    assert.equal(state.inventory[0].serial,serial0);

    const serialA = `${BigInt(Date.now())*100000n+12n}`;
    const serialB = `${BigInt(Date.now())*100000n+13n}`;
    const writes = await Promise.allSettled([
      repo.transact(owner, s => { if (s.inventory[1]) throw new Error('occupied'); s.inventory[1]={templateId:'1002',serial:serialA,quantity:1,durability:null}; }),
      repo.transact(owner, s => { if (s.inventory[1]) throw new Error('occupied'); s.inventory[1]={templateId:'1003',serial:serialB,quantity:1,durability:5}; }),
    ]);
    assert.equal(writes.filter(r => r.status==='fulfilled').length,1);
    assert.equal(writes.filter(r => r.status==='rejected').length,1);

    await assert.rejects(repo.transact(owner, s => { s.inventory[2]={templateId:'1004',serial:`${BigInt(Date.now())*100000n+14n}`,quantity:1,durability:1}; throw new Error('inject rollback'); }));
    state = await repo.read(owner);
    assert.equal(state.inventory[2],null);

    await assert.rejects(
      repo.transact(fixture.characterIds[1], s => { s.inventory[0]={templateId:'1001',serial:serial0,quantity:1,durability:10}; }),
      e => e instanceof DataConflictError,
    );
  });

  await t.test('WS14 world position uses optimistic versioning and reconnect loads committed snapshot', async () => {
    const repo = new PgWs14WorldRepository(pool);
    const before = await repo.getCharacterForWorld(fixture.username, fixture.names[0]);
    assert.ok(before);
    const results = await Promise.allSettled([
      repo.saveWorldPosition({ accountId:fixture.username,characterId:fixture.names[0],zoneId:21,x:313,y:0,z:403,expectedWorldVersion:before.worldVersion }),
      repo.saveWorldPosition({ accountId:fixture.username,characterId:fixture.names[0],zoneId:21,x:314,y:0,z:404,expectedWorldVersion:before.worldVersion }),
    ]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    const after = await repo.loadReconnectSnapshot(fixture.username,fixture.names[0]);
    assert.ok([[313,403],[314,404]].some(([x,z]) => after.x===x && after.z===z));
  });

  await t.test('WS27 progression save rejects stale version', async () => {
    const repo = new PgWs27ProgressionRepository(pool);
    const id = fixture.characterIds[1];
    const before = await repo.load(id);
    const a = { ...before, experience: before.experience+10n };
    const b = { ...before, experience: before.experience+20n };
    const results = await Promise.allSettled([repo.save(id,a),repo.save(id,b)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
  });

  await t.test('WS22 transaction manager serializes coin writes and trade persistence excludes double-active player', async () => {
    const manager = new PgEconomyTransactionManager(pool);
    const coins = new PgCoinRepository(pool);
    const trades = new PgTradeRepository(pool);
    const p1=fixture.characterIds[0], p2=fixture.characterIds[1], p3=fixture.characterIds[2];
    await pool.query(`UPDATE oldko.character_stats SET gold=100 WHERE character_id=$1`,[p1]);
    const spend = () => manager.run([`player:${p1}`], async tx => { const balance=await coins.getBalance(p1,{tx}); if(balance<80n) throw new Error('insufficient'); await coins.setBalance(p1,balance-80n,{tx}); });
    const spends = await Promise.allSettled([spend(),spend()]);
    assert.equal(spends.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(await coins.getBalance(p1),20n);

    const makeTrade = (id,inviter,invitee) => ({ id,inviterId:String(inviter),inviteeId:String(invitee),status:'pending',offers:{[inviter]:{coins:0n,items:[]},[invitee]:{coins:0n,items:[]}},confirmations:{[inviter]:false,[invitee]:false},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),completedAt:null,cancelReason:null });
    const first = makeTrade(`trade-${stamp}-1`,p1,p2);
    await manager.run([`player:${p1}`,`player:${p2}`], tx => trades.create(first,{tx}));
    assert.equal((await trades.findActiveByPlayer(p1)).id,first.id);
    const second = makeTrade(`trade-${stamp}-2`,p1,p3);
    await assert.rejects(manager.run([`player:${p1}`,`player:${p3}`], tx => trades.create(second,{tx})), e => e instanceof DataConflictError);
    first.status='cancelled'; first.updatedAt=new Date().toISOString();
    await manager.run([`trade:${first.id}`], tx => trades.save(first,{tx}));
  });

  await t.test('WS45 lease store provides multi-process-safe CAS semantics', async () => {
    const store = new PgWs45LeaseStore(pool);
    const key=String(fixture.accountId);
    const lease={scope:'account',key,accountId:key,characterId:null,sessionId:`s-${stamp}`,serverId:'test',state:'active',generation:1,acquiredAt:100,heartbeatAt:100,leaseUntil:1000,graceUntil:null,replacedSessionId:null};
    const first=await store.compareAndSet('account',key,null,lease);
    assert.equal(first.ok,true); assert.equal(first.record.version,1);
    const stale=await store.compareAndSet('account',key,null,{...lease,sessionId:'other'});
    assert.equal(stale.ok,false);
    const renewed=await store.compareAndSet('account',key,1,{...lease,heartbeatAt:200,leaseUntil:1200});
    assert.equal(renewed.ok,true); assert.equal(renewed.record.version,2);
    assert.equal((await store.listBySession(`s-${stamp}`)).length,1);
    assert.equal((await store.compareAndSet('account',key,2,null)).ok,true);
  });

  await t.test('operation receipt makes loot/economy-style persistence idempotent', async () => {
    const receipts = new PgOperationReceiptRepository(pool);
    const id=`loot-${stamp}`;
    const before=BigInt((await pool.query(`SELECT gold FROM oldko.character_stats WHERE character_id=$1`,[fixture.characterIds[2]])).rows[0].gold);
    const once=await receipts.runOnce({operationId:id,kind:'loot.pickup',characterId:fixture.characterIds[2]}, tx => tx.query(`UPDATE oldko.character_stats SET gold=gold+1 WHERE character_id=$1`,[fixture.characterIds[2]]));
    const twice=await receipts.runOnce({operationId:id,kind:'loot.pickup',characterId:fixture.characterIds[2]}, tx => tx.query(`UPDATE oldko.character_stats SET gold=gold+1 WHERE character_id=$1`,[fixture.characterIds[2]]));
    assert.equal(once.duplicate,false); assert.equal(twice.duplicate,true);
    const after=BigInt((await pool.query(`SELECT gold FROM oldko.character_stats WHERE character_id=$1`,[fixture.characterIds[2]])).rows[0].gold);
    assert.equal(after,before+1n);
  });

  await t.test('transaction failure injection rolls back', async () => {
    const id=fixture.characterIds[2];
    const before=(await pool.query(`SELECT gold FROM oldko.character_stats WHERE character_id=$1`,[id])).rows[0].gold;
    await assert.rejects(withTransaction(pool,async tx=>{ await tx.query(`UPDATE oldko.character_stats SET gold=gold+50 WHERE character_id=$1`,[id]); throw new Error('injected failure'); }));
    const after=(await pool.query(`SELECT gold FROM oldko.character_stats WHERE character_id=$1`,[id])).rows[0].gold;
    assert.equal(after,before);
  });

  await t.test('WS46 lifecycle uses one transaction and preserves account-scoped inn', async () => {
    const repo=new PgWs46CharacterLifecycleRepository(pool);
    const id=secondary.characterIds[0];
    const owned=await repo.findOwnedCharacter({accountId:secondary.accountId,characterId:id,slotIndex:0});
    assert.equal(owned.characterId,String(id));
    await repo.runDeleteTransaction({accountId:secondary.accountId,characterId:id,slotIndex:0},async uow=>{
      await uow.lockOwnedCharacter(); await uow.setLifecycleState('deleting'); await uow.releaseCharacterName(); await uow.deleteCharacter();
      await uow.appendAuditEvent({action:'character.lifecycle.test',actorAccountId:secondary.accountId});
    });
    assert.equal(await repo.findOwnedCharacter({accountId:secondary.accountId,characterId:id,slotIndex:0}),null);
  });

  await t.test('audit is append-only', async () => {
    const { rows }=await pool.query(`INSERT INTO oldko.audit_log(action,target_type,target_id) VALUES('test.append','test',$1) RETURNING id`,[stamp]);
    await assert.rejects(pool.query(`UPDATE oldko.audit_log SET action='mutated' WHERE id=$1`,[rows[0].id]));
  });

  await t.test('connection interruption fails the interrupted work but pool recovers', async () => {
    const victim=await pool.connect();
    try {
      const pid=(await victim.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
      assert.equal((await pool.query(`SELECT pg_terminate_backend($1) AS killed`,[pid])).rows[0].killed,true);
      await assert.rejects(victim.query(`SELECT 1`));
    } finally { victim.release(true); }
    assert.equal((await pool.query(`SELECT 1 AS ok`)).rows[0].ok,1);
  });
});

async function createFixture(username,names) {
  const passwordHash=await hashPassword(password);
  return withTransaction(pool,async db=>{
    const account=(await db.query(`INSERT INTO oldko.accounts(username,username_key,password_hash,status,nation) VALUES($1::varchar(32),lower($1::varchar(32)),$2,'active',1) RETURNING id`,[username,passwordHash])).rows[0];
    const ids=[];
    for(let slot=0;slot<names.length;slot++){
      const c=(await db.query(`INSERT INTO oldko.characters(account_id,slot,name,name_key,nation,race,class_id,zone_id,pos_x,pos_y,pos_z,world_state) VALUES($1,$2,$3::varchar(20),lower($3::varchar(20)),1,1,101,21,312,0,402,'{}'::jsonb) RETURNING id`,[account.id,slot,names[slot]])).rows[0];
      await db.query(`INSERT INTO oldko.character_stats(character_id) VALUES($1)`,[c.id]); ids.push(c.id);
    }
    return {username,accountId:account.id,characterIds:ids,names};
  });
}

test.after(async()=>{ await pool.end(); });
