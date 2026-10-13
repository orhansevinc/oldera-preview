import { AppError } from './errors.js';

const PUBLIC_CHARACTER_FIELDS = ['rank', 'characterId', 'name', 'nation', 'classCode', 'level', 'nationalPoints', 'clanName'];
const PUBLIC_CLAN_FIELDS = ['rank', 'clanId', 'name', 'nation', 'points', 'memberCount', 'chiefName'];

function publicProjection(row, fields) {
  return Object.fromEntries(fields.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
}

function assertRepositoryResult(result) {
  if (!result || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0) {
    throw new Error('Ranking repository returned an invalid result');
  }
  const timestamp = new Date(result.updatedAt);
  if (!result.updatedAt || Number.isNaN(timestamp.getTime())) throw new Error('Ranking repository must provide a valid updatedAt timestamp');
}

function paginationEnvelope({ page, pageSize, total }) {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize)
  };
}

export class RankingService {
  constructor({ repository }) {
    if (!repository) throw new TypeError('repository is required');
    this.repository = repository;
  }

  async characterRanking(query) {
    const offset = (query.page - 1) * query.pageSize;
    const result = await this.repository.fetchCharacterRanking({ ...query, offset, limit: query.pageSize });
    assertRepositoryResult(result);
    return {
      kind: query.metric === 'national_points' ? 'national_point_ranking' : 'level_ranking',
      metric: query.metric,
      filters: {
        ...(query.nation ? { nation: query.nation } : {}),
        ...(query.classCode ? { class: query.classCode } : {}),
        ...(query.search ? { q: query.search } : {})
      },
      updatedAt: result.updatedAt,
      pagination: paginationEnvelope({ page: query.page, pageSize: query.pageSize, total: result.total }),
      items: result.items.map((row) => publicProjection(row, PUBLIC_CHARACTER_FIELDS))
    };
  }

  async clanRanking(query) {
    const offset = (query.page - 1) * query.pageSize;
    const result = await this.repository.fetchClanRanking({ ...query, offset, limit: query.pageSize });
    assertRepositoryResult(result);
    return {
      kind: 'clan_ranking',
      metric: 'points',
      filters: {
        ...(query.nation ? { nation: query.nation } : {}),
        ...(query.search ? { q: query.search } : {})
      },
      updatedAt: result.updatedAt,
      pagination: paginationEnvelope({ page: query.page, pageSize: query.pageSize, total: result.total }),
      items: result.items.map((row) => publicProjection(row, PUBLIC_CLAN_FIELDS))
    };
  }

  async health() {
    return { ok: true, service: 'oldko-ranking-api', readOnly: true };
  }
}

export function notFound() {
  throw new AppError(404, 'NOT_FOUND', 'Endpoint not found');
}
