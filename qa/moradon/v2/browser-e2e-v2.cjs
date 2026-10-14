'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { RealBrowserInput } = require('./real-browser-input.cjs');

const parseIds=(value)=>new Set(String(value||'').split(',').map((x)=>Number(x.trim())).filter(Number.isInteger));
const out=process.env.QA_ARTIFACT_DIR||'artifacts/moradon-v2';
const url=process.env.WS10_CLIENT_URL||'http://127.0.0.1:8000/ws10-moradon.html';
const providerSet=process.env.WS10_PROVIDER_SET;
const npcIds=parseIds(process.env.WS10_V2_REQUIRED_NPC_IDS);
const mobIds=parseIds(process.env.WS10_V2_REQUIRED_MOB_IDS);
const username=process.env.WS10_TEST_ID||'ws10e2e';
const password=process.env.WS10_TEST_PW||'ws10pass';
const charName=process.env.WS10_CHAR_NAME||'Ws10Hero';
const runtimeTimeoutMs=Number(process.env.WS10_RUNTIME_TIMEOUT_MS||300000);
const worldTimeoutMs=Number(process.env.WS10_WORLD_TIMEOUT_MS||600000);
if(!providerSet||!/^WS50-[A-Z0-9]+@sha256:[0-9a-f]{64}$/.test(providerSet)) throw new Error('WS10_PROVIDER_SET exact immutable ID required');
if(!npcIds.size||!mobIds.size) throw new Error('authoritative NPC and mob runtime ID sets are required');
fs.mkdirSync(out,{recursive:true});

