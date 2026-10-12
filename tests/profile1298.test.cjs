const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../profile1298.js'),'utf8');
function runtime(values=new Map(),blocked=false){
 const ctx={console,window:{}};
 if(blocked)Object.defineProperty(ctx.window,'localStorage',{get(){throw Error('Storage disabled')}});
 else ctx.window.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 vm.runInNewContext(source,ctx);return ctx.window.OldERAProfiles;
}
const character=name=>({name,race:'btn_race_ka_at',job:'btn_class_warrior',face:0,hair:0,stats:[75,65,60,50,50]});
test('new account stays empty until nation and characters are selected',()=>{
 const api=runtime();const p=api.login('osevinc1','osevinc1');assert.equal(p.nation,0);assert(p.characters.every(x=>x===null));
 assert.equal(api.login('osevinc1','wrong'),null);assert.equal(api.login('unknown','unknown'),null);
});
test('all three slots survive reload, including the name Osevinc',()=>{
 const values=new Map(),api=runtime(values);const p=api.read('osevinc1');p.nation=1;p.characters=[character('Osevinc'),character('Second'),character('Third')];p.selectedIndex=2;api.save('osevinc1',p);
 const restored=runtime(values).read('osevinc1');assert.equal(restored.nation,1);assert.equal(restored.selectedIndex,2);assert.equal(restored.characters.map(c=>c.name).join(','),'Osevinc,Second,Third');
 restored.characters[1]=null;runtime(values).save('osevinc1',restored);
 const after=runtime(values).read('osevinc1');assert.equal(after.characters[1],null);assert.equal(after.characters[0].name,'Osevinc');assert.equal(after.characters[2].name,'Third');
});
test('accounts are isolated and deleting the seeded character does not restore it',()=>{
 const values=new Map(),api=runtime(values);let p=api.read('osevinc');p.characters[0]=null;api.save('osevinc',p);
 assert.equal(runtime(values).read('osevinc').characters[0],null);assert.equal(api.read('osevinc1').nation,0);
});
test('migrates the last profile format without losing its character',()=>{
 const values=new Map([['oldera1298.nation.osevinc1','1'],['oldera1298.character.osevinc1',JSON.stringify(character('Existing'))]]);
 const p=runtime(values).read('osevinc1');assert.equal(p.nation,1);assert.equal(p.characters[0].name,'Existing');
});
test('blocked persistent storage still permits a complete current-session profile',()=>{
 const api=runtime(new Map(),true),p=api.read('osevinc1');p.nation=2;p.characters[2]=character('Session');api.save('osevinc1',p);assert.equal(api.read('osevinc1').characters[2].name,'Session');
});
