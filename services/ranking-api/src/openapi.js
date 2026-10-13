const characterItem = {
  type: 'object',
  additionalProperties: false,
  required: ['rank', 'characterId', 'name', 'nation', 'classCode', 'level', 'nationalPoints'],
  properties: {
    rank: { type: 'integer', minimum: 1 },
    characterId: { type: 'string' },
    name: { type: 'string' },
    nation: { type: 'string', enum: ['karus', 'el_morad'] },
    classCode: { type: 'string' },
    level: { type: 'integer', minimum: 1 },
    nationalPoints: { type: 'integer', minimum: 0 },
    clanName: { type: 'string' }
  }
};

const pagination = {
  type: 'object',
  required: ['page', 'pageSize', 'total', 'totalPages'],
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
    totalPages: { type: 'integer', minimum: 0 }
  }
};

const commonQuery = [
  { name: 'nation', in: 'query', schema: { type: 'string', enum: ['karus', 'el_morad'] } },
  { name: 'q', in: 'query', schema: { type: 'string', maxLength: 64 } },
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }
];

const rankingResponse = (itemSchema) => ({
  '200': {
    description: 'Public ranking snapshot',
    headers: {
      'Cache-Control': { schema: { type: 'string' }, description: 'Public cache policy' }
    },
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['kind', 'metric', 'updatedAt', 'pagination', 'items'],
          properties: {
            kind: { type: 'string' },
            metric: { type: 'string' },
            filters: { type: 'object', additionalProperties: { type: 'string' } },
            updatedAt: { type: 'string', format: 'date-time' },
            pagination,
            items: { type: 'array', items: itemSchema }
          }
        }
      }
    }
  },
  '400': { description: 'Invalid query' }
});

export const openApiDocument = {
  openapi: '3.1.0',
  info: { title: 'OldKOWeb Public Ranking API', version: '0.1.0' },
  servers: [{ url: '/' }],
  paths: {
    '/healthz': {
      get: { operationId: 'health', responses: { '200': { description: 'Service health' } } }
    },
    '/openapi.json': {
      get: { operationId: 'openApi', responses: { '200': { description: 'OpenAPI document' } } }
    },
    '/v1/rankings/characters': {
      get: {
        operationId: 'characterRanking',
        parameters: [
          { name: 'metric', in: 'query', schema: { type: 'string', enum: ['level', 'national_points'], default: 'level' } },
          { name: 'class', in: 'query', schema: { type: 'string', maxLength: 32 } },
          ...commonQuery
        ],
        responses: rankingResponse(characterItem)
      }
    },
    '/v1/rankings/levels': {
      get: {
        operationId: 'levelRanking',
        parameters: [{ name: 'class', in: 'query', schema: { type: 'string', maxLength: 32 } }, ...commonQuery],
        responses: rankingResponse(characterItem)
      }
    },
    '/v1/rankings/national-points': {
      get: {
        operationId: 'nationalPointRanking',
        parameters: [{ name: 'class', in: 'query', schema: { type: 'string', maxLength: 32 } }, ...commonQuery],
        responses: rankingResponse(characterItem)
      }
    },
    '/v1/rankings/clans': {
      get: {
        operationId: 'clanRanking',
        parameters: commonQuery,
        responses: rankingResponse({
          type: 'object',
          additionalProperties: false,
          required: ['rank', 'clanId', 'name', 'nation', 'points', 'memberCount'],
          properties: {
            rank: { type: 'integer', minimum: 1 },
            clanId: { type: 'string' },
            name: { type: 'string' },
            nation: { type: 'string', enum: ['karus', 'el_morad'] },
            points: { type: 'integer', minimum: 0 },
            memberCount: { type: 'integer', minimum: 0 },
            chiefName: { type: 'string' }
          }
        })
      }
    }
  }
};
