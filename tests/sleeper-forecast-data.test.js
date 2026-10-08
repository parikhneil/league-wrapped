const test = require("node:test");
const assert = require("node:assert/strict");
const Loader = require("../sleeper-forecast-data.js");
const { analyze } = require("../matchup-lines.js");
const API = "https://api.sleeper.app/v1";
const NOW = Date.parse("2026-10-07T12:00:00Z");
const scoring = { pass_td: 4, pass_int: -2 };
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture() {
  const rows = (week) => [1, 2].map((rid) => ({ roster_id: rid, matchup_id: 1, points: week === 1 ? rid * 10 : 0,
    starters: [`p${rid}`], players_points: { [`p${rid}`]: week === 1 ? rid * 10 : 0 } }));
  const league = { league_id: "111", season: "2026", sport: "nfl", name: "An unrelated league", status: "in_season",
    roster_positions: ["QB"], settings: { last_scored_leg: 1, playoff_week_start: 4 }, scoring_settings: scoring, previous_league_id: null };
  const catalog = { updatedAt: new Date(NOW).toISOString(), players: { p1: { name: "One", position: "QB", team: "KC" }, p2: { name: "Two", position: "QB", team: "BUF" }, fresh: { name: "Fresh", position: "QB", team: "DAL" }, bench: { name: "Bench", position: "RB", team: "NYJ" } } };
  const routes = {
    "/league/111": league,
    "/league/111/users": [{ user_id: "u1", display_name: "Unrelated manager 1" }, { user_id: "u2", display_name: "Unrelated manager 2" }],
    "/league/111/rosters": [1, 2].map((rid) => ({ roster_id: rid, owner_id: `u${rid}`, players: [`p${rid}`, "bench"], starters: [`p${rid}`] })),
    "/state/nfl": { season: "2026", week: 2, season_type: "regular" },
    "/league/111/matchups/1": rows(1), "/league/111/matchups/2": rows(2), "/league/111/matchups/3": rows(3),
    "/players/nfl": catalog.players,
  };
  const saved = { league: clone(league), users: clone(routes["/league/111/users"]), rosters: clone(routes["/league/111/rosters"]),
    weeks: [rows(1), rows(2), rows(3)], currentWeek: 2, history: [{ season: "2026", league_id: "111", scoring_settings: scoring,
      lastCompletedWeek: 1, weeks: [rows(1), rows(2), rows(3)] }], players: catalog.players, asOf: "2026-10-06T12:00:00Z" };
  return { routes, catalog, saved, rows };
}
function mockFetch(routes, options = {}) {
  const calls = [], active = { current: 0, maximum: 0 };
  const fetcher = async (url, init = {}) => {
    calls.push(url); const path = url.startsWith(API) ? url.slice(API.length) : url;
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const weekly = /\/matchups\/\d+$/.test(path);
    if (weekly) { active.current++; active.maximum = Math.max(active.maximum, active.current); }
    try {
      if (options.delay) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, options.delay);
        init.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
      if (!(path in routes) || routes[path] instanceof Error) return new Response("unavailable", { status: 503 });
      return typeof routes[path] === "string" ? new Response(routes[path]) : Response.json(clone(routes[path]));
    } finally { if (weekly) active.current--; }
  };
  return { fetcher, calls, active };
}
function options(f, mocked, extra = {}) {
  return { fetch: mocked.fetcher, now: NOW, catalog: f.catalog,
    scheduleSnapshot: { season: "2026", schedule: [], scheduleComplete: false }, ...extra };
}

test("accepts numeric IDs and trusted Sleeper league URLs while rejecting arbitrary targets", () => {
  for (const value of ["111", " 111 ", "https://sleeper.com/leagues/111", "https://sleeper.app/i/111?view=matchups", "https://www.sleeper.com/league/111/matchup"])
    assert.equal(Loader.parseLeagueId(value), "111");
  for (const value of ["https://evil.test/leagues/111", "https://sleeper.com@evil.test/leagues/111", "http://sleeper.com/leagues/111", "https://sleeper.com:8888/leagues/111", "https://sleeper.app/i/ABC", "1".repeat(25), "0", "../111"])
    assert.throws(() => Loader.parseLeagueId(value), /league ID|league link/);
});

