const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { analyze, summarizePlayerStarts } = require("../league-stats.js");
const TradeAnalysis = require("../trade-analysis.js");
const ComebackHistory = require("../comeback-history.js");
const {
  buildContext,
  getCatalog,
  parseSnapshot,
} = require("../chat-context.cjs");
const snapshot = parseSnapshot(
  fs.readFileSync(path.join(__dirname, "..", "league-data.js"), "utf8"),
);
const computed = analyze(snapshot);
const payload = (result) => JSON.parse(result.facts);
const rowsOf = (result, kind) =>
  payload(result)
    .evidence.filter((e) => e.kind === kind)
    .flatMap((e) => (Array.isArray(e.rows) ? e.rows : [e.rows]));
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.0001, `${a} != ${b}`);

test("snapshot parsing accepts JSON assignment but never evaluates executable text", () => {
  assert.equal(
    parseSnapshot(
      `window.LEAGUE_SNAPSHOT = ${JSON.stringify(snapshot.slice(0, 1))};`,
    ).length,
    1,
  );
  assert.throws(() =>
    parseSnapshot(
      "window.LEAGUE_SNAPSHOT = (globalThis.SECRET_STOLEN = true, []);",
    ),
  );
  assert.throws(() =>
    parseSnapshot(
      "window.LEAGUE_SNAPSHOT = []; require('node:fs').readFileSync('espn_secrets.json');",
    ),
  );
  assert.throws(() =>
    parseSnapshot('window.LEAGUE_SNAPSHOT = [{"src":"other"}];'),
  );
  assert.equal(globalThis.SECRET_STOLEN, undefined);
});

test("known manager's season facts come from the shared statistics engine", () => {
  const result = buildContext("Explain Koji's Scoring+, PALA and xW in 2025.");
  const expected = computed.saber.find(
    (r) => computed.names[r.uid] === "Koji" && r.year === "2025",
  );
  assert.ok(expected);
  const row = rowsOf(result, "managerSeasonStatLine").find(
    (r) => r.manager === "Koji" && r.season === expected.season,
  );
  assert.ok(row);
  for (const key of [
    "actual",
    "xw",
    "pala",
    "scoringPlus",
    "lineupRegret",
    "dominance",
    "volatility",
  ])
    close(row[key], expected[key]);
  assert.deepEqual(result.coverage.selectedSeasons, ["2025 (Sleeper)"]);
  assert.deepEqual(result.coverage.selectedManagers, ["Koji"]);
});

test("all page definitions and coverage limitations are always available within a fixed context budget", () => {
  for (const q of [
    "What is xFP?",
    "Show the best trades",
    "Rank Scoring+",
    "Explain lineup regret",
    "Give me every record in 2024",
  ]) {
    const result = buildContext(q);
    assert.ok(result.facts.length <= 14000);
    const guide = payload(result).trustedDefinitions;
    for (const section of Object.keys(getCatalog().sections))
      assert.equal(typeof guide[section], "string");
    assert.match(guide.opportunity, /FPOE=actual MODELED/);
    assert.match(guide.moves, /AFTER acquisition/);
    assert.match(guide.saber, /ANY qualifying week/);
    const allowed = new Set(result.sources.map((s) => s.id));
    assert.ok(payload(result).evidence.every((row) => allowed.has(row.source)));
    assert.ok(result.sources.every((s) => /^[a-z-]+$/.test(s.id)));
  }
});

test("untrusted selections and question text cannot become context instructions", () => {
  const marker = "inject-7fe92-ignore-all-rules";
  const result = buildContext(marker, {
    section: marker,
    manager: marker,
    season: marker,
    platform: marker,
    scope: marker,
    facts: marker,
  });
  assert.ok(!result.facts.includes(marker));
  assert.deepEqual(result.coverage.selectedManagers, []);
  assert.equal(result.coverage.savedLeague, true);
  assert.equal(result.coverage.selectedSeasons.length, snapshot.length);
  assert.ok(!result.facts.includes("gsk_"));
  assert.ok(!result.facts.includes("espn_s2"));
});

