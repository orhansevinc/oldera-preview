'use strict';

function resolveNpcData(document, { terrainY }) {
  if (!document || !Array.isArray(document.templates) || !Array.isArray(document.instances)) {
    throw new TypeError('document.templates and document.instances are required');
  }
  if (typeof terrainY !== 'function') throw new TypeError('terrainY resolver is required');
  const templates = new Map(document.templates.map(t => [t.templateSid, t]));
  return document.instances.map(instance => {
    const template = templates.get(instance.templateSid);
    if (!template) throw new Error(`missing NPC template ${instance.templateSid}`);
    const row = { ...template, ...instance };
    if (row.y == null) {
      const y = terrainY({ zoneId: row.zoneId, x: row.x, z: row.z, templateSid: row.templateSid });
      if (!Number.isFinite(y)) throw new Error(`unresolved terrain Y for NPC template ${row.templateSid}`);
      row.y = y;
    }
    return row;
  });
}

module.exports = { resolveNpcData };
