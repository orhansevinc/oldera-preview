'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EQUIPMENT_SLOTS, LEGACY_ATTACH_POINTS, HAND_POLICY, CONTAINER_TYPES,
  ItemTemplateRegistry, Legacy1298TableAdapter, resolveLegacyAttachPoint, deriveCategory,
  InMemoryItemRepository, ItemDomainService, ItemDomainError, emptyState,
  validateInventoryState, findOrphanedItems, createEconomyItemPort, createLootItemPort,
} = require('../../services/ko1298-items');

const inv = slot => ({ container: CONTAINER_TYPES.INVENTORY, slot });
const eq = slot => ({ container: CONTAINER_TYPES.EQUIPMENT, slot });
const inn = slot => ({ container: CONTAINER_TYPES.INN, slot });
async function expectCode(p, code) { await assert.rejects(p, e => e instanceof ItemDomainError && e.code === code); }

function fixture({ character = null, serialStart = 100000n, beforeCommit = null } = {}) {
  const rows = new Map([
    [1001,{id:1001,name:'Sword',stackable:false,maxDurability:100,weight:15,allowedEquipmentSlots:[6],handPolicy:HAND_POLICY.RIGHT,category:'weapon',weapon:{kind:21,damage:30,delay:100,range:12},modifiers:{str:2}}],
    [1002,{id:1002,name:'Shield',stackable:false,maxDurability:80,weight:20,allowedEquipmentSlots:[8],handPolicy:HAND_POLICY.LEFT,category:'shield',armor:{ac:40},modifiers:{ac:40,sta:3}}],
    [1003,{id:1003,name:'2H Sword',stackable:false,maxDurability:120,weight:30,allowedEquipmentSlots:[6],handPolicy:HAND_POLICY.TWO_HAND_RIGHT,category:'weapon',weapon:{kind:22,damage:70}}],
    [1004,{id:1004,name:'Bow',stackable:false,maxDurability:90,weight:25,allowedEquipmentSlots:[8],handPolicy:HAND_POLICY.TWO_HAND_LEFT,category:'weapon',weapon:{kind:80,damage:50}}],
    [2001,{id:2001,name:'Potion',stackable:true,maxStack:10,weight:2,allowedEquipmentSlots:[],category:'consumable'}],
    [2002,{id:2002,name:'Arrow',stackable:true,maxStack:9999,weight:1,allowedEquipmentSlots:[],category:'ammunition'}],
    [3001,{id:3001,name:'Req Sword',stackable:false,maxDurability:100,weight:10,allowedEquipmentSlots:[6],handPolicy:HAND_POLICY.RIGHT,requirements:{minLevel:10,classIds:[101],raceIds:[1],nationIds:[1],stats:{str:70,sta:60,dex:0,int:0,cha:0}},modifiers:{hp:50,resistances:{fire:5},weaponArmor:{sword:10}},weapon:{kind:21,damage:40}}],
  ]);
  const templates = new ItemTemplateRegistry({ get: async id => rows.get(Number(id)) });
  const repository = new InMemoryItemRepository({ beforeCommit });
  let serial = serialStart;
  const service = new ItemDomainService({ repository, templates, characterContext: character ? async () => character : null, serialGenerator: () => String(serial++) });
  return { rows, templates, repository, service };
}

const attachCases = [
  [0,[6,8]],[1,[6]],[2,[8]],[3,[6]],[4,[8]],[5,[4]],[6,[10]],[7,[1]],
  [8,[12]],[9,[13]],[10,[0,2]],[11,[3]],[12,[9,11]],[13,[5]],[14,[7]],[15,[]],
];
for (const [attach, slots] of attachCases) test(`verified attach ${attach}`, () => assert.deepEqual(resolveLegacyAttachPoint(attach), slots));
for (const [id, category] of [[11,'weapon'],[22,'weapon'],[60,'shield'],[91,'jewelry'],[210,'armor'],[97,'consumable'],[120,'ammunition'],[251,'misc'],[999,'unknown']]) test(`verified class ${id}`, () => assert.equal(deriveCategory(id), category));

