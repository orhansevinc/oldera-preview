(()=>{'use strict';
if(!window.THREE)return;
const $=id=>document.getElementById(id),host=()=>$('worldStageInner');
const style=document.createElement('style');style.textContent=`
#worldStage{transform:translate(-50%,-50%) scale(var(--ko-world-sx,1),var(--ko-world-sy,1))!important;transform-origin:center center!important}
#worldStageInner>[data-ko-hud]{pointer-events:none}
#worldStageInner>[data-ko-hud] button,#worldStageInner>[data-ko-hud] [data-uiid]{pointer-events:auto}
`;document.head.appendChild(style);
function fitWorld(){document.documentElement.style.setProperty('--ko-world-sx',String(Math.max(.25,innerWidth/1024)));document.documentElement.style.setProperty('--ko-world-sy',String(Math.max(.25,innerHeight/768)))}
addEventListener('resize',fitWorld,{passive:true});fitWorld();
function num(v){v=parseFloat(v);return Number.isFinite(v)?v:null}
function bounds(layer){let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity,n=0;for(const e of layer.querySelectorAll('[data-uiid]')){if(getComputedStyle(e).display==='none')continue;let x=num(e.style.left),y=num(e.style.top),w=num(e.style.width),h=num(e.style.height);if(x==null||y==null||w==null||h==null||w<=0||h<=0)continue;if(w>=1023&&h>=767)continue;l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+w);b=Math.max(b,y+h);n++}return n?{l,t,r,b,w:r-l,h:b-t}:null}
function moveLayer(layer,x,y,bb=bounds(layer)){if(!bb)return;layer.style.transform=`translate(${Math.round(x-bb.l)}px,${Math.round(y-bb.t)}px)`;layer.style.transformOrigin='0 0'}
function hideById(id){const h=host();if(!h)return;for(const e of h.querySelectorAll('[data-uiid]'))if(String(e.dataset.uiid||'').toLowerCase()===id.toLowerCase())e.style.display='none'}
let layoutTimer=0;
function layoutHud(){const h=host();if(!h)return;hideById('Group_MiniMap');hideById('Progress_HP_lasting');hideById('Progress_HP_drop');hideById('Progress_HP_slow');const hud=[...h.children].filter(e=>!e.dataset.kind);if(hud.length<5)return;const [state,hot,msg,chat,cmd]=hud;hud.slice(0,5).forEach(e=>e.dataset.koHud='1');const sb=bounds(state),hb=bounds(hot),mb=bounds(msg),cb=bounds(chat),db=bounds(cmd);if(sb)moveLayer(state,0,0,sb);if(db){const x=(1024-db.w)/2,y=768-db.h;moveLayer(cmd,x,y,db);if(cb){const cy=y-cb.h-1,cx=(1024-cb.w)/2;moveLayer(chat,cx,cy,cb);if(mb){const my=cy-mb.h-1,mx=(1024-mb.w)/2;moveLayer(msg,mx,my,mb)}}}if(hb){const top=Math.max(88,sb?sb.h+4:88);moveLayer(hot,0,top,hb)}
  for(const p of h.querySelectorAll(':scope>[data-kind]')){const bb=bounds(p);if(!bb)continue;p.style.translate='0px 0px';if(!p.dataset.koPlaced){p.style.transform=`translate(${Math.round(1024-bb.r-10)}px,${Math.round(Math.max(8,-bb.t+8))}px)`;p.dataset.koPlaced='1'}}
}
function scheduleLayout(){clearTimeout(layoutTimer);layoutTimer=setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(layoutHud)),40)}
const h0=host();if(h0){new MutationObserver(scheduleLayout).observe(h0,{childList:true,subtree:true});scheduleLayout()}
// The original client starts with the minimap hidden. M toggles it; T toggles walk/run.
let forwardingRun=false;
addEventListener('keydown',e=>{if(e.repeat)return;const k=String(e.key||'').toLowerCase();if(forwardingRun)return;if(k==='t'){e.preventDefault();e.stopImmediatePropagation();forwardingRun=true;dispatchEvent(new KeyboardEvent('keydown',{key:'r',code:'KeyR',bubbles:true}));forwardingRun=false;return}if(k==='r'||k==='c'){e.stopImmediatePropagation();return}if(k==='m'){e.preventDefault();e.stopImmediatePropagation();const h=host();if(!h)return;for(const el of h.querySelectorAll('[data-uiid]'))if(String(el.dataset.uiid||'').toLowerCase()==='group_minimap')el.style.display=el.style.display==='none'?'':'none';return}},true);
// Capture the real Moradon scene and player so OPD collision can restore bridges/stairs/walkable object heights.
let worldScene=null,player=null,surface=null,lastSurfaceY=null;
const add0=THREE.Object3D.prototype.add;
THREE.Object3D.prototype.add=function(...objs){const out=add0.apply(this,objs);for(const o of objs){if(o?.name==='MoradonTerrain1298')worldScene=this;if(worldScene===this&&o?.isGroup){let isPlayer=false;o.traverse?.(n=>{if(n?.isMesh&&n.geometry?.userData?.src)isPlayer=true});if(isPlayer)player=o}}return out};
function buildSurface(opd){const a=opd?.collision;if(!a?.length)return null;const cell=8,grid=new Map(),tri=[];for(let i=0;i+8<a.length;i+=9){const ax=a[i],ay=a[i+1],az=a[i+2],bx=a[i+3],by=a[i+4],bz=a[i+5],cx=a[i+6],cy=a[i+7],cz=a[i+8];const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az,nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,nm=Math.hypot(nx,ny,nz);if(!nm||Math.abs(ny)/nm<.38)continue;const id=tri.length;tri.push([ax,ay,az,bx,by,bz,cx,cy,cz]);const x0=Math.floor(Math.min(ax,bx,cx)/cell),x1=Math.floor(Math.max(ax,bx,cx)/cell),z0=Math.floor(Math.min(az,bz,cz)/cell),z1=Math.floor(Math.max(az,bz,cz)/cell);for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z;let q=grid.get(key);if(!q)grid.set(key,q=[]);q.push(id)}}return{cell,grid,tri}}
function pointY(t,x,z){const [ax,ay,az,bx,by,bz,cx,cy,cz]=t,v0x=bx-ax,v0z=bz-az,v1x=cx-ax,v1z=cz-az,v2x=x-ax,v2z=z-az,den=v0x*v1z-v1x*v0z;if(Math.abs(den)<1e-7)return null;const u=(v2x*v1z-v1x*v2z)/den,v=(v0x*v2z-v2x*v0z)/den,w=1-u-v;if(u<-.002||v<-.002||w<-.002)return null;return ay*w+by*u+cy*v}
function shapeHeight(x,z,baseY){if(!surface)return null;const cx=Math.floor(x/surface.cell),cz=Math.floor(z/surface.cell),ids=surface.grid.get(cx+','+cz);if(!ids)return null;const ref=lastSurfaceY==null?baseY:lastSurfaceY;let best=null,bd=Infinity;for(const id of ids){const y=pointY(surface.tri[id],x,z);if(y==null||!Number.isFinite(y))continue;const d=Math.abs(y-ref);if(d<bd){bd=d;best=y}}if(best==null)return null;if(lastSurfaceY==null&&Math.abs(best-baseY)>2.5)return null;if(lastSurfaceY!=null&&best-lastSurfaceY>1.6)return null;return best}
let collisionPromise=null;function warmCollision(){if(!collisionPromise&&window.OldERAData?.opd)collisionPromise=OldERAData.opd().then(opd=>surface=buildSurface(opd)).catch(e=>{console.warn('1298 collision index',e);collisionPromise=null});return collisionPromise}
const render0=THREE.WebGLRenderer.prototype.render;THREE.WebGLRenderer.prototype.render=function(sc,cam){if(sc===worldScene&&player&&surface){const before=player.position.y,y=shapeHeight(player.position.x,player.position.z,before);if(y!=null){const dy=y-before;player.position.y=y;lastSurfaceY=y;if(cam&&Math.abs(dy)<20)cam.position.y+=dy}else lastSurfaceY=before}return render0.call(this,sc,cam)};
if(window.OldERAWorld?.start){const start0=OldERAWorld.start.bind(OldERAWorld);OldERAWorld.start=async opts=>{warmCollision();lastSurfaceY=null;const out=await start0(opts);scheduleLayout();return out}}
window.OldERAV24={fitWorld,layoutHud,warmCollision};
})();