(()=>{
'use strict';

const NATIVE_WORLD_READY='WS05_GATE event=moradon-local-player-rendered zone=21';
const originalLog=console.log.bind(console);
let worldReady=false;
let audioUnlocked=false;

function emitWorldReady(line){
  if(worldReady||!String(line||'').includes(NATIVE_WORLD_READY))return;
  worldReady=true;
  window.dispatchEvent(new CustomEvent('oldkoweb:world-ready',{
    detail:{source:'native-openko-render',gate:'WS05_LOCAL_PLAYER_RENDERED',zoneId:21}
  }));
}

console.log=(...args)=>{
  originalLog(...args);
  if(!worldReady)emitWorldReady(args.map(v=>typeof v==='string'?v:String(v)).join(' '));
};

async function resumeAudioContext(){
  if(audioUnlocked)return;
  const candidates=[];
  try{if(globalThis.Module&&Module.SDL2&&Module.SDL2.audioContext)candidates.push(Module.SDL2.audioContext);}catch(_){}
  try{if(globalThis.AL&&AL.currentContext&&AL.currentContext.ctx)candidates.push(AL.currentContext.ctx);}catch(_){}
  try{if(globalThis.AL&&AL.currentContext&&AL.currentContext.audioCtx)candidates.push(AL.currentContext.audioCtx);}catch(_){}
  let found=false;
  for(const context of candidates){
    if(!context||typeof context.resume!=='function')continue;
    found=true;
    try{if(context.state==='suspended')await context.resume();}catch(error){originalLog('[OldKOWeb] audio resume deferred',String(error&&error.message||error));}
    if(context.state==='running')audioUnlocked=true;
  }
  if(found&&audioUnlocked)originalLog('[OldKOWeb] native browser audio context running');
}

const unlock=()=>{void resumeAudioContext();};
window.addEventListener('pointerdown',unlock,{passive:true});
window.addEventListener('keydown',unlock,{passive:true});
window.__OLDKOWEB_PHASE2_BRIDGE__=Object.freeze({
  version:1,
  nativeWorldReadyGate:NATIVE_WORLD_READY,
  audioMode:'native-openal-user-gesture'
});
})();
