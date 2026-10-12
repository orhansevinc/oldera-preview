(()=>{'use strict';
if(!window.N3UI)return;
const RAW=N3UI.RAW||'https://raw.githubusercontent.com/ko4life-net/ko-assets/1298/';
const texCache=new Map();
function canon(p,def='UI_US'){
  p=String(p||'').replace(/\\/g,'/').replace(/^\.\//,'');
  if(!p)return'';
  const low=p.toLowerCase();
  const ix=low.indexOf('ui_us/');
  if(ix>=0)p=p.slice(ix);
  else if(!p.includes('/'))p=def+'/'+p;
  p=p.replace(/^ui_us\//i,'UI_US/').replace(/^chrselect\//i,'ChrSelect/').replace(/^item\//i,'Item/').replace(/^object\//i,'Object/').replace(/^misc\//i,'Misc/').replace(/^data\//i,'Data/');
  return p;
}
async function fetchBin(path){
  path=canon(path,path.toLowerCase().includes('ui')?'UI_US':'');
  const variants=[path,path.replace(/\.dxt$/i,'.DXT'),path.replace(/\.uif$/i,'.uif')];
  let last;
  for(const p of [...new Set(variants)]){
    try{const r=await fetch(RAW+p.split('/').map(encodeURIComponent).join('/'));if(r.ok)return await r.arrayBuffer();last=Error(r.status+' '+p)}catch(e){last=e}
  }
  throw last||Error(path);
}
async function texCanvas(path){
  path=canon(path);const key=path.toLowerCase();if(texCache.has(key))return texCache.get(key);
  const pr=(async()=>{const d=N3UI.decodeNTF(await fetchBin(path)),c=document.createElement('canvas');c.width=d.w;c.height=d.h;c.getContext('2d').putImageData(new ImageData(d.data,d.w,d.h),0,0);return c})();
  texCache.set(key,pr);return pr;
}
N3UI.norm=canon;N3UI.fetchBin=fetchBin;N3UI.texCanvas=texCanvas;

/* 1298 character-select shape textures use alpha. The v18 material forced them opaque,
   which turned the original chair/background scene black. Restore the N3-era alpha behaviour
   before charscene1298.js is evaluated. */
if(window.THREE&&THREE.MeshLambertMaterial&&!THREE.__oldera1298MaterialFix){
  THREE.__oldera1298MaterialFix=true;
  const Native=THREE.MeshLambertMaterial;
  function Fixed(params){params=params?{...params}:{};if(params.map&&params.transparent===false){params.transparent=true;if(!params.alphaTest)params.alphaTest=.05}return new Native(params)}
  Fixed.prototype=Native.prototype;Object.setPrototypeOf(Fixed,Native);THREE.MeshLambertMaterial=Fixed;
}

const compat=window.OldERACompat={account:'osevinc',face:0,hair:0,pendingRace:null,pendingJob:null};
const nationKey=id=>'oldera1298.nation.'+id;
const charKey=id=>'oldera1298.character.'+id;
try{if(localStorage.getItem(nationKey('osevinc'))==null)localStorage.setItem(nationKey('osevinc'),'2')}catch{}
function savedNation(){try{return +(localStorage.getItem(nationKey(compat.account))||0)}catch{return 0}}
function saveNation(n){try{localStorage.setItem(nationKey(compat.account),String(n))}catch{}}
function savedChar(){try{return JSON.parse(localStorage.getItem(charKey(compat.account))||'null')}catch{return null}}
function saveChar(c){try{if(c)localStorage.setItem(charKey(compat.account),JSON.stringify(c));else localStorage.removeItem(charKey(compat.account))}catch{}}

function installRuntime(){
  const style=document.createElement('style');
  style.textContent=`
    /* Match the original launcher: only the right content frame is blacked out. */
    #launcher .promoErase{left:42.25%!important;right:1.2%!important;top:11.55%!important;height:59.8%!important;background:#000!important;border:1px solid #2d211d!important;box-shadow:none!important}
    #launcher .patchMask{left:42.25%!important;right:1.2%!important;top:71.4%!important;height:10.3%!important;background:#0b0504!important;border-top:1px solid #3b251c!important}
    #launcher .patchText{left:43.5%!important;right:2.5%!important;top:72.1%!important}
    #launcher .bar{left:42.9%!important;right:2%!important;top:77%!important;height:3.8%!important}
    #worldLoader{display:none!important}
    .oldera-original-loading{position:fixed;inset:0;z-index:20000;background:#000;overflow:hidden}
    .oldera-original-loading-stage{position:absolute;width:1024px;height:768px;left:50%;top:50%;transform-origin:center center}
  `;
  document.head.appendChild(style);

  const fitLoad=()=>{const s=document.querySelector('.oldera-original-loading-stage');if(!s)return;const k=Math.min(innerWidth/1024,innerHeight/768);s.style.transform=`translate(-50%,-50%) scale(${k})`};
  addEventListener('resize',fitLoad);

  /* Alias osevinc1/osevinc1 to the existing local test transport while keeping a separate
     first-run profile in browser storage. The visible login remains osevinc1. */
  document.addEventListener('click',e=>{
    const id=String(e.target?.dataset?.uiid||'').toLowerCase();
    if(id==='btn_ok'){
      const user=document.querySelector('[data-uiid="Edit_ID"],[data-uiid="edit_id"]');
      const pass=document.querySelector('[data-uiid="Edit_PW"],[data-uiid="edit_pw"]');
      const u=(user?.value||'').trim(),p=pass?.value||'';
      if(u==='osevinc1'&&p==='osevinc1'){compat.account='osevinc1';user.value='osevinc';pass.value='osevinc'}
      else if(u==='osevinc'&&p==='osevinc'){compat.account='osevinc'}
    }
    if(id==='btn_elmo_selection')saveNation(2);
    if(id==='btn_karus_selection')saveNation(1);
    if(id==='bt_delete'&&compat.account==='osevinc1')saveChar(null);
    if(/^btn_race_/.test(id))compat.pendingRace=id;
    if(/^btn_class_/.test(id))compat.pendingJob=id;
    if(id==='btn_face_left')compat.face=(compat.face+3)%4;
    if(id==='btn_face_right')compat.face=(compat.face+1)%4;
    if(id==='btn_hair_left')compat.hair=(compat.hair+2)%3;
    if(id==='btn_hair_right')compat.hair=(compat.hair+1)%3;
  },true);

  /* Once charscene is present, keep osevinc1 genuinely empty on first login and persist its
     created character afterwards. Existing osevinc keeps its original character. */
  const wrapScene=()=>{
    if(!window.OldERACharScene||OldERACharScene.__compatWrapped)return false;
    const nativeSelect=OldERACharScene.select.bind(OldERACharScene);
    OldERACharScene.select=async(host,opts={})=>{
      if(compat.account==='osevinc1'){
        const fromRuntime=(opts.characters||[]).find(c=>c&&String(c.name||'').toLowerCase()!=='osevinc');
        if(fromRuntime)saveChar(fromRuntime);
        const c=fromRuntime||savedChar();
        opts={...opts,characters:[c||null,null,null],character:c||null,selectedIndex:0};
      }
      return nativeSelect(host,opts);
    };
    OldERACharScene.__compatWrapped=true;return true;
  };
  if(!wrapScene()){let tries=0,t=setInterval(()=>{if(wrapScene()||++tries>100)clearInterval(t)},25)}

  /* Nation selection is a first-run screen. For a profile that already owns a nation,
     hide that page and immediately choose the stored nation. */
  let autoBusy=false;
  const obs=new MutationObserver(()=>{
    if(autoBusy)return;
    const el=document.querySelector('[data-uiid="btn_elmo_selection"],[data-uiid="btn_karus_selection"]');
    if(el){
      const n=savedNation();
      if(n){autoBusy=true;const stage=document.getElementById('stage');if(stage)stage.style.visibility='hidden';setTimeout(()=>{const b=document.querySelector(n===1?'[data-uiid="btn_karus_selection"]':'[data-uiid="btn_elmo_selection"]');b?.click();setTimeout(()=>{if(stage)stage.style.visibility='visible';autoBusy=false},80)},20)}
    }
  });
  obs.observe(document.body,{childList:true,subtree:true});

  /* Replace the homemade Moradon transition with the real 1298 loading UIF. */
  const wrapWorld=()=>{
    if(!window.OldERAWorld||OldERAWorld.__loadingWrapped)return false;
    const nativeStart=OldERAWorld.start.bind(OldERAWorld);
    OldERAWorld.start=async(...args)=>{
      let overlay=document.createElement('div');overlay.className='oldera-original-loading';
      let stage=document.createElement('div');stage.className='oldera-original-loading-stage';overlay.appendChild(stage);document.body.appendChild(overlay);fitLoad();
      let progressCtl=null,infoCtl=null,layers=[];
      try{
        const n=savedNation()||2,root=await N3UI.loadUI(n===1?'UI_US/ka_loading_us.uif':'UI_US/el_loading_us.uif');
        await N3ExactUI.render(root,stage,{native:false});
        progressCtl=N3ExactUI.get('Progress_Loading')||N3ExactUI.get('progress_loading');
        infoCtl=N3ExactUI.get('Text_Info')||N3ExactUI.get('text_info');
        layers=progressCtl?.el?[...progressCtl.el.querySelectorAll('canvas')]:[];
      }catch(err){console.warn('original loading ui',err)}
      let p=0;const setP=v=>{p=Math.max(p,Math.min(100,v));infoCtl?.setText?.('Loading... '+Math.round(p)+'%');if(layers.length>1){layers[0].style.display='block';const fill=layers[layers.length-1];fill.style.display='block';fill.style.clipPath=`inset(0 ${100-p}% 0 0)`;}};
      setP(2);const timer=setInterval(()=>setP(Math.min(92,p+2)),55);
      try{const result=await nativeStart(...args);clearInterval(timer);setP(100);await new Promise(r=>setTimeout(r,220));return result}
      finally{clearInterval(timer);overlay.remove()}
    };
    OldERAWorld.__loadingWrapped=true;return true;
  };
  if(!wrapWorld()){let tries=0,t=setInterval(()=>{if(wrapWorld()||++tries>100)clearInterval(t)},25)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installRuntime,{once:true});else installRuntime();
})();