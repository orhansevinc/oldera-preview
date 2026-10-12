(()=>{'use strict';
const $=id=>document.getElementById(id);
const root=document.documentElement;

/* v32 keeps the authentic 1024x768 client composition, then scales the stage to the browser. */
const style=document.createElement('style');
style.textContent=`
#stage{left:50%!important;top:50%!important;transform:translate(-50%,-50%) scale(var(--ko-v32-sx,1),var(--ko-v32-sy,1))!important;transform-origin:center center!important}
#scene3d canvas{width:1024px!important;height:768px!important;image-rendering:auto!important}
.originalLoadingStage.v32-loading{position:fixed!important;left:50%!important;top:50%!important;inset:auto!important;width:1024px!important;height:768px!important;transform:translate(-50%,-50%) scale(var(--ko-v32-sx,1),var(--ko-v32-sy,1))!important;transform-origin:center center!important;z-index:250000!important;pointer-events:none!important;background:#000!important}
`;
document.head.appendChild(style);
function fit(){
  root.style.setProperty('--ko-v32-sx',String(Math.max(.25,innerWidth/1024)));
  root.style.setProperty('--ko-v32-sy',String(Math.max(.25,innerHeight/768)));
}
addEventListener('resize',fit,{passive:true});fit();

/* Login must start empty. Tab follows ID -> password and Enter on password logs in. */
function configureLogin(){
  const id=document.querySelector('#uiHost input[data-uiid="Edit_ID" i]');
  const pw=document.querySelector('#uiHost input[data-uiid="Edit_PW" i]');
  if(!id||!pw||id.dataset.v32login==='1')return;
  id.dataset.v32login=pw.dataset.v32login='1';
  id.tabIndex=1;pw.tabIndex=2;
  id.autocomplete='off';pw.autocomplete='off';
  id.value='';pw.value='';
  id.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();pw.focus();}
  });
  pw.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      document.querySelector('#uiHost button[data-uiid="btn_ok" i]')?.click();
    }
  });
  setTimeout(()=>{if(id.isConnected){id.value='';pw.value='';id.focus();}},0);
}
const host=$('uiHost');
if(host)new MutationObserver(()=>setTimeout(configureLogin,0)).observe(host,{childList:true,subtree:true});

/* The v31 viewport-aspect override moved the original chair/character composition sideways.
   Keep the original 4:3 projection; only CSS stretches the finished frame to fullscreen. */
function patchSelect(){
  if(!window.OldERACharScene?.select||OldERACharScene.__v32Framing)return;
  const base=OldERACharScene.select.bind(OldERACharScene);
  OldERACharScene.__v32Framing=true;
  OldERACharScene.select=async(...args)=>{
    const s=await base(...args);
    if(!s?.camera||!s?.renderer)return s;
    const refit=()=>{
      s.camera.aspect=4/3;
      s.camera.updateProjectionMatrix?.();
      const dpr=Math.min(3,Math.max(devicePixelRatio||1,innerWidth/1024,innerHeight/768));
      s.renderer.setPixelRatio?.(dpr);
      s.renderer.setSize?.(1024,768,false);
    };
    refit();
    addEventListener('resize',()=>requestAnimationFrame(refit),{passive:true});
    return s;
  };
}
patchSelect();

/* Keep the original KO loading panel alive until Moradon has actually produced a frame.
   buildHud() used to clear worldStageInner at ~88%, causing the sudden black screen. */
let activeLoading=null;
function adoptLoading(node){
  if(!node?.classList?.contains('originalLoadingStage'))return;
  activeLoading=node;
  node.classList.add('v32-loading');
  $('world')?.appendChild(node);
}
const worldStage=$('worldStageInner');
if(worldStage)new MutationObserver(ms=>{
  for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1){
    if(n.classList?.contains('originalLoadingStage'))adoptLoading(n);
    else n.querySelectorAll?.('.originalLoadingStage').forEach(adoptLoading);
  }
}).observe(worldStage,{childList:true,subtree:true});

function patchWorld(){
  if(!window.OldERAWorld?.start||OldERAWorld.__v32Start)return;
  const base=OldERAWorld.start.bind(OldERAWorld);
  OldERAWorld.__v32Start=true;
  OldERAWorld.start=async options=>{
    try{
      const out=await base(options);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      activeLoading?.remove();activeLoading=null;
      return out;
    }catch(e){
      if(activeLoading){
        const msg=document.createElement('div');
        msg.style.cssText='position:absolute;left:0;right:0;bottom:10%;text-align:center;color:#ffb5aa;font:14px Tahoma;text-shadow:1px 1px #000';
        msg.textContent='Moradon yükleme hatası: '+(e?.message||e);
        activeLoading.appendChild(msg);
      }
      throw e;
    }
  };
}
patchWorld();

/* Populate NPCs after the first playable Moradon frame; never block world startup. */
if(window.THREE&&!THREE.WebGLRenderer.prototype.__v32Npc){
  const p=THREE.WebGLRenderer.prototype,r0=p.render;p.__v32Npc=true;let started=false;
  p.render=function(sc,cam){
    const out=r0.call(this,sc,cam);
    if(!started&&sc?.getObjectByName?.('MoradonTerrain1298')){
      started=true;
      setTimeout(()=>Promise.resolve(window.OldERANPCV25?.populate?.(sc)).catch(e=>console.warn('v32 NPC',e)),0);
    }
    return out;
  };
}
window.OldERAV32={fit,configureLogin};
})();