test('real 1298 adapter provenance + fields', async () => {
  const registry = new ItemTemplateRegistry(new Legacy1298TableAdapter({ getRow: async () => ({ Num:111210000,strName:'Shard',Countable:0,Duration:14000,Weight:30,byAttachPoint:0,byClass:11,ReqLevel:55,ReqDex:160 }) }), { requireVerifiedProvenance:true });
  const t=await registry.get(111210000); assert.equal(t.verified,true); assert.equal(t.maxDurability,14000); assert.equal(t.weight,30); assert.deepEqual(t.allowedEquipmentSlots,[6,8]); assert.equal(t.requirements.stats.dex,160);
});
test('provenance id mismatch fails', async () => { const r=new ItemTemplateRegistry({get:async()=>({id:2,source:[{ref:'x',patch:'1298'}]})},{requireVerifiedProvenance:true}); await expectCode(r.get(1),'ITEM_ID_PROVENANCE_MISMATCH'); });
test('unverified production row fails closed', async () => { const r=new ItemTemplateRegistry({get:async id=>({id})},{requireVerifiedProvenance:true}); await expectCode(r.get(1),'UNVERIFIED_ITEM_TEMPLATE'); });

const good={level:20,classId:101,raceId:1,nationId:1,stats:{str:70,sta:60},maxWeight:1000};
for (const [name,character,code] of [
  ['level',{...good,level:9},'LEVEL_REQUIREMENT_NOT_MET'],
  ['class',{...good,classId:102},'CLASS_REQUIREMENT_NOT_MET'],
  ['race',{...good,raceId:2},'RACE_REQUIREMENT_NOT_MET'],
  ['nation',{...good,nationId:2},'NATION_REQUIREMENT_NOT_MET'],
  ['stat',{...good,stats:{str:69,sta:60}},'STAT_REQUIREMENT_NOT_MET'],
]) test(`${name} requirement blocks equip`, async()=>{const {service}=fixture({character});await service.createItem('c',inv(0),{templateId:3001,serial:'1'});await expectCode(service.equip('c',0,6),code);});
test('all requirements pass',async()=>{const {service,repository}=fixture({character:good});await service.createItem('c',inv(0),{templateId:3001,serial:'2'});await service.equip('c',0,6);assert.equal((await repository.read('c')).equipment[6].serial,'2');});
test('requirements need authoritative context',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:3001,serial:'3'});await expectCode(service.equip('c',0,6),'CHARACTER_CONTEXT_REQUIRED');});

test('two-hand right conflicts with left',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:1002,serial:'10'});await service.equip('c',0,8);await service.createItem('c',inv(1),{templateId:1003,serial:'11'});await expectCode(service.equip('c',1,6),'TWO_HAND_CONFLICT');});
test('two-hand left conflicts with right',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:1001,serial:'12'});await service.equip('c',0,6);await service.createItem('c',inv(1),{templateId:1004,serial:'13'});await expectCode(service.equip('c',1,8),'TWO_HAND_CONFLICT');});
test('one-hand cannot equip against two-hand',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:1003,serial:'14'});await service.equip('c',0,6);await service.createItem('c',inv(1),{templateId:1002,serial:'15'});await expectCode(service.equip('c',1,8),'TWO_HAND_CONFLICT');});

for (const [name,input,delta,expectedDurability,broken] of [
  ['default',{},0,100,false],['break',{},-1000,0,true],['repair',{durability:0},50,50,false],['clamp',{durability:90},50,100,false],
]) test(`durability ${name}`,async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:1001,serial:'20',...input});const item=delta===0?(await service.saveSnapshot('c')).inventory[0]:await service.applyDurability('c',inv(0),delta);assert.equal(item.durability,expectedDurability);assert.equal(item.broken,broken);});
test('durability above max rejected',async()=>{const {service}=fixture();await expectCode(service.createItem('c',inv(0),{templateId:1001,serial:'21',durability:101}),'DURABILITY_EXCEEDS_MAX');});

test('equipment snapshot aggregates healthy modifiers',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:3001,serial:'30'});const s=await service.saveSnapshot('c');s.equipment[6]=s.inventory[0];s.inventory[0]=null;await service.loadSnapshot('c',s);const x=await service.getEquipmentModifierSnapshot('c');assert.equal(x.totals.hp,50);assert.equal(x.totals.resistances.fire,5);});
test('broken item contributes no modifier',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:1001,serial:'31',durability:0});await service.equip('c',0,6);assert.equal((await service.getEquipmentModifierSnapshot('c')).totals.str,0);});
test('combat snapshot exposes weapon without formula',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:1001,serial:'32'});await service.equip('c',0,6);const x=await service.getCombatItemSnapshot('c');assert.equal(x.rightHand.kind,21);assert.equal(x.rightHand.damage,30);});
test('broken combat weapon projects zero damage',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:1001,serial:'33',durability:0});await service.equip('c',0,6);assert.equal((await service.getCombatItemSnapshot('c')).rightHand.damage,0);});

