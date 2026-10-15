'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTAINER_TYPES, ItemTemplateRegistry, InMemoryItemRepository, ItemDomainService, validateInventoryState } = require('../../services/ko1298-items');
const inv = slot => ({container:CONTAINER_TYPES.INVENTORY,slot});
const inn = slot => ({container:CONTAINER_TYPES.INN,slot});

function rng(seed) { let x=seed>>>0; return () => { x ^= x<<13; x ^= x>>>17; x ^= x<<5; return (x>>>0)/0x100000000; }; }
function totals(state) { const out=new Map(); for (const type of ['inventory','equipment','inn']) for (const item of state[type]) if(item) out.set(item.templateId,(out.get(item.templateId)||0)+item.quantity); return out; }

test('deterministic 6000-operation move/swap/merge/split/inn soak preserves invariants', async () => {
  const rows=new Map([
    [1,{id:1,name:'stack-a',stackable:true,maxStack:50,weight:1,allowedEquipmentSlots:[]}],
    [2,{id:2,name:'stack-b',stackable:true,maxStack:17,weight:2,allowedEquipmentSlots:[]}],
    [3,{id:3,name:'single',stackable:false,weight:3,allowedEquipmentSlots:[]}],
  ]);
  const templates=new ItemTemplateRegistry({get:async id=>rows.get(Number(id))});
  const repository=new InMemoryItemRepository();
  let serial=10000n;
  const service=new ItemDomainService({repository,templates,serialGenerator:()=>String(serial++)});
  const owner='soak';
  for(let i=0;i<10;i++) await service.createItem(owner,inv(i),{templateId:1,serial:String(serial++),quantity:20+i});
  for(let i=10;i<18;i++) await service.createItem(owner,inv(i),{templateId:2,serial:String(serial++),quantity:5+(i%5)});
  for(let i=18;i<24;i++) await service.createItem(owner,inv(i),{templateId:3,serial:String(serial++)});
  const initial=totals(await repository.read(owner));
  const random=rng(0x1298cafe);
  for(let step=0;step<6000;step++) {
    const state=await repository.read(owner);
    const useInn=random()<0.22;
    const fromType=useInn && random()<0.5?'inn':'inventory';
    const toType=useInn && fromType==='inventory'?'inn':'inventory';
    const fromMax=fromType==='inn'?196:28, toMax=toType==='inn'?196:28;
    const fromSlot=Math.floor(random()*fromMax), toSlot=Math.floor(random()*toMax);
    const source=state[fromType][fromSlot];
    if(!source) continue;
    const target=state[toType][toSlot];
    const from={container:fromType,slot:fromSlot}, to={container:toType,slot:toSlot};
    let quantity=source.quantity;
    if(source.quantity>1 && !target && random()<0.55) quantity=1+Math.floor(random()*(source.quantity-1));
    if(target && target.templateId===source.templateId && random()<0.7) quantity=1+Math.floor(random()*source.quantity);
    try { await service.move(owner,from,to,{quantity}); } catch (e) {
      assert.ok(['STACK_FULL','PARTIAL_SWAP_NOT_ALLOWED','INVALID_QUANTITY'].includes(e.code), `unexpected fuzz error ${e.code}`);
    }
  }
  const final=await repository.read(owner);
  assert.deepEqual(totals(final),initial,'item quantity must be conserved by template');
  const issues=await validateInventoryState(final,templates);
  assert.deepEqual(issues,[],'final state must pass corruption validator');
  const serials=[]; for(const type of ['inventory','equipment','inn']) for(const item of final[type]) if(item) serials.push(item.serial);
  assert.equal(new Set(serials).size,serials.length,'serial uniqueness invariant');
  assert.deepEqual(await repository.scanForDuplicateSerials(),[],'global serial uniqueness invariant');
});

test('deterministic concurrent move/equip-style race soak never duplicates one source serial', async () => {
  const rows=new Map([[1,{id:1,name:'single',stackable:false,weight:1,allowedEquipmentSlots:[]}]]);
  const templates=new ItemTemplateRegistry({get:async id=>rows.get(Number(id))});
  const repository=new InMemoryItemRepository();
  const service=new ItemDomainService({repository,templates});
  for(let round=0;round<200;round++) {
    const owner=`race-${round}`; const serial=String(900000+round);
    await service.createItem(owner,inv(0),{templateId:1,serial});
    const a=1+(round%13), b=14+(round%13);
    await Promise.allSettled([service.move(owner,inv(0),inv(a)),service.move(owner,inv(0),inv(b))]);
    const state=await repository.read(owner); const copies=state.inventory.filter(x=>x?.serial===serial);
    assert.equal(copies.length,1);
  }
  assert.deepEqual(await repository.scanForDuplicateSerials(),[]);
});
