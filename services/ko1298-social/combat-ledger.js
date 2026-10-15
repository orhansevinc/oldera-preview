'use strict';

function scoreValue(row, metric) {
  const value = Number(row?.[metric] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function competitionRank(rows, metric = 'nationalPoints', nameField = 'name', idField = 'characterId') {
  const sorted = [...(rows ?? [])].sort((a, b) => {
    const byScore = scoreValue(b, metric) - scoreValue(a, metric);
    if (byScore) return byScore;
    const an = String(a?.[nameField] ?? '').toLocaleLowerCase('en-US');
    const bn = String(b?.[nameField] ?? '').toLocaleLowerCase('en-US');
    const byName = an.localeCompare(bn, 'en-US');
    if (byName) return byName;
    return String(a?.[idField] ?? '').localeCompare(String(b?.[idField] ?? ''), 'en-US');
  });
  let lastScore = null, lastRank = 0;
  return sorted.map((row, index) => {
    const score = scoreValue(row, metric);
    if (index === 0 || score !== lastScore) lastRank = index + 1;
    lastScore = score;
    return { rank: lastRank, ...row };
  });
}

class CombatSocialLedger {
  constructor({ pvpPolicy, sink, rankingReader = null, maxSeenEvents = 50000 } = {}) {
    if (!pvpPolicy) throw new TypeError('pvpPolicy is required');
    if (!sink || typeof sink.applyCombatSocialOutcome !== 'function') throw new TypeError('authoritative persistence sink is required');
    this.pvpPolicy = pvpPolicy;
    this.sink = sink;
    this.rankingReader = rankingReader;
    this.maxSeenEvents = maxSeenEvents;
    this.seen = new Map();
  }
  _remember(id) {
    this.seen.set(id, true);
    if (this.seen.size > this.maxSeenEvents) this.seen.delete(this.seen.keys().next().value);
  }
  async consume(event) {
    if (!event || event.authority !== 'P2-07_AUTHORITATIVE_COMBAT') return { ok: false, code: 'UNTRUSTED_COMBAT_OUTCOME' };
    if (!event.eventId) return { ok: false, code: 'EVENT_ID_REQUIRED' };
    if (event.clientReportedScore != null || event.clientReportedNp != null) return { ok: false, code: 'CLIENT_SCORE_REJECTED' };
    const id = String(event.eventId);
    if (this.seen.has(id)) return { ok: true, code: 'DUPLICATE_IGNORED', duplicate: true };
    const legality = this.pvpPolicy.npEligible({ attacker: event.attacker, target: event.victim, battleOpen: !!event.battleOpen, invasionOpen: !!event.invasionOpen });
    if (!legality.eligible && event.kind === 'pvp_kill') return { ok: false, code: 'ILLEGAL_PVP_OUTCOME', reason: legality.reason };
    const npAward = Number(event.npAward ?? 0);
    const npLoss = Number(event.npLoss ?? 0);
    if (!Number.isSafeInteger(npAward) || npAward < 0 || !Number.isSafeInteger(npLoss) || npLoss < 0) return { ok: false, code: 'INVALID_NP_DELTA' };
    const mutation = {
      eventId: id,
      attackerCharacterId: String(event.attacker.characterId),
      victimCharacterId: String(event.victim.characterId),
      attackerKillDelta: 1,
      victimDeathDelta: 1,
      attackerNpDelta: npAward,
      victimNpDelta: -npLoss,
      zoneId: Number(event.attacker.zoneId),
      eventKey: event.eventKey ?? null,
      occurredAt: event.occurredAt ?? new Date().toISOString(),
      source: 'P2-07_AUTHORITATIVE_COMBAT',
    };
    const applied = await this.sink.applyCombatSocialOutcome(mutation);
    if (applied?.duplicate) { this._remember(id); return { ok: true, code: 'DUPLICATE_IGNORED', duplicate: true }; }
    this._remember(id);
    return { ok: true, code: 'COMBAT_SOCIAL_APPLIED', mutation, persistence: applied ?? null };
  }
  async rankings(query = {}) {
    if (!this.rankingReader || typeof this.rankingReader.readRankingRows !== 'function') return { ok: false, code: 'RANKING_READER_REQUIRED' };
    const snapshot = await this.rankingReader.readRankingRows(query);
    const kind = query.kind === 'clan' ? 'clan' : 'character';
    const metric = query.metric || (kind === 'clan' ? 'points' : 'nationalPoints');
    const items = competitionRank(snapshot?.rows ?? [], metric, 'name', kind === 'clan' ? 'clanId' : 'characterId');
    return { ok: true, code: 'RANKINGS', kind, metric, updatedAt: snapshot?.updatedAt ?? null, items };
  }
}
module.exports = { CombatSocialLedger, competitionRank };
