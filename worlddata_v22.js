(()=>{'use strict';
if(!window.OldERAData||!window.THREE)return;
const D=window.OldERAData;
class R{constructor(b){this.b=b;this.v=new DataView(b);this.p=0}i(){const x=this.v.getInt32(this.p,true);this.p+=4;return x}u16(){const x=this.v.getUint16(this.p,true);this.p+=2;return x}f(){const x=this.v.getFloat32(this.p,true);this.p+=4;return x}skip(n){this.p+=n}str(){const n=this.i();if(n<0||n>65536||this.p+n>this.b.byteLength)throw Error('bad string');const a=new Uint8Array(this.b,this.p,n);this.p+=n;return new TextDecoder('windows-1252').decode(a).replace(/\0+$/,'')}}
function finite3(a,i){return Number.isFinite(a[i])&&Number.isFinite(a[i+1])&&Number.isFinite(a[i+2])}
async function pmesh1298(name,dir='Object'){
  const b=await D.ab((dir?dir+'/':'')+name),r=new R(b);r.str();
  const numCollapses=r.i(),totalChanges=r.i(),maxV=r.i(),maxI=r.i(),minV=r.i(),minI=r.i();
  if(numCollapses<0||numCollapses>1000000||totalChanges<0||totalChanges>5000000||maxV<=0||maxV>1000000||maxI<=0||maxI>5000000||minV<0||minV>maxV||minI<0||minI>maxI)throw Error('bad pmesh header '+name);
  const pos=new Float32Array(maxV*3),nr=new Float32Array(maxV*3),uv=new Float32Array(maxV*2);
  for(let i=0;i<maxV;i++){
    pos[i*3]=r.f();pos[i*3+1]=r.f();pos[i*3+2]=r.f();
    nr[i*3]=r.f();nr[i*3+1]=r.f();nr[i*3+2]=r.f();
    uv[i*2]=r.f();uv[i*2+1]=r.f();
  }
  const ids=new Uint16Array(maxI);for(let i=0;i<maxI;i++)ids[i]=r.u16();
  const collapses=[];
  for(let i=0;i<numCollapses;i++){
    if(r.p+24>b.byteLength)throw Error('short collapse table '+name);
    const c={changes:r.i(),loseI:r.i(),loseV:r.i(),changeAt:r.i(),collapseTo:r.i()};r.skip(4);
    if(c.changes<0||c.loseI<0||c.loseV<0||c.changeAt<0)throw Error('bad collapse '+name);
    collapses.push(c);
  }
  const changes=new Int32Array(totalChanges);for(let i=0;i<totalChanges;i++){if(r.p+4>b.byteLength)throw Error('short index-change table '+name);changes[i]=r.i()}
  let nV=minV,nI=minI;
  for(const c of collapses){
    nI=Math.min(maxI,nI+c.loseI);nV=Math.min(maxV,nV+c.loseV);
    const replacement=Math.max(0,nV-1),end=Math.min(totalChanges,c.changeAt+c.changes);
    for(let j=c.changeAt;j<end;j++){const at=changes[j];if(at>=0&&at<maxI)ids[at]=replacement}
  }
  if(nV<1)nV=maxV;if(nI<3)nI=maxI;nV=Math.min(maxV,nV);nI=Math.min(maxI,nI)-Math.min(maxI,nI)%3;
  const clean=[];
  for(let i=0;i+2<nI;i+=3){const a=ids[i],c=ids[i+1],d=ids[i+2];if(a>=nV||c>=nV||d>=nV)continue;if(!finite3(pos,a*3)||!finite3(pos,c*3)||!finite3(pos,d*3))continue;if(a===c||c===d||d===a)continue;clean.push(a,c,d)}
  const IndexArray=nV>65535?Uint32Array:Uint16Array,index=new IndexArray(clean);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nr,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setIndex(new THREE.BufferAttribute(index,1));g.computeBoundingBox();g.computeBoundingSphere();g.userData.full1298=true;g.userData.pmesh={numCollapses,totalChanges,maxV,maxI,minV,minI,finalV:nV,finalI:index.length};return g;
}
D.pmesh=pmesh1298;
})();
