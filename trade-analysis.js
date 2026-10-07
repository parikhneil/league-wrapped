(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TradeAnalysis = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const score = (value) =>
    value !== null && value !== undefined && value !== "" &&
    ["number", "string"].includes(typeof value) && Number.isFinite(Number(value));
  const same = (a, b) => a != null && b != null && String(a) === String(b);
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  const number = (value) => score(value) ? Number(value) : null;
  const instant = (transaction) =>
    number(transaction.status_updated) ?? number(transaction.created);

  // Completed timestamps matter: Sleeper's leg can retain the proposal week.
  // Actual week boundaries take priority. The fallback estimates NFL fantasy
  // weeks as Tuesday through Monday, beginning in the Labor Day kickoff week.
  function timing(transaction, season) {
    const reportedWeek = number(transaction.leg);
    const date = instant(transaction);
    const dates = season.weekDates || season.league?.weekDates;
    if (date !== null && Array.isArray(dates) && dates.length) {
      const valid = dates.map((entry, index) => ({
        week: Number(entry.week) || index + 1,
        start: Date.parse(entry.start || entry.startDate || entry),
      })).filter((entry) => Number.isFinite(entry.start))
        .sort((a, b) => a.start - b.start);
      if (valid.length) {
        const current = valid.filter((entry) => entry.start <= date).at(-1);
        return { week: current?.week || 0, reportedWeek, date, timingMethod: "completion_date" };
      }
    }
    const year = Number(season.league?.season);
    if (date !== null && Number.isInteger(year) && year >= 2000 && year <= 2100) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric",
      }).formatToParts(new Date(date));
      const calendar = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      const completionYear = Number(calendar.year);
      if (completionYear === year || (completionYear === year + 1 && Number(calendar.month) === 1)) {
        const firstDay = new Date(Date.UTC(year, 8, 1)).getUTCDay();
        const firstMonday = 1 + (8 - firstDay) % 7;
        const start = Date.UTC(year, 8, firstMonday + 1);
        const completion = Date.UTC(completionYear, Number(calendar.month) - 1, Number(calendar.day));
        return {
          week: Math.max(0, Math.floor((completion - start) / (7 * 86400000)) + 1),
          reportedWeek, date, timingMethod: "calendar_estimate",
        };
      }
    }
    return {
      week: reportedWeek === null ? null : Math.max(0, Math.floor(reportedWeek)),
      reportedWeek, date, timingMethod: "reported_week",
    };
  }

  function cutoffFor(season) {
    const explicit = number(season.league?.settings?.last_scored_leg);
    if (explicit !== null) return Math.max(0, Math.floor(explicit));
    if (season.league?.status === "complete") {
      // Historical imports can reserve an empty week 18 after a league's week
      // 17 finish. Keep gaps inside the observed season, but do not invent a
      // missing final week from the array length. Real paired zero scores count.
      for (let index = (season.weeks?.length || 0) - 1; index >= 0; index--) {
        const groups = new Map();
        for (const m of season.weeks[index] || []) {
          if (m.matchup_id == null) continue;
          const key = `${m.bracket || "NONE"}:${m.matchup_id}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(m);
        }
        if ([...groups.values()].some((pair) => pair.length === 2 &&
          !same(pair[0].roster_id, pair[1].roster_id) && pair.every((m) => score(m.points)))) return index + 1;
      }
      return 0;
    }
    // Unfinished seasons without a completed-week marker are not guessed from
    // live partial scores: that would contaminate rest-of-season outcomes.
    return 0;
  }

  function weeklyResults(season, owners, cutoff, playoffStart) {
    const rows = new Map();
    for (let week = 1; week <= cutoff; week++) {
      const raw = season.weeks?.[week - 1] || [];
      const eligible = raw.filter((m) => own(owners, m.roster_id) && m.matchup_id != null);
      const groups = new Map();
      for (const matchup of eligible) {
        const key = `${matchup.bracket || "NONE"}:${matchup.matchup_id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(matchup);
      }
      const pairs = [...groups.values()].filter((pair) =>
        pair.length === 2 && !same(pair[0].roster_id, pair[1].roster_id) &&
        pair.every((matchup) => score(matchup.points)));
      const teams = pairs.flat();
      const complete = eligible.length === teams.length;
      const baseline = complete && teams.length ? sum(teams.map((m) => Number(m.points))) / teams.length : null;
      for (const pair of pairs) {
        for (const me of pair) {
          const opponent = pair.find((m) => m !== me);
          const points = Number(me.points), against = Number(opponent.points);
          const others = teams.filter((m) => m !== me);
          const expected = complete && others.length ?
            (others.filter((m) => points > Number(m.points)).length +
             others.filter((m) => points === Number(m.points)).length / 2) / others.length : null;
          const uid = owners[me.roster_id];
          if (!rows.has(uid)) rows.set(uid, []);
          rows.get(uid).push({
            week, points, against, opponentUid: owners[opponent.roster_id],
            result: points > against ? "w" : points < against ? "l" : "t",
            baseline, expected, postseason: week >= playoffStart,
            bracket: me.bracket || null,
          });
        }
      }
    }
    return rows;
  }

  function summarize(rows, from, to) {
    const weekly = rows.filter((row) => row.week >= from && row.week <= to);
    const games = weekly.length;
    const w = weekly.filter((row) => row.result === "w").length;
    const l = weekly.filter((row) => row.result === "l").length;
    const t = games - w - l;
    const points = games ? sum(weekly.map((row) => row.points)) : null;
    const benchmarkComplete = games > 0 && weekly.every((row) => row.baseline !== null && row.expected !== null);
    const baselinePoints = benchmarkComplete ? sum(weekly.map((row) => row.baseline)) : null;
    const expected = benchmarkComplete ? sum(weekly.map((row) => row.expected)) : null;
    return {
      games, w, l, t, points, pf: points,
      pa: games ? sum(weekly.map((row) => row.against)) : null,
      ppg: games ? points / games : null,
      winPct: games ? (w + t / 2) / games : null,
      expected, xW: expected, expectedWins: expected,
      actualWins: w + t / 2,
      expectedPerGame: expected === null ? null : expected / games,
      luck: expected === null ? null : w + t / 2 - expected,
      scoringPlus: baselinePoints === null || baselinePoints <= 0 ? null : 100 * points / baselinePoints,
      firstWeek: from <= to ? from : null, lastWeek: from <= to ? to : null,
      missingWeeks: Math.max(0, to - from + 1 - games), weekly,
    };
  }

  function laterThan(a, b) {
    if (a.date !== null && b.date !== null) return a.date > b.date;
    return a.week > b.week || (a.week === b.week && a.index > b.index);
  }

  function contribution(season, ownerId, playerId, from, cutoff, playoffStart, exit) {
    const end = exit ? Math.min(cutoff, exit.week - 1) : cutoff;
    const result = {
      pts: null, regularPoints: null, postseasonPoints: null, observedPoints: 0,
      starts: 0, observedStarts: 0, scoredStarts: 0,
      regularStarts: 0, postseasonStarts: 0, coveredWeeks: 0,
      missingWeeks: 0, missingRegularWeeks: 0, missingPostseasonWeeks: 0,
      unknownStartWeeks: 0, unknownRegularStartWeeks: 0, unknownPostseasonStartWeeks: 0,
      byeWeeks: 0, weeksConsidered: Math.max(0, end - from + 1),
      fromWeek: from, toWeek: end, exitWeek: exit?.week ?? null,
      exitReason: exit ? "next_transfer" : null, weekly: [],
    };
    // Known transfers can end a holding period before any full scoring week.
    if (end < from) {
      if (exit && cutoff >= from) result.pts = result.regularPoints = result.postseasonPoints = 0;
      return result;
    }
    let regular = 0, postseason = 0;
    const missing = (week, unknownStart = true) => {
      result.missingWeeks++;
      if (week < playoffStart) result.missingRegularWeeks++;
      else result.missingPostseasonWeeks++;
      if (unknownStart) {
        result.unknownStartWeeks++;
        if (week < playoffStart) result.unknownRegularStartWeeks++;
        else result.unknownPostseasonStartWeeks++;
      }
    };
    for (let week = from; week <= end; week++) {
      const raw = season.weeks?.[week - 1] || [];
      const m = raw.find((row) => same(row.roster_id, ownerId));
      if (m && m.matchup_id == null) {
        result.byeWeeks++;
        result.weeksConsidered--;
        continue;
      }
      const pair = m ? raw.filter((row) => same(row.matchup_id, m.matchup_id) &&
        (row.bracket || "NONE") === (m.bracket || "NONE")) : [];
      if (!m || !score(m.points) || !Array.isArray(m.starters)) {
        missing(week);
        continue;
      }
      if (pair.length !== 2 || same(pair[0].roster_id, pair[1].roster_id) || !pair.every((row) => score(row.points))) {
        missing(week);
        continue;
      }
      // Actual weekly ownership overrides an incomplete transaction feed.
      // A later reacquisition must not be credited to the original trade.
      if (Array.isArray(m.players) && !m.players.some((pid) => same(pid, playerId))) {
        result.exitWeek = week;
        result.exitReason = "absent_from_roster";
        result.toWeek = week - 1;
        result.weeksConsidered = Math.max(0, week - from);
        break;
      }
      const position = m.starters.findIndex((pid) => same(pid, playerId));
      let points = 0;
      if (position !== -1) {
        result.starts++;
        result.observedStarts++;
        if (week < playoffStart) result.regularStarts++;
        else result.postseasonStarts++;
        const known = own(m.players_points, playerId) ? m.players_points[playerId] :
          Array.isArray(m.starters_points) ? m.starters_points[position] : null;
        if (!score(known)) {
          missing(week, false);
          continue;
        }
        points = Number(known);
        result.scoredStarts++;
      }
      result.coveredWeeks++;
      result.observedPoints += points;
      if (week < playoffStart) regular += points;
      else postseason += points;
      result.weekly.push({ week, started: position !== -1, points, postseason: week >= playoffStart });
    }
    if (!result.missingWeeks) result.pts = result.observedPoints;
    if (!result.missingRegularWeeks) result.regularPoints = regular;
    if (!result.missingPostseasonWeeks) result.postseasonPoints = postseason;
    if (result.unknownStartWeeks) result.starts = null;
    if (result.unknownRegularStartWeeks) result.regularStarts = null;
    if (result.unknownPostseasonStartWeeks) result.postseasonStarts = null;
    return result;
  }

  function packagePoints(players) {
    if (!players.length) return 0;
    return players.every((player) => player.pts !== null) ? sum(players.map((player) => player.pts)) : null;
  }

  function balanceFor(participants, incomplete, hasWeeks) {
    const values = participants.map((p) => p.receivedPoints);
    const base = { score: null, gap: null, total: null, leaderUid: null, leaderUids: [], comparable: false, reason: null };
    if (incomplete) return { ...base, reason: "Trade details are incomplete." };
    if (participants.length < 2) return { ...base, reason: "Both trade participants could not be identified." };
    if (!participants.some((p) => p.received.length)) return { ...base, reason: "No player assets; picks and FAAB are not assigned a point value." };
    if (!hasWeeks) return { ...base, reason: "No completed weeks after this trade." };
    if (values.some((value) => value === null)) return { ...base, reason: "Starter points are unavailable for part of a package." };
    const minimum = Math.min(...values), maximum = Math.max(...values);
    const total = sum(values.map(Math.abs));
    if (!total) return { ...base, gap: 0, total: 0, reason: "Neither package produced starter points in the covered weeks." };
    const leaders = participants.filter((p) => p.receivedPoints === maximum).map((p) => p.uid);
    return {
      ...base, score: 100 * (1 - (maximum - minimum) / total),
      gap: maximum - minimum, total, leaderUid: leaders.length === 1 ? leaders[0] : null,
      leaderUids: leaders, comparable: true,
    };
  }

  function analyze(seasons, namesOverride = {}) {
    const trades = [], names = {};
    let excludedFuture = 0, excludedPending = 0, missingTiming = 0;
    for (const season of seasons || []) {
      const league = season.league || {}, year = String(league.season || ""), src = season.src || "";
      const label = `${year} (${src})`, cutoff = cutoffFor(season);
      const playoffStart = number(league.settings?.playoff_week_start) || 15;
      const owners = Object.fromEntries((season.rosters || []).map((r) => [r.roster_id, r.owner_id || `roster:${r.roster_id}`]));
      for (const user of season.users || []) names[user.user_id] = user.display_name || user.full_name || String(user.user_id);
      Object.assign(names, namesOverride);
      const completed = (season.transactions || []).map((raw, index) => ({ raw, index, ...timing(raw, season) }))
        .filter((item) => item.raw.status === "complete")
        .sort((a, b) => a.date !== null && b.date !== null ? a.date - b.date || a.index - b.index : a.week - b.week || a.index - b.index);
      const results = weeklyResults(season, owners, cutoff, playoffStart);
      excludedPending += (season.transactions || []).filter((t) => t.type === "trade" && t.status !== "complete").length;
      for (const item of completed) {
        const t = item.raw;
        if (t.type !== "trade") continue;
        if (item.week === null) { missingTiming++; continue; }
        if (item.week > cutoff) { excludedFuture++; continue; }
        const cutIds = new Set(Object.keys(t.roster_cuts || {}).filter((pid) =>
          !own(t.adds, pid) && same(t.roster_cuts[pid], t.drops?.[pid])));
        const legacyCutsInferred = src === "ESPN" && !own(t, "roster_cuts") && !t.details_incomplete;
        // Older ESPN normalization combined ordinary drops into TRADE_ACCEPT
        // transactions. The inference is limited to that known legacy format.
        if (legacyCutsInferred) {
          for (const pid of Object.keys(t.drops || {})) if (!own(t.adds, pid)) cutIds.add(pid);
        }
        const rosterCuts = [...cutIds].map((pid) => ({
          id: String(pid), playerId: String(pid), player: season.players?.[pid]?.name || String(pid),
          rosterId: String(t.drops[pid]), uid: owners[t.drops[pid]] || `roster:${t.drops[pid]}`,
          inferred: legacyCutsInferred,
        }));
        const ids = new Set([...(t.roster_ids || []), ...(t.consenter_ids || []),
          ...Object.values(t.adds || {}), ...Object.values(t.drops || {})]);
        for (const pick of t.draft_picks || []) {
          ids.add(pick.owner_id); ids.add(pick.previous_owner_id);
        }
        for (const budget of t.waiver_budget || []) {
          ids.add(budget.sender); ids.add(budget.receiver);
        }
        const rosterIds = [...ids].filter((id) => id !== null && id !== undefined)
          .map(String).filter((id, index, all) => all.indexOf(id) === index)
          .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
        let incomplete = Boolean(t.details_incomplete);
        const received = new Map(rosterIds.map((rid) => [rid, []]));
        const given = new Map(rosterIds.map((rid) => [rid, []]));
        for (const [pid, recipient] of Object.entries(t.adds || {})) {
          const sender = t.drops?.[pid];
          if (sender == null || same(sender, recipient)) incomplete = true;
          const exit = completed.find((other) => laterThan(other, item) && other.week !== null &&
            (same(other.raw.drops?.[pid], recipient) ||
             (own(other.raw.adds, pid) && !same(other.raw.adds[pid], recipient))));
          const asset = {
            id: String(pid), playerId: String(pid), player: season.players?.[pid]?.name || String(pid),
            pos: season.players?.[pid]?.position || season.players?.[pid]?.pos || "",
            fromRosterId: sender == null ? null : String(sender), toRosterId: String(recipient),
            fromUid: sender == null ? null : owners[sender] || `roster:${sender}`,
            toUid: owners[recipient] || `roster:${recipient}`,
            ...contribution(season, recipient, pid, item.week + 1, cutoff, playoffStart, exit),
          };
          asset.points = asset.pts;
          asset.retainedUntil = asset.toWeek;
          received.get(String(recipient))?.push(asset);
          if (sender != null) given.get(String(sender))?.push(asset);
        }
        // Confirmed ancillary cuts do not turn complete trades into partial
        // player packages. Unexplained departures still withhold comparison.
        if (Object.keys(t.drops || {}).some((pid) => !own(t.adds, pid) && !cutIds.has(pid))) incomplete = true;
        const participants = rosterIds.map((rid) => {
          const uid = owners[rid] || `roster:${rid}`;
          const incoming = received.get(rid) || [], outgoing = given.get(rid) || [];
          return {
            uid, rosterId: rid, name: names[uid] || `Team ${rid}`,
            received: incoming, given: outgoing,
            receivedPoints: packagePoints(incoming), givenPoints: packagePoints(outgoing),
            receivedRegularPoints: incoming.every((p) => p.regularPoints !== null) ? sum(incoming.map((p) => p.regularPoints)) : null,
            receivedPostseasonPoints: incoming.every((p) => p.postseasonPoints !== null) ? sum(incoming.map((p) => p.postseasonPoints)) : null,
            picksReceived: (t.draft_picks || []).filter((p) => same(p.owner_id, rid)),
            picksGiven: (t.draft_picks || []).filter((p) => same(p.previous_owner_id, rid)),
            budgetReceived: (t.waiver_budget || []).filter((p) => same(p.receiver, rid)),
            budgetGiven: (t.waiver_budget || []).filter((p) => same(p.sender, rid)),
            before: summarize(results.get(uid) || [], 1, Math.min(item.week - 1, playoffStart - 1, cutoff)),
            after: summarize(results.get(uid) || [], item.week + 1, Math.min(playoffStart - 1, cutoff)),
            postseason: summarize(results.get(uid) || [], Math.max(item.week + 1, playoffStart), cutoff),
          };
        });
        const timingNote = item.timingMethod === "reported_week" ?
          "Uses the transaction's recorded week. The completion week can differ if a trade was proposed earlier." :
          item.timingMethod === "calendar_estimate" ?
            "Completion week is estimated from the Eastern completion date using Tuesday–Monday NFL weeks starting in Labor Day week; league-specific calendar boundaries can differ." : null;
        const missingStarterWeeks = sum(participants.flatMap((p) => p.received.map((asset) => asset.missingWeeks)));
        trades.push({
          id: String(t.transaction_id || `${label}:${item.index}`), season: label,
          year, src, week: item.week, reportedWeek: item.reportedWeek, date: item.date,
          timingMethod: item.timingMethod, cutoff, playoffStart,
          detailsIncomplete: incomplete, participants, rosterCuts,
          balance: balanceFor(participants, incomplete, cutoff > item.week),
          excludesNonPlayerAssets: Boolean(t.draft_picks?.length || t.waiver_budget?.length),
          warnings: [timingNote,
            incomplete ? "Recorded trade assets are incomplete; evenness cannot be compared." : null,
            legacyCutsInferred && rosterCuts.length ?
              "Drop-only items in this legacy ESPN trade import are treated as ancillary roster cuts; they are shown separately and are not traded player assets." : null,
            missingStarterWeeks ? "Some player outcomes are unavailable because lineups or scored matchup snapshots are missing." : null,
            t.draft_picks?.length || t.waiver_budget?.length ? "Draft picks and FAAB are shown but excluded from starter-point evenness." : null,
          ].filter(Boolean),
          coverage: {
            hasPostTradeWeeks: cutoff > item.week,
            missingStarterWeeks, timingNote,
            pointsNote: "Starter points from the first full week after the trade, while the receiving team retained each player. Transfer weeks are excluded; picks and FAAB have no point value.",
          },
        });
      }
    }
    trades.sort((a, b) => Number(b.year) - Number(a.year) || b.week - a.week || (b.date || 0) - (a.date || 0) || a.id.localeCompare(b.id));
    return { trades, names, coverage: { trades: trades.length, excludedFuture, excludedPending, missingTiming } };
  }

  return { analyze };
});
