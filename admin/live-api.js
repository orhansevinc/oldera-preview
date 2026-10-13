(()=>{
'use strict';
const configured=window.OLDKO_ADMIN_API_BASE||localStorage.getItem('oldko.api.base')||'/api/admin';
const base=String(configured).replace(/\/$/,'');
let available=false,authenticated=false,lastHealth=null;

async function request(path,{method='GET',body,allow401=false}={}){
  const r=await fetch(`${base}${path}`,{method,credentials:'include',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  let data=null;try{data=await r.json()}catch{data={ok:false,error:`HTTP_${r.status}`}}
  if(r.status===401&&!allow401){authenticated=false;throw Object.assign(new Error('AUTH_REQUIRED'),{status:401,data})}
  if(!r.ok)throw Object.assign(new Error(data?.detail||data?.error||`HTTP ${r.status}`),{status:r.status,data});
  return data;
}
async function probe(){
  try{lastHealth=await request('/health');available=true;return lastHealth}catch(e){available=false;return null}
}
async function session(){
  if(!available&&!(await probe()))return null;
  try{const d=await request('/session',{allow401:true});authenticated=Boolean(d?.ok);return d?.ok?d:null}catch(e){authenticated=false;return null}
}
async function login(user,password){const d=await request('/session/login',{method:'POST',body:{user,password}});authenticated=true;return d}
async function logout(){try{return await request('/session/logout',{method:'POST'})}finally{authenticated=false}}
async function overview(){return request('/overview')}
async function players({online=false,q='',limit=1000}={}){const sp=new URLSearchParams();if(online)sp.set('online','1');if(q)sp.set('q',q);sp.set('limit',String(limit));return request(`/players?${sp}`)}
async function character(name){return request(`/characters/${encodeURIComponent(name)}`)}
async function inventory(name){return request(`/characters/${encodeURIComponent(name)}/inventory`)}
async function inn(name){return request(`/characters/${encodeURIComponent(name)}/inn`)}
async function command(command,target='',arg='',reason=''){return request('/commands',{method:'POST',body:{command,target,arg,reason,source:'web-control-center'}})}
async function ban(character,type='ACCOUNT',reason=''){return request('/sanctions',{method:'POST',body:{character,type,reason}})}
async function unban(character,type=''){const qs=type?`?type=${encodeURIComponent(type)}`:'';return request(`/sanctions/${encodeURIComponent(character)}${qs}`,{method:'DELETE'})}
async function audit(limit=100){return request(`/audit?limit=${encodeURIComponent(limit)}`)}
function status(){return{base,available,authenticated,health:lastHealth}}
window.OldKOLiveApi={base,probe,session,login,logout,overview,players,character,inventory,inn,command,ban,unban,audit,status,request};
})();
