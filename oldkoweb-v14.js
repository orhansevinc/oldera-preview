(()=>{
  const config = window.OLDKOWEB_CONFIG || {};
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const nationName = (value) => value === 'karus' || Number(value) === 1 ? 'Karus' : value === 'el_morad' || Number(value) === 2 ? 'El Morad' : '—';
  const toast = $('#toast');
  let toastTimer;
  function say(text){ if(!toast) return; toast.textContent=text; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>toast.classList.remove('show'),2600); }
  async function getJson(url){
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),7000);
    try{ const res=await fetch(url,{headers:{accept:'application/json'},cache:'no-store',signal:controller.signal}); if(!res.ok) throw new Error(`HTTP ${res.status}`); return await res.json(); }
    finally{clearTimeout(timer)}
  }

  $$('.play-link').forEach((a)=>a.href=config.playUrl || 'https://play.oldkoweb.com/');

  const countdown=$('.countdown');
  if(!config.showCountdown || !config.openingAt){ if(countdown) countdown.hidden=true; }
  else {
    const target=Date.parse(config.openingAt); const dateEl=$('#openingDate');
    if(!Number.isFinite(target)){ if(countdown) countdown.hidden=true; }
    else {
      if(countdown) countdown.hidden=false;
      if(dateEl) dateEl.textContent=new Intl.DateTimeFormat('tr-TR',{dateStyle:'long',timeZone:'Europe/Istanbul'}).format(new Date(target));
      const pad=(n)=>String(Math.max(0,n)).padStart(2,'0');
      const tick=()=>{ let q=Math.max(0,target-Date.now()); const d=Math.floor(q/86400000); q%=86400000; const h=Math.floor(q/3600000); q%=3600000; const m=Math.floor(q/60000); const s=Math.floor((q%60000)/1000); for(const [id,v] of [['d',d],['h',h],['m',m],['s',s]]){const el=$(`#${id}`); if(el) el.textContent=pad(v);} };
      tick(); setInterval(tick,1000);
    }
  }

  const rankRoutes={level:'/v1/rankings/levels?page=1&pageSize=5',np:'/v1/rankings/national-points?page=1&pageSize=5',clan:'/v1/rankings/clans?page=1&pageSize=5'};
  const rankBody=$('#rankBody');
  const rankState=$('#rankState');
  function renderRank(kind,items){
    if(!rankBody) return;
    rankBody.innerHTML='';
    if(!items?.length){ rankBody.innerHTML='<tr><td colspan="5" class="placeholder">Henüz sıralama verisi yok.</td></tr>'; return; }
    items.slice(0,5).forEach((item,i)=>{
      const tr=document.createElement('tr');
      if(kind==='clan') tr.innerHTML=`<td>${item.rank ?? i+1}</td><td>${escapeHtml(item.name ?? '—')}</td><td>${item.memberCount ?? '—'}</td><td>${nationName(item.nation)}</td><td>${item.points ?? '—'}</td>`;
      else tr.innerHTML=`<td>${item.rank ?? i+1}</td><td>${escapeHtml(item.name ?? '—')}</td><td>${item.level ?? '—'}</td><td>${nationName(item.nation)}</td><td>${item.nationalPoints ?? '—'}</td>`;
      rankBody.appendChild(tr);
    });
  }
  function escapeHtml(value){ const span=document.createElement('span'); span.textContent=String(value); return span.innerHTML; }
  async function loadRank(kind='level'){
    if(rankState) rankState.textContent='GÜNCELLENİYOR';
    try{ const data=await getJson(`${config.rankingsApiBase || '/api/rankings'}${rankRoutes[kind]}`); renderRank(kind,data.items); if(rankState) rankState.textContent='CANLI VERİ'; }
    catch{ renderRank(kind,[]); if(rankState) rankState.textContent='VERİ ALINAMADI'; }
  }
  $$('.tab[data-rank]').forEach((button)=>button.addEventListener('click',()=>{ $$('.tab[data-rank]').forEach((b)=>b.classList.remove('active')); button.classList.add('active'); loadRank(button.dataset.rank); }));

  async function loadStatus(){
    const total=$('#onlineTotal'), el=$('#onlineElMorad'), karus=$('#onlineKarus'), onlineState=$('#onlineState'), statusList=$('#statusList'), statusState=$('#statusState');
    try{
      const data=await getJson(`${config.statusApiBase || '/api/status'}/v1/realms`);
      const realms=Array.isArray(data.realms)?data.realms:[];
      const counts=realms.map((r)=>r.onlinePlayerCount).filter(Number.isFinite);
      if(total) total.textContent=counts.length?String(counts.reduce((a,b)=>a+b,0)):'—';
      if(el) el.textContent='—'; if(karus) karus.textContent='—';
      if(onlineState) onlineState.textContent=counts.length?'CANLI TOPLAM':'IRK DAĞILIMI SUNULMUYOR';
      if(statusList){
        statusList.innerHTML='<div class="status-row"><b>Official Website</b><span class="up">● ÇEVRİMİÇİ</span></div>';
        if(!realms.length) statusList.insertAdjacentHTML('beforeend','<div class="status-row"><b>Oyun Sunucusu</b><span>VERİ YOK</span></div>');
        realms.forEach((r)=>{ const row=document.createElement('div'); row.className='status-row'; const up=r.availability==='online'; row.innerHTML=`<b>${escapeHtml(r.displayName || r.realmId)}</b><span class="${up?'up':''}">${up?'● ÇEVRİMİÇİ':r.availability==='maintenance'?'BAKIMDA':'ÇEVRİMDIŞI'}</span>`; statusList.appendChild(row); });
      }
      if(statusState) statusState.textContent='CANLI DURUM';
    }catch{
      if(total) total.textContent='—'; if(el) el.textContent='—'; if(karus) karus.textContent='—';
      if(onlineState) onlineState.textContent='VERİ ALINAMADI';
      if(statusState) statusState.textContent='VERİ ALINAMADI';
      if(statusList) statusList.innerHTML='<div class="status-row"><b>Official Website</b><span class="up">● ÇEVRİMİÇİ</span></div><div class="status-row"><b>Oyun Sunucusu</b><span>DURUM ALINAMADI</span></div>';
    }
  }
  $$('.guide-item').forEach((x)=>x.addEventListener('click',()=>say('Bu rehber içeriği henüz yayınlanmadı.')));
  loadRank('level'); loadStatus();
})();
