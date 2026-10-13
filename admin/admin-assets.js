(()=>{
'use strict';

const loaded=new Map();
let itemIndexPromise=null;
let resizeObserver=null;
let activePreviewHost=null;
let activePlayer=null;

function loadScript(src,test){
  if(test?.())return Promise.resolve();
  if(loaded.has(src))return loaded.get(src);
  const p=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src;s.async=false;
    s.onload=()=>test&&!test()?reject(new Error(`Loaded but unavailable: ${src}`)):resolve();
    s.onerror=()=>reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
  loaded.set(src,p);p.catch(()=>loaded.delete(src));return p;
}

async function ready(){
  await loadScript('https://unpkg.com/three@0.128.0/build/three.min.js',()=>window.THREE);
  await loadScript('../ui1298.js',()=>window.N3UI);
  await loadScript('../worlddata1298.js',()=>window.OldERAData);
  await loadScript('../table1298.js',()=>window.OldERATable);
  await loadScript('../charscene1298.js',()=>window.OldERACharScene);
  return api;
}

function normName(v){return String(v||'').toLowerCase().replace(/\(.*?\)/g,'').replace(/\+\d+/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
async function itemIndex(){
  if(itemIndexPromise)return itemIndexPromise;
  itemIndexPromise=(async()=>{
    await ready();
    const table=await OldERATable.load('Data/Item_Org_us.tbl');
    const exact=new Map(),byId=new Map(),loose=[];
    for(const row of table.rows){
      const name=String(row[2]||'').trim(),id=Number(row[0])>>>0;if(!id)continue;
      const entry={id,name:name||`Item ${id}`,iconId:Number(row[7])>>>0,row};
      byId.set(id,entry);if(name){const key=normName(name);if(key&&!exact.has(key))exact.set(key,entry);loose.push([key,entry])}
    }
    return{exact,byId,loose};
  })();
  itemIndexPromise.catch(()=>itemIndexPromise=null);return itemIndexPromise;
}

const aliases=new Map([
  ['hp potion',['water of life','potion of life','hp potion']],
  ['mp potion',['potion of soul','water of grace','mp potion']],
  ['teleport scroll',['teleport scroll','scroll of teleport']],
  ['ring',['ring']],['defender of the lord',['defender of the lord']],['smite hammer',['smite hammer']],
  ['bronze earring',['bronze earring']],['iron necklace',['iron necklace']],['iron belt',['iron belt']],
  ['blessed upgrade scroll',['blessed upgrade scroll']]
]);

async function findItem(name){
  const idx=await itemIndex(),key=normName(name);if(idx.exact.has(key))return idx.exact.get(key);
  for(const alias of aliases.get(key)||[]){const hit=idx.exact.get(normName(alias));if(hit)return hit}
  const words=key.split(' ').filter(Boolean);let best=null,bestScore=0;
  for(const [candidate,entry] of idx.loose){let score=0;for(const w of words)if(candidate.includes(w))score++;if(score>bestScore){bestScore=score;best=entry}}
  return bestScore>=Math.min(2,words.length)?best:null;
}
async function findItemById(id){return (await itemIndex()).byId.get(Number(id)>>>0)||null}

function iconPath(iconId){const n=Number(iconId)||0;if(!n)return null;const a=Math.floor(n/10000000),b=String(Math.floor(n/1000)%10000).padStart(4,'0'),c=String(Math.floor(n/10)%100).padStart(2,'0'),d=n%10;return `UI/ItemIcon_${a}_${b}_${c}_${d}.dxt`}
async function iconCanvas(name,itemId=0){
  const entry=itemId?await findItemById(itemId):await findItem(name);if(!entry?.iconId)return null;const path=iconPath(entry.iconId);if(!path)return null;
  try{const src=await N3UI.texCanvas(path),out=document.createElement('canvas');out.width=45;out.height=45;out.className='real-item-icon';const ctx=out.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.drawImage(src,0,0,Math.min(45,src.width),Math.min(45,src.height),0,0,45,45);out.title=`${entry.name} · ${entry.id} · ${path}`;out.dataset.itemId=String(entry.id);out.dataset.iconPath=path;return out}catch(e){console.warn('1298 item icon',name||itemId,path,e);return null}
}
async function decorateItemIcons(root){
  await ready();const buttons=[...root.querySelectorAll('[data-item-name],[data-item-id]')];
  await Promise.all(buttons.map(async btn=>{if(btn.dataset.realIconReady==='1')return;btn.dataset.realIconReady='1';const itemId=Number(btn.dataset.itemId||0);const entry=itemId?await findItemById(itemId):null;if(entry&&btn.dataset.itemName?.startsWith('Item '))btn.dataset.itemName=entry.name;const canvas=await iconCanvas(btn.dataset.itemName,itemId);if(!canvas){btn.dataset.realIconReady='0';return}const fallback=btn.querySelector('.item-icon');if(fallback)fallback.classList.add('icon-fallback-hidden');btn.prepend(canvas)}));
}

function avatarConfig(p){
  const nation=String(p.nation||'').toLowerCase().includes('karus')?1:2,cls=String(p.className||'Warrior').toLowerCase();let race;
  if(nation===1)race=cls.includes('rogue')?'btn_race_ka_tu':cls.includes('mage')?'btn_race_ka_wt':cls.includes('priest')?'btn_race_ka_pt':'btn_race_ka_at';
  else race=cls.includes('mage')?'btn_race_el_rf':'btn_race_el_rm';
  return{nation,race,job:`btn_class_${cls.includes('mage')?'mage':cls.includes('priest')?'priest':cls.includes('rogue')?'rogue':'warrior'}`,face:0,hair:0};
}

function fitFullBody(state){
  if(!state?.char?.group||!state?.camera||!window.THREE)return;
  const group=state.char.group,cam=state.camera;
  let box=new THREE.Box3().setFromObject(group),center=new THREE.Vector3();box.getCenter(center);
  group.position.x-=center.x;group.position.y-=center.y;group.position.z-=center.z;
  box=new THREE.Box3().setFromObject(group);const size=new THREE.Vector3();box.getSize(size);
  const fov=THREE.MathUtils.degToRad(cam.fov||30),vertical=Math.max(.1,size.y),depth=Math.max(.1,size.z);
  const distance=Math.max(4.8,(vertical*.5)/Math.tan(fov*.5)*1.28+depth*.55);
  cam.near=.05;cam.far=Math.max(80,distance*8);cam.position.set(0,vertical*.015,distance);cam.lookAt(0,0,0);cam.updateProjectionMatrix();
}

async function drawCharacter(host,player){
  await ready();if(!host||!host.isConnected)return;activePreviewHost=host;activePlayer=player;
  const rect=()=>({l:0,t:0,r:Math.max(260,host.clientWidth||320),b:Math.max(500,host.clientHeight||560)});
  host.innerHTML='<div class="asset-loading"><b>OLDKO 1298 CHR/N3</b><span>Tam boy karakter assetleri yükleniyor…</span></div>';
  try{
    const cfg=avatarConfig(player),state=await OldERACharScene.preview(host,{...cfg,rect:rect()});fitFullBody(state);
    if(!host.querySelector('.n3-model-label')){const label=document.createElement('div');label.className='n3-model-label';label.innerHTML='<b>OLDKO 1298 · FULL BODY</b><span>Mouse ile çevir</span>';host.appendChild(label)}
    resizeObserver?.disconnect();resizeObserver=new ResizeObserver(()=>{if(activePreviewHost!==host||!host.isConnected)return;OldERACharScene.preview(host,{...cfg,rect:rect()}).then(fitFullBody).catch(()=>{})});resizeObserver.observe(host);
  }catch(e){console.error('OldKO admin character preview',e);host.innerHTML='<div class="asset-error"><b>3D preview yüklenemedi</b><span>1298 asset bağlantısı kontrol edilecek.</span></div>'}
}

function stopCharacter(){resizeObserver?.disconnect();resizeObserver=null;activePreviewHost=null;activePlayer=null;try{window.OldERACharScene?.stop?.()}catch{}}

const api={ready,itemIndex,findItem,findItemById,iconPath,iconCanvas,decorateItemIcons,drawCharacter,stopCharacter,avatarConfig,fitFullBody};
window.OldKOAdminAssets=api;window.OldERAAdminAssets=api;
})();
