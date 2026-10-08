const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze } = require("../trade-analysis.js");

function fixture() {
  const weeks = Array.from({ length: 6 }, (_, i) => [1, 2, 3, 4].map((rid) => ({
    roster_id: rid, matchup_id: rid <= 2 ? 1 : 2,
    points: [100 + i, 90 + i, 80 + i, 70 + i][rid - 1],
    players: ["a", "b", "c", "d", "e"],
    starters: ["a", "b", "c", "d"][rid - 1].split(),
    players_points: { a: 10 + i, b: 20 + i, c: 30 + i, d: 40 + i, e: 5 + i },
  })));
  return {
    src: "Sleeper", league: { season: "2025", status: "complete", settings: { last_scored_leg: 6, playoff_week_start: 5 } },
    users: [1, 2, 3, 4].map((id) => ({ user_id: `u${id}`, display_name: `Manager ${id}` })),
    rosters: [1, 2, 3, 4].map((id) => ({ roster_id: id, owner_id: `u${id}` })),
    players: { a: { name: "Alpha" }, b: { name: "Beta" }, c: { name: "Charlie" }, d: { name: "Delta" }, e: { name: "Echo" } },
    weeks,
    transactions: [{ transaction_id: "trade", status: "complete", type: "trade", leg: 2, status_updated: 100,
      adds: { a: 1, b: 2 }, drops: { a: 2, b: 1 }, draft_picks: [], waiver_budget: [] }],
  };
}

const trade = (season) => analyze([season]).trades.find((row) => row.id === "trade");
const participant = (row, uid) => row.participants.find((team) => team.uid === uid);

test("compares post-trade packages and each team's actual regular season, excluding the transfer week", () => {
  const result = trade(fixture());
  const a = participant(result, "u1"), b = participant(result, "u2");
  assert.equal(a.receivedPoints, 12 + 13 + 14 + 15);
  assert.equal(b.receivedPoints, 22 + 23 + 24 + 25);
  assert.equal(a.givenPoints, b.receivedPoints);
  assert.equal(a.receivedRegularPoints, 25);
  assert.equal(a.receivedPostseasonPoints, 29);
  assert.equal(a.before.games, 1);
  assert.equal(a.before.ppg, 100);
  assert.equal(a.after.games, 2);
  assert.equal(a.after.w, 2);
  assert.equal(a.after.ppg, 102.5);
  assert.equal(a.after.xW, 2);
  assert.equal(a.postseason.games, 2);
  assert.equal(a.after.scoringPlus, 100 * 205 / 175);
  assert.equal(result.balance.score, 100 * (1 - 40 / 148));
  assert.equal(result.balance.leaderUid, "u2");
});

test("a later sale or waiver stops credit, and transfer weeks and reacquisitions are excluded", () => {
  const season = fixture();
  season.transactions.push({ transaction_id: "sale", type: "trade", status: "complete", leg: 4, status_updated: 200,
    adds: { a: 3, c: 1 }, drops: { a: 1, c: 3 } });
  season.transactions.push({ transaction_id: "return", type: "trade", status: "complete", leg: 5, status_updated: 300,
    adds: { a: 1, e: 3 }, drops: { a: 3, e: 1 } });
  const a = participant(trade(season), "u1").received[0];
  assert.equal(a.pts, 12);
  assert.equal(a.exitWeek, 4);
  assert.equal(a.exitReason, "next_transfer");
  assert.deepEqual(a.weekly.map((row) => row.week), [3]);
});

test("missing player scores or lineups remain unknown rather than becoming zero", () => {
  const season = fixture();
  delete season.weeks[2][0].players_points.a;
  delete season.weeks[4][0].starters;
  const result = trade(season), a = participant(result, "u1");
  assert.equal(a.receivedPoints, null);
  assert.equal(a.received[0].missingWeeks, 2);
  assert.equal(a.received[0].starts, null, "an absent lineup is not reported as zero starts");
  assert.equal(a.received[0].observedStarts, 3);
  assert.equal(a.received[0].scoredStarts, 2);
  assert.equal(a.received[0].observedPoints, 13 + 15);
  assert.equal(result.balance.comparable, false);
  assert.match(result.balance.reason, /unavailable/);
  assert.equal(a.after.ppg, 102.5, "team scores are independent of missing player scores");
});

