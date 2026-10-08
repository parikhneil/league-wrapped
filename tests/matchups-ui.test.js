const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const MatchupLines = require("../matchup-lines.js");
const SleeperForecastData = require("../sleeper-forecast-data.js");
const script = fs.readFileSync("matchups-ui.js", "utf8");

function fixture() {
  return {
    league: {
      league_id: "1381121078079795200",
      season: "2026",
      name: "League <script>unsafe</script>",
      status: "in_season",
      sport: "nfl",
      scoring_settings: { rec: 1, pass_td: 4, zero: 0 },
      roster_positions: ["RB", "BN"],
      settings: { playoff_week_start: 7, last_scored_leg: 4 },
    },
    currentWeek: 5,
    users: [1, 2, 3, 4].map((x) => ({
      user_id: String(x),
      display_name: x === 1 ? "<img src=x onerror=unsafe>" : `Manager ${x}`,
    })),
    rosters: [1, 2, 3, 4].map((x) => ({
      roster_id: x,
      owner_id: String(x),
      starters: [`p${x}`],
      players: [`p${x}`],
    })),
    weeks: Array.from({ length: 6 }, () =>
      [1, 2, 3, 4].map((x) => ({
        roster_id: x,
        matchup_id: Math.ceil(x / 2),
        starters: [`p${x}`],
        points: 20,
        players_points: { [`p${x}`]: 20 },
      })),
    ),
    history: [],
    players: Object.fromEntries(
      [1, 2, 3, 4].map((x) => [
        `p${x}`,
        { name: "Player <b>unsafe</b>", position: "RB", team: "BUF" },
      ]),
    ),
    schedule: [],
    scheduleComplete: true,
    asOf: "2026-10-07T12:00:00Z",
    sourceUpdatedAt: "2026-10-05T12:00:00Z",
    playersUpdatedAt: "2026-10-06T12:00:00Z",
    scheduleUpdatedAt: "2026-10-04T12:00:00Z",
  };
}

