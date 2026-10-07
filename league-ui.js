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
    const manager = (u) =>
      raw(
        `<button class="manager" data-manager="${esc(u)}">${esc(n(u))}</button>`,
      );
    let section = el.dataset.activeSection || "overview",
      selected = ids.includes(el.dataset.selectedManager)
        ? el.dataset.selectedManager
        : ids[0],
      weekIndex = D.weeks.length - 1,
      chartSource = "all",
      chartMetric = "pf",
      chartManager = "all",
      draftSeason = "all",
      moveSeason = "all",
      moveType = "all",
      moveManager = "all",
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
    const metricCards = (a) =>
      `<div class="cards">${[
        ["Record", rec(a)],
        ["Win %", num(root.LeagueStats.rate(a) * 100) + "%"],
        ["Titles", a.titles],
        ["Playoffs", a.po],
        ["Expected wins", num(a.expected)],
        ["Schedule luck", signed(a.actual - a.expected)],
      ]
        .map(
          ([k, v]) =>
            `<div class="card"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`,
        )
        .join("")}</div>`;
    function overview() {
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
    function profile() {
      if (!selected) return "<p>No managers available.</p>";
      const a = D.all[selected],
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
        )
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
        rivals = D.rivalries
          .filter((r) => r.games >= 2)
          .sort(
            (a, b) =>
              a.balance / a.games - b.balance / b.games || b.games - a.games,
          );
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
        '<h3>Most competitive rivalries</h3><p class="sub">At least two meetings, ordered by the smallest win imbalance as a fraction of meetings, then most meetings. Records include ties.</p>' +
        table(
          ["Manager", "Opponent", "Record", "Meetings"],
          rivals
            .slice(0, 15)
            .map((r) => [
              manager(r.a),
              manager(r.b),
              `${r.w}-${r.l}-${r.t}`,
              r.games,
            ]),
        )
      );
    }
    function drafts() {
      const picks = D.drafts.filter(
          (p) => draftSeason === "all" || p.season === draftSeason,
        ),
        late = picks
          .filter((p) => p.round >= 8 && p.value !== null)
          .sort((a, b) => b.value - a.value)
          .slice(0, 10),
        early = picks
          .filter((p) => p.round <= 3 && p.value !== null)
          .sort((a, b) => a.value - b.value)
          .slice(0, 10);
      const rows = (ps) =>
        ps.map((p) => [
          p.season,
          p.pick,
          p.round,
          p.player,
          p.pos,
          manager(p.uid),
          p.starts ?? "—",
          num(p.pts),
          signed(p.value),
        ]);
      return (
        "<h2>Draft analysis</h2>" +
        select("draft-season", "Season", seasonOptions, draftSeason) +
        '<p class="sub">Starter points are scored for the drafting manager through completed weeks, including playoffs. Value = starter points minus the mean for that draft round in the same season. Late rounds: 8+. Early rounds: 1–3. This measures realized roster contribution, not talent or predictive value. Imported ESPN picks are shown; unavailable starter scores and values are marked — and excluded from value rankings.</p>' +
        "<h3>Late-round bargains</h3>" +
        table(
          [
            "Season",
            "Pick",
            "Round",
            "Player",
            "Pos",
            "Manager",
            "Starts",
            "Starter points",
            "Vs round average",
          ],
          rows(late),
        ) +
        "<h3>Early-round disappointments</h3>" +
        table(
          [
            "Season",
            "Pick",
            "Round",
            "Player",
            "Pos",
            "Manager",
            "Starts",
            "Starter points",
            "Vs round average",
          ],
          rows(early),
        ) +
        "<h3>Every pick · most starter points first</h3>" +
        table(
          [
            "Season",
            "Pick",
            "Round",
            "Player",
            "Pos",
            "Manager",
            "Starts",
            "Starter points",
            "Vs round average",
          ],
          rows(picks.slice().sort((a, b) => b.pts - a.pts)),
        )
      );
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
        '</div><p class="sub">Completed transactions only. Subsequent starter points begin the week after acquisition and stop after the week of the next recorded drop or trade away. Same-week points are excluded because weekly snapshots cannot establish lineup timing. ESPN coverage depends on retained historical data; unavailable scores are marked —.</p>' +
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
        '<h2>Trade analyzer</h2><p class="sub">See what each team received, how its season changed, and how much the acquired players actually contributed.</p><div class="filters">' +
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
        '<p class="sub">100 means equal received starter points; lower values mean a larger gap. This is realized contribution while each recipient held the players. Picks, FAAB, bench value, positional scarcity and replacement players are not valued. A better record after a trade does not establish that the trade caused it.</p>' +
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

    const sections = {
      overview: ["Overview", overview],
      profile: ["Manager profiles", profile],
      starts: ["Most started players", mostStarted],
      saber: ["Stat Lab", sabermetrics],
      opportunity: ["xFP & opportunity", opportunity],
      luck: ["Luck rankings", luck],
      weekly: ["Weekly wrapped", weekly],
      records: ["Records & rivalries", records],
      comebacks: ["Largest comebacks", comebacks],
      drafts: ["Draft analysis", drafts],
      moves: ["Trades & waivers", moves],
      trades: ["Trade analyzer", tradeAnalyzer],
      charts: ["Season charts", charts],
      sharing: ["Recap cards", sharing],
    };
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
      el.innerHTML = `<nav class="feature-tabs" aria-label="League features">${Object.entries(
        sections,
      )
        .map(
          ([k, [label]]) =>
            `<button data-section="${k}"${section === k ? ' class="on" aria-current="page"' : ""}>${esc(label)}</button>`,
        )
        .join("")}</nav><section aria-live="polite">${D.sources
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
    }
    el.onclick = (e) => {
      const b = e.target.closest("button");
      if (b?.dataset.section) {
        section = b.dataset.section;
        draw();
      } else if (b?.dataset.manager) {
        selected = b.dataset.manager;
        section = "profile";
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
        case "move-season":
          moveSeason = e.target.value;
          break;
        case "move-type":
          moveType = e.target.value;
          break;
        case "move-manager":
          moveManager = e.target.value;
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
