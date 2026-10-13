(()=>{
'use strict';
const admin=window.OldKOAdmin;
const bridge=window.OldKOPreviewBridge;
if(!admin||!bridge)return;
let active=false,off=null;

function previewPlayers(){return bridge.listPlayers().map(p=>({...p,account:p.account||'preview-web',source:'PREVIEW_LINK'}))}
function sync(){
 if(admin.state.mode==='live')return;
 const list=previewPlayers();
 if(!list.length){if(active){active=false;document.querySelector('.owner-card small')?.replaceChildren(document.createTextNode('AKTİF YETKİ · DEMO MODE'));}return}
 active=true;admin.state.mode='preview';
 const selected=admin.state.selectedPlayer?.name;
 admin.PLAYERS.splice(0,admin.PLAYERS.length,...list);
 admin.state.selectedPlayer=admin.PLAYERS.find(p=>p.name===selected)||admin.PLAYERS[0];
 admin.renderOnline();admin.renderPlayers();
 const small=document.querySelector('.owner-card small');if(small)small.textContent='AKTİF YETKİ · PREVIEW LINK';
 const alert=document.querySelector('#dashboard .alert-bar b');if(alert){alert.textContent='PREVIEW LINK';alert.className='ok'}
 const onlineHead=document.querySelector('#online .panel-head .live');if(onlineHead)onlineHead.textContent=`● ${list.length} PREVIEW ONLINE`;
 const card=document.querySelector('#dashboard .metric-card strong');if(card)card.textContent=String(list.length);
 const ring=document.querySelector('#dashboard .server-ring strong');if(ring)ring.textContent=String(list.length);
 if(location.hash==='#characters'&&admin.state.selectedPlayer)window.OldKOCharacterControl?.load(admin.state.selectedPlayer);
}
function send(command,target,arg=''){const msg=bridge.command(command,target,{arg,reason:arg||'OldKOWeb preview admin action'});admin.appendAudit(command,target||'GLOBAL','PREVIEW');admin.showToast('Preview komutu gönderildi',`${command}${target?` → ${target}`:''}`);return{ok:true,preview:true,msg}}

const originalExecute=admin.execute;
admin.execute=async(command,target='',arg='')=>{if(admin.state.mode==='preview')return send(command,target,arg);return originalExecute(command,target,arg)};
const originalBan=admin.banPlayer;
admin.banPlayer=async(character,type='ACCOUNT',reason='')=>{if(admin.state.mode==='preview'){bridge.ban(character,type,reason);admin.appendAudit(type==='IP'?'IP_BAN':'ACCOUNT_BAN',character,'PREVIEW');setTimeout(sync,50);return{ok:true,preview:true,game:{forwarded:true}}}return originalBan(character,type,reason)};
const originalUnban=admin.unbanPlayer;
admin.unbanPlayer=async(character,type='')=>{if(admin.state.mode==='preview'){bridge.unban(character,type);admin.appendAudit('BAN_REMOVE',character,'PREVIEW');setTimeout(sync,50);return{ok:true,preview:true,game:{forwarded:true}}}return originalUnban(character,type)};

// admin.js's global click handler closes over its original execute(). Capture preview commands first.
document.addEventListener('click',e=>{
 if(admin.state.mode!=='preview')return;
 const cmd=e.target.closest('[data-command]');
 if(cmd){e.preventDefault();e.stopImmediatePropagation();send(cmd.dataset.command,document.getElementById('gmTarget')?.value?.trim()||admin.state.selectedPlayer?.name||'','');return}
 const run=e.target.closest('#dryRunBtn');
 if(run&&admin.state.selectedCommand){e.preventDefault();e.stopImmediatePropagation();send(admin.state.selectedCommand,document.getElementById('gmTarget')?.value?.trim()||'',document.getElementById('gmArg')?.value?.trim()||'')}
},true);

off=bridge.on(msg=>{if(msg?.type==='sessions'||msg?.type==='command')setTimeout(sync,20)});
addEventListener('storage',e=>{if(String(e.key||'').startsWith('oldko.preview.'))setTimeout(sync,20)});
setInterval(sync,4000);
setTimeout(sync,700);
window.OldKOPreviewAdminLink={sync,isActive:()=>active,stop:()=>off?.()};
})();
