(()=>{
'use strict';
const base=String(window.OLDKO_ADMIN_API_BASE||'/api/admin').replace(/\/$/,'');
let available=false,authenticated=false,lastHealth=null,lastSession=null;

async function request(path,{method='GET',body,allow401=false,headers={}}={}){
  const options={method,credentials:'include',cache:'no-store',headers:{accept:'application/json',...headers}};
  if(body!==undefined){options.headers['content-type']='application/json';options.body=JSON.stringify(body);}
  const response=await fetch(`${base}${path}`,options);
  let data=null;try{data=await response.json();}catch{data={ok:false,error:`HTTP_${response.status}`};}
  if(response.status===401&&allow401){authenticated=false;lastSession=null;return null;}
  if(response.status===401)authenticated=false;
  if(!response.ok){
    const error=new Error(data?.detail||data?.error||`HTTP ${response.status}`);
    error.status=response.status;error.code=data?.error||`HTTP_${response.status}`;error.data=data;
    throw error;
  }
  return data;
}
async function probe(){try{lastHealth=await request('/health');available=true;return lastHealth;}catch(error){available=false;lastHealth=null;throw error;}}
async function session(){try{const data=await request('/session',{allow401:true});authenticated=Boolean(data?.ok);lastSession=data;return data;}catch(error){authenticated=false;lastSession=null;throw error;}}
async function login(user,password){const data=await request('/session/login',{method:'POST',body:{user,password}});authenticated=true;lastSession=data;return data;}
async function logout(){try{return await request('/session/logout',{method:'POST'});}finally{authenticated=false;lastSession=null;}}
async function overview(){return request('/overview');}
async function players({online=false,q='',limit=1000}={}){const params=new URLSearchParams();if(online)params.set('online','1');if(q)params.set('q',q);params.set('limit',String(limit));return request(`/players?${params}`);}
async function character(name){return request(`/characters/${encodeURIComponent(name)}`);}
async function patchCharacter(name,body,headers={}){return request(`/characters/${encodeURIComponent(name)}`,{method:'PATCH',body,headers});}
async function patchStats(name,body,headers={}){return request(`/characters/${encodeURIComponent(name)}/stats`,{method:'PATCH',body,headers});}
async function patchSkills(name,body,headers={}){return request(`/characters/${encodeURIComponent(name)}/skills`,{method:'PATCH',body,headers});}
async function inventory(name){return request(`/characters/${encodeURIComponent(name)}/inventory`);}
async function inn(name){return request(`/characters/${encodeURIComponent(name)}/inn`);}
async function transactions(name){return request(`/characters/${encodeURIComponent(name)}/transactions`);}
async function sanctions(name){return request(`/characters/${encodeURIComponent(name)}/sanctions`);}
async function itemSearch(q){return request(`/items/search?q=${encodeURIComponent(q)}`);}
async function duplicateItems(){return request('/items/duplicates');}
async function itemHistory(serial){return request(`/items/${encodeURIComponent(serial)}/history`);}
async function itemAction(serial,body,headers={}){return request(`/items/${encodeURIComponent(serial)}`,{method:'POST',body,headers});}
async function command(command,target='',arg='',reason='OldKOWeb Control Center command'){return request('/commands',{method:'POST',body:{command,target,arg,reason,source:'oldkoweb-control-center'}});}
async function ban(character,type='ACCOUNT',reason='OldKOWeb Control Center moderation'){return request('/sanctions',{method:'POST',body:{character,type,reason}});}
async function unban(character,type=''){const params=type?`?type=${encodeURIComponent(type)}`:'';return request(`/sanctions/${encodeURIComponent(character)}${params}`,{method:'DELETE',body:{}});}
async function audit(limit=100){return request(`/audit?limit=${encodeURIComponent(limit)}`);}
function status(){return{base,available,authenticated,health:lastHealth,session:lastSession};}

window.OldKOLiveApi={base,request,probe,session,login,logout,overview,players,character,patchCharacter,patchStats,patchSkills,inventory,inn,transactions,sanctions,itemSearch,duplicateItems,itemHistory,itemAction,command,ban,unban,audit,status};
})();