test('stack weight multiplies quantity',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:2001,serial:'40',quantity:5});assert.equal(await service.getCarriedWeight('c'),10);});
test('inn excluded from carried weight',async()=>{const {service}=fixture();await service.createItem('c',inn(0),{templateId:1001,serial:'41'});assert.equal(await service.getCarriedWeight('c'),0);});
test('max weight rejects create atomically',async()=>{const {service,repository}=fixture({character:{...good,maxWeight:9}});await expectCode(service.createItem('c',inv(0),{templateId:2001,serial:'42',quantity:5}),'MAX_WEIGHT_EXCEEDED');assert.equal((await repository.read('c')).inventory[0],null);});
test('pickup reports max weight',async()=>{const {service}=fixture({character:{...good,maxWeight:3}});assert.deepEqual(await service.canPickup('c',{templateId:2001,quantity:2}),{ok:false,reason:'MAX_WEIGHT_EXCEEDED'});});
test('inn return enforces max weight',async()=>{const {service,repository}=fixture({character:{...good,maxWeight:10}});await service.createItem('c',inn(0),{templateId:1001,serial:'43'});await expectCode(service.moveFromInn('c',0,inv(0)),'MAX_WEIGHT_EXCEEDED');assert.equal((await repository.read('c')).inn[0].serial,'43');});
test('carried rearrange allowed on pre-existing overweight snapshot',async()=>{const {service,repository}=fixture({character:{...good,maxWeight:10}});const s=emptyState('c');s.inventory[0]={templateId:1001,serial:'44',quantity:1,durability:100,broken:false};await repository.importSnapshot('c',s);await service.move('c',inv(0),inv(1));assert.equal((await repository.read('c')).inventory[1].serial,'44');});

test('merge caps target and leaves remainder',async()=>{const {service,repository}=fixture();await service.createItem('c',inv(0),{templateId:2001,serial:'50',quantity:8});await service.createItem('c',inv(1),{templateId:2001,serial:'51',quantity:8});await service.move('c',inv(0),inv(1),{quantity:8});const s=await repository.read('c');assert.equal(s.inventory[1].quantity,10);assert.equal(s.inventory[0].quantity,6);});
test('full target stack rejects merge',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:2001,serial:'52',quantity:1});await service.createItem('c',inv(1),{templateId:2001,serial:'53',quantity:10});await expectCode(service.move('c',inv(0),inv(1)),'STACK_FULL');});
test('partial occupied swap rejected',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:2001,serial:'54',quantity:5});await service.createItem('c',inv(1),{templateId:1001,serial:'55'});await expectCode(service.move('c',inv(0),inv(1),{quantity:2}),'PARTIAL_SWAP_NOT_ALLOWED');});
test('split creates fresh generated serial',async()=>{const {service,repository}=fixture({serialStart:700n});await service.createItem('c',inv(0),{templateId:2001,serial:'56',quantity:5});await service.move('c',inv(0),inv(2),{quantity:2});assert.notEqual((await repository.read('c')).inventory[2].serial,'56');});