test("loads an arbitrary league and its full catalog metadata without default-league state or big player API calls", async () => {
  const f = fixture(), mocked = mockFetch(f.routes), progress = [];
  f.routes["/league/111/rosters"][0].reserve = ["bench"];
  f.routes["/league/111/rosters"][0].taxi = ["future_player"];
  const data = await Loader.loadLeague("111", options(f, mocked, { onProgress: (message) => progress.push(message) }));
  assert.equal(data.league.name, "An unrelated league");
  assert.equal(data.users[0].display_name, "Unrelated manager 1");
  assert.equal(data.players.bench.name, "Bench");
  assert.equal(data.currentWeek, 2);
  assert.equal(data.weeks.length, 18);
  assert.equal(data.history[0].lastCompletedWeek, 1);
  assert.deepEqual(data.league.scoring_settings, scoring);
  assert.deepEqual(data.league.roster_positions, ["QB"]);
  assert.deepEqual(data.rosters[0].reserve, ["bench"]);
  assert.deepEqual(data.rosters[0].taxi, ["future_player"]);
  assert.equal(data.refreshCoverage.failedWeeks.length, 0);
  assert.ok(progress.length >= 3);
  assert.ok(!mocked.calls.some((url) => url.endsWith("/players/nfl")));
  assert.ok(mocked.calls.every((url) => url.startsWith(API)));
  assert.equal(analyze(data, { samples: 100, now: NOW }).weeks[0].matchups[0].available, true);
});

test("fresh roster starters override restored current pairings and saved provisional scores are never promoted", async () => {
  const f = fixture();
  f.routes["/state/nfl"].week = 3; f.routes["/league/111"].settings.last_scored_leg = 2;
  f.routes["/league/111/rosters"][0].starters = ["fresh"];
  f.routes["/league/111/rosters"][0].players = ["fresh", "bench"];
  f.routes["/league/111/matchups/2"] = new Error("failure");
  f.routes["/league/111/matchups/3"] = new Error("failure");
  f.saved.weeks[1][0].players_points.p1 = 9999;
  const before = clone(f.saved), mocked = mockFetch(f.routes);
  const data = await Loader.loadLeague("111", options(f, mocked, { saved: f.saved }));
  assert.deepEqual(f.saved, before, "saved snapshots are never mutated");
  assert.deepEqual(data.refreshCoverage.restoredWeeks, [2, 3]);
  assert.equal(data.weeks[2][0].starters, undefined);
  assert.deepEqual(data.history[0].weeks[1], []);
  assert.equal(data.history[0].lastCompletedWeek, 2);
  const team = analyze(data, { samples: 100, now: NOW }).weeks[0].matchups[0].teams[0];
  assert.equal(team.players[0].id, "fresh");
  assert.ok(!team.players.some((player) => player.id === "p1"), "stale cached starters cannot reintroduce players absent from the fresh roster");
});

test("fallback cannot borrow another league or incompatible scoring, but proven final saved observations survive partial failures", async () => {
  const f = fixture(); f.routes["/league/111/matchups/1"] = new Error("failure");
  let mocked = mockFetch(f.routes), data = await Loader.loadLeague("111", options(f, mocked, { saved: f.saved }));
  assert.equal(data.history[0].weeks[0][0].players_points.p1, 10);
  const unrelated = clone(f.saved); unrelated.league.league_id = "222";
  mocked = mockFetch(f.routes); data = await Loader.loadLeague("111", options(f, mocked, { saved: unrelated }));
  assert.deepEqual(data.weeks[0], []); assert.deepEqual(data.history[0].weeks[0], []);
  const incompatible = clone(f.saved); incompatible.league.scoring_settings.pass_int = -1;
  mocked = mockFetch(f.routes); data = await Loader.loadLeague("111", options(f, mocked, { saved: incompatible }));
  assert.deepEqual(data.refreshCoverage.restoredWeeks, []);
});

test("walks compatible previous-league history and preserves incompatible metadata without downloading its scores", async () => {
  const f = fixture(); f.routes["/league/111"].previous_league_id = "222";
  f.routes["/league/222"] = { ...clone(f.routes["/league/111"]), league_id: "222", season: "2025", status: "complete", previous_league_id: "333", settings: { last_scored_leg: 17, playoff_week_start: 4 } };
  f.routes["/league/333"] = { ...clone(f.routes["/league/222"]), league_id: "333", season: "2024", previous_league_id: null, scoring_settings: { ...scoring, pass_int: -1 } };
  [1, 2, 3].forEach((week) => { f.routes[`/league/222/matchups/${week}`] = f.rows(1); });
  const mocked = mockFetch(f.routes), data = await Loader.loadLeague("111", options(f, mocked));
  assert.equal(data.history.length, 3);
  assert.equal(data.history[1].lastCompletedWeek, 3);
  assert.equal(data.history[2].lastCompletedWeek, 0);
  assert.ok(!mocked.calls.some((url) => url.includes("/333/matchups/")));
  assert.ok(!mocked.calls.some((url) => url.includes("/222/matchups/4")));
  assert.equal(analyze(data, { samples: 100, now: NOW }).model.coverage.discardedSeasons[0].season, "2024");
});

