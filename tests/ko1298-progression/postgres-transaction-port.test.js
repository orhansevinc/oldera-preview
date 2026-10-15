'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PersistentProgressionTransactionPort } = require('../../services/ko1298-progression/postgres-transaction-port');

test('progression transaction uses persistent operation receipt for replay protection', async () => {
  const calls=[];
  const state={characterId:'7',level:1,experience:0n,hp:100,mp:100,str:60,sta:60,dex:70,intel:50,cha:50,statPoints:0,skillPoints:0,loyalty:0,gold:0n,version:3};
  const receipts=new Set();
  const receiptRepository={ async runOnce(meta,work){ if(receipts.has(meta.operationId))return {duplicate:true}; receipts.add(meta.operationId); return {duplicate:false,value:await work({tx:true})}; } };
  const progressionRepository={
    async load(id,{tx}){calls.push(['load',id,tx]);return {...state};},
    async save(id,next,{expectedVersion,tx}){calls.push(['save',id,expectedVersion,tx]);Object.assign(state,next,{version:expectedVersion+1});return {version:state.version};},
  };
  const port=new PersistentProgressionTransactionPort({progressionRepository,receiptRepository});
  const first=await port.applyOnce({operationId:'death:12000:1',characterId:7,mutate:s=>({state:{...s,experience:10n}})});
  const second=await port.applyOnce({operationId:'death:12000:1',characterId:7,mutate:s=>({state:{...s,experience:20n}})});
  assert.equal(first.duplicate,false);
  assert.equal(second.duplicate,true);
  assert.equal(calls.filter(v=>v[0]==='save').length,1);
  assert.equal(state.experience,10n);
});
