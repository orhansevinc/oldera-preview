const COMMANDS=[
{name:'INVISIBLE',scope:'self',tr:'Görünmezlik',desc:'Owner/GM karakterinin görünürlüğünü açar veya kapatır.'},
{name:'CLEAN',scope:'world',tr:'Dünya temizliği',desc:'Orijinal dünya temizleme komutunu çalıştırır.'},
{name:'RAINING',scope:'world',tr:'Yağmur',desc:'Yağmur hava durumunu kontrol eder.'},
{name:'SNOWING',scope:'world',tr:'Kar',desc:'Kar hava durumunu kontrol eder.'},
{name:'TIME',scope:'world',tr:'Dünya saati',desc:'Oyun dünyasının saatini kontrol eder.'},
{name:'COUNT',scope:'server',tr:'Online sayısı',desc:'Anlık bağlı oyuncu sayısını getirir.'},
{name:'NOTICE',scope:'zone',tr:'Bölge duyurusu',desc:'Bulunduğun bölgeye yönetici duyurusu gönderir.'},
{name:'ARREST',scope:'player',tr:'Oyuncuya git / takip',desc:'Orijinal GM arrest/izleme işlemini hedef oyuncu üzerinde uygular.'},
{name:'FORBIDCONNECT',scope:'player',tr:'Girişi yasakla',desc:'Hedef hesabın tekrar bağlanmasını engeller.'},
{name:'FORBIDCHAT',scope:'player',tr:'Chat ban',desc:'Hedef oyuncunun sohbet yetkisini kapatır.'},
{name:'PERMITCHAT',scope:'player',tr:'Chat ban kaldır',desc:'Hedef oyuncunun sohbet yetkisini geri verir.'},
{name:'NOTICEALL',scope:'global',tr:'Global duyuru',desc:'Tüm bağlı oyunculara duyuru gönderir.'},
{name:'CUTOFF',scope:'player',tr:'Bağlantıyı kes',desc:'Hedef oyuncunun mevcut oturumunu sonlandırır.'},
{name:'VIEW',scope:'player',tr:'Oyuncuyu izle',desc:'GM gözlem/izleme işlemini hedef oyuncu için açar.'},
{name:'UNVIEW',scope:'player',tr:'İzlemeyi bırak',desc:'Aktif GM gözlem işlemini sonlandırır.'},
{name:'FORBIDUSER',scope:'player',tr:'Kullanıcıyı yasakla',desc:'Orijinal forbid-user işlemini hedef oyuncuya uygular.'},
{name:'SUMMONUSER',scope:'player',tr:'Oyuncuyu yanına çek',desc:'Hedef oyuncuyu Owner/GM karakterinin bulunduğu yere getirir.'},
{name:'ATTACKDISABLE',scope:'world',tr:'Saldırıyı kapat',desc:'Dünya genelinde saldırı durumunu devre dışı bırakır.'},
{name:'ATTACKENABLE',scope:'world',tr:'Saldırıyı aç',desc:'Dünya genelinde saldırı durumunu tekrar etkinleştirir.'},
{name:'PROGRAMLISTCHECK',scope:'security',tr:'Program kontrolü',desc:'Orijinal PLC/program-list kontrol yüzeyidir.'}
];

