(()=>{'use strict';
const $=id=>document.getElementById(id),root=document.documentElement,host=$('uiHost');
const style=document.createElement('style');
style.textContent=`
#loading,#loading.on{display:none!important;visibility:hidden!important;pointer-events:none!important}
#stage{left:50%!important;top:50%!important;transform:translate(-50%,-50%) scale(var(--ko-v33-sx,1),var(--ko-v33-sy,1))!important;transform-origin:center center!important}
#scene3d canvas{width:1024px!important;height:768px!important;image-rendering:auto!important}
#worldStage{left:50%!important;top:50%!important;transform:translate(-50%,-50%) scale(var(--ko-v33-sx,1),var(--ko-v33-sy,1))!important;transform-origin:center center!important}
`;
document.head.appendChild(style);
function fit(){root.style.setProperty('--ko-v33-sx',String(Math.max(.25,innerWidth/1024)));root.style.setProperty('--ko-v33-sy',String(Math.max(.25,innerHeight/768)))}
addEventListener('resize',fit,{passive:true});fit();

let loginConfiguredFor=null;
function configureLogin(){
  const id=host?.querySelector('input[data-uiid="Edit_ID" i]'),pw=host?.querySelector('input[data-uiid="Edit_PW" i]');
  if(!id||!pw)return;
  const token=id.parentElement||id;
  if(loginConfiguredFor===token)return;
  loginConfiguredFor=token;
  id.tabIndex=1;pw.tabIndex=2;id.autocomplete='off';pw.autocomplete='off';
  // clientflow historically writes the account into both fields. Clear after that synchronous render finishes.
  queueMicrotask(()=>{if(id.isConnected){id.value='';pw.value='';id.focus()}});
  setTimeout(()=>{if(id.isConnected&&document.activeElement!==pw){id.value='';pw.value=''}},0);
  id.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();pw.focus()}},true);
  // Do NOT add another Enter handler to password. clientflow already owns password -> Login.
}
let serverVisibleAt=0,serverArmed=true;
function detectServer(){
  const server=host?.querySelector('[data-uiid="server_1" i],[data-uiid="List_Server" i],[data-uiid="btn_connect" i]');
  if(server&&server.offsetParent!==null){
    if(!serverVisibleAt){serverVisibleAt=performance.now();serverArmed=false;setTimeout(()=>{serverArmed=true},300)}
  }else{serverVisibleAt=0;serverArmed=true}
}
if(host)new MutationObserver(()=>{configureLogin();detectServer()}).observe(host,{childList:true,subtree:true});
setTimeout(configureLogin,0);
// A login Enter must never be re-used as a server Connect Enter.
addEventListener('keydown',e=>{if(e.key==='Enter'&&serverVisibleAt&&!serverArmed){e.preventDefault();e.stopImmediatePropagation()}},true);
addEventListener('keyup',e=>{if(e.key==='Enter'&&serverVisibleAt)serverArmed=true},true);

function patchSelect(){
  if(!window.OldERACharScene?.select||OldERACharScene.__v33Frame)return;
  const base=OldERACharScene.select.bind(OldERACharScene);OldERACharScene.__v33Frame=true;
  OldERACharScene.select=async(...args)=>{
    const s=await base(...args);if(!s?.camera||!s?.renderer)return s;
    const refit=()=>{s.camera.aspect=4/3;s.camera.updateProjectionMatrix?.();s.renderer.setPixelRatio?.(Math.min(3,Math.max(devicePixelRatio||1,innerWidth/1024,innerHeight/768)));s.renderer.setSize?.(1024,768,false)};
    refit();addEventListener('resize',()=>requestAnimationFrame(refit),{passive:true});return s;
  };
}
patchSelect();
window.OldERAV33={fit,configureLogin,detectServer};
})();