function harness({
  saved = fixture(),
  failedWeeks = [],
  freshScoring = null,
  state = { season: "2026", season_type: "regular", week: 5 },
  completed = 4,
  incomplete = false,
  offline = false,
  clock = () => Date.now(),
  freshWeeks = null,
  freshRosters = null,
  actualModel = false,
  href = "http://localhost/matchups.html",
  leagues = {},
  aliases = {},
  loaderHook = null,
  catalog = null,
} = {}) {
  const elements = new Map(),
    calls = [],
    loads = [],
    requests = [],
    pending = [],
    dashboardLinks = [{ href: "index.html" }, { href: "index.html" }],
    navigation = [];
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        innerHTML: "",
        textContent: "",
        value: "",
        disabled: false,
        attributes: {},
        handlers: {},
        classList: { toggle() {} },
        setAttribute(key, value) {
          this.attributes[key] = value;
        },
        addEventListener(key, handler) {
          this.handlers[key] = handler;
        },
      });
    return elements.get(id);
  };
  const team = (x, data) => {
    const roster = data.rosters.find((r) => Number(r.roster_id) === x);
    const owner = String(roster?.owner_id || x);
    return {
      rosterId: x,
      uid: owner,
      name:
        data.users.find((u) => String(u.user_id) === owner)?.display_name ||
        `Manager ${x}`,
      projectedPoints: 100,
      winProbability: 0.5,
      fairMoneyline: 100,
      teamTotal: {
        line: 100.5,
        overProbability: 0.5,
        underProbability: 0.5,
        pushProbability: 0,
        overOdds: 100,
        underOdds: 100,
      },
      coverage: { complete: true, lineupSource: "optimal_projected_roster" },
      players: [
        {
          id: `p${x}`,
          name: "Player <b>unsafe</b>",
          position: "RB",
          slot: "RB",
          team: "BUF",
          mean: 15,
          line: 15.5,
          overProbability: 0.5,
          underProbability: 0.5,
          pushProbability: 0,
          overOdds: 100,
          underOdds: 100,
          observations: 8,
          status: "historical",
          thresholds: [{ line: 15, probability: 0.55, odds: -122 }],
        },
      ],
    };
  };
  const model = {
    analyze(data, options) {
      const call = { data: structuredClone(data), options };
      calls.push(call);
      if (actualModel) {
        call.result = MatchupLines.analyze(data, options);
        return call.result;
      }
      return {
        model: {
          method: "<script>unsafe</script>",
          coverage: {
            completedWeeks: 4,
            compatibleSeasons: [data.league.season],
            discardedSeasons: [{ season: "2025", reason: "Scoring differs" }],
          },
        },
        weeks: [
          {
            week: options.week,
            matchups: [
              [1, 2],
              [3, 4],
            ].map((pair, index) => ({
              id: index,
              week: options.week,
              teams: pair.map((x) => team(x, data)),
              available: true,
              spread: {
                homeLine: -0.5,
                awayLine: 0.5,
                homeCoverProbability: 0.5,
                awayCoverProbability: 0.5,
                homeOdds: 100,
                awayOdds: 100,
                pushProbability: 0,
              },
              total: {
                line: 200.5,
                overProbability: 0.5,
                underProbability: 0.5,
                overOdds: 100,
                underOdds: 100,
                pushProbability: 0,
              },
              notes: ["<script>unsafe</script>"],
              tieProbability: 0,
            })),
            highestScorer: [1, 2, 3, 4].map((x) => ({
              ...team(x, data),
              probability: 0.25,
              odds: 300,
            })),
            highestScorerComplete: !incomplete,
            unscheduled: [],
          },
        ],
      };
    },
  };
  class ClockDate extends Date {
    static now() {
      return clock();
    }
  }
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    if (offline) throw new Error("offline");
    const path = new URL(url).pathname.replace(/^\/v1/, "");
    if (path === "/state/nfl")
      return { ok: true, json: async () => structuredClone(state) };
    const match =
      /^\/league\/(\d+)(?:\/(users|rosters|matchups)(?:\/(\d+))?)?$/.exec(path);
    if (!match) throw new Error(`Unexpected API path: ${path}`);
    const [, id, resource, weekText] = match;
    const source = id === saved.league.league_id ? saved : leagues[id];
    if (!source) return { ok: false, status: 404 };
    const week = Number(weekText);
    if (resource === "matchups" && failedWeeks.includes(week))
      return { ok: false, status: 503 };
    const isSaved = id === saved.league.league_id;
    const body =
      resource === "users"
        ? source.users
        : resource === "rosters"
          ? (isSaved && freshRosters) || source.rosters
          : resource === "matchups"
            ? ((isSaved && freshWeeks) || source.weeks)[week - 1] || []
            : {
                ...source.league,
                scoring_settings:
                  (isSaved && freshScoring) || source.league.scoring_settings,
                settings: {
                  ...source.league.settings,
                  last_scored_leg: isSaved
                    ? completed
                    : source.league.settings.last_scored_leg,
                },
              };
    return { ok: true, json: async () => structuredClone(body) };
  };
  const context = {
    window: {
      MATCHUP_DATA: saved,
      MatchupLines: model,
      LEAGUE_NAMES: aliases,
      FORECAST_PLAYERS: catalog || {
        updatedAt: saved.playersUpdatedAt,
        players: {
          ...saved.players,
          ...Object.fromEntries(
            Object.values(leagues).flatMap((d) =>
              Object.entries(d.players || {}),
            ),
          ),
        },
      },
      location: { href },
      handlers: {},
      addEventListener(key, handler) {
        this.handlers[key] = handler;
      },
    },
    document: {
      getElementById: element,
      querySelectorAll: () => dashboardLinks,
    },
    URL,
    Intl,
    Date: ClockDate,
    structuredClone,
    AbortController,
    requestAnimationFrame: (f) => f(),
    setTimeout: (f) => f(),
  };
  context.window.history = Object.fromEntries(
    ["pushState", "replaceState"].map((method) => [
      method,
      (_state, _title, url) => {
        navigation.push({ method, url });
        context.window.location.href = url;
      },
    ]),
  );
  context.window.SleeperForecastData = {
    parseLeagueId: SleeperForecastData.parseLeagueId,
    loadLeague(id, options) {
      loads.push({ id, options });
      const promise = loaderHook
        ? loaderHook(id, options)
        : SleeperForecastData.loadLeague(id, {
            ...options,
            fetch: fetcher,
            now: clock(),
          });
      pending.push(promise);
      return promise;
    },
  };
  vm.runInNewContext(script, context);
  return {
    element,
    calls,
    loads,
    requests,
    dashboardLinks,
    navigation,
    window: context.window,
    refresh: () => element("refresh-data").handlers.click(),
    load(input) {
      element("league-input").value = input;
      return element("league-form").handlers.submit({ preventDefault() {} });
    },
    reset: () => element("our-league").handlers.click(),
    async ready() {
      await Promise.allSettled(pending);
      await new Promise(setImmediate);
    },
  };
}

