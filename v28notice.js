(()=>{'use strict';
const $=id=>document.getElementById(id);
const css=document.createElement('style');
css.textContent=`
#serverNoticeV27{background:transparent!important;overflow:hidden!important}
#serverNoticeV27 .v28backdrop{position:absolute;inset:0;z-index:-3;pointer-events:none;background:#000}
#serverNoticeV27 .v28shade{position:absolute;inset:0;z-index:-2;pointer-events:none;background:rgba(0,0,0,.16)}
#serverNoticeV27 .noticeStage{z-index:2!important}
#serverNoticeV27 .noticeClick{display:none!important;pointer-events:none!important}
#serverNoticeV27 .v28copy{position:absolute;z-index:9000;left:50%;top:44.2%;width:440px;transform:translate(-50%,-50%);pointer-events:none;text-align:center;font-family:Tahoma,Arial,sans-serif;color:#eee7ce;text-shadow:1px 1px 2px #000;font-size:15px;line-height:1.28}
#serverNoticeV27 .v28copy b{display:block;margin-bottom:8px;color:#fff36d;font-size:20px;line-height:1.05}
#serverNoticeV27 .v28ok{position:absolute;z-index:20000;left:50%;top:61.6%;width:280px;height:46px;transform:translate(-50%,-50%);border:0;background:transparent;cursor:pointer;pointer-events:auto;color:transparent}
`;
document.head.appendChild(css);
let lastBackdropHTML='';
const sceneBg=$('sceneBg');
function rememberBackdrop(){
  if(sceneBg&&sceneBg.children.length) lastBackdropHTML=sceneBg.innerHTML;
}
if(sceneBg)new MutationObserver(rememberBackdrop).observe(sceneBg,{childList:true,subtree:true});
rememberBackdrop();
function filteredLoginRoot(root){
  const hidden=new Set(['group_login','group_serverlist','group_serverlist_01','group_notice_1','group_notice_2','group_notice_3','premium']);
  function clone(n){
    const id=String(n?.id||'').toLowerCase(),tex=String(n?.tex||'').replace(/\\/g,'/').toLowerCase();
    if(id&&hidden.has(id))return null;
    if(n?.type===4&&tex.endsWith('ui_login_02_us.dxt'))return null;
    const x={...n,children:[]};
    for(const c of n?.children||[]){const cc=clone(c);if(cc)x.children.push(cc)}
    return x;
  }
  return clone(root);
}
async function buildBackdrop(overlay){
  if(!overlay||overlay.querySelector('.v28backdrop'))return;
  const back=document.createElement('div');back.className='v28backdrop';overlay.prepend(back);
  if(sceneBg?.children.length){
    // Keep the already-rendered login/server backdrop visible beneath the notice whenever possible.
    overlay.style.background='transparent';
    return;
  }
  try{
    const root=await N3UI.loadUI('UI_US/el_login_intro_us.uif');
    if(!overlay.isConnected)return;
    await N3ExactUI.render(filteredLoginRoot(root),back,{native:true});
  }catch(e){console.warn('v28 notice backdrop',e)}
}
function dismiss(overlay){
  if(!overlay||!overlay.isConnected)return;
  overlay.remove();
  const host=$('uiHost');
  if(host)host.style.pointerEvents='none';
  // Server list was already rendered by the normal 1298 flow underneath this modal.
  requestAnimationFrame(()=>{
    for(const e of document.querySelectorAll('#uiHost [data-uiid]')){
      const id=String(e.dataset.uiid||'').toLowerCase();
      if(id.includes('server')||id.includes('connect')) e.style.pointerEvents='auto';
    }
  });
}
function patchNotice(overlay){
  if(!overlay||overlay.dataset.v28==='1')return;
  overlay.dataset.v28='1';
  overlay.style.background='transparent';
  buildBackdrop(overlay);
  if(!overlay.querySelector('.v28shade')){const shade=document.createElement('div');shade.className='v28shade';overlay.prepend(shade)}
  const copy=document.createElement('div');copy.className='v28copy';copy.innerHTML='<b>OldERA efsanesine hoş geldiniz.</b>OldERA şu anda geliştirme aşamasındadır.<br>Oyun dünyası, arayüzler ve sistemler orijinal 1298 deneyimine sadık kalınarak adım adım tamamlanıyor.<br><br>Test sürecinde eksikler ve değişiklikler görebilirsiniz. Geliştirmeler devam ediyor.';overlay.appendChild(copy);
  const ok=document.createElement('button');ok.type='button';ok.className='v28ok';ok.setAttribute('aria-label','OK');ok.onclick=e=>{e.preventDefault();e.stopPropagation();dismiss(overlay)};overlay.appendChild(ok);
  overlay.addEventListener('click',e=>{
    const id=String(e.target?.dataset?.uiid||'').toLowerCase();
    if(id.includes('ok')||e.target===ok){e.preventDefault();e.stopPropagation();dismiss(overlay)}
  },true);
}
function scan(){const o=$('serverNoticeV27');if(o)patchNotice(o)}
new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
scan();
addEventListener('keydown',e=>{
  const o=$('serverNoticeV27');if(!o)return;
  if(e.key==='Enter'||e.key==='Escape'||e.code==='NumpadEnter'){
    e.preventDefault();e.stopImmediatePropagation();dismiss(o);
  }
},true);
window.OldERAV28Notice={dismiss:()=>dismiss($('serverNoticeV27')),scan};
})();