const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm");
const { analyze } = require("../league-stats");
function season(status = "in_season") {
  // bench lands on roster 1 only: rostered every counted week, never started.
  const week = (pts, bench = []) =>
    pts.map((points, i) => ({
      roster_id: i + 1,
      matchup_id: Math.floor(i / 2) + 1,
      points,
      players: i === 0 ? ["p", ...bench] : ["p"],
      starters: ["p"],
      players_points:
        i === 0
          ? { p: points, ...Object.fromEntries(bench.map((b) => [b, 0])) }
          : { p: points },
    }));
  return {
    src: "Sleeper",
    league: {
      season: "2026",
      status,
      settings: { playoff_week_start: 3, last_scored_leg: 2 },
    },
    users: ["a", "b", "c", "d"].map((user_id) => ({
      user_id,
      display_name: user_id,
    })),
    rosters: ["a", "b", "c", "d"].map((owner_id, i) => ({
      roster_id: i + 1,
      owner_id,
      settings: { wins: 1, losses: 1 },
    })),
    bracket: [{ p: 1, w: 1, l: 2 }],
    weeks: [
      week([100, 80, 80, 20], ["bench"]),
      week([50, 50, 20, 100], ["bench"]),
      week([999, 0, 0, 0]),
    ],
    // Round 1 stays a single pick so its baselines equal that pick's own values.
    picks: [
      { player_id: "p", roster_id: 1, pick_no: 1, round: 1 },
      { player_id: "bench", roster_id: 1, pick_no: 2, round: 2 },
      { player_id: "ghost", roster_id: 1, pick_no: 3, round: 2 },
    ],
    transactions: [
      {
        transaction_id: "one",
        status: "complete",
        type: "waiver",
        leg: 1,
        status_updated: 1,
        adds: { p: 1 },
      },
      {
        transaction_id: "drop",
        status: "complete",
        type: "free_agent",
        leg: 2,
        status_updated: 2,
        drops: { p: 1 },
      },
      {
        transaction_id: "pending",
        status: "pending",
        type: "trade",
        leg: 1,
        adds: { p: 1 },
      },
    ],
  };
}
test("all-play ties, luck conservation, and future/playoff exclusion", () => {
  const d = analyze([season()]);
  assert.equal(d.weeks.length, 2);
  assert.equal(d.scores.length, 8);
  assert.equal(d.all.a.actual, 1.5);
  assert.equal(d.all.a.expected, 1 + 0.5);
  assert.equal(d.all.a.bestStreak, 1);
  assert.deepEqual(d.h2h.a.b, [1, 0, 1]);
  assert.equal(d.all.a.titles, 0);
  assert.equal(d.all.a.po, 0);
  assert.ok(
    Math.abs(
      Object.values(d.all).reduce((n, a) => n + a.actual - a.expected, 0),
    ) < 1e-9,
  );
  assert.equal(d.weeks[0].games[0].upset, 0);
});
test("draft contribution and acquisition exclude future and acquisition-week points", () => {
  const d = analyze([season()]);
  assert.equal(d.drafts[0].pts, 150);
  assert.equal(d.drafts[0].starts, 2);
  assert.equal(d.drafts[0].scoredStarts, 2);
  assert.equal(d.drafts[0].rostered, 2);
  assert.equal(d.drafts[0].ptsPerStart, 75);
  // The only round-1 pick, so each baseline equals its own value.
  assert.equal(d.drafts[0].roundMean, 150);
  assert.equal(d.drafts[0].roundPerStart, 75);
  assert.equal(d.drafts[0].value, 0);
  assert.equal(d.drafts[0].valuePerStart, 0);
  assert.equal(d.moves.length, 2);
  assert.equal(d.moves[0].adds[0].pts, 50);
});
test("picks never started are separated from picks never rostered", () => {
  const d = analyze([season()]);
  const bench = d.drafts.find((p) => p.player === "bench"),
    ghost = d.drafts.find((p) => p.player === "ghost");
  // Rostered but benched all season: zero starter points is a fact, not a gap.
  assert.deepEqual(
    [bench.starts, bench.rostered, bench.pts, bench.ptsPerStart],
    [0, 2, 0, null],
  );
  // Never on the drafting roster in any counted week.
  assert.deepEqual(
    [ghost.starts, ghost.rostered, ghost.pts, ghost.ptsPerStart],
    [0, 0, 0, null],
  );
  // No round-2 pick ever started, so the rate baseline has nothing to average.
  assert.equal(bench.roundPerStart, null);
  assert.equal(bench.valuePerStart, null);
  assert.equal(ghost.valuePerStart, null);
  // The total baseline still exists, so value stays available.
  assert.equal(bench.roundMean, 0);
  assert.equal(bench.value, 0);
});
test("an unscored start stays countable while starter points become unavailable", () => {
  const row = (roster_id, points, players_points) => ({
    roster_id,
    matchup_id: 1,
    points,
    players: ["p"],
    starters: ["p"],
    players_points,
  });
  const d = analyze([
    {
      src: "Sleeper",
      league: {
        season: "2030",
        status: "complete",
        settings: { playoff_week_start: 3, last_scored_leg: 2 },
      },
      users: [
        { user_id: "a", display_name: "a" },
        { user_id: "b", display_name: "b" },
      ],
      rosters: [
        { roster_id: 1, owner_id: "a", settings: {} },
        { roster_id: 2, owner_id: "b", settings: {} },
      ],
      bracket: [],
      weeks: [
        // Week 1: the lineup is known but roster 1's player score is not.
        [row(1, 100, {}), row(2, 80, { p: 80 })],
        [row(1, 60, { p: 60 }), row(2, 50, { p: 50 })],
      ],
      picks: [{ player_id: "p", roster_id: 1, pick_no: 1, round: 1 }],
      transactions: [],
    },
  ]);
  const pick = d.drafts[0];
  assert.equal(pick.starts, 2, "both starts stay countable");
  assert.equal(pick.scoredStarts, 1, "only one start had a score");
  assert.equal(pick.rostered, 2);
  assert.equal(pick.pts, null, "an unscored start must not read as zero points");
  assert.equal(pick.ptsPerStart, null);
  assert.equal(pick.value, null);
  assert.equal(pick.valuePerStart, null);
});
test("completed championships and playoff head-to-head stay separate", () => {
  const s = season("complete");
  s.league.settings.last_scored_leg = 3;
  const d = analyze([s]);
  assert.equal(d.weeks.length, 3);
  assert.equal(d.weeks[2].postseason, true);
  assert.equal(d.weeks[2].changes.length, 0);
  assert.equal(d.all.a.titles, 1);
  assert.equal(d.all.b.finals, 1);
  assert.equal(d.all.a.po, 1);
  assert.deepEqual(d.playoffH2h.a.b, [1, 0, 0]);
  assert.deepEqual(d.h2h.a.b, [1, 0, 1]);
});
test("real snapshot preserves separate Kaushal/Winston and consistent platform totals", () => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync("league-data.js", "utf8"), ctx);
  const seasons = ctx.window.LEAGUE_SNAPSHOT;
  const d = analyze(seasons),
    kaushal = Object.keys(d.names).find((u) => d.names[u] === "Kaushal"),
    winston = Object.keys(d.names).find((u) => d.names[u] === "Winston");
  assert.ok(kaushal && winston && kaushal !== winston);
  assert.equal(d.all[kaushal].seasons, 1);
  assert.ok(d.all[winston].seasons >= 2);
  const sub = seasons.map((s) => analyze([s]));
  for (const [u, a] of Object.entries(d.all))
    for (const k of ["w", "l", "pf", "titles", "actual", "expected"])
      assert.ok(
        Math.abs(a[k] - sub.reduce((sum, x) => sum + (x.all[u]?.[k] || 0), 0)) <
          1e-8,
      );
  assert.ok(d.weeks.length >= 28);
  assert.ok(d.drafts.length > 300);
  const espnPicks = d.drafts.filter((p) => p.src === "ESPN");
  assert.equal(espnPicks.length, 192);
  assert.ok(
    espnPicks.every(
      (p) => Number.isFinite(p.pts) && Number.isFinite(p.starts) && Number.isFinite(p.value),
    ),
  );
  // Regression: a pick its drafter never started must never carry a rate, so it
  // can no longer top the disappointments board the way 2024 Saquon did.
  assert.ok(!d.drafts.some((p) => p.valuePerStart !== null && p.starts === 0));
  assert.ok(
    d.drafts.every((p) =>
      p.starts > 0 && p.pts !== null
        ? Math.abs(p.ptsPerStart - p.pts / p.starts) < 1e-9
        : p.ptsPerStart === null,
    ),
  );
  // Drafted, then gone before a single counted week: real, and not zero-rate.
  assert.ok(espnPicks.some((p) => p.starts === 0 && p.rostered === 0));
  const rateBoard = d.drafts
    .filter((p) => p.round <= 3 && p.starts >= 8 && p.valuePerStart !== null)
    .sort((a, b) => a.valuePerStart - b.valuePerStart);
  assert.ok(rateBoard.length >= 10);
  assert.ok(rateBoard.every((p) => p.starts >= 8 && p.pts !== null));
  assert.equal(espnPicks[0].player, "Christian McCaffrey");
  assert.equal(d.names[espnPicks[0].uid], "Abhi");
  assert.ok(d.moves.length > 600);
  for (const s of seasons.filter((s) =>
    Number.isInteger(s.league.settings?.last_scored_leg),
  ))
    assert.ok(
      d.weeks
        .filter((w) => w.season === `${s.league.season} (${s.src})`)
        .every((w) => w.week <= s.league.settings.last_scored_leg),
    );
  assert.ok(
    Math.abs(
      Object.values(d.all).reduce((sum, a) => sum + a.actual - a.expected, 0),
    ) < 1e-8,
  );
  const report = fs.readFileSync("report.html", "utf8");
  assert.ok(report.includes(fs.readFileSync("league-stats.js", "utf8")));
  assert.ok(report.includes(fs.readFileSync("league-ui.js", "utf8")));
});
function dropSeason() {
  // Two counted weeks of starts (W2, W3) so every positional baseline below is
  // an exact mean of four starts.
  const roster = (roster_id, matchup_id, pid, points) => ({
    roster_id,
    matchup_id,
    points,
    players: [pid],
    starters: [pid],
    players_points: { [pid]: points },
  });
  return {
    src: "Sleeper",
    league: {
      season: "2031",
      status: "complete",
      settings: { playoff_week_start: 4, last_scored_leg: 3 },
    },
    users: ["a", "b", "c", "d"].map((user_id) => ({
      user_id,
      display_name: user_id,
    })),
    rosters: ["a", "b", "c", "d"].map((owner_id, i) => ({
      roster_id: i + 1,
      owner_id,
      settings: {},
    })),
    bracket: [],
    // Fillers with no position keep the QB and K baselines clean.
    players: {
      star: { name: "Star", position: "QB" },
      kick: { name: "Kick", position: "K" },
      qb2: { name: "Qb2", position: "QB" },
      k2: { name: "K2", position: "K" },
      hold: { name: "Hold", position: "QB" },
      f0: { name: "F0" },
      f2: { name: "F2" },
      f3: { name: "F3" },
      f4: { name: "F4" },
    },
    weeks: [
      [
        roster(1, 1, "f0", 5),
        roster(2, 1, "f2", 7),
        roster(3, 2, "f3", 3),
        roster(4, 2, "f4", 4),
      ],
      [
        roster(1, 1, "qb2", 10),
        roster(2, 1, "star", 30),
        roster(3, 2, "k2", 2),
        roster(4, 2, "kick", 24),
      ],
      [
        roster(1, 1, "qb2", 10),
        roster(2, 1, "star", 30),
        roster(3, 2, "k2", 2),
        roster(4, 2, "kick", 24),
      ],
    ],
    picks: [],
    transactions: [
      // a drops a quarterback, b claims him.
      {
        transaction_id: "d-star",
        status: "complete",
        type: "free_agent",
        leg: 1,
        status_updated: 10,
        drops: { star: 1 },
      },
      {
        transaction_id: "c-star",
        status: "complete",
        type: "waiver",
        leg: 1,
        status_updated: 20,
        adds: { star: 2 },
      },
      // c drops a kicker, d claims him.
      {
        transaction_id: "d-kick",
        status: "complete",
        type: "free_agent",
        leg: 1,
        status_updated: 11,
        drops: { kick: 3 },
      },
      {
        transaction_id: "c-kick",
        status: "complete",
        type: "waiver",
        leg: 1,
        status_updated: 21,
        adds: { kick: 4 },
      },
      // Nobody claims this one, so it is not a drop anyone profited from.
      {
        transaction_id: "d-unwanted",
        status: "complete",
        type: "free_agent",
        leg: 1,
        status_updated: 12,
        drops: { f0: 1 },
      },
      // A trade is not a trip through waivers.
      {
        transaction_id: "t-hold",
        status: "complete",
        type: "trade",
        leg: 1,
        status_updated: 13,
        drops: { hold: 1 },
        adds: { hold: 2 },
      },
    ],
  };
}
test("drops are scored by what the player produced for whoever claimed him", () => {
  const d = analyze([dropSeason()]);
  // Only the two claimed, non-trade drops qualify.
  assert.deepEqual(
    d.drops.map((x) => x.player).sort(),
    ["Kick", "Star"],
  );
  const star = d.drops.find((x) => x.player === "Star");
  assert.equal(star.uid, "a", "the row belongs to the manager who dropped him");
  assert.equal(star.week, 1);
  assert.equal(star.pos, "QB");
  assert.deepEqual(star.claimants, ["b"]);
  assert.equal(star.claims, 1);
  assert.equal(star.claimedWeek, 1);
  assert.equal(star.reclaimedWeek, null);
  // Points begin the week after the claim, as they do for a pickup.
  assert.deepEqual([star.starts, star.scoredStarts, star.pts], [2, 2, 60]);
  assert.equal(star.ptsPerStart, 30);
  // QB starts: star 2x30 plus qb2 2x10 is 80 over 4 starts.
  assert.equal(star.posPerStart, 20);
  assert.equal(star.valuePerStart, 10);
});
test("the positional adjustment reorders drops that raw points per start mis-ranks", () => {
  const d = analyze([dropSeason()]);
  const star = d.drops.find((x) => x.player === "Star"),
    kick = d.drops.find((x) => x.player === "Kick");
  // K starts: kick 2x24 plus k2 2x2 is 52 over 4 starts.
  assert.equal(kick.posPerStart, 13);
  assert.equal(kick.ptsPerStart, 24);
  assert.equal(kick.valuePerStart, 11);
  assert.ok(
    kick.ptsPerStart < star.ptsPerStart,
    "the kicker scored less per start",
  );
  assert.ok(
    kick.valuePerStart > star.valuePerStart,
    "but more per start than a kicker start was worth",
  );
});
test("production after the dropper wins the player back is not held against the drop", () => {
  const s = dropSeason();
  // a drops the quarterback in week 1 and claims him back in week 2, so b's
  // week-2 start is the only one that counts against the drop.
  s.transactions.push({
    transaction_id: "r-star",
    status: "complete",
    type: "waiver",
    leg: 2,
    status_updated: 30,
    adds: { star: 1 },
  });
  const star = analyze([s]).drops.find((x) => x.player === "Star");
  assert.equal(star.reclaimedWeek, 2);
  assert.deepEqual([star.starts, star.pts, star.ptsPerStart], [1, 30, 30]);
});