test("external names are escaped and scoped filters reuse all-team simulations", () => {
  const h = harness(),
    board = h.element("matchup-board");
  assert.ok(board.innerHTML.includes("&lt;img"));
  assert.ok(!board.innerHTML.includes("<script>"));
  assert.ok(h.element("data-meta").innerHTML.includes("&lt;script&gt;"));
  assert.ok(
    h.element("model-copy").innerHTML.includes("2025: Scoring differs"),
  );
  assert.ok(!h.element("model-copy").innerHTML.includes("[object Object]"));
  assert.ok(board.innerHTML.includes("optimized roster lineup"));
  assert.ok(!board.innerHTML.includes("current_week_matchup"));
  h.element("manager-select").handlers.change({ target: { value: "1" } });
  assert.equal(h.calls.length, 1);
  assert.equal(
    (board.innerHTML.match(/class="matchup-card"/g) || []).length,
    1,
  );
  assert.equal(
    (board.innerHTML.match(/class="highest-card"/g) || []).length,
    4,
  );
  h.element("week-select").handlers.change({ target: { value: "6" } });
  assert.equal(h.calls.length, 2);
  assert.ok(
    board.innerHTML.includes(
      "Optimized weekly lineup · current roster held forward",
    ),
  );
});

test("partial highest-scorer coverage never appears as a league-wide price", () => {
  const h = harness({ incomplete: true });
  const html = h.element("matchup-board").innerHTML;
  assert.ok(html.includes("Weekly highest scorer unavailable"));
  assert.ok(!html.includes("League-wide market"));
  assert.ok(!html.includes('class="highest-card"'));
});

test("underway weeks are labeled full-week baselines and source freshness uses the source timestamp", () => {
  const saved = fixture();
  saved.schedule = [{ week: 5, kickoff: "2020-01-01T12:00:00Z" }];
  const h = harness({ saved });
  assert.ok(
    h
      .element("matchup-board")
      .innerHTML.includes("Week under way · full-week baseline"),
  );
  assert.ok(
    h.element("matchup-board").innerHTML.includes("do not use accrued points"),
  );
  const expected = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(saved.sourceUpdatedAt));
  assert.ok(
    h.element("data-meta").innerHTML.includes(`Forecast data: ${expected}`),
  );
});

test("offline and all-failed matchup refreshes preserve the saved board", async () => {
  for (const options of [
    { offline: true },
    { failedWeeks: [1, 2, 3, 4, 5, 6] },
  ]) {
    const h = harness(options),
      before = h.element("matchup-board").innerHTML;
    await h.refresh();
    assert.equal(h.element("matchup-board").innerHTML, before);
    assert.equal(h.calls.length, 1);
    assert.ok(
      h
        .element("refresh-status")
        .textContent.includes("saved forecast board is still available"),
    );
    assert.equal(h.element("refresh-data").disabled, false);
  }
});

