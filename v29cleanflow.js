(()=>{'use strict';
const css=document.createElement('style');
css.textContent=`
/* v29: no custom interstitials. Login -> server -> character select directly. */
#loading,#loading.on{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}
#serverNoticeV27{display:none!important;visibility:hidden!important;pointer-events:none!important}
`;
document.head.appendChild(css);
function purge(){
  const n=document.getElementById('serverNoticeV27');
  if(n)n.remove();
  const l=document.getElementById('loading');
  if(l){l.classList.remove('on');l.style.display='none';l.style.visibility='hidden';l.style.pointerEvents='none';l.textContent='';}
}
purge();
new MutationObserver(()=>purge()).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
// One more pass after the login/server scripts have had a chance to build their UI.
queueMicrotask(purge);setTimeout(purge,0);setTimeout(purge,150);setTimeout(purge,700);
window.OldERAV29CleanFlow={purge};
})();
