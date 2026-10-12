(()=>{'use strict';
function fillScreens(){
  const stage=document.getElementById('stage'),ws=document.getElementById('worldStage');
  if(stage){stage.style.width='1024px';stage.style.height='768px';stage.style.left='50%';stage.style.top='50%';stage.style.transformOrigin='center center';const sx=innerWidth/1024,sy=innerHeight/768;stage.style.transform=`translate(-50%,-50%) scale(${sx},${sy})`;}
  if(ws){ws.style.width='1024px';ws.style.height='768px';ws.style.left='50%';ws.style.top='50%';ws.style.transformOrigin='center center';const sx=innerWidth/1024,sy=innerHeight/768;ws.style.transform=`translate(-50%,-50%) scale(${sx},${sy})`;}
}
addEventListener('resize',fillScreens);fillScreens();
const css=document.createElement('style');css.textContent=`#game,#world{width:100vw!important;height:100vh!important;overflow:hidden!important}#canvasWrap,#canvasWrap canvas{width:100vw!important;height:100vh!important;display:block!important}#worldLoader{background:#000!important}.worldLoader h2,.worldLoader>.wbar,.worldLoader>p{display:none!important}`;document.head.appendChild(css);
function patchCharScene(){
  const api=window.OldERACharScene;if(!api||api.__v20patched)return false;api.__v20patched=true;
  const originalSelect=api.select.bind(api);
  api.select=async function(host,opts){
    const state=await originalSelect(host,opts);
    if(!state)return state;
    if(typeof state.rotate==='function'&&!state.__v20rotate){const r=state.rotate.bind(state);state.rotate=d=>r(-d);state.__v20rotate=true;}
    for(const c of state.chars||[]){if(!c)continue;const idle=(c.clips||[]).find(x=>/breath|idle/i.test(String(x.name||'')))||(c.clips||[])[0];if(idle){c.playing=false;c.loop=false;c.setFrame((Number(idle.start)||0)+Math.max(0,((Number(idle.end)||0)-(Number(idle.start)||0))*.5));}}
    return state;
  };
  return true;
}
if(!patchCharScene()){let n=0,t=setInterval(()=>{if(patchCharScene()||++n>100)clearInterval(t)},25)}
})();