const PLAYERS=[
{name:'osevinc',account:'osevinc',nation:'El Morad',className:'Warrior',level:70,np:48920,coin:37400000,zone:'Moradon',online:true,banned:false,ipBanned:false,last:'Şimdi',ip:'85.104.21.17',initial:'O'},
{name:'RavenTR',account:'raven01',nation:'Karus',className:'Rogue',level:70,np:112840,coin:98400000,zone:'Colony Zone',online:true,banned:false,ipBanned:false,last:'Şimdi',ip:'78.188.41.54',initial:'R'},
{name:'ArchMage',account:'mage1298',nation:'El Morad',className:'Mage',level:69,np:88220,coin:24100000,zone:'Moradon',online:true,banned:false,ipBanned:false,last:'Şimdi',ip:'88.247.67.10',initial:'A'},
{name:'Priestess',account:'healme',nation:'El Morad',className:'Priest',level:68,np:66540,coin:18700000,zone:'El Morad Castle',online:true,banned:false,ipBanned:false,last:'Şimdi',ip:'176.40.83.11',initial:'P'},
{name:'Berserker',account:'karuswar',nation:'Karus',className:'Warrior',level:70,np:145600,coin:132000000,zone:'Colony Zone',online:true,banned:false,ipBanned:false,last:'Şimdi',ip:'95.70.18.31',initial:'B'},
{name:'OldSchool',account:'oldschool',nation:'Karus',className:'Priest',level:65,np:32210,coin:9700000,zone:'Luferson',online:false,banned:false,ipBanned:false,last:'18 dk önce',ip:'46.2.18.90',initial:'O'},
{name:'Shadow',account:'shadowacc',nation:'El Morad',className:'Rogue',level:70,np:99800,coin:43600000,zone:'Moradon',online:false,banned:false,ipBanned:false,last:'42 dk önce',ip:'31.145.11.8',initial:'S'},
{name:'Suspicious',account:'testdup',nation:'Karus',className:'Warrior',level:62,np:4200,coin:860000000,zone:'Luferson',online:false,banned:true,ipBanned:true,last:'2 saat önce',ip:'185.99.10.44',initial:'S'}
];

const state={selectedCommand:null,mode:'demo',selectedPlayer:PLAYERS[0],theme:localStorage.getItem('oldkoweb.admin.theme')||localStorage.getItem('oldera.admin.theme')||'dark'};
const TITLES={dashboard:'OldKO Control Center',online:'Online Players',players:'Players & Rankings',characters:'Character Control',items:'Items & Economy',world:'World & Zones',gm:'GM Command Center',server:'Server Control',logs:'Audit & Logs'};
const $=id=>document.getElementById(id);
const toast=$('toast'),toastTitle=$('toastTitle'),toastText=$('toastText');
document.documentElement.dataset.theme=state.theme;

function showToast(title,text){toastTitle.textContent=title;toastText.textContent=text;toast.classList.add('show');clearTimeout(showToast._t);showToast._t=setTimeout(()=>toast.classList.remove('show'),3000)}
function appendAudit(action,target='—',result='DEMO'){const tbody=$('auditRows');if(!tbody)return;const now=new Date().toLocaleTimeString('tr-TR',{hour12:false});const trace=`OK-${Math.random().toString(36).slice(2,7).toUpperCase()}`;const row=document.createElement('tr');row.innerHTML=`<td>${now}</td><td>ORHAN</td><td>${action}</td><td>${target}</td><td><span class="badge gold">${result}</span></td><td>${trace}</td>`;tbody.prepend(row)}
function openView(id){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===id));$('pageTitle').textContent=TITLES[id]||id;$('crumbTitle').textContent=(TITLES[id]||id).toUpperCase();history.replaceState(null,'',`#${id}`);$('sidebar').classList.remove('open');if(id==='characters')window.OldKOCharacterControl?.load(state.selectedPlayer)}

async function dispatchAdminCommand(name,{target='',arg=''}={}){const payload={command:name,target,arg,actor:'ORHAN',authority:'ROOT_OWNER',source:'oldko-web-control-center'};if(state.mode==='live'){const response=await fetch('/api/admin/commands',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(payload)});if(!response.ok)throw new Error(`Admin command failed (${response.status})`);return response.json()}console.info('[OldKO Admin Demo]',payload);appendAudit(name,target||'GLOBAL','DEMO');return{ok:true,demo:true,payload}}
async function execute(name,target='',arg=''){try{await dispatchAdminCommand(name,{target,arg});showToast(`${name} hazır`,state.mode==='demo'?'Komut arayüzü aktif. OldKO server bağlantısı yapıldığında aynı buton canlı işlemi çalıştıracak.':'Komut çalıştırıldı.')}catch(err){showToast('Komut başarısız',err.message)}}
async function mutate(path,method='POST',body={},auditAction='ADMIN_MUTATION',target='—'){const payload={...body,actor:'ORHAN',authority:'ROOT_OWNER',source:'oldko-web-control-center'};if(state.mode==='live'){const response=await fetch(`/api/admin${path}`,{method,headers:{'Content-Type':'application/json'},credentials:'include',body:method==='GET'?undefined:JSON.stringify(payload)});if(!response.ok)throw new Error(`Admin mutation failed (${response.status})`);const data=await response.json();appendAudit(auditAction,target,'SUCCESS');return data}console.info('[OldKO Admin Mutation Demo]',method,path,payload);appendAudit(auditAction,target,'DEMO');return{ok:true,demo:true,path,method,payload}}

