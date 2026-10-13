'use strict';

function isFinitePosition(position) {
  return Boolean(position)
    && Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z);
}

class StaticZoneBounds {
  constructor(zones = {}) {
    this.zones = new Map();
    for (const [zoneId, bounds] of Object.entries(zones)) {
      this.set(Number(zoneId), bounds);
    }
  }

  set(zoneId, bounds) {
    if (!Number.isInteger(zoneId)) throw new TypeError('zoneId must be an integer');
    const normalized = {
      minX: Number(bounds.minX), maxX: Number(bounds.maxX),
      minY: Number(bounds.minY), maxY: Number(bounds.maxY),
      minZ: Number(bounds.minZ), maxZ: Number(bounds.maxZ),
    };
    if (Object.values(normalized).some((value) => !Number.isFinite(value))) {
      throw new TypeError('all zone bounds must be finite');
    }
    if (normalized.minX > normalized.maxX || normalized.minY > normalized.maxY || normalized.minZ > normalized.maxZ) {
      throw new RangeError('zone minimums must not exceed maximums');
    }
    this.zones.set(zoneId, normalized);
  }

  isValidPosition(zoneId, position) {
    if (!isFinitePosition(position)) return false;
    const bounds = this.zones.get(zoneId);
    if (!bounds) return false;
    return position.x >= bounds.minX && position.x <= bounds.maxX
      && position.y >= bounds.minY && position.y <= bounds.maxY
      && position.z >= bounds.minZ && position.z <= bounds.maxZ;
  }
}

module.exports = { StaticZoneBounds, isFinitePosition };
