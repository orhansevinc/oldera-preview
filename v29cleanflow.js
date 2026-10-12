(()=>{'use strict';
/* v30: no custom interstitials, and no attribute observer loop. */
const css=document.createElement('style');
css.textContent=`
#loading,#loading.on{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}
#serverNoticeV27{display:none!important;visibility:hidden!important;pointer-events:none!important}
`;
document.head.appendChild(css);
function purgeNotice(){
  const n=document.getElementById('serverNoticeV27');
  if(n)n.remove();
}
purgeNotice();
/* Watch only for newly-created notice nodes. Never observe class/style changes: the old
   observer rewrote #loading while watching those same attributes and could lock Chrome. */
new MutationObserver(ms=>{
  for(const m of ms){
    for(const n of m.addedNodes){
      if(n.nodeType!==1)continue;
      if(n.id==='serverNoticeV27')n.remove();
      else n.querySelector?.('#serverNoticeV27')?.remove();
    }
  }
}).observe(document.documentElement,{childList:true,subtree:true});
window.OldERAV29CleanFlow={purge:purgeNotice};
})();