test("weekly concurrency is bounded at four and cancellation returns no partially loaded state", async () => {
  const f = fixture(); f.routes["/league/111"].settings.playoff_week_start = 9;
  for (let week = 4; week <= 8; week++) f.routes[`/league/111/matchups/${week}`] = f.rows(week);
  let mocked = mockFetch(f.routes, { delay: 2 });
  await Loader.loadLeague("111", options(f, mocked));
  assert.equal(mocked.active.maximum, 4);
  const controller = new AbortController(); mocked = mockFetch(f.routes, { delay: 30 });
  const promise = Loader.loadLeague("111", options(f, mocked, { signal: controller.signal }));
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
});

test("NFL season state is scoped to the selected league and complete or predraft leagues stay honest", () => {
  const league = fixture().routes["/league/111"];
  assert.equal(Loader.currentWeek(league, { season: "2025", week: 16, season_type: "regular" }).week, 2);
  assert.equal(Loader.currentWeek({ ...league, status: "pre_draft", season: "2027" }, { season: "2026", week: 5, season_type: "regular" }).week, 1);
  assert.equal(Loader.currentWeek({ ...league, status: "complete" }, { season: "2026", week: 5, season_type: "regular" }).week, 19);
  assert.equal(Loader.regularEnd({ settings: { playoff_week_start: 0 } }), 18);
});

test("unsupported sports, best ball, missing leagues, and total matchup failures give useful errors", async () => {
  for (const [mutate, expected] of [
    [(f) => { f.routes["/league/111"].sport = "nba"; }, /NFL fantasy football.*NBA/],
    [(f) => { f.routes["/league/111"].settings.best_ball = 1; }, /Best-ball/],
    [(f) => { f.routes["/league/111"] = null; }, /not found/],
    [(f) => { [1, 2, 3].forEach((week) => { f.routes[`/league/111/matchups/${week}`] = new Error("failure"); }); }, /All Sleeper matchup requests failed/],
  ]) {
    const f = fixture(); mutate(f); const mocked = mockFetch(f.routes);
    await assert.rejects(Loader.loadLeague("111", options(f, mocked)), expected);
  }
});

test("player endpoint fallback is cached per loader fetch function for a day", async () => {
  const f = fixture(), mocked = mockFetch(f.routes), opts = options(f, mocked, { catalog: undefined });
  await Loader.loadLeague("111", opts); await Loader.loadLeague("111", opts);
  assert.equal(mocked.calls.filter((url) => url.endsWith("/players/nfl")).length, 1);
  await Loader.loadLeague("111", { ...opts, now: NOW + 86400001 });
  assert.equal(mocked.calls.filter((url) => url.endsWith("/players/nfl")).length, 2);
});

test("canceling one league selection does not cancel the shared catalog needed by the next league", async () => {
  const f = fixture();
  f.routes["/league/222"] = { ...clone(f.routes["/league/111"]), league_id: "222", name: "Latest league" };
  f.routes["/league/222/users"] = clone(f.routes["/league/111/users"]);
  f.routes["/league/222/rosters"] = clone(f.routes["/league/111/rosters"]);
  [1, 2, 3].forEach((week) => { f.routes[`/league/222/matchups/${week}`] = f.rows(week); });
  const mocked = mockFetch(f.routes);
  let startCatalog, finishCatalog, catalogSignal, catalogCalls = 0;
  const started = new Promise((resolve) => { startCatalog = resolve; });
  const pending = new Promise((resolve) => { finishCatalog = resolve; });
  const fetcher = (url, init) => {
    if (!url.endsWith("/players/nfl")) return mocked.fetcher(url, init);
    catalogCalls++; catalogSignal = init.signal; startCatalog();
    return pending.then(() => {
      if (init.signal.aborted) throw new DOMException("Aborted", "AbortError");
      return Response.json(f.catalog.players);
    });
  };
  const opts = options(f, mocked, { fetch: fetcher, catalog: undefined });
  const firstController = new AbortController();
  const firstResult = Loader.loadLeague("111", { ...opts, signal: firstController.signal })
    .then(() => null, (error) => error);
  await started;
  firstController.abort();
  assert.equal((await firstResult).name, "AbortError", "canceled caller settles while the catalog is still pending");
  assert.equal(catalogSignal.aborted, false, "the shared catalog owns its timeout rather than the first league's signal");
  const latest = Loader.loadLeague("222", opts);
  finishCatalog();
  const data = await latest;
  assert.equal(data.league.league_id, "222");
  assert.equal(data.players.p1.name, "One");
  assert.equal(catalogCalls, 1, "both selections reuse one public player download");
  await Loader.loadLeague("222", opts);
  assert.equal(catalogCalls, 1, "canceling the first selection does not evict the daily cache");
});

