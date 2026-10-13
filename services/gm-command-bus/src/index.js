'use strict';

const { CommandBus } = require('./command-bus');
const { createCommandRegistry, RISK } = require('./registry');
const { InMemoryIdempotencyStore } = require('./idempotency');
const { CommandBusError, ValidationError, ServiceUnavailableError } = require('./errors');

function createGmCommandBus(options) {
  const registry = options.registry || createCommandRegistry(options.adapters);
  return new CommandBus({ ...options, registry });
}

module.exports = {
  createGmCommandBus,
  CommandBus,
  createCommandRegistry,
  InMemoryIdempotencyStore,
  CommandBusError,
  ValidationError,
  ServiceUnavailableError,
  RISK,
};
