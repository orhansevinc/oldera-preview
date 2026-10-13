(()=>{
  'use strict';
  if(!window.OldERAOwnerBridge)return;

  const bridge=new window.OldERAOwnerBridge({mode:'demo'});
  let root=null,badge=null,visible=false;

  function addStyle(){
    if(document.getElementById('olderaOwnerStyle'))return;
    const s=document.createElement('style');
    s.id='olderaOwnerStyle';
    s.textContent='#olderaOwnerBadge{position:fixed;right:18px;top:18px;z-index:30000;border:1px solid #8f713e;background:rgba(10,11,13,.94);color:#d9b66f;font:700 10px Tahoma,Arial;padding:8px 11px;cursor:pointer;letter-spacing:.08em}#olderaOwnerPanel{position:fixed;right:18px;top:56px;z-index:30001;width:340px;background:rgba(8,10,12,.98);border:1px solid #544328;box-shadow:0 25px 70px #000;color:#ddd;font:11px Tahoma,Arial;display:none}#olderaOwnerPanel.on{display:block}.oeh{padding:12px 14px;border-bottom:1px solid #282d32;background:linear-gradient(90deg,#1d160c,#0d1013);display:flex;justify-content:space-between}.oeh strong{color:#e1bd76}.oeb{padding:12px}.oer{display:flex;gap:7px;margin-bottom:8px}.oer input,.oer textarea{width:100%;border:1px solid #343b42;background:#090c0f;color:#eee;padding:8px;outline:none;font:11px Tahoma,Arial}.oer textarea{height:56px;resize:none}.oea{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.oea button,.oeg button{border:1px solid #41484f;background:#12161a;color:#c4c7ca;padding:8px 4px;font:700 9px Tahoma;cursor:pointer}.oea button:hover,.oeg button:hover{border-color:#8b6c39;color:#e0bd76}.oes{height:1px;background:#22272c;margin:10px 0}.oeg{display:grid;grid-template-columns:1fr 1fr;gap:6px}.oest{margin-top:9px;border:1px solid #252b31;background:#0a0d10;padding:8px;color:#717980;font-size:9px;line-height:1.5}.oest b{color:#6eaf75}.oef{padding:8px 12px;border-top:1px solid #24292e;color:#5d646a;font-size:8px;display:flex;justify-content:space-between}';
    document.head.appendChild(s);
  }

  function build(){
    if(root)return;
    addStyle();
    badge=document.createElement('button');badge.id='olderaOwnerBadge';badge.textContent='● ROOT OWNER · F10';
    root=document.createElement('div');root.id='olderaOwnerPanel';
    root.innerHTML='<div class="oeh"><strong>OldERA OWNER CONTROL</strong><span>1298 ADMIN</span></div><div class="oeb"><div class="oer"><input id="oeOwnerTarget" placeholder="Target character"></div><div class="oea"><button data-c="VIEW">VIEW</button><button data-c="SUMMONUSER">SUMMON</button><button data-c="ARREST">ARREST</button><button data-c="FORBIDCHAT">MUTE</button><button data-c="PERMITCHAT">UNMUTE</button><button data-c="CUTOFF">CUTOFF</button></div><div class="oes"></div><div class="oer"><textarea id="oeOwnerNotice" placeholder="Global notice"></textarea></div><div class="oeg"><button data-g="NOTICEALL">NOTICE ALL</button><button data-g="INVISIBLE">INVISIBLE</button><button data-g="COUNT">ONLINE COUNT</button><button data-g="TIME">WORLD TIME</button></div><div class="oest" id="oeOwnerStatus"><b>OWNER READY</b><br>Same command contract as Control Center.</div></div><div class="oef"><span id="oeOwnerActor">—</span><span>SERVER AUTHORITY</span></div>';
    document.body.appendChild(badge);document.body.appendChild(root);
    badge.addEventListener('click',toggle);
    root.querySelectorAll('[data-c]').forEach(b=>b.addEventListener('click',()=>run(b.dataset.c,true)));
    root.querySelectorAll('[data-g]').forEach(b=>b.addEventListener('click',()=>run(b.dataset.g,false)));
  }

  function destroy(){badge?.remove();root?.remove();badge=null;root=null;visible=false}
  function toggle(){if(!bridge.enabled)return;visible=!visible;root?.classList.toggle('on',visible)}
  function status(title,text,ok=true){const el=document.getElementById('oeOwnerStatus');if(el)el.innerHTML='<b style="color:'+(ok?'#6eaf75':'#c87870')+'">'+title+'</b><br>'+text}

  async function run(command,needsTarget){
    const target=document.getElementById('oeOwnerTarget')?.value.trim()||'';
    const arg=command==='NOTICEALL'?(document.getElementById('oeOwnerNotice')?.value.trim()||''):'';
    if(needsTarget&&!target){status('TARGET REQUIRED','Enter or select a character first.',false);return}
    try{if(target)bridge.setSelectedTarget(target);const r=await bridge.execute(command,{target,arg,reason:'In-game ROOT OWNER action'});status(command+' READY',r.demo?'Preview command prepared; server adapter is not live yet.':'Command executed.')}catch(e){status('COMMAND FAILED',e.message,false)}
  }

  window.OldERAOwnerOverlay={
    setSession(session){
      const enabled=bridge.setSession(session);
      if(enabled){build();const actor=document.getElementById('oeOwnerActor');if(actor)actor.textContent=session.character||session.account||'ROOT OWNER'}else destroy();
      return enabled;
    },
    setTarget(name){if(!bridge.enabled)return false;build();bridge.setSelectedTarget(name);const input=document.getElementById('oeOwnerTarget');if(input)input.value=name||'';return true},
    setLive(value=true){return bridge.setMode(value?'live':'demo')},
    open(){if(bridge.enabled){build();visible=true;root.classList.add('on')}},
    close(){visible=false;root?.classList.remove('on')},
    bridge
  };

  addEventListener('oldera-owner-authority',e=>window.OldERAOwnerOverlay.setSession(e.detail||{}));
  addEventListener('keydown',e=>{if(e.key==='F10'&&bridge.enabled){e.preventDefault();build();toggle()}});
})();