test("schedule CSV handles quoted multiline fields, DST, season filters, and excludes bookmaker columns", () => {
  const csv = 'season,game_type,week,gameday,gametime,home_team,away_team,game_id,notes,home_moneyline\r\n' +
    '2026,REG,5,2026-10-08,20:15,LAR,WSH,g1,"a quote ""and""\nnew line",-130\r\n' +
    '2026,REG,9,2026-11-08,13:00,JAC,BUF,g2,,120\n' +
    '2025,REG,5,2025-10-09,20:15,KC,DEN,old,,100\n' +
    '2026,POST,19,2027-01-10,13:00,KC,DEN,post,,100\n';
  const games = Loader.parseSchedule(csv, "2026");
  assert.equal(games.length, 2);
  assert.deepEqual([games[0].home, games[0].away], ["LA", "WAS"]);
  assert.equal(games[0].kickoff, "2026-10-09T00:15:00.000Z");
  assert.equal(games[1].kickoff, "2026-11-08T18:00:00.000Z");
  assert.equal(games[1].home, "JAX");
  assert.equal(games[0].home_moneyline, undefined);
  assert.equal(games[0].notes, undefined);
});

test("NFL schedule completeness verifies season-specific game counts and rejects duplicate or partial games", () => {
  const clubs = "ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LA LAC LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split(" ");
  for (const [season, rounds] of [[2026, 17], [2020, 16]]) {
    const games = Array.from({ length: rounds }, (_, i) => Array.from({ length: 16 }, (_, j) => ({ week: i + 1, home: clubs[j * 2], away: clubs[j * 2 + 1], gameId: `${i}-${j}` }))).flat();
    games.slice(-8).forEach((game) => { game.week = rounds + 1; });
    assert.equal(Loader.scheduleComplete(games, season), true);
    assert.equal(Loader.scheduleComplete(games.slice(1), season), false);
    assert.equal(Loader.scheduleComplete([...games, games[0]], season), false);
  }
  assert.equal(Loader.scheduleComplete(null, 2026), false);
});

test("wrong-season schedule is never reused; failed or partial replacement disables inferred byes", async () => {
  const f = fixture(), mocked = mockFetch(f.routes);
  const data = await Loader.loadLeague("111", options(f, mocked, { scheduleSnapshot: { season: "2025", schedule: [{ week: 2, home: "KC", away: "BUF", gameId: "old" }], scheduleComplete: true } }));
  assert.deepEqual(data.schedule, []);
  assert.equal(data.scheduleComplete, false);
  assert.ok(data.loadWarnings.some((warning) => /schedule unavailable/.test(warning)));
  assert.ok(mocked.calls.some((url) => url.startsWith("https://raw.githubusercontent.com/nflverse/")));
});

test("previous league traversal is bounded and explicitly discloses the limit", async () => {
  const f = fixture();
  for (let index = 0; index < 11; index++) {
    const id = String(111 + index), next = index < 10 ? String(112 + index) : null;
    f.routes[`/league/${id}`] = { ...clone(f.routes["/league/111"]), league_id: id, season: String(2026 - index), previous_league_id: next,
      scoring_settings: index ? { pass_td: 6 } : scoring };
  }
  const mocked = mockFetch(f.routes), data = await Loader.loadLeague("111", options(f, mocked));
  assert.equal(data.history.length, 10);
  assert.equal(data.refreshCoverage.historyLimitReached, true);
  assert.ok(!mocked.calls.some((url) => url.endsWith("/league/121")));
  assert.ok(data.loadWarnings.some((warning) => /limited to 10 seasons/.test(warning)));
});
