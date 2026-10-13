(()=>{
'use strict';
const CHANNEL='oldko-preview-runtime-v1';
const SESSION_KEY='oldko.preview.sessions.v1';
const BAN_KEY='oldko.preview.bans.v1';
const ttl=15000;
const bc=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(CHANNEL):null;
const listeners=new Set();
const tabId=sessionStorage.getItem('oldko.preview.tab')||crypto.randomUUID?.()||Math.random().toString(36).slice(2);
sessionStorage.setItem('oldko.preview.tab',tabId);
let heartbeat=null,currentSession=null;

function read(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'')||fallback}catch{return fallback}}
function write(key,value){localStorage.setItem(key,JSON.stringify(value));localStorage.setItem(`${key}.pulse`,String(Date.now()))}
function cleanSessions(){const now=Date.now(),all=read(SESSION_KEY,{}),next={};for(const [id,s] of Object.entries(all))if(now-Number(s.seen||0)<ttl)next[id]=s;if(Object.keys(next).length!==Object.keys(all).length)write(SESSION_KEY,next);return next}
function listPlayers(){const bans=read(BAN_KEY,{});return Object.values(cleanSessions()).map(s=>{const b=bans[String(s.name||'').toLowerCase()]||null;return{...s,banned:Boolean(b),ipBanned:b?.type==='IP',banType:b?.type||null,online:true,last:'Şimdi',initial:String(s.name||'?').slice(0,1).toUpperCase()}})}
function emit(msg){bc?.postMessage(msg);listeners.forEach(fn=>{try{fn(msg)}catch(e){console.warn(e)}})}
function on(fn){listeners.add(fn);return()=>listeners.delete(fn)}
function pulse(){emit({type:'sessions',players:listPlayers(),at:Date.now()})}
function register(player){currentSession={id:tabId,name:player.name||'Osevinc',account:player.account||'preview-web',nation:player.nation||'El Morad',nationId:player.nationId||2,className:player.className||'Warrior',level:Number(player.level||1),np:Number(player.np||0),coin:Number(player.coin||0),zone:player.zone||'Moradon',zoneId:Number(player.zoneId||21),ip:'preview-local',x:Number(player.x||336),z:Number(player.z||398),seen:Date.now(),source:'GITHUB_PAGES_PREVIEW'};const all=cleanSessions();all[tabId]=currentSession;write(SESSION_KEY,all);clearInterval(heartbeat);heartbeat=setInterval(()=>{if(!currentSession)return;const all=cleanSessions();currentSession.seen=Date.now();all[tabId]=currentSession;write(SESSION_KEY,all);pulse()},4000);pulse();return currentSession}
function unregister(){clearInterval(heartbeat);heartbeat=null;const all=cleanSessions();delete all[tabId];write(SESSION_KEY,all);currentSession=null;pulse()}
function getBan(name){return read(BAN_KEY,{})[String(name||'').toLowerCase()]||null}
function ban(name,type='ACCOUNT',reason='Preview admin ban'){const bans=read(BAN_KEY,{});bans[String(name).toLowerCase()]={type:String(type).toUpperCase(),reason,createdAt:Date.now()};write(BAN_KEY,bans);command(type==='IP'?'IP_BAN':'ACCOUNT_BAN',name,{reason});pulse();return bans[String(name).toLowerCase()]}
function unban(name,type=''){const bans=read(BAN_KEY,{}),key=String(name).toLowerCase(),b=bans[key];if(b&&(!type||String(type).toUpperCase()===b.type))delete bans[key];write(BAN_KEY,bans);command('BAN_REMOVE',name,{type});pulse();return true}
function command(command,target='',payload={}){const msg={type:'command',id:crypto.randomUUID?.()||Math.random().toString(36).slice(2),command:String(command).toUpperCase(),target:String(target||''),payload,at:Date.now()};emit(msg);return msg}
function overlay(title,text,danger=false){let el=document.getElementById('oldkoPreviewRuntimeNotice');if(!el){el=document.createElement('div');el.id='oldkoPreviewRuntimeNotice';Object.assign(el.style,{position:'fixed',left:'50%',top:'9%',transform:'translateX(-50%)',zIndex:'999999',minWidth:'300px',maxWidth:'min(620px,90vw)',padding:'14px 18px',background:'rgba(10,10,12,.94)',border:'1px solid #9b7a3e',boxShadow:'0 15px 60px #000',color:'#f1eadc',fontFamily:'Tahoma,Arial,sans-serif',textAlign:'center',pointerEvents:'none'});document.body.appendChild(el)}el.style.borderColor=danger?'#8e302b':'#9b7a3e';el.innerHTML=`<b style="display:block;color:${danger?'#e17b72':'#e0bc72'};font-size:13px">${String(title)}</b><span style="display:block;margin-top:5px;font-size:12px">${String(text||'')}</span>`;el.hidden=false;clearTimeout(overlay.t);overlay.t=setTimeout(()=>{el.hidden=true},4500)}
function jobName(job){const j=String(job||'').toLowerCase();return j.includes('rogue')?'Rogue':j.includes('mage')?'Mage':j.includes('priest')?'Priest':'Warrior'}
function nationName(n){return Number(n)===1?'Karus':'El Morad'}

