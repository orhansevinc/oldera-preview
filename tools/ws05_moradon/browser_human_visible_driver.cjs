#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const {RealBrowserInput}=require(path.resolve(process.env.WS10_REAL_INPUT));

const out=process.env.QA_ARTIFACT_DIR||'artifacts/ws05-human-visible';
const url=process.env.WS05_CLIENT_URL||'http://127.0.0.1:8000/ws05-human-visible.html';
const username=process.env.WS05_TEST_ID||'ws05e2e';
const password=process.env.WS05_TEST_PW||'ws05pass';
const charName=process.env.WS05_CHAR_NAME||'Ws05Hero';
const bandicootIds=new Set(String(process.env.WS05_BANDICOOT_IDS||'').split(',').map(Number).filter(Number.isInteger));
const npcIds=new Set(String(process.env.WS05_NPC_IDS||'').split(',').map(Number).filter(Number.isInteger));
if(!bandicootIds.size) throw new Error('WS05_BANDICOOT_IDS required');
fs.mkdirSync(out,{recursive:true});

const lines=[],network=[],inputs=[];let crashed=false,closed=false;
const sleep=(ms)=>new Promise((r)=>setTimeout(r,ms));
const has=(needle)=>lines.some((l)=>l.includes(needle));
const wait=async(needle,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){const f=lines.find((l)=>l.includes(needle));if(f)return f;if(crashed||closed)throw new Error(`browser unavailable waiting for ${needle}`);await sleep(75);}throw new Error(`timeout waiting for ${needle}`);};
const visibleLine=(id)=>lines.find((l)=>l.includes(`WS10_VISIBILITY_V2 HUMAN_VISIBLE id=${id} `));
const waitAnyVisible=async(ids,timeout)=>{const end=Date.now()+timeout;while(Date.now()<end){for(const id of ids){const line=visibleLine(id);if(line)return{id,line};}if(crashed||closed)throw new Error('browser unavailable');await sleep(100);}return null;};
function parseVisible(line){const o={};for(const k of ['id','changed','area','x','y','w','h','depth']){const m=line.match(new RegExp(`${k}=(-?[0-9.]+)`));if(m)o[k]=Number(m[1]);}return o;}
function ppmToPng(buffer){let nl=0,start=-1;for(let i=0;i<Math.min(buffer.length,256);i++){if(buffer[i]===10&&++nl===3){start=i+1;break;}}if(start<0)throw new Error('invalid native PPM header');const h=buffer.subarray(0,start).toString('ascii').trim().split(/\s+/),width=Number(h[1]),height=Number(h[2]),rgb=buffer.subarray(start);if(h[0]!=='P6'||h[3]!=='255'||rgb.length!==width*height*3)throw new Error('invalid PPM');const png=new PNG({width,height});for(let s=0,d=0;s<rgb.length;s+=3,d+=4){png.data[d]=rgb[s];png.data[d+1]=rgb[s+1];png.data[d+2]=rgb[s+2];png.data[d+3]=255;}return png;}

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1024,height:768}});
 page.on('console',(m)=>{const t=m.text();lines.push(t);console.log(`[console:${m.type()}] ${t}`);});
 page.on('pageerror',(e)=>{const t=`[pageerror] ${e.stack||e.message}`;lines.push(t);console.error(t);});
 page.on('crash',()=>{crashed=true;lines.push('[pagecrash] Chromium renderer crashed');});page.on('close',()=>{closed=true;});
 page.on('websocket',(ws)=>{const r={url:ws.url(),sent:0,received:0};network.push(r);ws.on('framesent',(f)=>r.sent+=Buffer.byteLength(f.payload||''));ws.on('framereceived',(f)=>r.received+=Buffer.byteLength(f.payload||''));});
 const input=new RealBrowserInput(page,(e)=>{inputs.push(e);console.log(`[ws05-driver] WS05_REAL_INPUT ${JSON.stringify(e)}`);});
 const captureNative=async(id)=>{
   await page.evaluate((captureId)=>{globalThis.WS04_CAPTURE_READY=0;globalThis.WS04_CAPTURE_INFLIGHT=0;globalThis.WS04_CAPTURE_PRESENT_ONLY=1;globalThis.WS04_CAPTURE_REQUEST=captureId;},id);
   console.log(`[ws05-driver] WS05_NATIVE_CAPTURE_ARMED id=${id} mode=present-only`);
   const marker=await wait(`WS04_GL_CAPTURE id=${id} ok=1`,60000);if(!marker.includes('source=present'))throw new Error('capture not from native Present');
   const ready=await page.evaluate(()=>globalThis.WS04_CAPTURE_READY||0);if(ready!==id)throw new Error(`capture ready mismatch ${ready}`);
   const b64=await page.evaluate((requestId)=>{const bytes=Module.FS.readFile(`/ws04-frame-${requestId}.ppm`);let binary='';for(let off=0;off<bytes.length;off+=0x8000)binary+=String.fromCharCode(...bytes.subarray(off,Math.min(off+0x8000,bytes.length)));return btoa(binary);},id);
   const png=ppmToPng(Buffer.from(b64,'base64'));let nonBlack=0;for(let i=0;i<png.data.length;i+=4)if(png.data[i]>10||png.data[i+1]>10||png.data[i+2]>10)nonBlack++;
   const ratio=nonBlack/(png.width*png.height);const file='ws05-bandicoot-native.png';fs.writeFileSync(path.join(out,file),PNG.sync.write(png));
   if(ratio<0.02)throw new Error(`native frame black ratio=${ratio}`);
   return{file,width:png.width,height:png.height,nonBlack,ratio};
 };
 let result={status:'FAIL'};
 try{
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await wait('WASM_RUNTIME_READY',120000);await wait('render backend: OpenGL',30000);await page.locator('#canvas').focus();
   await input.typeText(username,{phase:'login-id'});await input.hold('Tab',90,{phase:'login-tab'});await input.typeText(password,{phase:'login-password'});await input.hold('Enter',90,{phase:'login-submit'});
   await wait('server list opened',45000);await input.hold('Enter',100,{phase:'server-select'});await wait('game server version check answered: version=1298',45000);await wait('game server login answered: nation=0',45000);await wait('scene change: login -> nation-select',30000);
   await input.click(258,495,{phase:'nation-select'});await wait('scene change: nation-select -> character-select',30000);await wait('WS04_CHAR_LIST parsed result=1 slots=3 occupied=0',30000);await page.locator('#canvas').focus();await input.hold('Enter',100,{phase:'open-create'});await wait('scene change: character-select -> character-create',30000);await wait('WS04_CHAR_CREATE_UI',15000);
   await input.click(170,145,{phase:'create-race'});await sleep(500);await input.click(170,325,{phase:'create-class'});await sleep(1200);for(let i=0;i<12;i++){await input.click(925,114,{phase:'create-stat'});await sleep(100);}await input.click(510,678,{phase:'create-name'});await page.keyboard.press('Control+A');await input.typeText(charName,{phase:'create-name'});await input.click(170,690,{phase:'create-submit'});
   await wait('WS04_CHAR_CREATE_SENT opcode=0x02',15000);await wait('WS04_CHAR_CREATE_RESPONSE code=0',30000);await wait('scene change: character-create -> character-select',30000);await wait('WS04_CHAR_LIST parsed result=1 slots=3 occupied=1',30000);await page.locator('#canvas').focus();await input.hold('Enter',100,{phase:'character-select'});await wait('WS04_CHAR_SELECT_RESPONSE success=1',30000);
   await wait('WS05_GATE event=moradon-terrain-rendered zone=21',300000);await wait('WS05_GATE event=moradon-shapes-rendered zone=21',300000);await wait('WS05_GATE event=moradon-local-player-rendered zone=21',300000);
   const npc=await waitAnyVisible(npcIds,90000);
   if(npc)console.log(`[ws05-driver] WS05_NPC_HUMAN_VISIBLE id=${npc.id}`);
   await page.locator('#canvas').focus();
   // Source-backed path: WS14 starts at (312,0,402), direction=0. CPlayerBase turns at 270 deg/s.
   // A ~0.5s left turn points roughly southwest toward the nearest genuine Bandicoot spawn rectangle.
   await input.hold('ArrowLeft',500,{phase:'approach-bandicoot-turn'});
   let mob=null;
   for(let leg=0;leg<8&&!mob;leg++){
     await input.hold('ArrowUp',3000,{phase:'approach-bandicoot',leg});
     console.log(`[ws05-driver] WS05_APPROACH leg=${leg} source=playwright.keyboard`);
     mob=await waitAnyVisible(bandicootIds,1500);
   }
   if(!mob)throw new Error(`no Bandicoot became human-visible after genuine movement: ${[...bandicootIds].join(',')}`);
   const v=parseVisible(mob.line);if(v.w<24||v.h<24||v.changed<12)throw new Error(`Bandicoot visibility below human-selectable threshold ${JSON.stringify(v)}`);
   const load=await wait('WS05_BANDICOOT_ASSET_LOAD pid=800',30000);
   for(const token of ['load_ok=1','joint=1','animation=1','part_count=4','parts=4','skins=4','textures=4'])if(!load.includes(token))throw new Error(`Bandicoot asset load missing ${token}: ${load}`);
   const bounds=lines.filter((l)=>l.includes(`WS10_VISIBILITY_V2 BOUNDS id=${mob.id} `)).at(-1)||'';
   if(!bounds.includes('transform=valid')||!bounds.includes('front=1')||!bounds.includes('frustum=1')||!bounds.includes('screen=1'))throw new Error(`Bandicoot bounds/camera/frustum invalid: ${bounds}`);
   const frame=await captureNative(5050);
   const fatal=lines.filter((l)=>/\[pageerror\]|\[pagecrash\]|GL_INVALID_(ENUM|VALUE|OPERATION)|WebGL: INVALID_|WebGL: too many errors|render backend: Null/i.test(l));if(fatal.length)throw new Error(`fatal renderer evidence ${fatal.slice(0,3).join(' | ')}`);
   result={status:'PASS',bandicoot:{id:mob.id,visible:v,bounds,assetLoad:load},npc:npc?{id:npc.id,visible:parseVisible(npc.line)}:null,frame,inputCount:inputs.length,acceptance:'native-entity-specific-pixel-proof-human-selectable'};
   console.log(`[ws05-driver] WS05_BANDICOOT_HUMAN_VISIBLE id=${mob.id} w=${v.w} h=${v.h} changed=${v.changed}`);
   console.log(`[ws05-driver] WS05_HUMAN_VISIBLE_BROWSER_PASS bandicoot=${mob.id} screenshot=${frame.file}`);
 }catch(e){result={status:'FAIL',error:e.message};console.error(`[ws05-driver] failure: ${e.stack||e.message}`);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'browser-console.log'),lines.join('\n')+'\n');fs.writeFileSync(path.join(out,'network.json'),JSON.stringify(network,null,2)+'\n');fs.writeFileSync(path.join(out,'real-input.json'),JSON.stringify(inputs,null,2)+'\n');fs.writeFileSync(path.join(out,'browser-result.json'),JSON.stringify(result,null,2)+'\n');if(!closed)await page.screenshot({path:path.join(out,'final-compositor.png')}).catch(()=>{});await browser.close();}
})().catch((e)=>{console.error(e.stack||e.message);process.exitCode=1;});
