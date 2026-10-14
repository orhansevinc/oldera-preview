'use strict';
function isFinitePosition(position){return Boolean(position)&&Number.isFinite(position.x)&&Number.isFinite(position.y)&&Number.isFinite(position.z);}
class ZoneBoundsProvider {
  isValidPosition(){throw new Error('ZoneBoundsProvider.isValidPosition(zoneId, position) must be implemented');}
}
class StaticZoneBounds extends ZoneBoundsProvider {
  constructor(zones={}){super();this.zones=new Map();for(const [zoneId,bounds] of Object.entries(zones))this.set(Number(zoneId),bounds);}
  set(zoneId,bounds){if(!Number.isInteger(zoneId))throw new TypeError('zoneId must be an integer');const n={minX:Number(bounds.minX),maxX:Number(bounds.maxX),minY:Number(bounds.minY),maxY:Number(bounds.maxY),minZ:Number(bounds.minZ),maxZ:Number(bounds.maxZ)};if(Object.values(n).some(v=>!Number.isFinite(v)))throw new TypeError('all zone bounds must be finite');if(n.minX>n.maxX||n.minY>n.maxY||n.minZ>n.maxZ)throw new RangeError('zone minimums must not exceed maximums');this.zones.set(zoneId,Object.freeze(n));return this;}
  isValidPosition(zoneId,p){if(!isFinitePosition(p))return false;const b=this.zones.get(zoneId);return Boolean(b)&&p.x>=b.minX&&p.x<=b.maxX&&p.y>=b.minY&&p.y<=b.maxY&&p.z>=b.minZ&&p.z<=b.maxZ;}
}
class MapZoneBoundsProvider extends ZoneBoundsProvider {
  constructor({getMap}){super();if(typeof getMap!=='function')throw new TypeError('getMap(zoneId) is required');this.getMap=getMap;}
  isValidPosition(zoneId,p){if(!isFinitePosition(p))return false;const map=this.getMap(zoneId);return Boolean(map&&typeof map.isValidPosition==='function'&&map.isValidPosition(p.x,p.z,p.y));}
}
module.exports={ZoneBoundsProvider,StaticZoneBounds,MapZoneBoundsProvider,isFinitePosition};
