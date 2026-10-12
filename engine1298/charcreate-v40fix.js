(()=>{'use strict';
const cs=window.OldERACharScene;if(!cs||cs.__v40PreviewFix)return;cs.__v40PreviewFix=true;
const wrappedRenderer=window.THREE?.WebGLRenderer,wrappedCamera=window.THREE?.PerspectiveCamera;
const originalRenderer=wrappedRenderer?.prototype?.constructor||wrappedRenderer;
const originalCamera=wrappedCamera?.prototype?.constructor||wrappedCamera;
function wrap(name){const fn=cs[name]?.bind(cs);if(!fn)return;cs[name]=async function(...args){const curR=THREE.WebGLRenderer,curC=THREE.PerspectiveCamera;try{THREE.WebGLRenderer=originalRenderer;THREE.PerspectiveCamera=originalCamera;return await fn(...args)}finally{THREE.WebGLRenderer=curR;THREE.PerspectiveCamera=curC}}}
wrap('preview');wrap('select');
function armCreate(){const game=document.getElementById('game');if(!game?.classList.contains('on'))return;document.querySelectorAll('#uiHost [data-uiid]').forEach(el=>{const id=String(el.dataset.uiid||'').toLowerCase();if(/^btn_(race_|class_|create|cancel|back|exit|face_|hair_|str_|sta_|dex_|int_|map_)/.test(id)){el.style.pointerEvents='auto';el.style.zIndex='9500'}})}
new MutationObserver(armCreate).observe(document.documentElement,{subtree:true,childList:true});setInterval(armCreate,250);
console.info('[OldERA] v40 character preview/input hotfix active');
})();
