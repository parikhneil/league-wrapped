const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { analyze } = require("../league-stats");

const html = fs.readFileSync("index.html", "utf8");
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript?.includes("async function loadHistory"));
const loaderScript = inlineScript.split("let loaded = null,")[0];

function matchup(points = 20) {
  return [
    { roster_id: 1, matchup_id: 1, points, starters: ["p"], players: ["p"], players_points: { p: points } },
    { roster_id: 2, matchup_id: 1, points: 10, starters: ["q"], players: ["q"], players_points: { q: 10 } },
  ];
}

async function load({ requested = "saved-league", savedId = "saved-league", savedSrc = "Sleeper",
  savedWeek = matchup(), failed = ["/matchups/4"], liveWeek = matchup(99) } = {}) {
  const snapshot = [{ src: savedSrc, league: { league_id: savedId },
    weeks: [[], [], [], savedWeek] }];
  const context = {
    window: { LEAGUE_SNAPSHOT: snapshot },
    structuredClone,
    AbortSignal: { timeout: () => undefined },
    fetch: async (url) => {
      const path = new URL(url).pathname.replace(/^\/v1/, "");
      if (failed.some((suffix) => path.endsWith(suffix)))
        return { ok: false, status: 503 };
      let data = [];
      if (path === `/league/${requested}`) data = {
        league_id: requested, season: "2026", previous_league_id: null,
        status: "in_season", settings: { last_scored_leg: 4, playoff_week_start: 15 },
      };
      else if (path.endsWith("/users")) data = [
        { user_id: "a", display_name: "A" }, { user_id: "b", display_name: "B" },
      ];
      else if (path.endsWith("/rosters")) data = [
        { roster_id: 1, owner_id: "a", settings: {} },
        { roster_id: 2, owner_id: "b", settings: {} },
      ];
      else if (/\/matchups\/[1-4]$/.test(path)) data = liveWeek;
      return { ok: true, json: async () => structuredClone(data) };
    },
  };
  // A different request version skips the status/DOM path; this only exercises fetching.
  vm.runInNewContext(`${loaderScript}\nconst requestVersion = 0; globalThis.loadHistoryForTest = loadHistory;`, context);
  const seasons = await context.loadHistoryForTest(requested, 1);
  return { seasons: JSON.parse(JSON.stringify(seasons)), snapshot };
}

test("an exact saved Sleeper league restores a failed weekly matchup request", async () => {
  const { seasons, snapshot } = await load();
  const s = seasons[0];
  assert.deepEqual(s.weeks[3], matchup());
  assert.deepEqual(s.savedFallbacks, ["Week 4 matchups"]);
  assert.deepEqual(s.missing, []);
  s.src = "Sleeper";
  const d = analyze(seasons);
  assert.equal(d.playerStartWeeks.length, 8);
  assert.ok(d.startCoverage.every((c) => c.lineupWeeks === 4 && !c.missingWeeks.length));
  s.weeks[3][0].points = 777;
  assert.equal(snapshot[0].weeks[3][0].points, 20);
});

test("an unrelated league never receives another league's saved week", async () => {
  const { seasons } = await load({ requested: "custom-league" });
  assert.deepEqual(seasons[0].weeks[3], []);
  assert.deepEqual(seasons[0].savedFallbacks, []);
  assert.deepEqual(seasons[0].missing, ["Week 4 matchups"]);
  seasons[0].src = "Sleeper";
  const d = analyze(seasons);
  assert.equal(d.playerStartWeeks.length, 6);
  assert.ok(d.startCoverage.every((c) => c.missingWeeks.includes(4)));
});

test("successful live weeks take precedence, including a successful empty response", async () => {
  const live = await load({ failed: [] });
  assert.deepEqual(live.seasons[0].weeks[3], matchup(99));
  assert.deepEqual(live.seasons[0].savedFallbacks, []);
  const empty = await load({ failed: [], liveWeek: [] });
  assert.deepEqual(empty.seasons[0].weeks[3], []);
  assert.deepEqual(empty.seasons[0].savedFallbacks, []);
});

test("empty saved weeks, another platform, and other endpoint failures remain missing", async () => {
  const empty = await load({ savedWeek: [] });
  assert.deepEqual(empty.seasons[0].savedFallbacks, []);
  assert.deepEqual(empty.seasons[0].missing, ["Week 4 matchups"]);
  const espn = await load({ savedSrc: "ESPN" });
  assert.deepEqual(espn.seasons[0].savedFallbacks, []);
  assert.deepEqual(espn.seasons[0].missing, ["Week 4 matchups"]);
  const brackets = await load({ failed: ["/winners_bracket"] });
  assert.deepEqual(brackets.seasons[0].savedFallbacks, []);
  assert.deepEqual(brackets.seasons[0].missing, ["Playoff bracket"]);
});
