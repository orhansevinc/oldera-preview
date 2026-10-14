(function (root) {
  'use strict';

  const ROLES = ['auth', 'game'];

  function fail(message) {
    throw new Error(`OldKOWeb transport config: ${message}`);
  }

  function normalizePort(value, label) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fail(`${label} must be an integer TCP port`);
    }
    return port;
  }

  function resolveEndpoint(endpoint, pageHref) {
    if (typeof endpoint !== 'string' || endpoint.trim() === '') {
      fail('endpoint must be a non-empty string');
    }
    if (typeof pageHref !== 'string' || pageHref.trim() === '') {
      fail('page URL is unavailable');
    }

    let pageUrl;
    let endpointUrl;
    try {
      pageUrl = new URL(pageHref);
      endpointUrl = new URL(endpoint.trim(), pageUrl);
    } catch (error) {
      fail(`malformed endpoint: ${error && error.message ? error.message : error}`);
    }

    if (endpointUrl.username || endpointUrl.password) {
      fail('endpoint credentials are not allowed');
    }
    if (endpointUrl.hash) {
      fail('endpoint fragments are not allowed');
    }

    if (endpointUrl.protocol === 'http:') endpointUrl.protocol = 'ws:';
    else if (endpointUrl.protocol === 'https:') endpointUrl.protocol = 'wss:';
    else if (endpointUrl.protocol !== 'ws:' && endpointUrl.protocol !== 'wss:') {
      fail(`unsupported endpoint protocol ${endpointUrl.protocol || '(none)'}`);
    }

    if (pageUrl.protocol === 'https:' && endpointUrl.protocol === 'ws:') {
      fail('HTTPS pages may not use an insecure ws:// endpoint');
    }

    return endpointUrl.href;
  }

  function resolveTransport(config, serverHost, serverPort, pageHref) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      fail('configuration is missing');
    }
    if (typeof serverHost !== 'string' || serverHost.trim() === '') {
      fail('server-provided host is missing');
    }

    const port = normalizePort(serverPort, 'server-provided port');
    const routes = config.routes;
    if (!routes || typeof routes !== 'object' || Array.isArray(routes)) {
      fail('routes are missing');
    }

    const matches = [];
    for (const role of ROLES) {
      const route = routes[role];
      if (!route || typeof route !== 'object' || Array.isArray(route)) {
        fail(`${role} route is missing`);
      }
      if (!Array.isArray(route.serverPorts) || route.serverPorts.length === 0) {
        fail(`${role}.serverPorts must contain at least one port`);
      }

      const ports = route.serverPorts.map((value, index) =>
        normalizePort(value, `${role}.serverPorts[${index}]`));
      if (ports.includes(port)) matches.push({ role, route });
    }

    if (matches.length === 0) {
      fail(`no browser route for server target ${serverHost}:${port}`);
    }
    if (matches.length > 1) {
      fail(`ambiguous browser route for server target ${serverHost}:${port}`);
    }

    const match = matches[0];
    return {
      role: match.role,
      url: resolveEndpoint(match.route.endpoint, pageHref),
      serverHost,
      serverPort: port
    };
  }

  function installModuleResolver(moduleObject, locationObject) {
    if (!moduleObject || typeof moduleObject !== 'object') return;
    moduleObject.oldkoResolveTransportUrl = function (serverHost, serverPort) {
      const href = locationObject && typeof locationObject.href === 'string'
        ? locationObject.href
        : (root && root.location && typeof root.location.href === 'string' ? root.location.href : '');
      return resolveTransport(moduleObject.oldkoTransport, serverHost, serverPort, href).url;
    };
  }

  const api = { resolveEndpoint, resolveTransport, installModuleResolver };

  if (root) root.OldKOWebTransport = api;
  if (typeof Module !== 'undefined' && Module && typeof Module === 'object') {
    installModuleResolver(Module, root && root.location ? root.location : null);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
