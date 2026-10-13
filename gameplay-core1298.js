(()=>{
'use strict';

const state={
  target:null,targetIndex:-1,lastAttack:0,attackCooldown:780,
  hp:167,maxHp:167,mp:105,maxMp:105,coin:10000,exp:0,
  inventory:{hpPotion:10,mpPotion:10,starterWeapon:1},equippedWeapon:false,
  bank:{hpPotion:0,mpPotion:0,starterWeapon:0},
  actor:null,marker:null,uiReady:false
};

const isWorld=()=>document.getElementById('world')?.classList.contains('on');
const world=()=>window.OldERAWorld;
const avatar=()=>world()?.avatar;
const npcs=()=>Array.from(world()?.npcs||[]).filter(Boolean);
const meta=r=>r?.userData?.npc1298||{};
const isMonster=r=>Boolean(meta(r).monster);
const nameOf=r=>String(meta(r).name||'Unknown');
const distTo=r=>avatar()&&r?.position?avatar().position.distanceTo(r.position):Infinity;

function toast(text,kind='normal'){
  let el=document.getElementById('oldkoGameplayToast');
  if(!el){el=document.createElement('div');el.id='oldkoGameplayToast';Object.assign(el.style,{position:'fixed',left:'50%',bottom:'92px',transform:'translateX(-50%)',zIndex:'999999',padding:'8px 14px',background:'rgba(8,6,4,.9)',border:'1px solid #b69a62',color:'#f6e9c3',font:'12px Tahoma',pointerEvents:'none',boxShadow:'0 4px 18px #000'});document.body.appendChild(el)}
  el.style.borderColor=kind==='danger'?'#a94442':'#b69a62';el.textContent=text;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2200);
}

function wrapCharacterAnimation(){
  const cs=window.OldERACharScene;if(!cs?.loadCharacter||cs.__oldkoGameplayWrapped)return;
  const original=cs.loadCharacter.bind(cs);
  cs.loadCharacter=async(...args)=>{
    const ctl=await original(...args);
    if(ctl?.tick&&!ctl.update)ctl.update=ctl.tick.bind(ctl);
    if(ctl&&!ctl.playOnce)ctl.playOnce=clip=>{if(!clip)return false;ctl.clip=clip;ctl.loop=false;ctl.startTime=performance.now();ctl.playing=true;ctl.setFrame?.(clip.start);return true};
    const options=args[2]||{};
    if(options.mode==='world'){state.actor=ctl;window.OldKOPlayerActor=ctl}
    return ctl;
  };
  cs.__oldkoGameplayWrapped=true;
}
wrapCharacterAnimation();

function findClip(words){
  const a=state.actor||window.OldKOPlayerActor;if(!a?.clips?.length)return null;
  for(const w of words){const c=a.clips.find(x=>String(x.name||'').toLowerCase()===w);if(c)return c}
  for(const w of words){const c=a.clips.find(x=>String(x.name||'').toLowerCase().includes(w));if(c)return c}
  return null;
}
function playAttackAnim(){
  const a=state.actor||window.OldKOPlayerActor;if(!a)return;
  const c=findClip(['attack','normal_attack','attack01','attack1','strike','slash','sword','atk']);
  if(c)a.playOnce?.(c);
}

function removeMarker(){if(state.marker?.parent)state.marker.parent.remove(state.marker);state.marker?.geometry?.dispose?.();state.marker?.material?.dispose?.();state.marker=null}
function makeMarker(target){
  removeMarker();if(!window.THREE||!target)return;
  const g=new THREE.RingGeometry(.72,.9,36),m=new THREE.MeshBasicMaterial({color:0xffd35a,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false});
  const ring=new THREE.Mesh(g,m);ring.rotation.x=-Math.PI/2;ring.position.y=.06;ring.renderOrder=1200;target.add(ring);state.marker=ring;
}
function targetHud(){
  let e=document.getElementById('oldkoTargetHud');if(!e){e=document.createElement('div');e.id='oldkoTargetHud';Object.assign(e.style,{position:'absolute',left:'50%',top:'8px',transform:'translateX(-50%)',zIndex:'9900',width:'290px',padding:'5px 8px',background:'rgba(36,24,16,.88)',border:'1px solid #a78951',color:'#fff2bf',font:'12px Tahoma',textAlign:'center',pointerEvents:'none'});document.getElementById('worldStageInner')?.appendChild(e)}return e
}
function refreshTargetHud(){
  const e=targetHud(),t=state.target;if(!t){e.style.display='none';return}
  const c=t.userData.combat1298||{hp:100,maxHp:100};const pct=Math.max(0,Math.min(100,c.hp*100/c.maxHp));
  e.style.display='block';e.innerHTML=`<b>${nameOf(t)}</b><div style="height:7px;background:#1b0d0d;border:1px solid #6d4a33;margin-top:4px"><i style="display:block;height:100%;width:${pct}%;background:#9b2b24"></i></div><span>${Math.max(0,Math.ceil(c.hp))} / ${c.maxHp}</span>`;
}
function selectTarget(r){
  if(!r||!r.parent)return false;state.target=r;
  if(!r.userData.combat1298){const max=/kekuri/i.test(nameOf(r))?2500:isMonster(r)?120:100;r.userData.combat1298={hp:max,maxHp:max}}
  makeMarker(r);refreshTargetHud();toast(`${nameOf(r)} hedeflendi`);return true;
}
function clearTarget(){state.target=null;state.targetIndex=-1;removeMarker();refreshTargetHud()}
function cycleMonster(){
  const a=avatar();if(!a)return null;const list=npcs().filter(r=>r.parent&&isMonster(r)&&distTo(r)<70).sort((x,y)=>distTo(x)-distTo(y));
  if(!list.length){toast('Yakında hedef alınabilir yaratık yok');clearTarget();return null}
  if(state.target&&list.includes(state.target))state.targetIndex=(list.indexOf(state.target)+1)%list.length;else state.targetIndex=0;
  selectTarget(list[state.targetIndex]);return state.target;
}
function nearestNpc(max=9){return npcs().filter(r=>r.parent&&!isMonster(r)).map(r=>({r,d:distTo(r)})).filter(x=>x.d<=max).sort((a,b)=>a.d-b.d)[0]?.r||null}

function damagePopup(target,amount){
  if(!target||!window.THREE)return;const c=document.createElement('canvas');c.width=128;c.height=48;const x=c.getContext('2d');x.font='bold 28px Tahoma';x.textAlign='center';x.lineWidth=4;x.strokeStyle='#000';x.strokeText(`-${amount}`,64,30);x.fillStyle='#ff5b49';x.fillText(`-${amount}`,64,30);const tex=new THREE.CanvasTexture(c),mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}),sp=new THREE.Sprite(mat);sp.scale.set(1.3,.48,1);sp.position.set(0,2.4,0);target.add(sp);const start=performance.now();const timer=setInterval(()=>{const p=(performance.now()-start)/700;sp.position.y=2.4+p*.9;mat.opacity=1-p;if(p>=1){clearInterval(timer);target.remove(sp);tex.dispose();mat.dispose()}},30)
}
function killTarget(t){
  const c=t.userData.combat1298;c.hp=0;refreshTargetHud();toast(`${nameOf(t)} öldürüldü · +20 EXP`);state.exp+=20;t.visible=false;removeMarker();state.target=null;
  setTimeout(()=>{if(!t.parent)return;c.hp=c.maxHp;t.visible=true},8000);refreshTargetHud();
}
function basicAttack(){
  if(!isWorld())return;
  let t=state.target;if(!t||!t.parent||!isMonster(t))t=cycleMonster();if(!t)return;
  const d=distTo(t);if(d>3.3){toast(`Hedef çok uzakta (${d.toFixed(1)}m)`,'danger');return}
  const now=performance.now();if(now-state.lastAttack<state.attackCooldown)return;state.lastAttack=now;
  const a=avatar();if(a){const dx=t.position.x-a.position.x,dz=t.position.z-a.position.z;a.rotation.y=Math.atan2(dx,dz)}
  playAttackAnim();const dmg=(state.equippedWeapon?30:14)+Math.floor(Math.random()*8);const c=t.userData.combat1298||{hp:120,maxHp:120};c.hp=Math.max(0,c.hp-dmg);t.userData.combat1298=c;damagePopup(t,dmg);refreshTargetHud();if(c.hp<=0)killTarget(t)
}