test("future and unaccepted trades are excluded, and current transfer week has no invented outcomes", () => {
  const season = fixture();
  season.league.settings.last_scored_leg = 2;
  season.transactions.push({ ...season.transactions[0], transaction_id: "future", leg: 3 });
  season.transactions.push({ ...season.transactions[0], transaction_id: "pending", status: "pending" });
  const result = analyze([season]);
  assert.equal(result.trades.length, 1);
  assert.equal(result.coverage.excludedFuture, 1);
  assert.equal(result.coverage.excludedPending, 1);
  assert.equal(participant(result.trades[0], "u1").receivedPoints, null);
  assert.equal(result.trades[0].balance.score, null);
});

test("incomplete and non-player trades show assets without grading unavailable value", () => {
  const season = fixture();
  season.transactions[0].details_incomplete = true;
  season.transactions[0].draft_picks = [{ season: "2026", round: 2, roster_id: 4, previous_owner_id: 2, owner_id: 1 }];
  season.transactions[0].waiver_budget = [{ sender: 1, receiver: 2, amount: 20 }];
  const result = trade(season);
  assert.equal(result.detailsIncomplete, true);
  assert.equal(result.balance.comparable, false);
  assert.equal(result.excludesNonPlayerAssets, true);
  assert.equal(participant(result, "u1").picksReceived.length, 1);
  assert.equal(participant(result, "u2").budgetReceived[0].amount, 20);
  delete season.transactions[0].details_incomplete;
  season.transactions[0].adds = {}; season.transactions[0].drops = {};
  assert.match(trade(season).balance.reason, /No player assets/);
});

test("supports multi-team packages, multiple received players, picks, and FAAB participants", () => {
  const season = fixture();
  season.transactions[0].adds = { a: 1, e: 1, b: 2, c: 3 };
  season.transactions[0].drops = { a: 3, e: 2, b: 1, c: 2 };
  season.weeks.forEach((week) => { week[0].starters.push("e"); });
  season.transactions[0].waiver_budget = [{ sender: 4, receiver: 2, amount: 10 }];
  const result = trade(season);
  assert.equal(result.participants.length, 4);
  assert.equal(participant(result, "u1").received.length, 2);
  assert.equal(participant(result, "u1").receivedPoints, 54 + 34);
  assert.equal(participant(result, "u4").receivedPoints, 0);
  assert.equal(result.balance.comparable, true);
});

test("completed timestamps correct a stale proposal leg, with explicit week boundaries taking priority", () => {
  const season = fixture();
  season.transactions[0].leg = 1;
  season.transactions[0].status_updated = Date.parse("2025-09-17T12:00:00Z");
  let result = trade(season);
  assert.equal(result.week, 3);
  assert.equal(result.reportedWeek, 1);
  assert.equal(result.timingMethod, "calendar_estimate");
  assert.match(result.coverage.timingNote, /estimated/);
  assert.deepEqual(participant(result, "u1").after.weekly.map((row) => row.week), [4]);
  season.weekDates = [{ week: 1, start: "2025-09-05T04:00:00Z" }, { week: 2, start: "2025-09-12T04:00:00Z" }, { week: 3, start: "2025-09-19T04:00:00Z" }];
  result = trade(season);
  assert.equal(result.week, 2);
  assert.equal(result.timingMethod, "completion_date");
});

test("preseason trades include week one and Eastern Tuesday boundaries are observed", () => {
  const season = fixture();
  season.transactions[0].status_updated = Date.parse("2025-08-20T12:00:00Z");
  assert.equal(trade(season).week, 0);
  assert.equal(participant(trade(season), "u1").after.firstWeek, 1);
  season.transactions[0].status_updated = Date.parse("2025-09-09T02:00:00Z"); // Monday in New York.
  assert.equal(trade(season).week, 1);
  season.transactions[0].status_updated = Date.parse("2025-09-09T06:00:00Z");
  assert.equal(trade(season).week, 2);
});

test("real zero points differ from missing data, with no false equal-trade grade", () => {
  const season = fixture();
  season.weeks.forEach((week) => week.forEach((m) => { m.points = 0; Object.keys(m.players_points).forEach((pid) => { m.players_points[pid] = 0; }); }));
  const result = trade(season);
  assert.equal(participant(result, "u1").receivedPoints, 0);
  assert.equal(participant(result, "u1").after.games, 2);
  assert.equal(participant(result, "u1").after.xW, 1);
  assert.equal(result.balance.score, null);
  assert.equal(result.balance.gap, 0);
});

