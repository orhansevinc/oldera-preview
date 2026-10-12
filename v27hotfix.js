(()=>{'use strict';
/* v31: no preload, no polling loop. Only clear the old hard-coded create-name value. */
function clearName(root=document){for(const i of root.querySelectorAll?.('#uiHost input[data-uiid="edit_name" i],input[data-uiid="edit_name" i]')||[])if(/^osevinc$/i.test(String(i.value||'').trim()))i.value=''}
const h=document.getElementById('uiHost');
if(h)new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1)clearName(n)}).observe(h,{childList:true,subtree:true});
})();
