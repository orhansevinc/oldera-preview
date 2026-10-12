(()=>{'use strict';
const style=document.createElement('style');style.textContent=`
#loading.on{display:flex!important;background:rgba(0,0,0,.96)!important;color:#e7dfc9!important;z-index:210000!important}
`;
document.head.appendChild(style);
function clearName(){for(const i of document.querySelectorAll('#uiHost input[data-uiid="edit_name" i]'))if(/^osevinc$/i.test(String(i.value||'').trim()))i.value=''}
const h=document.getElementById('uiHost');if(h)new MutationObserver(()=>{setTimeout(clearName,0);setTimeout(clearName,80)}).observe(h,{childList:true,subtree:true});
setInterval(()=>{if(document.getElementById('game')?.classList.contains('on'))clearName()},500);
// Warm only lightweight selector resources; actual selection remains authoritative and is not faked.
setTimeout(()=>{const D=window.OldERAData;if(!D?.ab)return;Promise.allSettled(['ChrSelect/el_chairs.n3shape','ChrSelect/ka_chairs.n3shape','ChrSelect/upc_el_rm_wa.n3joint','ChrSelect/upc_el_rm_wa.n3anim','ChrSelect/upc_ka_at_wa.n3joint','ChrSelect/upc_ka_at_wa.n3anim'].map(p=>D.ab(p))).catch(()=>{})},250);
})();