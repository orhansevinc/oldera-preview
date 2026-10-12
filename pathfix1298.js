(()=>{'use strict';
if(!window.N3UI)return;
const RAW=N3UI.RAW||'https://raw.githubusercontent.com/ko4life-net/ko-assets/1298/';
const texCache=new Map();
function canon(p,def='UI_US'){
  p=String(p||'').replace(/\\/g,'/').replace(/^\.\//,'');
  if(!p)return'';
  const low=p.toLowerCase();
  const ix=low.indexOf('ui_us/');
  if(ix>=0)p=p.slice(ix);
  else if(!p.includes('/'))p=def+'/'+p;
  p=p.replace(/^ui_us\//i,'UI_US/').replace(/^chrselect\//i,'ChrSelect/').replace(/^item\//i,'Item/').replace(/^object\//i,'Object/').replace(/^misc\//i,'Misc/').replace(/^data\//i,'Data/');
  return window.OldERAUIPaths?.[p.toLowerCase()]||p;
}
async function fetchBin(path){
  path=canon(path,path.toLowerCase().includes('ui')?'UI_US':'');
  const variants=[path,path.replace(/\.dxt$/i,'.DXT'),path.replace(/\.uif$/i,'.uif')];
  let last;
  for(const p of [...new Set(variants)]){
    try{const r=await fetch(RAW+p.split('/').map(encodeURIComponent).join('/'));if(r.ok)return await r.arrayBuffer();last=Error(r.status+' '+p)}catch(e){last=e}
  }
  throw last||Error(path);
}
async function texCanvas(path){
  path=canon(path);const key=path.toLowerCase();if(texCache.has(key))return texCache.get(key);
  const pr=(async()=>{const d=N3UI.decodeNTF(await fetchBin(path)),c=document.createElement('canvas');c.width=d.w;c.height=d.h;c.getContext('2d').putImageData(new ImageData(d.data,d.w,d.h),0,0);return c})();
  texCache.set(key,pr);pr.catch(()=>texCache.delete(key));return pr;
}
N3UI.norm=canon;N3UI.fetchBin=fetchBin;N3UI.texCanvas=texCanvas;

})();
