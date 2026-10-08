(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SleeperForecastData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const API = "https://api.sleeper.app/v1";
  const SCHEDULE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
  const teams = new Set("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LA LAC LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split(" "));
  const aliases = { LAR: "LA", STL: "LA", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC" };
  const normalizeTeam = (team) => aliases[String(team || "").toUpperCase()] || String(team || "").toUpperCase();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const catalogCache = new WeakMap();
  const idPattern = /^\d{1,24}$/;

  function parseLeagueId(input) {
    const value = String(input ?? "").trim();
    if (idPattern.test(value) && !/^0+$/.test(value)) return value;
    let url;
    try { url = new URL(value); } catch { /* A plain ID is the preferred input. */ }
    if (url && url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["sleeper.com", "www.sleeper.com", "sleeper.app", "www.sleeper.app"].includes(url.hostname)) {
      const match = url.pathname.match(/^\/(?:leagues?|i)\/(\d{1,24})(?:\/.*)?$/);
      if (match && !/^0+$/.test(match[1])) return match[1];
    }
    throw new Error("Enter a Sleeper league ID or an HTTPS Sleeper league link. Invite codes that are not numeric league IDs are not supported.");
  }
  function scoringFingerprint(settings) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
    const entries = [];
    for (const [key, value] of Object.entries(settings)) {
      if (!["number", "string"].includes(typeof value) || String(value).trim() === "" || !Number.isFinite(Number(value))) return null;
      if (Number(value) !== 0) entries.push([key, Number(value)]);
    }
    return entries.length ? JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b))) : null;
  }
  function regularEnd(league) {
    const start = Number(league.settings?.playoff_week_start);
    if (start === 0) return 18;
    return Math.max(0, Math.min(18, (Number.isInteger(start) && start > 0 ? start : 15) - 1));
  }
  function currentWeek(league, state = {}) {
    if (league.status === "complete") return { week: 19, source: "League season complete" };
    if (["pre_draft", "drafting"].includes(league.status)) return { week: 1, source: "League has not begun its season" };
    if (String(state.season) === String(league.season)) {
      const week = Number(state.week || state.display_week);
      if (state.season_type === "regular" && Number.isInteger(week) && week >= 1 && week <= 18)
        return { week, source: "Sleeper NFL state" };
      if (["post", "postseason"].includes(state.season_type)) return { week: 19, source: "NFL regular season complete" };
      if (["pre", "preseason", "off"].includes(state.season_type)) return { week: 1, source: "NFL preseason or offseason" };
    }
    const completed = Math.max(0, Number(league.settings?.last_scored_leg) || 0);
    return { week: Math.min(19, Math.max(1, completed + 1)), source: "League last scored week + 1 (NFL state unavailable or another season)" };
  }
  function compactWeek(rows) {
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || row.roster_id == null)) throw new Error("Incomplete matchup response");
    return rows.map((row) => Object.fromEntries(["roster_id", "matchup_id", "points", "custom_points", "starters", "players", "players_points", "starters_points"]
      .filter((key) => Object.prototype.hasOwnProperty.call(row, key)).map((key) => [key, clone(row[key])])));
  }
  function aborted(signal) {
    if (signal?.aborted) {
      const error = new Error("League loading was cancelled."); error.name = "AbortError"; throw error;
    }
  }
  async function mapLimited(values, operation, signal) {
    const result = new Array(values.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => {
      while (next < values.length) { aborted(signal); const index = next++; result[index] = await operation(values[index], index); }
    }));
    return result;
  }
  async function request(fetcher, url, signal, text = false) {
    aborted(signal);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 20000);
    try {
      const response = await fetcher(url, { signal: controller.signal, credentials: "omit", mode: "cors" });
      aborted(signal);
      if (!response.ok) throw new Error(`Public data service returned ${response.status}`);
      return text ? await response.text() : await response.json();
    } catch (error) {
      aborted(signal);
      if (error?.name === "AbortError") throw new Error("The public data service timed out. Try again.");
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
  }
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", quoted = false;
    for (let i = 0; i < String(text).length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"' && cell === "") quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); if (row.some((value) => value !== "")) rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (quoted) throw new Error("Incomplete quoted NFL schedule CSV");
    row.push(cell); if (row.some((value) => value !== "")) rows.push(row);
    const headers = (rows.shift() || []).map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "") : header);
    return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
  }
  function easternKickoff(day, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time || "")) return null;
    const local = Date.parse(`${day}T${time.length === 5 ? time + ":00" : time}Z`);
    if (!Number.isFinite(local)) return null;
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    let utc = local;
    for (let pass = 0; pass < 2; pass++) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
      const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      utc = local - (represented - utc);
    }
    return new Date(utc).toISOString();
  }
  function parseSchedule(text, season) {
    return parseCSV(text).filter((row) => row.season === String(season) && row.game_type === "REG")
      .map((row) => ({ week: Number(row.week), home: normalizeTeam(row.home_team), away: normalizeTeam(row.away_team),
        kickoff: easternKickoff(row.gameday, row.gametime), date: row.gameday, gameId: row.game_id, kickoffTimezone: "America/New_York" }))
      .filter((game) => Number.isInteger(game.week) && game.week >= 1 && game.week <= (Number(season) >= 2021 ? 18 : 17) &&
        teams.has(game.home) && teams.has(game.away) && game.home !== game.away && game.gameId)
      .sort((a, b) => a.week - b.week || String(a.date).localeCompare(String(b.date)) || a.gameId.localeCompare(b.gameId));
  }
  function scheduleComplete(games, season) {
    if (!Array.isArray(games)) return false;
    const modern = Number(season) >= 2021, gamesPerTeam = modern ? 17 : 16, maxWeek = modern ? 18 : 17;
    const counts = Object.fromEntries([...teams].map((team) => [team, 0])), ids = new Set(), weekly = new Set(), weeks = new Set();
    for (const game of games || []) {
      if (!game.gameId || ids.has(game.gameId) || !Number.isInteger(Number(game.week)) || Number(game.week) < 1 || Number(game.week) > maxWeek) return false;
      ids.add(game.gameId); weeks.add(Number(game.week));
      for (const side of ["home", "away"]) {
        const team = normalizeTeam(game[side]), key = `${game.week}:${team}`;
        if (!teams.has(team) || weekly.has(key) || normalizeTeam(game.home) === normalizeTeam(game.away)) return false;
        counts[team]++; weekly.add(key);
      }
    }
    return games.length === gamesPerTeam * 16 && Object.values(counts).every((count) => count === gamesPerTeam) && weeks.size === maxWeek;
  }
  function compactPlayers(raw) {
    return Object.fromEntries(Object.entries(raw || {}).filter(([, player]) => player && typeof player === "object")
      .map(([id, player]) => [id, { name: player.name || player.full_name || `${player.first_name || ""} ${player.last_name || ""}`.trim() || id,
        position: player.position || player.pos || player.fantasy_positions?.[0] || null,
        team: player.team ? normalizeTeam(player.team) : null,
        injuryStatus: player.injuryStatus || player.injury_status || null,
        ...(Array.isArray(player.fantasy_positions) ? { fantasy_positions: [...player.fantasy_positions] } : {}) }]));
  }
  async function playerCatalog(options, fetcher, now, warnings) {
    if (options.catalog?.players && typeof options.catalog.players === "object")
      return { players: options.catalog.players, updatedAt: options.catalog.updatedAt || null };
    let cached = catalogCache.get(fetcher);
    // The daily catalog is shared by league loads. A canceled league selection
    // must not abort the request that a newer selection is also awaiting.
    if (!cached || now - cached.loadedAt >= 86400000) cached = { loadedAt: now, promise: request(fetcher, API + "/players/nfl")
      .then((players) => {
        if (!players || typeof players !== "object" || Array.isArray(players)) throw new Error("Player metadata unavailable");
        return { players: compactPlayers(players), updatedAt: new Date(now).toISOString() };
      }).catch((error) => {
        return { players: {}, updatedAt: null, unavailable: true };
      }) };
    catalogCache.set(fetcher, cached);
    aborted(options.signal);
    const value = options.signal ? await new Promise((resolve, reject) => {
      const cancel = () => {
        try { aborted(options.signal); } catch (error) { reject(error); }
      };
      options.signal.addEventListener("abort", cancel, { once: true });
      cached.promise.then(resolve, reject).finally(() => options.signal.removeEventListener("abort", cancel));
    }) : await cached.promise;
    aborted(options.signal);
    if (value.unavailable) warnings.push("NFL player metadata is unavailable. Unknown players use labeled priors; injury assumptions are disabled.");
    return value;
  }

  async function loadLeague(input, options = {}) {
    const id = parseLeagueId(input), fetcher = options.fetch || globalThis.fetch;
    if (typeof fetcher !== "function") throw new Error("This browser cannot fetch public Sleeper league data.");
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now(), timestamp = new Date(now).toISOString();
    const warnings = [], failedWeeks = [], restoredWeeks = [], historyFailures = [], signal = options.signal;
    const progress = (message) => { aborted(signal); if (typeof options.onProgress === "function") options.onProgress(message); };
    const get = (path) => request(fetcher, API + path, signal);
    progress("Loading the public Sleeper NFL league…");
    const league = await get(`/league/${id}`);
    if (!league || typeof league !== "object" || String(league.league_id) !== id || !/^\d{4}$/.test(String(league.season)))
      throw new Error("That Sleeper league was not found. Check its numeric league ID.");
    if (String(league.sport).toLowerCase() !== "nfl") throw new Error("This forecast page supports Sleeper NFL fantasy football leagues. NBA and other sports are not supported.");
    if (Number(league.settings?.best_ball) === 1) throw new Error("Best-ball leagues are not supported by this optimized projected-lineup forecast. Best ball requires selecting the best legal roster lineup in every simulation.");
    const [users, rosters, state] = await Promise.all([get(`/league/${id}/users`), get(`/league/${id}/rosters`),
      get("/state/nfl").catch((error) => { aborted(signal); warnings.push("Sleeper NFL state is unavailable; the current week uses this league's last scored week."); return {}; })]);
    if (!Array.isArray(users) || !Array.isArray(rosters)) throw new Error("Sleeper returned incomplete manager or roster data. Try again.");
    const year = String(league.season), current = currentWeek(league, state), end = regularEnd(league), fingerprint = scoringFingerprint(league.scoring_settings);
    const saved = options.saved, exactSaved = saved?.league && String(saved.league.league_id) === id && String(saved.league.season) === year &&
      fingerprint !== null && scoringFingerprint(saved.league.scoring_settings) === fingerprint;
    const finalizedSaved = new Map();
    if (exactSaved) for (const block of saved.history || []) {
      if (String(block.season || block.league?.season) !== year || String(block.league_id || block.league?.league_id) !== id ||
        scoringFingerprint(block.scoring_settings || block.league?.scoring_settings) !== fingerprint) continue;
      const cutoff = Math.max(0, Math.min(Number(block.lastCompletedWeek) || 0, Number(saved.league.settings?.last_scored_leg) || 0,
        (Number(saved.currentWeek) || 1) - 1, regularEnd(saved.league)));
      for (let week = 1; week <= cutoff; week++) if (Array.isArray(block.weeks?.[week - 1]) && block.weeks[week - 1].length)
        finalizedSaved.set(week, compactWeek(block.weeks[week - 1]));
    }
    progress(`Loading Weeks 1–${end} with up to four requests at once…`);
    const weeks = Array.from({ length: 18 }, () => []);
    const fetched = await mapLimited(Array.from({ length: end }, (_, index) => index + 1), async (week) => {
      try { return compactWeek(await get(`/league/${id}/matchups/${week}`)); }
      catch (error) {
        aborted(signal); failedWeeks.push(week);
        if (exactSaved && Array.isArray(saved.weeks?.[week - 1]) && saved.weeks[week - 1].length) {
          restoredWeeks.push(week); const values = compactWeek(saved.weeks[week - 1]);
          if (week === current.week) values.forEach((row) => { delete row.starters; delete row.starters_points; });
          return values;
        }
        return [];
      }
    }, signal);
    fetched.forEach((rows, index) => { weeks[index] = rows; });
    if (end && failedWeeks.length === end) throw new Error("All Sleeper matchup requests failed. The previous board has been kept; try again shortly.");
    const historyWeeks = weeks.map((rows, index) => failedWeeks.includes(index + 1) ? clone(finalizedSaved.get(index + 1) || []) : clone(rows));
    const history = [{ season: year, league_id: id, scoring_settings: clone(league.scoring_settings || {}), playoffWeekStart: league.settings?.playoff_week_start ?? 15,
      lastCompletedWeek: Math.max(0, Math.min(Number(league.settings?.last_scored_leg) || 0, current.week - 1, end)), weeks: historyWeeks }];
    const visited = new Set([id]), maxSeasons = 10; let previous = league.previous_league_id, historyLimitReached = false;
    while (previous && String(previous) !== "0") {
      if (history.length >= maxSeasons) { historyLimitReached = true; warnings.push("History is limited to 10 seasons; older linked seasons were not loaded."); break; }
      if (!idPattern.test(String(previous)) || visited.has(String(previous))) { warnings.push("The previous-league chain is invalid or repeats a league; history loading stopped."); break; }
      const priorId = String(previous); visited.add(priorId);
      progress(`Checking historical season ${history.length + 1} of at most ${maxSeasons}…`);
      let prior;
      try { prior = await get(`/league/${priorId}`); }
      catch (error) { aborted(signal); historyFailures.push({ leagueId: priorId, reason: "League metadata unavailable" }); warnings.push("Some previous-season league metadata could not be loaded."); break; }
      if (!prior || String(prior.league_id) !== priorId || String(prior.sport).toLowerCase() !== "nfl") { warnings.push("A linked historical league was unavailable or unsupported; history loading stopped."); break; }
      const compatible = fingerprint !== null && scoringFingerprint(prior.scoring_settings) === fingerprint;
      const priorEnd = regularEnd(prior), cutoff = Math.max(0, Math.min(Number(prior.settings?.last_scored_leg) || 0, priorEnd,
        String(prior.season) === year ? current.week - 1 : 18));
      const priorWeeks = Array.from({ length: 18 }, () => []);
      if (compatible && cutoff) {
        const rows = await mapLimited(Array.from({ length: cutoff }, (_, index) => index + 1), async (week) => {
          try { return compactWeek(await get(`/league/${priorId}/matchups/${week}`)); }
          catch (error) { aborted(signal); historyFailures.push({ leagueId: priorId, week, reason: "Completed matchup unavailable" }); return []; }
        }, signal);
        rows.forEach((values, index) => { priorWeeks[index] = values; });
      }
      history.push({ season: String(prior.season), league_id: priorId, scoring_settings: clone(prior.scoring_settings || {}),
        playoffWeekStart: prior.settings?.playoff_week_start ?? 15, lastCompletedWeek: compatible ? cutoff : 0, weeks: priorWeeks });
      previous = prior.previous_league_id;
    }
    progress("Preparing player names, positions, and NFL schedule coverage…");
    const catalog = await playerCatalog(options, fetcher, now, warnings);
    const used = new Set(rosters.flatMap((roster) => [...(roster.players || []), ...(roster.starters || [])]).map(String));
    for (const block of history) for (const rows of block.weeks) for (const row of rows)
      [...(row.starters || []), ...Object.keys(row.players_points || {})].forEach((pid) => used.add(String(pid)));
    for (const rows of weeks) for (const row of rows) (row.starters || []).forEach((pid) => used.add(String(pid)));
    const players = {};
    for (const pid of used) if (pid && pid !== "0" && catalog.players[pid]) players[pid] = compactPlayers({ [pid]: catalog.players[pid] })[pid];
    const scheduleSnapshot = options.scheduleSnapshot, snapshotYear = String(scheduleSnapshot?.season ?? scheduleSnapshot?.league?.season ?? "");
    let schedule = [], scheduleUpdatedAt = null, complete = false;
    if (snapshotYear === year && Array.isArray(scheduleSnapshot.schedule || scheduleSnapshot.games)) {
      schedule = clone(scheduleSnapshot.schedule || scheduleSnapshot.games);
      scheduleUpdatedAt = scheduleSnapshot.scheduleUpdatedAt || scheduleSnapshot.updatedAt || null;
      complete = Boolean(scheduleSnapshot.scheduleComplete ?? scheduleSnapshot.complete) && scheduleComplete(schedule, year);
    } else {
      try { schedule = parseSchedule(await request(fetcher, SCHEDULE_URL, signal, true), year); scheduleUpdatedAt = timestamp; complete = scheduleComplete(schedule, year); }
      catch (error) { aborted(signal); warnings.push(`NFL schedule unavailable for ${year}; NFL byes will not be inferred.`); }
    }
    if (schedule.length && !complete) warnings.push("NFL schedule coverage is incomplete; NFL bye adjustments are disabled.");
    if (failedWeeks.length) warnings.push(`Matchup requests failed for Week(s) ${failedWeeks.sort((a, b) => a - b).join(", ")}. Saved pairings are used only for this exact league and scoring system; unfinalized saved scores are excluded from training.`);
    if (historyFailures.length) warnings.push("Some completed historical matchups are unavailable; the model uses only observed compatible results.");
    aborted(signal);
    return { league: clone(league), users: clone(users), rosters: clone(rosters), weeks, history, players,
      currentWeek: current.week, currentWeekSource: current.source, schedule, scheduleComplete: complete, scheduleUpdatedAt,
      asOf: timestamp, sourceUpdatedAt: restoredWeeks.length ? saved.sourceUpdatedAt || saved.asOf || null : timestamp,
      playersUpdatedAt: catalog.updatedAt || null, loadWarnings: warnings,
      refreshCoverage: { failedWeeks: failedWeeks.sort((a, b) => a - b), restoredWeeks: restoredWeeks.sort((a, b) => a - b),
        unavailableWeeks: failedWeeks.filter((week) => !restoredWeeks.includes(week)), historyFailures, historyLimitReached },
      sources: { sleeper: "https://docs.sleeper.com/", schedule: "https://github.com/nflverse/nfldata/blob/master/data/games.csv" } };
  }
  return { loadLeague, parseLeagueId, scoringFingerprint, regularEnd, currentWeek, parseSchedule, scheduleComplete };
});
