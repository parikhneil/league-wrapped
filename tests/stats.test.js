const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm");
const { analyze } = require("../league-stats");
function season(status = "in_season") {
  const week = (pts) =>
    pts.map((points, i) => ({
      roster_id: i + 1,
      matchup_id: Math.floor(i / 2) + 1,
      points,
      players: ["p"],
      starters: ["p"],
      players_points: { p: points },
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
      week([100, 80, 80, 20]),
      week([50, 50, 20, 100]),
      week([999, 0, 0, 0]),
    ],
    picks: [{ player_id: "p", roster_id: 1, pick_no: 1, round: 1 }],
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
  assert.equal(d.moves.length, 2);
  assert.equal(d.moves[0].adds[0].pts, 50);
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