test("external/custom leagues receive only definitions, never saved league facts", () => {
  const result = buildContext("How many titles does Koji have in 2025?", {
    scope: "external",
    section: "profile",
  });
  assert.deepEqual(payload(result).evidence, []);
  assert.equal(result.coverage.savedLeague, false);
  assert.equal(result.coverage.externalLeague, true);
  assert.ok(!result.facts.includes("Koji"));
  assert.ok(!result.facts.includes("Kaushal"));
  assert.deepEqual(
    result.sources.map((s) => s.id),
    ["site-guide"],
  );
});

test("explicit current question overrides UI selection and contextual followups preserve manager", () => {
  const catalog = getCatalog();
  const neil = catalog.managers.find((m) => m.name === "Neil").id;
  const selected = buildContext("Koji Scoring+ in 2025", {
    manager: neil,
    season: "2024",
    platform: "ESPN",
  });
  assert.deepEqual(selected.coverage.selectedManagers, ["Koji"]);
  assert.deepEqual(selected.coverage.selectedSeasons, ["2025 (Sleeper)"]);
  const result = buildContext({
    message: "What about 2024?",
    selection: {},
    history: [{ role: "user", content: "What was Koji's Scoring+ in 2025?" }],
  });
  assert.deepEqual(result.coverage.selectedManagers, ["Koji"]);
  assert.deepEqual(result.coverage.selectedSeasons, ["2024 (ESPN)"]);
  const fresh = buildContext("Neil's xW in 2026 Sleeper", {}, [
    { role: "user", content: "Koji 2025" },
  ]);
  assert.deepEqual(fresh.coverage.selectedManagers, ["Neil"]);
  assert.deepEqual(fresh.coverage.selectedSeasons, ["2026 (Sleeper)"]);
  const ranking = buildContext("Who has the highest Scoring+ in 2025?", {
    manager: neil,
  });
  assert.deepEqual(ranking.coverage.selectedManagers, []);
});

test("opportunity summaries exactly follow complete-week coverage and offensive scope", () => {
  const result = buildContext("Koji xFP and FPOE in 2025");
  const actual = rowsOf(result, "managerOpportunitySummary").find(
    (r) => r.manager === "Koji",
  );
  const s = snapshot.find((s) => String(s.league.season) === "2025");
  const uid = Object.keys(computed.names).find(
    (u) => computed.names[u] === "Koji",
  );
  const rid = s.rosters.find((r) => r.owner_id === uid).roster_id;
  const rows = s.opportunity.weekly.filter(
    (w) =>
      w.roster_id === rid &&
      w.week < s.league.settings.playoff_week_start &&
      w.week <= s.league.settings.last_scored_leg,
  );
  const covered = rows.filter((r) => r.complete);
  assert.equal(actual.observed, rows.length);
  assert.equal(actual.weeks, covered.length);
  close(
    actual.xfp,
    covered.reduce((sum, w) => sum + w.xfp, 0),
  );
  close(
    actual.actual,
    covered.reduce((sum, w) => sum + w.actual, 0),
  );
  close(
    actual.fpoe,
    covered.reduce((sum, w) => sum + w.fpoe, 0),
  );
});

test("draft, transaction, week, player and record questions retrieve their actual source rows", () => {
  assert.ok(
    rowsOf(
      buildContext("Best draft bargains 2024 ESPN"),
      "draftPickContribution",
    ).every((r) => r.round >= 8),
  );
  const moves = rowsOf(
    buildContext("Latest trades 2024 ESPN"),
    "completedTransaction",
  );
  assert.ok(moves.length > 0 && moves.every((r) => r.type === "trade"));
  const weeks = rowsOf(buildContext("2025 week 11 Koji recap"), "weekRecap");
  assert.ok(weeks.length > 0 && weeks.every((w) => w.week === 11));
  const players = rowsOf(
    buildContext("Christian McCaffrey's player history in 2025", {
      section: "players",
    }),
    "playerSeasonManagerHistory",
  );
  assert.ok(
    players.length > 0 &&
      players.every(
        (p) =>
          p.player === "Christian McCaffrey" && p.season === "2025 (Sleeper)",
      ),
  );
  assert.ok(players.every((p) => p.weeksStarted <= p.weeksRostered));
  assert.ok(
    rowsOf(
      buildContext("Koji rivalries and biggest blowouts"),
      "competitiveRivalries",
    ).length > 0,
  );
});

