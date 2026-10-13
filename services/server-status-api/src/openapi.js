const realmSchema = {
  type: 'object',
  required: ['realmId', 'displayName', 'availability', 'online', 'maintenance', 'population', 'serverVersion', 'targetPatch', 'lastHeartbeat', 'client', 'capacity'],
  properties: {
    realmId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
    displayName: { type: 'string', maxLength: 96 },
    availability: { type: 'string', enum: ['online', 'offline', 'maintenance'] },
    online: { type: 'boolean' },
    maintenance: { type: 'boolean' },
    population: { type: 'string', enum: ['unknown', 'empty', 'low', 'medium', 'high', 'full'] },
    onlinePlayerCount: { type: 'integer', minimum: 0, description: 'Optional privacy-safe aggregate. Omitted by default unless explicitly enabled.' },
    serverVersion: { type: 'string', maxLength: 64 },
    targetPatch: { type: 'string', enum: ['1298'] },
    lastHeartbeat: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    uptimeSeconds: { type: 'integer', minimum: 0 },
    statusMessage: { type: 'string', maxLength: 240 },
    client: {
      type: 'object',
      required: ['minimumContentVersion'],
      properties: { minimumContentVersion: { type: 'string', maxLength: 64 } },
      additionalProperties: false
    },
    capacity: {
      type: 'object',
      required: ['queueSupported'],
      properties: {
        queueSupported: { type: 'boolean' },
        maxPlayers: { type: 'integer', minimum: 0 },
        queueDepth: { type: 'integer', minimum: 0 }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

const errorSchema = {
  type: 'object',
  required: ['error', 'requestId'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' } },
      additionalProperties: false
    },
    requestId: { type: 'string' }
  },
  additionalProperties: false
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'OldKOWeb Public Server Status API',
    version: '0.1.0',
    description: 'Read-only public realm directory and server status read model for target patch 1298.'
  },
  paths: {
    '/healthz': {
      get: {
        summary: 'Service health',
        responses: { '200': { description: 'Healthy' } }
      },
      head: { summary: 'Service health headers', responses: { '200': { description: 'Healthy' } } }
    },
    '/v1/realms': {
      get: {
        summary: 'List public realms',
        responses: {
          '200': {
            description: 'Realm directory',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['targetPatch', 'count', 'realms'],
                  properties: {
                    targetPatch: { type: 'string', enum: ['1298'] },
                    count: { type: 'integer', minimum: 0 },
                    realms: { type: 'array', items: { $ref: '#/components/schemas/RealmStatus' } }
                  },
                  additionalProperties: false
                }
              }
            }
          }
        }
      },
      head: { summary: 'Realm directory headers', responses: { '200': { description: 'Available' } } }
    },
    '/v1/realms/{realmId}': {
      parameters: [{ name: 'realmId', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        summary: 'Get one public realm',
        responses: {
          '200': { description: 'Realm status', content: { 'application/json': { schema: { $ref: '#/components/schemas/RealmStatus' } } } },
          '400': { description: 'Invalid realm ID', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Realm not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      },
      head: { summary: 'Realm status headers', responses: { '200': { description: 'Available' }, '404': { description: 'Realm not found' } } }
    },
    '/openapi.json': {
      get: { summary: 'OpenAPI document', responses: { '200': { description: 'OpenAPI 3.1 JSON document' } } },
      head: { summary: 'OpenAPI headers', responses: { '200': { description: 'Available' } } }
    }
  },
  components: { schemas: { RealmStatus: realmSchema, Error: errorSchema } }
};