function renderCommands(){const host=$('commandList');host.innerHTML='';COMMANDS.forEach(cmd=>{const card=document.createElement('button');card.className='cmd-card';card.innerHTML=`<code>${cmd.name}</code><span class="tr">${cmd.tr}</span><p>${cmd.desc}</p>`;card.onclick=()=>{host.querySelectorAll('.cmd-card').forEach(x=>x.classList.remove('selected'));card.classList.add('selected');state.selectedCommand=cmd.name;showToast('Komut seçildi',`${cmd.name} · ${cmd.tr}`)};host.appendChild(card)})}
function formatCoin(v){if(v>=1e9)return`${(v/1e9).toFixed(1)}B`;if(v>=1e6)return`${(v/1e6).toFixed(1)}M`;return v.toLocaleString('tr-TR')}
function statusBadge(p){if(p.ipBanned)return'<span class="badge red">IP BANNED</span>';if(p.banned)return'<span class="badge red">BANNED</span>';return p.online?'<span class="badge green">ONLINE</span>':'<span class="badge">OFFLINE</span>'}
function playerMatches(p,q){q=q.trim().toLowerCase();return!q||[p.name,p.account,p.nation,p.className,p.zone,p.ip].some(x=>String(x).toLowerCase().includes(q))}
function sortPlayers(list,mode){return [...list].sort((a,b)=>{if(mode==='np-desc')return b.np-a.np;if(mode==='level-desc')return b.level-a.level;if(mode==='coin-desc')return b.coin-a.coin;if(mode==='zone-asc')return a.zone.localeCompare(b.zone,'tr');return a.name.localeCompare(b.name,'tr')})}
function selectPlayer(name){const p=PLAYERS.find(x=>x.name===name);if(!p)return;state.selectedPlayer=p;const gm=$('gmTarget');if(gm)gm.value=p.name;openView('characters')}
function setPlayerBanState(name,{banned,ipBanned}={}){const p=PLAYERS.find(x=>x.name===name);if(!p)return null;if(typeof banned==='boolean')p.banned=banned;if(typeof ipBanned==='boolean')p.ipBanned=ipBanned;if(!p.banned)p.ipBanned=false;state.selectedPlayer=p;renderOnline();renderPlayers();return p}
function renderOnline(){const host=$('onlinePlayerGrid');if(!host)return;let list=PLAYERS.filter(p=>p.online);const q=$('onlineSearch')?.value||'',nation=$('onlineNation')?.value||'all',sort=$('onlineSort')?.value||'np-desc';list=list.filter(p=>playerMatches(p,q)&&(nation==='all'||p.nation===nation));list=sortPlayers(list,sort);host.innerHTML=list.map(p=>`<button class="player-tile player-row" data-player="${p.name}"><div class="player-avatar">${p.initial}</div><div class="player-identity"><div class="player-name-line"><h3>${p.name}</h3>${statusBadge(p)}</div><div class="meta">${p.level} ${p.className} · ${p.nation} · ${p.zone}<br><small>${p.account} · ${p.ip}</small></div></div><div class="stats"><span>NP<b>${p.np.toLocaleString('tr-TR')}</b></span><span>LEVEL<b>${p.level}</b></span><span>COIN<b>${formatCoin(p.coin)}</b></span><span>ZONE<b>${p.zone}</b></span></div><span class="row-open">KARAKTERİ AÇ ›</span></button>`).join('')||'<div class="empty-state"><b>Sonuç yok</b><span>Bu filtreyle eşleşen online oyuncu bulunamadı.</span></div>';host.querySelectorAll('[data-player]').forEach(x=>x.onclick=()=>selectPlayer(x.dataset.player))}
function renderPlayers(){const body=$('playersBody');if(!body)return;const q=$('playerSearch')?.value||'',status=$('playerStatus')?.value||'all',sort=$('playerSort')?.value||'np-desc';let list=PLAYERS.filter(p=>playerMatches(p,q));if(status==='online')list=list.filter(p=>p.online);if(status==='offline')list=list.filter(p=>!p.online&&!p.banned);if(status==='banned')list=list.filter(p=>p.banned);list=sortPlayers(list,sort);body.innerHTML=list.map(p=>`<tr data-player="${p.name}"><td><div class="table-avatar">${p.initial}</div></td><td>${statusBadge(p)}</td><td><b>${p.name}</b><br><small>${p.account}</small></td><td>${p.nation}</td><td>${p.className}</td><td><b>${p.level}</b></td><td><b>${p.np.toLocaleString('tr-TR')}</b></td><td>${formatCoin(p.coin)}</td><td>${p.zone}</td><td>${p.last}</td></tr>`).join('');body.querySelectorAll('[data-player]').forEach(x=>x.onclick=()=>selectPlayer(x.dataset.player))}

