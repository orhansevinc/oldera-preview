(()=>{'use strict';
const $=id=>document.getElementById(id);
const root=document.documentElement;

// v27: fill the browser viewport instead of letterboxing the original 1024x768 stage.
const css=document.createElement('style');
css.textContent=`
#game{overflow:hidden!important;background:#000!important}
#stage{left:50%!important;top:50%!important;transform:translate(-50%,-50%) scale(var(--ko-v27-sx,1),var(--ko-v27-sy,1))!important;transform-origin:center center!important}
#scene3d canvas{image-rendering:auto!important;backface-visibility:hidden}
#worldLoadingV27{position:fixed;inset:0;z-index:200000;background:#000;overflow:hidden;opacity:1;transition:opacity .18s linear;pointer-events:auto}
#worldLoadingV27.hide{opacity:0;pointer-events:none}
#worldLoadingV27 .v27stage{position:absolute;left:50%;top:50%;width:1024px;height:768px;transform:translate(-50%,-50%) scale(var(--ko-v27-sx,1),var(--ko-v27-sy,1));transform-origin:center center}
#serverNoticeV27{position:absolute;inset:0;z-index:190000;background:rgba(0,0,0,.58);pointer-events:auto;display:flex;align-items:center;justify-content:center}
#serverNoticeV27 .noticeStage{position:relative;width:1024px;height:768px;pointer-events:none}
#serverNoticeV27 .noticeClick{position:absolute;inset:0;z-index:10000;pointer-events:auto;cursor:pointer;background:transparent;border:0}
#scene3d.v27-select-dark:after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 180px 55px rgba(0,0,0,.48);z-index:5}
`;
document.head.appendChild(css);
function fit(){
  root.style.setProperty('--ko-v27-sx',String(Math.max(.25,innerWidth/1024)));
  root.style.setProperty('--ko-v27-sy',String(Math.max(.25,innerHeight/768)));
}
addEventListener('resize',fit,{passive:true});fit();

// The old flow intentionally wrote Osevinc into the create-name field. Clear it after that stack finishes.
function clearForcedName(node=document){
  const inputs=node.querySelectorAll?.('input[data-uiid="edit_name" i]')||[];
  for(const i of inputs){
    if(/^osevinc$/i.test(String(i.value||'').trim())) i.value='';
    i.autocomplete='off';
  }
}
const uiHost=$('uiHost');
if(uiHost){
  new MutationObserver(ms=>{
    for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1){clearForcedName(n);queueMicrotask(()=>clearForcedName(n));}
  }).observe(uiHost,{childList:true,subtree:true});
}

// Restore the original 1298 selector idea: black environment, pre-select motion,
// and a focused spotlight/selected animation on the character under the mouse.
function patchCharacterSelect(){
  if(!window.OldERACharScene?.select||OldERACharScene.__v27SelectPatched)return;
  const base=OldERACharScene.select.bind(OldERACharScene);
  OldERACharScene.__v27SelectPatched=true;
  OldERACharScene.select=async(...args)=>{
    const state=await base(...args);
    if(!state?.scene||!state?.renderer||!state?.camera)return state;
    const canvas=state.renderer.domElement,scene=state.scene,camera=state.camera,chars=state.chars||[];
    const sceneHost=canvas.parentElement;
    sceneHost?.classList.add('v27-select-dark');

    // Match the browser aspect while the 1024x768 canvas itself is stretched to the viewport.
    const refit=()=>{
      camera.aspect=Math.max(.2,innerWidth/Math.max(1,innerHeight));
      camera.updateProjectionMatrix?.();
      const px=Math.min(3,Math.max(devicePixelRatio||1,innerWidth/1024,innerHeight/768));
      state.renderer.setPixelRatio?.(px);
      state.renderer.setSize?.(1024,768,false);
    };
    refit();
    addEventListener('resize',refit,{passive:true,once:false});

    // Chairs/background in the web port were MeshBasicMaterial, so normal lights could not darken them.
    // Tint only non-skinned meshes; actual characters remain light-reactive.
    scene.traverse(o=>{
      if(!o?.isMesh||o.geometry?.userData?.src)return;
      const ms=Array.isArray(o.material)?o.material:[o.material];
      for(const m of ms){if(m?.color&&!m.userData?.v27Darkened){m.userData.v27Darkened=true;m.color.multiplyScalar(.27);m.needsUpdate=true;}}
    });
    const ambients=scene.children.filter(x=>x?.isAmbientLight);
    const spots=scene.children.filter(x=>x?.isSpotLight);
    ambients.forEach(l=>l.intensity=.075);
    spots.forEach(l=>l.intensity=.04);

    // clientflow's old stabilizer freezes clips whose names are not literally "idle".
    // Re-assert the authentic selector pre-select animation (clip 0) after it runs.
    const preselect=c=>{
      if(!c)return;
      const a=c.clips?.[0];
      if(a)c.playLoop?.(a.start,a.end,performance.now(),a.fps||30);
    };
    setTimeout(()=>chars.forEach(preselect),0);

    let hovered=-1,holdTimer=0;
    const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
    function lightIndex(i){
      ambients.forEach(l=>l.intensity=i<0?.075:.105);
      spots.forEach((l,j)=>l.intensity=i===j?2.35:.025);
    }
    function leaveCharacter(i){
      clearTimeout(holdTimer);
      const c=chars[i];
      if(c)preselect(c);
    }
    function enterCharacter(i){
      const c=chars[i];if(!c)return;
      const selected=c.clips?.[1]||c.clips?.[0];
      if(selected){
        c.clip=selected;c.loop=false;c.startTime=performance.now();c.playing=true;c.setFrame?.(selected.start||0);
        const ms=Math.max(250,((selected.end-selected.start)/Math.max(1,selected.fps||30))*1000);
        holdTimer=setTimeout(()=>{if(hovered===i){c.playing=false;c.setFrame?.(Math.max(selected.start,selected.end-.01));}},ms+20);
      }
    }
    function pick(e){
      const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return -1;
      ndc.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(ndc,camera);
      let best=-1,dist=Infinity;
      for(let i=0;i<chars.length;i++){
        const c=chars[i];if(!c?.group)continue;
        const hit=ray.intersectObject(c.group,true)?.[0];
        if(hit&&hit.distance<dist){dist=hit.distance;best=i;}
      }
      return best;
    }
    const move=e=>{
      const i=pick(e);if(i===hovered)return;
      if(hovered>=0)leaveCharacter(hovered);
      hovered=i;lightIndex(i);
      if(i>=0)enterCharacter(i);
    };
    const leave=()=>{if(hovered>=0)leaveCharacter(hovered);hovered=-1;lightIndex(-1)};
    canvas.addEventListener('pointermove',move,{passive:true});
    canvas.addEventListener('pointerleave',leave,{passive:true});
    lightIndex(-1);
    return state;
  };
}
patchCharacterSelect();

// Show the client asset's original notice group once before the server list becomes usable.
let noticeShown=false,noticeBusy=false;
async function showServerNotice(){
  if(noticeShown||noticeBusy||!window.N3UI||!window.N3ExactUI)return;
  noticeBusy=true;
  try{
    const host=$('uiHost');if(!host)return;
    const rootUI=await N3UI.loadUI('UI_US/el_login_intro_us.uif');
    if(!N3UI.find(rootUI,'Group_Notice_1')){noticeShown=true;return;}
    const overlay=document.createElement('div');overlay.id='serverNoticeV27';
    const stage=document.createElement('div');stage.className='noticeStage';overlay.appendChild(stage);
    host.appendChild(overlay);
    await N3ExactUI.render(rootUI,stage,{subtree:'Group_Notice_1',native:false});
    const click=document.createElement('button');click.className='noticeClick';click.type='button';click.setAttribute('aria-label','Continue');overlay.appendChild(click);
    const done=()=>{noticeShown=true;overlay.remove();document.removeEventListener('keydown',key,true)};
    const key=e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();done();}};
    click.onclick=e=>{e.preventDefault();done()};document.addEventListener('keydown',key,true);
  }catch(e){console.warn('v27 original notice',e);noticeShown=true;}finally{noticeBusy=false;}
}
function looksLikeServerList(){
  const h=$('uiHost');if(!h)return false;
  return !!h.querySelector('[data-uiid="server_1" i],[data-uiid="list_server" i],[data-uiid="btn_connect" i]');
}
if(uiHost){
  const mo=new MutationObserver(()=>{if(!noticeShown&&!noticeBusy&&looksLikeServerList())setTimeout(showServerNotice,0)});
  mo.observe(uiHost,{childList:true,subtree:true});
}

