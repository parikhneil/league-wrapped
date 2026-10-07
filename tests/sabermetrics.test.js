const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { analyze, optimizeLineup } = require("../league-stats");

const close = (actual, expected, message) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    message || `${actual} != ${expected}`,
  );

function season(scores, overrides = {}) {
  const ids = scores[0].map((_, i) => String.fromCharCode(97 + i));
  return {
    src: "Sleeper",
    league: {
      season: "2026",
      status: "in_season",
      settings: { playoff_week_start: 15, last_scored_leg: scores.length },
    },
    users: ids.map((user_id) => ({ user_id, display_name: user_id })),
    rosters: ids.map((owner_id, i) => ({
      roster_id: i + 1,
      owner_id,
      settings: {},
    })),
    bracket: [],
    players: {},
    weeks: scores.map((week) =>
      week.map((points, i) => ({
        roster_id: i + 1,
        matchup_id: Math.floor(i / 2) + 1,
        points,
      })),
    ),
    ...overrides,
  };
}

function row(d, uid, label) {
  const result = d.saber.find(
    (r) => r.uid === uid && (!label || r.season === label),
  );
  assert.ok(result, `Missing sabermetrics for ${uid} ${label || ""}`);
  return result;
}

function lineupSeason() {
  const s = season([[8, 10]]);
  s.league.roster_positions = ["QB", "BN"];
  s.players = {
    aStart: { name: "A starter", pos: "QB" },
    aBench: { name: "A bench", pos: "QB" },
    bStart: { name: "B starter", pos: "QB" },
    bBench: { name: "B bench", pos: "QB" },
  };
  Object.assign(s.weeks[0][0], {
    players: ["aStart", "aBench"],
    starters: ["aStart"],
    players_points: { aStart: 8, aBench: 14 },
  });
  Object.assign(s.weeks[0][1], {
    players: ["bStart", "bBench"],
    starters: ["bStart"],
    players_points: { bStart: 10, bBench: 7 },
  });
  return s;
}

test("Scoring+, PALA, and schedule-neutral wins use weekly league baselines", () => {
  const d = analyze([
    season([
      [100, 80, 80, 20],
      [50, 50, 20, 100],
    ]),
  ]);
  const a = row(d, "a");
  assert.equal(a.played, 2);
  assert.equal(a.points, 150);
  assert.equal(a.baseline, 125);
  assert.equal(a.pala, 25);
  close(a.scoringPlus, 120);
  close(a.xw, 1.5);
  close(a.actual, 1.5);
  close(
    d.saber.reduce((sum, r) => sum + r.pala, 0),
    0,
  );
  close(
    d.saber.reduce((sum, r) => sum + r.xw, 0),
    4,
  );
  close(
    d.saber.reduce((sum, r) => sum + r.actual, 0),
    4,
  );
  assert.equal(a.lineupRegret, null);
  assert.equal(a.lineupEfficiency, null);
  assert.equal(a.regretWeeks, 0);

  const leagueAverage = row(analyze([season([[100, 100, 80, 120]])]), "a");
  close(leagueAverage.scoringPlus, 100);
  close(leagueAverage.pala, 0);
});

test("dominance, boom/bust, and volatility use each week's population standard deviation", () => {
  const a = row(
    analyze([
      season([
        [100, 80, 80, 20],
        [50, 50, 20, 100],
      ]),
    ]),
    "a",
  );
  const sd1 = 30;
  const sd2 = Math.sqrt((25 + 25 + 1225 + 2025) / 4);
  const z1 = 1;
  const z2 = -5 / sd2;
  close(a.weekly[0].z, z1);
  close(a.weekly[1].z, z2);
  close(a.dominance, (20 / sd1 + 0 / sd2) / 2);
  close(a.volatility, Math.abs(z1 - z2) / 2);
  assert.equal(a.boom, 1);
  assert.equal(a.bust, 0);
  assert.equal(row(analyze([season([[100, 80, 80, 20]])]), "d").bust, 1);
});

test("equal scores yield neutral expected wins and finite zero spread metrics", () => {
  const d = analyze([season([[42, 42, 42, 42]])]);
  for (const r of d.saber) {
    close(r.scoringPlus, 100);
    close(r.pala, 0);
    close(r.xw, 0.5);
    close(r.actual, 0.5);
    assert.equal(r.weekly[0].z, 0);
    assert.equal(r.dominance, 0);
    assert.equal(r.volatility, 0);
    assert.equal(r.boom, 0);
    assert.equal(r.bust, 0);
  }
});

