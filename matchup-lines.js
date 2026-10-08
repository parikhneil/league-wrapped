(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MatchupLines = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const finite = (value) => ["number", "string"].includes(typeof value) && value !== "" && Number.isFinite(Number(value));
  const same = (a, b) => a != null && b != null && String(a) === String(b);
  const vacant = (value) => value == null || String(value).trim() === "" || String(value) === "0";
  const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const half = (value) => Math.round(value * 2) / 2;
  const aliases = { LA: "LAR", STL: "LAR", OAK: "LV", SD: "LAC", JAC: "JAX", WSH: "WAS", WSA: "WAS", ARZ: "ARI", NEP: "NE", SFO: "SF", TBB: "TB", KCC: "KC", GNB: "GB", NOS: "NO" };
  const franchises = new Set("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split(" "));
  const teamCode = (value) => { const code = String(value || "").toUpperCase(); return aliases[code] || code; };
  const positionCode = (value) => ({ DST: "DEF", "D/ST": "DEF", D: "DEF", PK: "K" })[String(value || "").toUpperCase()] || String(value || "").toUpperCase();
  const bench = new Set(["BN", "BENCH", "IR", "RESERVE", "TAXI"]);
  const flexPositions = { FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"],
    REC_FLEX: ["WR", "TE"], WRRB_FLEX: ["RB", "WR"], IDP_FLEX: ["DL", "LB", "DB"] };
  const legalPositions = new Set(["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]);
  const positionGroup = (value) => {
    const position = positionCode(value);
    return ["DE", "DT", "NT", "EDGE"].includes(position) ? "DL" :
      ["ILB", "MLB", "OLB"].includes(position) ? "LB" : ["CB", "S", "FS", "SS"].includes(position) ? "DB" : position;
  };
  const regularEnd = (start) => Number(start ?? 15) > 0 ? Math.min(18, Number(start ?? 15) - 1) : 18;
  const generic = {
    QB: [-3, 0, 6, 10, 14, 16, 18, 20, 22, 25, 28, 32, 38],
    RB: [0, 0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 25, 35],
    WR: [0, 0, 3, 5, 7, 9, 11, 14, 17, 21, 27, 36],
    TE: [0, 0, 2, 4, 6, 8, 10, 13, 17, 24, 30],
    K: [-2, 0, 3, 5, 7, 9, 11, 13, 16, 20],
    DEF: [-5, -2, 0, 2, 4, 6, 8, 10, 14, 20, 30],
    UNKNOWN: [-5, 0, 0, 3, 5, 7, 9, 12, 15, 19, 24, 30, 38],
  };

  function fingerprint(settings) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
    const entries = Object.entries(settings).filter(([, value]) => finite(value) && Number(value) !== 0)
      .map(([key, value]) => [key, Number(value)]).sort(([a], [b]) => a.localeCompare(b));
    return entries.length ? JSON.stringify(entries) : null;
  }
  function rng(seed) {
    let hash = 2166136261;
    for (const c of String(seed)) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return function () {
      hash += 0x6d2b79f5;
      let t = hash;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function fairAmerican(probability) {
    if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return null;
    return probability > 0.5 ? -Math.round(100 * probability / (1 - probability)) : Math.round(100 * (1 - probability) / probability);
  }
  function summary(values) {
    if (!values.length) return { mean: null, median: null, p10: null, p90: null };
    const sorted = Array.from(values).sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return { mean: mean(values), median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
      p10: sorted[Math.floor((sorted.length - 1) * 0.1)], p90: sorted[Math.floor((sorted.length - 1) * 0.9)] };
  }
  function market(values, line) {
    let over = 0, under = 0, push = 0;
    for (const value of values) {
      if (Math.abs(value - line) < 1e-7) push++;
      else if (value > line) over++;
      else under++;
    }
    const decided = over + under;
    return { line, overProbability: over / values.length, underProbability: under / values.length,
      pushProbability: push / values.length, overOdds: decided ? fairAmerican(over / decided) : null,
      underOdds: decided ? fairAmerican(under / decided) : null };
  }
  function thresholds(values, lines) {
    return lines.map((line) => {
      const probability = values.filter((value) => value + 1e-7 >= line).length / values.length;
      return { line, probability, odds: fairAmerican(probability) };
    });
  }
  function metadata(data, id, slot) {
    const raw = data.players?.[id] || {};
    const idTeam = teamCode(id), identifiedDefense = franchises.has(idTeam);
    const position = positionGroup(raw.position || raw.pos || raw.fantasy_positions?.[0] ||
      (identifiedDefense ? "DEF" : ["QB", "RB", "WR", "TE", "K", "DEF"].includes(positionCode(slot)) ? slot : "UNKNOWN"));
    const fantasyPositions = [...new Set((Array.isArray(raw.fantasy_positions) && raw.fantasy_positions.length ?
      raw.fantasy_positions : [identifiedDefense ? "DEF" : raw.position || raw.pos]).map(positionGroup).filter((pos) => legalPositions.has(pos)))];
    const team = teamCode(raw.team || (identifiedDefense ? idTeam : ""));
    return { id: String(id), name: raw.name || raw.full_name || `${raw.first_name || ""} ${raw.last_name || ""}`.trim() || String(id),
      position, fantasyPositions, team: franchises.has(team) ? team : null,
      injuryStatus: String(raw.injuryStatus || raw.injury_status || ""), metadataKnown: own(data.players, id) || identifiedDefense };
  }

  function collectHistory(data, slots, currentWeek) {
    const required = fingerprint(data.league?.scoring_settings), blocks = [...(data.history || [])];
    const year = String(data.league?.season || "");
    if (!blocks.some((block) => String(block.season || block.league?.season) === year &&
      fingerprint(block.scoring_settings || block.league?.scoring_settings) === required)) {
      blocks.push({ season: year, scoring_settings: data.league?.scoring_settings,
        lastCompletedWeek: Math.min(currentWeek - 1, Number(data.league?.settings?.last_scored_leg ?? currentWeek - 1)), weeks: data.weeks || [] });
    }
    const observations = new Map(), pools = new Map(), seen = new Set(), priorSeen = new Set();
    const compatibleSeasons = new Set(), discardedSeasons = [], historyWeeks = [];
    for (const block of blocks) {
      const season = String(block.season || block.league?.season || "unknown");
      const scoring = fingerprint(block.scoring_settings || block.league?.scoring_settings);
      if (required === null || scoring === null || scoring !== required) {
        discardedSeasons.push({ season, reason: scoring === null ? "Scoring settings unavailable" : "Scoring settings differ from this league" });
        continue;
      }
      compatibleSeasons.add(season);
      const cutoff = Math.max(0, Math.min(Number(block.lastCompletedWeek ?? block.league?.settings?.last_scored_leg ?? 0),
        regularEnd(block.playoffWeekStart ?? block.league?.settings?.playoff_week_start ?? data.league?.settings?.playoff_week_start),
        season === year ? currentWeek - 1 : 18));
      for (let index = 0; index < cutoff; index++) {
        const groups = new Map();
        for (const matchup of block.weeks?.[index] || []) {
          if (matchup.matchup_id == null) continue;
          if (!groups.has(String(matchup.matchup_id))) groups.set(String(matchup.matchup_id), []);
          groups.get(String(matchup.matchup_id)).push(matchup);
        }
        const eligible = [...groups.values()].filter((pair) => pair.length === 2 &&
          !same(pair[0].roster_id, pair[1].roster_id) && pair.every((m) => finite(m.points))).flat();
        if (!eligible.length) continue;
        historyWeeks.push({ season, week: index + 1 });
        for (const matchup of eligible) {
          const starters = Array.isArray(matchup.starters) ? matchup.starters.map(String) : [];
          for (const [id, value] of Object.entries(matchup.players_points || {})) {
            if (vacant(id) || !finite(value)) continue;
            const key = `${season}:${index + 1}:${id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!observations.has(id)) observations.set(id, []);
            observations.get(id).push(Number(value));
          }
          for (let slot = 0; slot < starters.length; slot++) {
            const id = starters[slot], key = `${season}:${index + 1}:${id}`;
            if (vacant(id) || priorSeen.has(key) || !finite(matchup.players_points?.[id])) continue;
            priorSeen.add(key);
            const pos = metadata(data, id, slots[slot]).position;
            if (!pools.has(pos)) pools.set(pos, []);
            pools.get(pos).push(Number(matchup.players_points[id]));
          }
        }
      }
    }
    const distinctWeeks = [...new Map(historyWeeks.map((entry) => [`${entry.season}:${entry.week}`, entry])).values()];
    return { observations, pools, coverage: { compatibleSeasons: [...compatibleSeasons], discardedSeasons,
      completedWeeks: distinctWeeks.length, historyWeeks: distinctWeeks, observedPlayers: observations.size,
      playerObservations: [...observations.values()].reduce((n, values) => n + values.length, 0) } };
  }
  function priorFor(position, pools) {
    if (pools.get(position)?.length) return { values: pools.get(position), type: "same_scoring_position_prior" };
    const permitted = position === "FLEX" ? ["RB", "WR", "TE"] : position === "SUPER_FLEX" ? ["QB", "RB", "WR", "TE"] : [];
    const combined = permitted.flatMap((pos) => pools.get(pos) || []);
    if (combined.length) return { values: combined, type: "same_scoring_flex_prior" };
    if (position === "UNKNOWN") {
      const all = [...pools.values()].flat();
      if (all.length) return { values: all, type: "same_scoring_unknown_position_prior" };
    }
    return { values: generic[position] || generic.UNKNOWN, type: "generic_uncalibrated_prior" };
  }
  function scheduleTeams(data, week) {
    if (data.scheduleComplete !== true) return null;
    const games = (data.schedule || []).filter((game) => Number(game.week) === week);
    if (!games.length || games.some((game) => !franchises.has(teamCode(game.home)) ||
      !franchises.has(teamCode(game.away)) || teamCode(game.home) === teamCode(game.away))) return null;
    const codes = games.flatMap((game) => [teamCode(game.home), teamCode(game.away)]);
    if (new Set(codes).size !== codes.length) return null;
    return new Set(games.flatMap((game) => [teamCode(game.home), teamCode(game.away)]).filter((code) => franchises.has(code)));
  }
  function freshStatus(data, now) {
    const updated = Date.parse(data.playersUpdatedAt || ""), asOf = Date.parse(data.asOf || "");
    return Number.isFinite(updated) && Number.isFinite(asOf) && asOf >= updated && now >= updated && now - updated <= 24 * 3600000 &&
      new Date(asOf).getUTCFullYear() === Number(data.league?.season);
  }
  function playerProjection(data, id, week, currentWeek, history, activeTeams, now) {
    const meta = metadata(data, id), empirical = history.observations.get(String(id)) || [];
    const prior = priorFor(meta.position, history.pools), weight = empirical.length / (empirical.length + 4);
    const isBye = Boolean(activeTeams && meta.team && !activeTeams.has(meta.team));
    const isOut = week === currentWeek && freshStatus(data, now) && ["OUT", "IR", "INJURED RESERVE"].includes(meta.injuryStatus.toUpperCase());
    const expectedPoints = isBye || isOut ? 0 : weight * (mean(empirical) || 0) + (1 - weight) * mean(prior.values);
    return { meta, empirical, prior, weight, isBye, isOut, expectedPoints };
  }
  function playerForecast(data, id, slot, week, currentWeek, history, samples, seed, activeTeams, now, projection) {
    const { meta, empirical, prior, weight, isBye, isOut, expectedPoints } = projection ||
      playerProjection(data, id, week, currentWeek, history, activeTeams, now);
    const random = rng(`${seed}|${data.league?.league_id}|${data.league?.season}|${week}|${id}`);
    const values = new Float64Array(samples);
    if (!isBye && !isOut) {
      for (let i = 0; i < samples; i++) {
        const pool = empirical.length && random() < weight ? empirical : prior.values;
        values[i] = pool[Math.floor(random() * pool.length)];
      }
    }
    const stats = summary(values), line = half(stats.median);
    return { values, output: { ...meta, slot, expectedPoints, mean: stats.mean, median: stats.median, p10: stats.p10, p90: stats.p90,
      ...market(values, line), observations: empirical.length,
      coverage: { type: isBye ? "verified_nfl_bye" : isOut ? "current_out_or_ir" : empirical.length ? "empirical_with_position_shrinkage" : prior.type,
        shrinkageWeight: weight, prior: prior.type, metadataKnown: meta.metadataKnown },
      status: isBye ? "bye" : isOut ? "out" : empirical.length ? "historical" : "prior_only",
      reason: isBye ? "Zero: verified complete NFL schedule has no game for this team this week." : isOut ?
        "Zero for the current week: the current cached OUT/IR tag is assumed inactive for this forecast, not a confirmed gameday inactive. Future weeks are not assumed out." :
        empirical.length ? `${empirical.length} completed same-scoring observation(s); shrunk toward the position prior.` :
          prior.type === "generic_uncalibrated_prior" ? "No compatible position history; broad generic prior, not a calibrated projection." :
            "No compatible player history; uses an observed same-scoring positional prior.",
      thresholds: thresholds(values, [5, 10, 15, 20, 25, 30]) } };
  }

  function optimalLineup(candidates, slots) {
    // Minimum-cost flow finds a global assignment, including reassignment of
    // dual-eligible players. Selection happens before any simulated outcomes.
    const source = 0, playerStart = 1, slotStart = playerStart + candidates.length,
      sink = slotStart + slots.length, graph = Array.from({ length: sink + 1 }, () => []);
    const edges = [];
    const edge = (from, to, cost) => {
      const forward = { to, reverse: graph[to].length, capacity: 1, cost };
      const reverse = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost };
      graph[from].push(forward); graph[to].push(reverse);
      return forward;
    };
    candidates.forEach((candidate, index) => {
      edge(source, playerStart + index, -candidate.expectedPoints);
      slots.forEach((slot, slotIndex) => {
        const permitted = flexPositions[slot] || (legalPositions.has(slot) ? [slot] : []);
        if (candidate.meta.fantasyPositions.some((position) => permitted.includes(position)))
          edges.push({ player: index, slot: slotIndex, edge: edge(playerStart + index, slotStart + slotIndex, 0) });
      });
    });
    slots.forEach((_, index) => edge(slotStart + index, sink, 0));
    let filled = 0;
    while (filled < slots.length) {
      const distances = Array(graph.length).fill(Infinity), previous = Array(graph.length).fill(null);
      distances[source] = 0;
      for (let pass = 0; pass < graph.length - 1; pass++) {
        let changed = false;
        for (let from = 0; from < graph.length; from++) {
          if (!Number.isFinite(distances[from])) continue;
          graph[from].forEach((link, index) => {
            const next = distances[from] + link.cost;
            if (link.capacity && next < distances[link.to] - 1e-10) {
              distances[link.to] = next; previous[link.to] = [from, index]; changed = true;
            }
          });
        }
        if (!changed) break;
      }
      if (!previous[sink]) break;
      for (let node = sink; node !== source;) {
        const [from, index] = previous[node], link = graph[from][index];
        link.capacity--; graph[node][link.reverse].capacity++; node = from;
      }
      filled++;
    }
    const selected = Array(slots.length).fill(null);
    for (const assignment of edges)
      if (!assignment.edge.capacity) selected[assignment.slot] = candidates[assignment.player];
    return { complete: filled === slots.length, selected };
  }

  function analyze(data, options = {}) {
    const league = data?.league || {}, currentWeek = Math.max(1, Number(data?.currentWeek) || 1);
    const samples = Number.isInteger(options.samples) && options.samples >= 100 && options.samples <= 20000 ? options.samples : 4000;
    const seed = String(options.seed ?? "league-lines-v1"), slots = (league.roster_positions || []).map(positionCode).filter((pos) => !bench.has(pos));
    const now = finite(options.now) ? Number(options.now) : typeof options.now === "string" && Number.isFinite(Date.parse(options.now)) ? Date.parse(options.now) : Date.now();
    const scoringVerified = fingerprint(league.scoring_settings) !== null;
    const endWeek = regularEnd(league.settings?.playoff_week_start);
    const history = collectHistory(data, slots, currentWeek), names = {};
    for (const user of data.users || []) names[String(user.user_id)] = user.display_name || user.full_name || user.username || String(user.user_id);
    Object.assign(names, data.managerNames || {});
    const rosters = new Map((data.rosters || []).map((roster) => [String(roster.roster_id), roster]));
    const priorOnly = new Set(), genericOnly = new Set();
    const requestedWeek = options.week == null || options.week === "all" ? null : Number(options.week);
    const weeks = [];
    const teamIdentity = (rid) => { const roster = rosters.get(String(rid)), uid = String(roster?.owner_id || `roster:${rid}`);
      return { rosterId: String(rid), uid, name: names[uid] || `Team ${rid}` }; };
    const makeTeam = (rid, week, activeTeams) => {
      const identity = teamIdentity(rid), roster = rosters.get(String(rid));
      const coverage = { complete: true, lineupSource: "optimal_projected_roster", warnings: [] };
      const unavailable = () => ({ output: { ...identity, projectedPoints: null, winProbability: null, tieProbability: null,
        fairMoneyline: null, teamTotal: null, thresholds: [], players: [], lineupExpectedPoints: null, coverage }, values: null });
      if (!scoringVerified || Number(league.settings?.best_ball) === 1 || !Array.isArray(roster?.players) || !roster.players.length || !slots.length) {
        coverage.complete = false;
        coverage.warnings.push(!scoringVerified ? "League scoring settings are missing or all zero; fantasy point markets are unavailable." :
          Number(league.settings?.best_ball) === 1 ? "Best-ball lineup scoring is unsupported; a preselected projected lineup is not hindsight best ball." :
            "The full current roster or starting-slot settings are unavailable; submitted starters are not used as a substitute.");
        return unavailable();
      }
      const reserved = new Set([...(roster.reserve || []), ...(roster.taxi || [])].map(String));
      const ids = [...new Set(roster.players.filter((id) => !vacant(id)).map(String))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      const candidates = [];
      for (const id of ids) {
        if (reserved.has(id)) continue;
        const projection = playerProjection(data, id, week, currentWeek, history, activeTeams, now);
        if (!projection.meta.fantasyPositions.length) {
          coverage.warnings.push(`Player ${id} has unknown legal position eligibility and was excluded from lineup selection.`);
          continue;
        }
        candidates.push(projection);
      }
      const lineup = optimalLineup(candidates, slots);
      if (!lineup.complete) {
        coverage.complete = false;
        const missing = lineup.selected.flatMap((candidate, index) => candidate ? [] : [`${slots[index]} slot ${index + 1}`]);
        coverage.warnings.push(`The current roster cannot fill every legal starting slot with known eligibility: ${missing.join(", ")}. Reserve/taxi players are not activated automatically; missing slots are not assigned zero points.`);
        return unavailable();
      }
      const values = new Float64Array(samples), players = [];
      for (let index = 0; index < lineup.selected.length; index++) {
        const projection = lineup.selected[index], id = projection.meta.id;
        const forecast = playerForecast(data, id, slots[index], week, currentWeek, history, samples, seed, activeTeams, now, projection);
        players.push(forecast.output);
        if (!forecast.output.observations && !["bye", "out"].includes(forecast.output.status)) priorOnly.add(String(id));
        if (forecast.output.coverage.prior === "generic_uncalibrated_prior" && !["bye", "out"].includes(forecast.output.status)) genericOnly.add(String(id));
        if (["bye", "out"].includes(forecast.output.status))
          coverage.warnings.push(`${forecast.output.name} fills ${slots[index]} with a known zero-point ${forecast.output.status === "bye" ? "NFL bye" : "cached OUT/IR"} assumption; no higher-expected-point legal alternative was available.`);
        for (let i = 0; i < samples; i++) values[i] += forecast.values[i];
      }
      const stats = summary(values);
      return { values: coverage.complete ? values : null, output: { ...identity,
        lineupExpectedPoints: lineup.selected.reduce((sum, candidate) => sum + candidate.expectedPoints, 0),
        projectedPoints: coverage.complete ? stats.mean : null, p10: coverage.complete ? stats.p10 : null,
        p90: coverage.complete ? stats.p90 : null, winProbability: null, tieProbability: null,
        fairMoneyline: null, teamTotal: coverage.complete ? market(values, half(stats.median)) : null,
        thresholds: coverage.complete ? thresholds(values, [80, 100, 120, 140, 160, 180]) : [], players, coverage } };
    };
    for (let week = currentWeek; week <= endWeek; week++) {
      if (requestedWeek !== null && requestedWeek !== week) continue;
      const groups = new Map(), rows = data.weeks?.[week - 1] || [], matched = new Set(), matchups = [], simulated = [];
      const activeTeams = scheduleTeams(data, week);
      const kickoffs = (data.schedule || []).filter((game) => Number(game.week) === week)
        .map((game) => Date.parse(game.kickoff || "")).filter(Number.isFinite);
      const started = kickoffs.some((kickoff) => kickoff <= now);
      for (const row of rows) {
        if (!rosters.has(String(row.roster_id)) || row.matchup_id == null) continue;
        const key = String(row.matchup_id);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
      const spreadMarket = (margins, homeLine) => { const outcome = market(margins, -homeLine);
        return { homeLine, awayLine: -homeLine, homeCoverProbability: outcome.overProbability,
          awayCoverProbability: outcome.underProbability, pushProbability: outcome.pushProbability,
          homeOdds: outcome.overOdds, awayOdds: outcome.underOdds }; };
      for (const [id, pair] of groups) {
        if (pair.length !== 2 || same(pair[0].roster_id, pair[1].roster_id)) continue;
        const ordered = pair.slice().sort((a, b) => Number(a.roster_id) - Number(b.roster_id) || String(a.roster_id).localeCompare(String(b.roster_id)));
        const teams = ordered.map((row) => makeTeam(row.roster_id, week, activeTeams));
        ordered.forEach((row) => matched.add(String(row.roster_id)));
        const available = teams.every((team) => team.values !== null);
        const result = { id: `${week}:${id}`, matchupId: id, week, available, heldLineup: false, heldRoster: week > currentWeek,
          lineupOptimized: true, started, fullWeekBaseline: true,
          teams: teams.map((team) => team.output), tieProbability: null, spread: null, total: null,
          alternates: { spreads: [], totals: [] }, notes: ["The first/second fantasy teams are called home/away only to define spread signs; no venue advantage is modeled.",
            `Selects the legal lineup with the highest projected expected points from each current roster for Week ${week}; submitted starters and bench choices do not change this forecast.`,
            "Lineups are fixed before simulation, not optimized after seeing each outcome. No live accrued points or in-game updates are modeled.",
            week > currentWeek ? "Future weeks reoptimize the current roster for that week's verified byes; future acquisitions and injury developments are unknown." : "Current fresh cached OUT/IR tags are assumed inactive; these are not confirmed gameday inactive lists."] };
        if (available) {
          const margins = new Float64Array(samples), totals = new Float64Array(samples);
          let homeWins = 0, awayWins = 0, ties = 0;
          for (let i = 0; i < samples; i++) {
            margins[i] = teams[0].values[i] - teams[1].values[i];
            totals[i] = teams[0].values[i] + teams[1].values[i];
            if (Math.abs(margins[i]) < 1e-7) ties++;
            else if (margins[i] > 0) homeWins++;
            else awayWins++;
          }
          result.tieProbability = ties / samples;
          [homeWins, awayWins].forEach((wins, i) => { result.teams[i].winProbability = wins / samples;
            result.teams[i].tieProbability = ties / samples;
            result.teams[i].moneylineProbability = (wins + ties / 2) / samples;
            result.teams[i].fairMoneyline = fairAmerican(result.teams[i].moneylineProbability); });
          result.spread = spreadMarket(margins, -half(summary(margins).median));
          result.total = market(totals, half(summary(totals).median));
          result.alternates.spreads = [-7, -3, 3, 7].map((change) => spreadMarket(margins, result.spread.homeLine + change));
          result.alternates.totals = [-20, -10, 10, 20].map((change) => market(totals, result.total.line + change));
          simulated.push(...teams);
        } else result.notes.push("Projection unavailable: at least one full roster cannot provide a known legal lineup, scoring is unavailable, or the league uses unsupported best-ball scoring.");
        matchups.push(result);
      }
      const shares = new Float64Array(simulated.length);
      for (let i = 0; i < samples && simulated.length; i++) {
        const maximum = Math.max(...simulated.map((team) => team.values[i]));
        const winners = simulated.flatMap((team, index) => Math.abs(team.values[i] - maximum) < 1e-7 ? [index] : []);
        for (const index of winners) shares[index] += 1 / winners.length;
      }
      const highestScorer = simulated.map((team, index) => ({ ...teamIdentity(team.output.rosterId),
        probability: shares[index] / samples, odds: fairAmerican(shares[index] / samples) }))
        .sort((a, b) => b.probability - a.probability || a.rosterId.localeCompare(b.rosterId));
      const unscheduled = [...rosters.keys()].filter((rid) => !matched.has(rid)).map((rid) => ({ ...teamIdentity(rid), reason: "No confirmed two-team fantasy matchup in the saved schedule." }));
      weeks.push({ week, heldLineup: false, heldRoster: week > currentWeek, lineupOptimized: true, started, fullWeekBaseline: true, matchups: options.manager && options.manager !== "all" ?
        matchups.filter((matchup) => matchup.teams.some((team) => team.uid === String(options.manager))) : matchups,
        unscheduled, highestScorer, highestScorerScope: "Among simulated scheduled teams; ties split equally.",
        highestScorerComplete: simulated.length === rosters.size, nflScheduleVerified: activeTeams !== null });
    }
    const limitations = [
      "Fantasy simulations only: fair descriptive prices with no vig, wagers, sportsbook comparison, or betting actions.",
      "Uncalibrated historical bootstrap, not a validated forecast or prediction guarantee. Opponent defenses, usage news, and correlated NFL game environments are not modeled.",
      "Player scores are sampled independently; that misses teammate/opponent correlation, and empirical tails can miss rare outcomes.",
      "Low player sample sizes shrink toward same-scoring positional starter distributions. Missing position history uses a broad generic uncalibrated prior that may not fit unusual scoring rules.",
      "Each week selects one legal lineup maximizing projected expected points from the full current roster. Submitted starters are ignored; future acquisitions are unknown, and reserve/taxi players are not activated automatically.",
      "Lineup selection uses expected scores before simulation, not hindsight outcome-by-outcome optimization. Best-ball scoring is unsupported. Postseason pairings are omitted because future brackets are unconfirmed.",
      "OUT/IR zeroing requires player metadata no older than 24 hours and applies only to the current week. Unverified NFL schedules never force a bye zero.",
      "Win and tie chances are separate; moneylines split tie probability evenly. Spread/total/prop prices exclude pushes. A simulated 0% or 100% has no finite American price and is not certainty.",
    ];
    if (history.coverage.discardedSeasons.length) limitations.push(`Excluded historical seasons with unavailable or different scoring: ${history.coverage.discardedSeasons.map((entry) => entry.season).join(", ")}. Scores cannot be rescored without underlying scoring components.`);
    return { currentWeek, asOf: data.asOf || null, sourceUpdatedAt: data.sourceUpdatedAt || null, weeks, names,
      model: { method: "Optimal projected legal lineup, then individual-player empirical bootstrap with positional shrinkage", samples, seed, evaluatedAt: new Date(now).toISOString(),
        forecastThroughWeek: endWeek, priorStrength: 4, limitations, coverage: { ...history.coverage,
          priorOnlyPlayers: priorOnly.size, genericPriorPlayers: genericOnly.size,
          scoringVerified, playersUpdatedAt: data.playersUpdatedAt || null, currentInjuryMetadataFresh: freshStatus(data, now),
          scheduleComplete: data.scheduleComplete === true } } };
  }
  return { analyze, fairAmerican };
});