function useHp(){if(state.inventory.hpPotion<=0)return toast('HP potion kalmadı','danger');if(state.hp>=state.maxHp)return toast('HP zaten dolu');state.inventory.hpPotion--;state.hp=Math.min(state.maxHp,state.hp+60);toast(`HP Potion kullanıldı · ${state.inventory.hpPotion} kaldı`);decorateInventory()}
function useMp(){if(state.inventory.mpPotion<=0)return toast('MP potion kalmadı','danger');if(state.mp>=state.maxMp)return toast('MP zaten dolu');state.inventory.mpPotion--;state.mp=Math.min(state.maxMp,state.mp+50);toast(`MP Potion kullanıldı · ${state.inventory.mpPotion} kaldı`);decorateInventory()}
function town(){const a=avatar();if(!a)return;a.position.x=336;a.position.z=398;toast('Moradon başlangıç noktasına dönüldü')}
function toggleRun(){const b=document.querySelector('[data-uiid="btn_run" i],[data-uiid="btn_walk" i],[data-uiid="btn_control" i]');if(b){b.click();toast('Yürüme / koşma modu değiştirildi')}else toast('Run kontrolü henüz yüklenmedi')}

function togglePanel(kind){world()?.togglePanel?.(kind);if(kind==='inventory')setTimeout(decorateInventory,120)}
function decorateInventory(){
  const p=document.querySelector('[data-kind="inventory"]');if(!p||p.style.display==='none')return;let box=p.querySelector('.oldkoFunctionalInventory');if(!box){box=document.createElement('div');box.className='oldkoFunctionalInventory';Object.assign(box.style,{position:'absolute',right:'24px',bottom:'30px',zIndex:'9000',width:'185px',padding:'8px',background:'rgba(22,14,9,.94)',border:'1px solid #9d7c49',color:'#f4e5b9',font:'11px Tahoma',pointerEvents:'auto'});p.appendChild(box)}
  box.innerHTML=`<b style="display:block;margin-bottom:7px">OLDKO INVENTORY ACTIONS</b><button data-inv="weapon" style="width:100%;margin:2px 0">Starter Weapon ${state.equippedWeapon?'[EQUIPPED]':'[EQUIP]'}</button><button data-inv="hp" style="width:100%;margin:2px 0">HP Potion ×${state.inventory.hpPotion}</button><button data-inv="mp" style="width:100%;margin:2px 0">MP Potion ×${state.inventory.mpPotion}</button>`;
  box.querySelectorAll('button').forEach(b=>{b.style.cssText+=';background:#3b2a18;color:#f9e9b7;border:1px solid #80653e;padding:6px;cursor:pointer';b.onclick=e=>{e.stopPropagation();if(b.dataset.inv==='weapon'){state.equippedWeapon=!state.equippedWeapon;toast(state.equippedWeapon?'Starter weapon kuşanıldı':'Starter weapon çıkarıldı');decorateInventory()}else if(b.dataset.inv==='hp')useHp();else useMp()}})
}