test("career Scoring+ weights weekly baselines rather than averaging season indices", () => {
  const first = season([[120, 80]], { src: "ESPN" });
  first.league.season = "2024";
  const second = season([[60, 40]]);
  const d = analyze([first, second]);
  const a = d.saberCareer.find((r) => r.uid === "a");
  assert.ok(a);
  assert.equal(a.seasons, 2);
  assert.equal(a.played, 2);
  assert.equal(a.points, 180);
  assert.equal(a.baseline, 150);
  assert.equal(a.pala, 30);
  close(a.scoringPlus, 120);
  assert.deepEqual(
    a.weekly.map((w) => w.season),
    ["2024 (ESPN)", "2026 (Sleeper)"],
  );
  assert.deepEqual(
    a.weekly.map((w) => w.src),
    ["ESPN", "Sleeper"],
  );
  close(a.weekly[0].z, a.weekly[1].z);

  second.weeks[0][0].points = 100;
  const unequal = analyze([first, second]);
  const career = unequal.saberCareer.find((r) => r.uid === "a");
  close(career.scoringPlus, (100 * 220) / 170);
  assert.notEqual(career.scoringPlus, (120 + (100 * 100) / 70) / 2);
});

test("future weeks, playoffs, and unmatched roster scores cannot inflate sabermetrics", () => {
  const s = season([
    [100, 80, 80, 20],
    [50, 50, 20, 100],
    [999, 1, 1, 1],
    [999, 1, 1, 1],
  ]);
  s.league.status = "complete";
  s.league.settings = { last_scored_leg: 3, playoff_week_start: 3 };
  s.weeks[0].push({ roster_id: 77, matchup_id: null, points: 100000 });
  const d = analyze([s]);
  const a = row(d, "a");
  assert.equal(a.played, 2);
  assert.equal(a.points, 150);
  assert.equal(a.baseline, 125);
  assert.deepEqual(
    a.weekly.map((w) => w.week),
    [1, 2],
  );
  assert.equal(a.actual, 1.5);
  assert.ok(d.weeks.some((w) => w.postseason));
  assert.ok(!d.weeks.some((w) => w.week === 4));
});

test("lineup optimizer assigns restrictive and FLEX slots jointly and excludes bench slots", () => {
  const s = season([[10, 1]]);
  s.league.roster_positions = ["RB", "FLEX", "BN", "IR"];
  s.players = {
    low: { name: "Low RB", pos: "RB" },
    high: { name: "High RB", pos: "RB" },
    receiver: { name: "Receiver", pos: "WR" },
  };
  const m = {
    points: 10,
    players: ["low", "high", "receiver"],
    starters: ["low", "receiver"],
    players_points: { low: 1, high: 10, receiver: 9 },
  };
  const optimized = optimizeLineup(m, s);
  assert.ok(optimized);
  assert.equal(optimized.actual, 10);
  assert.equal(optimized.optimum, 19);
  assert.equal(optimized.regret, 9);
  assert.deepEqual(new Set(optimized.starters), new Set(["high", "receiver"]));

  m.starters = ["high", "receiver"];
  m.points = 19;
  assert.equal(optimizeLineup(m, s).regret, 0);
  m.starters = ["receiver", "receiver"];
  m.points = 18;
  assert.equal(optimizeLineup(m, s), null);
});

test("SUPER_FLEX permits quarterbacks while ordinary FLEX does not", () => {
  const s = season([[5, 1]]);
  s.league.roster_positions = ["FLEX"];
  s.players = {
    rb: { name: "Runner", pos: "RB" },
    qb: { name: "Quarterback", pos: "QB" },
  };
  const m = {
    points: 5,
    players: ["rb", "qb"],
    starters: ["rb"],
    players_points: { rb: 5, qb: 20 },
  };
  assert.equal(optimizeLineup(m, s).optimum, 5);
  s.league.roster_positions = ["SUPER_FLEX"];
  assert.equal(optimizeLineup(m, s).optimum, 20);
});

test("ESPN slot counts preserve lineup limits and reserve players remain ineligible", () => {
  const s = season([[23, 1]]);
  s.league.settings.lineup_slots = { 0: 1, 23: 1, 20: 3, 21: 1 };
  s.players = {
    qb: { name: "Quarterback", pos: "QB" },
    rb: { name: "Runner", pos: "RB" },
    wr: { name: "Receiver", pos: "WR" },
    reserve: { name: "Reserved player", pos: "TE" },
  };
  const m = {
    points: 23,
    players: ["qb", "rb", "wr", "reserve"],
    reserve: ["reserve"],
    starters: ["qb", "rb"],
    players_points: { qb: 15, rb: 8, wr: 9, reserve: 50 },
  };
  assert.equal(optimizeLineup(m, s).optimum, 24);
  assert.equal(optimizeLineup({ ...m, reserve: [] }, s).optimum, 65);
  assert.equal(
    optimizeLineup({ ...m, starters: ["qb", "reserve"], points: 65 }, s),
    null,
  );
  s.league.settings.lineup_slots[0] = 1.5;
  assert.equal(optimizeLineup(m, s), null);
});

