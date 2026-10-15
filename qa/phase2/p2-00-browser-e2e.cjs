'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async()=>{
  const out=process.env.P2_QA_OUT||'artifacts/phase2-qa/local-browser';
  const url=process.env.P2_PLAY_URL||'http://play.oldkoweb.com:18088/';
  const username=process.env.P2_QA_USER||'p2e2e';
  const password=process.env.P2_QA_PASSWORD||'p2e2epass';
  const charName=process.env.P2_QA_CHAR||'P2Hero';
  const worldTimeout=Number(process.env.P2_WORLD_TIMEOUT_MS||600000);
  fs.mkdirSync(out,{recursive:true});
  const lines=[]; const sockets=[]; const errors=[];
  const browser=await chromium.launch({headless:true,args:[
    '--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist',
    '--host-resolver-rules=MAP play.oldkoweb.com 127.0.0.1'
  ]});
  const page=await browser.newPage({viewport:{width:1024,height:768}});
  page.on('console',m=>{const t=m.text();lines.push(t);console.log(`[console:${m.type()}] ${t}`);});
  page.on('pageerror',e=>{errors.push(String(e.stack||e));console.error(e);});
  page.on('websocket',ws=>{const r={url:ws.url(),sent:0,received:0};sockets.push(r);ws.on('framesent',f=>r.sent+=Buffer.byteLength(f.payload||''));ws.on('framereceived',f=>r.received+=Buffer.byteLength(f.payload||''));});
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const has=n=>lines.some(x=>x.includes(n));
  async function waitLine(needle,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){if(has(needle))return lines.find(x=>x.includes(needle));if(errors.length)throw new Error(`browser error while waiting for ${needle}: ${errors[0]}`);await sleep(100);}throw new Error(`timeout waiting for ${needle}`);}
  async function held(key,ms=100){await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);}
  async function click(x,y){await page.mouse.click(x,y,{delay:100});await page.waitForTimeout(250);}
  const result={schema:'oldkoweb/p2-00-browser-e2e/v1',status:'FAIL',url,username,charName};
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    const isolation=await page.evaluate(()=>({crossOriginIsolated,bridge:globalThis.__OLDKOWEB_PHASE2_BRIDGE__||null}));
    if(!isolation.crossOriginIsolated)throw new Error('pthread browser candidate is not crossOriginIsolated');
    if(!isolation.bridge||isolation.bridge.nativeWorldReadyGate!=='WS05_GATE event=moradon-local-player-rendered zone=21')throw new Error('P2-00 native world-ready bridge missing');
    await waitLine('render backend: OpenGL',90000);
    await page.locator('#canvas').focus();
    await page.keyboard.type(username,{delay:20});
    await held('Tab'); await page.keyboard.type(password,{delay:20}); await held('Enter');
    await waitLine('server list opened',60000); await held('Enter');
    await waitLine('game server version check answered: version=1298',60000);
    await waitLine('game server login answered: nation=0',60000);
    await waitLine('scene change: login -> nation-select',60000);
    await click(258,495);
    await waitLine('scene change: nation-select -> character-select',60000);
    await waitLine('WS04_CHAR_LIST parsed result=1 slots=3 occupied=0',60000);
    await page.locator('#canvas').focus(); await held('Enter');
    await waitLine('scene change: character-select -> character-create',60000);
    await waitLine('WS04_CHAR_CREATE_UI',30000);
    await click(170,145); await click(170,325);
    for(let i=0;i<12;i++){await page.mouse.click(925,114,{delay:60});await page.waitForTimeout(80);}
    await click(510,678); await page.keyboard.press('Control+A'); await page.keyboard.type(charName,{delay:20}); await click(170,690);
    await waitLine('WS04_CHAR_CREATE_RESPONSE code=0',60000);
    await waitLine('scene change: character-create -> character-select',60000);
    await waitLine('WS04_CHAR_LIST parsed result=1 slots=3 occupied=1',60000);
    await page.locator('#canvas').focus(); await held('Enter');
    await waitLine('WS04_CHAR_SELECT_RESPONSE success=1',60000);
    await waitLine('WS05_GATE event=moradon-zone-begin zone=21',worldTimeout);
    await waitLine('WS05_GATE event=moradon-assets-loaded zone=21',worldTimeout);
    await waitLine('WS05_GATE event=moradon-terrain-rendered zone=21',worldTimeout);
    await waitLine('WS05_GATE event=moradon-shapes-rendered zone=21',worldTimeout);
    await waitLine('WS05_GATE event=moradon-local-player-rendered zone=21',worldTimeout);
    await page.waitForFunction(()=>globalThis.__OLDKOWEB_LOAD_METRICS__?.first_controllable_frame_ms>0,{timeout:30000});
    await page.locator('#canvas').focus(); await held('w',700); await held('ArrowUp',500); await page.waitForTimeout(1000);
    await page.mouse.click(500,400); // physical user gesture for native WebAudio unlock
    await page.waitForTimeout(500);
    const runtime=await page.evaluate(()=>({
      loaderHidden:document.getElementById('loader')?.hidden===true,
      load:globalThis.oldkowebLoadingSnapshot?.()||null,
      render:globalThis.__OLDKO_RENDER_METRICS__||null,
      canvas:{width:Module.canvas.width,height:Module.canvas.height,cssWidth:Module.canvas.getBoundingClientRect().width,cssHeight:Module.canvas.getBoundingClientRect().height},
      audioState:(()=>{try{return globalThis.Module?.SDL2?.audioContext?.state||globalThis.AL?.currentContext?.ctx?.state||globalThis.AL?.currentContext?.audioCtx?.state||null;}catch(_){return null;}})()
    }));
    if(!runtime.loaderHidden)throw new Error('loader did not close from native world-ready proof');
    if(!runtime.render||Number(runtime.render.renderScale)<1)throw new Error('P2-03 render metrics missing/invalid');
    if(runtime.canvas.width<runtime.canvas.cssWidth||runtime.canvas.height<runtime.canvas.cssHeight)throw new Error('canvas backing store is below logical viewport');
    if(!sockets.some(s=>s.url.includes('/auth')&&s.received>0)||!sockets.some(s=>s.url.includes('/game')&&s.received>0))throw new Error('auth/game WebSocket traffic not proven');
    if(errors.length)throw new Error(`browser errors: ${errors.join(' | ')}`);
    await page.screenshot({path:path.join(out,'play.png')});
    const shot=fs.statSync(path.join(out,'play.png'));
    if(shot.size<10000)throw new Error(`game screenshot unexpectedly small: ${shot.size}`);
    Object.assign(result,{status:'PASS',isolation,runtime,sockets,screenshotBytes:shot.size,nativeWorldReady:true,movementInput:true,audioRuntimeState:runtime.audioState||'UNOBSERVED'});
    console.log('OLDKOWEB_P2_BROWSER_E2E_PASS');
  }catch(error){result.error=String(error.stack||error);process.exitCode=1;console.error(result.error);}
  finally{
    fs.writeFileSync(path.join(out,'console.log'),lines.join('\n')+'\n');
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
    await browser.close();
  }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
