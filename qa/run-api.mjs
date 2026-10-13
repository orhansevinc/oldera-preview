import { execSync } from 'node:child_process';
import { Reporter } from './lib/reporter.mjs';
const r=new Reporter();
const base=(process.env.QA_ADMIN_BASE_URL||'').replace(/\/$/,'');
const player=process.env.QA_PLAYER_NAME||'osevinc';
const headers={accept:'application/json'};if(process.env.QA_ADMIN_BEARER)headers.authorization=`Bearer ${process.env.QA_ADMIN_BEARER}`;if(process.env.QA_ADMIN_COOKIE)headers.cookie=process.env.QA_ADMIN_COOKIE;
const call=async(p,o={})=>{const res=await fetch(base+p,{...o,headers:{...headers,...(o.body?{'content-type':'application/json'}:{}),...(o.headers||{})}});let body=null;try{body=await res.json();}catch{body=await res.text();}if(!res.ok)throw new Error(`${o.method||'GET'} ${p} -> HTTP ${res.status}: ${JSON.stringify(body)}`);return {status:res.status,body};};
if(!base){for(let i=17;i<=20;i++)r.fail(i,'QA_ADMIN_BASE_URL not supplied; service milestone cannot be assumed');process.exit(0);}
try{const q=await call('/health');const b=q.body;if(!(b===true||b?.ok===true||['ok','healthy','ready'].includes(String(b?.status||'').toLowerCase())))throw new Error(`health body does not declare readiness: ${JSON.stringify(b)}`);r.pass(17,'Admin API health contract returned ready',{status:q.status,body:b});}catch(e){r.fail(17,e.message);}
try{const q=await call(`/players?q=${encodeURIComponent(player)}&limit=10`);const text=JSON.stringify(q.body).toLowerCase();if(!text.includes(player.toLowerCase()))throw new Error(`player '${player}' absent from response`);r.pass(18,'Admin player lookup returned requested fixture',{status:q.status,player});}catch(e){r.fail(18,e.message);}
let banned=false;
try{const b=await call('/sanctions',{method:'POST',body:JSON.stringify({character:player,type:'ACCOUNT',reason:'WS10 QA reversible test'})});banned=true;const u=await call(`/sanctions/${encodeURIComponent(player)}?type=ACCOUNT`,{method:'DELETE'});r.pass(19,'Ban and unban mutations both completed successfully',{banStatus:b.status,unbanStatus:u.status,player});}catch(e){r.fail(19,e.message,{player,banned});}
try{
  const restart=process.env.QA_RESTART_COMMAND;if(!restart)throw new Error('QA_RESTART_COMMAND not supplied');
  await call('/sanctions',{method:'POST',body:JSON.stringify({character:player,type:'ACCOUNT',reason:'WS10 persistence restart probe'})});
  execSync(restart,{stdio:'inherit',shell:'/bin/bash',timeout:120000});
  const until=Date.now()+60000;let ready=false;while(Date.now()<until){try{await call('/health');ready=true;break;}catch{await new Promise(x=>setTimeout(x,1000));}}if(!ready)throw new Error('admin API did not recover after restart');
  const q=await call(`/characters/${encodeURIComponent(player)}/sanctions`);if(!JSON.stringify(q.body).toLowerCase().includes('account'))throw new Error('sanction marker missing after restart');
  await call(`/sanctions/${encodeURIComponent(player)}?type=ACCOUNT`,{method:'DELETE'});
  r.pass(20,'Sanction survived configured service restart and was verified before cleanup',{player});
}catch(e){r.fail(20,e.message,{player});if(banned){try{await call(`/sanctions/${encodeURIComponent(player)}?type=ACCOUNT`,{method:'DELETE'});}catch{}}}