test("missing or inconsistent lineup data stays unknown; confirmed zero is a real result", () => {
  const s = lineupSeason();
  const original = s.weeks[0][0];
  assert.equal(
    optimizeLineup({ ...original, players_points: undefined }, s),
    null,
  );
  assert.equal(
    optimizeLineup({ ...original, players_points: { aStart: 8 } }, s),
    null,
  );
  assert.equal(optimizeLineup({ ...original, points: 1000 }, s), null);
  const unknown = { ...s, players: { aStart: s.players.aStart } };
  assert.equal(optimizeLineup(original, unknown), null);
  const zero = {
    ...original,
    points: 0,
    players_points: { aStart: 0, aBench: 0 },
  };
  const optimized = optimizeLineup(zero, s);
  assert.ok(optimized);
  assert.equal(optimized.optimum, 0);
  assert.equal(optimized.actual, 0);
  assert.equal(optimized.regret, 0);
  const negative = {
    ...original,
    points: -3,
    players_points: { aStart: -3, aBench: -7 },
  };
  assert.equal(optimizeLineup(negative, s).optimum, 0);

  // ESPN can supply empty eligibility arrays alongside a valid base position.
  for (const player of Object.values(s.players)) {
    player.position = player.pos;
    delete player.pos;
    player.fantasy_positions = [];
    player.positions = [];
  }
  assert.equal(optimizeLineup(original, s).optimum, 14);
  s.league.roster_positions = ["DEF", "BN"];
  Object.values(s.players).forEach((player) => (player.position = "D/ST"));
  assert.equal(optimizeLineup(original, s).optimum, 14);
});

test("lineup regret identifies hindsight result changes and reports incomplete coverage", () => {
  const s = lineupSeason();
  const d = analyze([s]);
  const a = row(d, "a");
  assert.equal(a.lineupRegret, 6);
  assert.equal(a.regretWeeks, 1);
  assert.equal(a.regretFlips, 1);
  close(a.lineupEfficiency, 8 / 14);
  assert.equal(a.weekly[0].regret, 6);
  assert.equal(a.weekly[0].flipped, true);
  assert.equal(row(d, "b").lineupRegret, 0);

  s.weeks.push([
    { roster_id: 1, matchup_id: 1, points: 11 },
    { roster_id: 2, matchup_id: 1, points: 12 },
  ]);
  s.league.settings.last_scored_leg = 2;
  const partial = row(analyze([s]), "a");
  assert.equal(partial.played, 2);
  assert.equal(partial.regretWeeks, 1);
  assert.equal(partial.lineupRegret, null);
  assert.equal(partial.lineupEfficiency, null);
  assert.equal(partial.weekly[0].regret, 6);
  assert.equal(partial.weekly[1].regret, null);
});

test("real snapshot regular-season totals agree with all-play and preserve platform separation", () => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync("league-data.js", "utf8"), ctx);
  const seasons = ctx.window.LEAGUE_SNAPSHOT;
  const d = analyze(seasons);
  assert.ok(d.saber.some((r) => r.src === "ESPN"));
  assert.ok(d.saber.some((r) => r.src === "Sleeper"));
  for (const s of seasons) {
    const label = `${s.league.season} (${s.src})`;
    const cutoff =
      s.league.settings?.last_scored_leg ??
      (s.league.status === "complete" ? 18 : 0);
    const rows = d.saber.filter((r) => r.season === label);
    close(
      rows.reduce((sum, r) => sum + r.pala, 0),
      0,
      `${label} PALA conservation`,
    );
    close(
      rows.reduce((sum, r) => sum + r.xw - r.actual, 0),
      0,
      `${label} expected-win conservation`,
    );
    for (const r of rows) {
      assert.ok(
        r.weekly.every((w) => w.week < s.league.settings.playoff_week_start),
      );
      assert.ok(r.weekly.every((w) => w.week <= cutoff));
      assert.ok(Number.isFinite(r.scoringPlus));
      assert.ok(Number.isFinite(r.dominance));
      assert.ok(r.regretWeeks <= r.played);
      if (r.regretWeeks < r.played) assert.equal(r.lineupRegret, null);
      if (r.lineupRegret !== null) assert.ok(r.lineupRegret >= 0);
    }
  }
  for (const career of d.saberCareer) {
    close(career.xw, d.all[career.uid].expected);
    close(career.actual, d.all[career.uid].actual);
    assert.equal(career.played, d.all[career.uid].played);
  }
});
