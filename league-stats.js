/* Shared calculations for live leagues, saved reports, and Node verification. */
(function (root) {
  "use strict";
  const fresh = () => ({
    w: 0,
    l: 0,
    t: 0,
    pf: 0,
    pa: 0,
    seasons: 0,
    po: 0,
    titles: 0,
    finals: 0,
    actual: 0,
    expected: 0,
    played: 0,
    apw: 0,
    apl: 0,
    apt: 0,
    streak: 0,
    bestStreak: 0,
  });
  const rate = (a) =>
    a.w + a.l + a.t ? (a.w + a.t / 2) / (a.w + a.l + a.t) : 0;
  const slotPositions = {
    QB: ["QB"],
    RB: ["RB"],
    WR: ["WR"],
    TE: ["TE"],
    K: ["K"],
    DEF: ["DEF"],
    FLEX: ["RB", "WR", "TE"],
    REC_FLEX: ["WR", "TE"],
    WRRB_FLEX: ["WR", "RB"],
    SUPER_FLEX: ["QB", "RB", "WR", "TE"],
    DL: ["DL", "DE", "DT"],
    DE: ["DE"],
    DT: ["DT"],
    LB: ["LB"],
    DB: ["DB", "CB", "S"],
    CB: ["CB"],
    S: ["S"],
    IDP_FLEX: ["DL", "DE", "DT", "LB", "DB", "CB", "S"],
    P: ["P"],
  };
  const slotAliases = {
    DST: "DEF",
    "D/ST": "DEF",
    "D/ST DEF": "DEF",
    DEFENSE: "DEF",
    "RB/WR/TE": "FLEX",
    RBWRTE: "FLEX",
    "W/R/T": "FLEX",
    "WR/TE": "REC_FLEX",
    WRTE: "REC_FLEX",
    "W/T": "REC_FLEX",
    "RB/WR": "WRRB_FLEX",
    RBWR: "WRRB_FLEX",
    "W/R": "WRRB_FLEX",
    OP: "SUPER_FLEX",
    "QB/RB/WR/TE": "SUPER_FLEX",
    "Q/W/R/T": "SUPER_FLEX",
    DP: "IDP_FLEX",
    IDP: "IDP_FLEX",
    D: "IDP_FLEX",
    BENCH: "BN",
    BE: "BN",
    RESERVE: "IR",
    TAXI: "IR",
  };
  const numericSlots = {
    0: "QB",
    2: "RB",
    3: "WRRB_FLEX",
    4: "WR",
    5: "REC_FLEX",
    6: "TE",
    7: "SUPER_FLEX",
    8: "DT",
    9: "DE",
    10: "LB",
    11: "DL",
    12: "CB",
    13: "S",
    14: "DB",
    15: "IDP_FLEX",
    16: "DEF",
    17: "K",
    18: "P",
    20: "BN",
    21: "IR",
    23: "FLEX",
  };
  const normalizeSlot = (value) => {
    const name = String(value).trim().toUpperCase();
    return numericSlots[name] || slotAliases[name] || name;
  };
  function lineupSlots(season) {
    const league = season.league || {},
      config = league.settings?.lineup_slots;
    let labels;
    if (Array.isArray(league.roster_positions))
      labels = league.roster_positions;
    else if (config && typeof config === "object" && !Array.isArray(config)) {
      labels = [];
      for (const [slot, count] of Object.entries(config)) {
        if (
          !Number.isInteger(Number(count)) ||
          Number(count) < 0 ||
          Number(count) > 20
        )
          return null;
        labels.push(...Array(Number(count)).fill(slot));
      }
    } else return null;
    const slots = labels
      .map(normalizeSlot)
      .filter((p) => !["BN", "IR"].includes(p));
    // Bitmask matching stays bounded, and unknown custom slots must not imply eligibility.
    if (
      !slots.length ||
      slots.length > 16 ||
      slots.some((p) => !slotPositions[p])
    )
      return null;
    return slots;
  }
  const vacantPlayer = (pid) =>
    pid == null || pid === "" || String(pid) === "0";
  const validScore = (value) =>
    (typeof value === "number" ||
      (typeof value === "string" && value.trim() !== "")) &&
    Number.isFinite(Number(value));
  function optimizeLineup(matchup, season) {
    const slots = lineupSlots(season);
    if (
      !slots ||
      !Array.isArray(matchup.players) ||
      !Array.isArray(matchup.starters) ||
      !matchup.players_points
    )
      return null;
    const ids = matchup.players.filter((p) => !vacantPlayer(p)).map(String),
      starters = matchup.starters.filter((p) => !vacantPlayer(p)).map(String);
    if (
      new Set(ids).size !== ids.length ||
      new Set(starters).size !== starters.length ||
      starters.length > slots.length ||
      starters.some((p) => !ids.includes(p))
    )
      return null;
    const excluded = new Set(
      [
        ...(matchup.excluded_players || []),
        ...(matchup.reserve || []),
        ...(matchup.taxi || []),
      ].map(String),
    );
    if (starters.some((p) => excluded.has(p))) return null;
    const masks = {},
      scores = {};
    for (const pid of ids) {
      const points = matchup.players_points[pid],
        player = season.players?.[pid];
      if (!validScore(points) || !player) return null;
      const positions =
        (Array.isArray(player.fantasy_positions) &&
        player.fantasy_positions.length
          ? player.fantasy_positions
          : null) ||
        (Array.isArray(player.positions) && player.positions.length
          ? player.positions
          : null) ||
        (player.position || player.pos ? [player.position || player.pos] : []);
      const eligible = (Array.isArray(positions) ? positions : [positions]).map(
        normalizeSlot,
      );
      if (!eligible.length) return null;
      masks[pid] = slots.reduce(
        (mask, slot, i) =>
          eligible.some((p) => slotPositions[slot].includes(p))
            ? mask | (1 << i)
            : mask,
        0,
      );
      scores[pid] = Number(points);
    }
    let legal = new Set([0]);
    for (const pid of starters) {
      const next = new Set();
      for (const mask of legal)
        for (let i = 0; i < slots.length; i++) {
          const bit = 1 << i;
          if (masks[pid] & bit && !(mask & bit)) next.add(mask | bit);
        }
      legal = next;
      if (!legal.size) return null;
    }
    const actual = starters.reduce((sum, p) => sum + scores[p], 0);
    if (
      !validScore(matchup.points) ||
      Math.abs(actual - Number(matchup.points)) > 0.1
    )
      return null;
    const size = 1 << slots.length,
      best = new Float64Array(size),
      selections = Array(size);
    best.fill(-Infinity);
    best[0] = 0;
    selections[0] = [];
    for (const pid of ids) {
      if (excluded.has(pid)) continue;
      // Descending masks prevent the same player from filling multiple slots.
      for (let mask = size - 1; mask >= 0; mask--) {
        if (best[mask] === -Infinity) continue;
        for (let i = 0; i < slots.length; i++) {
          const bit = 1 << i,
            next = mask | bit;
          if (
            masks[pid] & bit &&
            !(mask & bit) &&
            best[mask] + scores[pid] > best[next]
          ) {
            best[next] = best[mask] + scores[pid];
            selections[next] = [...selections[mask], pid];
          }
        }
      }
    }
    let maximum = 0;
    // Platforms permit empty starter slots: a negative scorer can be benched.
    for (let mask = 1; mask < size; mask++)
      if (best[mask] > best[maximum]) maximum = mask;
    return {
      optimum: best[maximum],
      actual,
      regret: Math.max(0, best[maximum] - actual),
      starters: selections[maximum],
    };
  }
  const mean = (xs) =>
    xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : 0;
  const populationSD = (xs) => {
    const avg = mean(xs);
    return Math.sqrt(mean(xs.map((x) => (x - avg) ** 2)));
  };
  function summarizeSaber(row) {
    const weeks = row.weekly,
      played = weeks.length,
      points = weeks.reduce((sum, w) => sum + w.points, 0),
      baseline = weeks.reduce((sum, w) => sum + w.baseline, 0);
    const covered = weeks.filter((w) => w.regret !== null),
      complete = played > 0 && covered.length === played,
      optimum = covered.reduce((sum, w) => sum + w.optimum, 0);
    return {
      ...row,
      played,
      actual: weeks.reduce((sum, w) => sum + w.actual, 0),
      xw: weeks.reduce((sum, w) => sum + w.expected, 0),
      points,
      baseline,
      pala: points - baseline,
      scoringPlus: baseline !== 0 ? (100 * points) / baseline : null,
      dominance: mean(weeks.map((w) => w.dominance)),
      boom: weeks.filter((w) => w.z >= 1).length,
      bust: weeks.filter((w) => w.z <= -1).length,
      volatility: populationSD(weeks.map((w) => w.z)),
      lineupRegret: complete
        ? covered.reduce((sum, w) => sum + w.regret, 0)
        : null,
      regretWeeks: covered.length,
      regretFlips: covered.filter((w) => w.flipped).length,
      lineupEfficiency: complete && optimum > 0 ? points / optimum : null,
    };
  }
  // A display name is not an identity: two NFL players can share the same name.
  const defenseFranchises = {
    ARI: ["ARZ", "Cardinals", "Arizona Cardinals"],
    ATL: ["Falcons", "Atlanta Falcons"],
    BAL: ["Ravens", "Baltimore Ravens"],
    BUF: ["Bills", "Buffalo Bills"],
    CAR: ["Panthers", "Carolina Panthers"],
    CHI: ["Bears", "Chicago Bears"],
    CIN: ["Bengals", "Cincinnati Bengals"],
    CLE: ["Browns", "Cleveland Browns"],
    DAL: ["Cowboys", "Dallas Cowboys"],
    DEN: ["Broncos", "Denver Broncos"],
    DET: ["Lions", "Detroit Lions"],
    GB: ["GNB", "Packers", "Green Bay Packers"],
    HOU: ["Texans", "Houston Texans"],
    IND: ["Colts", "Indianapolis Colts"],
    JAX: ["JAC", "Jaguars", "Jacksonville Jaguars"],
    KC: ["KAN", "Chiefs", "Kansas City Chiefs"],
    LAC: ["SD", "SDG", "Chargers", "Los Angeles Chargers", "San Diego Chargers"],
    LAR: ["LA", "STL", "Rams", "Los Angeles Rams", "St. Louis Rams"],
    LV: ["LVR", "OAK", "Raiders", "Las Vegas Raiders", "Oakland Raiders"],
    MIA: ["Dolphins", "Miami Dolphins"],
    MIN: ["Vikings", "Minnesota Vikings"],
    NE: ["NWE", "Patriots", "New England Patriots"],
    NO: ["NOR", "Saints", "New Orleans Saints"],
    NYG: ["Giants", "New York Giants"],
    NYJ: ["Jets", "New York Jets"],
    PHI: ["Eagles", "Philadelphia Eagles"],
    PIT: ["Steelers", "Pittsburgh Steelers"],
    SEA: ["Seahawks", "Seattle Seahawks"],
    SF: ["SFO", "49ers", "San Francisco 49ers"],
    TB: ["TAM", "Buccaneers", "Tampa Bay Buccaneers"],
    TEN: ["Titans", "Tennessee Titans"],
    WAS: ["WSH", "WFT", "Commanders", "Washington Commanders", "Washington Football Team", "Washington Redskins", "Redskins"],
  };
  const defenseAliases = new Map(
    Object.entries(defenseFranchises).flatMap(([franchise, aliases]) =>
      [franchise, ...aliases].map((alias) => [alias.toUpperCase(), franchise]),
    ),
  );
  const starterId = (value) => {
    if (!["string", "number"].includes(typeof value)) return null;
    const id = String(value).trim();
    return !id || /^(?:0|-1|null|undefined|none)$/i.test(id) ||
      /^espn:(?:0|-1)$/i.test(id) ? null : id;
  };
  const playerIdentifier = (value) => {
    if (value == null) return null;
    const id = String(value).trim();
    return !id || /^(?:0|-1|null|undefined|none|na|n\/a)$/i.test(id) ? null : id;
  };
  const espnPlayerId = (src, pid, meta) => {
    const explicit = playerIdentifier(meta.espn_id);
    if (explicit) return explicit.replace(/^espn:/i, "");
    if (src === "ESPN" || /^espn:/i.test(pid)) {
      const id = pid.replace(/^espn:/i, "");
      return /^-?\d+$/.test(id) ? id : null;
    }
    return null;
  };
  function starterIdentities(seasons) {
    const platformIds = new Map(), espnIds = new Map();
    const record = (map, key, gsis) => {
      if (!key || !gsis) return;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(gsis);
    };
    for (const s of seasons)
      for (const [pid, meta] of Object.entries(s.players || {})) {
        const gsis = playerIdentifier(meta.gsis_id);
        record(platformIds, `${s.src}:${pid}`, gsis);
        record(espnIds, espnPlayerId(s.src, pid, meta), gsis);
      }
    const unique = (map, key) => map.get(key)?.size === 1
      ? [...map.get(key)][0] : null;
    return (s, pid) => {
      const meta = s.players?.[pid] || {},
        position = normalizeSlot(meta.position || meta.pos || ""),
        name = meta.name || meta.full_name ||
          `${meta.first_name || ""} ${meta.last_name || ""}`.trim() || pid;
      if (position === "DEF") {
        const franchise = [meta.team, pid, name]
          .filter((x) => x != null)
          .map((x) => String(x).trim().replace(/\s+(?:D\/ST|DST|DEF(?:ENSE)?)$/i, "").toUpperCase())
          .map((x) => defenseAliases.get(x)).find(Boolean);
        if (franchise) return { playerKey: `def:${franchise}`, player: name, position };
      }
      const espn = espnPlayerId(s.src, pid, meta),
        gsis = playerIdentifier(meta.gsis_id) ||
          unique(platformIds, `${s.src}:${pid}`) || unique(espnIds, espn);
      const playerKey = gsis ? `gsis:${gsis}` : espn && !espnIds.has(espn)
        ? `espn:${espn}` : `${s.src}:${pid}`;
      return { playerKey, player: name, position };
    };
  }
  function summarizePlayerStarts(weeks) {
    const rows = new Map(), seen = new Set();
    for (const w of weeks || []) {
      if (!w?.uid || !w.playerKey) continue;
      const weeklyKey = JSON.stringify([w.uid, w.playerKey, w.season, w.week]);
      if (seen.has(weeklyKey)) continue;
      seen.add(weeklyKey);
      const key = JSON.stringify([w.uid, w.playerKey]);
      if (!rows.has(key)) rows.set(key, {
        uid: w.uid, playerKey: w.playerKey, player: w.player,
        position: w.position || "", starts: 0, regularStarts: 0,
        postseasonStarts: 0, points: 0, scoredStarts: 0, seasons: [],
        firstSeason: w.season, lastSeason: w.season,
      });
      const row = rows.get(key);
      row.starts++;
      row[w.postseason ? "postseasonStarts" : "regularStarts"]++;
      if (!row.seasons.includes(w.season)) row.seasons.push(w.season);
      if (validScore(w.points)) {
        row.scoredStarts++;
        if (row.points !== null) row.points += Number(w.points);
      } else row.points = null;
    }
    for (const row of rows.values()) {
      row.seasons.sort((a, b) =>
        (Number.parseInt(a, 10) || 0) - (Number.parseInt(b, 10) || 0) || a.localeCompare(b),
      );
      row.firstSeason = row.seasons[0];
      row.lastSeason = row.seasons[row.seasons.length - 1];
    }
    return [...rows.values()].sort((a, b) =>
      b.starts - a.starts || a.player.localeCompare(b.player) || a.playerKey.localeCompare(b.playerKey),
    );
  }
  function addPlayerStarts(D, s, owner, identity) {
    const L = s.league, settings = L.settings || {},
      season = `${L.season} (${s.src})`, year = String(L.season),
      start = Number(settings.playoff_week_start) || 15,
      first = Number(settings.start_week) || 1,
      cutoffValue = settings.last_scored_leg ?? (L.status === "complete" ? 18 : 0),
      cutoff = Number.isInteger(Number(cutoffValue)) && Number(cutoffValue) >= 0
        ? Math.min(18, Number(cutoffValue)) : 0,
      coverage = new Map();
    for (const uid of new Set(Object.values(owner).filter(Boolean)))
      coverage.set(uid, {
        uid, season, year, src: s.src, completedWeeks: 0, lineupWeeks: 0,
        missingWeeks: [], completedWeekNumbers: [], lineupWeekNumbers: [],
      });
    // Regular-season weeks are expected even if an entire saved week is absent.
    for (const row of coverage.values())
      for (let week = first; week <= Math.min(cutoff, start - 1); week++)
        row.completedWeekNumbers.push(week);
    for (let week = first; week <= cutoff; week++) {
      const groups = new Map(), rosterCounts = new Map(), recorded = new Set();
      for (const m of s.weeks?.[week - 1] || []) {
        if (m.matchup_id == null) continue;
        const key = String(m.matchup_id);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
        const rid = String(m.roster_id);
        rosterCounts.set(rid, (rosterCounts.get(rid) || 0) + 1);
      }
      for (const pair of groups.values()) {
        if (pair.length !== 2 || String(pair[0].roster_id) === String(pair[1].roster_id) ||
          !pair.every((m) => owner[m.roster_id] && validScore(m.points) &&
            rosterCounts.get(String(m.roster_id)) === 1)) continue;
        for (const m of pair) {
          const uid = owner[m.roster_id], row = coverage.get(uid);
          if (!row.completedWeekNumbers.includes(week)) row.completedWeekNumbers.push(week);
          if (!Array.isArray(m.starters)) continue;
          if (!row.lineupWeekNumbers.includes(week)) row.lineupWeekNumbers.push(week);
          const seen = new Set();
          for (const raw of m.starters) {
            const pid = starterId(raw);
            if (!pid) continue;
            const player = identity(s, pid);
            if (seen.has(player.playerKey)) continue;
            seen.add(player.playerKey);
            const weeklyKey = JSON.stringify([uid, player.playerKey]);
            if (recorded.has(weeklyKey)) continue;
            recorded.add(weeklyKey);
            const score = m.players_points?.[pid];
            D.playerStartWeeks.push({
              uid, ...player, season, year, src: s.src, week,
              postseason: week >= start,
              points: validScore(score) ? Number(score) : null,
            });
          }
        }
      }
    }
    for (const row of coverage.values()) {
      row.completedWeekNumbers.sort((a, b) => a - b);
      row.lineupWeekNumbers.sort((a, b) => a - b);
      row.completedWeeks = row.completedWeekNumbers.length;
      row.lineupWeeks = row.lineupWeekNumbers.length;
      row.missingWeeks = row.completedWeekNumbers.filter((w) => !row.lineupWeekNumbers.includes(w));
      D.startCoverage.push(row);
    }
  }
  function analyze(seasons, namesOverride = {}) {
    const D = {
      names: {},
      all: {},
      champs: [],
      scores: [],
      h2h: {},
      playoffH2h: {},
      consolationH2h: {},
      bySeason: [],
      weeks: [],
      games: [],
      drafts: [],
      moves: [],
      pickups: [],
      drops: [],
      comebacks: [],
      saber: [],
      saberCareer: [],
      playerStartWeeks: [],
      playerStarts: [],
      startCoverage: [],
      sources: seasons,
    };
    const A = (u) => (D.all[u] ??= fresh());
    const starterIdentity = starterIdentities(seasons);
    for (const s of seasons) {
      const L = s.league,
        label = `${L.season} (${s.src})`,
        owner = Object.fromEntries(
          s.rosters.map((r) => [r.roster_id, r.owner_id]),
        );
      s.users.forEach(
        (u) =>
          (D.names[u.user_id] =
            u.display_name || u.full_name || String(u.user_id)),
      );
      addPlayerStarts(D, s, owner, starterIdentity);
      const done = L.status === "complete",
        start = L.settings?.playoff_week_start || 15;
      const cutoff = L.settings?.last_scored_leg ?? (done ? 18 : 0);
      const po = new Set(
        done
          ? L.playoff_roster_ids ||
            s.bracket.flatMap((m) =>
              ["t1", "t2", "w", "l"].map((k) => m[k]).filter(Number.isInteger),
            )
          : [],
      );
      const rows = s.rosters
        .filter((r) => r.owner_id)
        .map((r) => {
          const st = r.settings || {},
            a = A(r.owner_id),
            row = {
              uid: r.owner_id,
              w: st.wins || 0,
              l: st.losses || 0,
              t: st.ties || 0,
              pf: (st.fpts || 0) + (st.fpts_decimal || 0) / 100,
              pa: (st.fpts_against || 0) + (st.fpts_against_decimal || 0) / 100,
            };
          ["w", "l", "t", "pf", "pa"].forEach((k) => (a[k] += row[k]));
          if (row.w + row.l + row.t) a.seasons++;
          if (po.has(r.roster_id)) a.po++;
          return row;
        })
        .sort((a, b) => rate(b) - rate(a) || b.pf - a.pf);
      const fin = done ? s.bracket.find((m) => m.p === 1) : null,
        champ = owner[fin?.w],
        runner = owner[fin?.l];
      if (champ) {
        A(champ).titles++;
        A(champ).finals++;
      }
      if (runner) A(runner).finals++;
      D.champs.push({ season: label, champ, runner, top: rows[0]?.uid });
      D.bySeason.push({
        season: label,
        year: String(L.season),
        src: s.src,
        rows,
        champ,
        po: [...po].map((r) => owner[r]),
      });
      const cumulative = Object.fromEntries(
          rows.map((r) => [r.uid, { w: 0, l: 0, t: 0, pf: 0 }]),
        ),
        ranks = {},
        streaks = {},
        saberRows = {};
      const rank = () =>
        Object.keys(cumulative).sort(
          (a, b) =>
            rate(cumulative[b]) - rate(cumulative[a]) ||
            cumulative[b].pf - cumulative[a].pf ||
            a.localeCompare(b),
        );
      (s.weeks || []).forEach((wk, i) => {
        const week = i + 1;
        if (
          week > cutoff ||
          week >= start ||
          !wk?.some((m) => Number(m.points) !== 0)
        )
          return;
        const teams = wk.filter(
            (m) => owner[m.roster_id] && m.matchup_id != null,
          ),
          groups = {};
        teams.forEach((m) => (groups[m.matchup_id] ??= []).push(m));
        const valid = Object.values(groups).filter((p) => p.length === 2),
          eligible = valid.flat();
        if (!eligible.length) return;
        const saberPairs = valid.filter(
            ([a, b]) =>
              a.roster_id !== b.roster_id &&
              validScore(a.points) &&
              validScore(b.points),
          ),
          saberTeams = saberPairs.flat(),
          baseline = mean(saberTeams.map((m) => Number(m.points))),
          sd = populationSD(saberTeams.map((m) => Number(m.points)));
        for (const pair of saberPairs)
          for (const me of pair) {
            const opponent = pair.find((m) => m !== me),
              uid = owner[me.roster_id],
              points = Number(me.points),
              opponentPts = Number(opponent.points),
              others = saberTeams.filter((m) => m.roster_id !== me.roster_id);
            const expected =
                (others.filter((m) => points > Number(m.points)).length +
                  others.filter((m) => points === Number(m.points)).length /
                    2) /
                others.length,
              optimum = optimizeLineup(me, s),
              actualResult =
                points > opponentPts ? "w" : points < opponentPts ? "l" : "t";
            const row = (saberRows[uid] ??= {
              uid,
              season: label,
              src: s.src,
              year: String(L.season),
              weekly: [],
            });
            row.weekly.push({
              week,
              points,
              baseline,
              z: sd ? (points - baseline) / sd : 0,
              dominance: sd ? (points - opponentPts) / sd : 0,
              expected,
              actual: actualResult === "w" ? 1 : actualResult === "t" ? 0.5 : 0,
              actualResult,
              opponentPts,
              opponentUid: owner[opponent.roster_id],
              optimum: optimum?.optimum ?? null,
              optimumStarters: optimum?.starters ?? null,
              regret: optimum?.regret ?? null,
              flipped: optimum
                ? points <= opponentPts && optimum.optimum > opponentPts
                : null,
            });
          }
        const prev = week === 1 ? [] : rank(),
          games = [],
          scores = [];
        for (const me of eligible) {
          const uid = owner[me.roster_id],
            pts = Number(me.points) || 0,
            others = eligible.filter((x) => x.roster_id !== me.roster_id),
            a = A(uid);
          const wins = others.filter(
              (x) => pts > (Number(x.points) || 0),
            ).length,
            ties = others.filter((x) => pts === (Number(x.points) || 0)).length;
          a.apw += wins;
          a.apt += ties;
          a.apl += others.length - wins - ties;
          a.expected += (wins + ties / 2) / others.length;
          a.played++;
          scores.push({ uid, pts });
          D.scores.push([pts, uid, label, week]);
        }
        for (const [a, b] of valid) {
          const ua = owner[a.roster_id],
            ub = owner[b.roster_id],
            pa = Number(a.points) || 0,
            pb = Number(b.points) || 0;
          const winner = pa > pb ? ua : pb > pa ? ub : null,
            loser = winner === ua ? ub : winner === ub ? ua : null;
          const priorGap = winner
            ? rate(cumulative[loser]) - rate(cumulative[winner])
            : 0;
          const g = {
            season: label,
            week,
            a: ua,
            b: ub,
            pa,
            pb,
            winner,
            loser,
            margin: Math.abs(pa - pb),
            upset: week > 1 && winner && priorGap > 0 ? priorGap : 0,
          };
          games.push(g);
          D.games.push(g);
          for (const [u, v, p, q] of [
            [ua, ub, pa, pb],
            [ub, ua, pb, pa],
          ]) {
            const c = cumulative[u],
              total = A(u),
              r = ((D.h2h[u] ??= {})[v] ??= [0, 0, 0]);
            c.pf += p;
            const k = p > q ? "w" : p < q ? "l" : "t";
            c[k]++;
            r[k === "w" ? 0 : k === "l" ? 1 : 2]++;
            total.actual += k === "w" ? 1 : k === "t" ? 0.5 : 0;
            streaks[u] = k === "w" ? (streaks[u] || 0) + 1 : 0;
            total.bestStreak = Math.max(total.bestStreak, streaks[u]);
          }
        }
        const next = rank(),
          changes = next.map((uid, j) => ({
            uid,
            rank: j + 1,
            change: prev.length ? prev.indexOf(uid) - j : 0,
          }));
        next.forEach((u, j) => (ranks[u] ??= []).push(j + 1));
        D.weeks.push({ season: label, week, games, scores, changes });
      });
      D.saber.push(...Object.values(saberRows).map(summarizeSaber));
      const finalRanks = rank();
      for (const u of finalRanks) {
        if (ranks[u]?.length > 1)
          D.comebacks.push({
            uid: u,
            season: label,
            from: Math.max(...ranks[u]),
            to: finalRanks.indexOf(u) + 1,
            gain: Math.max(...ranks[u]) - finalRanks.indexOf(u) - 1,
          });
      }
      // Postseason recaps include bye scores, but never alter regular-season luck or ranks.
      (s.weeks || []).forEach((wk, i) => {
        if (
          i + 1 < start ||
          i + 1 > cutoff ||
          !wk?.some((m) => Number(m.points) !== 0)
        )
          return;
        const groups = {},
          scores = [];
        for (const m of wk) {
          if (!owner[m.roster_id]) continue;
          scores.push({ uid: owner[m.roster_id], pts: Number(m.points) || 0 });
          if (m.matchup_id != null) (groups[m.matchup_id] ??= []).push(m);
        }
        const games = Object.values(groups)
          .filter((p) => p.length === 2)
          .map(([a, b]) => {
            const pa = Number(a.points) || 0,
              pb = Number(b.points) || 0,
              ua = owner[a.roster_id],
              ub = owner[b.roster_id];
            return {
              season: label,
              week: i + 1,
              a: ua,
              b: ub,
              pa,
              pb,
              winner: pa > pb ? ua : pb > pa ? ub : null,
              loser: pa > pb ? ub : pb > pa ? ua : null,
              margin: Math.abs(pa - pb),
              upset: 0,
            };
          });
        if (scores.length)
          D.weeks.push({
            season: label,
            week: i + 1,
            games,
            scores,
            changes: [],
            postseason: true,
          });
      });
      const addBracket = (map, w, l) => {
        const a = owner[w],
          b = owner[l];
        if (!a || !b) return;
        ((map[a] ??= {})[b] ??= [0, 0, 0])[0]++;
        ((map[b] ??= {})[a] ??= [0, 0, 0])[1]++;
      };
      if (s.src === "Sleeper") {
        for (const m of s.bracket || [])
          if (Number.isInteger(m.w) && Number.isInteger(m.l))
            addBracket(D.playoffH2h, m.w, m.l);
        for (const m of s.losersBracket || [])
          if (Number.isInteger(m.w) && Number.isInteger(m.l))
            addBracket(D.consolationH2h, m.w, m.l);
      } else {
        (s.weeks || []).forEach((wk, i) => {
          if (i + 1 < start || i + 1 > cutoff) return;
          const groups = {};
          for (const m of wk || [])
            if (m.matchup_id != null) (groups[m.matchup_id] ??= []).push(m);
          for (const pair of Object.values(groups)) {
            if (pair.length !== 2) continue;
            const [a, b] = pair;
            if (!a.bracket || a.bracket === "NONE" || a.points === b.points)
              continue;
            addBracket(
              a.bracket === "WINNERS_BRACKET" ? D.playoffH2h : D.consolationH2h,
              a.points > b.points ? a.roster_id : b.roster_id,
              a.points > b.points ? b.roster_id : a.roster_id,
            );
          }
        });
      }
      const playerName = (pid, meta = {}) =>
        (s.players?.[pid]?.name !== pid ? s.players?.[pid]?.name : null) ||
        `${meta.first_name || ""} ${meta.last_name || ""}`.trim() ||
        String(pid);
      const contribution = (pid, rid, from = 1, to = cutoff) => {
        let pts = 0,
          starts = 0,
          scoredStarts = 0,
          rostered = 0;
        for (let w = from; w <= Math.min(to, cutoff); w++) {
          const m = s.weeks[w - 1]?.find((x) => x.roster_id === rid);
          if (!m || !s.weeks[w - 1]?.some((x) => Number(x.points) !== 0))
            continue;
          if (s.src === "ESPN" && !m.players_points)
            return {
              pts: null,
              starts: null,
              scoredStarts: null,
              rostered: null,
            };
          if (m.players?.includes(pid)) rostered++;
          if (m.starters?.includes(pid)) {
            starts++;
            const score = m.players_points?.[pid];
            // House rule (see summarizePlayerStarts): a start stays countable
            // even when its score is not. One unscored start makes the total
            // unavailable rather than silently zero.
            if (validScore(score)) {
              scoredStarts++;
              if (pts !== null) pts += Number(score);
            } else pts = null;
          }
        }
        return { pts, starts, scoredStarts, rostered };
      };
      for (const p of s.picks || []) {
        const available =
          p.player_id_kind !== "local_placeholder" &&
          s.weeks.some((wk) => wk.some((m) => m.players_points));
        const v = available
          ? contribution(p.player_id, p.roster_id)
          : { pts: null, starts: null, rostered: null };
        D.drafts.push({
          season: label,
          src: s.src,
          uid: owner[p.roster_id],
          player: playerName(p.player_id, p.metadata),
          pos: p.metadata?.position || "",
          round: p.round,
          pick: p.pick_no,
          ...v,
        });
      }
      const transactions = (s.transactions || [])
        .filter((t) => t.status === "complete")
        .sort(
          (a, b) =>
            (a.status_updated || a.created) - (b.status_updated || b.created),
        );
      for (const t of transactions) {
        const when = t.status_updated || t.created,
          from = (Number(t.leg) || 1) + 1;
        const adds = Object.entries(t.adds || {}).map(([pid, rid]) => {
          const exit = transactions.find(
            (x) =>
              (x.status_updated || x.created) > when && x.drops?.[pid] === rid,
          );
          const toWeek = exit ? Number(exit.leg) : cutoff;
          return {
            player: playerName(pid),
            pos: s.players?.[pid]?.position || "",
            uid: owner[rid],
            fromWeek: from,
            toWeek,
            exitWeek: exit ? Number(exit.leg) : null,
            ...contribution(pid, rid, from, toWeek),
          };
        });
        D.moves.push({
          id: t.transaction_id,
          season: label,
          type: t.type,
          details_incomplete: t.details_incomplete || false,
          week: t.leg,
          date: when,
          adds,
          drops: Object.entries(t.drops || {}).map(([pid, rid]) => ({
            player: playerName(pid),
            pos: s.players?.[pid]?.position || "",
            uid: owner[rid],
          })),
          picks: t.draft_picks || [],
          budget: t.waiver_budget || [],
        });
        // The mirror of a pickup: once a player is dropped onto waivers, follow
        // him to every roster that claimed him afterwards and total what he
        // produced there. Trades are excluded because the player never reached
        // waivers, so nobody else had the chance to claim him.
        if (t.type === "trade") continue;
        for (const [pid, rid] of Object.entries(t.drops || {})) {
          if (!owner[rid]) continue;
          // A dropper can win the player back. Production after that belongs to
          // them again, so it never counts against the drop.
          const back = transactions.find(
            (x) => (x.status_updated || x.created) > when && x.adds?.[pid] === rid,
          );
          const until = back ? Number(back.leg) : cutoff;
          let pts = 0,
            starts = 0,
            scoredStarts = 0,
            claims = 0,
            firstWeek = null;
          const claimants = [];
          for (const x of transactions) {
            const xWhen = x.status_updated || x.created;
            const to = x.adds?.[pid];
            if (
              xWhen <= when ||
              to === undefined ||
              String(to) === String(rid) ||
              !owner[to]
            )
              continue;
            const addLeg = Number(x.leg) || 1;
            if (addLeg > until) continue;
            const exit = transactions.find(
              (y) =>
                (y.status_updated || y.created) > xWhen && y.drops?.[pid] === to,
            );
            const toWeek = Math.min(exit ? Number(exit.leg) : until, until);
            const v = contribution(pid, to, addLeg + 1, toWeek);
            claims++;
            if (firstWeek === null) firstWeek = addLeg;
            if (!claimants.includes(owner[to])) claimants.push(owner[to]);
            // House rule, as in contribution: one unscored start makes the
            // total unavailable rather than silently low.
            if (v.pts === null) pts = null;
            else if (pts !== null) pts += v.pts;
            if (v.starts === null) starts = null;
            else if (starts !== null) starts += v.starts;
            if (v.scoredStarts === null) scoredStarts = null;
            else if (scoredStarts !== null) scoredStarts += v.scoredStarts;
          }
          if (!claims) continue;
          D.drops.push({
            id: `${label}|${t.transaction_id}|${playerName(pid)}`,
            season: label,
            src: s.src,
            type: t.type,
            week: t.leg,
            date: when,
            uid: owner[rid],
            player: playerName(pid),
            pos: normalizeSlot(s.players?.[pid]?.position || ""),
            claims,
            claimants,
            claimedWeek: firstWeek,
            reclaimedWeek: back ? Number(back.leg) : null,
            starts,
            scoredStarts,
            pts,
            details_incomplete: t.details_incomplete || false,
          });
        }
      }
    }
    Object.assign(D.names, namesOverride);
    D.playerStarts = summarizePlayerStarts(D.playerStartWeeks);
    const career = {};
    for (const row of D.saber) {
      const aggregate = (career[row.uid] ??= {
        uid: row.uid,
        seasons: 0,
        weekly: [],
      });
      aggregate.seasons++;
      aggregate.weekly.push(
        ...row.weekly.map((w) => ({
          ...w,
          season: row.season,
          year: row.year,
          src: row.src,
        })),
      );
    }
    D.saberCareer = Object.values(career).map(summarizeSaber);
    // One pass to accumulate each season+round baseline, one to assign.
    // The per-start baseline is start-weighted, so it needs no minimum-starts
    // threshold: a 1-start pick moves it in proportion to its single start.
    const roundBaselines = new Map();
    for (const d of D.drafts) {
      if (d.pts === null) continue;
      const key = `${d.season}|${d.round}`;
      const a = roundBaselines.get(key) || {
        sum: 0,
        picks: 0,
        startedPts: 0,
        starts: 0,
      };
      a.sum += d.pts;
      a.picks++;
      if (d.starts > 0) {
        a.startedPts += d.pts;
        a.starts += d.starts;
      }
      roundBaselines.set(key, a);
    }
    for (const d of D.drafts) {
      const a = roundBaselines.get(`${d.season}|${d.round}`);
      d.roundMean = a && a.picks ? a.sum / a.picks : null;
      d.roundPerStart = a && a.starts ? a.startedPts / a.starts : null;
      d.ptsPerStart = d.pts === null || !d.starts ? null : d.pts / d.starts;
      d.value =
        d.pts === null || d.roundMean === null ? null : d.pts - d.roundMean;
      d.valuePerStart =
        d.ptsPerStart === null || d.roundPerStart === null
          ? null
          : d.ptsPerStart - d.roundPerStart;
    }
    // One row per non-trade acquisition so waiver and free-agent pickups can be
    // ranked and sorted on their own. Trades are excluded because the trade
    // analyzer already values them as packages.
    D.pickups = D.moves
      .filter((m) => m.type !== "trade")
      .flatMap((m) =>
        m.adds
          .filter((a) => a.uid)
          .map((a) => ({
            id: `${m.season}|${m.id}|${a.player}`,
            season: m.season,
            type: m.type,
            week: m.week,
            date: m.date,
            uid: a.uid,
            player: a.player,
            pos: a.pos || "",
            starts: a.starts,
            scoredStarts: a.scoredStarts,
            rostered: a.rostered,
            pts: a.pts,
            ptsPerStart: a.pts === null || !a.starts ? null : a.pts / a.starts,
            fromWeek: a.fromWeek,
            toWeek: a.toWeek,
            exitWeek: a.exitWeek,
            dropped: m.drops.map((d) => d.player).join(", "),
            details_incomplete: m.details_incomplete || false,
          })),
      );
    // Comparing a dropped kicker to a dropped quarterback on raw points per
    // start only measures scoring position. The baseline is the start-weighted
    // mean points per start at that position that season, taken from every
    // start in the league, so a drop is judged against what a replacement
    // start at the same position was worth.
    const posBaselines = new Map();
    for (const w of D.playerStartWeeks) {
      if (!validScore(w.points)) continue;
      const key = `${w.season}|${w.position || ""}`;
      const a = posBaselines.get(key) || { pts: 0, starts: 0 };
      a.pts += Number(w.points);
      a.starts++;
      posBaselines.set(key, a);
    }
    for (const d of D.drops) {
      const a = posBaselines.get(`${d.season}|${d.pos || ""}`);
      d.posPerStart = a && a.starts ? a.pts / a.starts : null;
      d.ptsPerStart = d.pts === null || !d.starts ? null : d.pts / d.starts;
      d.valuePerStart =
        d.ptsPerStart === null || d.posPerStart === null
          ? null
          : d.ptsPerStart - d.posPerStart;
    }
    D.rivalries = [];
    const ids = Object.keys(D.all);
    ids.forEach((a, i) =>
      ids.slice(i + 1).forEach((b) => {
        const r = D.h2h[a]?.[b];
        if (r) {
          D.rivalries.push({
            a,
            b,
            w: r[0],
            l: r[1],
            t: r[2],
            games: r.reduce((x, y) => x + y, 0),
            balance: Math.abs(r[0] - r[1]),
          });
        }
      }),
    );
    return D;
  }
  const api = { analyze, rate, optimizeLineup, summarizePlayerStarts };
  if (typeof module !== "undefined") module.exports = api;
  root.LeagueStats = api;
})(typeof window !== "undefined" ? window : globalThis);