test("confirmed postseason byes do not produce points, while missing scored opponents are unknown", () => {
  const season = fixture();
  season.weeks[4][0].matchup_id = null;
  season.weeks[4][1].matchup_id = null;
  let result = trade(season), a = participant(result, "u1");
  assert.equal(a.receivedPoints, 12 + 13 + 15);
  assert.equal(a.postseason.games, 1);
  assert.equal(a.received[0].byeWeeks, 1);
  season.weeks[3][1].points = null;
  result = trade(season); a = participant(result, "u1");
  assert.equal(a.receivedPoints, null);
  assert.equal(a.after.games, 1);
  assert.equal(a.after.missingWeeks, 1);
});

test("a missing transfer feed is bounded by the first observed roster absence", () => {
  const season = fixture();
  season.weeks[3][0].players = season.weeks[3][0].players.filter((pid) => pid !== "a");
  const a = participant(trade(season), "u1").received[0];
  assert.equal(a.pts, 12);
  assert.equal(a.exitWeek, 4);
  assert.equal(a.exitReason, "absent_from_roster");
});

test("partial league scores preserve known head-to-head results while withholding all-play benchmarks", () => {
  const season = fixture();
  season.weeks[2][2].points = null;
  const a = participant(trade(season), "u1");
  assert.equal(a.after.games, 2);
  assert.equal(a.after.w, 2);
  assert.equal(a.after.ppg, 102.5);
  assert.equal(a.after.xW, null);
  assert.equal(a.after.scoringPlus, null);
  assert.equal(a.receivedPoints, 54, "the other scored pair still has known player contributions");
});

test("complete seasons stop at the last scored pair, not a trailing empty reserved week", () => {
  const season = fixture();
  delete season.league.settings.last_scored_leg;
  season.weeks.push([]);
  const result = trade(season);
  assert.equal(result.cutoff, 6);
  assert.equal(participant(result, "u1").receivedPoints, 54);
  assert.equal(participant(result, "u1").postseason.missingWeeks, 0);
});

test("interior missing weeks stay unknown and an explicit completed-week cutoff is authoritative", () => {
  const season = fixture();
  delete season.league.settings.last_scored_leg;
  season.weeks[3] = [];
  season.weeks.push([]);
  let result = trade(season);
  assert.equal(result.cutoff, 6);
  assert.equal(participant(result, "u1").receivedPoints, null);
  assert.equal(participant(result, "u1").after.missingWeeks, 1);
  season.league.settings.last_scored_leg = 7;
  result = trade(season);
  assert.equal(result.cutoff, 7);
  assert.equal(participant(result, "u1").postseason.missingWeeks, 1);
});

test("paired zero-score final weeks remain observed when deriving the season cutoff", () => {
  const season = fixture();
  delete season.league.settings.last_scored_leg;
  season.weeks[5].forEach((m) => { m.points = 0; });
  season.weeks.push([]);
  const result = trade(season);
  assert.equal(result.cutoff, 6);
  assert.equal(participant(result, "u1").postseason.games, 2);
});

test("confirmed ESPN roster cuts are displayed separately from traded packages", () => {
  const season = fixture(); season.src = "ESPN";
  season.transactions[0].drops.e = 1;
  season.transactions[0].roster_cuts = { e: 1 };
  let result = trade(season);
  assert.equal(result.detailsIncomplete, false);
  assert.equal(result.balance.comparable, true);
  assert.equal(participant(result, "u1").given.length, 1);
  assert.deepEqual(result.rosterCuts.map((a) => [a.player, a.uid, a.inferred]), [["Echo", "u1", false]]);
  delete season.transactions[0].roster_cuts;
  result = trade(season);
  assert.equal(result.detailsIncomplete, false);
  assert.equal(result.rosterCuts[0].inferred, true);
  assert.match(result.warnings.join(" "), /legacy ESPN/);
  season.src = "Sleeper";
  assert.equal(trade(season).detailsIncomplete, true, "unexplained Sleeper drops do not get the ESPN inference");
  season.src = "ESPN";
  season.transactions[0].roster_cuts = {};
  assert.equal(trade(season).detailsIncomplete, true, "new ESPN metadata must explicitly identify cuts");
});
