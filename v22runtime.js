(()=>{'use strict';
const root=document.documentElement;
const style=document.createElement('style');
style.textContent=`
#loading{display:none!important}
#stage{left:50%!important;top:50%!important;transform:translate(-50%,-50%) scale(var(--ko-ui-scale,1))!important;transform-origin:center center!important}
#worldStage{left:50%!important;top:50%!important;transform:translate(-50%,-50%) scale(var(--ko-ui-scale,1))!important;transform-origin:center center!important}
#scene3d canvas{image-rendering:auto!important}
#world,#world canvas{cursor:inherit}
`;
document.head.appendChild(style);
function fit1298(){const s=Math.max(.25,Math.min(innerWidth/1024,innerHeight/768));root.style.setProperty('--ko-ui-scale',String(s))}
addEventListener('resize',fit1298,{passive:true});fit1298();
// The removed v20 hotfix inverted the arrows and froze the selector actor.
// Keep the original selector direction and guarantee the first true idle/breath motion loops.
if(window.OldERACharScene?.select){
  const base=window.OldERACharScene.select.bind(window.OldERACharScene);
  window.OldERACharScene.select=async(...args)=>{
    const state=await base(...args);
    for(const c of state?.chars||[]){
      if(!c)continue;
      let idle=(c.clips||[]).find(x=>/breath|idle|wait|basic/i.test(String(x.name||'')));
      if(!idle)idle=c.clips?.[0];
      if(idle){if(!idle.name)idle.name='idle';c.playLoop(idle.start,idle.end,performance.now(),idle.fps||30)}
    }
    return state;
  };
}
function alignGameplayPanel(panel){
  if(!panel?.dataset?.kind)return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const nodes=[...panel.querySelectorAll('[data-uiid]')];let max=-Infinity;
    for(const n of nodes){const l=parseFloat(n.style.left),w=parseFloat(n.style.width);if(Number.isFinite(l)&&Number.isFinite(w)&&w>0&&w<1000)max=Math.max(max,l+w)}
    if(Number.isFinite(max)&&max>0&&max<1024)panel.style.translate=(1024-max)+'px 0px';
    // Do not invent server stats while the authoritative session layer is not connected.
    if(panel.dataset.kind==='character')for(const id of ['text_hp','text_mp','text_exp']){const e=panel.querySelector(`[data-uiid="${id}" i]`);if(e&&/100\s*\/\s*100|0\s*\/\s*100/.test(e.textContent||''))e.textContent='0 / 0'}
  }));
}
const stage=document.getElementById('worldStageInner');
if(stage){const mo=new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes){if(n.nodeType!==1)continue;if(n.matches?.('[data-kind]'))alignGameplayPanel(n);for(const p of n.querySelectorAll?.('[data-kind]')||[])alignGameplayPanel(p)}});mo.observe(stage,{childList:true,subtree:true})}
// Classic 1298 key map: T run/walk, R attack, C sit, I inventory, K skill, U state.
// Stop the temporary v22 aliases from turning R into run or C into character.
addEventListener('keydown',e=>{
  if(!document.getElementById('world')?.classList.contains('on')||e.repeat)return;
  const k=e.key.toLowerCase();
  if(k==='t'){
    const b=document.querySelector('#worldStageInner [data-uiid="btn_walk" i],#worldStageInner [data-uiid="btn_run" i],#worldStageInner [data-uiid="btn_control" i]');
    if(b){e.preventDefault();e.stopImmediatePropagation();b.click()}
  }else if(k==='r'||k==='c'){
    e.preventDefault();e.stopImmediatePropagation();
  }
},true);
async function prewarm1298(){
  if(!window.N3UI||!window.OldERAData)return;
  const ui=['UI/CursorEl01.DXT','UI/CursorKarus01.DXT','UI/CursorClick.DXT','UI_US/el_statebar_us.uif','UI_US/el_hotkey_us.uif','UI_US/el_msgoutput_us.uif','UI_US/el_chat_us.uif','UI_US/el_cmd_us.uif','UI_US/el_inventory_us.uif','UI_US/el_various_frame_us.uif','UI_US/el_page_state_us.uif','UI_US/El_SkillTree_us.uif','UI_US/ka_statebar_us.uif','UI_US/ka_hotkey_us.uif','UI_US/ka_msgoutput_us.uif','UI_US/ka_chat_us.uif','UI_US/ka_cmd_us.uif','UI_US/ka_inventory_us.uif','UI_US/ka_various_frame_us.uif','UI_US/ka_page_state_us.uif','UI_US/ka_skilltree_us.uif'];
  const jobs=ui.map(p=>/\.uif$/i.test(p)?N3UI.loadUI(p):N3UI.texCanvas(p));
  const gtd=OldERAData.gtd?.();
  if(gtd){jobs.push(gtd);jobs.push(gtd.then(g=>OldERAData.tctAtlas?.(g.n)).catch(()=>null))}
  if(OldERAData.opd)jobs.push(OldERAData.opd());
  if(window.OldERATable?.core)jobs.push(OldERATable.core());
  await Promise.allSettled(jobs.filter(Boolean));
}
const kick=()=>prewarm1298().catch(e=>console.warn('1298 prewarm',e));
if('requestIdleCallback'in window)requestIdleCallback(kick,{timeout:2500});else setTimeout(kick,600);
window.OldERAV22={fit1298,prewarm1298,alignGameplayPanel};
})();