function installGame(){
 if(!window.OldERAWorld?.start||window.OldERAWorld.__oldkoPreviewWrapped)return false;
 const original=window.OldERAWorld.start.bind(window.OldERAWorld);
 window.OldERAWorld.start=async options=>{
   const name=options?.name||options?.character?.name||'Osevinc',blocked=getBan(name);
   if(blocked){overlay('OLDKO PREVIEW · GİRİŞ ENGELLENDİ',`${name} için ${blocked.type} ban aktif. Admin panelinden Ban Kaldır kullan.`,true);throw new Error(`${name} is banned in preview runtime`)}
   const result=await original(options);
   register({name,nation:nationName(options?.nation),nationId:Number(options?.nation||2),className:jobName(options?.character?.job),level:1,np:0,coin:0,zone:'Moradon',zoneId:21});
   return result;
 };
 window.OldERAWorld.__oldkoPreviewWrapped=true;
 on(msg=>{
   if(msg?.type!=='command'||!currentSession)return;const target=String(msg.target||'');if(target&&target!=='GLOBAL'&&target!==currentSession.name)return;
   const c=msg.command;
   if(c==='NOTICE'||c==='NOTICEALL'){overlay('OLDKO YÖNETİCİ DUYURUSU',msg.payload?.arg||msg.payload?.reason||'Yönetici duyurusu');return}
   if(['ACCOUNT_BAN','IP_BAN','FORBIDUSER','FORBIDCONNECT'].includes(c)){overlay('YÖNETİCİ İŞLEMİ',`${currentSession.name}: ${c}`,true);setTimeout(()=>{unregister();location.reload()},1600);return}
   if(c==='CUTOFF'){overlay('BAĞLANTI KESİLDİ','Admin mevcut oturumu sonlandırdı.',true);setTimeout(()=>{unregister();location.reload()},1300);return}
   if(c==='BAN_REMOVE'){overlay('BAN KALDIRILDI',`${currentSession.name} tekrar giriş yapabilir.`);return}
   overlay('OLDKO PREVIEW COMMAND',`${c}${target?` → ${target}`:''}`);
 });
 addEventListener('beforeunload',unregister);
 return true;
}

bc?.addEventListener('message',e=>listeners.forEach(fn=>{try{fn(e.data)}catch(err){console.warn(err)}}));
addEventListener('storage',e=>{if(e.key===SESSION_KEY||e.key===BAN_KEY||e.key===`${SESSION_KEY}.pulse`||e.key===`${BAN_KEY}.pulse`)pulse()});
setInterval(()=>{cleanSessions();pulse()},6000);
const api={CHANNEL,listPlayers,on,pulse,register,unregister,ban,unban,getBan,command,installGame,isPreview:true};
window.OldKOPreviewBridge=api;
installGame();
})();