// Memoize progressive meshes globally. The world loader otherwise reparsed the same 1298 PMesh
// after prewarm, which made the post-server black wait much longer than necessary.
function memoizeWorldData(){
  const D=window.OldERAData;if(!D?.pmesh||D.__v27Memo)return;
  D.__v27Memo=true;const base=D.pmesh.bind(D),cache=new Map();
  D.pmesh=(name,dir='Object')=>{const k=(dir+'/'+name).toLowerCase();if(!cache.has(k)){const p=Promise.resolve().then(()=>base(name,dir));cache.set(k,p);p.catch(()=>cache.delete(k));}return cache.get(k)};
  D.__v27PmeshCache=cache;
}
memoizeWorldData();

let warmStarted=false;
async function warmMoradon(){
  if(warmStarted)return;warmStarted=true;memoizeWorldData();
  const D=window.OldERAData;if(!D?.opd||!D?.pmesh)return;
  try{
    const opd=await D.opd(),objects=opd?.objects||[];
    const meshes=[...new Set(objects.flatMap(o=>(o.parts||[]).map(p=>p.mesh).filter(Boolean)))];
    const texs=[...new Set(objects.flatMap(o=>(o.parts||[]).map(p=>p.tex).filter(Boolean)))];
    // Network/decode begins while the user is still at login/server/character selection.
    await Promise.allSettled([
      D.pool?D.pool(meshes,5,m=>D.pmesh(m)):Promise.all(meshes.map(m=>D.pmesh(m))),
      window.N3UI?(D.pool?D.pool(texs,7,t=>N3UI.texCanvas('Object/'+t)):Promise.all(texs.map(t=>N3UI.texCanvas('Object/'+t)))):Promise.resolve()
    ]);
  }catch(e){console.warn('v27 Moradon prewarm',e)}
}
setTimeout(()=>warmMoradon(),450);