test("saved-week fallback requires equivalent nonzero scoring and retains metadata dates", async () => {
  const same = harness({
    failedWeeks: [1],
    freshScoring: { rec: "1", pass_td: 4, another_zero: 0 },
  });
  await same.refresh();
  const refreshed = same.calls.at(-1).data;
  assert.equal(refreshed.weeks[0].length, 4);
  assert.deepEqual(refreshed.refreshCoverage.restoredWeeks, [1]);
  assert.equal(refreshed.playersUpdatedAt, "2026-10-06T12:00:00Z");
  assert.equal(refreshed.scheduleUpdatedAt, "2026-10-04T12:00:00Z");
  const changed = harness({
    failedWeeks: [1],
    freshScoring: { rec: 0.5, pass_td: 4 },
  });
  await changed.refresh();
  assert.deepEqual(changed.calls.at(-1).data.weeks[0], []);
  assert.deepEqual(changed.calls.at(-1).data.refreshCoverage.restoredWeeks, []);
  assert.ok(
    changed
      .element("refresh-status")
      .textContent.includes("Unavailable weeks: 1"),
  );
});

test("NFL state week is accepted only during the matching regular season; history cutoff cannot include underway weeks", async () => {
  const pre = harness({
    state: { season: "2026", season_type: "pre", week: 2 },
  });
  await pre.refresh();
  assert.equal(pre.calls.at(-1).data.currentWeek, 1);
  const clamped = harness({ completed: 9 });
  await clamped.refresh();
  assert.equal(
    clamped.calls.at(-1).data.history.find((h) => h.season === "2026")
      .lastCompletedWeek,
    4,
  );
  const invalid = harness({
    state: { season: "2026", season_type: "regular", week: 99 },
  });
  await invalid.refresh();
  assert.equal(invalid.calls.at(-1).data.currentWeek, 5);
});

test("a no-playoffs league can display known regular-season pairings through week 18", () => {
  const saved = fixture();
  saved.league.settings.playoff_week_start = 0;
  saved.currentWeek = 18;
  saved.weeks = Array.from({ length: 18 }, () => saved.weeks[0]);
  const h = harness({ saved });
  assert.ok(h.element("week-select").innerHTML.includes('value="18"'));
});

test("later interactions recheck the model when time-sensitive metadata may have aged", () => {
  let now = Date.parse("2026-10-07T12:00:00Z");
  const h = harness({ clock: () => now });
  assert.ok(
    h
      .element("model-copy")
      .innerHTML.includes("Cached injury tags: stale / unavailable; ignored"),
  );
  h.element("manager-select").handlers.change({ target: { value: "1" } });
  assert.equal(h.calls.length, 1);
  now += 3600000;
  h.element("manager-select").handlers.change({ target: { value: "all" } });
  assert.equal(h.calls.length, 2);
});

function rolloverFixture() {
  const saved = fixture();
  saved.league.settings.playoff_week_start = 9;
  saved.weeks.push(
    structuredClone(saved.weeks[0]),
    structuredClone(saved.weeks[0]),
  );
  for (let index = 4; index < saved.weeks.length; index++)
    for (const row of saved.weeks[index]) {
      row.points = 0;
      row.players_points = Object.fromEntries(
        row.starters.map((id) => [id, 0]),
      );
    }
  saved.history = [
    {
      season: "2026",
      league_id: saved.league.league_id,
      scoring_settings: saved.league.scoring_settings,
      lastCompletedWeek: 4,
      weeks: structuredClone(saved.weeks),
    },
  ];
  return saved;
}

