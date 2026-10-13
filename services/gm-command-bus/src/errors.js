'use strict';

class CommandBusError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

class ValidationError extends CommandBusError {
  constructor(message, details) {
    super('VALIDATION_ERROR', message, details);
  }
}

class ServiceUnavailableError extends CommandBusError {
  constructor(service, message = `${service} is unavailable`) {
    super('SERVICE_UNAVAILABLE', message, { service });
    this.service = service;
  }
}

module.exports = {
  CommandBusError,
  ValidationError,
  ServiceUnavailableError,
};
