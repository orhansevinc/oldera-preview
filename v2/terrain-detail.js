import {fetchAB,decodeNTFAt,loadTCTAtlas,terrainHeight} from './assets.js?v=3';

const dec=new TextDecoder('windows-1252');
const i32=(v,o)=>v.getInt32(o,true);
function fixedString(u,o,n){let e=o;while(e<o+n&&u[e])e++;return dec.decode(u.subarray(o,e)).replace(/\\/g,'/');}
function canonGTT(p){p=String(p||'').replace(/\\/g,'/').replace(/^\.\//,'');const i=p.toLowerCase().indexOf('dtex/');if(i>=0)p=p.slice(i);else if(!p.includes('/'))p='DTex/'+p;return p.replace(/^dtex\//i,'DTex/');}
export async function loadMoradonTerrainInfo(){
  const b=await fetchAB('Zones/moradon.gtd'),v=new DataView(b),u=new Uint8Array(b);let o=0;
  let first=i32(v,o);o+=4;if(first===1||first===2){const nl=i32(v,o);o+=4+nl}else o=0;
  const n=i32(v,o);o+=4;if(n<16||n>2048)throw Error('bad terrain size '+n);
  const h=Array.from({length:n},()=>new Float32Array(n)),flags=Array.from({length:n},()=>new Uint32Array(n));
  for(let x=0;x<n;x++)for(let z=0;z<n;z++){h[x][z]=v.getFloat32(o,true);flags[x][z]=v.getUint32(o+4,true);o+=8}
  const pat=(n-1)/8;o+=pat*pat*8;
  o+=n*n;
  const zone=fixedString(u,o,260);o+=260;
  const numTile=i32(v,o);o+=4;let numSrc=0,sources=[],tileRefs=[];
  if(numTile>0){numSrc=i32(v,o);o+=4;if(numSrc<0||numSrc>1024)throw Error('bad gtt source count '+numSrc);for(let i=0;i<numSrc;i++){sources.push(canonGTT(fixedString(u,o,260)));o+=260}for(let i=0;i<numTile;i++){tileRefs.push({src:v.getInt16(o,true),tile:v.getInt16(o+2,true)});o+=4}}
  return{n,h,tileFlags:flags,zone,numTile,sources,tileRefs};
}
function signatures(b){const u=new Uint8Array(b),a=[];for(let i=0;i+20<u.length;i++)if(u[i]===78&&u[i+1]===84&&u[i+2]===70&&u[i+3]===3)a.push(i);return a;}
const gttCache=new Map(),tileCache=new Map();
async function gtt(path){if(!gttCache.has(path))gttCache.set(path,fetchAB(path).then(b=>({b,s:signatures(b)})));return gttCache.get(path);}
async function tilePixels(info,idx){if(idx<0||idx>=info.tileRefs.length)return null;const key=idx;if(tileCache.has(key))return tileCache.get(key);const p=(async()=>{const r=info.tileRefs[idx],src=info.sources[r.src];if(!src)return null;const f=await gtt(src);if(r.tile<0||r.tile>=f.s.length)throw Error(`GTT tile ${src} #${r.tile}/${f.s.length}`);return decodeNTFAt(f.b,f.s[r.tile])})();tileCache.set(key,p);return p;}
function pixelCanvas(d){const c=document.createElement('canvas');c.width=d.w;c.height=d.h;c.getContext('2d').putImageData(new ImageData(d.data,d.w,d.h),0,0);return c;}
const orientCache=new WeakMap();
function oriented(src,dir){dir=(dir|0)&7;let m=orientCache.get(src);if(!m){m=new Map();orientCache.set(src,m)}if(m.has(dir))return m.get(dir);const s=Math.max(src.width,src.height),c=document.createElement('canvas');c.width=c.height=s;const x=c.getContext('2d');x.translate(s/2,s/2);switch(dir){case 1:x.rotate(Math.PI/2);break;case 2:x.rotate(-Math.PI/2);break;case 3:x.rotate(Math.PI);break;case 4:x.scale(-1,1);break;case 5:x.scale(-1,1);x.rotate(Math.PI/2);break;case 6:x.scale(-1,1);x.rotate(-Math.PI/2);break;case 7:x.scale(1,-1);break;}x.drawImage(src,-s/2,-s/2,s,s);m.set(dir,c);return c;}
function unpack(f){return{full:!!(f&1),d1:(f>>>1)&31,d2:(f>>>6)&31,t1:(f>>>11)&1023,t2:(f>>>21)&1023};}
export async function buildMoradonGround(onProgress=()=>{}){
  onProgress(.01,'1298 terrain bilgisi okunuyor…');const info=await loadMoradonTerrainInfo();
  const color=await loadTCTAtlas(info.n,p=>onProgress(.02+p*.18,'1298 color map hazırlanıyor…'));
  const tilePx=32,tiles=info.n-1,size=tiles*tilePx,c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=true;ctx.drawImage(color,0,0,size,size);
  const needed=new Set();for(let x=0;x<tiles;x++)for(let z=0;z<tiles;z++){const f=unpack(info.tileFlags[x][z]);if(f.full&&f.t1<info.numTile)needed.add(f.t1);if(f.full&&f.t2<info.numTile)needed.add(f.t2)}
  const tileCanvas=new Map(),list=[...needed];let loaded=0;const workers=Array.from({length:Math.min(8,list.length)},async(_,wi)=>{for(let i=wi;i<list.length;i+=8){const idx=list[i];try{const d=await tilePixels(info,idx);if(d)tileCanvas.set(idx,pixelCanvas(d))}catch(e){console.warn('terrain tile',idx,e)}loaded++;onProgress(.20+.35*loaded/Math.max(1,list.length),`1298 terrain tile ${loaded}/${list.length}`)}});await Promise.all(workers);
  ctx.imageSmoothingEnabled=true;let done=0,total=tiles*tiles;for(let x=0;x<tiles;x++){for(let z=0;z<tiles;z++){const f=unpack(info.tileFlags[x][z]);if(!f.full||f.t1>=info.numTile)continue;const a=tileCanvas.get(f.t1);if(!a)continue;const dx=x*tilePx,dy=(tiles-1-z)*tilePx;ctx.save();ctx.globalCompositeOperation='source-over';ctx.fillStyle='#000';ctx.fillRect(dx,dy,tilePx,tilePx);ctx.drawImage(oriented(a,f.d1),dx,dy,tilePx,tilePx);if(f.t2<info.numTile){const b=tileCanvas.get(f.t2);if(b){ctx.globalCompositeOperation='lighter';ctx.globalAlpha=.72;ctx.drawImage(oriented(b,f.d2),dx,dy,tilePx,tilePx)}}ctx.restore()}done+=tiles;if((x&7)===0)onProgress(.55+.44*done/total,'1298 terrain dokusu birleştiriliyor…')}
  onProgress(1,'1298 terrain hazır');return{canvas:c,info,height:(x,z)=>terrainHeight(info,x,z)};
}