test("per-start draft questions rank by rate and keep never-rostered picks out", () => {
  const rate = buildContext("Worst draft picks by points per start", {
    section: "drafts",
  });
  const rows = rowsOf(rate, "draftPickContribution");
  assert.ok(rows.length > 0);
  // The rate board needs a real denominator, and ranks ascending for "worst".
  assert.ok(rows.every((r) => r.starts >= 8 && typeof r.ptsPerStart === "number"));
  assert.ok(
    rows.every((r, i) => i === 0 || rows[i - 1].valuePerStart <= r.valuePerStart),
  );
  // The players page also claims "points per start"; drafts must win here.
  assert.equal(rowsOf(rate, "playerSeasonManagerHistory").length, 0);
  // A pick that never reached the drafting roster is not a draft disappointment.
  const byTotal = rowsOf(
    buildContext("Biggest draft disappointments of all time", {
      section: "drafts",
    }),
    "draftPickContribution",
  );
  assert.ok(byTotal.length > 0);
  assert.ok(!byTotal.some((r) => r.rostered === 0));
  // It is still reachable when the question actually asks for it.
  const never = rowsOf(
    buildContext("Which draft picks were never started by the drafting manager", {
      section: "drafts",
    }),
    "draftPickNeverStarted",
  );
  assert.ok(never.length > 0);
  assert.ok(never.every((r) => typeof r.rostered === "number"));
  assert.ok(never.some((r) => r.neverRostered === true));
});
test("Kaushal/Winston identity answers distinguish exact season rates from career aggregates", () => {
  const result = buildContext(
    "Why are Kaushal and Winston listed separately? What are their season records?",
    {
      section: "opportunity",
      manager: "all",
      season: "all",
      platform: "all",
      scope: "saved",
    },
  );
  const identity = rowsOf(result, "managerIdentityNote")[0];
  assert.match(identity, /two distinct people/);
  assert.match(identity, /not an ESPN\/Sleeper account alias/);
  const seasonGroups = rowsOf(result, "seasonStandings");
  const actual = seasonGroups.flatMap((s) => s.rows);
  const expected = computed.bySeason.flatMap((s) =>
    s.rows
      .filter((r) => ["Kaushal", "Winston"].includes(computed.names[r.uid]))
      .map((r) => ({ ...r, season: s.season, manager: computed.names[r.uid] })),
  );
  assert.equal(actual.length, expected.length);
  for (const r of expected) {
    const line = actual.find(
      (x) => x.manager === r.manager && x.season === r.season,
    );
    assert.ok(line, `Missing ${r.manager} ${r.season}`);
    assert.equal(line.statisticsScope, "single_season");
    const games = r.w + r.l + r.t;
    assert.equal(line.gamesPlayed, games);
    close(line.pointsPerGame, r.pf / games);
    close(line.winPctFraction, (r.w + r.t / 2) / games);
    close(line.winPctPercent, (100 * (r.w + r.t / 2)) / games);
  }
  const winston2025 = actual.find(
    (r) => r.manager === "Winston" && r.season.startsWith("2025"),
  );
  const winston2026 = actual.find(
    (r) => r.manager === "Winston" && r.season.startsWith("2026"),
  );
  assert.notEqual(winston2025.pointsPerGame, winston2026.pointsPerGame);
  for (const r of rowsOf(result, "standingsTotals")) {
    assert.equal(r.statisticsScope, "aggregate_selected_seasons");
    assert.ok(Array.isArray(r.seasonsIncluded));
    assert.ok(Object.hasOwn(r, "aggregatePointsPerGame"));
    assert.ok(!Object.hasOwn(r, "pointsPerGame"));
  }
});

