const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { analyze, summarizePlayerStarts } = require("../league-stats");

function season({ src = "Sleeper", year = "2025", uid = "manager", players = {},
  weeks = null, cutoff = 1, playoff = 15, status = "in_season", starters = [] } = {}) {
  return {
    src,
    league: { season: year, status,
      settings: { last_scored_leg: cutoff, playoff_week_start: playoff } },
    users: [{ user_id: uid, display_name: uid }, { user_id: "opponent", display_name: "Opponent" }],
    rosters: [{ roster_id: 1, owner_id: uid, settings: {} },
      { roster_id: 2, owner_id: "opponent", settings: {} }],
    bracket: [], picks: [], transactions: [], players,
    weeks: weeks || [[
      { roster_id: 1, matchup_id: 1, points: 100, starters, players: starters,
        players_points: Object.fromEntries(starters.map((p) => [p, 10])) },
      { roster_id: 2, matchup_id: 1, points: 80, starters: [], players: [], players_points: {} },
    ]],
  };
}

test("the same NFL player and defense merge across ESPN and Sleeper", () => {
  const espn = season({ src: "ESPN", year: "2024", starters: ["espn:42", "espn:-16024"],
    players: {
      "espn:42": { name: "Player Old Name", position: "WR", gsis_id: "00-123", espn_id: "42" },
      "espn:-16024": { name: "Chargers D/ST", position: "D/ST" },
    } });
  const sleeper = season({ starters: ["p", "SD"], players: {
    p: { name: "Player New Name", position: "WR", gsis_id: "00-123" },
    SD: { name: "San Diego Chargers", position: "DEF", team: "SD" },
  } });
  const d = analyze([espn, sleeper]);
  const players = d.playerStarts.filter((p) => p.uid === "manager");
  assert.equal(players.length, 2);
  for (const p of players) {
    assert.equal(p.starts, 2);
    assert.equal(p.regularStarts, 2);
    assert.equal(p.postseasonStarts, 0);
    assert.equal(p.scoredStarts, 2);
    assert.equal(p.points, 20);
    assert.deepEqual(p.seasons, ["2024 (ESPN)", "2025 (Sleeper)"]);
    assert.equal(p.firstSeason, "2024 (ESPN)");
    assert.equal(p.lastSeason, "2025 (Sleeper)");
  }
  assert.ok(players.find((p) => p.playerKey === "def:LAC" && p.position === "DEF"));
  assert.ok(players.find((p) => p.playerKey === "gsis:00-123"));
});

test("explicit ESPN metadata fills missing GSIS only when its mapping is unambiguous", () => {
  const s1 = season({ src: "ESPN", year: "2024", starters: ["espn:42"],
    players: { "espn:42": { name: "Someone", position: "WR", gsis_id: "00-one" } } });
  const s2 = season({ starters: ["p"],
    players: { p: { name: "Someone Else", position: "WR", espn_id: "42" } } });
  const d = analyze([s1, s2]);
  assert.equal(d.playerStarts.find((p) => p.uid === "manager").starts, 2);
  const s3 = season({ year: "2026", starters: ["another"],
    players: { another: { name: "Different Person", position: "WR", gsis_id: "00-two", espn_id: "42" } } });
  const ambiguous = analyze([s1, s2, s3]).playerStarts.filter((p) => p.uid === "manager");
  assert.equal(ambiguous.length, 3);
  assert.ok(ambiguous.every((p) => p.starts === 1));
});

test("shared display names and replacement managers remain separate identities", () => {
  const kaushal = season({ src: "ESPN", year: "2024", uid: "kaushal", starters: ["espn:42", "espn:43"],
    players: {
      "espn:42": { name: "Same Name", position: "WR", gsis_id: "00-one" },
      "espn:43": { name: "Same Name", position: "WR", gsis_id: "00-two" },
    } });
  const winston = season({ uid: "winston", starters: ["42", "43"], players: {
    42: { name: "Same Name", position: "WR", gsis_id: "00-one" },
    43: { name: "Same Name", position: "WR", gsis_id: "00-two" },
  } });
  const d = analyze([kaushal, winston]);
  assert.equal(d.playerStarts.length, 4);
  assert.equal(d.playerStarts.filter((p) => p.uid === "kaushal").length, 2);
  assert.equal(d.playerStarts.filter((p) => p.uid === "winston").length, 2);
  const noIds = season({ starters: ["one", "two"], players: {
    one: { name: "Same Name", position: "WR" }, two: { name: "Same Name", position: "WR" },
  } });
  assert.equal(analyze([noIds]).playerStarts.length, 2);
});

test("zero and negative scorers count, duplicate starters and empty slots do not", () => {
  const s = season({ starters: ["zero", "zero", "negative", "missing", 0, "0", -1, "-1",
    "espn:0", "espn:-1", null, undefined, "", false] });
  s.weeks[0][0].players_points = { zero: 0, negative: -4, missing: null };
  const d = analyze([s]);
  assert.equal(d.playerStartWeeks.length, 3);
  assert.equal(d.playerStarts.find((p) => p.player === "zero").points, 0);
  assert.equal(d.playerStarts.find((p) => p.player === "negative").points, -4);
  assert.equal(d.playerStarts.find((p) => p.player === "missing").points, null);
  assert.equal(d.playerStarts.find((p) => p.player === "missing").scoredStarts, 0);
  // A completed 0–0 matchup still records actual starts.
  s.weeks[0].forEach((m) => { m.points = 0; });
  assert.equal(analyze([s]).playerStartWeeks.length, 3);
});

test("a missing player score makes career points unavailable without erasing starts", () => {
  const s = season({ starters: ["p"], cutoff: 2 });
  const second = structuredClone(s.weeks[0]);
  delete second[0].players_points;
  s.weeks.push(second);
  const p = analyze([s]).playerStarts[0];
  assert.equal(p.starts, 2);
  assert.equal(p.scoredStarts, 1);
  assert.equal(p.points, null);
});

