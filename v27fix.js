(()=>{'use strict';
const $=id=>document.getElementById(id);
const root=document.documentElement;

/* v31: this file is intentionally lightweight. It must never preload Moradon or create
   login/server interstitials. Its only jobs are fullscreen selector presentation and
   authentic character-select focus animation. */
const css=document.createElement('style');
css.textContent=`
#game{overflow:hidden!important;background:#000!important}
#stage{left:50%!important;top:50%!important;transform:translate(-50%,-50%) scale(var(--ko-v31-sx,1),var(--ko-v31-sy,1))!important;transform-origin:center center!important}
#scene3d canvas{image-rendering:auto!important;backface-visibility:hidden}
#scene3d.v31-select-dark:after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 180px 55px rgba(0,0,0,.48);z-index:5}
`;
document.head.appendChild(css);
function fit(){
  root.style.setProperty('--ko-v31-sx',String(Math.max(.25,innerWidth/1024)));
  root.style.setProperty('--ko-v31-sy',String(Math.max(.25,innerHeight/768)));
}
addEventListener('resize',fit,{passive:true});fit();

function clearForcedName(node=document){
  const inputs=node.querySelectorAll?.('input[data-uiid="edit_name" i]')||[];
  for(const i of inputs){if(/^osevinc$/i.test(String(i.value||'').trim()))i.value='';i.autocomplete='off';}
}
const uiHost=$('uiHost');
if(uiHost)new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1)clearForcedName(n)}).observe(uiHost,{childList:true,subtree:true});

function patchCharacterSelect(){
  if(!window.OldERACharScene?.select||OldERACharScene.__v31SelectPatched)return;
  const base=OldERACharScene.select.bind(window.OldERACharScene);
  OldERACharScene.__v31SelectPatched=true;
  OldERACharScene.select=async(...args)=>{
    const state=await base(...args);
    if(!state?.scene||!state?.renderer||!state?.camera)return state;
    const canvas=state.renderer.domElement,scene=state.scene,camera=state.camera,chars=state.chars||[],sceneHost=canvas.parentElement;
    sceneHost?.classList.add('v31-select-dark');
    const refit=()=>{
      camera.aspect=Math.max(.2,innerWidth/Math.max(1,innerHeight));camera.updateProjectionMatrix?.();
      state.renderer.setPixelRatio?.(Math.min(3,Math.max(devicePixelRatio||1,innerWidth/1024,innerHeight/768)));
      state.renderer.setSize?.(1024,768,false);
    };
    refit();
    if(canvas.__olderaRefit)removeEventListener('resize',canvas.__olderaRefit);
    canvas.__olderaRefit=refit;addEventListener('resize',refit,{passive:true});

    scene.traverse(o=>{if(!o?.isMesh||o.geometry?.userData?.src)return;const ms=Array.isArray(o.material)?o.material:[o.material];for(const m of ms){if(m?.color&&!m.userData?.v31Darkened){m.userData.v31Darkened=true;m.color.multiplyScalar(.27);m.needsUpdate=true;}}});
    const ambients=scene.children.filter(x=>x?.isAmbientLight),spots=scene.children.filter(x=>x?.isSpotLight);
    ambients.forEach(l=>l.intensity=.075);spots.forEach(l=>l.intensity=.04);
    const preselect=c=>{const a=c?.clips?.[0];if(a)c.playLoop?.(a.start,a.end,performance.now(),a.fps||30)};
    chars.forEach(preselect);

    let hovered=-1,holdTimer=0;const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
    const lightIndex=i=>{ambients.forEach(l=>l.intensity=i<0?.075:.105);spots.forEach((l,j)=>l.intensity=i===j?2.35:.025)};
    function leaveCharacter(i){clearTimeout(holdTimer);preselect(chars[i])}
    function enterCharacter(i){const c=chars[i];if(!c)return;const selected=c.clips?.[1]||c.clips?.[0];if(!selected)return;c.clip=selected;c.loop=false;c.startTime=performance.now();c.playing=true;c.setFrame?.(selected.start||0);const ms=Math.max(250,((selected.end-selected.start)/Math.max(1,selected.fps||30))*1000);holdTimer=setTimeout(()=>{if(hovered===i){c.playing=false;c.setFrame?.(Math.max(selected.start,selected.end-.01));}},ms+20)}
    function pick(e){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return-1;ndc.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(ndc,camera);let best=-1,dist=Infinity;for(let i=0;i<chars.length;i++){const c=chars[i];if(!c?.group)continue;const hit=ray.intersectObject(c.group,true)?.[0];if(hit&&hit.distance<dist){dist=hit.distance;best=i;}}return best}
    const move=e=>{const i=pick(e);if(i===hovered)return;if(hovered>=0)leaveCharacter(hovered);hovered=i;lightIndex(i);if(i>=0)enterCharacter(i)};
    const leave=()=>{if(hovered>=0)leaveCharacter(hovered);hovered=-1;lightIndex(-1)};
    canvas.addEventListener('pointermove',move,{passive:true});canvas.addEventListener('pointerleave',leave,{passive:true});lightIndex(-1);
    return state;
  };
}
patchCharacterSelect();

/* Absolutely no setTimeout/idle callback that touches GTD/TCT/OPD/PMesh/TBL/NPC here. */
window.OldERAV31={fit};
})();