const lines=[];const network=[];let crashed=false,closed=false;
const sleep=(ms)=>new Promise((r)=>setTimeout(r,ms));
const has=(needle)=>lines.some((line)=>line.includes(needle));
const wait=async(needle,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){const found=lines.find((line)=>line.includes(needle));if(found)return found;if(crashed||closed)throw new Error(`browser unavailable waiting for ${needle}`);await sleep(75);}throw new Error(`timeout waiting for ${needle}`);};
const waitAnyVisible=async(ids,timeout=worldTimeoutMs)=>{const end=Date.now()+timeout;while(Date.now()<end){for(const id of ids){if(has(`WS10_VISIBILITY_V2 HUMAN_VISIBLE id=${id} `)||has(`WS10_VISIBILITY_V2 HUMAN_VISIBLE id=${id}\n`))return id;}if(crashed||closed)throw new Error('browser unavailable waiting for human-visible entity');await sleep(100);}throw new Error(`no authoritative ID became human-visible: ${[...ids].join(',')}`);};
function ppmToPng(buffer){let nl=0,start=-1;for(let i=0;i<Math.min(buffer.length,256);i++){if(buffer[i]===10&&++nl===3){start=i+1;break;}}if(start<0)throw new Error('invalid native GL PPM header');const h=buffer.subarray(0,start).toString('ascii').trim().split(/\s+/);const width=Number(h[1]),height=Number(h[2]),rgb=buffer.subarray(start);if(h[0]!=='P6'||h[3]!=='255'||rgb.length!==width*height*3)throw new Error('invalid native GL PPM payload');const png=new PNG({width,height});for(let s=0,d=0;s<rgb.length;s+=3,d+=4){png.data[d]=rgb[s];png.data[d+1]=rgb[s+1];png.data[d+2]=rgb[s+2];png.data[d+3]=255;}return png;}

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1024,height:768}});
 page.on('console',(m)=>{const t=m.text();lines.push(t);console.log(`[console:${m.type()}] ${t}`);});
 page.on('pageerror',(e)=>{const t=`[pageerror] ${e.stack||e.message}`;lines.push(t);console.error(t);});
 page.on('crash',()=>{crashed=true;lines.push('[pagecrash] Chromium renderer crashed');});page.on('close',()=>{closed=true;});
 page.on('websocket',(ws)=>{const r={url:ws.url(),sent:0,received:0};network.push(r);ws.on('framesent',(f)=>r.sent+=Buffer.byteLength(f.payload||''));ws.on('framereceived',(f)=>r.received+=Buffer.byteLength(f.payload||''));});
 const input=new RealBrowserInput(page,(e)=>console.log(`[ws10-driver] WS10_REAL_INPUT ${JSON.stringify(e)}`));
 const collectCapture=async(id,fileName)=>{const marker=await wait(`WS04_GL_CAPTURE id=${id} ok=1`,worldTimeoutMs);if(!marker.includes('source=present'))throw new Error('capture not from Present');const ready=await page.evaluate(()=>globalThis.WS04_CAPTURE_READY||0);if(ready!==id)throw new Error(`capture ready mismatch ${ready}`);const b64=await page.evaluate((requestId)=>{const bytes=Module.FS.readFile(`/ws04-frame-${requestId}.ppm`);let binary='';for(let off=0;off<bytes.length;off+=0x8000)binary+=String.fromCharCode(...bytes.subarray(off,Math.min(off+0x8000,bytes.length)));return btoa(binary);},id);const png=ppmToPng(Buffer.from(b64,'base64'));let nonBlack=0;for(let i=0;i<png.data.length;i+=4)if(png.data[i]>10||png.data[i+1]>10||png.data[i+2]>10)nonBlack++;const ratio=nonBlack/(png.width*png.height);fs.writeFileSync(path.join(out,fileName),PNG.sync.write(png));return{width:png.width,height:png.height,nonBlack,ratio};};
 let result={status:'FAIL',providerSet};
 try{
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await wait('WASM_RUNTIME_READY',runtimeTimeoutMs);await wait('render backend: OpenGL',30000);await page.locator('#canvas').focus();
   await input.typeText(username,{phase:'login-id'});await input.hold('Tab',90,{phase:'login-tab'});await input.typeText(password,{phase:'login-password'});await input.hold('Enter',90,{phase:'login-submit'});
   await wait('server list opened',45000);await input.hold('Enter',100,{phase:'server-select'});await wait('game server version check answered: version=1298',45000);await wait('game server login answered: nation=0',45000);await wait('scene change: login -> nation-select',30000);
   await input.click(258,495,{phase:'nation-select'});await wait('scene change: nation-select -> character-select',30000);await wait('WS04_CHAR_LIST parsed result=1 slots=3 occupied=0',30000);await page.locator('#canvas').focus();await input.hold('Enter',100,{phase:'open-create'});await wait('scene change: character-select -> character-create',30000);await wait('WS04_CHAR_CREATE_UI',15000);
   await input.click(170,145,{phase:'create-race'});await sleep(500);await input.click(170,325,{phase:'create-class'});await sleep(1200);for(let i=0;i<12;i++){await input.click(925,114,{phase:'create-stat'});await sleep(100);}await input.click(510,678,{phase:'create-name'});await page.keyboard.press('Control+A');await input.typeText(charName,{phase:'create-name'});await input.click(170,690,{phase:'create-submit'});
   await wait('WS04_CHAR_CREATE_SENT opcode=0x02',15000);await wait('WS04_CHAR_CREATE_RESPONSE code=0',30000);await wait('scene change: character-create -> character-select',30000);await wait('WS04_CHAR_LIST parsed result=1 slots=3 occupied=1',30000);await page.locator('#canvas').focus();await input.hold('Enter',100,{phase:'character-select'});await wait('WS04_CHAR_SELECT_RESPONSE success=1',30000);
   await wait('WS05_GATE event=moradon-terrain-rendered zone=21',worldTimeoutMs);await wait('WS05_GATE event=moradon-shapes-rendered zone=21',worldTimeoutMs);await wait('WS05_GATE event=moradon-local-player-rendered zone=21',worldTimeoutMs);await wait('WS10_VISIBILITY DETAIL_RECORD',worldTimeoutMs);
   await page.locator('#canvas').focus();await input.hold('w',650,{phase:'world-movement'});await input.hold('ArrowUp',650,{phase:'world-movement'});console.log('WS10_BROWSER_MOVEMENT_INPUT complete=1');
   const npc=await waitAnyVisible(npcIds);const mob=await waitAnyVisible(mobIds);console.log(`[ws10-driver] WS10_VISIBILITY_V2_ENTITY_PAIR npc=${npc} mob=${mob}`);
   const captureId=3030;await page.evaluate((id)=>{globalThis.WS04_CAPTURE_READY=0;globalThis.WS04_CAPTURE_INFLIGHT=0;globalThis.WS04_CAPTURE_PRESENT_ONLY=1;globalThis.WS04_CAPTURE_REQUEST=id;},captureId);console.log(`[ws10-driver] WS10_VISIBILITY_V2_CAPTURE_ARMED id=${captureId} mode=present-only`);
   const frame=await collectCapture(captureId,'moradon-visibility-v2-native.png');console.log(`[ws10-driver] WS10_VISIBILITY_V2_CAPTURE_OK source=pre-swap-gl id=${captureId} npc=${npc} mob=${mob} artifact=moradon-visibility-v2-native.png ratio=${frame.ratio.toFixed(4)}`);
   const fatal=lines.filter((l)=>/\[pageerror\]|\[pagecrash\]|GL_INVALID_(ENUM|VALUE|OPERATION)|WebGL: INVALID_|WebGL: too many errors|render backend: Null/i.test(l));if(fatal.length)throw new Error(`fatal renderer evidence: ${fatal.slice(0,3).join(' | ')}`);
   result={status:'PASS',providerSet,npc,mob,frame,acceptance:'entity-specific-pixel-proof'};console.log(`WS10_VISIBILITY_V2_BROWSER_PASS provider_set=${providerSet}`);
 }catch(error){result={status:'FAIL',providerSet,error:error.message};console.error(`[ws10-driver] failure: ${error.stack||error.message}`);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'browser-console-v2.log'),lines.join('\n')+'\n');fs.writeFileSync(path.join(out,'network-v2.json'),JSON.stringify(network,null,2)+'\n');fs.writeFileSync(path.join(out,'browser-result-v2.json'),JSON.stringify(result,null,2)+'\n');if(!closed)await page.screenshot({path:path.join(out,'final-compositor-v2.png')}).catch(()=>{});await browser.close();}
})().catch((e)=>{console.error(e.stack||e.message);process.exitCode=1;});
