'use strict';

const { EconomyService } = require('./economy-service.cjs');
const merchantCatalog = require('./merchant-catalog.cjs');
const domain = require('./domain.cjs');
const contracts = require('./contracts.cjs');

module.exports = { EconomyService, ...merchantCatalog, ...domain, ...contracts };