test("a failed newly completed week keeps its pairings without training on saved provisional zeroes", async () => {
  const saved = rolloverFixture();
  const h = harness({
    saved,
    actualModel: true,
    failedWeeks: [5],
    completed: 5,
    state: { season: "2026", season_type: "regular", week: 6 },
  });
  assert.equal(h.calls[0].result.model.coverage.playerObservations, 16);
  await h.refresh();
  const call = h.calls.at(-1),
    block = call.data.history.find((b) => b.season === "2026");
  assert.equal(call.data.weeks[4].length, 4);
  assert.deepEqual(block.weeks[4], []);
  assert.equal(block.lastCompletedWeek, 5);
  assert.equal(call.result.model.coverage.playerObservations, 16);
  assert.equal(call.result.model.coverage.completedWeeks, 4);
  assert.equal(call.data.sourceUpdatedAt, saved.sourceUpdatedAt);
});

test("gaps from restored provisional weeks do not exclude successfully fetched later completed weeks", async () => {
  const saved = rolloverFixture(),
    freshWeeks = structuredClone(saved.weeks);
  for (const row of freshWeeks[5]) {
    row.points = 30;
    row.players_points = Object.fromEntries(row.starters.map((id) => [id, 30]));
  }
  const h = harness({
    saved,
    freshWeeks,
    actualModel: true,
    failedWeeks: [5],
    completed: 6,
    state: { season: "2026", season_type: "regular", week: 7 },
  });
  await h.refresh();
  const call = h.calls.at(-1),
    block = call.data.history.find((b) => b.season === "2026");
  assert.deepEqual(block.weeks[4], []);
  assert.equal(block.weeks[5][0].players_points.p1, 30);
  assert.equal(call.result.model.coverage.playerObservations, 20);
  assert.deepEqual(
    call.result.model.coverage.historyWeeks.map((w) => w.week),
    [1, 2, 3, 4, 6],
  );
  await h.refresh();
  const repeated = h.calls.at(-1);
  assert.deepEqual(
    repeated.data.history.find((b) => b.season === "2026").weeks[4],
    [],
  );
  assert.equal(repeated.result.model.coverage.playerObservations, 20);
});

test("already completed saved history remains eligible only for the exact saved league", async () => {
  const saved = rolloverFixture();
  const h = harness({ saved, actualModel: true, failedWeeks: [3] });
  await h.refresh();
  const call = h.calls.at(-1),
    block = call.data.history.find((b) => b.season === "2026");
  assert.equal(block.weeks[2][0].players_points.p1, 20);
  assert.equal(call.result.model.coverage.playerObservations, 16);
  const unrelated = rolloverFixture();
  unrelated.history[0].league_id = "unrelated-league";
  const other = harness({
    saved: unrelated,
    actualModel: true,
    failedWeeks: [3],
  });
  await other.refresh();
  assert.deepEqual(other.calls.at(-1).data.history[0].weeks[2], []);
  assert.equal(other.calls.at(-1).result.model.coverage.playerObservations, 12);
});

test("failed new-current matchups retain pairings while selecting the fresh full roster regardless of submitted starters", async () => {
  const saved = rolloverFixture(),
    freshRosters = saved.rosters.map((r) => ({
      ...r,
      starters: [`p${r.roster_id}`],
      players: [`new${r.roster_id}`],
    }));
  const freshWeeks = structuredClone(saved.weeks);
  for (const row of freshWeeks[4]) {
    row.points = 25;
    row.players_points = Object.fromEntries(row.starters.map((id) => [id, 25]));
  }
  const h = harness({
    saved,
    catalog: {
      updatedAt: saved.playersUpdatedAt,
      players: {
        ...saved.players,
        ...Object.fromEntries(
          [1, 2, 3, 4].map((x) => [
            `new${x}`,
            { name: `New ${x}`, position: "RB", team: "BUF" },
          ]),
        ),
      },
    },
    freshRosters,
    freshWeeks,
    actualModel: true,
    failedWeeks: [6],
    completed: 5,
    state: { season: "2026", season_type: "regular", week: 6 },
  });
  await h.refresh();
  const call = h.calls.at(-1),
    row = call.data.weeks[5][0];
  assert.equal(row.matchup_id, 1);
  assert.ok(!Object.hasOwn(row, "starters"));
  const team = call.result.weeks[0].matchups[0].teams[0];
  assert.equal(team.coverage.lineupSource, "optimal_projected_roster");
  assert.equal(team.players[0].id, "new1");
  assert.equal(call.result.model.coverage.playerObservations, 20);
  assert.equal(call.data.sourceUpdatedAt, saved.sourceUpdatedAt);
  assert.ok(
    h.element("matchup-board").innerHTML.includes("optimized roster lineup"),
  );
});

