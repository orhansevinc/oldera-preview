(()=>{'use strict';
const W=1024,H=768,ASPECT=W/H;
const Native=window.__OldERANativeThree||{WebGLRenderer:THREE.WebGLRenderer,PerspectiveCamera:THREE.PerspectiveCamera};
const rt={renderer:null,camera:null,player:null,input:null,terrain:null,mods:null,clickTarget:null,last:performance.now(),motion:'',started:false};
const nativeAdd=window.addEventListener.bind(window);

function fit(){
  const s=Math.min(innerWidth/W,innerHeight/H);
  for(const id of ['stage','worldStage','canvasWrap']){
    const e=document.getElementById(id);if(!e)continue;
    e.style.width=W+'px';e.style.height=H+'px';e.style.left='50%';e.style.top='50%';
    e.style.transform=`translate(-50%,-50%) scale(${s})`;e.style.transformOrigin='center center';
  }
}
function worldOn(){return document.getElementById('world')?.classList.contains('on')}
function worldRenderer(){
  const R=Native.WebGLRenderer;
  function WR(...args){const r=new R(...args),set=r.setSize.bind(r);rt.renderer=r;r.setSize=()=>set(W,H,false);set(W,H,false);return r}
  WR.prototype=R.prototype;Object.setPrototypeOf(WR,R);return WR;
}
function worldCamera(){
  const C=Native.PerspectiveCamera;
  function WC(fov,aspect,near,far){const c=new C(fov,ASPECT,near,far),upd=c.updateProjectionMatrix.bind(c);rt.camera=c;c.updateProjectionMatrix=function(){this.aspect=ASPECT;return upd()};c.updateProjectionMatrix();return c}
  WC.prototype=C.prototype;Object.setPrototypeOf(WC,C);return WC;
}
function attachActor(){const cs=window.OldERACharScene;if(!cs||cs.__v42Actor)return;cs.__v42Actor=true;const load=cs.loadCharacter?.bind(cs);if(load)cs.loadCharacter=async(...a)=>{const ctl=await load(...a);if(ctl?.group)ctl.group.userData.actor1298=ctl;return ctl}}
function patchWorldStart(){const w=window.OldERAWorld;if(!w||w.__v42Start)return;w.__v42Start=true;const original=w.start.bind(w);w.start=function(options){
  const oldR=THREE.WebGLRenderer,oldC=THREE.PerspectiveCamera;
  THREE.WebGLRenderer=worldRenderer();THREE.PerspectiveCamera=worldCamera();
  let p;try{p=original(options)}finally{THREE.WebGLRenderer=oldR;THREE.PerspectiveCamera=oldC}
  return Promise.resolve(p).then(async v=>{fit();w.hideAllPanels?.();try{await initEngine()}catch(e){rt.started=false;console.error('[OldERA] source movement init failed; keeping Moradon alive',e)}return v});
}}
async function initEngine(){if(!window.OldERAWorld?.avatar||!window.OldERAData?.gtd)return;if(!rt.mods){const base=document.baseURI;const [p,t]=await Promise.all([import(new URL('engine1298/player.js?v=43',base)),import(new URL('engine1298/terrain.js?v=43',base))]);rt.mods={p,t};rt.input=new p.Input1298()}const gtd=await OldERAData.gtd();rt.terrain=new rt.mods.t.N3Terrain1298(gtd);const a=OldERAWorld.avatar;rt.player=new rt.mods.p.Player1298({x:a.position.x,y:a.position.y,z:a.position.z,yaw:a.rotation.y||Math.PI});rt.clickTarget=null;rt.last=performance.now();rt.started=true;console.info('[OldERA] isolated 1298 world runtime active')}
function adapter(){const scene=OldERAWorld.scene,collision=scene?.getObjectByName?.('MoradonCollision1298'),terrain=rt.terrain,ray=new THREE.Raycaster();return{isInTerrain:(x,z)=>terrain.isInTerrain(x,z),getTerrainHeight:(x,z)=>terrain.getHeight(x,z),checkShapeCollision:(origin,dir,dist)=>{if(!collision)return false;const v=new THREE.Vector3(dir.x,0,dir.z);if(v.lengthSq()<1e-8)return false;v.normalize();ray.set(new THREE.Vector3(origin.x,origin.y,origin.z),v);ray.near=.02;ray.far=dist+.15;const h=ray.intersectObject(collision,false)[0];return !!h&&Math.abs(h.face?.normal?.y??0)<.72},getNearestShapeHeight:(next,range)=>{if(!collision)return -Number.MAX_VALUE;ray.set(new THREE.Vector3(next.x,next.y+Math.max(.8,range+.35),next.z),new THREE.Vector3(0,-1,0));ray.near=0;ray.far=Math.max(2,range+1.2);return ray.intersectObject(collision,false)[0]?.point.y??-Number.MAX_VALUE},checkTerrainIncline:(next,dir)=>{const n=terrain.getNormal(next.x,next.z),horizontal=Math.hypot(n.x,n.z),dot=n.x*dir.x+n.z*dir.z;return horizontal>.643&&dot<=0}}}
function movementCode(c){return['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(c)}
nativeAdd('keydown',e=>{if(!worldOn())return;if(movementCode(e.code)){if(!rt.started||!rt.input)return;rt.clickTarget=null;rt.input.keyDown(e.code);e.preventDefault();e.stopImmediatePropagation();return}if(e.repeat)return;if(e.code==='KeyR'&&rt.started){rt.player?.toggleRun();e.preventDefault();e.stopImmediatePropagation();return}const m={KeyI:'inventory',KeyU:'character',KeyK:'skill',KeyH:'command'};if(m[e.code]){OldERAWorld?.togglePanel?.(m[e.code]);e.preventDefault();e.stopImmediatePropagation()}else if(e.code==='Escape'){OldERAWorld?.hideAllPanels?.();rt.clickTarget=null}},true);
nativeAdd('keyup',e=>{if(!worldOn()||!movementCode(e.code)||!rt.started||!rt.input)return;rt.input.keyUp(e.code);e.preventDefault();e.stopImmediatePropagation()},true);
function pointerRay(e){if(!rt.renderer||!rt.camera)return null;const b=rt.renderer.domElement.getBoundingClientRect(),p=new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-((e.clientY-b.top)/b.height)*2+1),r=new THREE.Raycaster();r.setFromCamera(p,rt.camera);return r}
nativeAdd('pointerdown',e=>{if(!worldOn()||!rt.started||e.button!==0||e.target!==rt.renderer?.domElement)return;const ray=pointerRay(e);if(!ray)return;const npcs=OldERAWorld?.npcs||[];if(npcs.length&&ray.intersectObjects(npcs,true).length)return;const scene=OldERAWorld.scene,terrain=scene?.getObjectByName?.('MoradonTerrain1298'),collision=scene?.getObjectByName?.('MoradonCollision1298'),hit=ray.intersectObjects([collision,terrain].filter(Boolean),false)[0];if(hit){rt.clickTarget={x:hit.point.x,z:hit.point.z};e.preventDefault();e.stopImmediatePropagation()}},true);
function targetDrive(){if(!rt.player||!rt.clickTarget)return;const dx=rt.clickTarget.x-rt.player.position.x,dz=rt.clickTarget.z-rt.player.position.z,d=Math.hypot(dx,dz);if(d<.35){rt.clickTarget=null;rt.player.commandStop();return}rt.player.yaw=Math.atan2(dx,dz);rt.player.commandForward(false)}
function findClip(actor,kind){const names=kind==='run'?['run','walk']:kind==='back'?['walk_back','back','walk']:kind==='walk'?['walk']:['breath','idle','wait','basic'];for(const n of names){const c=actor?.clips?.find(x=>String(x.name||'').toLowerCase()===n);if(c)return c}for(const n of names){const c=actor?.clips?.find(x=>String(x.name||'').toLowerCase().includes(n));if(c)return c}return actor?.clips?.[0]}
function motion(kind){if(rt.motion===kind)return;rt.motion=kind;const actor=OldERAWorld?.avatar?.userData?.actor1298,c=findClip(actor,kind);if(actor&&c)actor.playLoop?.(c.start,c.end,performance.now(),c.fps||30)}
function cleanHud(){const h=document.getElementById('v36Hud');if(!h)return;const layers=[...h.children];if(layers[2])layers[2].style.display='none';if(layers[3])layers[3].style.display='none'}
function frame(now){requestAnimationFrame(frame);fit();cleanHud();if(!worldOn()||!rt.started||!rt.player||!rt.terrain||!OldERAWorld?.avatar){rt.last=now;return}const dt=Math.min(.05,Math.max(0,(now-rt.last)/1000||0));rt.last=now;const held=rt.input.held('KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight');if(!held)targetDrive();rt.mods.p.processMovementInput(rt.player,rt.input,dt,{uiConsumesKeyboard:false});const res=rt.player.tick(dt,adapter());rt.input.endFrame();const a=OldERAWorld.avatar;a.position.set(rt.player.position.x,rt.player.position.y,rt.player.position.z);a.rotation.y=rt.player.yaw;if(res.moved)motion(rt.player.state===rt.mods.p.MoveState.RUN?'run':rt.player.state===rt.mods.p.MoveState.WALK_BACKWARD?'back':'walk');else motion('idle')}
attachActor();patchWorldStart();fit();nativeAdd('resize',fit,false);requestAnimationFrame(frame);
})();