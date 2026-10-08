const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, fairAmerican } = require("../matchup-lines.js");

const NOW = Date.parse("2026-10-07T12:00:00Z");
const SETTINGS = { rec: 1, rush_yd: 0.1, pass_int: -2 };
function fixture() {
  const row = (rid, week) => ({ roster_id: rid, matchup_id: rid <= 2 ? 1 : 2,
    points: [30 + week, 10 + week, 20 + week, 15 + week][rid - 1],
    starters: [`p${rid}`], players_points: { [`p${rid}`]: [30 + week, 10 + week, 20 + week, 15 + week][rid - 1] } });
  const weeks = Array.from({ length: 8 }, (_, i) => [1, 2, 3, 4].map((rid) => row(rid, i)));
  return { league: { league_id: "123", season: "2026", roster_positions: ["RB", "BN"], scoring_settings: { ...SETTINGS }, settings: { last_scored_leg: 4, playoff_week_start: 8 } },
    users: [1, 2, 3, 4].map((id) => ({ user_id: `u${id}`, display_name: `Manager ${id}` })),
    rosters: [1, 2, 3, 4].map((id) => ({ roster_id: id, owner_id: `u${id}`, starters: [`p${id}`], players: [`p${id}`] })), weeks,
    history: [{ season: "2026", scoring_settings: { ...SETTINGS }, lastCompletedWeek: 4, weeks }],
    players: Object.fromEntries([1, 2, 3, 4].map((id) => [`p${id}`, { name: `Player ${id}`, position: "RB", team: "BUF" }])),
    schedule: [5, 6, 7].map((week) => ({ week, home: "BUF", away: "NYJ", kickoff: "2026-10-08T20:00:00Z" })),
    scheduleComplete: true, currentWeek: 5, asOf: "2026-10-07T12:00:00Z", playersUpdatedAt: "2026-10-07T11:00:00Z" };
}
const run = (data, extra = {}) => analyze(data, { samples: 1000, seed: "test", now: NOW, ...extra });
const first = (data, extra) => run(data, extra).weeks[0].matchups[0];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("deterministic probabilities, fair prices, and every two-way market are internally consistent", () => {
  const data = fixture(), a = run(data), b = run(data);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, run(data, { seed: "different" }));
  for (const week of a.weeks) for (const matchup of week.matchups) {
    close(matchup.teams[0].winProbability + matchup.teams[1].winProbability + matchup.tieProbability, 1);
    close(matchup.teams[0].moneylineProbability + matchup.teams[1].moneylineProbability, 1);
    const s = matchup.spread;
    close(s.homeCoverProbability + s.awayCoverProbability + s.pushProbability, 1);
    assert.equal(s.homeLine, -s.awayLine);
    for (const m of [matchup.total, ...matchup.alternates.totals, ...matchup.teams.map((t) => t.teamTotal), ...matchup.teams.flatMap((t) => t.players)])
      close(m.overProbability + m.underProbability + m.pushProbability, 1);
  }
  close(a.weeks[0].highestScorer.reduce((sum, team) => sum + team.probability, 0), 1);
  assert.equal(fairAmerican(0.5), 100);
  assert.equal(fairAmerican(0.75), -300);
  assert.equal(fairAmerican(0.25), 300);
  assert.equal(fairAmerican(0), null);
  assert.equal(fairAmerican(1), null);
});

test("favorite receives a negative spread and only confirmed regular-season weeks are forecast", () => {
  const result = run(fixture());
  assert.deepEqual(result.weeks.map((week) => week.week), [5, 6, 7]);
  const g = result.weeks[0].matchups[0];
  assert.ok(g.teams[0].projectedPoints > g.teams[1].projectedPoints);
  assert.ok(g.spread.homeLine < 0);
  assert.equal(g.spread.awayLine, -g.spread.homeLine);
  assert.equal(g.teams[0].fairMoneyline, fairAmerican(g.teams[0].winProbability + g.tieProbability / 2));
});

