(()=>{'use strict';
const host=document.getElementById('uiHost');
let enterDown=false,serverVisible=false,serverReady=false,serverEpoch=0;
function findServer(){if(!host)return null;return host.querySelector('[data-uiid="server_1" i],[data-uiid="List_Server" i],[data-uiid="btn_connect" i]')}
function refreshServer(){const n=findServer(),vis=!!(n&&n.offsetParent!==null);if(vis&&!serverVisible){serverVisible=true;serverEpoch=performance.now();serverReady=!enterDown;const btn=host.querySelector('button[data-uiid="btn_connect" i]');if(btn&&enterDown)btn.disabled=true;}else if(!vis&&serverVisible){serverVisible=false;serverReady=false}}
addEventListener('keydown',e=>{if(e.key!=='Enter')return;const wasDown=enterDown;enterDown=true;refreshServer();if(serverVisible&&(!serverReady||wasDown||performance.now()-serverEpoch<80)){e.preventDefault();e.stopImmediatePropagation()}},true);
addEventListener('keyup',e=>{if(e.key!=='Enter')return;enterDown=false;refreshServer();if(serverVisible){serverReady=true;const btn=host?.querySelector('button[data-uiid="btn_connect" i]');if(btn)btn.disabled=false}},true);
if(host)new MutationObserver(()=>queueMicrotask(refreshServer)).observe(host,{childList:true,subtree:true});

// Login fields are always user-entered. Preserve normal Tab order and never autofill.
function loginFields(){const id=host?.querySelector('input[data-uiid="Edit_ID" i]'),pw=host?.querySelector('input[data-uiid="Edit_PW" i]');if(!id||!pw||id.dataset.v34==='1')return;id.dataset.v34=pw.dataset.v34='1';id.tabIndex=1;pw.tabIndex=2;id.autocomplete='off';pw.autocomplete='off';queueMicrotask(()=>{if(id.isConnected){id.value='';pw.value='';id.focus()}})}
if(host)new MutationObserver(loginFields).observe(host,{childList:true,subtree:true});loginFields();
window.OldERAV34Flow={refreshServer,get serverVisible(){return serverVisible},get serverReady(){return serverReady}};
})();