test('merchant insert journals commit',async()=>{const {service,repository}=fixture();await service.insertFromMerchant('c',{templateId:2001,quantity:2,idempotencyKey:'buy1',sourceNpcId:10});assert.ok((await repository.getJournal()).some(x=>x.type==='MERCHANT_BUY_INSERT'));});
test('merchant insert idempotent',async()=>{const {service,repository}=fixture();await service.insertFromMerchant('c',{templateId:2001,quantity:2,idempotencyKey:'buy2'});await service.insertFromMerchant('c',{templateId:2001,quantity:2,idempotencyKey:'buy2'});assert.equal((await repository.read('c')).inventory.reduce((n,x)=>n+(x?.quantity||0),0),2);});
test('merchant removal idempotent',async()=>{const {service,repository}=fixture();await service.createItem('c',inv(0),{templateId:1001,serial:'60'});await service.removeForMerchant('c',{itemSerial:'60',idempotencyKey:'sell1'});await service.removeForMerchant('c',{itemSerial:'60',idempotencyKey:'sell1'});assert.equal((await repository.read('c')).inventory[0],null);});
test('equipped item cannot sell directly',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:1001,serial:'61'});await service.equip('c',0,6);await expectCode(service.removeForMerchant('c',{itemSerial:'61'}),'EQUIPPED_ITEM_MUTATION_REQUIRES_UNEQUIP');});
test('loot insertion idempotent and stack-aware',async()=>{const {service,repository}=fixture();await service.insertFromLoot('c',{templateId:2001,quantity:12,idempotencyKey:'death1'});await service.insertFromLoot('c',{templateId:2001,quantity:12,idempotencyKey:'death1'});assert.equal((await repository.read('c')).inventory.reduce((n,x)=>n+(x?.quantity||0),0),12);});

test('DB 23505 maps and rolls back',async()=>{let once=true;const {service,repository}=fixture({beforeCommit:()=>{if(once){once=false;const e=new Error('unique');e.code='23505';throw e;}}});await expectCode(service.createItem('c',inv(0),{templateId:1001,serial:'70'}),'PERSISTENCE_UNIQUENESS_VIOLATION');assert.equal((await repository.read('c')).inventory[0],null);});
test('disconnect abort rolls back',async()=>{const ac=new AbortController();const {service,repository}=fixture({beforeCommit:()=>ac.abort()});await expectCode(service.createItem('c',inv(0),{templateId:1001,serial:'71'},{signal:ac.signal}),'OPERATION_ABORTED');assert.equal((await repository.read('c')).inventory[0],null);});
test('snapshot save/load roundtrip',async()=>{const {service,repository}=fixture();await service.createItem('c',inv(0),{templateId:1001,serial:'72'});const s=await service.saveSnapshot('c');await service.move('c',inv(0),inv(2));await service.loadSnapshot('c',s);assert.equal((await repository.read('c')).inventory[0].serial,'72');});
test('corrupt snapshot rejected',async()=>{const {service}=fixture();const s=emptyState('c');s.inventory[0]={templateId:999,serial:'73',quantity:1,durability:null};await expectCode(service.loadSnapshot('c',s),'CORRUPT_INVENTORY_SNAPSHOT');});
test('validator finds duplicate serial',async()=>{const {templates}=fixture();const s=emptyState('c');const x={templateId:1001,serial:'74',quantity:1,durability:100};s.inventory[0]=x;s.inventory[1]=x;assert.ok((await validateInventoryState(s,templates)).some(i=>i.code==='DUPLICATE_SERIAL'));});
test('orphan utility finds unknown template',async()=>{const {templates}=fixture();const s=emptyState('c');s.inventory[0]={templateId:999,serial:'75',quantity:1,durability:null};assert.equal((await findOrphanedItems(s,templates)).length,1);});

test('inn transfer preserves serial + quantity',async()=>{const {service,repository}=fixture();await service.createItem('c',inv(0),{templateId:2001,serial:'80',quantity:4});await service.moveToInn('c',inv(0),3);await service.moveFromInn('c',3,inv(5));const s=await repository.read('c');assert.equal(s.inventory[5].serial,'80');assert.equal(s.inventory[5].quantity,4);});
test('trade escrow atomic transfer',async()=>{const {service,repository}=fixture();await service.createItem('a',inv(0),{templateId:1001,serial:'81'});await service.transferTradeEscrow({fromOwnerId:'a',toOwnerId:'b',itemSerial:'81'});assert.equal((await repository.read('a')).inventory[0],null);assert.equal((await repository.read('b')).inventory[0].serial,'81');});
test('trade rollback target occupied',async()=>{const {service,repository}=fixture();await service.createItem('a',inv(0),{templateId:1001,serial:'82'});await service.createItem('b',inv(0),{templateId:1002,serial:'83'});await expectCode(service.transferTradeEscrow({fromOwnerId:'a',toOwnerId:'b',itemSerial:'82',toSlot:0}),'SLOT_OCCUPIED');assert.equal((await repository.read('a')).inventory[0].serial,'82');});
test('partial trade fresh serial conserves quantity',async()=>{const {service,repository}=fixture({serialStart:900n});await service.createItem('a',inv(0),{templateId:2001,serial:'84',quantity:7});await service.transferTradeEscrow({fromOwnerId:'a',toOwnerId:'b',itemSerial:'84',quantity:3});const a=await repository.read('a'),b=await repository.read('b');assert.equal(a.inventory[0].quantity+b.inventory[0].quantity,7);assert.notEqual(b.inventory[0].serial,'84');});
test('trade idempotency prevents duplicate transfer',async()=>{const {service,repository}=fixture();await service.createItem('a',inv(0),{templateId:1001,serial:'85'});await service.transferTradeEscrow({fromOwnerId:'a',toOwnerId:'b',itemSerial:'85',idempotencyKey:'t85'});await service.transferTradeEscrow({fromOwnerId:'a',toOwnerId:'b',itemSerial:'85',idempotencyKey:'t85'});assert.equal((await repository.read('b')).inventory.filter(x=>x?.serial==='85').length,1);});
test('trade preflight accounts outgoing slot',async()=>{const {service}=fixture();for(let i=0;i<28;i++)await service.createItem('c',inv(i),{templateId:1001,serial:String(5000+i)});assert.deepEqual(await service.canReceiveBatch('c',{outgoing:[{itemSerial:'5000'}],incoming:[{templateId:1002,quantity:1}]}),{ok:true});});

