import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { Reporter } from './lib/reporter.mjs';
import { startBlackbox } from './fixtures/ko-blackbox.mjs';

const out=process.env.QA_ARTIFACT_DIR||'artifacts', root=process.env.QA_CLIENT_DIR||'.qa-target/client';
fs.mkdirSync(out,{recursive:true});
const rep=new Reporter(out), lines=[], pageErrors=[], network=[];
const id=process.env.QA_TEST_ID||`qa${Date.now().toString(36)}`, pw=process.env.QA_TEST_PW||'Qa1298Pass';
const fatalRe=/\[pageerror\]|GL_INVALID_(ENUM|VALUE|OPERATION)|WebGL: INVALID_|WebGL: too many errors|render backend: Null/i;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.data':'application/octet-stream','.png':'image/png'};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://x');let rel=decodeURIComponent(u.pathname).replace(/^\/+/, '')||'index.html';const p=path.resolve(root,rel);if(!p.startsWith(path.resolve(root))||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);return res.end('not found');}res.writeHead(200,{'content-type':mime[path.extname(p)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(p).pipe(res);});
await new Promise((r,j)=>{server.once('error',j);server.listen(18080,'127.0.0.1',r)});
let bb;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1024,height:768}});
page.on('console',m=>{const t=m.text();lines.push(t);fs.appendFileSync(path.join(out,'console.log'),`[${m.type()}] ${t}\n`)});
page.on('pageerror',e=>{pageErrors.push(e.message);fs.appendFileSync(path.join(out,'console.log'),`[pageerror] ${e.stack||e.message}\n`)});
page.on('request',q=>{if(/KnightOnLine|ws:\/\//i.test(q.url()))network.push({kind:'request',method:q.method(),url:q.url(),at:Date.now()})});
page.on('response',q=>{if(/KnightOnLine/i.test(q.url()))network.push({kind:'response',status:q.status(),url:q.url(),at:Date.now()})});
page.on('websocket',w=>{const e={kind:'websocket',url:w.url(),sent:0,received:0,at:Date.now()};network.push(e);w.on('framesent',x=>e.sent+=Buffer.byteLength(x.payload||''));w.on('framereceived',x=>e.received+=Buffer.byteLength(x.payload||''));});
const wait=async(re,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){const hit=lines.find(x=>re.test(x));if(hit)return hit;await page.waitForTimeout(75);}throw new Error(`timeout ${re}`)};
const held=async(k,ms=90)=>{await page.keyboard.down(k);await page.waitForTimeout(ms);await page.keyboard.up(k)};
const visual=async(name)=>{const p=path.join(out,`${name}.png`);await page.screenshot({path:p});const png=PNG.sync.read(fs.readFileSync(p));let n=0;for(let i=0;i<png.data.length;i+=4){if(png.data[i]>10||png.data[i+1]>10||png.data[i+2]>10)n++;}const ratio=n/(png.width*png.height);const gl=await page.evaluate(()=>{const c=document.querySelector('canvas');const g=c?.getContext('webgl2');return {canvas:!!c,webgl2:!!g,error:g?g.getError():null};});return {path:p,ratio, ...gl};};
const markFail=(i,e,ev={})=>rep.fail(i,e instanceof Error?e.message:String(e),ev);
try{
  bb=await startBlackbox({id,pw,nation:2});
  await page.goto('http://127.0.0.1:18080/index.html',{waitUntil:'domcontentloaded',timeout:30000});
  try{const m=await wait(/WASM hazır|WASM_RUNTIME_READY/i,90000);rep.pass(1,'Emscripten runtime initialized',{marker:m});}catch(e){markFail(1,e);}
  try{const m=await wait(/render backend: OpenGL/i,30000);const gl=await page.evaluate(()=>!!document.querySelector('canvas')?.getContext('webgl2'));if(!gl)throw new Error('WebGL2 context missing');rep.pass(2,'OpenGL/WebGL2 renderer active and Null renderer absent',{marker:m,webgl2:gl});}catch(e){markFail(2,e);}
  try{const m=await wait(/login scene: CGameProcedure brought up/i,30000);const v=await visual('M3-login');if(v.ratio<0.01)throw new Error(`login framebuffer effectively black ratio=${v.ratio.toFixed(4)}`);rep.pass(3,'Login procedure is up and visible',{marker:m,visual:v});}catch(e){markFail(3,e);}
  try{await wait(/browser server list entry:/i,30000);await page.locator('canvas').focus();await page.keyboard.type(id,{delay:20});await held('Tab');await page.keyboard.type(pw,{delay:20});await held('Enter');await wait(/browser login response: cmd=0xf3 result=1/i,30000);if(!bb.state.auth.authReq||!bb.state.auth.authMatched||!bb.state.auth.authResp)throw new Error('auth fixture did not observe matched request/response');rep.pass(4,'Credential packet round-trip observed by independent KO stub',{...bb.state.auth});}catch(e){markFail(4,e,{...bb.state?.auth});}
  try{const m=await wait(/server list opened \(1 server\(s\) available\)/i,30000);if(!bb.state.auth.serverListReq||!bb.state.auth.serverListResp)throw new Error('server-list packet round-trip missing');rep.pass(5,'Real client opened a server list after protocol response',{marker:m});}catch(e){markFail(5,e);}
  try{await held('Enter',100);const m=await wait(/connecting to game server .*127\.0\.0\.1:15001/i,20000);await wait(/game server version check answered:/i,20000);if(!bb.state.game.connections&&!bb.state.game.wsConnections)throw new Error('game connection not observed');rep.pass(6,'Client connected to game transport',{marker:m,connections:bb.state.game.connections,wsConnections:bb.state.game.wsConnections});}catch(e){markFail(6,e);}
  try{const m=await wait(/game server version check answered: version=1298 \(client expects 1298\)/i,20000);if(bb.state.game.versionResp!==1298)throw new Error('fixture did not return 1298');rep.pass(7,'1298 version negotiation proven',{marker:m,version:bb.state.game.versionResp});}catch(e){markFail(7,e);}
  try{const m=await wait(/game server login answered: nation=0/i,20000);if(!bb.state.game.loginReq||!bb.state.game.loginMatched||!bb.state.game.loginResp)throw new Error('game login packet chain incomplete');rep.pass(8,'Game-server login request and successful response observed',{marker:m});}catch(e){markFail(8,e);}
  try{const m=await wait(/scene change: login -> nation-select/i,20000);const v=await visual('M9-nation-select');if(v.ratio<0.01)throw new Error(`nation scene effectively black ratio=${v.ratio.toFixed(4)}`);rep.pass(9,'Nation Select reached and rendered',{marker:m,visual:v});}catch(e){markFail(9,e);}
  try{await page.mouse.click(258,495,{delay:120});const m=await wait(/scene change: nation-select -> character-select/i,20000);const v=await visual('M10-character-select');if(v.ratio<0.01)throw new Error(`character select effectively black ratio=${v.ratio.toFixed(4)}`);if(!bb.state.game.allCharReq||!bb.state.game.allCharResp)throw new Error('WIZ_ALLCHAR_INFO_REQ chain missing');rep.pass(10,'Character Select reached with protocol-valid character list response',{marker:m,visual:v});}catch(e){markFail(10,e,{...bb.state?.game});}
  try{await page.locator('canvas').focus();await held('Enter',100);const m=await wait(/scene change: character-select -> character-create/i,20000);const v=await visual('M11-character-create');if(v.ratio<0.01)throw new Error(`character create effectively black ratio=${v.ratio.toFixed(4)}`);rep.pass(11,'Character Create reached and rendered',{marker:m,visual:v});}catch(e){markFail(11,e);}
  try{const m=await wait(/character (?:create response.*result=1|selectable|created.*slot|selected successfully)/i,4000);rep.pass(12,'Created character is selectable',{marker:m});}catch(e){rep.fail(12,'No black-box evidence that a created character persists and becomes selectable',{blocker:'M12 requires a real create->list/select proof'});}
  const m12=rep.data.milestones.M12?.status==='PASS';
  const downstream=[
    [13,/zone transition|scene change: character-select -> (?:game|main)|loading zone/i,'No proven character-to-world zone transition'],
    [14,/Moradon|zone(?: id)?[=: ]21|terrain.*loaded/i,'No proven Moradon terrain render'],
    [15,/player.*spawn|spawned.*player|myself.*spawn/i,'No proven local player spawn'],
    [16,/movement.*(?:ok|position)|position changed|input.*movement/i,'No proven movement/input changes world state']
  ];
  for(const [n,re,msg] of downstream){if(!m12){rep.fail(n,msg,{blockedBy:'M12'});continue;}try{const m=await wait(re,10000);rep.pass(n,msg.replace('No proven','Proven'),{marker:m});}catch(e){markFail(n,e);}}
  const fat=[...lines.filter(x=>fatalRe.test(x)),...pageErrors];
  if(fat.length){for(let i=2;i<=16;i++){if(rep.data.milestones[`M${i}`]?.status==='PASS')rep.fail(i,'Fatal browser/WebGL error invalidated prior evidence',{fatal:fat.slice(0,20)});}}
}catch(e){fs.appendFileSync(path.join(out,'harness-error.log'),`${e.stack||e}\n`);for(let i=1;i<=16;i++)if(!rep.data.milestones[`M${i}`])rep.fail(i,'Harness aborted before milestone evidence',{error:e.message});}
finally{
  fs.writeFileSync(path.join(out,'network.json'),JSON.stringify(network,null,2)+'\n');
  if(bb)fs.writeFileSync(path.join(out,'service-state.json'),JSON.stringify(bb.state,null,2)+'\n');
  await browser.close().catch(()=>{}); if(bb)await bb.close().catch(()=>{}); await new Promise(r=>server.close(r));
}
