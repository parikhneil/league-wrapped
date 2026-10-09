/* Saved-first fantasy forecast board. All external text is escaped before rendering. */
(function (root) {
  "use strict";
  const defaultSnapshot = root.MATCHUP_DATA || null;
  const DEFAULT_LEAGUE = String(
    defaultSnapshot?.league?.league_id || "1381121078079795200",
  );
  const esc = (value) =>
    String(value ?? "").replace(
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
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const points = (value) => (finite(value) ? value.toFixed(1) : "—");
  const probability = (value) =>
    finite(value) ? `${(100 * value).toFixed(1)}%` : "—";
  // "american" shows sportsbook-style prices (-110); "market" shows the same
  // fair price as a prediction-market contract (51¢ pays $1 if it happens).
  let priceStyle = "american";
  try {
    if (root.localStorage?.getItem("matchupPriceStyle") === "market") priceStyle = "market";
  } catch {
    /* storage blocked: keep the default */
  }
  const americanToProbability = (value) =>
    value < 0 ? -value / (100 - value) : 100 / (value + 100);
  const odds = (value) => {
    if (!finite(value)) return "—";
    if (priceStyle === "market") {
      const cents = Math.round(100 * americanToProbability(value));
      return cents >= 100 ? ">99¢" : cents <= 0 ? "<1¢" : `${cents}¢`;
    }
    return `${value > 0 ? "+" : ""}${Math.round(value)}`;
  };
  const signed = (value) =>
    finite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(1)}` : "—";
  const date = (value) => {
    if (!value) return "Unavailable";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? "Unavailable"
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(d);
  };
  const $ = (id) => document.getElementById(id);
  const aliases = root.LEAGUE_NAMES || {};
  let data = defaultSnapshot,
    selectedWeek = null,
    selectedManager = "all";
  let cache = new Map(),
    revision = 0;
  let loadVersion = 0,
    loadController = null;
  const savedViews = new Map(
    defaultSnapshot ? [[DEFAULT_LEAGUE, defaultSnapshot]] : [],
  );
  const isDefault = (d) =>
    String(d?.league?.league_id) === "1381121078079795200";
  const name = (team) =>
    isDefault(data) && aliases[team.uid]
      ? aliases[team.uid]
      : team.name || `Roster ${team.rosterId}`;
  const uid = (team) => String(team.uid || `roster:${team.rosterId}`);
  const lineupLabel = (value) =>
    ({
      optimal_projected_roster: "optimized roster lineup",
      current_week_matchup: "current starters",
      roster_starters: "roster starters fallback",
      current_roster: "roster starters fallback",
      current_roster_starters: "roster starters fallback",
      unavailable: "lineup unavailable",
    })[value] || (value ? String(value).replace(/_/g, " ") : "");
  const coverageLabel = (value) =>
    ({
      historical: "History + positional prior",
      prior_only: "Positional prior only",
      bye: "NFL bye",
      out: "Out / injured reserve",
      empirical_with_position_shrinkage: "History + positional prior",
      verified_nfl_bye: "NFL bye",
      current_out_or_ir: "Out / injured reserve",
    })[value] || String(value || "").replace(/_/g, " ");
  function status(message, error = false) {
    $("refresh-status").textContent = message;
    $("refresh-status").classList.toggle("error", error);
  }
  function empty(title, message) {
    $("matchup-board").innerHTML =
      `<div class="empty-state"><h2>${esc(title)}</h2><p>${esc(message)}</p></div>`;
    $("matchup-board").setAttribute("aria-busy", "false");
  }
  function regularSeasonEnd(league) {
    const start = Number(league.settings?.playoff_week_start);
    return start === 0 ? 18 : Math.min(18, (start || 15) - 1);
  }
  function knownWeeks() {
    if (!data?.league) return [];
    const last = regularSeasonEnd(data.league);
    const current = Math.max(1, Number(data.currentWeek) || 1);
    return (data.weeks || []).flatMap((rows, index) => {
      const week = index + 1;
      if (week < current || week > last) return [];
      const groups = new Map();
      for (const m of rows || []) {
        if (m.matchup_id == null) continue;
        const key = String(m.matchup_id);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
      }
      return [...groups.values()].some(
        (pair) =>
          pair.length === 2 &&
          String(pair[0].roster_id) !== String(pair[1].roster_id),
      )
        ? [week]
        : [];
    });
  }
  function managers() {
    const names = new Map(
      (data?.users || []).map((u) => [
        String(u.user_id),
        u.display_name || u.username || "Manager",
      ]),
    );
    return (data?.rosters || [])
      .map((r) => ({
        rosterId: r.roster_id,
        uid: r.owner_id,
        name: names.get(String(r.owner_id)) || `Roster ${r.roster_id}`,
      }))
      .sort((a, b) => name(a).localeCompare(name(b)));
  }
  function setFilters() {
    const weeks = knownWeeks();
    if (!weeks.includes(Number(selectedWeek))) selectedWeek = weeks[0] || null;
    $("week-select").innerHTML = weeks.length
      ? weeks
          .map(
            (week) =>
              `<option value="${week}"${week === Number(selectedWeek) ? " selected" : ""}>Week ${week}${week === Number(data.currentWeek) ? " · current" : ""}</option>`,
          )
          .join("")
      : '<option value="">No upcoming pairings</option>';
    $("week-select").disabled = !weeks.length;
    const rows = managers();
    if (
      selectedManager !== "all" &&
      !rows.some((r) => uid(r) === selectedManager)
    )
      selectedManager = "all";
    $("manager-select").innerHTML =
      '<option value="all">All managers</option>' +
      rows
        .map(
          (r) =>
            `<option value="${esc(uid(r))}"${uid(r) === selectedManager ? " selected" : ""}>${esc(name(r))}</option>`,
        )
        .join("");
    $("manager-select").disabled = !rows.length;
  }
  function priceCell(value, share) {
    return `<span class="prop-price">${odds(value)}<small>${probability(share)}</small></span>`;
  }
  function marketBox(label, title, rows) {
    return `<div class="market-box"><span class="market-label">${esc(label)}</span><div class="market-title">${esc(title)}</div>${rows
      .map(
        ([line, price, share]) =>
          `<div class="market-value"><span>${esc(line)}</span><span>${odds(price)} <small>${probability(share)}</small></span></div>`,
      )
      .join("")}</div>`;
  }
  function props(team) {
    const rows = team.players || [];
    const thresholds = [
      ...new Set(rows.flatMap((p) => (p.thresholds || []).map((t) => t.line))),
    ]
      .filter(finite)
      .sort((a, b) => a - b);
    if (!rows.length)
      return `<h3>${esc(name(team))}</h3><p>No complete projected legal lineup is available from this roster.</p>`;
    const table = `<div class="table-scroll"><table><thead><tr><th scope="col">Starter</th><th scope="col">Mean pts</th><th scope="col">O/U line</th><th scope="col">Over</th><th scope="col">Under</th>${thresholds.map((line) => `<th scope="col">${points(line)}+ pts</th>`).join("")}<th scope="col">Coverage</th></tr></thead><tbody>${rows
      .map((p) => {
        const metadata = [
          p.position,
          p.team,
          p.slot ? `Optimized ${p.slot}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        const coverage = coverageLabel(
          typeof p.coverage === "string"
            ? p.coverage
            : p.coverage?.label || p.status || p.coverage?.type || "",
        );
        const details = [
          coverage,
          finite(p.observations)
            ? `${p.observations} observed week${p.observations === 1 ? "" : "s"}`
            : "",
          p.reason,
        ].filter(Boolean);
        return `<tr><td class="player-cell"><strong>${esc(p.name || p.id)}</strong><small>${esc(metadata)}</small></td><td class="nowrap">${points(p.mean)}</td><td class="nowrap">${points(p.line)}</td><td class="nowrap">${priceCell(p.overOdds, p.overProbability)}</td><td class="nowrap">${priceCell(p.underOdds, p.underProbability)}</td>${thresholds
          .map((line) => {
            const t = (p.thresholds || []).find((t) => t.line === line);
            return `<td class="nowrap">${priceCell(t?.odds, t?.probability)}</td>`;
          })
          .join(
            "",
          )}<td>${esc(details.join(" · ") || "Unavailable")}${finite(p.pushProbability) && p.pushProbability > 0 ? `<small class="prior-note"> · Push ${probability(p.pushProbability)}</small>` : ""}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
    return `<h3>${esc(name(team))} · starter fantasy-point props</h3><p>Thresholds mean “at least.” Probabilities are simulated, not guaranteed. A dash is unavailable; prices at a simulated 0% or 100% are omitted.</p>${table}`;
  }
  function alternateTables(matchup) {
    const [home, away] = matchup.teams;
    const spreadRows = matchup.alternates?.spreads || [],
      totalRows = matchup.alternates?.totals || [];
    let html = "";
    if (spreadRows.length)
      html += `<h3>Alternative spreads</h3><div class="table-scroll"><table><thead><tr><th scope="col">${esc(name(home))}</th><th scope="col">Cover price</th><th scope="col">${esc(name(away))}</th><th scope="col">Cover price</th><th scope="col">Push</th></tr></thead><tbody>${spreadRows
        .map(
          (s) =>
            `<tr><td class="nowrap">${signed(s.homeLine)}</td><td class="nowrap">${priceCell(s.homeOdds, s.homeCoverProbability)}</td><td class="nowrap">${signed(s.awayLine)}</td><td class="nowrap">${priceCell(s.awayOdds, s.awayCoverProbability)}</td><td>${probability(s.pushProbability)}</td></tr>`,
        )
        .join("")}</tbody></table></div>`;
    if (totalRows.length)
      html += `<h3>Alternative matchup totals</h3><div class="table-scroll"><table><thead><tr><th scope="col">Total points</th><th scope="col">Over</th><th scope="col">Under</th><th scope="col">Push</th></tr></thead><tbody>${totalRows
        .map(
          (t) =>
            `<tr><td class="nowrap">${points(t.line)}</td><td class="nowrap">${priceCell(t.overOdds, t.overProbability)}</td><td class="nowrap">${priceCell(t.underOdds, t.underProbability)}</td><td>${probability(t.pushProbability)}</td></tr>`,
        )
        .join("")}</tbody></table></div>`;
    const thresholds = matchup.teams.flatMap((team) =>
      (team.thresholds || []).map((t) => ({ ...t, team })),
    );
    if (thresholds.length)
      html += `<h3>Team score thresholds</h3><div class="table-scroll"><table><thead><tr><th scope="col">Manager</th><th scope="col">At least</th><th scope="col">Fair price</th><th scope="col">Probability</th></tr></thead><tbody>${thresholds
        .map(
          (t) =>
            `<tr><td>${esc(name(t.team))}</td><td class="nowrap">${points(t.line)} points</td><td>${odds(t.odds)}</td><td>${probability(t.probability)}</td></tr>`,
        )
        .join("")}</tbody></table></div>`;
    return html;
  }
  function card(matchup, index) {
    const teams = matchup.teams || [];
    if (teams.length !== 2) return "";
    const [home, away] = teams;
    const limited = teams.some((t) => t.coverage?.complete === false);
    const available =
      matchup.available !== false &&
      teams.every((t) => finite(t.projectedPoints));
    let html = `<article class="matchup-card" aria-label="${esc(name(home))} versus ${esc(name(away))}"><div class="card-top"><span>Matchup ${index + 1} · Week ${matchup.week}</span><span class="chip ${available ? (limited ? "warning" : "model") : "warning"}">${available ? (limited ? "Limited coverage" : "Simulated") : "Unavailable"}</span></div>`;
    html += teams
      .map(
        (team) =>
          `<div class="team-row"><div class="team-info"><div class="team-name">${esc(name(team))}</div><small>Roster ${esc(team.rosterId)}${team.coverage?.lineupSource ? ` · ${esc(lineupLabel(team.coverage.lineupSource))}` : ""}</small></div><div class="projection"><strong>${points(team.projectedPoints)}</strong><small>Mean pts</small></div><div class="moneyline"><strong>${odds(team.fairMoneyline)}</strong><small>${priceStyle === "market" ? "Fair win price" : "Fair moneyline"}</small></div></div>`,
      )
      .join("");
    const slots = (data.league.roster_positions || []).filter(
      (p) =>
        !["BN", "IR", "TAXI", "RESERVE", "BENCH"].includes(
          String(p).toUpperCase(),
        ),
    ).length;
    const lineupImpacts = teams.flatMap((team) => {
      const bye = (team.players || []).filter((p) => p.status === "bye").length;
      const out = (team.players || []).filter((p) => p.status === "out").length;
      const vacant =
        team.coverage?.complete && slots
          ? Math.max(0, slots - (team.players || []).length)
          : 0;
      const notes = [
        bye ? `${bye} NFL bye starter${bye === 1 ? "" : "s"}` : "",
        out ? `${out} out/IR starter${out === 1 ? "" : "s"}` : "",
        vacant ? `${vacant} empty slot${vacant === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      return notes.length ? [`${name(team)}: ${notes.join(" · ")}`] : [];
    });
    if (lineupImpacts.length)
      html += `<div class="lineup-impact"><strong>Lineup assumptions affecting this forecast</strong>${lineupImpacts.map((note) => `<div>${esc(note)}</div>`).join("")}</div>`;
    if (available) {
      const shares = teams.map((t) =>
        finite(t.winProbability)
          ? Math.max(0, Math.min(100, t.winProbability * 100))
          : 0,
      );
      html += `<div class="probability-track" aria-hidden="true"><span style="width:${shares[0]}%"></span><span style="width:${shares[1]}%"></span></div><div class="probability-labels"><span>${esc(name(home))} ${probability(home.winProbability)}</span><span>${probability(away.winProbability)} ${esc(name(away))}</span></div>`;
      const s = matchup.spread || {},
        total = matchup.total || {};
      html +=
        '<div class="market-grid">' +
        marketBox("Fantasy spread", "Score difference", [
          [
            `${name(home)} ${signed(s.homeLine)}`,
            s.homeOdds,
            s.homeCoverProbability,
          ],
          [
            `${name(away)} ${signed(s.awayLine)}`,
            s.awayOdds,
            s.awayCoverProbability,
          ],
        ]) +
        marketBox("Matchup total", `${points(total.line)} combined points`, [
          ["Over", total.overOdds, total.overProbability],
          ["Under", total.underOdds, total.underProbability],
        ]) +
        teams
          .map((t) =>
            marketBox(
              "Team fantasy points",
              `${name(t)} · ${points(t.teamTotal?.line)}`,
              [
                ["Over", t.teamTotal?.overOdds, t.teamTotal?.overProbability],
                [
                  "Under",
                  t.teamTotal?.underOdds,
                  t.teamTotal?.underProbability,
                ],
              ],
            ),
          )
          .join("") +
        "</div>";
      html += `<p class="markets-note">Simulated tie: ${probability(matchup.tieProbability)} · Spread push: ${probability(s.pushProbability)} · Total push: ${probability(total.pushProbability)}</p>`;
    } else
      html +=
        '<p class="unavailable">This matchup cannot be priced from the available lineup or scoring coverage. No missing projection is treated as zero.</p>';
    const notes = [
      ...new Set([
        ...(matchup.notes || []),
        ...teams.flatMap((t) => t.coverage?.warnings || []),
      ]),
    ];
    html += `<details class="market-details"><summary>Player props, alternate lines & coverage</summary><div class="detail-body"><div class="props-tabs">${teams.map(props).join("")}</div>${available ? alternateTables(matchup) : ""}${notes.length ? `<h3>Matchup assumptions</h3><ul class="note-list">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</div></details></article>`;
    return html;
  }
  function highestScorer(week) {
    const rows = week.highestScorer || [];
    if (week.highestScorerComplete === false)
      return '<section class="highest-panel" aria-labelledby="highest-heading"><div class="section-title"><div><span class="eyebrow">Incomplete league coverage</span><h2 id="highest-heading">Weekly highest scorer unavailable</h2></div><p>A league-wide forecast needs known pairings and complete lineups for every team. The available simulations cover only part of the league, so no full-league highest-scorer prices are shown.</p></div></section>';
    if (!rows.length) return "";
    return `<section class="highest-panel" aria-labelledby="highest-heading"><div class="section-title"><div><span class="eyebrow">League-wide market</span><h2 id="highest-heading">Weekly highest scorer</h2></div><p>Across all modeled teams, regardless of the manager filter. A tied simulation shares its top-score credit. This is a chance to lead the league, not to win a matchup.</p></div><div class="highest-grid">${rows
      .slice()
      .sort((a, b) => (b.probability || 0) - (a.probability || 0))
      .map(
        (t) =>
          `<div class="highest-card"><strong>${esc(name(t))}</strong><div class="highest-price">${odds(t.odds)}</div><small>${probability(t.probability)} simulated share</small></div>`,
      )
      .join("")}</div></section>`;
  }
  function renderModel(model) {
    const c = model?.coverage || {};
    const coverage = [
      ["Completed weeks", c.completedWeeks],
      ["Observed players", c.observedPlayers],
      ["Prior-only players", c.priorOnlyPlayers],
    ].filter(
      ([, v]) => v != null && (typeof v === "number" || typeof v === "string"),
    );
    const modelLimitations = Array.isArray(model?.limitations)
      ? model.limitations
      : model?.limitations
        ? [model.limitations]
        : [];
    const limitations = [
      ...new Set([...modelLimitations, ...(data.loadWarnings || [])]),
    ];
    const compatible = Array.isArray(c.compatibleSeasons)
      ? c.compatibleSeasons.join(", ")
      : c.compatibleSeasons;
    const discarded = Array.isArray(c.discardedSeasons)
      ? c.discardedSeasons
          .map((s) =>
            s && typeof s === "object"
              ? `${s.season}: ${s.reason || "incompatible scoring"}`
              : String(s),
          )
          .join("; ")
      : c.discardedSeasons;
    $("model-copy").innerHTML =
      `<p>${esc(model?.method || "Empirical fantasy-point simulations using compatible saved scoring history.")}</p><div class="coverage-line">${coverage.map(([label, v]) => `<span>${esc(label)}: ${esc(v)}</span>`).join("")}<span>Cached injury tags: ${c.currentInjuryMetadataFresh ? "applied for current week" : "stale / unavailable; ignored"}</span></div>${compatible != null ? `<p>Compatible history: ${esc(compatible || "None")}</p>` : ""}${discarded != null && String(discarded) ? `<p>Excluded scoring histories: ${esc(discarded)}</p>` : ""}${limitations.length ? `<ul class="note-list">${limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}`;
  }
  function meta() {
    $("data-meta").innerHTML =
      `<span><strong>${esc(data.league.name || "Fantasy league")}</strong> · ${esc(data.league.season)}</span><span>Forecast data: ${esc(date(data.sourceUpdatedAt || data.asOf))}</span><span>Player metadata: ${esc(date(data.playersUpdatedAt))}</span><span>NFL schedule: ${data.scheduleComplete ? "saved coverage available" : "partial / unavailable"} · ${esc(date(data.scheduleUpdatedAt))}</span>`;
  }
  function render() {
    if (!data?.league || !root.MatchupLines?.analyze) {
      empty(
        "Forecast data is unavailable",
        "The saved matchup data or model could not be loaded. Rebuild the forecast data and reload this page.",
      );
      status(
        "Saved data is unavailable. The main dashboard remains available.",
        true,
      );
      return;
    }
    meta();
    if (!selectedWeek) {
      const completed =
        data.league.status === "complete" ||
        Number(data.currentWeek) > regularSeasonEnd(data.league);
      const drafting = ["pre_draft", "drafting"].includes(data.league.status);
      empty(
        completed
          ? "This season has no upcoming regular-season forecasts"
          : drafting
            ? "This league is preparing for its season"
            : "No known upcoming regular-season matchups",
        completed
          ? `The ${data.league.season} regular season is finished or past its forecast cutoff. Load the league's active-season ID for upcoming matchups. Playoff pairings are not predicted.`
          : drafting
            ? "Upcoming forecasts need a drafted roster and confirmed fantasy matchup schedule. Load the active-season league or refresh after its draft and schedule are available."
            : "Sleeper has no confirmed pairings from the current week through the regular-season cutoff. Future playoff pairings remain TBD. Refresh when its schedule is available.",
      );
      $("model-copy").innerHTML =
        `<p>No upcoming forecast is available for ${esc(data.league.name || "this league")} (${esc(data.league.season)}).</p>`;
      return;
    }
    try {
      // Recheck at the injury freshness boundary as well as on later hourly interactions.
      const now = Date.now();
      const updated = Date.parse(data.playersUpdatedAt || ""),
        asOf = Date.parse(data.asOf || "");
      const injuryFresh =
        Number.isFinite(updated) &&
        Number.isFinite(asOf) &&
        asOf >= updated &&
        now >= updated &&
        now - updated <= 24 * 3600000 &&
        new Date(asOf).getUTCFullYear() === Number(data.league.season);
      const key = `${revision}:${selectedWeek}:${Math.floor(now / 3600000)}:${injuryFresh}`;
      if (!cache.has(key))
        cache.set(
          key,
          root.MatchupLines.analyze(data, {
            samples: 4000,
            seed: 26841,
            week: Number(selectedWeek),
            now,
          }),
        );
      const result = cache.get(key),
        week = (result.weeks || []).find(
          (w) => w.week === Number(selectedWeek),
        );
      renderModel(result.model);
      if (!week) {
        empty(
          "This week is not forecastable",
          "No eligible regular-season matchup data is available for this week.",
        );
        return;
      }
      const all = week.matchups || [];
      const rows = all.filter(
        (m) =>
          selectedManager === "all" ||
          (m.teams || []).some((t) => uid(t) === selectedManager),
      );
      const unscheduled = (week.unscheduled || []).length;
      const future = Number(selectedWeek) > Number(data.currentWeek);
      const underWay =
        !future &&
        (data.schedule || []).some(
          (game) =>
            Number(game.week) === Number(selectedWeek) &&
            Number.isFinite(Date.parse(game.kickoff)) &&
            Date.parse(game.kickoff) <= Date.now(),
        );
      const headline = future
        ? "Optimized weekly lineup · current roster held forward"
        : underWay
          ? "Week under way · full-week baseline"
          : "Optimized legal lineup · full-week forecast";
      $("matchup-board").innerHTML =
        `<div class="board-heading"><div><span class="eyebrow">${headline}</span><h2>Week ${Number(selectedWeek)} forecast board</h2></div><p>4,000 simulations<br />${rows.length} matchup${rows.length === 1 ? "" : "s"}${unscheduled ? ` · ${unscheduled} unpaired roster${unscheduled === 1 ? "" : "s"}` : ""}</p></div>${underWay ? '<p class="status-line">NFL games have started. These full-week baseline simulations do not use accrued points or update in-game win probability.</p>' : ""}${rows.length ? `<div class="matchup-grid">${rows.map(card).join("")}</div>` : '<div class="empty-state"><h2>No matching pairings</h2><p>This manager has no known paired matchup for the selected week.</p></div>'}${highestScorer(week)}`;
      $("matchup-board").setAttribute("aria-busy", "false");
    } catch (error) {
      empty(
        "The forecast could not be calculated",
        "The model could not validate this saved data. Refresh the league or rebuild the matchup snapshot.",
      );
      status(
        `Forecast unavailable: ${error.message || "unsupported data"}`,
        true,
      );
    }
  }
  function updateNavigation(id, mode) {
    for (const link of document.querySelectorAll?.("[data-dashboard-link]") ||
      [])
      link.href = `index.html?league=${encodeURIComponent(id)}`;
    if (!mode || !root.history) return;
    const url = new URL(
      root.location?.href || "http://localhost/matchups.html",
    );
    if (id === DEFAULT_LEAGUE) url.searchParams.delete("league");
    else url.searchParams.set("league", id);
    const method = mode === "push" ? "pushState" : "replaceState";
    root.history[method]?.({ league: id }, "", url.toString());
  }
  function applyView(next, { resetFilters = true, navigation = null } = {}) {
    data = next;
    $("model-copy").innerHTML = "";
    const id = String(next.league.league_id);
    savedViews.set(id, next);
    if (savedViews.size > 6)
      for (const key of savedViews.keys()) {
        if (key !== DEFAULT_LEAGUE && key !== id) {
          savedViews.delete(key);
          break;
        }
      }
    if (resetFilters) {
      selectedWeek = null;
      selectedManager = "all";
    }
    revision++;
    cache = new Map();
    $("league-input").value = id;
    updateNavigation(id, navigation);
    setFilters();
    render();
  }
  function loading(message) {
    $("matchup-board").setAttribute("aria-busy", "true");
    $("league-form").setAttribute("aria-busy", "true");
    $("refresh-data").disabled = true;
    status(message);
    if (!data) {
      $("data-meta").innerHTML = "";
      $("model-copy").innerHTML =
        "<p>League-specific model coverage will appear after this league loads.</p>";
      $("matchup-board").innerHTML =
        '<div class="empty-state"><span class="loader" aria-hidden="true"></span><h2>Loading this league</h2><p>Fetching public Sleeper rosters, schedules, and compatible scoring history.</p></div>';
    }
  }
  function loadedMessage(next, refresh) {
    const c = next.refreshCoverage || {};
    const restored = c.restoredWeeks || [],
      unavailable =
        c.unavailableWeeks ||
        (c.failedWeeks || []).filter((week) => !restored.includes(week));
    return (
      `${next.league.name || "Sleeper league"} (${next.league.season}) ${refresh ? "refreshed" : "loaded"}.` +
      (restored.length
        ? ` Saved matchup data retained for week${restored.length === 1 ? "" : "s"} ${restored.join(", ")}.`
        : "") +
      (unavailable.length
        ? ` Unavailable weeks: ${unavailable.join(", ")}.`
        : "") +
      ((next.loadWarnings || []).length
        ? " Some data is incomplete; see model coverage below."
        : "") +
      " Player metadata and NFL schedule freshness are shown separately."
    );
  }
  async function loadTarget(
    input,
    { refresh = false, navigation = "push" } = {},
  ) {
    const version = ++loadVersion;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    let id = "";
    try {
      if (
        !root.SleeperForecastData?.loadLeague ||
        !root.SleeperForecastData?.parseLeagueId
      )
        throw new Error(
          "The Sleeper league loader could not be loaded. Reload this page.",
        );
      id = root.SleeperForecastData.parseLeagueId(input);
      $("league-input").value = id;
      loading(
        `${refresh ? "Refreshing" : "Loading"} Sleeper league ${id}…${data ? ` The ${data.league.name || "current"} board remains visible until loading finishes.` : ""}`,
      );
      const saved =
        String(data?.league?.league_id) === id ? data : savedViews.get(id);
      const next = await root.SleeperForecastData.loadLeague(id, {
        saved,
        catalog: root.FORECAST_PLAYERS,
        scheduleSnapshot: defaultSnapshot,
        signal: controller.signal,
        onProgress: (message) => {
          if (version === loadVersion && !controller.signal.aborted)
            status(
              `${message}${data ? ` Still showing ${data.league.name || "the previous league"}.` : ""}`,
            );
        },
      });
      if (version !== loadVersion || controller.signal.aborted) return;
      if (!next?.league || String(next.league.league_id) !== id)
        throw new Error("The returned league does not match the requested ID.");
      applyView(next, {
        resetFilters: !refresh || String(data?.league?.league_id) !== id,
        navigation,
      });
      status(
        loadedMessage(next, refresh),
        (next.refreshCoverage?.unavailableWeeks || []).length > 0,
      );
    } catch (error) {
      if (
        version !== loadVersion ||
        controller.signal.aborted ||
        error.name === "AbortError"
      )
        return;
      const message = error.message || "connection error";
      if (data) {
        status(
          refresh
            ? `Refresh failed (${message}). The saved forecast board is still available.`
            : `Could not load ${id ? `league ${id}` : "that league"} (${message}). Still showing ${data.league.name || "the previous league"} (${data.league.league_id}).`,
          true,
        );
      } else {
        empty(
          "This league could not be loaded",
          `${message} Enter another public NFL Sleeper league ID or choose Our league to open the saved board.`,
        );
        status(
          `Could not load ${id ? `league ${id}` : "that league"}: ${message}`,
          true,
        );
      }
    } finally {
      if (version === loadVersion) {
        loadController = null;
        $("league-form").setAttribute("aria-busy", "false");
        $("matchup-board").setAttribute("aria-busy", "false");
        $("refresh-data").disabled = !data?.league?.league_id;
      }
    }
  }
  function restoreOurLeague(navigation = "push") {
    loadVersion++;
    loadController?.abort();
    loadController = null;
    const saved = savedViews.get(DEFAULT_LEAGUE) || defaultSnapshot;
    if (saved) {
      applyView(saved, { navigation });
      status(
        "Using our saved league snapshot. Refresh to update its public Sleeper data.",
      );
    } else {
      data = null;
      empty(
        "Our saved league is unavailable",
        "Enter a public NFL Sleeper league ID to load a forecast board.",
      );
    }
    $("league-form").setAttribute("aria-busy", "false");
    $("refresh-data").disabled = !saved;
  }
  $("week-select").addEventListener("change", (event) => {
    selectedWeek = Number(event.target.value);
    render();
  });
  $("manager-select").addEventListener("change", (event) => {
    selectedManager = event.target.value;
    render();
  });
  const priceSelect = $("price-style");
  if (priceSelect) {
    priceSelect.value = priceStyle;
    priceSelect.addEventListener("change", (event) => {
      priceStyle = event.target.value === "market" ? "market" : "american";
      try {
        root.localStorage?.setItem("matchupPriceStyle", priceStyle);
      } catch {
        /* storage blocked: the choice lasts for this visit */
      }
      render();
    });
  }
  $("refresh-data").addEventListener("click", () => {
    if (data?.league?.league_id)
      return loadTarget(data.league.league_id, {
        refresh: true,
        navigation: "replace",
      });
  });
  $("league-form").addEventListener("submit", (event) => {
    event.preventDefault();
    return loadTarget($("league-input").value);
  });
  $("our-league").addEventListener("click", () => restoreOurLeague());
  const queryLeague = () => {
    try {
      return new URL(
        root.location?.href || "http://localhost/matchups.html",
      ).searchParams.get("league");
    } catch (_) {
      return null;
    }
  };
  root.addEventListener?.("popstate", () => {
    const input = queryLeague();
    if (!input) return restoreOurLeague(null);
    return loadTarget(input, { navigation: null });
  });
  const initialLeague = queryLeague();
  if (initialLeague !== null) {
    data = null;
    setFilters();
    $("league-input").value = initialLeague;
    loadTarget(initialLeague, { navigation: "replace" });
  } else if (data?.league) {
    $("league-input").value = DEFAULT_LEAGUE;
    updateNavigation(DEFAULT_LEAGUE, null);
    setFilters();
    status(
      "Using the saved league snapshot. Refresh to update public Sleeper rosters and scores.",
    );
    // Let the loading state paint before running the simulations.
    requestAnimationFrame(() => setTimeout(render, 0));
  } else {
    $("refresh-data").disabled = true;
    render();
  }
})(typeof window !== "undefined" ? window : globalThis);
