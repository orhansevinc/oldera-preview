/**
 * RankingRepository is a read-only contract. Production adapters may read WS07
 * tables/views, replicas, materialized views, or a cache, but must never mutate
 * game state from this service.
 *
 * fetchCharacterRanking(query) -> { items, total, updatedAt }
 * fetchClanRanking(query) -> { items, total, updatedAt }
 *
 * Character item input may contain additional private fields; the service
 * projects a public whitelist before returning data.
 */
export class RankingRepository {
  async fetchCharacterRanking(_query) { throw new Error('fetchCharacterRanking not implemented'); }
  async fetchClanRanking(_query) { throw new Error('fetchClanRanking not implemented'); }
}

function normalizeText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

function compareText(a, b) {
  return normalizeText(a).localeCompare(normalizeText(b), 'en-US');
}

function characterScore(row, metric) {
  return metric === 'national_points' ? Number(row.nationalPoints ?? 0) : Number(row.level ?? 0);
}

export function compareCharacters(a, b, metric) {
  const scoreDelta = characterScore(b, metric) - characterScore(a, metric);
  if (scoreDelta !== 0) return scoreDelta;
  const nameDelta = compareText(a.name, b.name);
  if (nameDelta !== 0) return nameDelta;
  return compareText(a.characterId, b.characterId);
}

export function compareClans(a, b) {
  const pointDelta = Number(b.points ?? 0) - Number(a.points ?? 0);
  if (pointDelta !== 0) return pointDelta;
  const nameDelta = compareText(a.name, b.name);
  if (nameDelta !== 0) return nameDelta;
  return compareText(a.clanId, b.clanId);
}

function competitionRanks(rows, scoreOf) {
  let previousScore;
  let currentRank = 0;
  return rows.map((row, index) => {
    const score = scoreOf(row);
    if (index === 0 || score !== previousScore) currentRank = index + 1;
    previousScore = score;
    return { ...row, rank: currentRank };
  });
}

function page(rows, offset, limit) {
  return rows.slice(offset, offset + limit);
}

function matches(value, search) {
  return !search || normalizeText(value).includes(normalizeText(search));
}

export class InMemoryRankingRepository extends RankingRepository {
  constructor({ characters = [], clans = [], updatedAt = new Date(0).toISOString() } = {}) {
    super();
    this.characters = structuredClone(characters);
    this.clans = structuredClone(clans);
    this.updatedAt = updatedAt;
  }

  async fetchCharacterRanking({ metric, nation, classCode, search, offset, limit }) {
    const filtered = this.characters.filter((row) =>
      (!nation || row.nation === nation) &&
      (!classCode || normalizeText(row.classCode) === normalizeText(classCode)) &&
      matches(row.name, search)
    );
    const sorted = filtered.toSorted((a, b) => compareCharacters(a, b, metric));
    const ranked = competitionRanks(sorted, (row) => characterScore(row, metric));
    return { items: page(ranked, offset, limit), total: ranked.length, updatedAt: this.updatedAt };
  }

  async fetchClanRanking({ nation, search, offset, limit }) {
    const filtered = this.clans.filter((row) => (!nation || row.nation === nation) && matches(row.name, search));
    const sorted = filtered.toSorted(compareClans);
    const ranked = competitionRanks(sorted, (row) => Number(row.points ?? 0));
    return { items: page(ranked, offset, limit), total: ranked.length, updatedAt: this.updatedAt };
  }
}
