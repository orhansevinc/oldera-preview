'use strict';
const PREFIX='oldkoweb-runtime-v1-';
let active='',previous='';
const SENSITIVE=['/api/','/auth','/game','/admin','/account'];
const RUNTIME=new Set(['/real1298/KnightOnLine.js','/real1298/KnightOnLine.wasm','/real1298/KnightOnLine.data']);
const nameOf=u=>u.pathname.split('/').pop();
function post(id,payload){if(!id)return;self.clients.get(id).then(c=>c&&c.postMessage(payload)).catch(()=>{});}
function meta(u){const sha=(u.searchParams.get('sha256')||'').toLowerCase(),bytes=Number(u.searchParams.get('bytes')||0),cv=u.searchParams.get('cv')||'';return /^[a-f0-9]{64}$/.test(sha)&&Number.isSafeInteger(bytes)&&bytes>0&&cv?{sha,bytes,cv}:null;}
function sensitive(path){return SENSITIVE.some(p=>path===p||path.startsWith(p));}
function eligible(req){if(req.method!=='GET'||req.headers.has('range'))return false;const u=new URL(req.url);return u.origin===self.location.origin&&!sensitive(u.pathname)&&RUNTIME.has(u.pathname)&&!!meta(u);}
const cacheName=v=>PREFIX+v;
async function cleanup(){const keep=new Set([active,previous].filter(Boolean).map(cacheName));for(const n of await caches.keys())if(n.startsWith(PREFIX)&&!keep.has(n))await caches.delete(n);}
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{await self.clients.claim();await cleanup();})()));
self.addEventListener('message',e=>{const m=e.data||{};if(m.type!=='OLDKOWEB_SET_VERSION')return;active=String(m.active||'');previous=String(m.previous||'');e.waitUntil(cleanup());});
async function serve(req,clientId){const u=new URL(req.url),m=meta(u),cache=await caches.open(cacheName(m.cv));try{const hit=await cache.match(req);if(hit&&hit.status===200){post(clientId,{type:'OLDKOWEB_CACHE_RESULT',cache:'hit',file:nameOf(u),bytes:m.bytes});return hit;}if(hit)await cache.delete(req);}catch(e){post(clientId,{type:'OLDKOWEB_CACHE_ERROR',message:`cache-read: ${String(e&&e.message||e)}`});}
post(clientId,{type:'OLDKOWEB_CACHE_RESULT',cache:'miss',file:nameOf(u),bytes:m.bytes});const response=await fetch(req);if(response.status===200){try{await cache.put(req,response.clone());}catch(e){post(clientId,{type:'OLDKOWEB_CACHE_ERROR',message:`cache-put: ${String(e&&e.message||e)}`});}}return response;}
self.addEventListener('fetch',e=>{const req=e.request,u=new URL(req.url);if(!eligible(req)){if(u.origin===self.location.origin&&sensitive(u.pathname))post(e.clientId,{type:'OLDKOWEB_CACHE_RESULT',cache:'bypass',file:u.pathname});return;}e.respondWith(serve(req,e.clientId).catch(err=>{post(e.clientId,{type:'OLDKOWEB_CACHE_ERROR',message:`network-fallback: ${String(err&&err.message||err)}`});return fetch(req);}));});