test("inconsistent saved completion metadata cannot promote an old provisional week", async () => {
  for (const [savedCurrent, savedCompleted] of [
    [5, 6],
    [7, 4],
  ]) {
    const saved = rolloverFixture();
    saved.currentWeek = savedCurrent;
    saved.league.settings.last_scored_leg = savedCompleted;
    saved.history[0].lastCompletedWeek = 6;
    const h = harness({
      saved,
      actualModel: true,
      failedWeeks: [5],
      completed: 7,
      state: { season: "2026", season_type: "regular", week: 8 },
    });
    await h.refresh();
    const block = h.calls.at(-1).data.history.find((b) => b.season === "2026");
    assert.deepEqual(block.weeks[4], []);
  }
});

function customFixture(id = "123456") {
  const saved = fixture();
  saved.league.league_id = id;
  saved.league.name = `Custom league ${id}`;
  saved.league.scoring_settings = { rec: 0.5, pass_td: 4 };
  saved.users.forEach((u, index) => {
    u.display_name = `Custom manager ${index + 1}`;
  });
  saved.rosters.forEach((r) => {
    r.players = [`custom${r.roster_id}`];
    r.starters = ["0"];
  });
  saved.weeks.forEach((rows) =>
    rows.forEach((r) => {
      r.starters = [`custom${r.roster_id}`];
      r.players_points = { [`custom${r.roster_id}`]: 33 };
      r.points = 33;
    }),
  );
  saved.players = Object.fromEntries(
    [1, 2, 3, 4].map((x) => [
      `custom${x}`,
      { name: `Custom player ${x}`, position: "RB", team: "BUF" },
    ]),
  );
  return saved;
}

test("loading a Sleeper URL switches atomically, resets filters, and never leaks default manager aliases or history", async () => {
  const custom = customFixture();
  const h = harness({
    leagues: { 123456: custom },
    aliases: { 1: "Canonical default manager" },
    actualModel: true,
  });
  assert.ok(
    h.element("matchup-board").innerHTML.includes("Canonical default manager"),
  );
  h.element("manager-select").handlers.change({ target: { value: "1" } });
  h.element("week-select").handlers.change({ target: { value: "6" } });
  await h.load("https://sleeper.com/leagues/123456/team");
  assert.equal(h.loads.at(-1).id, "123456");
  assert.equal(h.loads.at(-1).options.saved, undefined);
  const call = h.calls.at(-1);
  assert.equal(call.options.week, 5);
  assert.equal(call.data.league.league_id, "123456");
  assert.equal(call.result.model.coverage.playerObservations, 16);
  assert.ok(call.data.history.every((block) => block.league_id === "123456"));
  assert.ok(call.data.history[0].weeks[0].every((row) => row.points === 33));
  assert.ok(h.element("matchup-board").innerHTML.includes("Custom manager 1"));
  assert.ok(
    !h.element("matchup-board").innerHTML.includes("Canonical default manager"),
  );
  assert.ok(h.element("manager-select").innerHTML.includes('value="all"'));
  assert.ok(
    !h.element("manager-select").innerHTML.includes('value="1" selected'),
  );
  assert.ok(h.element("matchup-board").innerHTML.includes("Optimized RB"));
  assert.ok(
    h.dashboardLinks.every((link) => link.href === "index.html?league=123456"),
  );
  assert.equal(
    new URL(h.window.location.href).searchParams.get("league"),
    "123456",
  );
  assert.equal(h.navigation.at(-1).method, "pushState");
  await h.refresh();
  assert.equal(h.loads.at(-1).options.saved.league.league_id, "123456");
  assert.equal(h.navigation.at(-1).method, "replaceState");
});