test('concurrent sell one winner',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:1001,serial:'90'});const r=await Promise.allSettled([service.removeForMerchant('c',{itemSerial:'90'}),service.removeForMerchant('c',{itemSerial:'90'})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);});
test('concurrent equip/move one winner',async()=>{const {service}=fixture();await service.createItem('c',inv(0),{templateId:1001,serial:'91'});const r=await Promise.allSettled([service.equip('c',0,6),service.move('c',inv(0),inv(1))]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);});
test('concurrent duplicate serial globally one winner',async()=>{const {service,repository}=fixture();const r=await Promise.allSettled([service.createItem('a',inv(0),{templateId:1001,serial:'92'}),service.createItem('b',inv(0),{templateId:1001,serial:'92'})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.deepEqual(await repository.scanForDuplicateSerials(),[]);});

test('economy outer tx does not independently commit',async()=>{const {service,repository}=fixture();const port=createEconomyItemPort({service});const tx=new Map([['c',await repository.read('c')]]);await port.addNpcPurchase({playerId:'c',itemTemplateId:2001,quantity:2,sourceNpcId:1,tx});assert.equal(tx.get('c').inventory[0].quantity,2);assert.equal((await repository.read('c')).inventory[0],null);});
test('economy write requires external tx',async()=>{const {service}=fixture();await expectCode(createEconomyItemPort({service}).addNpcPurchase({playerId:'c',itemTemplateId:2001,quantity:1}),'EXTERNAL_TRANSACTION_REQUIRED');});
test('economy transfer mutates both supplied drafts only',async()=>{const {service,repository}=fixture();await service.createItem('a',inv(0),{templateId:1001,serial:'93'});const tx=new Map([['a',await repository.read('a')],['b',await repository.read('b')]]);await createEconomyItemPort({service}).transferItem({fromPlayerId:'a',toPlayerId:'b',itemSerial:'93',tx});assert.equal(tx.get('a').inventory[0],null);assert.equal(tx.get('b').inventory[0].serial,'93');assert.equal((await repository.read('b')).inventory[0],null);});
test('loot port preflight and tx grant',async()=>{const {service,repository}=fixture();const port=createLootItemPort({service});assert.deepEqual(await port.inventory.canAccept({characterId:'c',itemId:2001,quantity:3}),{ok:true});const tx=new Map([['c',await repository.read('c')]]);await port.items.grant({characterId:'c',itemId:2001,quantity:1,serial:'94',tx});assert.equal(tx.get('c').inventory[0].serial,'94');});
test('loot grant without tx fails',async()=>{const {service}=fixture();await expectCode(createLootItemPort({service}).items.grant({characterId:'c',itemId:2001,quantity:1,serial:'95'}),'EXTERNAL_TRANSACTION_REQUIRED');});
test('authoritative serial count reflects global index',async()=>{const {service}=fixture();assert.equal(await service.countSerial('96'),0);await service.createItem('c',inv(0),{templateId:1001,serial:'96'});assert.equal(await service.countSerial('96'),1);});