function closeNpcDialog(){document.getElementById('oldkoNpcDialog')?.remove()}
function roleOf(n){const m=/\[(.*?)\]/.exec(n);return m?.[1]||'NPC'}
function buy(kind,price){if(state.coin<price)return toast('Yeterli coin yok','danger');state.coin-=price;if(kind==='hpPotion')state.inventory.hpPotion++;if(kind==='mpPotion')state.inventory.mpPotion++;toast(`Satın alındı · ${state.coin.toLocaleString('tr-TR')} coin kaldı`);openMerchant(document.getElementById('oldkoNpcDialog')?.dataset.npcName||'Merchant')}
function openMerchant(npcOrName){
  const n=typeof npcOrName==='string'?npcOrName:nameOf(npcOrName);const root=document.getElementById('oldkoNpcDialog');if(!root)return;
  root.dataset.npcName=n;const role=roleOf(n).toLowerCase();let items=[];
  if(role.includes('potion'))items=[['HP Potion','hpPotion',50],['MP Potion','mpPotion',50]];
  else if(role.includes('sundries'))items=[['HP Potion','hpPotion',60],['MP Potion','mpPotion',60],['Teleport Scroll','scroll',200]];
  else items=[['Starter Weapon','weapon',1000],['HP Potion','hpPotion',60],['MP Potion','mpPotion',60]];
  const body=root.querySelector('[data-npc-body]');body.innerHTML=`<div style="margin-bottom:6px">Coin: <b>${state.coin.toLocaleString('tr-TR')}</b></div>${items.map(([label,key,price])=>`<button data-buy="${key}" data-price="${price}" style="display:flex;justify-content:space-between;width:100%;margin:4px 0;padding:7px;background:#322315;color:#f6e8bd;border:1px solid #80653e;cursor:pointer"><span>${label}</span><b>${price}</b></button>`).join('')}`;body.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{if(b.dataset.buy==='weapon'){if(state.coin<Number(b.dataset.price))return toast('Yeterli coin yok','danger');state.coin-=Number(b.dataset.price);state.inventory.starterWeapon++;toast('Starter weapon satın alındı')}else buy(b.dataset.buy,Number(b.dataset.price))})
}
function openInn(){
  const root=document.getElementById('oldkoNpcDialog');if(!root)return;const body=root.querySelector('[data-npc-body]');
  body.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><button data-dep="hpPotion">HP → Inn (${state.bank.hpPotion})</button><button data-dep="mpPotion">MP → Inn (${state.bank.mpPotion})</button><button data-with="hpPotion">Inn → HP</button><button data-with="mpPotion">Inn → MP</button></div>`;
  body.querySelectorAll('button').forEach(b=>{b.style.cssText='padding:8px;background:#322315;color:#f6e8bd;border:1px solid #80653e;cursor:pointer';b.onclick=()=>{const k=b.dataset.dep||b.dataset.with;if(b.dataset.dep){if(state.inventory[k]<=0)return toast('Inventoryde yok');state.inventory[k]--;state.bank[k]++}else{if(state.bank[k]<=0)return toast('Inn boş');state.bank[k]--;state.inventory[k]++}openInn()}})
}
function openNpcDialog(npc){
  closeNpcDialog();const n=nameOf(npc),role=roleOf(n);const el=document.createElement('div');el.id='oldkoNpcDialog';el.dataset.npcName=n;Object.assign(el.style,{position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',zIndex:'12000',width:'390px',padding:'12px',background:'rgba(28,18,11,.97)',border:'2px solid #8c7144',boxShadow:'0 14px 45px #000',color:'#f2e5bd',font:'12px Tahoma',pointerEvents:'auto'});el.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center"><div><b style="font-size:14px">${n}</b><div style="color:#c5a86d">${role}</div></div><button data-npc-close style="background:#3b2518;color:#fff;border:1px solid #7e613d;cursor:pointer">X</button></div><hr style="border:0;border-top:1px solid #5d482e"><div data-npc-body>Ne yapmak istiyorsun?</div><div style="display:flex;gap:6px;margin-top:10px"><button data-talk>Konuş</button>${/inn hostess/i.test(n)?'<button data-inn>Inn Hostess</button>':'<button data-shop>Alışveriş</button>'}</div>`;document.getElementById('worldStageInner')?.appendChild(el);el.querySelectorAll('button').forEach(b=>{b.style.cssText+=(b.style.cssText?';':'')+'padding:7px 10px;background:#342416;color:#f6e8bd;border:1px solid #80653e;cursor:pointer'});el.querySelector('[data-npc-close]').onclick=closeNpcDialog;el.querySelector('[data-talk]').onclick=()=>{el.querySelector('[data-npc-body]').textContent=`${n}: Moradon'a hoş geldin. OldKO test dünyasında NPC etkileşimi aktif.`};el.querySelector('[data-shop]')?.addEventListener('click',()=>openMerchant(npc));el.querySelector('[data-inn]')?.addEventListener('click',openInn)
}
function interact(){const n=nearestNpc(10);if(!n)return toast('Yakında konuşabileceğin NPC yok');openNpcDialog(n)}