test("an initial custom query loads only that league and a failed query never displays the default board as success", async () => {
  const custom = customFixture();
  const h = harness({
    href: "http://localhost/matchups.html?league=123456",
    leagues: { 123456: custom },
  });
  assert.equal(h.calls.length, 0);
  assert.ok(
    h.element("matchup-board").innerHTML.includes("Loading this league"),
  );
  await h.ready();
  assert.equal(h.calls[0].data.league.league_id, "123456");
  assert.equal(h.loads[0].options.saved, undefined);
  assert.equal(h.navigation.at(-1).method, "replaceState");
  const failed = harness({
    href: "http://localhost/matchups.html?league=999999",
  });
  await failed.ready();
  assert.equal(failed.calls.length, 0);
  assert.equal(failed.element("data-meta").innerHTML, "");
  assert.ok(
    failed
      .element("matchup-board")
      .innerHTML.includes("This league could not be loaded"),
  );
  assert.ok(failed.element("refresh-status").textContent.includes("999999"));
  assert.equal(failed.element("refresh-data").disabled, true);
  failed.reset();
  assert.equal(
    failed.calls.at(-1).data.league.league_id,
    fixture().league.league_id,
  );
  assert.equal(
    new URL(failed.window.location.href).searchParams.has("league"),
    false,
  );
  assert.equal(failed.element("refresh-data").disabled, false);
});

test("failed switches keep the old board and URL, identify the failed target, and never borrow another league's cached week", async () => {
  const custom = customFixture();
  const h = harness({
    leagues: { 123456: custom },
    failedWeeks: [3],
    actualModel: true,
  });
  const before = h.element("matchup-board").innerHTML;
  await h.load("987654");
  assert.equal(h.element("matchup-board").innerHTML, before);
  assert.ok(
    h
      .element("refresh-status")
      .textContent.includes("Could not load league 987654"),
  );
  assert.ok(h.element("refresh-status").textContent.includes("Still showing"));
  assert.equal(h.navigation.length, 0);
  await h.load("123456");
  const data = h.calls.at(-1).data;
  assert.deepEqual(data.weeks[2], []);
  assert.deepEqual(data.refreshCoverage.restoredWeeks, []);
  assert.deepEqual(data.refreshCoverage.unavailableWeeks, [3]);
  assert.equal(h.calls.at(-1).result.model.coverage.playerObservations, 12);
  assert.ok(
    h.element("model-copy").innerHTML.includes("Matchup requests failed"),
  );
});

test("NBA and invalid links fail with helpful messages before replacing the current football board", async () => {
  const nba = customFixture("555555");
  nba.league.sport = "nba";
  const h = harness({ leagues: { 555555: nba } });
  const before = h.element("matchup-board").innerHTML;
  await h.load("555555");
  assert.equal(h.element("matchup-board").innerHTML, before);
  assert.ok(
    h
      .element("refresh-status")
      .textContent.includes("NBA and other sports are not supported"),
  );
  const requestCount = h.requests.length;
  await h.load("https://evil.example/leagues/123456");
  assert.equal(h.requests.length, requestCount);
  assert.ok(
    h
      .element("refresh-status")
      .textContent.includes("HTTPS Sleeper league link"),
  );
});