let pendingCritical=null;function openCritical(action,title,text,target='SERVER'){pendingCritical={action,target};$('modalTitle').textContent=title;$('modalText').textContent=text;$('modalReason').value='ROOT OWNER manual action';$('modalBackdrop').hidden=false}
function closeModal(){pendingCritical=null;$('modalBackdrop').hidden=true}

const api={state,COMMANDS,PLAYERS,openView,showToast,appendAudit,dispatchAdminCommand,execute,mutate,selectPlayer,setPlayerBanState,requestCritical:openCritical,renderOnline,renderPlayers};
window.OldKOAdmin=api;
window.OldERAAdmin=api;

document.querySelectorAll('.nav-item').forEach(btn=>btn.onclick=()=>openView(btn.dataset.view));document.querySelectorAll('[data-view-target]').forEach(btn=>btn.onclick=()=>openView(btn.dataset.viewTarget));
$('menuToggle').onclick=()=>$('sidebar').classList.toggle('open');
$('themeBtn').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=state.theme;localStorage.setItem('oldkoweb.admin.theme',state.theme);$('themeBtn').textContent=state.theme==='dark'?'☀':'☾';showToast('Tema değiştirildi',state.theme==='dark'?'Karanlık mod aktif.':'Aydınlık mod aktif.')};$('themeBtn').textContent=state.theme==='dark'?'☀':'☾';
$('refreshBtn').onclick=()=>showToast('Yenilendi','Preview verileri yenilendi. Canlı OldKO bağlantısında server özeti tekrar çekilecek.');
$('globalSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){const q=e.currentTarget.value.trim();openView('players');$('playerSearch').value=q;renderPlayers()}});
['onlineSearch','onlineSort','onlineNation'].forEach(id=>$(id)?.addEventListener(id.includes('Search')?'input':'change',renderOnline));['playerSearch','playerSort','playerStatus'].forEach(id=>$(id)?.addEventListener(id.includes('Search')?'input':'change',renderPlayers));
$('dryRunBtn').onclick=()=>{if(!state.selectedCommand)return showToast('Komut seç','Önce aşağıdaki GM komutlarından birini seç.');execute(state.selectedCommand,$('gmTarget').value.trim(),$('gmArg').value.trim())};
document.addEventListener('click',e=>{const cmd=e.target.closest('[data-command]');if(cmd)execute(cmd.dataset.command,$('gmTarget')?.value?.trim()||state.selectedPlayer.name,'');const demo=e.target.closest('[data-demo-action]');if(demo)showToast(demo.dataset.demoAction,'Buton aktif. Backend bağlandığında canlı veriye/işleme bağlanacak.');const critical=e.target.closest('[data-critical]');if(critical)openCritical(critical.dataset.critical,critical.textContent.trim().split('\n')[0],`Bu kritik işlem canlı OldKO sunucusunda ikinci onay ve audit nedeni ile çalıştırılacak.`)});
$('modalCancel').onclick=closeModal;$('modalBackdrop').addEventListener('click',e=>{if(e.target===$('modalBackdrop'))closeModal()});$('modalConfirm').onclick=async()=>{if(!pendingCritical)return;const {action,target}=pendingCritical,reason=$('modalReason').value.trim();await mutate('/server/critical','POST',{action,reason},action,target);showToast('İşlem hazırlandı',`${action} işlemi audit kaydıyla hazırlandı.`);closeModal()};
renderCommands();renderOnline();renderPlayers();const initial=location.hash.slice(1);if(TITLES[initial])openView(initial);