function installHotkeys(){
  const host=document.getElementById('worldStageInner');if(!host||document.getElementById('oldkoFunctionalHotkeys'))return;
  const wrap=document.createElement('div');wrap.id='oldkoFunctionalHotkeys';Object.assign(wrap.style,{position:'absolute',left:'8px',top:'330px',zIndex:'9500',display:'grid',gridTemplateColumns:'42px',gap:'3px',pointerEvents:'auto'});
  const defs=[['1','ATTACK'],['2','HP'],['3','MP'],['4','NPC'],['5','TOWN'],['6','TARGET'],['7','INV'],['8','SKILL']];
  for(const [k,label] of defs){const b=document.createElement('button');b.textContent=`${k}\n${label}`;b.dataset.hk=k;Object.assign(b.style,{width:'42px',height:'40px',whiteSpace:'pre-line',background:'rgba(24,18,13,.48)',border:'1px solid rgba(188,151,83,.55)',color:'#f7e3a8',font:'bold 9px Tahoma',cursor:'pointer',textShadow:'1px 1px #000'});b.onclick=()=>runHotkey(k);wrap.appendChild(b)}host.appendChild(wrap)
}
function runHotkey(k){if(k==='1')basicAttack();else if(k==='2')useHp();else if(k==='3')useMp();else if(k==='4')interact();else if(k==='5')town();else if(k==='6')cycleMonster();else if(k==='7')togglePanel('inventory');else if(k==='8')togglePanel('skill')}

function installInput(){
  addEventListener('keydown',e=>{
    if(!isWorld())return;const key=e.key.toLowerCase();
    if(['i','c','u','k','h','z','f','r','q','1','2','3','4','5','6','7','8'].includes(key)){e.preventDefault();e.stopImmediatePropagation()}
    if(key==='i')togglePanel('inventory');else if(key==='c'||key==='u')togglePanel('character');else if(key==='k')togglePanel('skill');else if(key==='h')togglePanel('command');else if(key==='z')cycleMonster();else if(key==='f')interact();else if(key==='r')basicAttack();else if(key==='q')toggleRun();else if(/^[1-8]$/.test(key))runHotkey(key)
  },true);
  addEventListener('dblclick',e=>{if(!isWorld()||!e.target?.closest?.('#canvasWrap'))return;if(state.target&&isMonster(state.target))basicAttack();else interact()},true);
  setInterval(()=>{if(!isWorld())return;installHotkeys();if(state.target&&(!state.target.parent||!state.target.visible))clearTarget();if(state.marker)state.marker.rotation.z+=.05},500)
}
installInput();

window.OldKOGameplay={state,cycleMonster,selectTarget,basicAttack,interact,togglePanel,useHp,useMp,town,clearTarget};
})();
