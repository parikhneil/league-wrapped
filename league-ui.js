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
      moveManager = "all";
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
                .join("; ") || (m.details_incomplete ? "Player details unavailable" : "—"),
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
      luck: ["Luck rankings", luck],
      weekly: ["Weekly wrapped", weekly],
      records: ["Records & rivalries", records],
      drafts: ["Draft analysis", drafts],
      moves: ["Trades & waivers", moves],
      charts: ["Season charts", charts],
      sharing: ["Recap cards", sharing],
    };
    function draw() {
      el.dataset.activeSection = section;
      el.dataset.selectedManager = selected || "";
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
        .join("")}${D.sources.map((s) => (s.detailCoverage?.warnings || []).length ? `<details class="sub"><summary>${esc(s.league.season)} ESPN import: ${s.detailCoverage.warnings.length} coverage warnings</summary>${s.detailCoverage.warnings.map((w) => `<p>${esc(w)}</p>`).join("")}</details>` : "").join("")}${sections[section][1]()}</section>`;
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
