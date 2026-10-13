import { AppError } from './errors.js';

const NATIONS = new Set(['karus', 'el_morad']);
const METRICS = new Set(['level', 'national_points']);

function parsePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER, name }) {
  if (value === null || value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new AppError(400, 'INVALID_QUERY', `${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new AppError(400, 'INVALID_QUERY', `${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseOptionalText(value, { name, maxLength }) {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (text.length > maxLength) throw new AppError(400, 'INVALID_QUERY', `${name} must be at most ${maxLength} characters`);
  return text;
}

export function parseCharacterRankingQuery(searchParams, forcedMetric = undefined) {
  const metric = forcedMetric ?? (searchParams.get('metric') || 'level');
  if (!METRICS.has(metric)) throw new AppError(400, 'INVALID_QUERY', 'metric must be level or national_points');

  const nation = parseOptionalText(searchParams.get('nation'), { name: 'nation', maxLength: 16 });
  if (nation && !NATIONS.has(nation)) throw new AppError(400, 'INVALID_QUERY', 'nation must be karus or el_morad');

  return {
    metric,
    nation,
    classCode: parseOptionalText(searchParams.get('class'), { name: 'class', maxLength: 32 }),
    search: parseOptionalText(searchParams.get('q'), { name: 'q', maxLength: 64 }),
    page: parsePositiveInteger(searchParams.get('page'), 1, { min: 1, max: 100000, name: 'page' }),
    pageSize: parsePositiveInteger(searchParams.get('pageSize'), 50, { min: 1, max: 100, name: 'pageSize' })
  };
}

export function parseClanRankingQuery(searchParams) {
  const nation = parseOptionalText(searchParams.get('nation'), { name: 'nation', maxLength: 16 });
  if (nation && !NATIONS.has(nation)) throw new AppError(400, 'INVALID_QUERY', 'nation must be karus or el_morad');
  return {
    nation,
    search: parseOptionalText(searchParams.get('q'), { name: 'q', maxLength: 64 }),
    page: parsePositiveInteger(searchParams.get('page'), 1, { min: 1, max: 100000, name: 'page' }),
    pageSize: parsePositiveInteger(searchParams.get('pageSize'), 50, { min: 1, max: 100, name: 'pageSize' })
  };
}