test("no-playoffs leagues retain completed history and forecasts through week 18", () => {
  const data = fixture();
  data.league.settings.playoff_week_start = 0;
  data.league.settings.last_scored_leg = 16;
  data.currentWeek = 17;
  data.weeks = Array.from({ length: 18 }, () => structuredClone(data.weeks[0]));
  data.history[0].weeks = data.weeks;
  data.history[0].lastCompletedWeek = 16;
  const result = run(data);
  assert.deepEqual(result.weeks.map((week) => week.week), [17, 18]);
  assert.equal(result.model.coverage.completedWeeks, 16);
  assert.equal(result.model.forecastThroughWeek, 18);
});

test("incompatible historical scoring, future scores, and duplicate blocks cannot contaminate observations", () => {
  const data = fixture();
  data.history.push({ ...data.history[0], season: "2025", scoring_settings: { ...SETTINGS, pass_int: -1 } });
  data.history.push(data.history[0]);
  data.history[0].lastCompletedWeek = 8;
  data.weeks[4].forEach((m) => { m.points = 10000; m.players_points = { p1: 10000, p2: 10000, p3: 10000, p4: 10000 }; });
  const result = run(data);
  assert.deepEqual(result.model.coverage.compatibleSeasons, ["2026"]);
  assert.equal(result.model.coverage.discardedSeasons[0].season, "2025");
  assert.equal(result.model.coverage.completedWeeks, 4);
  assert.equal(result.weeks[0].matchups[0].teams[0].players[0].observations, 4);
  assert.ok(result.weeks[0].matchups[0].teams[0].projectedPoints < 100);
  data.league.scoring_settings.unused_setting = 0;
  assert.equal(run(data).model.coverage.discardedSeasons.length, 1, "missing and zero-valued scoring settings are equivalent");
});

test("history requires completed paired games and still learns observed bench-player scoring", () => {
  const data = fixture();
  data.weeks[0][0].players_points.bench = 44;
  data.players.bench = { position: "RB", name: "Bench player", team: "BUF" };
  data.rosters[0].players = ["bench"];
  data.weeks[1][0].matchup_id = null;
  data.weeks[2][1].points = null;
  const g = first(data);
  assert.equal(g.teams[0].players[0].observations, 1);
  assert.equal(g.teams[1].players[0].observations, 2);
  assert.ok(g.teams[0].players[0].coverage.shrinkageWeight < 0.5);
});

test("verified NFL byes zero players and defense aliases, while an unverified or malformed schedule never does", () => {
  const data = fixture();
  data.players.p1.team = "KC";
  let g = first(data);
  assert.equal(g.teams[0].players[0].status, "bye");
  assert.equal(g.teams[0].projectedPoints, 0);
  data.scheduleComplete = false;
  assert.ok(first(data).teams[0].projectedPoints > 0);
  data.scheduleComplete = true;
  data.schedule[0].home = "UNKNOWN";
  assert.ok(first(data).teams[0].projectedPoints > 0);
  data.schedule[0].home = "LAR"; data.schedule[0].away = "BUF";
  data.league.roster_positions = ["DEF", "BN"];
  data.rosters[0].players = ["LA"];
  data.rosters[1].players = ["BUF"];
  data.players.LA = { name: "Rams", position: "DEF", team: "LA" };
  assert.notEqual(first(data).teams[0].players[0].status, "bye");
  data.schedule[0].home = "NYJ";
  assert.equal(first(data).teams[0].players[0].status, "bye");
});

test("OUT/IR is an explicit fresh cached assumption for this week, and does not persist into future weeks", () => {
  const data = fixture(); data.players.p1.injuryStatus = "Out";
  let result = run(data);
  assert.equal(result.weeks[0].matchups[0].teams[0].players[0].status, "out");
  assert.match(result.weeks[0].matchups[0].teams[0].players[0].reason, /assumed inactive.*not a confirmed/);
  assert.ok(result.weeks[1].matchups[0].teams[0].projectedPoints > 0);
  result = run(data, { now: NOW + 2 * 86400000 });
  assert.equal(result.model.coverage.currentInjuryMetadataFresh, false);
  assert.ok(result.weeks[0].matchups[0].teams[0].projectedPoints > 0);
  data.playersUpdatedAt = "2026-10-10T11:00:00Z";
  assert.ok(first(data).teams[0].projectedPoints > 0, "a future metadata timestamp is not trusted");
});