test("the latest league load wins even if an aborted older request resolves after it; reset also cancels a pending switch", async () => {
  const waiting = new Map();
  const h = harness({
    loaderHook: (id) => new Promise((resolve) => waiting.set(id, resolve)),
  });
  const first = h.load("111111"),
    second = h.load("222222");
  assert.equal(h.loads[0].options.signal.aborted, true);
  waiting.get("222222")(customFixture("222222"));
  await second;
  waiting.get("111111")(customFixture("111111"));
  await first;
  assert.equal(h.calls.at(-1).data.league.league_id, "222222");
  assert.equal(h.element("league-input").value, "222222");
  assert.equal(
    new URL(h.window.location.href).searchParams.get("league"),
    "222222",
  );
  assert.ok(!h.element("data-meta").innerHTML.includes("111111"));
  const third = h.load("333333");
  h.reset();
  assert.equal(h.loads.at(-1).options.signal.aborted, true);
  waiting.get("333333")(customFixture("333333"));
  await third;
  assert.equal(
    h.calls.at(-1).data.league.league_id,
    fixture().league.league_id,
  );
  assert.equal(h.element("league-form").attributes["aria-busy"], "false");
  assert.equal(
    new URL(h.window.location.href).searchParams.has("league"),
    false,
  );
});

test("browser history navigation restores the corresponding league without pushing another history entry", async () => {
  const custom = customFixture();
  const h = harness({ leagues: { 123456: custom } });
  await h.load("123456");
  const count = h.navigation.length;
  h.window.location.href = "http://localhost/matchups.html";
  await h.window.handlers.popstate();
  assert.equal(
    h.calls.at(-1).data.league.league_id,
    fixture().league.league_id,
  );
  assert.equal(h.navigation.length, count);
  h.window.location.href = "http://localhost/matchups.html?league=123456";
  await h.window.handlers.popstate();
  assert.equal(h.calls.at(-1).data.league.league_id, "123456");
  assert.equal(h.navigation.length, count);
});

test("completed or unscheduled leagues clear the previous league's prices and model coverage", async () => {
  for (const completed of [true, false]) {
    const custom = customFixture();
    if (completed) custom.league.status = "complete";
    else custom.weeks = Array.from({ length: 18 }, () => []);
    const h = harness({ leagues: { 123456: custom } });
    assert.ok(h.element("model-copy").innerHTML.includes("Compatible history"));
    await h.load("123456");
    assert.ok(
      !h.element("matchup-board").innerHTML.includes('class="matchup-card"'),
    );
    assert.ok(
      h.element("model-copy").innerHTML.includes("Custom league 123456"),
    );
    assert.ok(
      !h.element("model-copy").innerHTML.includes("Compatible history"),
    );
    assert.ok(
      !h.element("model-copy").innerHTML.includes("2025: Scoring differs"),
    );
  }
});

test("injury status assumptions expire at 24 hours even within an existing hourly cache bucket", () => {
  const saved = fixture();
  saved.playersUpdatedAt = "2026-10-06T16:45:00.000Z";
  saved.asOf = "2026-10-07T16:45:00.000Z";
  saved.players.p1.injuryStatus = "Out";
  let now = Date.parse(saved.asOf);
  const h = harness({ saved, actualModel: true, clock: () => now });
  assert.equal(
    h.calls[0].result.model.coverage.currentInjuryMetadataFresh,
    true,
  );
  assert.ok(
    h
      .element("model-copy")
      .innerHTML.includes("Cached injury tags: applied for current week"),
  );
  now += 1;
  h.element("manager-select").handlers.change({ target: { value: "1" } });
  assert.equal(h.calls.length, 2);
  assert.equal(
    h.calls[1].result.model.coverage.currentInjuryMetadataFresh,
    false,
  );
  assert.ok(
    h
      .element("model-copy")
      .innerHTML.includes("Cached injury tags: stale / unavailable; ignored"),
  );
});
