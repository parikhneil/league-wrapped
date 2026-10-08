/* Historical fantasy comebacks require recorded scores, not weekly final totals. */
(function (root) {
  "use strict";
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const positiveId = (value) => Number.isInteger(value) && value > 0;
  const label = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 180;
  const stamp = (value) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));

  function analyze(seasons) {
    const comebacks = [],
      coverage = {
        completedMatchups: 0,
        sampledMatchups: 0,
        probabilityMatchups: 0,
        pendingMatchups: 0,
        inputSnapshots: 0,
        validSnapshots: 0,
        rejectedSnapshots: 0,
        duplicateSnapshots: 0,
        sources: [],
      },
      allSources = new Set();
    for (const s of seasons || []) {
      const league = s.league || {}, year = String(league.season || ""),
        season = `${year} (${s.src})`,
        owner = Object.fromEntries((s.rosters || []).filter((r) => r.owner_id).map((r) => [r.roster_id, r.owner_id])),
        cutoff = league.settings?.last_scored_leg ?? (league.status === "complete" ? 18 : 0),
        pairs = new Map();
      (s.weeks || []).forEach((teams, i) => {
        const groups = new Map();
        for (const team of teams || []) {
          if (!positiveId(team.roster_id) || !positiveId(team.matchup_id) || !owner[team.roster_id]) continue;
          const group = groups.get(team.matchup_id) || [];
          group.push(team);
          groups.set(team.matchup_id, group);
        }
        for (const [matchupId, group] of groups) {
          if (group.length !== 2 || group[0].roster_id === group[1].roster_id || !group.every((t) => finite(t.points))) continue;
          const completed = i + 1 <= cutoff;
          pairs.set(`${i + 1}:${matchupId}`, { group, completed, week: i + 1, matchupId });
          if (completed) coverage.completedMatchups++;
        }
      });
      const history = s.comebackHistory;
      if (!history || !Array.isArray(history.snapshots)) continue;
      coverage.inputSnapshots += history.snapshots.length;
      // Recorded roster IDs are only meaningful inside their original league and year.
      if (history.version !== 1 || String(history.season) !== year ||
          !league.league_id || String(history.league_id) !== String(league.league_id)) {
        coverage.rejectedSnapshots += history.snapshots.length;
        continue;
      }
      const samples = new Map(), seen = new Map(), conflicts = new Set();
      for (const sample of history.snapshots) {
        const pair = sample && pairs.get(`${sample.week}:${sample.matchup_id}`),
          source = sample?.source || history.source,
          teams = sample?.teams,
          time = stamp(sample?.captured_at) ? Date.parse(sample.captured_at) : NaN;
        if (!pair || !Number.isInteger(sample.week) || !stamp(sample.captured_at) || !label(source) ||
            !Array.isArray(teams) || teams.length !== 2 ||
            !teams.every((t) => t && positiveId(t.roster_id) && finite(t.points)) ||
            teams[0].roster_id === teams[1].roster_id ||
            !teams.every((t) => pair.group.some((p) => p.roster_id === t.roster_id)) ||
            time < Date.UTC(Number(year), 7, 1) || time > Date.UTC(Number(year) + 1, 2, 1)) {
          coverage.rejectedSnapshots++;
          continue;
        }
        const probabilities = teams.map((t) => t.win_probability),
          hasProbability = probabilities.some((p) => p != null),
          probabilitySource = sample.probability_source || history.probability_source,
          probabilityKind = sample.probability_kind || history.probability_kind;
        if (hasProbability && (probabilityKind !== "fantasy_matchup" || !label(probabilitySource) ||
            !probabilities.every((p) => finite(p) && p >= 0 && p <= 1) ||
            Math.abs(probabilities[0] + probabilities[1] - 1) > 0.001)) {
          coverage.rejectedSnapshots++;
          continue;
        }
        const key = `${sample.week}:${sample.matchup_id}`,
          identity = `${key}:${time}`,
          fingerprint = JSON.stringify([...teams].sort((a, b) => a.roster_id - b.roster_id).map((t) => [t.roster_id, t.points, t.win_probability ?? null]));
        if (seen.has(identity)) {
          if (seen.get(identity) === fingerprint) coverage.duplicateSnapshots++;
          else { conflicts.add(identity); coverage.rejectedSnapshots++; }
          continue;
        }
        seen.set(identity, fingerprint);
        const list = samples.get(key) || [];
        list.push({ ...sample, source: source.trim(), probabilitySource: hasProbability ? probabilitySource.trim() : null, time, identity });
        samples.set(key, list);
      }
      for (const [key, snapshots] of samples) {
        const pair = pairs.get(key), valid = snapshots.filter((p) => !conflicts.has(p.identity)).sort((a, b) => a.time - b.time);
        coverage.rejectedSnapshots += snapshots.length - valid.length;
        coverage.validSnapshots += valid.length;
        if (!valid.length) continue;
        valid.forEach((p) => allSources.add(p.source));
        if (!pair.completed) { coverage.pendingMatchups++; continue; }
        coverage.sampledMatchups++;
        if (valid.some((p) => p.probabilitySource)) coverage.probabilityMatchups++;
        const [a, b] = pair.group;
        if (a.points === b.points) continue;
        const winner = a.points > b.points ? a : b, loser = winner === a ? b : a,
          trace = valid.map((p) => {
            const me = p.teams.find((t) => t.roster_id === winner.roster_id), other = p.teams.find((t) => t.roster_id === loser.roster_id);
            return { capturedAt: p.captured_at, winnerPoints: me.points, loserPoints: other.points,
              deficit: other.points - me.points, winProbability: p.probabilitySource ? me.win_probability : null,
              source: p.source, probabilitySource: p.probabilitySource,
              method: p.method || history.method || "observed", checkpoint: p.checkpoint || null };
          }),
          worst = trace.reduce((a, b) => a.deficit >= b.deficit ? a : b),
          odds = trace.filter((p) => p.winProbability !== null),
          lowest = odds.length ? odds.reduce((a, b) => a.winProbability <= b.winProbability ? a : b) : null;
        if (worst.deficit <= 0 && (!lowest || lowest.winProbability >= 0.5)) continue;
        comebacks.push({
          season, year, src: s.src, week: pair.week, matchupId: pair.matchupId,
          winnerUid: owner[winner.roster_id], loserUid: owner[loser.roster_id],
          winnerPoints: winner.points, loserPoints: loser.points,
          maxDeficit: Math.max(0, worst.deficit), lowestWinProbability: lowest?.winProbability ?? null,
          deficitAt: worst.deficit > 0 ? worst.capturedAt : null,
          probabilityAt: lowest?.capturedAt ?? null, probabilitySource: lowest?.probabilitySource ?? null,
          samples: trace.length, source: [...new Set(valid.map((p) => p.source))].join("; "),
          method: [...new Set(trace.map((p) => p.method))].join("; "),
          checkpoint: worst.deficit > 0 ? worst.checkpoint : null,
          trace,
        });
      }
    }
    coverage.sources = [...allSources].sort();
    comebacks.sort((a, b) => b.maxDeficit - a.maxDeficit || a.season.localeCompare(b.season) || a.week - b.week);
    return { comebacks, coverage };
  }
  const api = { analyze };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ComebackHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