test("submitted starters and bench placement do not affect optimized forecasts", () => {
  const data = fixture();
  const before = run(data);
  data.weeks[5][0].starters = ["p2"];
  data.weeks[4][0].starters = [];
  data.rosters[0].starters = ["p4"];
  delete data.weeks[4][1].starters;
  const result = run(data);
  assert.deepEqual(result, before);
  assert.equal(result.weeks[1].matchups[0].teams[0].players[0].id, "p1");
  assert.equal(result.weeks[1].matchups[0].heldLineup, false);
  assert.equal(result.weeks[1].matchups[0].heldRoster, true);
  assert.equal(first(data).teams[0].coverage.lineupSource, "optimal_projected_roster");
});

test("full roster coverage is required and a player cannot fill two legal slots", () => {
  const data = fixture();
  delete data.rosters[0].players;
  assert.equal(first(data).available, false, "submitted starters do not substitute for a full roster");
  data.rosters[0].players = ["p1", "p1"];
  data.league.roster_positions = ["RB", "FLEX", "BN"];
  const g = first(data);
  assert.equal(g.available, false);
  assert.equal(g.teams[0].projectedPoints, null);
  assert.equal(g.teams[0].players.length, 0);
  assert.match(g.teams[0].coverage.warnings.join(" "), /cannot fill every legal starting slot/);
});

test("known eligible players without scoring history use a labeled prior, while unknown eligibility is unavailable", () => {
  const data = fixture(); data.rosters[0].players = ["unknown"];
  assert.equal(first(data).available, false);
  assert.match(first(data).teams[0].coverage.warnings.join(" "), /unknown legal position eligibility/);
  data.players.unknown = { name: "Known rookie", position: "RB", team: "BUF" };
  const p = first(data).teams[0].players[0];
  assert.equal(p.observations, 0);
  assert.equal(p.status, "prior_only");
  assert.equal(p.metadataKnown, true);
  assert.ok(p.mean > 0);
  assert.ok(p.p90 > p.p10);
  assert.match(p.reason, /No compatible player history/);
});

test("pushes, ties, and exact 0%/100% simulations do not produce infinite prices", () => {
  const data = fixture();
  for (const week of data.weeks) for (const m of week) { m.points = 10; m.players_points = { [`p${m.roster_id}`]: 10 }; }
  const g = first(data);
  assert.equal(g.tieProbability, 1);
  assert.equal(g.teams[0].winProbability, 0);
  assert.equal(g.teams[0].fairMoneyline, 100);
  assert.equal(g.total.pushProbability, 1);
  assert.equal(g.total.overOdds, null);
  assert.equal(g.total.underOdds, null);
  assert.equal(g.teams[0].players[0].pushProbability, 1);
  assert.ok(!JSON.stringify(g).includes("Infinity"));
});

test("missing/all-zero league scoring prevents unsupported fantasy point markets", () => {
  for (const scoring of [undefined, {}, { rec: 0, pass_td: 0 }]) {
    const data = fixture(); data.league.scoring_settings = scoring;
    const result = run(data);
    assert.equal(result.model.coverage.scoringVerified, false);
    assert.equal(result.weeks[0].matchups[0].available, false);
    assert.equal(result.weeks[0].matchups[0].spread, null);
    assert.equal(result.weeks[0].matchups[0].teams[0].projectedPoints, null);
  }
});

