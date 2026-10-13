const COMMANDS=[
  {name:'INVISIBLE',scope:'self',desc:'Toggle GM visibility for the owner/admin character.'},
  {name:'CLEAN',scope:'world',desc:'Run the original world cleanup command.'},
  {name:'RAINING',scope:'world',desc:'Control rain weather state.'},
  {name:'SNOWING',scope:'world',desc:'Control snow weather state.'},
  {name:'TIME',scope:'world',desc:'Control or inspect world time.'},
  {name:'COUNT',scope:'server',desc:'Return current concurrent user count.'},
  {name:'NOTICE',scope:'zone',desc:'Send an administrative notice.'},
  {name:'ARREST',scope:'player',desc:'Apply the original GM arrest/enforcement action.'},
  {name:'FORBIDCONNECT',scope:'player',desc:'Forbid a target account/player from connecting.'},
  {name:'FORBIDCHAT',scope:'player',desc:'Disable chat for a target player.'},
  {name:'PERMITCHAT',scope:'player',desc:'Restore chat permission for a target player.'},
  {name:'NOTICEALL',scope:'global',desc:'Broadcast a notice to all connected players.'},
  {name:'CUTOFF',scope:'player',desc:'Disconnect a target player session.'},
  {name:'VIEW',scope:'player',desc:'Enable GM view/observation operation.'},
  {name:'UNVIEW',scope:'player',desc:'Stop GM view/observation operation.'},
  {name:'FORBIDUSER',scope:'player',desc:'Apply the original forbid-user action.'},
  {name:'SUMMONUSER',scope:'player',desc:'Summon a target player to the GM/owner.'},
  {name:'ATTACKDISABLE',scope:'world',desc:'Disable attack state through the original GM command.'},
  {name:'ATTACKENABLE',scope:'world',desc:'Restore attack state through the original GM command.'},
  {name:'PROGRAMLISTCHECK',scope:'security',desc:'Original PLC/program-list check command surface.'}
];

const state={selectedCommand:null,mode:'demo'};
const views=[...document.querySelectorAll('.view')];
const navItems=[...document.querySelectorAll('.nav-item')];
const pageTitle=document.getElementById('pageTitle');
const crumbTitle=document.getElementById('crumbTitle');
const toast=document.getElementById('toast');
const toastTitle=document.getElementById('toastTitle');
const toastText=document.getElementById('toastText');

const TITLES={dashboard:'Control Center',players:'Player Search',characters:'Character Control',items:'Items & Economy',world:'World & Zones',gm:'GM Command Center',server:'Server Control',logs:'Audit & Logs'};

function openView(id){
  views.forEach(v=>v.classList.toggle('active',v.id===id));
  navItems.forEach(n=>n.classList.toggle('active',n.dataset.view===id));
  pageTitle.textContent=TITLES[id]||'Control Center';
  crumbTitle.textContent=(TITLES[id]||id).toUpperCase();
  history.replaceState(null,'',`#${id}`);
}

navItems.forEach(btn=>btn.addEventListener('click',()=>openView(btn.dataset.view)));
document.querySelectorAll('[data-view-target]').forEach(btn=>btn.addEventListener('click',()=>openView(btn.dataset.viewTarget)));

