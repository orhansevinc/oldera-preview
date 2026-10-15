'use strict';

const { fail } = require('./errors');

function createWs17CompatibleItemPort({ templates, createItemInstance, withQuantity } = {}) {
  if (!templates || typeof templates.get !== 'function') fail('INVALID_ITEM_PORT', 'templates.get(itemId) is required.');
  if (typeof createItemInstance !== 'function') fail('INVALID_ITEM_PORT', 'createItemInstance(template, input) is required.');
  if (typeof withQuantity !== 'function') fail('INVALID_ITEM_PORT', 'withQuantity(item, quantity) is required.');

  return {
    async getTemplate(templateId) {
      return templates.get(templateId);
    },
    withQuantity(item, quantity) {
      return withQuantity(item, quantity);
    },
    createSplit(template, source, quantity, serial) {
      return createItemInstance(template, {
        serial,
        quantity,
        durability: source.durability,
      });
    },
  };
}

function createPlainItemPort({ templates } = {}) {
  const registry = templates || new Map();
  return {
    async getTemplate(templateId) {
      const template = typeof registry.get === 'function' ? await registry.get(templateId) : registry[templateId];
      if (!template) fail('ITEM_TEMPLATE_NOT_FOUND', `Item template ${templateId} was not found.`, { templateId });
      return template;
    },
    withQuantity(item, quantity) {
      return { ...item, quantity };
    },
    createSplit(template, source, quantity, serial) {
      return {
        ...source,
        serial: Number(serial),
        quantity,
        templateId: Number(template.id ?? source.templateId),
      };
    },
  };
}

module.exports = { createWs17CompatibleItemPort, createPlainItemPort };
