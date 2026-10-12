(()=>{'use strict';
const $=id=>document.getElementById(id);
const css=document.createElement('style');css.textContent=`
/* final v26 input policy: transparent HUD wrappers never block Moradon; real controls remain clickable */
#worldStageInner>[data-ko-hud],#worldStageInner>[data-kind]{pointer-events:none!important}
#worldStageInner>[data-ko-hud] div[data-uiid],#worldStageInner>[data-ko-hud] canvas[data-uiid]{pointer-events:none!important}
#worldStageInner button[data-uiid],#worldStageInner input[data-uiid]{pointer-events:auto!important}
#worldStageInner>[data-kind]{translate:0 0!important}
#canvasWrap,#canvasWrap canvas{pointer-events:auto!important}
#loading{display:none!important}
`;
document.head.appendChild(css);
function scale(){return{sx:Math.max(.25,innerWidth/1024),sy:Math.max(.25,innerHeight/768)}}
function visibleRect(el){if(!el||el.offsetParent===null)return null;const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return null;return r}
function localBounds(layer){const lr=visibleRect(layer);if(!lr)return null;const {sx,sy}=scale();let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity,n=0;for(const e of layer.querySelectorAll('[data-uiid]')){if(e===layer||getComputedStyle(e).display==='none')continue;const cr=visibleRect(e);if(!cr)continue;const w=cr.width/sx,h=cr.height/sy;if(w>=1020&&h>=760)continue;const x=(cr.left-lr.left)/sx,y=(cr.top-lr.top)/sy;l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+w);b=Math.max(b,y+h);n++}return n?{l,t,r,b,w:r-l,h:b-t}:null}
function place(layer,x,y){const bb=localBounds(layer);if(!bb)return false;layer.style.transform=`translate(${Math.round(x-bb.l)}px,${Math.round(y-bb.t)}px)`;layer.style.transformOrigin='0 0';return true}
function hide(id){const h=$('worldStageInner');if(!h)return;for(const e of h.querySelectorAll('[data-uiid]'))if(String(e.dataset.uiid||'').toLowerCase()===id.toLowerCase())e.style.display='none'}
function layout(){const h=$('worldStageInner');if(!h)return;hide('Group_MiniMap');hide('Progress_HP_lasting');hide('Progress_HP_drop');hide('Progress_HP_slow');const layers=[...h.children].filter(e=>!e.dataset.kind);if(layers.length>=5){const [state,hot,msg,chat,cmd]=layers;for(const e of layers.slice(0,5))e.dataset.koHud='1';const sb=localBounds(state);if(sb)place(state,0,0);const hb=localBounds(hot);if(hb)place(hot,0,Math.max(90,(sb?.h||84)+4));const db=localBounds(cmd);if(db){const cmdY=768-db.h,cmdX=Math.max(0,(1024-db.w)/2);place(cmd,cmdX,cmdY);const cb=localBounds(chat);if(cb){const chatY=cmdY-cb.h-1;place(chat,Math.max(0,(1024-cb.w)/2),chatY);const mb=localBounds(msg);if(mb)place(msg,Math.max(0,(1024-mb.w)/2),chatY-mb.h-1)}}}
  for(const p of h.querySelectorAll(':scope>[data-kind]')){if(getComputedStyle(p).display==='none')continue;const bb=localBounds(p);if(!bb)continue;place(p,Math.max(4,1024-bb.w-8),8);p.dataset.koPlaced='v26'}
}
let timer=0;function queue(){clearTimeout(timer);timer=setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(layout)),80)}
const h=$('worldStageInner');if(h){new MutationObserver(queue).observe(h,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});queue()}
addEventListener('resize',queue,{passive:true});setTimeout(queue,350);setTimeout(queue,1200);setTimeout(queue,3000);
window.OldERAV26={layout,queue};
})();