function renderCommands(){
  const host=document.getElementById('commandList');
  host.innerHTML='';
  COMMANDS.forEach(cmd=>{
    const card=document.createElement('button');
    card.type='button';
    card.className='cmd-card';
    card.innerHTML=`<code>${cmd.name}</code><p>${cmd.desc}</p>`;
    card.addEventListener('click',()=>{
      document.querySelectorAll('.cmd-card').forEach(x=>x.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedCommand=cmd.name;
      showToast('Command selected',`${cmd.name} · scope: ${cmd.scope}`);
    });
    host.appendChild(card);
  });
}

function showToast(title,text){
  toastTitle.textContent=title;
  toastText.textContent=text;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t=setTimeout(()=>toast.classList.remove('show'),2800);
}

function appendAudit(action,target='—',result='DEMO'){
  const tbody=document.getElementById('auditRows');
  if(!tbody)return;
  const now=new Date().toLocaleTimeString('tr-TR',{hour12:false});
  const trace=`ADM-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
  const row=document.createElement('tr');
  row.innerHTML=`<td>${now}</td><td>ORHAN</td><td>${action}</td><td>${target}</td><td><span class="badge gold">${result}</span></td><td>${trace}</td>`;
  tbody.prepend(row);
}

async function dispatchAdminCommand(name,{target='',arg=''}={}){
  const payload={command:name,target,arg,actor:'ORHAN',authority:'ROOT_OWNER',source:'web-control-center'};

  if(state.mode==='live'){
    const response=await fetch('/api/admin/commands',{
      method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(payload)
    });
    if(!response.ok) throw new Error(`Admin command failed (${response.status})`);
    return response.json();
  }

  console.info('[OldERA Admin Demo]',payload);
  appendAudit(name,target||'GLOBAL','DEMO');
  return {ok:true,demo:true,payload};
}

async function execute(name,target='',arg=''){
  try{
    await dispatchAdminCommand(name,{target,arg});
    showToast(`${name} ready`,state.mode==='demo'?'UI + command contract is wired. Live server execution is intentionally disabled in this preview.':'Command executed successfully.');
  }catch(err){
    showToast('Command failed',err.message);
  }
}

async function mutate(path,method='POST',body={},auditAction='ADMIN_MUTATION',target='—'){
  const payload={...body,actor:'ORHAN',authority:'ROOT_OWNER',source:'web-control-center'};
  if(state.mode==='live'){
    const response=await fetch(`/api/admin${path}`,{
      method,headers:{'Content-Type':'application/json'},credentials:'include',body:method==='GET'?undefined:JSON.stringify(payload)
    });
    if(!response.ok) throw new Error(`Admin mutation failed (${response.status})`);
    const data=await response.json();
    appendAudit(auditAction,target,'SUCCESS');
    return data;
  }
  console.info('[OldERA Admin Mutation Demo]',method,path,payload);
  appendAudit(auditAction,target,'DEMO');
  return {ok:true,demo:true,path,method,payload};
}

window.OldERAAdmin={state,COMMANDS,openView,showToast,appendAudit,dispatchAdminCommand,execute,mutate};

document.querySelectorAll('[data-command]').forEach(btn=>btn.addEventListener('click',()=>{
  const target=document.getElementById('gmTarget')?.value?.trim()||'osevinc';
  execute(btn.dataset.command,target,'');
}));

document.getElementById('dryRunBtn').addEventListener('click',()=>{
  if(!state.selectedCommand){showToast('Select a command','Choose one GM command from the list first.');return;}
  execute(state.selectedCommand,document.getElementById('gmTarget').value.trim(),document.getElementById('gmArg').value.trim());
});

document.getElementById('refreshBtn').addEventListener('click',()=>showToast('Dashboard refreshed','Preview metrics reloaded. Live metrics will come from /api/admin/overview.'));

document.getElementById('playerFindForm').addEventListener('submit',e=>{
  e.preventDefault();
  const q=document.getElementById('playerFindInput').value.trim();
  showToast('Player lookup',q?`${q} loaded in preview character control.`:'Enter a character name.');
});

document.getElementById('globalSearch').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    const q=e.currentTarget.value.trim();
    openView('players');
    showToast('Global search',q?`Searching account/character/clan/item serial for “${q}”.`:'Type something to search.');
  }
});

const legacyTabs=document.getElementById('charTabs');
if(legacyTabs)legacyTabs.addEventListener('click',e=>{
  const btn=e.target.closest('button');if(!btn)return;
  [...e.currentTarget.querySelectorAll('button')].forEach(x=>x.classList.toggle('active',x===btn));
});

function loadCharacterControl(){
  const style=document.createElement('link');
  style.rel='stylesheet';style.href='./character-control.css';document.head.appendChild(style);
  const script=document.createElement('script');
  script.src='./character-control.js';script.defer=true;document.body.appendChild(script);
}

renderCommands();
loadCharacterControl();
const initial=location.hash.slice(1);
if(TITLES[initial]) openView(initial);
