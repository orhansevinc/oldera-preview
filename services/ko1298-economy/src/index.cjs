'use strict';

const { EconomyService } = require('./economy-service.cjs');
const domain = require('./domain.cjs');
const contracts = require('./contracts.cjs');

module.exports = { EconomyService, ...domain, ...contracts };
