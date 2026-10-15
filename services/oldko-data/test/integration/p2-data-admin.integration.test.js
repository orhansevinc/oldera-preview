import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPool, hashPassword, ValidationError } from '../../src/index.js';
import { PgP2DataAdminRepository } from '../../src/adapters/p2-data-admin.js';

const pool = createPool({ applicationName: 'p2-11-integration-tests', max: 4 });
const repo = new PgP2DataAdminRepository(pool);
const stamp = `${Date.now()}${process.pid}`.slice(-12);

await test('P2-11 canonical persistence and runtime-proof contracts', async (t) => {
  const fixture = await createFixture();

  await t.test('canonical schema is exactly at 0005 and WS13 rate limit table is present', async () => {
    assert.equal((await repo.getSchemaVersion()).name, '0005_phase2_data_admin.sql');
    assert.equal((await pool.query(`SELECT to_regclass('oldko.account_rate_limits') AS t`)).rows[0].t, 'oldko.account_rate_limits');
  });

  await t.test('quest, position, progression, item and clan evidence share one PostgreSQL character identity', async () => {
    const q1 = await repo.saveQuestState({ characterId:fixture.characterId,questKey:'p2.quest.fixture',state:{step:1},expectedVersion:0 });
    const q2 = await repo.saveQuestState({ characterId:fixture.characterId,questKey:'p2.quest.fixture',state:{step:2},expectedVersion:Number(q1.version) });
    assert.equal(Number(q2.version),2);
    await assert.rejects(repo.saveQuestState({ characterId:fixture.characterId,questKey:'p2.quest.fixture',state:{step:3},expectedVersion:1 }));
    const snapshot = await repo.persistenceSnapshot(fixture.characterId);
    assert.equal(String(snapshot.id),String(fixture.characterId));
    assert.equal(snapshot.zone_id,21); assert.equal(snapshot.quest_count,1); assert.equal(snapshot.inventory_count,1); assert.equal(String(snapshot.clan_id),String(fixture.clanId));
  });

  await t.test('boss state is durable and optimistic-versioned without owning spawn rules', async () => {
    const first = await repo.saveBossState({ authority:'p2-06-mobs',bossKey:'fixture-boss',zoneId:21,state:{alive:false},expectedVersion:0 });
    const second = await repo.saveBossState({ authority:'p2-06-mobs',bossKey:'fixture-boss',zoneId:21,state:{alive:true},expectedVersion:Number(first.version) });
    assert.equal(Number(second.version),2);
  });

  await t.test('runtime config requires a real admin actor and records apply acknowledgement separately', async () => {
    const config = await repo.setRuntimeConfig({ key:`world.fixture.${stamp}`,value:{enabled:true},actorAdminId:fixture.adminId,expectedVersion:0 });
    assert.equal(Number(config.version),1);
    const receipt = await repo.recordRuntimeConfigApply({ key:config.key,version:1,service:'fixture-runtime',applied:true,evidence:{revision:'fixture'} });
    assert.equal(receipt.applied,true);
    await assert.rejects(repo.setRuntimeConfig({ key:`world.bad.${stamp}`,value:{enabled:true},actorAdminId:'missing-admin',expectedVersion:0 }));
    await assert.rejects(repo.setRuntimeConfig({ key:'smtp_password',value:'not-allowed',actorAdminId:fixture.adminId,expectedVersion:0 }), e => e instanceof ValidationError);
  });

  await t.test('status is derived only from fresh heartbeat and stale count is suppressed', async () => {
    await repo.recordServerHeartbeat({ source:'fixture-runtime',realmId:`realm-${stamp}`,availability:'online',playerCount:3,lastHeartbeat:new Date() });
    const live = await repo.getServerStatus({ realmId:`realm-${stamp}`,maxAgeMs:60000 });
    assert.equal(live.online,true); assert.equal(live.onlinePlayerCount,3);
    const stale = await repo.getServerStatus({ realmId:`realm-${stamp}`,maxAgeMs:1,now:Date.now()+10000 });
    assert.equal(stale.online,false); assert.equal('onlinePlayerCount' in stale,false);
  });

  await t.test('admin runtime confirmation rejects DB-only success and accepts applied authority proof', async () => {
    const commandId = randomUUID();
    await pool.query(
      `INSERT INTO oldko.admin_command_outbox(id,command,target,requested_by,requested_by_admin_id,trace_id,source)
       VALUES($1,'fixture.command','target',$2,$2,$3,'p2-11-test')`,
      [commandId,fixture.adminId,`trace-${stamp}`],
    );
    await assert.rejects(repo.confirmAdminCommand({ commandId,source:'fixture-runtime',result:{status:'ok',forwarded:true} }), e => e instanceof ValidationError);
    const proof = await repo.confirmAdminCommand({ commandId,source:'fixture-runtime',result:{status:'ok',forwarded:true,applied:true,data:{verified:true}} });
    assert.equal(proof.applied,true);
    assert.equal((await pool.query(`SELECT status FROM oldko.admin_command_outbox WHERE id=$1`,[commandId])).rows[0].status,'succeeded');
  });

  await t.test('new pool connection sees committed state, proving no process-memory persistence authority', async () => {
    const reconnect = createPool({ applicationName:'p2-11-reconnect-proof', max:1 });
    try {
      const row = await reconnect.query(`SELECT state,version FROM oldko.character_quests WHERE character_id=$1 AND quest_key='p2.quest.fixture'`,[fixture.characterId]);
      assert.equal(row.rows[0].state.step,2); assert.equal(Number(row.rows[0].version),2);
    } finally { await reconnect.end(); }
  });
});

async function createFixture() {
  const passwordHash = await hashPassword(`p2-${stamp}-password`);
  const username = `p2${stamp}`.slice(0,32);
  const adminId = `p2-admin-${stamp}`;
  const account = (await pool.query(`INSERT INTO oldko.accounts(username,username_key,password_hash,status,nation) VALUES($1,lower($1),$2,'active',1) RETURNING id`,[username,passwordHash])).rows[0];
  const character = (await pool.query(`INSERT INTO oldko.characters(account_id,slot,name,name_key,nation,race,class_id,zone_id,pos_x,pos_y,pos_z,world_state) VALUES($1,0,$2,lower($2),1,1,101,21,312,0,402,'{}') RETURNING id`,[account.id,`P${stamp}`.slice(0,20)])).rows[0];
  await pool.query(`INSERT INTO oldko.character_stats(character_id,level,exp) VALUES($1,2,10)`,[character.id]);
  const item = (await pool.query(`INSERT INTO oldko.item_instances(serial,item_template_id) VALUES($1,1001) RETURNING id`,[(700000000000000000n-BigInt(stamp)).toString()])).rows[0];
  await pool.query(`INSERT INTO oldko.inventory(character_id,slot,item_instance_id,quantity) VALUES($1,0,$2,1)`,[character.id,item.id]);
  const clan = (await pool.query(`INSERT INTO oldko.clans(name,name_key,nation,chief_character_id) VALUES($1,lower($1),1,$2) RETURNING id`,[`C${stamp}`.slice(0,24),character.id])).rows[0];
  await pool.query(`INSERT INTO oldko.clan_members(clan_id,character_id,rank) VALUES($1,$2,0)`,[clan.id,character.id]);
  await pool.query(`INSERT INTO oldko.admin_actors(id,username,username_key,password_hash,roles) VALUES($1,$2,lower($2),$3,ARRAY['owner'])`,[adminId,`Admin${stamp}`.slice(0,64),passwordHash]);
  return { accountId:account.id,characterId:character.id,clanId:clan.id,adminId };
}

test.after(async()=>{ await pool.end(); });
