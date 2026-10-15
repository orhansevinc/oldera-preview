'use strict';
const DEFAULT_REGION_SIZE=48;
function regionForPosition(zoneId,position,regionSize=DEFAULT_REGION_SIZE){return Object.freeze({zoneId,x:Math.floor(position.x/regionSize),z:Math.floor(position.z/regionSize),key:`${zoneId}:${Math.floor(position.x/regionSize)}:${Math.floor(position.z/regionSize)}`});}
function neighboringRegionKeys(region,radius=1){const out=[];for(let x=region.x-radius;x<=region.x+radius;x++)for(let z=region.z-radius;z<=region.z+radius;z++)out.push(`${region.zoneId}:${x}:${z}`);return out;}
module.exports={DEFAULT_REGION_SIZE,regionForPosition,neighboringRegionKeys};