test("future weeks and postseason byes are excluded; paired postseason starts count", () => {
  const s = season({ starters: ["p"], cutoff: 3, playoff: 2 });
  const pairedPostseason = structuredClone(s.weeks[0]);
  const bye = structuredClone(s.weeks[0]);
  bye.forEach((m) => { m.matchup_id = null; });
  const future = structuredClone(s.weeks[0]);
  future[0].players_points.p = 999;
  s.weeks.push(pairedPostseason, bye, future);
  const d = analyze([s]), p = d.playerStarts[0], c = d.startCoverage[0];
  assert.equal(p.starts, 2);
  assert.equal(p.regularStarts, 1);
  assert.equal(p.postseasonStarts, 1);
  assert.equal(p.points, 20);
  assert.deepEqual(c.completedWeekNumbers, [1, 2]);
  assert.deepEqual(c.lineupWeekNumbers, [1, 2]);
  s.league.settings.last_scored_leg = 0;
  assert.equal(analyze([s]).playerStartWeeks.length, 0);
});

test("missing saved regular-season weeks and missing lineup arrays appear in coverage", () => {
  const s = season({ starters: ["p"], cutoff: 4, playoff: 4 });
  const missingLineup = structuredClone(s.weeks[0]);
  delete missingLineup[0].starters;
  s.weeks.push([], missingLineup, []);
  const d = analyze([s]), c = d.startCoverage.find((c) => c.uid === "manager");
  assert.equal(c.completedWeeks, 3);
  assert.equal(c.lineupWeeks, 1);
  assert.deepEqual(c.completedWeekNumbers, [1, 2, 3]);
  assert.deepEqual(c.lineupWeekNumbers, [1]);
  assert.deepEqual(c.missingWeeks, [2, 3]);
});

test("duplicate roster pairings and missing team scores never produce starts", () => {
  const s = season({ starters: ["p"] });
  s.weeks[0][1].roster_id = 1;
  assert.equal(analyze([s]).playerStartWeeks.length, 0);
  s.weeks[0][1].roster_id = 2;
  s.weeks[0][1].points = null;
  assert.equal(analyze([s]).playerStartWeeks.length, 0);
});

test("filtered weekly rows summarize deterministically without duplicate counts", () => {
  const rows = [
    { uid: "a", playerKey: "gsis:p", player: "P", position: "QB", season: "2026 (Sleeper)", week: 2, postseason: true, points: 3 },
    { uid: "a", playerKey: "gsis:p", player: "P", position: "QB", season: "2024 (ESPN)", week: 1, postseason: false, points: 0 },
  ];
  const p = summarizePlayerStarts([...rows, rows[0]])[0];
  assert.equal(p.starts, 2);
  assert.equal(p.points, 3);
  assert.deepEqual(p.seasons, ["2024 (ESPN)", "2026 (Sleeper)"]);
  assert.equal(summarizePlayerStarts(rows.filter((w) => w.postseason))[0].starts, 1);
});

test("the real snapshot matches a manual count of recorded starters in paired completed games", () => {
  const raw = fs.readFileSync("league-data.js", "utf8").trim();
  const seasons = JSON.parse(raw.replace(/^window\.LEAGUE_SNAPSHOT\s*=\s*/, "").replace(/;$/, ""));
  const d = analyze(seasons), expected = new Map();
  for (const s of seasons) {
    const owner = Object.fromEntries(s.rosters.map((r) => [r.roster_id, r.owner_id]));
    const cutoff = s.league.settings?.last_scored_leg ?? (s.league.status === "complete" ? 18 : 0);
    for (let week = 1; week <= cutoff; week++) {
      const groups = new Map();
      for (const m of s.weeks[week - 1] || []) {
        if (m.matchup_id == null) continue;
        const key = String(m.matchup_id);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
      }
      for (const pair of groups.values()) {
        if (pair.length !== 2 || pair[0].roster_id === pair[1].roster_id) continue;
        for (const m of pair) {
          if (!owner[m.roster_id] || !Array.isArray(m.starters)) continue;
          const count = new Set(m.starters.filter((p) => p != null && !["", "0", "-1"].includes(String(p)))).size;
          const key = JSON.stringify([owner[m.roster_id], `${s.league.season} (${s.src})`]);
          expected.set(key, (expected.get(key) || 0) + count);
        }
      }
    }
  }
  const actual = new Map();
  for (const w of d.playerStartWeeks) {
    const key = JSON.stringify([w.uid, w.season]);
    actual.set(key, (actual.get(key) || 0) + 1);
  }
  assert.deepEqual(actual, expected);
  assert.equal(d.playerStartWeeks.length,
    d.playerStarts.reduce((sum, p) => sum + p.starts, 0));
  const kaushal = Object.keys(d.names).find((uid) => d.names[uid] === "Kaushal");
  const winston = Object.keys(d.names).find((uid) => d.names[uid] === "Winston");
  assert.ok(kaushal && winston && kaushal !== winston);
  assert.ok(d.playerStarts.some((p) => p.uid === kaushal));
  assert.ok(d.playerStarts.some((p) => p.uid === winston));
  assert.ok(d.playerStarts.filter((p) => p.uid === kaushal).every((p) => p.seasons.length === 1));
  for (const c of d.startCoverage) {
    assert.equal(c.completedWeeks - c.lineupWeeks, c.missingWeeks.length);
    assert.ok(c.completedWeekNumbers.every((week) => week <=
      (seasons.find((s) => `${s.league.season} (${s.src})` === c.season).league.settings?.last_scored_leg ?? 18)));
  }
});
