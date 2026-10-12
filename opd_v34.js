(()=>{'use strict';
if(!window.OldERAData||!window.THREE)return;
const D=window.OldERAData,TD=new TextDecoder('windows-1252');let cache=null;
class R{constructor(b){this.b=b;this.v=new DataView(b);this.p=0}need(n){if(this.p+n>this.b.byteLength)throw Error('1298 OPD EOF @'+this.p+' need '+n)}i(){this.need(4);const x=this.v.getInt32(this.p,true);this.p+=4;return x}u32(){this.need(4);const x=this.v.getUint32(this.p,true);this.p+=4;return x}f(){this.need(4);const x=this.v.getFloat32(this.p,true);this.p+=4;return x}vec3(){return[this.f(),this.f(),this.f()]}quat(){return[this.f(),this.f(),this.f(),this.f()]}skip(n){this.need(n);this.p+=n}text(n){this.need(n);const s=n?TD.decode(new Uint8Array(this.b,this.p,n)).replace(/\0+$/,''):'';this.p+=n;return s}str(){const n=this.i();if(n<0||n>1048576)throw Error('bad 1298 string '+n+' @'+(this.p-4));return this.text(n)}}
const basename=p=>String(p||'').replace(/\\/g,'/').split('/').pop();
function anim(r){const n=r.i();if(n<0||n>1000000)throw Error('bad OPD anim count '+n);if(!n)return;const type=r.i(),rate=r.f();if(type!==0&&type!==1)throw Error('bad OPD anim type '+type);if(!Number.isFinite(rate)||rate<=0)throw Error('bad OPD anim rate '+rate);r.skip(n*(type===0?12:16))}
function transform(r){const name=r.str(),p=r.vec3(),q=r.quat(),s=r.vec3();anim(r);anim(r);anim(r);const collision=r.str(),climb=r.str();return{name,p,q,s,collision,climb}}
function part(r){const pivot=r.vec3(),mesh=basename(r.str());r.skip(92);const tc=r.i(),fps=r.f();if(tc<0||tc>256)throw Error('bad OPD texture count '+tc);const textures=[];for(let i=0;i<tc;i++)textures.push(basename(r.str()));return{pivot,mesh,tex:textures[0]||null,textures,fps}}
async function read(){
 const b=await D.ab('Zones/moradon.opd'),r=new R(b);
 // KO 12xx OPD files use CN3ShapeMgr's 1264+ header: int version, int nameLength, name bytes.
 // Older 10xx files begin directly with map width/length, so keep a safe fallback.
 let format='1098',version=null,headerName='';const start=r.p,probe=r.i();
 if(probe>=0&&probe<=2){const nl=r.i();if(nl<0||nl>30)throw Error('bad moradon OPD name header '+nl);version=probe;headerName=r.text(nl);format='1264+'}else r.p=start;
 const mw=r.f(),ml=r.f(),fc=r.i();
 if(!Number.isFinite(mw)||!Number.isFinite(ml)||mw<=0||ml<=0||mw>4096||ml>4096||fc<0||fc>2000000)throw Error(`bad moradon OPD map header format=${format} ver=${version} name=${headerName} mw=${mw} ml=${ml} faces=${fc}`);
 const collision=new Float32Array(fc*9);for(let i=0;i<collision.length;i++)collision[i]=r.f();
 const MW=Math.floor(mw/16),ML=Math.floor(ml/16);if(MW<=0||ML<=0||MW>256||ML>256)throw Error('bad moradon OPD cell grid '+MW+'x'+ML);
 for(let z=0;z<ML;z++)for(let x=0;x<MW;x++){
   const exists=r.i();if(exists!==0&&exists!==1)throw Error(`bad OPD cell flag ${exists} at ${x},${z}`);if(!exists)continue;
   const sc=r.i();if(sc<0||sc>100000)throw Error('bad OPD cell shape count '+sc);r.skip(sc*2);
   for(let sz=0;sz<4;sz++)for(let sx=0;sx<4;sx++){const cc=r.i();if(cc<0||cc>100000)throw Error('bad OPD subcell collision count '+cc);r.skip(cc*3*4)}
 }
 const shapeCount=r.i();if(shapeCount<0||shapeCount>200000)throw Error('bad OPD shape count '+shapeCount+' @'+r.p);
 const objects=[];
 for(let i=0;i<shapeCount;i++){
   const type=r.u32(),tr=transform(r),pc=r.i();if(pc<0||pc>512)throw Error('bad OPD part count '+pc+' shape '+i+' @'+r.p);
   const parts=[];for(let j=0;j<pc;j++)parts.push(part(r));
   const belong=r.i(),eventID=r.i(),eventType=r.i(),npcID=r.i(),npcStatus=r.i();
   objects.push({type,...tr,parts,belong,eventID,eventType,npcID,npcStatus});
 }
 console.info('OldERA OPD 1298 parsed',{format,version,headerName,mw,ml,fc,shapeCount,bytes:b.byteLength,read:r.p});
 return{objects,mw,ml,collision,collisionFaceCount:fc,shapeCount,format,version,headerName};
}
D.opd=()=>{if(!cache)cache=read().catch(e=>{cache=null;throw e});return cache};
window.OldERAOPDV34={reload:()=>{cache=null;return D.opd()}};
})();