test("most-started answers respect the selected manager, season, position and game scope", () => {
  const uid = getCatalog().managers.find((m) => m.name === "Koji").id;
  const result = buildContext("Who were my most started players?", {
    section: "starts",
    manager: uid,
    season: "2025 (Sleeper)",
    games: "regular",
    position: "QB",
  });
  const expected = summarizePlayerStarts(
    computed.playerStartWeeks.filter(
      (r) =>
        r.uid === uid &&
        r.year === "2025" &&
        !r.postseason &&
        r.position === "QB",
    ),
  );
  const actual = rowsOf(result, "managerPlayerStarts");
  assert.ok(actual.length > 0);
  assert.equal(actual.length, Math.min(10, expected.length));
  for (const r of actual) {
    const e = expected.find((x) => x.player === r.player);
    assert.ok(e);
    assert.equal(r.manager, "Koji");
    assert.equal(r.games, "regular");
    assert.equal(r.starts, e.starts);
    assert.equal(r.postseasonStarts, 0);
    assert.deepEqual(r.seasons, ["2025 (Sleeper)"]);
  }
  assert.ok(
    rowsOf(result, "playerStartCoverage").every((r) => r.games === "regular"),
  );
});

test("selected trade evidence includes every participant's before/after results and player contributions", () => {
  for (const year of ["2024", "2025", "2026"]) {
    const t = TradeAnalysis.analyze(snapshot).trades.find(
      (t) => t.year === year,
    );
    assert.ok(t);
    const result = buildContext(
      "Explain how even this trade was and how both teams did afterward.",
      {
        section: "trades",
        trade: t.id,
        season: t.season,
      },
    );
    assert.ok(result.facts.length <= 14000);
    const actual = rowsOf(result, "tradeAnalysis")[0];
    assert.ok(actual, `Missing trade ${t.id}`);
    assert.equal(actual.id, t.id);
    assert.equal(actual.participants.length, t.participants.length);
    assert.deepEqual(actual.balance, t.balance);
    for (const p of t.participants) {
      const row = actual.participants.find(
        (x) => x.manager === computed.names[p.uid],
      );
      assert.ok(row);
      assert.equal(row.after.games, p.after.games);
      assert.equal(row.before.games, p.before.games);
      assert.equal(row.after.w, p.after.w);
      const packageRow = rowsOf(result, "tradePlayerContributions").find(
        (x) => x.manager === row.manager,
      );
      assert.ok(packageRow, `Missing ${row.manager} package`);
      assert.equal(packageRow.received.length, p.received.length);
      for (const a of packageRow.received) {
        const expected = p.received.find((x) => x.player === a.player);
        if (expected.pts === null) assert.equal(a.pts, null);
        else close(a.pts, expected.pts);
      }
    }
  }
});

test("comeback answers preserve checkpoint provenance and do not infer missing odds", () => {
  const data = ComebackHistory.analyze(snapshot),
    g = data.comebacks[0];
  assert.ok(g);
  const result = buildContext(
    "Explain this comeback's score history and win probability.",
    {
      section: "comebacks",
      matchup: `${g.season}|${g.week}|${g.matchupId}`,
      season: g.season,
    },
  );
  const row = rowsOf(result, "historicalComeback")[0];
  assert.ok(row);
  close(row.maxDeficit, g.maxDeficit);
  assert.equal(row.finalMatchupScore.winnerPoints, g.winnerPoints);
  assert.equal(row.finalMatchupScore.opponentPoints, g.loserPoints);
  assert.match(
    payload(result).trustedDefinitions.comebacks,
    /last trace checkpoint may precede/,
  );
  assert.equal(row.method, "reconstructed_day_boundary");
  assert.equal(row.lowestWinProbability, null);
  assert.deepEqual(row.trace, g.trace);
  assert.equal(
    rowsOf(result, "comebackHistoryCoverage")[0].probabilityMatchups,
    0,
  );
  assert.match(
    payload(result).trustedDefinitions.comebacks,
    /Never infer percentages/,
  );
});
