(()=>{'use strict';
const host=document.getElementById('uiHost');
let enterHeld=false;
function ctl(id){return host?.querySelector(`[data-uiid="${id}" i]`)||null}
function configureLogin(){const id=ctl('Edit_ID'),pw=ctl('Edit_PW');if(!id||!pw)return;id.tabIndex=1;pw.tabIndex=2;id.autocomplete='off';pw.autocomplete='off';if(id.dataset.v35!=='1'){id.dataset.v35=pw.dataset.v35='1';queueMicrotask(()=>{if(id.isConnected){id.value='';pw.value='';id.focus()}})}}
addEventListener('keydown',e=>{if(e.key!=='Enter')return;const pw=ctl('Edit_PW');if(pw&&e.target===pw){enterHeld=true;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();const ok=ctl('btn_ok');if(ok&&!ok.disabled)ok.click();return}if(enterHeld||e.repeat){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation()}},true);
addEventListener('keyup',e=>{if(e.key==='Enter')enterHeld=false},true);
if(host)new MutationObserver(configureLogin).observe(host,{childList:true,subtree:true});configureLogin();
window.OldERAV35Flow={configureLogin,get enterHeld(){return enterHeld}};
})();
