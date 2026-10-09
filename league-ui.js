/* Shared dashboard for live and saved league history. */
(function (root) {
  "use strict";
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const raw = (html) => ({ html }),
    num = (x) => (x === null ? "—" : Number(x || 0).toFixed(2)),
    rec = (a) => `${a.w}-${a.l}${a.t ? "-" + a.t : ""}`,
    signed = (x) => `${x > 0 ? "+" : ""}${num(x)}`;
  function table(headers, rows) {
    return `<div class="scroll"><table class="sortable"><thead><tr>${headers.map((h) => `<th scope="col" tabindex="0">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td${Array.isArray(c) ? ` data-v="${esc(c[1])}"` : ""}>${c?.html !== undefined ? c.html : esc(Array.isArray(c) ? c[0] : c)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">No data available for this selection.</td></tr>`}</tbody></table></div>`;
  }
  function mount(el, seasons, names = {}) {
    const D = root.LeagueStats.analyze(seasons, names),
      n = (u) => D.names[u] || "Unknown",
      ids = Object.keys(D.all).sort((a, b) => n(a).localeCompare(n(b)));
    const tradeData = root.TradeAnalysis.analyze(seasons, names);
    const tradeRanks = root.TradeAnalysis.rankManagers(tradeData.trades);
    const manager = (u) =>
      raw(
        `<button class="manager" data-manager="${esc(u)}">${esc(n(u))}</button>`,
      );
    let section = el.dataset.activeSection || "home",
      selected = ids.includes(el.dataset.selectedManager)
        ? el.dataset.selectedManager
        : ids[0],
      weekIndex = D.weeks.length - 1,
      chartSource = "all",
      chartMetric = "pf",
      chartManager = "all",
      draftSeason = "all",
      draftMinStarts = "8",
      draftSort = "perStart",
      moveSeason = "all",
      moveType = "all",
      moveManager = "all",
      pickupSeason = "all",
      pickupType = "all",
      pickupManager = "all",
      pickupMinStarts = "1",
      pickupSort = "pts",
      dropsSeason = "all",
      dropsManager = "all",
      dropsMinStarts = "3",
      dropsSort = "value",
      profilePickupSort = "pts",
      profilePickupMinStarts = "1",
      profileTradeSort = "net",
      profileWaiverSort = "pts",
      profileMoveView = "trades",
      saberSeason = "all",
      saberManager = "all",
      saberMetric = "scoringPlus",
      saberMinWeeks = "1",
      opportunitySeason = "all",
      opportunityManager = "all",
      startsSeason = "all",
      startsManager = "all",
      startsGames = "all",
      startsPosition = "all";
    let tradeSeason = "all",
      tradeManager = "all",
      selectedTrade = "",
      comebackSeason = "all",
      comebackManager = "all",
      comebackRanking = "deficit",
      selectedComeback = "";
    const options = (items, chosen) =>
      items
        .map(
          ([v, t]) =>
            `<option value="${esc(v)}"${String(v) === String(chosen) ? " selected" : ""}>${esc(t)}</option>`,
        )
        .join("");
    const select = (id, label, items, chosen) =>
      `<span class="select-field"><label for="${id}">${esc(label)}</label> <select id="${id}">${options(items, chosen)}</select></span>`;
    // Range input paired with a number box so a minimum can be dragged across
    // the whole observed span or typed exactly. `input` mirrors the pair;
    // `change` redraws.
    const sliderBox = (id, label, max, value) =>
      `<span class="select-field slider-field"><label for="${id}">${esc(label)}</label> <input type="range" id="${id}" min="0" max="${esc(max)}" step="1" value="${esc(value)}"> <input type="number" id="${id}-num" min="0" max="${esc(max)}" step="1" value="${esc(value)}" aria-label="${esc(label)}, exact number"></span>`;
    // A number box accepts anything typed, so clamp before it reaches state.
    const clampInt = (value, min, max, fallback) => {
      const n = Math.round(Number(value));
      return Number.isFinite(n)
        ? String(Math.min(Number(max), Math.max(Number(min), n)))
        : String(fallback);
    };
    const rosterName = (label, rid) =>
      n(
        D.sources
          .find((s) => `${s.league.season} (${s.src})` === label)
          ?.rosters.find((r) => r.roster_id === rid)?.owner_id,
      );
    const seasonOptions = [
      ["all", "All seasons"],
      ...D.bySeason.map((s) => [s.season, s.season]),
    ];
    const managerOptions = [
      ["all", "All managers"],
      ...ids.map((u) => [u, n(u)]),
    ];
    const cards = (items) =>
      `<div class="cards">${items
        .map(
          ([k, v]) =>
            `<div class="card"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`,
        )
        .join("")}</div>`;
    const metricCards = (a) =>
      cards([
        ["Record", rec(a)],
        ["Win %", num(root.LeagueStats.rate(a) * 100) + "%"],
        ["Titles", a.titles],
        ["Playoffs", a.po],
        ["Expected wins", num(a.expected)],
        ["Schedule luck", signed(a.actual - a.expected)],
      ]);
    // This season at a glance. Every figure is a selection from what the engine
    // already produced - the newest `D.bySeason` entries, their weeks in
    // `D.weeks`, and `D.scores` filtered to the same labels - so nothing is
    // recalculated here (see CLAUDE.md invariant 1).
    function overview() {
      const year = D.bySeason.reduce(
        (latest, s) => (latest === null || s.year > latest ? s.year : latest),
        null,
      );
      if (year === null)
        return '<h2>This season</h2><p class="sub">No seasons are loaded.</p>';
      // A combined view can hold the same year on both platforms, so this keeps
      // one standings table per platform entry rather than merging them.
      const current = D.bySeason.filter((s) => s.year === year),
        labels = current.map((s) => s.season),
        seasonScores = D.scores.filter((x) => labels.includes(x[2])),
        best = seasonScores.reduce(
          (top, x) => (!top || x[0] > top[0] ? x : top),
          null,
        ),
        leaders = current
          .map((s) => (s.rows[0] ? n(s.rows[0].uid) : null))
          .filter(Boolean);
      return (
        `<h2>${esc(year)} season</h2><p class="sub">Where the league stands right now. Career records and head-to-head live under All time; the latest recap is under Weekly wrapped.</p>` +
        cards([
          ["Standings leader", leaders.join(" \u00b7 ") || "\u2014"],
          [
            "Regular-season weeks played",
            D.weeks.filter((w) => labels.includes(w.season) && !w.postseason)
              .length,
          ],
          [
            "Best week",
            best ? `${num(best[0])} \u00b7 ${n(best[1])}` : "\u2014",
          ],
          [
            "Platforms",
            [...new Set(current.map((s) => s.src))].join(" \u00b7 "),
          ],
        ]) +
        current
          .map(
            (s) =>
              `<h3>${esc(s.season)} standings</h3><p class="sub">Click a manager for their profile.</p>` +
              table(
                ["Rank", "Manager", "Record", "PF", "PA"],
                s.rows.map((r, i) => [
                  i + 1,
                  manager(r.uid),
                  rec(r) + (r.uid === s.champ ? " \ud83c\udfc6" : ""),
                  num(r.pf),
                  num(r.pa),
                ]),
              ),
          )
          .join("") +
        `<h3>${esc(year)} highest weekly scores</h3>` +
        table(
          ["Points", "Manager", "Season", "Week"],
          seasonScores
            .slice()
            .sort((a, b) => b[0] - a[0])
            .slice(0, 10)
            .map((s) => [num(s[0]), manager(s[1]), s[2], s[3]]),
        )
      );
    }
    function allTime() {
      return (
        '<h2>All-time standings</h2><p class="sub">Click a manager for their profile. Records and points use platform season totals.</p>' +
        table(
          [
            "Manager",
            "Seasons",
            "Record",
            "Win %",
            "PF/game",
            "PA/game",
            "Points for",
            "Points against",
            "Playoffs",
            "Titles",
            "Finals",
          ],
          ids
            .slice()
            .sort(
              (a, b) =>
                root.LeagueStats.rate(D.all[b]) -
                  root.LeagueStats.rate(D.all[a]) || D.all[b].pf - D.all[a].pf,
            )
            .map((u) => {
              const a = D.all[u],
                gp = a.w + a.l + a.t;
              return [
                manager(u),
                a.seasons,
                rec(a),
                [
                  num(root.LeagueStats.rate(a) * 100) + "%",
                  root.LeagueStats.rate(a),
                ],
                num(a.pf / (gp || 1)),
                num(a.pa / (gp || 1)),
                num(a.pf),
                num(a.pa),
                a.po,
                a.titles,
                a.finals,
              ];
            }),
        ) +
        "<h2>Champions by season</h2>" +
        table(
          ["Season", "Champion", "Runner-up", "Best regular-season record"],
          D.champs
            .slice()
            .reverse()
            .map((c) => [
              c.season,
              c.champ ? manager(c.champ) : "—",
              c.runner ? manager(c.runner) : "—",
              c.top ? manager(c.top) : "—",
            ]),
        ) +
        "<h2>Highest single-week scores</h2>" +
        table(
          ["Points", "Manager", "Season", "Week"],
          D.scores
            .slice()
            .sort((a, b) => b[0] - a[0])
            .slice(0, 10)
            .map((s) => [num(s[0]), manager(s[1]), s[2], s[3]]),
        ) +
        ["Regular season", "Playoffs", "Consolation"]
          .map((label, i) => {
            const map = [D.h2h, D.playoffH2h, D.consolationH2h][i];
            return (
              `<details${i === 0 ? " open" : ""}><summary>Head-to-head · ${label}</summary><p class="sub">Row manager’s wins-losses-ties against each column manager.</p>` +
              table(
                ["Manager", ...ids.map(n)],
                ids.map((a) => [
                  manager(a),
                  ...ids.map((b) =>
                    a === b ? "—" : map[a]?.[b]?.join("-") || "",
                  ),
                ]),
              ) +
              "</details>"
            );
          })
          .join("") +
        "<h2>Season standings</h2>" +
        D.bySeason
          .slice()
          .reverse()
          .map(
            (s) =>
              `<details><summary>${esc(s.season)}</summary>${table(
                ["Rank", "Manager", "Record", "PF", "PA"],
                s.rows.map((r, i) => [
                  i + 1,
                  manager(r.uid),
                  rec(r) + (r.uid === s.champ ? " 🏆" : ""),
                  num(r.pf),
                  num(r.pa),
                ]),
              )}</details>`,
          )
          .join("")
      );
    }
    function luck() {
      return (
        '<h2>Schedule luck rankings</h2><p class="sub">For each completed regular-season week, expected wins = (teams outscored + half of teams tied) ÷ other teams. Positive luck means more matchup wins than expected. Tied matchups count as half a win. Only paired teams with recorded scores are included; platform bonus wins are excluded.</p>' +
        table(
          [
            "Manager",
            "Weeks",
            "Actual wins",
            "Expected wins",
            "Luck",
            "All-play W-L-T",
            "All-play win %",
          ],
          ids
            .slice()
            .sort(
              (a, b) =>
                D.all[b].actual -
                D.all[b].expected -
                (D.all[a].actual - D.all[a].expected),
            )
            .map((u) => {
              const a = D.all[u],
                total = a.apw + a.apl + a.apt;
              return [
                manager(u),
                a.played,
                num(a.actual),
                num(a.expected),
                [signed(a.actual - a.expected), a.actual - a.expected],
                `${a.apw}-${a.apl}-${a.apt}`,
                num(total ? ((a.apw + a.apt / 2) / total) * 100 : 0) + "%",
              ];
            }),
        )
      );
    }
    const saberColumns = [
      "Manager",
      "Weeks",
      "Wins",
      "xW",
      "Luck",
      "Scoring+",
      "PALA",
      "Dominance",
      "Boom / bust",
      "Volatility",
      "Regret",
      "Efficiency",
      "Hindsight wins found",
      "Lineup coverage",
    ];
    const saberCells = (a) => [
      manager(a.uid),
      a.played,
      num(a.actual),
      num(a.xw),
      [signed(a.actual - a.xw), a.actual - a.xw],
      num(a.scoringPlus),
      [signed(a.pala), a.pala],
      signed(a.dominance),
      `${a.boom} / ${a.bust}`,
      num(a.volatility),
      num(a.lineupRegret),
      a.lineupEfficiency === null ? "—" : num(a.lineupEfficiency * 100) + "%",
      a.regretWeeks ? a.regretFlips : "—",
      `${a.regretWeeks}/${a.played} weeks`,
    ];
    function saberDefinitions() {
      return `<details class="metric-guide"><summary>How to read the stats</summary><div class="definition-grid">
        <p><strong>Scoring+</strong> = 100 × your points ÷ the sum of the league’s weekly average scores. 100 is average; 115 means 15% above average. Career values use each season’s own scoring environment.</p>
        <p><strong>PALA</strong> = points above league average, added week by week. It sums to zero across a league. Different scoring rules affect the scale; Scoring+ helps compare seasons.</p>
        <p><strong>xW</strong> = schedule-neutral wins. Each week counts opponents you outscored plus half the ties, divided by all other eligible teams. This describes recorded results; it is not a prediction. Luck = actual matchup wins − xW.</p>
        <p><strong>Dominance</strong> = average matchup scoring margin ÷ that week’s league scoring standard deviation. +1 means beating your opponent by one league standard deviation per week on average.</p>
        <p><strong>Boom / bust</strong> counts weeks at least one standard deviation above / below the weekly league average. <strong>Volatility</strong> is the population standard deviation of those weekly scoring z-scores. Lower means more consistent relative performance.</p>
        <p><strong>Lineup regret</strong> = best legal lineup points − actual starter points. <strong>Efficiency</strong> = actual starter points ÷ optimal points. <strong>Hindsight wins found</strong> counts losses or ties that an optimal lineup would turn into wins against the opponent’s recorded lineup. These are hindsight results, not evidence that a decision was bad beforehand. Missing roster scores, slot rules or position eligibility make the total unavailable.</p>
      </div><p class="sub">Only completed regular-season weeks with two scored teams in each matchup enter these metrics. Ties count as half a win; platform bonus wins and postseason games are excluded. Weeks where everyone scores equally have zero z-score and dominance. Active seasons are to date.</p></details>`;
    }
    function saberPlot(rows) {
      if (!rows.length) return "";
      const W = 760,
        H = 350,
        pad = 55,
        limit = Math.max(1, ...rows.map((r) => Math.max(r.actual, r.xw))),
        x = (v) => pad + (v / limit) * (W - pad * 2),
        y = (v) => H - pad - (v / limit) * (H - pad * 2);
      let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Actual wins versus schedule-neutral wins"><title>Actual wins versus schedule-neutral wins</title>`;
      for (let i = 0; i <= 4; i++) {
        const v = (limit * i) / 4;
        svg += `<line x1="${pad}" x2="${W - pad}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" opacity=".12"/><text x="${pad - 10}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text><text x="${x(v)}" y="${H - pad + 20}" text-anchor="middle">${num(v)}</text>`;
      }
      svg += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(limit)}" y2="${y(limit)}" stroke="currentColor" stroke-dasharray="6 6" opacity=".5"/>`;
      rows.forEach((r) => {
        const fill =
          r.actual > r.xw ? "#d97706" : r.actual < r.xw ? "#2563eb" : "#64748b";
        svg += `<circle cx="${x(r.xw)}" cy="${y(r.actual)}" r="7" fill="${fill}" opacity=".85"><title>${esc(n(r.uid))}: ${num(r.actual)} wins, ${num(r.xw)} xW, ${signed(r.actual - r.xw)} luck</title></circle><text x="${x(r.xw) + 10}" y="${y(r.actual) - 8}" font-size="11">${esc(n(r.uid))}</text>`;
      });
      svg += `<text x="${W / 2}" y="${H - 7}" text-anchor="middle">Schedule-neutral wins (xW)</text><text transform="translate(15 ${H / 2}) rotate(-90)" text-anchor="middle">Actual matchup wins</text></svg>`;
      return `<div class="chart saber-chart">${svg}</div><p class="sub">Above the diagonal: more wins than scoring earned against random opponents. Below: fewer. Amber = positive schedule luck; blue = negative.</p>`;
    }
    function sabermetrics() {
      const rows = (
        saberSeason === "all"
          ? Object.values(D.saberCareer || {})
          : (D.saber || []).filter((s) => s.season === saberSeason)
      )
        .filter(
          (s) =>
            s.played >= Number(saberMinWeeks) &&
            (saberManager === "all" || s.uid === saberManager),
        )
        .sort((a, b) => {
          const av = a[saberMetric],
            bv = b[saberMetric];
          return (
            (av === null) - (bv === null) ||
            (saberMetric === "lineupRegret" || saberMetric === "volatility"
              ? av - bv
              : bv - av) ||
            n(a.uid).localeCompare(n(b.uid))
          );
        });
      const leaders = rows
        .filter((r) => r.scoringPlus !== null)
        .slice()
        .sort((a, b) => b.scoringPlus - a.scoringPlus);
      const leader = leaders[0],
        snakebit = rows
          .slice()
          .sort((a, b) => a.actual - a.xw - (b.actual - b.xw))[0];
      return (
        `<div class="lab-heading"><span class="eyebrow">The numbers behind the record</span><h2>Fantasy Stat Lab</h2><p class="sub">Your league’s answer to OPS+, runs above average and expected wins. Every number links back to the weeks that produced it.</p></div><div class="filters">` +
        select("saber-season", "Season", seasonOptions, saberSeason) +
        select("saber-manager", "Manager", managerOptions, saberManager) +
        select(
          "saber-min-weeks",
          "Minimum weeks",
          [
            ["1", "1+"],
            ["4", "4+"],
            ["8", "8+"],
            ["14", "14+"],
          ],
          saberMinWeeks,
        ) +
        select(
          "saber-metric",
          "Rank by",
          [
            ["scoringPlus", "Scoring+"],
            ["pala", "PALA"],
            ["xw", "xW"],
            ["dominance", "Dominance"],
            ["lineupRegret", "Least lineup regret"],
            ["volatility", "Most consistent"],
          ],
          saberMetric,
        ) +
        `</div><div class="cards"><div class="card"><span>Best scoring environment adjustment</span><strong>${leader ? esc(n(leader.uid)) : "—"}</strong><span>${leader ? num(leader.scoringPlus) + " Scoring+" : "No qualifying weeks"}</span></div><div class="card"><span>Most wins below expectation</span><strong>${snakebit ? esc(n(snakebit.uid)) : "—"}</strong><span>${snakebit ? signed(snakebit.actual - snakebit.xw) + " schedule luck" : "No qualifying weeks"}</span></div><div class="card"><span>The baseline</span><strong>100</strong><span>Scoring+ at league average</span></div></div>` +
        table(saberColumns, rows.map(saberCells)) +
        `<h3>Did the record match the scoring?</h3>` +
        saberPlot(rows) +
        saberDefinitions() +
        `<h3>Weekly evidence</h3><p class="sub">Select a manager to inspect every qualifying week, including the largest bench regrets and losses that an optimal legal lineup would have reversed.</p>` +
        (saberManager === "all"
          ? `<p>Choose a manager above, or click a manager in the leaderboard.</p>`
          : saberWeekly(
              rows.flatMap((s) =>
                s.weekly.map((w) => ({ ...w, season: w.season || s.season })),
              ),
            ))
      );
    }
    function saberWeekly(weeks) {
      return table(
        [
          "Season",
          "Week",
          "Points",
          "League average",
          "Above average",
          "z-score",
          "xW",
          "Result",
          "Optimal lineup",
          "Regret",
          "Would turn into a win?",
          "Best legal starters",
        ],
        weeks.map((w) => [
          w.season,
          w.week,
          num(w.points),
          num(w.baseline),
          signed(w.points - w.baseline),
          signed(w.z),
          num(w.expected),
          w.actualResult?.toUpperCase() || "—",
          num(w.optimum),
          num(w.regret),
          w.regret === null ? "—" : w.flipped ? "Yes" : "No",
          w.optimumStarters === null
            ? "—"
            : (w.optimumStarters || [])
                .map(
                  (pid) =>
                    D.sources.find(
                      (s) => `${s.league.season} (${s.src})` === w.season,
                    )?.players?.[pid]?.name || pid,
                )
                .join(", ") || "Empty lineup",
        ]),
      );
    }
    function opportunityRows(
      managerId = opportunityManager,
      seasonLabel = opportunitySeason,
    ) {
      return D.sources
        .filter(
          (s) =>
            seasonLabel === "all" ||
            `${s.league.season} (${s.src})` === seasonLabel,
        )
        .flatMap((s) => {
          const season = `${s.league.season} (${s.src})`,
            start = s.league.settings?.playoff_week_start || 15,
            cutoff =
              s.league.settings?.last_scored_leg ??
              (s.league.status === "complete" ? 18 : 0),
            owners = Object.fromEntries(
              s.rosters.map((r) => [r.roster_id, r.owner_id]),
            );
          return (s.opportunity?.weekly || [])
            .filter(
              (w) =>
                w.week <= cutoff &&
                w.week < start &&
                (managerId === "all" || owners[w.roster_id] === managerId),
            )
            .map((w) => ({ ...w, uid: owners[w.roster_id], season }));
        });
    }
    function opportunitySummary(rows) {
      const managers = {};
      for (const w of rows) {
        const key = `${w.season}|${w.uid}`,
          a = (managers[key] ||= {
            uid: w.uid,
            season: w.season,
            weeks: 0,
            observed: 0,
            xfp: 0,
            actual: 0,
            fpoe: 0,
          });
        a.observed++;
        if (w.complete) {
          a.weeks++;
          a.xfp += w.xfp;
          a.actual += w.actual;
          a.fpoe += w.fpoe;
        }
      }
      return Object.values(managers).sort(
        (a, b) =>
          (b.weeks ? b.xfp / b.weeks : -Infinity) -
          (a.weeks ? a.xfp / a.weeks : -Infinity),
      );
    }
    function opportunitySeasonTable(rows) {
      return table(
        [
          "Season",
          "Manager",
          "Covered weeks",
          "xFP / week",
          "Modeled points / week",
          "FPOE",
          "FPOE / modeled points",
        ],
        opportunitySummary(rows).map((a) => [
          a.season,
          manager(a.uid),
          `${a.weeks}/${a.observed}`,
          a.weeks ? num(a.xfp / a.weeks) : "—",
          a.weeks ? num(a.actual / a.weeks) : "—",
          a.weeks ? signed(a.fpoe) : "—",
          a.weeks && a.actual ? signed((100 * a.fpoe) / a.actual) + "%" : "—",
        ]),
      );
    }
    function opportunity() {
      const sources = D.sources.filter(
          (s) =>
            opportunitySeason === "all" ||
            `${s.league.season} (${s.src})` === opportunitySeason,
        ),
        rows = opportunityRows(),
        modeled = sources.filter((s) => s.opportunity?.model),
        weekPlayers = sources
          .flatMap((s) => {
            const season = `${s.league.season} (${s.src})`,
              start = s.league.settings?.playoff_week_start || 15,
              cutoff =
                s.league.settings?.last_scored_leg ??
                (s.league.status === "complete" ? 18 : 0),
              result = {};
            (s.weeks || []).forEach((wk, i) => {
              if (i + 1 > cutoff || i + 1 >= start) return;
              for (const m of wk || []) {
                const uid = s.rosters.find(
                  (r) => r.roster_id === m.roster_id,
                )?.owner_id;
                if (opportunityManager !== "all" && uid !== opportunityManager)
                  continue;
                for (const pid of m.starters || []) {
                  const v = s.opportunity?.weeks?.[String(i + 1)]?.[pid];
                  if (!v) continue;
                  const a = (result[pid] ||= {
                    season,
                    pid,
                    name: s.players?.[pid]?.name || pid,
                    pos: s.players?.[pid]?.position || "",
                    starts: 0,
                    xfp: 0,
                    actual: 0,
                    fpoe: 0,
                    targets: 0,
                    carries: 0,
                    airYards: 0,
                    shareSum: 0,
                    shareWeeks: 0,
                  });
                  a.starts++;
                  if (Number.isFinite(v.opportunityShare)) {
                    a.shareSum += v.opportunityShare;
                    a.shareWeeks++;
                  }
                  for (const k of [
                    "xfp",
                    "actual",
                    "fpoe",
                    "targets",
                    "carries",
                    "airYards",
                  ])
                    a[k] += Number(v[k]) || 0;
                }
              }
            });
            return Object.values(result);
          })
          .sort((a, b) => b.xfp - a.xfp);
      return (
        `<div class="lab-heading"><span class="eyebrow">The opportunity behind the points</span><h2>Expected fantasy points</h2><p class="sub">Did your starters get valuable opportunities, or turn ordinary opportunities into extraordinary production?</p></div><div class="filters">` +
        select(
          "opportunity-season",
          "Season",
          seasonOptions,
          opportunitySeason,
        ) +
        select(
          "opportunity-manager",
          "Manager",
          managerOptions,
          opportunityManager,
        ) +
        `</div><p class="sub"><strong>xFP</strong> sums expected offensive fantasy production from the published ffopportunity models, reweighted to your league’s scoring rules. <strong>FPOE</strong> = actual modeled offensive points − xFP. This covers QB/RB/WR/TE passing, rushing and receiving components. Fumbles, nonlinear bonuses, return points, kickers and defenses are excluded from both sides. These totals deliberately differ from the full matchup score.</p>` +
        (modeled.length
          ? opportunitySeasonTable(rows)
          : `<p>No NFL model data is available for this selection. Run <code>python fetch_nfl_opportunity.py</code>, then <code>python build_report.py</code> to import it.</p>`) +
        `<h3>Starter opportunity leaderboard</h3><p class="sub">Only weeks you started these players, in completed regular-season games. xFP reflects opportunity quality; positive FPOE reflects production above the model’s expectation. It does not prove that a player will regress.</p>` +
        table(
          [
            "Season",
            "Player",
            "Pos",
            "Starts with model data",
            "xFP",
            "Modeled points",
            "FPOE",
            "Targets",
            "Carries",
            "Air yards",
            "NFL team xFP share*",
          ],
          weekPlayers.map((p) => [
            p.season,
            p.name,
            p.pos,
            p.starts,
            num(p.xfp),
            num(p.actual),
            signed(p.fpoe),
            p.targets,
            p.carries,
            num(p.airYards),
            p.shareWeeks ? num((100 * p.shareSum) / p.shareWeeks) + "%" : "—",
          ]),
        ) +
        `<p class="sub">*Average share of the player’s NFL team rushing and receiving xFP during fantasy starts, using standard PPR scoring. Passing is excluded; QB shares are omitted.</p><h3>Weekly roster evidence</h3><p class="sub">Summary averages use only fully covered offensive lineups. Partial weekly totals are omitted here; coverage counts identify missing player matches. Excluded starters are kickers, defenses or unmodeled positions.</p>` +
        table(
          [
            "Season",
            "Manager",
            "Week",
            "Offensive coverage",
            "Excluded starters",
            "xFP",
            "Modeled points",
            "FPOE",
          ],
          rows.map((w) => [
            w.season,
            manager(w.uid),
            w.week,
            `${w.covered}/${w.total}${w.complete ? "" : " · partial"}`,
            w.excluded,
            w.complete ? num(w.xfp) : "—",
            w.complete ? num(w.actual) : "—",
            w.complete ? signed(w.fpoe) : "—",
          ]),
        ) +
        modeled
          .map((s) => {
            const m = s.opportunity.model,
              c = s.opportunity.coverage || {};
            return `<details class="metric-guide"><summary>${esc(s.league.season)} (${esc(s.src)}) · model and coverage</summary><p class="sub">${esc(m.name)} · ${esc(m.training || "")} training data. ${esc(m.scope || "")} Model data through week ${esc(c.lastWeek ?? "—")}. Player matches: ${esc(c.matchedPlayers ?? "—")}/${esc(c.eligiblePlayers ?? "—")}. ${esc(m.license || "")}</p><p><a href="${esc(m.methodologyUrl || "https://ffopportunity.rbind.io/")}" target="_blank" rel="noreferrer">Model methodology</a> · <a href="${esc(m.sourceUrl || "https://github.com/ffverse/ffopportunity")}" target="_blank" rel="noreferrer">Published data and attribution</a></p>${c.missingPlayers?.length ? `<p class="sub">Unmatched players: ${esc(c.missingPlayers.join(", "))}</p>` : ""}</details>`;
          })
          .join("")
      );
    }
    function startsTable(rows, limit = rows.length) {
      const sorted = rows
        .slice()
        .sort(
          (a, b) =>
            b.starts - a.starts ||
            a.player.localeCompare(b.player) ||
            a.playerKey.localeCompare(b.playerKey),
        );
      let previous = null,
        rank = 0;
      return table(
        [
          "Rank",
          "Player",
          "Pos",
          "Starts",
          "Regular season",
          "Postseason",
          "Seasons",
          "Starter points",
          "Points/start",
        ],
        sorted.slice(0, limit).map((p, i) => {
          if (p.starts !== previous) rank = i + 1;
          previous = p.starts;
          return [
            rank,
            p.player,
            p.position || "—",
            p.starts,
            p.regularStarts,
            p.postseasonStarts,
            p.seasons.join(", "),
            num(p.points),
            p.points === null ? "—" : num(p.points / p.starts),
          ];
        }),
      );
    }
    function startsCoverage(managerId, seasonLabel = "all", games = "all") {
      const rows = (D.startCoverage || []).filter(
        (c) =>
          (managerId === "all" || c.uid === managerId) &&
          (seasonLabel === "all" || c.season === seasonLabel),
      );
      return (
        `<details class="metric-guide"><summary>Saved lineup coverage · ${games === "all" ? "all completed matchups" : games === "regular" ? "regular season" : "postseason"}</summary><p class="sub">Counts use recorded starter slots, including players who scored zero or negative points. Missing lineups can leave the rankings incomplete. Starter points and points/start are unavailable if any counted start lacks a player score. Postseason includes championship and consolation games; bye weeks do not count.</p>` +
        table(
          [
            "Manager",
            "Season",
            "Known lineups",
            "Completed / expected matchups",
            "Missing lineup weeks",
          ],
          rows.map((c) => {
            const season = D.sources.find(
                (s) => `${s.league.season} (${s.src})` === c.season,
              ),
              playoffStart = season?.league.settings?.playoff_week_start || 15,
              included = (week) =>
                games === "all" ||
                week >= playoffStart === (games === "postseason"),
              missing = c.missingWeeks.filter(included);
            return [
              n(c.uid),
              c.season,
              c.lineupWeekNumbers.filter(included).length,
              c.completedWeekNumbers.filter(included).length,
              missing.length ? missing.join(", ") : "None",
            ];
          }),
        ) +
        "</details>"
      );
    }
    function mostStarted() {
      const weeks = (D.playerStartWeeks || []).filter(
        (w) =>
          (startsSeason === "all" || w.season === startsSeason) &&
          (startsManager === "all" || w.uid === startsManager) &&
          (startsGames === "all" ||
            w.postseason === (startsGames === "postseason")) &&
          (startsPosition === "all" || w.position === startsPosition),
      );
      const rows = root.LeagueStats.summarizePlayerStarts(weeks);
      const positions = [
        ...new Set(
          (D.playerStartWeeks || []).map((w) => w.position).filter(Boolean),
        ),
      ].sort();
      const managers = startsManager === "all" ? ids : [startsManager];
      return (
        '<h2>Most started players</h2><p class="sub">The players each manager trusted most, across every saved season. Starts count once per player in a completed matchup. The Combined view joins the same NFL player across ESPN and Sleeper.</p><div class="filters">' +
        select("starts-manager", "Manager", managerOptions, startsManager) +
        select("starts-season", "Season", seasonOptions, startsSeason) +
        select(
          "starts-games",
          "Games",
          [
            ["all", "All completed matchups"],
            ["regular", "Regular season"],
            ["postseason", "Postseason"],
          ],
          startsGames,
        ) +
        select(
          "starts-position",
          "Position",
          [["all", "All positions"], ...positions.map((p) => [p, p])],
          startsPosition,
        ) +
        "</div>" +
        (startsManager === "all"
          ? '<p class="sub">Top 10 for each manager. Select a manager to see their full list. Tied start counts share a rank.</p>'
          : '<p class="sub">Full list for this manager. Tied start counts share a rank.</p>') +
        managers
          .map((uid) => {
            const players = rows.filter((r) => r.uid === uid);
            return (
              `<h3>${esc(n(uid))}</h3>` +
              startsTable(
                players,
                startsManager === "all" ? 10 : players.length,
              )
            );
          })
          .join("") +
        startsCoverage(startsManager, startsSeason, startsGames)
      );
    }
    const TRADE_RANK_METHODOLOGY =
      "How a manager has actually fared in trades. A trade’s margin is the starter points the incoming package produced minus what the other side’s package produced, over the weeks each team held those players — the same figures the trade analyzer reports. Net starter points sum those margins, so winning six trades by a point each is not mistaken for fleecing one team for two hundred; Rank by switches the ranking between that total, how often a manager came out ahead, and the average trade. Multi-team trades compare a package against the average of the others. A pair of trades that swaps players and hands the identical set back within one scoring week is removed from both managers’ records entirely, because the rosters end where they started and neither leg moved an asset. Draft picks and FAAB carry no point value, and a trade is left uncompared rather than scored as even when its import is incomplete or no completed weeks followed it.";
    const TRADE_LIST_METHODOLOGY =
      "Every trade this manager completed, newest first. Received and Sent list the player assets that moved. Received points are the starter points the incoming package produced from the first full week after the trade, while this manager still held those players; opponent points are the same figure for the other side, averaged across the others in a multi-team trade. Margin is the difference, and it is the same per-trade figure the trade ranking sums. Draft picks and FAAB are counted as extras but carry no point value, and a trade the analyzer could not compare keeps an unavailable margin rather than being scored as even.";
    const assetList = (names) => (names.length ? names.join(", ") : "\u2014");
    const profileTradeTable = (rows) => {
      const uncompared = rows.filter((r) => r.margin === null).length;
      return (
        table(
          [
            "Season",
            "Week",
            "Opponent",
            "Received",
            "Sent",
            "Received pts",
            "Opponent pts",
            "Margin",
          ],
          rows.map((r) => [
            r.season,
            intCell(r.week),
            r.opponents.length
              ? raw(r.opponents.map((u) => manager(u).html).join(", "))
              : "\u2014",
            assetList(r.received) + (r.extras ? ` (+${r.extras} pick/FAAB)` : ""),
            assetList(r.given),
            [known(r.receivedPoints), sortable(r.receivedPoints)],
            [known(r.against), sortable(r.against)],
            [r.margin === null ? "\u2014" : signed(r.margin), sortable(r.margin)],
          ]),
        ) +
        note([
          rows.length ? "" : "No completed trades for this manager.",
          uncompared
            ? `${plural(uncompared, "trade is", "trades are")} listed without a margin because the analyzer could not compare ${uncompared === 1 ? "it" : "them"}.`
            : "",
        ])
      );
    };
    const WAIVER_RANK_METHODOLOGY =
      "How a manager has fared working the wire, scored the same way as the waiver board: starter points from the week after each pickup until the manager dropped or traded the player away. Total pickup points reward finding a contributor and keeping him, points per start measures the rate instead, and hit rate is the share of counted pickups that ever reached a lineup — Rank by chooses which one orders the ranking. Commissioner moves are excluded, as are trades, which the trade ranking already values. Pickups whose scores never imported are counted as uncounted and are never scored as zero.";

    // Both rankings share a shape: one row per manager, ordered by whichever
    // measure the reader picked, with managers who have no measurable move left
    // unranked rather than parked at zero — a zero net would otherwise sit
    // above everyone who has ever lost a trade. Ties share a rank.
    const rankBy = (rows, measure, tiebreak) => {
      const list = rows
        .map((row) => ({ ...row, measure: measure(row) }))
        .sort(
          (a, b) =>
            (b.measure !== null) - (a.measure !== null) ||
            (b.measure ?? 0) - (a.measure ?? 0) ||
            tiebreak(a, b) ||
            n(a.uid).localeCompare(n(b.uid)),
        );
      let rank = 0;
      list.forEach((row, index) => {
        if (row.measure === null) {
          row.rank = null;
          return;
        }
        if (index === 0 || row.measure !== list[index - 1].measure) {
          rank = index + 1;
        }
        row.rank = rank;
      });
      return list;
    };
    const tradeRankSortOptions = [
      ["net", "Net starter points"],
      ["wins", "Trades won"],
      ["winRate", "Share of trades won"],
      ["avg", "Average margin"],
    ];
    const tradeRankMeasures = {
      net: (row) => (row.trades ? row.net : null),
      wins: (row) => (row.trades ? row.wins : null),
      winRate: (row) => (row.trades ? row.winRate : null),
      avg: (row) => (row.trades ? row.avg : null),
    };
    const waiverRankSortOptions = [
      ["pts", "Total pickup points"],
      ["perStart", "Points per start"],
      ["hitRate", "Hit rate"],
    ];
    const waiverRankMeasures = {
      pts: (row) => row.total,
      perStart: (row) => row.ptsPerStart,
      hitRate: (row) => row.hitRate,
    };
    const waiverRankBase = (() => {
      const rows = new Map(
        ids.map((uid) => [
          uid,
          {
            uid,
            pickups: 0,
            counted: 0,
            uncounted: 0,
            pts: 0,
            starts: 0,
            started: 0,
          },
        ]),
      );
      for (const p of D.pickups || []) {
        if (p.type !== "waiver" && p.type !== "free_agent") continue;
        const row = rows.get(p.uid);
        if (!row) continue;
        row.pickups++;
        if (p.pts === null || p.starts === null) {
          row.uncounted++;
          continue;
        }
        row.counted++;
        row.pts += p.pts;
        row.starts += p.starts;
        if (p.starts > 0) row.started++;
      }
      return [...rows.values()].map((row) => ({
        ...row,
        total: row.counted ? row.pts : null,
        ptsPerStart: row.starts ? row.pts / row.starts : null,
        hitRate: row.counted ? row.started / row.counted : null,
      }));
    })();
    const tradeRankRows = (order) =>
      rankBy(
        tradeRanks,
        tradeRankMeasures[order] || tradeRankMeasures.net,
        (a, b) => b.net - a.net || b.wins - a.wins || a.losses - b.losses,
      );
    const waiverRankRows = (order) =>
      rankBy(
        waiverRankBase,
        waiverRankMeasures[order] || waiverRankMeasures.pts,
        (a, b) => sortable(b.total) - sortable(a.total) || b.started - a.started,
      );
    const rankLabel = (row, list) =>
      row && row.rank
        ? `#${row.rank} / ${list.filter((entry) => entry.rank).length}`
        : "Unranked";
    const tradeRecord = (row) =>
      row && row.trades
        ? `${row.wins}-${row.losses}${row.even ? "-" + row.even : ""}`
        : "—";
    const note = (sentences) => {
      const text = sentences.filter(Boolean).join(" ");
      return text ? `<p class="sub">${esc(text)}</p>` : "";
    };
    const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
    const tradeRankTable = (rows) =>
      table(
        [
          "Rank",
          "Manager",
          "Trades",
          "Won-lost",
          "Share won",
          "Net starter points",
          "Average margin",
          "Best trade",
          "Worst trade",
          "Uncompared",
        ],
        rows.map((r) => [
          intCell(r.rank),
          manager(r.uid),
          intCell(r.trades),
          [tradeRecord(r), sortable(r.trades ? r.wins : null)],
          [percentage(r.winRate), sortable(r.winRate)],
          r.trades ? [signed(r.net), r.net] : numCell(null),
          r.avg === null ? numCell(null) : [signed(r.avg), r.avg],
          r.best
            ? [
                `${signed(r.best.margin)} · ${r.best.year} W${r.best.week}`,
                r.best.margin,
              ]
            : numCell(null),
          r.worst
            ? [
                `${signed(r.worst.margin)} · ${r.worst.year} W${r.worst.week}`,
                r.worst.margin,
              ]
            : numCell(null),
          intCell(r.uncomparable),
        ]),
      );
    const waiverRankTable = (rows) =>
      table(
        [
          "Rank",
          "Manager",
          "Pickups",
          "Counted",
          "Reached a lineup",
          "Hit rate",
          "Starts",
          "Pickup points",
          "Points per start",
          "Uncounted",
        ],
        rows.map((r) => [
          intCell(r.rank),
          manager(r.uid),
          intCell(r.pickups),
          intCell(r.counted),
          intCell(r.started),
          [percentage(r.hitRate), sortable(r.hitRate)],
          intCell(r.starts),
          numCell(r.total),
          numCell(r.ptsPerStart),
          intCell(r.uncounted),
        ]),
      );
    function profile() {
      if (!selected) return "<p>No managers available.</p>";
      const a = D.all[selected],
        tradeRanking = tradeRankRows(profileTradeSort),
        waiverRanking = waiverRankRows(profileWaiverSort),
        myTrades = tradeRanking.find((r) => r.uid === selected),
        myWaivers = waiverRanking.find((r) => r.uid === selected),
        profilePickups = pickupRows({
          managerId: selected,
          minStarts: profilePickupMinStarts,
          order: profilePickupSort,
        }),
        profileTrades = root.TradeAnalysis.managerTrades(
          tradeData.trades,
          selected,
        ),
        scores = D.scores.filter((s) => s[1] === selected),
        wins = D.games
          .filter((g) => g.winner === selected)
          .sort((a, b) => b.margin - a.margin),
        opponents = Object.entries(D.h2h[selected] || {}).sort(
          (a, b) => b[1][1] - a[1][1] || a[1][0] - b[1][0],
        );
      return (
        "<h2>Manager profile</h2>" +
        select(
          "profile-manager",
          "Manager",
          ids.map((u) => [u, n(u)]),
          selected,
        ) +
        `<h3>${esc(n(selected))}</h3>` +
        metricCards(a) +
        `<button data-download="${esc(selected)}">Download recap card (PNG)</button>` +
        "<h3>Season history</h3>" +
        table(
          ["Season", "Record", "Win %", "PF/game", "Playoffs", "Title"],
          D.bySeason.flatMap((s) =>
            s.rows
              .filter((r) => r.uid === selected)
              .map((r) => [
                s.season,
                rec(r),
                num(root.LeagueStats.rate(r) * 100) + "%",
                num(r.pf / (r.w + r.l + r.t || 1)),
                s.po.includes(selected) ? "Yes" : "—",
                s.champ === selected ? "🏆" : "—",
              ]),
          ),
        ) +
        '<h3>Most started players · all time</h3><p class="sub">Top 10 across completed regular-season, playoff and consolation matchups in this platform view.</p>' +
        startsTable(
          (D.playerStarts || []).filter((p) => p.uid === selected),
          10,
        ) +
        `<button data-player-starts="${esc(selected)}">See every started player</button>` +
        startsCoverage(selected) +
        '<h3>Sabermetric season lines</h3><p class="sub">Regular-season results adjusted to each week’s scoring environment. Missing lineup coverage is shown as —.</p>' +
        table(
          ["Season", ...saberColumns.slice(1)],
          (D.saber || [])
            .filter((s) => s.uid === selected)
            .map((s) => [s.season, ...saberCells(s).slice(1)]),
        ) +
        '<h3>Opportunity season lines</h3><p class="sub">Expected and actual points for covered offensive scoring components; regular season only.</p>' +
        opportunitySeasonTable(opportunityRows(selected, "all")) +
        "<h3>Regular-season scoring trend</h3>" +
        lineChart(
          scores.map((s) => ({
            label: `${s[2]} W${s[3]}`,
            values: [{ uid: selected, value: s[0] }],
          })),
          "Points",
        ) +
        "<h3>Biggest wins</h3>" +
        table(
          ["Season", "Week", "Opponent", "Score", "Margin"],
          wins
            .slice(0, 5)
            .map((g) => [
              g.season,
              g.week,
              manager(g.loser),
              `${num(Math.max(g.pa, g.pb))}–${num(Math.min(g.pa, g.pb))}`,
              num(g.margin),
            ]),
        ) +
        "<h3>Toughest opponents</h3>" +
        table(
          ["Opponent", "Wins", "Losses", "Ties"],
          opponents.slice(0, 5).map(([u, r]) => [manager(u), ...r]),
        ) +
        "<h3>Trade rankings</h3>" +
        `<p class="sub">${TRADE_RANK_METHODOLOGY}</p>` +
        cards([
          ["Trade rank", rankLabel(myTrades, tradeRanking)],
          ["Trades compared", myTrades ? myTrades.trades : 0],
          ["Won-lost", tradeRecord(myTrades)],
          [
            "Net starter points",
            myTrades && myTrades.trades ? signed(myTrades.net) : "—",
          ],
          [
            "Average margin",
            myTrades && myTrades.trades ? signed(myTrades.avg) : "—",
          ],
          [
            "Best trade",
            myTrades && myTrades.best ? signed(myTrades.best.margin) : "—",
          ],
        ]) +
        note([
          !myTrades || !myTrades.trades
            ? "No comparable trades, so this manager is unranked."
            : "",
          myTrades && myTrades.uncomparable
            ? `${plural(myTrades.uncomparable, "trade is", "trades are")} excluded because the analyzer could not compare ${myTrades.uncomparable === 1 ? "it" : "them"}.`
            : "",
        ]) +
        '<div class="filters">' +
        select(
          "profile-trade-sort",
          "Rank by",
          tradeRankSortOptions,
          profileTradeSort,
        ) +
        "</div>" +
        tradeRankTable(tradeRanking) +
        "<h3>Waiver rankings</h3>" +
        `<p class="sub">${WAIVER_RANK_METHODOLOGY}</p>` +
        cards([
          ["Waiver rank", rankLabel(myWaivers, waiverRanking)],
          ["Pickups", myWaivers ? myWaivers.pickups : 0],
          ["Pickup points", known(myWaivers ? myWaivers.total : null)],
          ["Points per start", known(myWaivers ? myWaivers.ptsPerStart : null)],
          [
            "Reached a lineup",
            percentage(myWaivers ? myWaivers.hitRate : null),
          ],
        ]) +
        note([
          !myWaivers || !myWaivers.counted
            ? "No counted waiver or free-agent pickups, so this manager is unranked."
            : "",
          myWaivers && myWaivers.uncounted
            ? `${plural(myWaivers.uncounted, "pickup is", "pickups are")} uncounted because its scores are unavailable.`
            : "",
        ]) +
        '<div class="filters">' +
        select(
          "profile-waiver-sort",
          "Rank by",
          waiverRankSortOptions,
          profileWaiverSort,
        ) +
        "</div>" +
        waiverRankTable(waiverRanking) +
        // Both ways this manager acquired players, in one switchable panel: the
        // rankings above say how well they did it, this says what they did. The
        // sort and minimum-starts filters belong to the pickup table, so they
        // only appear with it.
        "<h3>Every move for this manager</h3>" +
        '<div class="filters">' +
        `<div class="switch" role="group" aria-label="Which moves to show">${[
          ["trades", `Trades (${profileTrades.length})`],
          ["pickups", `Waiver pickups (${profilePickups.length})`],
        ]
          .map(
            ([key, label]) =>
              `<button data-profile-view="${key}"${profileMoveView === key ? ' class="on"' : ""} aria-pressed="${profileMoveView === key}">${esc(label)}</button>`,
          )
          .join("")}</div>` +
        (profileMoveView === "pickups"
          ? select(
              "profile-pickup-sort",
              "Rank by",
              pickupSortOptions,
              profilePickupSort,
            ) +
            sliderBox(
              "profile-pickup-min-starts",
              "Minimum starts",
              pickupMaxStarts,
              profilePickupMinStarts,
            )
          : "") +
        "</div>" +
        (profileMoveView === "pickups"
          ? `<p class="sub">${PICKUP_METHODOLOGY}</p>` +
            pickupPerStartNote(profilePickupSort, profilePickupMinStarts) +
            pickupTable(profilePickups, false)
          : `<p class="sub">${TRADE_LIST_METHODOLOGY}</p>` +
            profileTradeTable(profileTrades))
      );
    }
    function weekly() {
      const w = D.weeks[weekIndex];
      if (!w)
        return "<h2>Weekly wrapped</h2><p>No completed weeks available.</p>";
      const high = w.scores.slice().sort((a, b) => b.pts - a.pts)[0],
        close = w.games.slice().sort((a, b) => a.margin - b.margin)[0],
        upset = w.games
          .filter((g) => g.upset > 0)
          .sort((a, b) => b.upset - a.upset)[0];
      return (
        "<h2>Weekly wrapped</h2>" +
        select(
          "wrapped-week",
          "Week",
          D.weeks.map((w, i) => [i, `${w.season} · Week ${w.week}`]),
          weekIndex,
        ) +
        `<div class="cards"><div class="card"><span>Highest scorer</span><strong>${esc(n(high.uid))}</strong>${num(high.pts)} points</div><div class="card"><span>Closest matchup</span><strong>${close ? `${esc(n(close.a))} / ${esc(n(close.b))}` : "No paired matchup"}</strong>${close ? num(close.margin) + " point margin" : "Bye scores only"}</div><div class="card"><span>Biggest upset</span><strong>${upset ? esc(n(upset.winner)) : "No upset"}</strong>${upset ? `Beat ${esc(n(upset.loser))}; prior win-rate gap ${num(upset.upset * 100)} percentage points` : w.postseason ? "Postseason records are separate from regular-season upset rankings." : "No lower-win-rate team beat a higher-win-rate team."}</div></div><p class="sub">Upsets compare regular-season win rates before this week. Week 1 has no prior record. Standings use win percentage, then points scored.</p>` +
        "<h3>Matchups</h3>" +
        table(
          ["Manager", "Points", "Opponent", "Points", "Winner"],
          w.games.map((g) => [
            manager(g.a),
            num(g.pa),
            manager(g.b),
            num(g.pb),
            g.winner ? manager(g.winner) : "Tie",
          ]),
        ) +
        (w.postseason
          ? '<p class="sub">Postseason week: regular-season standings are final.</p>'
          : "<h3>Standings changes</h3>" +
            table(
              ["Rank", "Manager", "Movement"],
              w.changes.map((c) => [
                c.rank,
                manager(c.uid),
                w.week === 1
                  ? "Baseline"
                  : c.change > 0
                    ? `↑ ${c.change}`
                    : c.change < 0
                      ? `↓ ${-c.change}`
                      : "—",
              ]),
            ))
      );
    }
    function records() {
      const biggest = D.games
          .filter((g) => g.winner)
          .sort((a, b) => b.margin - a.margin)[0],
        boards = root.LeagueStats.rivalryBoards(D.rivalries),
        rivals = boards.competitive,
        rivalRow = (r) => [
          manager(r.a),
          manager(r.b),
          `${r.w}-${r.l}-${r.t}`,
          r.games,
          r.playoffGames ? `${r.playoffW}-${r.playoffL}${r.playoffT ? `-${r.playoffT}` : ""}` : "",
        ],
        rivalNote = " Records count regular-season games plus playoff games where both teams were still in title contention; consolation and placement games (like 3rd place) are left out. Playoffs shows the playoff part of the record.";
      return (
        "<h2>Records and rivalries</h2>" +
        `<p>Largest regular-season victory: ${biggest ? `${esc(n(biggest.winner))} over ${esc(n(biggest.loser))}, ${num(biggest.margin)} points (${esc(biggest.season)}, Week ${biggest.week}).` : "No decided games available."}</p>` +
        "<h3>Lowest single-week scores</h3>" +
        table(
          ["Points", "Manager", "Season", "Week"],
          D.scores
            .slice()
            .sort((a, b) => a[0] - b[0])
            .slice(0, 10)
            .map((s) => [num(s[0]), manager(s[1]), s[2], s[3]]),
        ) +
        "<h3>Biggest blowouts</h3>" +
        table(
          ["Season", "Week", "Winner", "Opponent", "Margin"],
          D.games
            .filter((g) => g.winner)
            .sort((a, b) => b.margin - a.margin)
            .slice(0, 10)
            .map((g) => [
              g.season,
              g.week,
              manager(g.winner),
              manager(g.loser),
              num(g.margin),
            ]),
        ) +
        "<h3>Closest games</h3>" +
        table(
          ["Season", "Week", "Manager", "Opponent", "Margin"],
          D.games
            .slice()
            .sort((a, b) => a.margin - b.margin)
            .slice(0, 10)
            .map((g) => [
              g.season,
              g.week,
              manager(g.a),
              manager(g.b),
              num(g.margin),
            ]),
        ) +
        '<h3>Longest winning streaks</h3><p class="sub">Consecutive completed regular-season wins within one season. Ties break a streak.</p>' +
        table(
          ["Manager", "Best streak"],
          ids
            .slice()
            .sort((a, b) => D.all[b].bestStreak - D.all[a].bestStreak)
            .map((u) => [manager(u), D.all[u].bestStreak]),
        ) +
        '<h3>Standings comebacks</h3><p class="sub">Largest rise from a prior weekly rank to the final available regular-season rank. Active seasons are provisional.</p>' +
        table(
          ["Manager", "Season", "Worst rank", "Latest rank", "Places gained"],
          D.comebacks
            .slice()
            .sort((a, b) => b.gain - a.gain)
            .slice(0, 15)
            .map((c) => [manager(c.uid), c.season, c.from, c.to, c.gain]),
        ) +
        '<h3>Most competitive rivalries</h3><p class="sub">At least two meetings, ordered by the smallest win imbalance as a fraction of meetings, then most meetings. Records include ties.' + rivalNote + '</p>' +
        table(
          ["Manager", "Opponent", "Record", "Meetings", "Playoffs"],
          rivals.slice(0, 15).map(rivalRow),
        ) +
        `<h3>Most one-sided rivalries</h3><p class="sub">At least ${boards.minOneSided} meetings, ordered by the leading manager's win percentage (ties count as half), then most meetings. The leading manager is listed first.${rivalNote}</p>` +
        table(
          ["Leader", "Opponent", "Record", "Meetings", "Playoffs"],
          boards.oneSided.slice(0, 15).map(rivalRow),
        ) +
        '<h3>Most frequent rivalries</h3><p class="sub">The pairs who have played each other the most, then the closest records. The manager with the better record is listed first.' + rivalNote + '</p>' +
        table(
          ["Manager", "Opponent", "Record", "Meetings", "Playoffs"],
          boards.frequent.slice(0, 15).map(rivalRow),
        )
      );
    }
    const DRAFT_METHODOLOGY =
      "Starter points are scored for the drafting manager only, through completed weeks and including playoffs. One table carries both measures; the Rank by filter chooses which one orders it, and any column heading can still be clicked to sort. <strong>Points/start</strong> is starter points ÷ starts against the start-weighted points per start for the same round and season — a rate, so a pick that played four good weeks is neither flattered nor penalized against one that played sixteen. <strong>Total starter points</strong> is measured against that round’s mean pick, which rewards availability. <strong>Points/week</strong> divides the same starter points by weeks rostered — the completed weeks the drafting manager actually carried the player — so a pick that was benched or dropped is charged for the weeks it occupied a roster spot without being charged for the weeks after it left. The three <strong>position peers</strong> measures swap the round baseline for the four picks taken nearest to this one at the same position and season, so a third-round running back is judged against the running backs who went around him rather than against the quarterbacks and kickers who shared his round; a pick is never its own peer, and a position too thin to supply two usable peers leaves the comparison unavailable rather than scoring itself as average. The per-week baseline is weighted by weeks held as the per-start one is weighted by starts, and it is the measure available for the most picks: a pick that never started still has a points-per-week figure, while points per start does not exist for it at all. Because a position’s first and last picks can only have peers on one side, their peer baselines lean on better- or worse-drafted company. The minimum-starts filter applies to every ranking but never moves any baseline. Picks the drafting manager never started are listed separately: a player drafted and then traded or dropped before week 1 produced zero points for a reason that is not a draft mistake. Late rounds are 8+, early rounds 1–3. This measures realized roster contribution, not talent or predictive value. Active seasons are to date. Starter points and points/start are unavailable if any counted start lacks a player score, and a pick is left out of whichever ranking it has no measure for.";
    const DRAFT_NEVER_STARTED_NOTE =
      "Drafted picks with zero starts for the drafting manager, earliest round first. Weeks rostered counts the completed weeks the player was on that manager’s roster. Zero weeks rostered means the pick never reached the drafting manager’s roster in a counted week — an immediate trade or drop, or a gap in the imported transaction history — so it is not ranked at all; a pick that was rostered and never started still ranks by total starter points.";
    const DRAFT_MAX_STARTS = 17;
    const draftColumns = [
      "Season",
      "Pick",
      "Round",
      "Player",
      "Pos",
      "Manager",
      "Starts",
      "Weeks",
      "Starter points",
      "Points/start",
      "Points/week",
      "Vs round average",
      "Vs round average per start",
      "Vs position peers",
      "Vs position peers per start",
      "Vs position peers per week",
    ];
    const draftCells = (p) => [
      p.season,
      p.pick,
      p.round,
      p.player,
      p.pos || "—",
      manager(p.uid),
      intCell(p.starts),
      intCell(p.rostered),
      numCell(p.pts),
      numCell(p.ptsPerStart),
      numCell(p.ptsPerWeek),
      [signed(p.value), sortable(p.value)],
      [signed(p.valuePerStart), sortable(p.valuePerStart)],
      [signed(p.peerValue), sortable(p.peerValue)],
      [signed(p.peerValuePerStart), sortable(p.peerValuePerStart)],
      [signed(p.peerValuePerWeek), sortable(p.peerValuePerWeek)],
    ];
    const draftNeverColumns = [
      "Season",
      "Pick",
      "Round",
      "Player",
      "Pos",
      "Manager",
      "Weeks rostered",
      "Status",
    ];
    const draftNeverCells = (p) => [
      p.season,
      p.pick,
      p.round,
      p.player,
      p.pos || "—",
      manager(p.uid),
      intCell(p.rostered),
      p.rostered === 0 ? "Never rostered" : "Rostered, never started",
    ];
    const draftSortOptions = [
      ["perStart", "Points per start"],
      ["value", "Total starter points"],
      ["posPerStart", "Points per start vs position peers"],
      ["posPerWeek", "Points per week vs position peers"],
      ["posValue", "Total starter points vs position peers"],
    ];
    // Each ranking needs its own measure, so a pick only appears when the
    // chosen one is available for it.
    const draftMetric = {
      perStart: "valuePerStart",
      value: "value",
      posPerStart: "peerValuePerStart",
      posPerWeek: "peerValuePerWeek",
      posValue: "peerValue",
    };
    const draftRateSorts = new Set(["perStart", "posPerStart"]);
    function drafts() {
      const key = draftMetric[draftSort] || draftMetric.value;
      const min = Number(draftMinStarts) || 0;
      const picks = D.drafts.filter(
        (p) => draftSeason === "all" || p.season === draftSeason,
      );
      const lateScope = (p) => p.round >= 8,
        earlyScope = (p) => p.round <= 3;
      // A pick that never reached the drafting manager's roster produced zero
      // starter points for a reason the draft cannot be judged on, so neither
      // measure ranks it. A pick that was rostered and never started is a real
      // disappointment and stays. Both appear in the list further down.
      const evaluable = (p) => p.rostered !== 0;
      const meetsMin = (p) =>
        min === 0 || (p.starts !== null && p.starts >= min);
      const board = (scope, worstFirst) =>
        picks
          .filter(
            (p) => scope(p) && evaluable(p) && meetsMin(p) && p[key] !== null,
          )
          .sort((a, b) => (worstFirst ? a[key] - b[key] : b[key] - a[key]))
          .slice(0, 10);
      const lateBoard = board(lateScope, false),
        earlyBoard = board(earlyScope, true),
        neverStarted = picks
          .filter((p) => p.starts === 0)
          .sort((a, b) => a.round - b.round || a.pick - b.pick);
      const rows = (ps) => ps.map(draftCells);
      // An in-progress season can have no pick above the minimum; say so rather
      // than letting the generic empty row imply there is no data at all.
      const boardOrNote = (ranked, scope) => {
        if (ranked.length) return table(draftColumns, rows(ranked));
        const played = picks.filter((p) => scope(p) && p.starts !== null);
        const best = played.length
          ? Math.max(...played.map((p) => p.starts))
          : 0;
        return `<p class="sub">No pick in this selection reached ${esc(min)} starts for its drafting manager. The most any pick reached is ${esc(best)}. Lower the minimum starts or choose a completed season.</p>`;
      };
      // Points per start over one or two starts is a single good week, not a
      // trend; warn as the waiver-pickup ranking does.
      const rateNote =
        draftRateSorts.has(draftSort) && min < 3
          ? '<p class="sub">Points per start rewards a single good week, so with a low minimum either end of this ranking can be a one-start pick. Raise the minimum starts to compare picks that actually held a lineup spot.</p>'
          : "";
      return (
        '<h2>Draft analysis</h2><div class="filters">' +
        select("draft-season", "Season", seasonOptions, draftSeason) +
        select("draft-sort", "Rank by", draftSortOptions, draftSort) +
        sliderBox(
          "draft-min-starts",
          "Minimum starts",
          DRAFT_MAX_STARTS,
          draftMinStarts,
        ) +
        "</div>" +
        `<p class="sub">${DRAFT_METHODOLOGY}</p>` +
        rateNote +
        "<h3>Late-round bargains</h3>" +
        boardOrNote(lateBoard, lateScope) +
        "<h3>Early-round disappointments</h3>" +
        boardOrNote(earlyBoard, earlyScope) +
        "<h3>Picks the drafting manager never started</h3>" +
        `<p class="sub">${DRAFT_NEVER_STARTED_NOTE}</p>` +
        table(draftNeverColumns, neverStarted.map(draftNeverCells)) +
        "<h3>Every pick</h3>" +
        table(
          draftColumns,
          rows(
            picks
              .slice()
              .sort(
                (a, b) =>
                  sortable(b[key]) - sortable(a[key]) ||
                  sortable(b.pts) - sortable(a.pts),
              ),
          ),
        )
      );
    }
    const pickupMaxStarts = Math.max(
      1,
      ...D.pickups.map((p) => (Number.isFinite(p.starts) ? p.starts : 0)),
    );
    const PICKUP_METHODOLOGY =
      "One row per completed waiver, free-agent or commissioner acquisition. Starter points begin the week after the acquisition and stop after the week of the next recorded drop or trade away, so the figures measure only what the player produced for the manager who picked him up. Same-week points are excluded because weekly snapshots cannot establish lineup timing. Points per start divides those points by starts. Click any column heading to sort; unavailable ESPN scores are marked — and sort last.";
    // -1e9 keeps unavailable values at the bottom of a descending sort instead
    // of falling back to the text comparison the sort helper uses for NaN.
    const sortable = (v) =>
      v === null || v === undefined || !Number.isFinite(Number(v))
        ? -1e9
        : Number(v);
    const numCell = (v) => [num(v), sortable(v)];
    const intCell = (v) => [
      v === null || v === undefined ? "—" : v,
      sortable(v),
    ];
    const pickupTypeLabel = (t) =>
      ({
        waiver: "Waiver",
        free_agent: "Free agent",
        commissioner: "Commissioner",
      })[t] || t;
    const pickupTypeOptions = [
      ["all", "Waivers + free agents"],
      ["waiver", "Waivers only"],
      ["free_agent", "Free agents only"],
      ["commissioner", "Commissioner moves only"],
    ];
    const pickupSortOptions = [
      ["pts", "Total points after pickup"],
      ["starts", "Starts after pickup"],
      ["perStart", "Points per start"],
      ["recent", "Most recent"],
    ];
    const pickupComparators = {
      pts: (a, b) => sortable(b.pts) - sortable(a.pts),
      starts: (a, b) =>
        sortable(b.starts) - sortable(a.starts) ||
        sortable(b.pts) - sortable(a.pts),
      perStart: (a, b) =>
        sortable(b.ptsPerStart) - sortable(a.ptsPerStart) ||
        sortable(b.starts) - sortable(a.starts),
      recent: (a, b) => b.date - a.date,
    };
    const pickupHeld = (p) =>
      p.exitWeek
        ? `W${p.fromWeek}–${p.toWeek}; left in W${p.exitWeek}`
        : p.fromWeek > p.toWeek
          ? "No completed weeks after pickup"
          : `W${p.fromWeek}–${p.toWeek}; still held`;
    const pickupPerStartNote = (order, minStarts) =>
      order === "perStart" && Number(minStarts) < 3
        ? '<p class="sub">Points per start rewards a single good week, so the top of this ranking can be a one-start pickup. Raise the minimum-starts filter to compare players who actually held a lineup spot.</p>'
        : "";
    function pickupRows(opts) {
      const {
        season = "all",
        type = "all",
        managerId = "all",
        minStarts = "0",
        order = "pts",
      } = opts || {};
      const min = Number(minStarts) || 0;
      return D.pickups
        .filter(
          (p) =>
            (season === "all" || p.season === season) &&
            (type === "all"
              ? p.type === "waiver" || p.type === "free_agent"
              : p.type === type) &&
            (managerId === "all" || p.uid === managerId) &&
            (min === 0 || (p.starts !== null && p.starts >= min)),
        )
        .sort(pickupComparators[order] || pickupComparators.pts);
    }
    function pickupTable(rows, showManager) {
      const headers = [
        "Season",
        "Week",
        "Type",
        ...(showManager ? ["Manager"] : []),
        "Player",
        "Pos",
        "Starts",
        "Points per start",
        "Points after pickup",
        "Weeks rostered",
        "Held",
        "Dropped in the same move",
      ];
      return table(
        headers,
        rows.map((p) => [
          p.season,
          intCell(p.week),
          pickupTypeLabel(p.type),
          ...(showManager ? [manager(p.uid)] : []),
          p.player,
          p.pos || "—",
          intCell(p.starts),
          numCell(p.ptsPerStart),
          numCell(p.pts),
          intCell(p.rostered),
          pickupHeld(p),
          p.dropped || "—",
        ]),
      );
    }
    function pickupBoard() {
      const rows = pickupRows({
        season: pickupSeason,
        type: pickupType,
        managerId: pickupManager,
        minStarts: pickupMinStarts,
        order: pickupSort,
      });
      return (
        '<h2>Best waiver pickups</h2><div class="filters">' +
        select("pickup-season", "Season", seasonOptions, pickupSeason) +
        select("pickup-type", "Type", pickupTypeOptions, pickupType) +
        select("pickup-manager", "Manager", managerOptions, pickupManager) +
        sliderBox(
          "pickup-min-starts",
          "Minimum starts",
          pickupMaxStarts,
          pickupMinStarts,
        ) +
        select("pickup-sort", "Rank by", pickupSortOptions, pickupSort) +
        "</div>" +
        `<p class="sub">${PICKUP_METHODOLOGY}</p>` +
        pickupPerStartNote(pickupSort, pickupMinStarts) +
        `<p class="sub">${esc(rows.length)} acquisition(s) match these filters.</p>` +
        pickupTable(rows, true)
      );
    }
    const dropMaxStarts = Math.max(
      1,
      ...D.drops.map((d) => (Number.isFinite(d.starts) ? d.starts : 0)),
    );
    const DROP_METHODOLOGY =
      "One row per completed non-trade drop that another manager then claimed. Starter points begin the week after that claim and stop after the week of the next recorded drop or trade away, and follow the player across every roster that claimed him, so the figures measure only what the drop handed the rest of the league. If the dropping manager wins the player back, the window closes there: nothing he scores for his original roster again counts against the drop. Trades are excluded because the player never reached waivers, so nobody else had the chance to claim him, and drops nobody claimed are excluded because they cost nothing. Same-week points are excluded because weekly snapshots cannot establish lineup timing. Click any column heading to sort; unavailable ESPN scores are marked — and sort last.";
    const DROP_ADJUSTMENT_NOTE =
      "A kicker and a quarterback cannot be compared on raw points per start, so the adjusted column subtracts the start-weighted mean points per start at that position for the season, taken from every start in the league. A positive figure means the player was worth more per start than a replacement start at his position, which is what makes the drop expensive.";
    const dropSortOptions = [
      ["value", "Points per start above position"],
      ["perStart", "Points per start"],
      ["pts", "Total points for other teams"],
      ["starts", "Starts for other teams"],
      ["recent", "Most recent"],
    ];
    const dropComparators = {
      value: (a, b) =>
        sortable(b.valuePerStart) - sortable(a.valuePerStart) ||
        sortable(b.starts) - sortable(a.starts),
      perStart: (a, b) =>
        sortable(b.ptsPerStart) - sortable(a.ptsPerStart) ||
        sortable(b.starts) - sortable(a.starts),
      pts: (a, b) => sortable(b.pts) - sortable(a.pts),
      starts: (a, b) =>
        sortable(b.starts) - sortable(a.starts) ||
        sortable(b.pts) - sortable(a.pts),
      recent: (a, b) => b.date - a.date,
    };
    const dropPerStartNote = (order, minStarts) =>
      ["value", "perStart"].includes(order) && Number(minStarts) < 3
        ? '<p class="sub">Both per-start rankings reward a single good week, so the top of this board can be a player who started once elsewhere. Raise the minimum-starts filter to compare drops that cost a lineup spot all season.</p>'
        : "";
    const dropClaimed = (d) =>
      (d.reclaimedWeek
        ? `Claimed W${d.claimedWeek}; back in W${d.reclaimedWeek}`
        : `Claimed W${d.claimedWeek}`) +
      (d.claims > 1 ? ` · ${d.claims} claims` : "");
    function dropRows(opts) {
      const {
        season = "all",
        managerId = "all",
        minStarts = "0",
        order = "value",
      } = opts || {};
      const min = Number(minStarts) || 0;
      return D.drops
        .filter(
          (d) =>
            (season === "all" || d.season === season) &&
            (managerId === "all" || d.uid === managerId) &&
            (min === 0 || (d.starts !== null && d.starts >= min)),
        )
        .sort(dropComparators[order] || dropComparators.value);
    }
    function dropTable(rows) {
      const headers = [
        "Season",
        "Week",
        "Manager who dropped",
        "Player",
        "Pos",
        "Claimed by",
        "Starts elsewhere",
        "Points per start",
        "Per start above position",
        "Points for other teams",
        "Claimed",
      ];
      return table(
        headers,
        rows.map((d) => [
          d.season,
          intCell(d.week),
          manager(d.uid),
          d.player,
          d.pos || "—",
          raw(d.claimants.map((u) => esc(n(u))).join(", ") || "—"),
          intCell(d.starts),
          numCell(d.ptsPerStart),
          numCell(d.valuePerStart),
          numCell(d.pts),
          dropClaimed(d),
        ]),
      );
    }
    function dropBoard() {
      const rows = dropRows({
        season: dropsSeason,
        managerId: dropsManager,
        minStarts: dropsMinStarts,
        order: dropsSort,
      });
      return (
        '<h2>Worst drops</h2><div class="filters">' +
        select("drops-season", "Season", seasonOptions, dropsSeason) +
        select("drops-manager", "Manager", managerOptions, dropsManager) +
        sliderBox(
          "drops-min-starts",
          "Minimum starts",
          dropMaxStarts,
          dropsMinStarts,
        ) +
        select("drops-sort", "Rank by", dropSortOptions, dropsSort) +
        "</div>" +
        `<p class="sub">${DROP_METHODOLOGY}</p>` +
        `<p class="sub">${DROP_ADJUSTMENT_NOTE}</p>` +
        dropPerStartNote(dropsSort, dropsMinStarts) +
        `<p class="sub">${esc(rows.length)} drop(s) match these filters.</p>` +
        dropTable(rows)
      );
    }
    // The waiver tab holds both halves of the wire: what managers gained from
    // it and what they handed to it.
    function waiverBoard() {
      return pickupBoard() + dropBoard();
    }
    function moves() {
      const filtered = D.moves.filter(
        (m) =>
          (moveSeason === "all" || m.season === moveSeason) &&
          (moveType === "all" || m.type === moveType) &&
          (moveManager === "all" ||
            [...m.adds, ...m.drops].some((a) => a.uid === moveManager)),
      );
      return (
        '<h2>Trades and waivers</h2><div class="filters">' +
        select("move-season", "Season", seasonOptions, moveSeason) +
        select(
          "move-type",
          "Type",
          [
            ["all", "All types"],
            ["trade", "Trades"],
            ["waiver", "Waivers"],
            ["free_agent", "Free agents"],
          ],
          moveType,
        ) +
        select("move-manager", "Manager", managerOptions, moveManager) +
        '</div><p class="sub">Completed transactions only, newest first. This is the raw transaction log: acquisitions share one cell with their points so trades, picks and FAAB stay together, which means the column cannot be sorted. For a sortable one-row-per-acquisition view, use the Best waiver pickups section. Subsequent starter points begin the week after acquisition and stop after the week of the next recorded drop or trade away. Same-week points are excluded because weekly snapshots cannot establish lineup timing. ESPN coverage depends on retained historical data; unavailable scores are marked —.</p>' +
        table(
          [
            "Season",
            "Week",
            "Type",
            "Acquisitions · subsequent starter points",
            "Departures",
            "Draft picks",
            "FAAB transfers",
          ],
          filtered
            .slice()
            .sort((a, b) => b.date - a.date)
            .map((m) => [
              m.season,
              m.week,
              m.type,
              m.adds
                .map(
                  (a) =>
                    `${n(a.uid)}: ${a.player} (${num(a.pts)} pts, ${num(a.starts)} starts)`,
                )
                .join("; ") ||
                (m.details_incomplete ? "Player details unavailable" : "—"),
              m.drops.map((a) => `${n(a.uid)}: ${a.player}`).join("; ") || "—",
              m.picks
                .map(
                  (p) =>
                    `${p.season} round ${p.round}, original team ${rosterName(m.season, p.roster_id)}; ${rosterName(m.season, p.previous_owner_id)} → ${rosterName(m.season, p.owner_id)}`,
                )
                .join("; ") || "—",
              m.budget
                .map(
                  (b) =>
                    `${b.amount} (${rosterName(m.season, b.sender)} → ${rosterName(m.season, b.receiver)})`,
                )
                .join("; ") || "—",
            ]),
        )
      );
    }
    const known = (value) =>
      typeof value === "number" && Number.isFinite(value) ? num(value) : "—";
    const percentage = (value) =>
      typeof value === "number" && Number.isFinite(value)
        ? `${num(value * 100)}%`
        : "—";
    const tradeKey = (t) => `${t.season}|${t.id}`;
    function tradeResultsTable(trade) {
      const rows = trade.participants.flatMap((p) =>
        [
          ["Before the trade", p.before],
          ["After the trade", p.after],
          ["Postseason after trade", p.postseason],
        ].map(([period, r]) => [
          manager(p.uid),
          period,
          r.games ? rec(r) : "—",
          r.games,
          percentage(r.winPct),
          known(r.ppg),
          known(r.scoringPlus),
          known(r.expected),
          known(r.expectedPerGame),
          r.missingWeeks
            ? `${r.missingWeeks} week(s) without a paired result`
            : r.games
              ? "Covered"
              : "No applicable weeks",
        ]),
      );
      return table(
        [
          "Manager",
          "Period",
          "Record",
          "Games",
          "Win %",
          "PF/game",
          "Scoring+",
          "xW",
          "xW/game",
          "Coverage",
        ],
        rows,
      );
    }
    function tradePackage(p, direction, t) {
      const received = direction === "received",
        assets = received ? p.received : p.given,
        picks = received ? p.picksReceived : p.picksGiven,
        budget = received ? p.budgetReceived : p.budgetGiven;
      let html =
        `<h4>${received ? "Received" : "Sent"}</h4>` +
        table(
          [
            "Player",
            "Pos",
            "Starts with recipient",
            "Regular-season points",
            "Postseason points",
            "Starter points",
            "Holding period",
          ],
          assets.map((a) => [
            a.player,
            a.pos || "—",
            a.starts ?? "—",
            known(a.regularPoints),
            known(a.postseasonPoints),
            known(a.pts),
            a.fromWeek <= a.toWeek
              ? `W${a.fromWeek}–${a.toWeek}${a.exitWeek ? `; left in W${a.exitWeek}` : ""}`
              : "No completed scoring weeks",
          ]),
        );
      if (picks.length)
        html += `<p>${picks.map((pick) => `${esc(pick.season)} round ${esc(pick.round)} pick (original team ${esc(rosterName(t.season, pick.roster_id))})`).join(" · ")}</p>`;
      if (budget.length)
        html += `<p>FAAB: ${budget.map((b) => esc(b.amount)).join(" + ")}</p>`;
      return html;
    }
    function tradeAnalyzer() {
      const trades = tradeData.trades.filter(
        (t) =>
          (tradeSeason === "all" || t.season === tradeSeason) &&
          (tradeManager === "all" ||
            t.participants.some((p) => p.uid === tradeManager)),
      );
      const t = trades.find((t) => tradeKey(t) === selectedTrade) || trades[0];
      selectedTrade = t ? tradeKey(t) : "";
      const intro =
        '<h2>Trade analyzer</h2><p class="sub">See what each team received, how its season changed, and how much the acquired players actually contributed.</p>' +
        (tradeData.coverage.excludedReversals
          ? `<p class="sub">${esc(tradeData.coverage.excludedReversals)} trade(s) were swapped back within one scoring week and are excluded; the rosters ended where they started.</p>`
          : "") +
        '<div class="filters">' +
        select("trade-season", "Season", seasonOptions, tradeSeason) +
        select("trade-manager", "Manager", managerOptions, tradeManager) +
        "</div>";
      if (!t) return intro + "<p>No completed trades match these filters.</p>";
      const choice = select(
        "trade-choice",
        "Trade",
        trades.map((a) => [
          tradeKey(a),
          `${a.season} · Week ${a.week} · ${a.participants.map((p) => n(p.uid)).join(" / ")}`,
        ]),
        selectedTrade,
      );
      const balance = t.balance;
      const summaries = t.participants.map((p) => {
        const delta =
          p.before.ppg === null || p.after.ppg === null
            ? null
            : p.after.ppg - p.before.ppg;
        return [
          manager(p.uid),
          known(p.receivedPoints),
          known(p.givenPoints),
          p.after.games ? rec(p.after) : "—",
          delta === null ? "—" : signed(delta),
        ];
      });
      const weekly = [
        ...new Set(
          t.participants.flatMap((p) =>
            [...p.before.weekly, ...p.after.weekly].map((w) => w.week),
          ),
        ),
      ]
        .sort((a, b) => a - b)
        .map((week) => ({
          label: `W${week}${week < t.week ? " · before" : " · after"}`,
          values: t.participants.flatMap((p) => {
            const w = [...p.before.weekly, ...p.after.weekly].find(
              (w) => w.week === week,
            );
            return w ? [{ uid: p.uid, value: w.points }] : [];
          }),
        }));
      return (
        intro +
        choice +
        `<p class="sub">Completion week: ${esc(t.week)}${t.reportedWeek !== t.week ? ` (API originally reported week ${esc(t.reportedWeek ?? "unknown")})` : ""}. The completion week is excluded from both before and after comparisons.</p>` +
        `<div class="cards"><div class="card"><span>Starter-point balance</span><strong>${balance.comparable ? `${known(balance.score)} / 100` : "Unavailable"}</strong></div><div class="card"><span>Package contribution gap</span><strong>${known(balance.gap)}${balance.gap !== null ? " pts" : ""}</strong></div><div class="card"><span>Higher received contribution</span><strong>${balance.comparable && balance.leaderUid ? esc(n(balance.leaderUid)) : balance.comparable ? "Equal" : "—"}</strong></div></div>` +
        '<p class="sub">100 means equal received starter points; lower values mean a larger gap. This is realized contribution while each recipient held the players, including a playoff bye week, which scores a lineup without producing a win or a loss. Trades reversed within one scoring week are excluded from the analyzer and from the rankings. Picks, FAAB, bench value, positional scarcity and replacement players are not valued. A better record after a trade does not establish that the trade caused it.</p>' +
        (balance.reason ? `<p>${esc(balance.reason)}</p>` : "") +
        t.warnings.map((w) => `<p class="sub">${esc(w)}</p>`).join("") +
        (t.rosterCuts?.length
          ? `<p class="sub">Other roster cuts recorded with this trade: ${t.rosterCuts.map((a) => `${esc(n(a.uid))}: ${esc(a.player)}`).join("; ")}. These are separate from the traded packages.</p>`
          : "") +
        table(
          [
            "Manager",
            "Received starter points",
            "Sent package points with recipients",
            "Regular-season record after",
            "PF/game change",
          ],
          summaries,
        ) +
        '<h3>Season before and after</h3><p class="sub">Regular-season results are separate from postseason. Scoring+ compares scoring to the same weeks’ league average; xW uses all-play win shares. No games means unavailable. Weeks without a recorded matchup can include byes or missing data.</p>' +
        tradeResultsTable(t) +
        '<h3>Scoring before and after</h3><p class="sub">Completed regular-season matchups; the trade’s completion week is omitted.</p>' +
        lineChart(weekly, "Fantasy points") +
        t.participants
          .map(
            (p) =>
              `<h3>${esc(n(p.uid))} · trade package</h3>` +
              tradePackage(p, "received", t) +
              tradePackage(p, "given", t),
          )
          .join("") +
        '<p class="sub">Player points begin the first full week after completion and stop before a later transfer week. “Sent package points” are what those players scored in their recipients’ lineups, not points their original manager necessarily would have scored.</p>'
      );
    }
    const comebackKey = (g) => `${g.season}|${g.week}|${g.matchupId}`;
    const checkpoint = (g) =>
      g.method === "reconstructed_day_boundary"
        ? "Between NFL game days"
        : "Recorded live snapshot";
    function comebacks() {
      const seasons = D.sources.filter(
          (s) =>
            comebackSeason === "all" ||
            `${s.league.season} (${s.src})` === comebackSeason,
        ),
        result = root.ComebackHistory.analyze(seasons),
        all = result.comebacks.filter(
          (g) =>
            comebackManager === "all" ||
            [g.winnerUid, g.loserUid].includes(comebackManager),
        ),
        games = all
          .filter(
            (g) =>
              comebackRanking !== "probability" ||
              g.lowestWinProbability !== null,
          )
          .sort((a, b) =>
            comebackRanking === "probability"
              ? a.lowestWinProbability - b.lowestWinProbability ||
                b.maxDeficit - a.maxDeficit
              : b.maxDeficit - a.maxDeficit,
          ),
        chosen =
          games.find((g) => comebackKey(g) === selectedComeback) || games[0];
      selectedComeback = chosen ? comebackKey(chosen) : "";
      return (
        '<h2>Largest comebacks</h2><p class="sub">Matchups a team won after trailing in the available score history. Historical day-boundary scores are reconstructed from final starter points and actual NFL game dates; live captures can show finer changes.</p><div class="filters">' +
        select("comeback-season", "Season", seasonOptions, comebackSeason) +
        select("comeback-manager", "Manager", managerOptions, comebackManager) +
        select(
          "comeback-ranking",
          "Rank by",
          [
            ["deficit", "Largest recorded score deficit"],
            ["probability", "Lowest recorded fantasy win chance"],
          ],
          comebackRanking,
        ) +
        "</div>" +
        `<p class="sub">Score history covers ${result.coverage.sampledMatchups} / ${result.coverage.completedMatchups} completed matchups in the selected seasons. Fantasy win-probability history covers ${result.coverage.probabilityMatchups}. Missing checkpoints can hide larger deficits.</p>` +
        '<p class="sub">Sleeper’s weekly API does not supply historical fantasy win odds. NFL game win probability describes the NFL game and cannot substitute for your fantasy matchup. No odds are estimated here; a final win is an outcome, not evidence that a calibrated model reached 100%.</p>' +
        table(
          [
            "Season",
            "Week",
            "Comeback winner",
            "Opponent",
            "Deficit recovered",
            "Lowest recorded win chance",
            "Final score",
            "Checkpoints",
            "History",
          ],
          games.map((g) => [
            g.season,
            g.week,
            manager(g.winnerUid),
            manager(g.loserUid),
            known(g.maxDeficit),
            percentage(g.lowestWinProbability),
            `${num(g.winnerPoints)}–${num(g.loserPoints)}`,
            g.samples,
            checkpoint(g),
          ]),
        ) +
        (!games.length
          ? comebackRanking === "probability"
            ? "<p>No historical fantasy win-probability snapshots are available for these filters. Choose “Largest recorded score deficit” to see the comebacks supported by score history.</p>"
            : "<p>No eligible comeback history is available for these filters.</p>"
          : "<h3>Comeback score history</h3>" +
            select(
              "comeback-choice",
              "Matchup",
              games.map((g) => [
                comebackKey(g),
                `${g.season} · Week ${g.week} · ${n(g.winnerUid)} over ${n(g.loserUid)}`,
              ]),
              selectedComeback,
            ) +
            `<p class="sub">${esc(checkpoint(chosen))}. Values at available checkpoints use the eventual winner’s perspective. A negative deficit means the winner was ahead.</p>` +
            table(
              [
                "Checkpoint",
                "Winner’s score then",
                "Opponent’s score then",
                "Deficit",
                "Fantasy win chance",
              ],
              chosen.trace.map((p) => [
                p.checkpoint || p.checkpointLabel || p.capturedAt,
                known(p.winnerPoints),
                known(p.loserPoints),
                known(p.deficit),
                percentage(p.winProbability),
              ]),
            )) +
        '<details><summary>Standings recoveries across the season</summary><p class="sub">A separate kind of comeback: climbing from a prior weekly standings rank to the final available rank. Active seasons are provisional.</p>' +
        table(
          [
            "Manager",
            "Season",
            "Worst prior rank",
            "Final available rank",
            "Places gained",
          ],
          D.comebacks
            .filter(
              (c) =>
                (comebackSeason === "all" || c.season === comebackSeason) &&
                (comebackManager === "all" || c.uid === comebackManager),
            )
            .sort((a, b) => b.gain - a.gain)
            .map((c) => [manager(c.uid), c.season, c.from, c.to, c.gain]),
        ) +
        "</details>"
      );
    }
    const colors = [
      "#2563eb",
      "#db2777",
      "#16a34a",
      "#ea580c",
      "#9333ea",
      "#0891b2",
      "#ca8a04",
      "#dc2626",
      "#4f46e5",
      "#059669",
      "#be185d",
      "#64748b",
      "#7c3aed",
      "#92400e",
    ];
    function lineChart(points, yLabel) {
      if (!points.length) return "<p>No scores available.</p>";
      const series = [
          ...new Set(points.flatMap((p) => p.values.map((v) => v.uid))),
        ],
        max = Math.max(
          1,
          ...points.flatMap((p) => p.values.map((v) => v.value)),
        ),
        W = 900,
        H = 310,
        left = 62,
        right = 30,
        top = 20,
        bottom = 90,
        x = (i) =>
          left + (i * (W - left - right)) / Math.max(1, points.length - 1),
        y = (v) => H - bottom - (v / max) * (H - top - bottom);
      let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)} comparison"><title>${esc(yLabel)} comparison</title>`;
      for (let i = 0; i <= 4; i++) {
        const v = (max * i) / 4;
        svg += `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" opacity=".15"/><text x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`;
      }
      series.forEach((uid, j) => {
        let segment = [];
        const flush = () => {
          if (segment.length)
            svg += `<polyline fill="none" stroke="${colors[j % colors.length]}" stroke-width="2" points="${segment.join(" ")}"/>`;
          segment = [];
        };
        points.forEach((p, i) => {
          const v = p.values.find((v) => v.uid === uid);
          if (!v) {
            flush();
            return;
          }
          segment.push(`${x(i)},${y(v.value)}`);
          svg += `<circle cx="${x(i)}" cy="${y(v.value)}" r="4" fill="${colors[j % colors.length]}"><title>${esc(n(uid))}: ${num(v.value)} · ${esc(p.label)}</title></circle>`;
        });
        flush();
      });
      points.forEach((p, i) => {
        if (
          points.length > 16 &&
          i % Math.ceil(points.length / 12) !== 0 &&
          i !== points.length - 1
        )
          return;
        svg += `<text transform="translate(${x(i)},${H - bottom + 18}) rotate(25)" font-size="10">${esc(p.label)}</text>`;
      });
      svg += "</svg>";
      return `<div class="chart">${svg}</div><div class="legend">${series.map((u, i) => `<span style="border-left:4px solid ${colors[i % colors.length]}">${esc(n(u))}</span>`).join("")}</div>`;
    }
    function charts() {
      const seasons = D.bySeason.filter(
          (s) => chartSource === "all" || s.src === chartSource,
        ),
        points = seasons.map((s) => ({
          label: s.season,
          values: s.rows
            .filter((r) => chartManager === "all" || r.uid === chartManager)
            .map((r) => ({
              uid: r.uid,
              value:
                chartMetric === "pf"
                  ? r.pf / (r.w + r.l + r.t || 1)
                  : root.LeagueStats.rate(r) * 100,
            })),
        }));
      return (
        '<h2>Season comparisons</h2><div class="filters">' +
        select(
          "chart-source",
          "Platform",
          [
            ["all", "All platforms"],
            ...new Set(D.bySeason.map((s) => s.src)),
          ].map((x) => (Array.isArray(x) ? x : [x, x])),
          chartSource,
        ) +
        select("chart-manager", "Manager", managerOptions, chartManager) +
        select(
          "chart-metric",
          "Metric",
          [
            ["pf", "Points per game"],
            ["win", "Win percentage"],
          ],
          chartMetric,
        ) +
        '</div><p class="sub">Active seasons show totals to date. Hover a chart point for its value; exact values are in the table below.</p>' +
        lineChart(points, chartMetric === "pf" ? "Points per game" : "Win %") +
        table(
          ["Season", "Manager", "PF/game", "Win %"],
          seasons.flatMap((s) =>
            s.rows
              .filter((r) => chartManager === "all" || r.uid === chartManager)
              .map((r) => [
                s.season,
                manager(r.uid),
                num(r.pf / (r.w + r.l + r.t || 1)),
                num(root.LeagueStats.rate(r) * 100) + "%",
              ]),
          ),
        )
      );
    }
    function sharing() {
      return (
        "<h2>Shareable recap cards</h2><p>Download a PNG with a manager’s record, all-time rank, titles, best week, and schedule luck for the selected platform view.</p>" +
        select(
          "profile-manager",
          "Manager",
          ids.map((u) => [u, n(u)]),
          selected,
        ) +
        (selected
          ? `<div class="recap-preview"><img class="recap-image" alt="${esc(n(selected))} League Wrapped recap card" src="${cardCanvas(selected).toDataURL("image/png")}"><button data-download="${esc(selected)}">Download recap card (PNG)</button></div>`
          : "<p>No managers available.</p>")
      );
    }
    function cardCanvas(uid) {
      const a = D.all[uid],
        canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 630;
      const c = canvas.getContext("2d");
      c.fillStyle = "#101827";
      c.fillRect(0, 0, 1200, 630);
      c.fillStyle = "#67e8f9";
      c.font = "bold 26px system-ui";
      c.fillText("LEAGUE WRAPPED", 60, 65);
      c.fillStyle = "#fff";
      c.font = "bold 64px system-ui";
      c.fillText(n(uid), 60, 150, 1080);
      const ranking =
          ids
            .slice()
            .sort(
              (u, v) =>
                root.LeagueStats.rate(D.all[v]) -
                  root.LeagueStats.rate(D.all[u]) || D.all[v].pf - D.all[u].pf,
            )
            .indexOf(uid) + 1,
        best = D.scores
          .filter((s) => s[1] === uid)
          .sort((a, b) => b[0] - a[0])[0];
      c.font = "24px system-ui";
      c.fillStyle = "#cbd5e1";
      c.fillText(
        `${a.seasons} seasons · ${[...new Set(D.bySeason.map((s) => s.src))].join(" + ")} · ${D.bySeason
          .map((s) => s.year)
          .filter((y, i, arr) => arr.indexOf(y) === i)
          .join(", ")}`,
        60,
        205,
        1080,
      );
      const items = [
        ["RECORD", rec(a)],
        ["ALL-TIME RANK", `#${ranking} / ${ids.length}`],
        ["TITLES", String(a.titles)],
        ["WIN RATE", num(root.LeagueStats.rate(a) * 100) + "%"],
        ["BEST WEEK", best ? num(best[0]) + " pts" : "—"],
        ["SCHEDULE LUCK", signed(a.actual - a.expected)],
      ];
      items.forEach(([k, v], i) => {
        const x = 60 + (i % 3) * 370,
          y = 290 + Math.floor(i / 3) * 130;
        c.fillStyle = "#94a3b8";
        c.font = "20px system-ui";
        c.fillText(k, x, y);
        c.fillStyle = "#fff";
        c.font = "bold 42px system-ui";
        c.fillText(v, x, y + 55);
      });
      c.fillStyle = "#94a3b8";
      c.font = "18px system-ui";
      c.fillText(
        best
          ? `Best week: ${best[2]} · Week ${best[3]}   |   Active season results are provisional.`
          : "Active season results are provisional.",
        60,
        595,
        1080,
      );
      return canvas;
    }
    function download(uid) {
      const link = document.createElement("a");
      link.href = cardCanvas(uid).toDataURL("image/png");
      link.download = `league-wrapped-${n(uid).replace(/[^a-z0-9]/gi, "-")}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    // The landing view. Opening on a menu rather than one season's table is
    // what lets the league loader live in one place: index.html shows its
    // league box only while this section is active, keyed off
    // data-active-section. "home" is deliberately NOT a chat section - it has
    // no statistics of its own, and chat-widget.js already falls back to
    // overview for an id it does not know, which keeps MAX_FACTS untouched.
    function mainMenu() {
      const platforms = [...new Set(D.sources.map((s) => s.src))].join(" + ");
      return (
        `<h2>Main menu</h2><p class="sub">${esc(String(D.sources.length))} season${D.sources.length === 1 ? "" : "s"} loaded${platforms ? ` \u00b7 ${esc(platforms)}` : ""}. Pick a feature.</p>` +
        '<div class="menu-grid">' +
        groups
          .filter(([, members]) => !members.includes("home"))
          .map(
            ([label, members]) =>
              `<div class="menu-card"><h3>${esc(label)}</h3>` +
              members
                .map(
                  (k) =>
                    `<button class="menu-link" data-section="${k}">${esc(sections[k][0])}</button>`,
                )
                .join("") +
              "</div>",
          )
          .join("") +
        "</div>"
      );
    }
    // Section ids are the chat contract, so they stay in step with SECTIONS in
    // server.mjs and SECTION_LABELS in chat-context.cjs (invariant 8). The
    // labels here are only what a sub-tab reads.
    const sections = {
      home: ["Main menu", mainMenu],
      overview: ["This season", overview],
      weekly: ["Weekly wrapped", weekly],
      profile: ["Manager profiles", profile],
      starts: ["Most started players", mostStarted],
      sharing: ["Recap cards", sharing],
      drafts: ["Draft analysis", drafts],
      pickups: ["Waiver wire", waiverBoard],
      trades: ["Trade analyzer", tradeAnalyzer],
      moves: ["Transaction log", moves],
      alltime: ["All-time standings", allTime],
      charts: ["Season comparisons", charts],
      records: ["Records & rivalries", records],
      comebacks: ["Largest comebacks", comebacks],
      saber: ["Sabermetrics", sabermetrics],
      opportunity: ["xFP & opportunity", opportunity],
      luck: ["Luck rankings", luck],
    };
    // Grouping is presentation only: sixteen flat tabs do not fit on one row.
    // The active group is derived from the active section, so navigation keeps
    // one piece of state and a group needs no id of its own.
    const groups = [
      ["Main menu", ["home"]],
      ["Current season", ["overview", "weekly"]],
      ["Managers", ["profile", "starts", "sharing"]],
      ["Roster building", ["drafts", "pickups", "trades", "moves"]],
      ["League history", ["alltime", "charts", "records", "comebacks"]],
      ["Stat Lab", ["saber", "opportunity", "luck"]],
    ];
    const groupOf = (id) =>
      Math.max(
        groups.findIndex(([, members]) => members.includes(id)),
        0,
      );
    // An explicit #hash wins, then the section a previous mount was showing
    // (index.html re-mounts this element over the live refresh), then Overview.
    const hashSection = String(root.location?.hash || "").slice(1);
    if (Object.hasOwn(sections, hashSection)) section = hashSection;
    else if (!Object.hasOwn(sections, section)) section = "home";
    // Every section button stays in the DOM even when its group is hidden,
    // because chat-widget.js finds and clicks them by `data-section` to follow
    // an answer's related-section links.
    // index.html and the saved reports each offer a header slot so the tabs sit
    // beside the title; without one the nav stays at the top of the mount, so an
    // embedded dashboard still gets its navigation.
    const navHost = () =>
      root.document ? root.document.querySelector("[data-feature-nav]") : null;
    function navHtml() {
      const active = groupOf(section);
      return (
        '<nav class="feature-nav" aria-label="League features"><div class="feature-groups">' +
        groups
          .map(
            ([label], i) =>
              `<button data-group="${i}"${i === active ? ' class="on"' : ""} aria-expanded="${i === active}">${esc(label)}</button>`,
          )
          .join("") +
        // The Matchup Lab is its own page, so this is a link, not a group.
        '<a class="nav-page-link" href="matchups.html">Betting lines</a>' +
        "</div>" +
        groups
          .map(([label, members], i) =>
            // A group that is one section of the same name (Main menu) would
            // otherwise repeat itself on the second row.
            members.length === 1 && sections[members[0]][0] === label
              ? ""
              : `<div class="feature-tabs" role="group" aria-label="${esc(label)}"${i === active ? "" : " hidden"}>` +
                members
                  .map(
                    (k) =>
                      `<button data-section="${k}"${section === k ? ' class="on" aria-current="page"' : ""}>${esc(sections[k][0])}</button>`,
                  )
                  .join("") +
                "</div>",
          )
          .join("") +
        "</nav>"
      );
    }
    // Keeps the URL shareable without making the back button undo a tab.
    // replaceState can throw on a file:// report, where a link is meaningless
    // anyway, so a failure is ignored.
    function syncHash() {
      try {
        if (root.location && root.location.hash !== `#${section}`)
          root.history.replaceState(null, "", `#${section}`);
      } catch {
        /* not linkable here; the dashboard still works */
      }
    }
    function draw() {
      el.dataset.activeSection = section;
      el.dataset.selectedManager = selected || "";
      el.dataset.chatManager =
        section === "trades"
          ? tradeManager
          : section === "comebacks"
            ? comebackManager
            : section === "starts"
              ? startsManager
              : section === "saber"
                ? saberManager
                : section === "opportunity"
                  ? opportunityManager
                  : section === "pickups"
                    ? pickupManager
                    : section === "moves"
                      ? moveManager
                      : section === "charts"
                        ? chartManager
                        : ["profile", "sharing"].includes(section)
                          ? selected || "all"
                          : "all";
      const chatSeason =
        section === "trades"
          ? tradeSeason
          : section === "comebacks"
            ? comebackSeason
            : section === "starts"
              ? startsSeason
              : section === "saber"
                ? saberSeason
                : section === "opportunity"
                  ? opportunitySeason
                  : section === "drafts"
                    ? draftSeason
                    : section === "pickups"
                      ? pickupSeason
                      : section === "moves"
                        ? moveSeason
                        : section === "weekly"
                          ? D.weeks[weekIndex]?.season
                          : "all";
      el.dataset.chatSeason =
        String(chatSeason || "all").match(/^\d{4}/)?.[0] || "all";
      el.dataset.chatGames = section === "starts" ? startsGames : "all";
      const chatSources = [...new Set(D.sources.map((s) => s.src))];
      el.dataset.chatPlatform =
        section === "charts" && chartSource !== "all"
          ? chartSource
          : chatSources.length === 1
            ? chatSources[0]
            : "all";
      const savedIds = root.LEAGUE_SNAPSHOT?.map((s) =>
        String(s.league.league_id),
      );
      el.dataset.chatScope =
        savedIds &&
        D.sources.some((s) => !savedIds.includes(String(s.league.league_id)))
          ? "external"
          : "saved";
      const host = navHost();
      const nav = navHtml();
      if (host) {
        host.innerHTML = nav;
        host.onclick = onNavClick;
      }
      el.innerHTML = `${host ? "" : nav}<section aria-live="polite">${D.sources
        .filter((s) => s.missing?.length)
        .map(
          (s) =>
            `<p class="sub">Partial data for ${esc(s.league.season)}: could not load ${esc([...new Set(s.missing)].join(", "))}. Rankings and details may be incomplete.</p>`,
        )
        .join("")}${D.sources
        .filter((s) => s.savedFallbacks?.length)
        .map(
          (s) =>
            `<p class="sub">${esc(s.league.season)}: using saved ${esc(s.savedFallbacks.join(", "))} because the live refresh was unavailable.</p>`,
        )
        .join(
          "",
        )}${D.sources.map((s) => ((s.detailCoverage?.warnings || []).length ? `<details class="sub"><summary>${esc(s.league.season)} ESPN import: ${s.detailCoverage.warnings.length} coverage warnings</summary>${s.detailCoverage.warnings.map((w) => `<p>${esc(w)}</p>`).join("")}</details>` : "")).join("")}${sections[section][1]()}</section>`;
      el.dataset.chatTrade =
        section === "trades"
          ? tradeData.trades.find((t) => tradeKey(t) === selectedTrade)?.id ||
            ""
          : "";
      el.dataset.chatMatchup = section === "comebacks" ? selectedComeback : "";
      el.dataset.chatPosition = section === "starts" ? startsPosition : "all";
      syncHash();
    }
    el.onclick = onNavClick;
    function onNavClick(e) {
      const b = e.target.closest("button");
      if (b?.dataset.group) {
        // Opening a group lands on its first section unless the current one
        // already belongs to it, so reopening a group does not lose your place.
        const members = groups[Number(b.dataset.group)]?.[1] || [];
        if (members.length && !members.includes(section)) section = members[0];
        draw();
      } else if (b?.dataset.section) {
        section = b.dataset.section;
        draw();
      } else if (b?.dataset.manager) {
        selected = b.dataset.manager;
        section = "profile";
        draw();
      } else if (b?.dataset.profileView) {
        profileMoveView = b.dataset.profileView;
        draw();
      } else if (b?.dataset.playerStarts) {
        startsManager = b.dataset.playerStarts;
        startsSeason = "all";
        startsGames = "all";
        startsPosition = "all";
        section = "starts";
        draw();
      } else if (b?.dataset.download) download(b.dataset.download);
      else {
        const th = e.target.closest("th");
        if (th) sort(th);
      }
    };
    el.onkeydown = (e) => {
      if (e.target.matches("th") && ["Enter", " "].includes(e.key)) {
        e.preventDefault();
        sort(e.target);
      }
    };
    el.oninput = (e) => {
      if (e.target.type === "range") {
        const box = el.querySelector(`#${e.target.id}-num`);
        if (box) box.value = e.target.value;
        return;
      }
      // Typing moves the paired slider live, but the redraw waits for `change`
      // so the box keeps focus while a two-digit value is entered.
      if (e.target.type === "number" && e.target.id.endsWith("-num")) {
        const range = el.querySelector(`#${e.target.id.slice(0, -4)}`);
        if (range && e.target.value !== "")
          range.value = clampInt(
            e.target.value,
            range.min,
            range.max,
            range.value,
          );
      }
    };
    el.onchange = (e) => {
      switch (e.target.id) {
        case "profile-manager":
          selected = e.target.value;
          break;
        case "starts-manager":
          startsManager = e.target.value;
          break;
        case "starts-season":
          startsSeason = e.target.value;
          break;
        case "starts-games":
          startsGames = e.target.value;
          break;
        case "starts-position":
          startsPosition = e.target.value;
          break;
        case "trade-season":
          tradeSeason = e.target.value;
          break;
        case "trade-manager":
          tradeManager = e.target.value;
          break;
        case "trade-choice":
          selectedTrade = e.target.value;
          break;
        case "comeback-season":
          comebackSeason = e.target.value;
          break;
        case "comeback-manager":
          comebackManager = e.target.value;
          break;
        case "comeback-ranking":
          comebackRanking = e.target.value;
          break;
        case "comeback-choice":
          selectedComeback = e.target.value;
          break;
        case "saber-season":
          saberSeason = e.target.value;
          break;
        case "saber-manager":
          saberManager = e.target.value;
          break;
        case "saber-metric":
          saberMetric = e.target.value;
          break;
        case "saber-min-weeks":
          saberMinWeeks = e.target.value;
          break;
        case "opportunity-season":
          opportunitySeason = e.target.value;
          break;
        case "opportunity-manager":
          opportunityManager = e.target.value;
          break;
        case "wrapped-week":
          weekIndex = Number(e.target.value);
          break;
        case "draft-season":
          draftSeason = e.target.value;
          break;
        case "draft-min-starts":
          draftMinStarts = e.target.value;
          break;
        case "draft-sort":
          draftSort = e.target.value;
          break;
        case "draft-min-starts-num":
          draftMinStarts = clampInt(
            e.target.value,
            0,
            DRAFT_MAX_STARTS,
            draftMinStarts,
          );
          break;
        case "move-season":
          moveSeason = e.target.value;
          break;
        case "move-type":
          moveType = e.target.value;
          break;
        case "move-manager":
          moveManager = e.target.value;
          break;
        case "pickup-season":
          pickupSeason = e.target.value;
          break;
        case "pickup-type":
          pickupType = e.target.value;
          break;
        case "pickup-manager":
          pickupManager = e.target.value;
          break;
        case "pickup-min-starts":
          pickupMinStarts = e.target.value;
          break;
        case "pickup-min-starts-num":
          pickupMinStarts = clampInt(
            e.target.value,
            0,
            pickupMaxStarts,
            pickupMinStarts,
          );
          break;
        case "pickup-sort":
          pickupSort = e.target.value;
          break;
        case "profile-trade-sort":
          profileTradeSort = e.target.value;
          break;
        case "profile-waiver-sort":
          profileWaiverSort = e.target.value;
          break;
        case "drops-season":
          dropsSeason = e.target.value;
          break;
        case "drops-manager":
          dropsManager = e.target.value;
          break;
        case "drops-min-starts":
          dropsMinStarts = e.target.value;
          break;
        case "drops-min-starts-num":
          dropsMinStarts = clampInt(
            e.target.value,
            0,
            dropMaxStarts,
            dropsMinStarts,
          );
          break;
        case "drops-sort":
          dropsSort = e.target.value;
          break;
        case "profile-pickup-sort":
          profilePickupSort = e.target.value;
          break;
        case "profile-pickup-min-starts":
          profilePickupMinStarts = e.target.value;
          break;
        case "profile-pickup-min-starts-num":
          profilePickupMinStarts = clampInt(
            e.target.value,
            0,
            pickupMaxStarts,
            profilePickupMinStarts,
          );
          break;
        case "chart-source":
          chartSource = e.target.value;
          break;
        case "chart-manager":
          chartManager = e.target.value;
          break;
        case "chart-metric":
          chartMetric = e.target.value;
          break;
        default:
          return;
      }
      draw();
    };
    // Editing the hash navigates. The handler is kept on the element so a
    // re-mount replaces it, rather than leaving an older closure redrawing
    // stale data into the same node.
    if (el.leagueHashHandler)
      root.removeEventListener("hashchange", el.leagueHashHandler);
    el.leagueHashHandler = () => {
      const id = String(root.location?.hash || "").slice(1);
      if (Object.hasOwn(sections, id) && id !== section) {
        section = id;
        draw();
      }
    };
    root.addEventListener("hashchange", el.leagueHashHandler);
    draw();
    return D;
  }
  function sort(th) {
    const tb = th.closest("table")?.tBodies[0];
    if (!tb || tb.rows[0]?.cells.length !== th.parentNode.children.length)
      return;
    const ths = [...th.parentNode.children],
      i = ths.indexOf(th),
      asc = th.dataset.asc !== "1";
    ths.forEach((t) => {
      delete t.dataset.asc;
      t.removeAttribute("aria-sort");
      t.classList.remove("asc", "desc");
    });
    th.dataset.asc = asc ? "1" : "0";
    th.setAttribute("aria-sort", asc ? "ascending" : "descending");
    th.classList.add(asc ? "asc" : "desc");
    [...tb.rows]
      .sort((a, b) => {
        const x = a.cells[i].dataset.v ?? a.cells[i].textContent,
          y = b.cells[i].dataset.v ?? b.cells[i].textContent,
          nx = Number(x.replace(/[,%]/g, "")),
          ny = Number(y.replace(/[,%]/g, "")),
          diff =
            x.trim() && y.trim() && Number.isFinite(nx) && Number.isFinite(ny)
              ? nx - ny
              : x.localeCompare(y);
        return asc ? diff : -diff;
      })
      .forEach((r) => tb.appendChild(r));
  }
  root.LeagueUI = { mount };
})(window);