test("highest scorer stays league-wide after manager selection and explicitly flags incomplete coverage", () => {
  const data = fixture(), full = run(data), selected = run(data, { manager: "u1" });
  assert.equal(selected.weeks[0].matchups.length, 1);
  assert.deepEqual(selected.weeks[0].highestScorer, full.weeks[0].highestScorer);
  assert.equal(full.weeks[0].highestScorerComplete, true);
  data.rosters[0].players = [];
  const incomplete = run(data);
  assert.equal(incomplete.weeks[0].highestScorerComplete, false);
  assert.equal(incomplete.weeks[0].highestScorer.length, 2);
  assert.match(incomplete.weeks[0].highestScorerScope, /Among simulated scheduled teams/);
});

test("started weeks retain clearly labeled full-week baselines rather than live win probabilities", () => {
  const data = fixture(); data.schedule[0].kickoff = "2026-10-06T20:00:00Z";
  const result = run(data);
  assert.equal(result.weeks[0].started, true);
  assert.equal(result.weeks[0].fullWeekBaseline, true);
  assert.equal(result.weeks[0].matchups[0].available, true);
  assert.match(result.weeks[0].matchups[0].notes.join(" "), /no live accrued points/i);
});

function lineupFixture(slots, definitions, historicalStarters) {
  const data = fixture();
  data.league.roster_positions = [...slots, "BN"];
  data.players = {};
  data.rosters.forEach((roster, index) => {
    roster.players = Object.keys(definitions).map((id) => `${index}:${id}`);
    roster.starters = [];
    for (const [id, definition] of Object.entries(definitions))
      data.players[`${index}:${id}`] = { name: id, team: "BUF", ...definition, points: undefined };
  });
  for (let week = 0; week < data.weeks.length; week++)
    data.weeks[week].forEach((row, index) => {
      row.starters = historicalStarters.map((id) => `${index}:${id}`);
      row.players_points = Object.fromEntries(Object.entries(definitions).map(([id, definition]) =>
        [`${index}:${id}`, Array.isArray(definition.points) ? definition.points[week % definition.points.length] : definition.points]));
      row.points = row.starters.reduce((sum, id) => sum + row.players_points[id], 0);
    });
  return data;
}

test("global lineup assignment preserves scarce eligibility instead of taking the best player greedily", () => {
  const data = lineupFixture(["RB", "WR", "FLEX"], {
    dual: { position: "RB", fantasy_positions: ["RB", "WR"], points: 20 },
    rb: { position: "RB", points: 19 }, wr: { position: "WR", points: 18 }, te: { position: "TE", points: 30 },
  }, ["dual", "wr", "te"]);
  const team = first(data).teams[0];
  assert.deepEqual(team.players.map((p) => [p.slot, p.id]), [["RB", "0:rb"], ["WR", "0:dual"], ["FLEX", "0:te"]]);
  close(team.lineupExpectedPoints, team.players.reduce((sum, p) => sum + p.expectedPoints, 0));
  const choices = (extra) => first(data, extra).teams[0].players.map((p) => p.id);
  assert.deepEqual(choices({ samples: 100, seed: "different" }), choices({ samples: 10000, seed: "another" }),
    "analytic expected-point selection is independent of Monte Carlo draws");
  data.rosters.forEach((r) => r.players.reverse());
  assert.deepEqual(first(data).teams[0].players.map((p) => p.id), team.players.map((p) => p.id));
});