// Persistent original 1298 loading screen. It is mounted outside worldStageInner, so buildHud()
// cannot delete it at ~90% while inventory/state/skill assets are still preparing.
async function makeWorldLoading(nation){
  const old=$('worldLoadingV27');old?.remove();
  const overlay=document.createElement('div');overlay.id='worldLoadingV27';
  const stage=document.createElement('div');stage.className='v27stage';overlay.appendChild(stage);$('world')?.appendChild(overlay);
  let progressCtl=null,infoCtl=null;
  try{
    const file=nation===1?'UI_US/ka_loading_us.uif':'UI_US/el_loading_us.uif',r=await N3UI.loadUI(file),out=await N3ExactUI.render(r,stage,{native:false});
    progressCtl=new Map(out.controls).get('progress_loading')||null;
    infoCtl=new Map(out.controls).get('text_info')||null;
  }catch(e){
    stage.innerHTML='<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ddd;font:14px Tahoma">Loading...</div>';
  }
  let pct=document.createElement('div');pct.style.cssText='position:absolute;left:0;right:0;bottom:8%;text-align:center;color:#ddd;font:12px Tahoma;text-shadow:1px 1px #000;pointer-events:none';stage.appendChild(pct);
  return{
    overlay,
    update(p,msg){const n=Math.max(0,Math.min(100,Number(p||0)*100));progressCtl?.setProgress?.(n);if(infoCtl?.setText&&msg)infoCtl.setText(msg);pct.textContent=Math.round(n)+'%';},
    async done(){this.update(1,'Moradon ready');await new Promise(r=>setTimeout(r,120));overlay.classList.add('hide');setTimeout(()=>overlay.remove(),220)},
    error(e){pct.textContent='Loading error: '+(e?.message||e);pct.style.color='#ffb1a8';}
  };
}
function patchWorldStart(){
  if(!window.OldERAWorld?.start||OldERAWorld.__v27StartPatched)return;
  const base=OldERAWorld.start.bind(OldERAWorld);OldERAWorld.__v27StartPatched=true;
  OldERAWorld.start=async options=>{
    const nation=options?.nation||2,loader=await makeWorldLoading(nation),userProgress=options?.onProgress;
    try{
      const out=await base({...options,onProgress:(p,msg)=>{loader.update(p,msg);try{userProgress?.(p,msg)}catch{}}});
      await loader.done();return out;
    }catch(e){loader.error(e);throw e;}
  };
}
patchWorldStart();

// Capture the first live Moradon scene and populate original-client NPC/monster models afterwards,
// never blocking the first playable frame.
if(window.THREE&&!THREE.WebGLRenderer.prototype.__v27NpcHook){
  const proto=THREE.WebGLRenderer.prototype,render0=proto.render;proto.__v27NpcHook=true;
  let npcScene=null,npcStarted=false;
  proto.render=function(sc,cam){
    const out=render0.call(this,sc,cam);
    if(!npcStarted&&sc?.getObjectByName?.('MoradonTerrain1298')){
      npcScene=sc;npcStarted=true;setTimeout(()=>window.OldERANPCV25?.populate?.(npcScene).catch?.(e=>console.warn('v27 NPC population',e)),0);
    }
    return out;
  };
}

window.OldERAV27={fit,warmMoradon,showServerNotice};
})();