test("superflex, receiver flex, running-back/receiver flex, IDP and dual fantasy eligibility remain legal", () => {
  const data = lineupFixture(["QB", "SUPER_FLEX", "REC_FLEX", "WRRB_FLEX", "DL", "DB", "IDP_FLEX"], {
    qb: { position: "QB", points: 25 }, qb2: { position: "QB", points: 24 },
    rb: { position: "RB", points: 30 }, wr: { position: "WR", points: 20 }, te: { position: "TE", points: 35 },
    dual: { position: "LB", fantasy_positions: ["DL", "LB"], points: 25 },
    dl: { position: "DE", fantasy_positions: ["DL"], points: 24 },
    db: { position: "CB", fantasy_positions: ["DB"], points: 22 },
    lb: { position: "LB", fantasy_positions: ["LB"], points: 21 },
  }, ["qb", "qb2", "te", "rb", "dl", "db", "dual"]);
  const team = first(data).teams[0];
  assert.equal(team.players.length, 7);
  assert.equal(new Set(team.players.map((p) => p.id)).size, 7);
  const allowed = { QB: ["QB"], SUPER_FLEX: ["QB", "RB", "WR", "TE"], REC_FLEX: ["WR", "TE"],
    WRRB_FLEX: ["RB", "WR"], DL: ["DL"], DB: ["DB"], IDP_FLEX: ["DL", "LB", "DB"] };
  for (const player of team.players)
    assert.ok(player.fantasyPositions.some((p) => allowed[player.slot].includes(p)), `${player.id} is illegal in ${player.slot}`);
  assert.equal(team.players.find((p) => p.slot === "REC_FLEX").id, "0:te");
  assert.equal(team.players.find((p) => p.slot === "WRRB_FLEX").id, "0:rb");
  assert.equal(team.players.find((p) => p.slot === "QB").position, "QB");
});

test("byes and fresh unavailable tags choose legal bench replacements, and future weeks reoptimize", () => {
  const data = lineupFixture(["RB"], {
    lead: { position: "RB", points: 40, team: "KC" }, backup: { position: "RB", points: 15 },
  }, ["lead"]);
  assert.equal(first(data).teams[0].players[0].id, "0:backup");
  data.schedule[1] = { week: 6, home: "KC", away: "BUF" };
  assert.equal(run(data).weeks[1].matchups[0].teams[0].players[0].id, "0:lead");
  data.players["0:lead"].team = "BUF";
  data.players["0:lead"].injuryStatus = "OUT";
  assert.equal(first(data).teams[0].players[0].id, "0:backup");
  assert.equal(run(data).weeks[1].matchups[0].teams[0].players[0].id, "0:lead");
  assert.equal(first(data, { now: NOW + 2 * 86400000 }).teams[0].players[0].id, "0:lead");
});

test("reserve and taxi players are not automatically activated to optimize a lineup", () => {
  const data = lineupFixture(["RB"], {
    reserve: { position: "RB", points: 80 }, taxi: { position: "RB", points: 70 }, active: { position: "RB", points: 10 },
  }, ["active"]);
  data.rosters[0].reserve = ["0:reserve"];
  data.rosters[0].taxi = ["0:taxi"];
  assert.equal(first(data).teams[0].players[0].id, "0:active");
  data.rosters[0].players = ["0:reserve", "0:taxi"];
  assert.equal(first(data).available, false);
  assert.match(first(data).teams[0].coverage.warnings.join(" "), /Reserve\/taxi/);
});

test("one expected-optimal lineup is fixed before outcomes, rather than retrospectively choosing each draw", () => {
  const data = lineupFixture(["RB"], {
    steady: { position: "RB", points: [20, 20, 20, 20] },
    volatile: { position: "RB", points: [0, 38, 0, 38] },
  }, ["steady"]);
  const team = first(data).teams[0];
  assert.equal(team.players[0].id, "0:steady");
  close(team.projectedPoints, 20);
  assert.equal(team.p90, 20, "bench boom outcomes cannot be substituted after a simulation draw");
  assert.equal(team.players.length, 1);
});

test("best-ball scoring and unsupported legal slots cannot receive ordinary optimal-lineup prices", () => {
  const data = fixture();
  data.league.settings.best_ball = 1;
  assert.equal(first(data).available, false);
  assert.match(first(data).teams[0].coverage.warnings.join(" "), /Best-ball/);
  data.league.settings.best_ball = 0;
  data.league.roster_positions = ["UNKNOWN_SLOT"];
  assert.equal(first(data).available, false);
  assert.match(first(data).teams[0].coverage.warnings.join(" "), /UNKNOWN_SLOT/);
});
