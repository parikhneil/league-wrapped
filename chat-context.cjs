"use strict";

// A deliberately closed retrieval surface: only the published league snapshot and
// the same calculations that power the site. No evaluation of JavaScript, user-
// supplied paths, credentials, environment variables, or network requests.
const fs = require("node:fs");
const path = require("node:path");
const { analyze, rate, summarizePlayerStarts } = require("./league-stats.js");
const TradeAnalysis = require("./trade-analysis.js");
const ComebackHistory = require("./comeback-history.js");
const SNAPSHOT = path.join(__dirname, "league-data.js");
const MAX_FACTS = 14000;
const SECTION_LABELS = Object.freeze({
  overview: "Overview",
  profile: "Manager profiles",
  starts: "Most started players",
  trades: "Trade analyzer",
  comebacks: "Largest comebacks",
  saber: "Stat Lab",
  opportunity: "xFP & opportunity",
  luck: "Luck rankings",
  weekly: "Weekly wrapped",
  records: "Records & rivalries",
  drafts: "Draft analysis",
  moves: "Trades & waivers",
  charts: "Season charts",
  sharing: "Recap cards",
  players: "Player history",
});

// Trusted definitions are maintained alongside the engine. Data values below
// are JSON-quoted evidence, never instructions for the assistant to follow.
const GUIDE = Object.freeze({
  trades:
    "Completed trades: BEFORE/AFTER exclude completion week; regular-season results and postseason are separate. Received starter points begin next full week, count paired games, stop before subsequent transfer/observed departure. Sent points are RECIPIENT lineup points, not sender counterfactuals. Evenness100=equal received points; lower=larger normalized gap; missing/no realized points=unavailable. Picks/FAAB shown but unvalued; bench value, scarcity, replacements excluded. After-trade results do not establish causation or a trade winner. Calendar-estimated completion weeks use Tuesday–Monday; reportedWeek preserves proposal week.",
  comebacks:
    "Ranks final fantasy winners by largest AVAILABLE checkpoint deficit. reconstructed_day_boundary uses corrected final starter points from earlier NFL game dates, before later-day kickoff; exact historical game mapping and reconciled lineups required. It can miss intraday swings; observed live snapshots give finer coverage. Use finalMatchupScore for the final result; the last trace checkpoint may precede the last NFL game. Fantasy odds unavailable without recorded/imported named fantasy source; NFL-game wp is not fantasy odds. Never infer percentages from deficits or invent 1%->100%. Standings recovery is separate: worst weekly rank to final rank.",
  overview:
    "Combines saved ESPN/Sleeper seasons; aliases join the same person, successor owners stay separate. Platform regular-season standings: win%=(W+0.5T)/(W+L+T), PF breaks ties. PF=points for; PA=against; PPG=PF/games. Active seasons, titles/finals/playoffs are provisional, to date.",
  profile:
    "Manager click shows career/season records, titles, Stat Lab, opportunity, biggest wins, toughest opponents and top10 starters. Toughest opponent sorts regular-season losses descending, wins ascending. Regular/playoff/consolation head-to-head are separate.",
  starts:
    "Counts each manager's actual starter appearances in completed paired games across platforms, including zero/negative scores; excludes benches, byes, future/in-progress weeks. All-time includes playoffs/consolation; regular/postseason filters restrict scope. Teams mean managers; successor owners have separate history. Players join by verified GSIS/ESPN identity; unverified identities stay separate. Missing lineups=partial observed totals; any missing player score makes aggregate points unavailable, with scoredStarts reporting coverage. Season lists reflect filters. Usage does not prove player quality or caused wins.",
  saber:
    "All Stat Lab metrics use completed PAIRED regular-season weeks; future/in-progress weeks, postseason and platform median/bonus wins are excluded. Scoring+=100*points/summed weekly league-average points (100 average;115 means15% above average). PALA=sum(points-weekly league mean). Career Scoring+ weights weekly baselines, not season indices. xW=sum weekly all-play win probabilities. Dominance=mean(matchup scoring margin/weekly population scoring SD). Boom/bust=weeks at least1 SD above/below league mean. Volatility=population SD of weekly scoring z-scores; lower means more consistent RELATIVE to league. Zero-SD weeks get zero z-score/dominance. Legal lineup regret=maximum legal roster score-actual starter score, including FLEX/SUPER_FLEX positions; reserves/taxi excluded and empty slots allowed. All player scores, positions, rules and actual score must validate. Season/career regret and lineup efficiency stay unavailable if ANY qualifying week lacks coverage. Efficiency=actual points/optimal points. Hindsight wins found=count losses/ties that the optimal lineup would beat opponent's recorded lineup. These are hindsight, not pregame decision quality.",
  opportunity:
    "xFP uses published ffopportunity expected offensive stats reweighted to league scoring. FPOE=actual MODELED offensive points-xFP. QB/RB/WR/TE passing,rushing,receiving components only; K/DST, fumbles,returns,nonlinear bonuses and unsupported components excluded from BOTH sides. Thus modeled points differ from full matchup scores. Manager averages/totals include only fully covered offensive starter lineups in completed regular-season weeks; covered/observed weeks disclose gaps. Player rows include starts with model data, targets,carries,air yards. Opportunity share is average share of NFL TEAM rushing+receiving xFP during fantasy starts, standard PPR; passing excluded and QB shares omitted. Positive FPOE does not prove regression. This describes postgame opportunity, not future prediction or calibrated expected wins from opportunity. Model training uses2006-2020 play-by-play; ffopportunity CC BY-SA4.0. Model source:https://github.com/ffverse/ffopportunity/releases/tag/latest-data ; methodology:https://ffopportunity.ffverse.com/ . Missing model matches are unavailable, not zero. Source/model lastWeek can exceed the fantasy league's completed-week cutoff.",
  luck: "Weekly expected win probability=(other paired teams outscored+0.5*teams tied)/(other paired teams). Luck=actual matchup wins (ties0.5)-expected wins. Positive luck=more wins than random schedules suggest; negative=fewer. All-play W/L/T counts each comparison. Luck and xW describe schedule results, not a causal measure of manager skill.",
  weekly:
    "Weekly high scorer, closest game, upset and standings changes. Upset=loser's prior win%-winner's prior win% when positive; none in week1. Positive rank change=climbing. Postseason recaps include bye scores but do not alter regular-season luck/ranks/upsets.",
  records:
    "Records include high/low regular-season scores, largest margin, closest games, within-season win streaks (ties break streak), standings comebacks and rivalries. Comeback=worst weekly rank-final available rank, ranked using win percentage then PF. Competitive rivalries require>=2 meetings and minimize absolute win imbalance/meetings, breaking ties by more meetings. Postseason head-to-head is separate from regular-season rivalries.",
  drafts:
    "Draft contribution=starter points for ORIGINAL drafting manager, completed weeks INCLUDING playoffs; not NFL points or preseason expectation. value=pts-roundMean(season+round mean pick). valuePerStart=pts/starts-roundPerStart(season+round start-weighted), needs starts>=8. starts=0 listed separately, never rate-ranked; rostered=0 excluded from BOTH rankings. Bargains round>=8; disappointments rounds1-3; active seasons to date.",
  moves:
    "Only completed trades/waivers/free-agent moves. Acquisition contribution starts week AFTER acquisition, ends after week of next recorded drop/trade away, counts actual weekly starts, includes completed playoffs. Same-week points omitted because snapshots cannot establish lineup timing; preseason moves recorded week1 also exclude week1. Picks/FAAB transfers shown when available. ESPN historical transaction completeness is unverified; missing items/lineups marked unavailable. Contribution is raw starter points, not replacement-level value or proof of trade quality.",
  charts:
    "Compare regular-season PPG/win% by manager/platform; hover and table show values. Different scoring/partial seasons limit raw-score comparisons; Scoring+ adjusts weekly baseline.",
  sharing:
    "Preview/download1200x630 PNG: record, rank, titles, win%, best regular week, luck. Browser-generated/local save; filters select scope; nothing posted.",
  players:
    "players.html searches saved Sleeper history: manager record while rostered/started, weeks rostered/started, points per start, playoff/title flags. Records count paired regular games; weeks/points may include completed paired postseason. Team outcomes do not imply player-caused wins; no starts=unavailable average.",
  navigation:
    "Combined/Sleeper/ESPN buttons and section filters select scope. Live page refreshes Sleeper after saved snapshot; reports static. Assistant uses SERVER'S SAVED SNAPSHOT; live/custom values may differ. Missing=em dash, not zero. setup_data.py/fetchers+build_report.py refresh data. No rWAR, replacement wins/value, forecasts or xW-from-xFP; never invent them.",
});

let cache;

function parseSnapshot(text) {
  const match = /^\s*window\.LEAGUE_SNAPSHOT\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(
    text,
  );
  if (!match)
    throw new Error("Published league snapshot has an unsupported format.");
  const seasons = JSON.parse(match[1]);
  if (!Array.isArray(seasons) || seasons.length > 100 || !seasons.length)
    throw new Error("Published league snapshot is unavailable.");
  for (const s of seasons) {
    if (
      !["ESPN", "Sleeper"].includes(s?.src) ||
      !/^\d{4}$/.test(String(s?.league?.season)) ||
      !Array.isArray(s.users) ||
      !Array.isArray(s.rosters) ||
      !Array.isArray(s.weeks) ||
      !Array.isArray(s.bracket)
    )
      throw new Error("Published league snapshot is malformed.");
  }
  return seasons;
}

function loadSnapshot() {
  const stat = fs.statSync(SNAPSHOT);
  const fingerprint = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  if (cache?.fingerprint === fingerprint) return cache;
  if (stat.size > 50 * 1024 * 1024)
    throw new Error("Published league snapshot is too large.");
  const seasons = parseSnapshot(fs.readFileSync(SNAPSHOT, "utf8"));
  const all = analyze(seasons);
  const managers = Object.keys(all.all).map((id, index) => ({
    id,
    name: all.names[id] || "Unknown",
    source: `manager-${index}`,
  }));
  cache = {
    fingerprint,
    seasons,
    all,
    managers,
    analyzed: new Map(),
    updatedAt: stat.mtime.toISOString(),
  };
  return cache;
}

const normalized = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const mentions = (query, name) => {
  const words = normalized(name);
  return words.length >= 3 && ` ${query} `.includes(` ${words} `);
};
const aliases = {
  Ani: ["anirudh", "anirudh0"],
  Shravan: ["shrev", "shravu"],
  Sathkrith: ["sath", "goatkrith"],
  Kaushal: ["kausahal"],
  Abhi: ["abhis1ngh"],
  Alex: ["wkeyalx"],
  Ekaansh: ["eka416"],
  Koji: ["snakydraky"],
  Mayank: ["daepicducky"],
  Rafael: ["rafarey1"],
  Safwan: ["saffylaffy"],
  Neil: ["neillll"],
};

function sanitizeSelection(selection, c) {
  const s =
    selection && typeof selection === "object" && !Array.isArray(selection)
      ? selection
      : {};
  const knownSeasons = c.seasons.flatMap((x) => [
    String(x.league.season),
    `${x.league.season} (${x.src})`,
  ]);
  return {
    section:
      typeof s.section === "string" && Object.hasOwn(SECTION_LABELS, s.section)
        ? s.section
        : "overview",
    manager:
      typeof s.manager === "string" &&
      c.managers.some((m) => m.id === s.manager)
        ? s.manager
        : "all",
    season:
      ["string", "number"].includes(typeof s.season) &&
      knownSeasons.includes(String(s.season))
        ? String(s.season)
        : "all",
    platform: ["ESPN", "Sleeper"].includes(s.platform) ? s.platform : "all",
    scope: s.scope === "external" ? "external" : "saved",
    games: ["regular", "postseason"].includes(s.games) ? s.games : "all",
    trade: typeof s.trade === "string" && s.trade.length <= 120 ? s.trade : "",
    matchup:
      typeof s.matchup === "string" && s.matchup.length <= 120 ? s.matchup : "",
    position:
      typeof s.position === "string" && /^[A-Z_]{1,15}$/.test(s.position)
        ? s.position
        : "all",
  };
}

function getCatalog() {
  const c = loadSnapshot();
  return {
    sections: { ...SECTION_LABELS },
    managers: c.managers.map(({ id, name }) => ({ id, name })),
    seasons: c.seasons.map((s) => ({
      year: String(s.league.season),
      platform: s.src,
      label: `${s.league.season} (${s.src})`,
    })),
    updatedAt: c.updatedAt,
  };
}

const rounded = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 10000) / 10000
    : value;
function compact(object, fields) {
  return Object.fromEntries(
    fields
      .filter((key) => object[key] !== undefined)
      .map((key) => [key, rounded(object[key])]),
  );
}
const seasonLabel = (s) => `${s.league.season} (${s.src})`;
const saberFields = [
  "season",
  "played",
  "actual",
  "xw",
  "points",
  "baseline",
  "pala",
  "scoringPlus",
  "dominance",
  "boom",
  "bust",
  "volatility",
  "lineupRegret",
  "regretWeeks",
  "regretFlips",
  "lineupEfficiency",
];
const weeklyFields = [
  "week",
  "points",
  "baseline",
  "z",
  "dominance",
  "expected",
  "actual",
  "actualResult",
  "opponentPts",
  "optimum",
  "regret",
  "flipped",
];

function opportunityRows(sources, uids) {
  return sources.flatMap((s) => {
    const cutoff =
      s.league.settings?.last_scored_leg ??
      (s.league.status === "complete" ? 18 : 0);
    const start = s.league.settings?.playoff_week_start || 15;
    const owners = Object.fromEntries(
      s.rosters.map((r) => [r.roster_id, r.owner_id]),
    );
    return (s.opportunity?.weekly || [])
      .filter(
        (w) =>
          w.week <= cutoff &&
          w.week < start &&
          (!uids.length || uids.includes(owners[w.roster_id])),
      )
      .map((w) => ({ ...w, uid: owners[w.roster_id], season: seasonLabel(s) }));
  });
}

// This grouping exactly matches league-ui.js opportunitySummary: only complete
// offensive lineups enter totals; partial observations count toward coverage.
function opportunitySummary(rows) {
  const groups = new Map();
  for (const w of rows) {
    const key = `${w.season}|${w.uid}`;
    if (!groups.has(key))
      groups.set(key, {
        uid: w.uid,
        season: w.season,
        observed: 0,
        weeks: 0,
        xfp: 0,
        actual: 0,
        fpoe: 0,
      });
    const a = groups.get(key);
    a.observed++;
    if (w.complete) {
      a.weeks++;
      a.xfp += w.xfp;
      a.actual += w.actual;
      a.fpoe += w.fpoe;
    }
  }
  return [...groups.values()].map((a) => ({
    ...a,
    xfpPerWeek: a.weeks ? a.xfp / a.weeks : null,
    actualPerWeek: a.weeks ? a.actual / a.weeks : null,
    fpoePctActual: a.weeks && a.actual ? (100 * a.fpoe) / a.actual : null,
  }));
}

function starterPlayers(sources, uids) {
  return sources.flatMap((s) => {
    const result = new Map();
    const cutoff =
      s.league.settings?.last_scored_leg ??
      (s.league.status === "complete" ? 18 : 0);
    const start = s.league.settings?.playoff_week_start || 15;
    const owners = Object.fromEntries(
      s.rosters.map((r) => [r.roster_id, r.owner_id]),
    );
    s.weeks.forEach((wk, i) => {
      if (i + 1 > cutoff || i + 1 >= start) return;
      for (const m of wk || []) {
        if (uids.length && !uids.includes(owners[m.roster_id])) continue;
        for (const pid of m.starters || []) {
          const v = s.opportunity?.weeks?.[String(i + 1)]?.[pid];
          if (!v) continue;
          if (!result.has(pid))
            result.set(pid, {
              season: seasonLabel(s),
              player: s.players?.[pid]?.name || String(pid),
              position: s.players?.[pid]?.position || "",
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
          const a = result.get(pid);
          a.starts++;
          for (const k of [
            "xfp",
            "actual",
            "fpoe",
            "targets",
            "carries",
            "airYards",
          ])
            a[k] += Number(v[k]) || 0;
          if (Number.isFinite(v.opportunityShare)) {
            a.shareSum += v.opportunityShare;
            a.shareWeeks++;
          }
        }
      }
    });
    return [...result.values()].map(({ shareSum, shareWeeks, ...a }) => ({
      ...a,
      nflTeamOpportunityShare: shareWeeks ? shareSum / shareWeeks : null,
    }));
  });
}

// Player history mirrors build_report.py build_players_page rather than merging
// its team-result columns with the opportunity page's offensive model totals.
function playerHistory(sources, uids, playerNames) {
  const result = [];
  for (const s of sources.filter((s) => s.src === "Sleeper")) {
    const owners = Object.fromEntries(
      s.rosters.map((r) => [r.roster_id, r.owner_id]),
    );
    const start = s.league.settings?.playoff_week_start || 15;
    const cutoff =
      s.league.settings?.last_scored_leg ??
      (s.league.status === "complete" ? 18 : 0);
    const champion =
      s.league.status === "complete"
        ? s.bracket.find((b) => b.p === 1)?.w
        : null;
    const playoffIds = new Set(
      s.league.status === "complete"
        ? s.league.playoff_roster_ids ||
            s.bracket.flatMap((b) =>
              [b.t1, b.t2, b.w, b.l].filter(Number.isInteger),
            )
        : [],
    );
    const rows = new Map();
    s.weeks.forEach((wk, i) => {
      if (i + 1 > cutoff) return;
      const pairs = new Map();
      for (const m of wk || [])
        if (m.matchup_id != null) {
          if (!pairs.has(m.matchup_id)) pairs.set(m.matchup_id, []);
          pairs.get(m.matchup_id).push(m);
        }
      for (const pair of pairs.values()) {
        if (pair.length !== 2 || !pair.some((m) => Number(m.points))) continue;
        for (const me of pair) {
          const uid = owners[me.roster_id];
          if (!uid || (uids.length && !uids.includes(uid))) continue;
          const opp = pair.find((m) => m !== me);
          const outcome =
            Number(me.points) > Number(opp.points)
              ? "w"
              : Number(me.points) < Number(opp.points)
                ? "l"
                : "t";
          for (const pid of me.players || []) {
            const player = s.players?.[pid]?.name || String(pid);
            if (playerNames.length && !playerNames.includes(player)) continue;
            const key = `${me.roster_id}|${pid}`;
            if (!rows.has(key))
              rows.set(key, {
                uid,
                player,
                season: seasonLabel(s),
                position: s.players?.[pid]?.position || "",
                weeksRostered: 0,
                weeksStarted: 0,
                starterPoints: 0,
                recordOnRoster: { w: 0, l: 0, t: 0 },
                recordWhenStarted: { w: 0, l: 0, t: 0 },
                playoffs: playoffIds.has(me.roster_id),
                champion: champion === me.roster_id,
              });
            const row = rows.get(key);
            row.weeksRostered++;
            if (i + 1 < start) row.recordOnRoster[outcome]++;
            if (me.starters?.includes(pid)) {
              row.weeksStarted++;
              row.starterPoints += Number(me.players_points?.[pid]) || 0;
              if (i + 1 < start) row.recordWhenStarted[outcome]++;
            }
          }
        }
      }
    });
    result.push(
      ...[...rows.values()].map((r) => ({
        ...r,
        averagePointsPerStart: r.weeksStarted
          ? r.starterPoints / r.weeksStarted
          : null,
      })),
    );
  }
  return result;
}

function buildContext(question, selection = {}, history = []) {
  if (question && typeof question === "object") {
    selection = question.selection;
    history = question.history;
    question = question.message;
  }
  const c = loadSnapshot();
  const safe = sanitizeSelection(selection, c);
  if (safe.scope === "external") {
    return {
      facts: JSON.stringify({
        trustedDefinitions: { source: "site-guide", ...GUIDE },
        scope: {
          externalLeague: true,
          savedLeague: false,
          evidenceAvailable: false,
          limitation:
            "User is viewing an external/custom league. No numeric facts or identities from the server's saved league may be attributed to that league. Explain definitions and navigation only; ask for the relevant visible values if needed.",
        },
        evidence: [],
      }),
      sources: [
        {
          id: "site-guide",
          label: "Site metric definitions and limitations",
          section: safe.section,
        },
      ],
      coverage: {
        savedLeague: false,
        externalLeague: true,
        savedSnapshotOnly: true,
        requestedScopeAvailable: false,
        boundedRetrieval: true,
      },
    };
  }
  const query = normalized(
    typeof question === "string" ? question.slice(0, 2000) : "",
  );
  const followup =
    query.length < 100 &&
    /^(why|how so|what about|and|so|does that|is that|what does that|explain that|tell me more)\b/.test(
      query,
    );
  const prior =
    followup && Array.isArray(history)
      ? history
          .filter((h) => typeof h === "string" || h?.role === "user")
          .slice(-2)
          .map((h) =>
            normalized(
              typeof h === "string"
                ? h.slice(0, 2000)
                : String(h.content || "").slice(0, 2000),
            ),
          )
          .join(" ")
      : "";
  const findManagers = (text) =>
    c.managers
      .filter(
        (m) =>
          mentions(text, m.name) ||
          (aliases[m.name] || []).some((alias) => mentions(text, alias)),
      )
      .map((m) => m.id);
  let explicitManagers = findManagers(query);
  if (!explicitManagers.length && prior) explicitManagers = findManagers(prior);
  const playerUsageRanking =
    /most started|most starts|started most|most used|start counts?|starter leaderboard|favorite players?/.test(
      query,
    ) && !/all managers|everyone|which manager|who started/.test(query);
  const leagueComparison =
    /\b(who|rank|ranking|leaderboard|highest|lowest|best|worst|most|least|everyone|all managers)\b/.test(
      query,
    ) && !playerUsageRanking;
  const uids = explicitManagers.length
    ? explicitManagers
    : safe.manager === "all" || leagueComparison
      ? []
      : [safe.manager];
  let explicitYears = [...new Set(query.match(/\b20\d{2}\b/g) || [])].filter(
    (year) => c.seasons.some((s) => String(s.league.season) === year),
  );
  const careerScope = /\b(career|all time|all seasons)\b/.test(query);
  if (!explicitYears.length && prior && !careerScope)
    explicitYears = [...new Set(prior.match(/\b20\d{2}\b/g) || [])];
  const years = careerScope
    ? []
    : explicitYears.length
      ? explicitYears
      : safe.season === "all"
        ? []
        : [safe.season.slice(0, 4)];
  const platformMentions = ["ESPN", "Sleeper"].filter((p) =>
    mentions(query, p),
  );
  let platform =
    platformMentions.length === 1
      ? platformMentions[0]
      : platformMentions.length > 1 ||
          /\b(combined|career|all time|all seasons)\b/.test(query)
        ? "all"
        : safe.season.includes("(ESPN)")
          ? "ESPN"
          : safe.season.includes("(Sleeper)")
            ? "Sleeper"
            : safe.platform;
  if (
    explicitYears.length &&
    !platformMentions.length &&
    platform !== "all" &&
    !c.seasons.some(
      (s) =>
        explicitYears.includes(String(s.league.season)) && s.src === platform,
    )
  )
    platform = "all";
  const sources = c.seasons.filter(
    (s) =>
      (!years.length || years.includes(String(s.league.season))) &&
      (platform === "all" || s.src === platform),
  );
  const analysisKey = sources.map(seasonLabel).join("|");
  if (!c.analyzed.has(analysisKey))
    c.analyzed.set(analysisKey, analyze(sources));
  const D = c.analyzed.get(analysisKey);
  const name = (uid) => D.names[uid] || c.all.names[uid] || "Unknown";
  const selected = (uid) => !uids.length || uids.includes(uid);
  const weekMatch = /\bweek\s+(\d{1,2})\b/.exec(query);
  const week =
    weekMatch && Number(weekMatch[1]) >= 1 && Number(weekMatch[1]) <= 18
      ? Number(weekMatch[1])
      : null;
  const askedSections = Object.entries({
    trades:
      /trade analy|after.*trade|before.*trade|trade.*(?:even|fair|balance|won|winner|loser|season)|(?:even|fair|balance).*trade/,
    comebacks:
      /comeback|win probabil|win chance|score deficit|trailing|overnight|in game|in match/,
    starts:
      /most started|most starts|started most|most used|start counts?|starter leaderboard|favorite players?|\bstarts\b|how (?:often|many times).*\bstart\b/,
    saber:
      /scoring|pala|dominance|boom|bust|volatility|consistent|stat lab|saber|regret|efficiency|hindsight|bench|xw|expected wins/,
    opportunity:
      /xfp|fpoe|opportunity|target|carries|air yards|modeled|modelled|regress/,
    luck: /luck|all play|schedule|xw|expected wins/,
    weekly: /week|recap|upset|highest scorer/,
    records:
      /record|rival|streak|comeback|blowout|closest|lowest|biggest|head to head|versus| vs /,
    drafts: /draft|pick|bargain|disappointment/,
    moves: /trade|waiver|free agent|acquisition|transaction|faab|add|drop/,
    charts: /chart|trend|compare|comparison/,
    sharing: /card|png|share|download/,
    players:
      /player history|rostered|when started|record on roster|points per start/,
    profile: /profile|manager|career|history|champion|title/,
    overview: /standing|rank|win|loss|points|league/,
  })
    .filter(([, pattern]) => pattern.test(query))
    .map(([section]) => section);
  // "Draft points per start" belongs to the draft board, but the players
  // section also claims that phrase; drop it unless the wording is really
  // about player history, so draft evidence keeps the fact budget.
  if (
    /draft|bargain|disappointment/.test(query) &&
    !/player history|record on roster|when started|rostered/.test(query)
  ) {
    const playersAt = askedSections.indexOf("players");
    if (playersAt >= 0) askedSections.splice(playersAt, 1);
  }
  if (uids.length && !askedSections.includes("profile"))
    askedSections.push("profile");
  const sections = [...new Set([...askedSections, safe.section])];
  const data = [];
  const evidenceKeys = new Set();
  const sourceMap = new Map();
  const addSource = (id, label, section) => {
    if (!sourceMap.has(id)) sourceMap.set(id, { id, label, section });
    return id;
  };
  const guideSource = addSource(
    "site-guide",
    "Site metric definitions and limitations",
    safe.section,
  );
  const factsObject = {
    trustedDefinitions: { source: guideSource, ...GUIDE },
    scope: {
      snapshotUpdatedAt: c.updatedAt,
      savedSnapshotOnly: true,
      platform,
      seasons: sources.map(seasonLabel),
      managers: uids.map((id) => name(id)),
      requestedWeek: week,
      retrievalIsPartial: true,
    },
    evidence: data,
  };
  const push = (section, kind, rows, label = SECTION_LABELS[section]) => {
    if (Array.isArray(rows) && !rows.length) return;
    const id = `section-${section}`;
    const item = { source: id, kind, rows };
    const key = JSON.stringify(item);
    if (evidenceKeys.has(key)) return;
    data.push(item);
    if (JSON.stringify(factsObject).length > MAX_FACTS) {
      data.pop();
      return;
    }
    evidenceKeys.add(key);
    addSource(id, label, section);
  };
  const decorate = (r) => ({
    manager: name(r.uid),
    ...compact(r, saberFields),
  });
  push(
    "overview",
    "seasonCoverage",
    sources.map((s) => ({
      season: seasonLabel(s),
      league: s.league.name,
      status: s.league.status,
      completedWeekCutoff:
        s.league.settings?.last_scored_leg ??
        (s.league.status === "complete" ? 18 : 0),
      lastSavedScoredWeek: Math.max(
        0,
        ...D.weeks
          .filter((w) => w.season === seasonLabel(s))
          .map((w) => w.week),
      ),
      playoffWeekStart: s.league.settings?.playoff_week_start || 15,
      regularWeeksPresent: D.weeks.filter(
        (w) => w.season === seasonLabel(s) && !w.postseason,
      ).length,
      managers: s.rosters.filter((r) => r.owner_id).length,
      draftPicks: (s.picks || []).length,
      completedTransactions: (s.transactions || []).filter(
        (t) => t.status === "complete",
      ).length,
      importWarnings: (s.detailCoverage?.warnings || []).slice(0, 2),
      nflModelLastWeek: s.opportunity?.coverage?.lastWeek ?? null,
    })),
  );
  if (!sources.length)
    push(
      "overview",
      "coverageNotice",
      "No saved seasons match the requested selection.",
    );
  if (
    c.managers.some((m) => m.name === "Kaushal") &&
    c.managers.some((m) => m.name === "Winston")
  )
    push(
      "overview",
      "managerIdentityNote",
      "Kaushal and Winston are two distinct people. Team ownership changed from Kaushal for 2024 to Winston for 2025 onward. This is not an ESPN/Sleeper account alias for one person. Preserve separate single-season and career records.",
    );

  const managerSeasonStandings = (s) => ({
    statisticsScope: "single_season",
    season: s.season,
    rows: s.rows
      .filter((r) => selected(r.uid))
      .slice(0, 5)
      .map((r) => {
        const games = r.w + r.l + r.t;
        return {
          manager: name(r.uid),
          statisticsScope: "single_season",
          season: s.season,
          ...compact(r, ["w", "l", "t", "pf", "pa"]),
          gamesPlayed: games,
          pointsPerGame: games ? rounded(r.pf / games) : null,
          winPctFraction: rounded(rate(r)),
          winPctPercent: rounded(100 * rate(r)),
        };
      }),
  });
  // Exact season lines must precede other sections and aggregate totals, even
  // when the UI currently displays an unrelated feature such as opportunity.
  if (
    uids.length &&
    /record|standings|win percent|win pct|points per game|ppg|season history/.test(
      query,
    )
  )
    for (const s of D.bySeason)
      if (s.rows.some((r) => selected(r.uid)))
        push("profile", "seasonStandings", managerSeasonStandings(s));

  const knownPlayerNames = [
    ...new Set([
      ...D.drafts.map((p) => p.player),
      ...sources.flatMap((s) =>
        Object.values(s.players || {})
          .map((p) => p.name)
          .filter(Boolean),
      ),
    ]),
  ];
  const findPlayerNames = (text) => {
    const full = knownPlayerNames.filter(
      (player) => normalized(player).includes(" ") && mentions(text, player),
    );
    if (full.length) return full;
    return knownPlayerNames.filter(
      (player) =>
        mentions(text, player) ||
        (normalized(player).split(" ").slice(-1)[0]?.length >= 5 &&
          mentions(text, normalized(player).split(" ").slice(-1)[0])),
    );
  };
  let playerNames = findPlayerNames(query);
  if (!playerNames.length && prior) playerNames = findPlayerNames(prior);
  if (
    playerNames.length &&
    !sections.includes("players") &&
    !sections.includes("starts")
  )
    sections.unshift("players");
  const playerSelected = (player) =>
    !playerNames.length || playerNames.includes(player);
  // Relevant rows go first, so the budget cannot evict exact answers in favor of
  // less relevant all-league tables. No user text is copied into the facts.
  for (const section of sections) {
    if (section === "trades") {
      const data = TradeAnalysis.analyze(sources);
      const matching = data.trades.filter(
        (t) =>
          (!safe.trade || t.id === safe.trade) &&
          (!uids.length || t.participants.some((p) => selected(p.uid))) &&
          (week === null || t.week === week),
      );
      push("trades", "tradeAnalyzerCoverage", data.coverage);
      for (const [index, t] of matching
        .slice(0, safe.trade ? 1 : 3)
        .entries()) {
        const periods = (r) =>
          compact(r, [
            "games",
            "w",
            "l",
            "t",
            "ppg",
            "winPct",
            "scoringPlus",
            "expected",
            "expectedPerGame",
            "luck",
            "missingWeeks",
            "firstWeek",
            "lastWeek",
          ]);
        const identity = compact(t, [
          "id",
          "season",
          "week",
          "reportedWeek",
          "timingMethod",
          "cutoff",
          "detailsIncomplete",
          "balance",
          "warnings",
          "excludesNonPlayerAssets",
        ]);
        if (index > 0) {
          push("trades", "otherTradeSummary", {
            ...identity,
            participants: t.participants.map((p) => ({
              manager: name(p.uid),
              receivedPoints: p.receivedPoints,
            })),
          });
          continue;
        }
        push("trades", "tradeAnalysis", {
          ...identity,
          rosterCuts: t.rosterCuts.map((a) => ({
            manager: name(a.uid),
            player: a.player,
            inferred: a.inferred,
          })),
          higherReceivedContribution: t.balance.leaderUid
            ? name(t.balance.leaderUid)
            : null,
          participants: t.participants.map((p) => ({
            manager: name(p.uid),
            receivedPoints: p.receivedPoints,
            sentPackagePointsWithRecipients: p.givenPoints,
            before: periods(p.before),
            after: periods(p.after),
            postseason: periods(p.postseason),
            receivedPlayers: p.received.map((a) => a.player),
            sentPlayers: p.given.map((a) => a.player),
            picksReceived: p.picksReceived,
            picksGiven: p.picksGiven,
            budgetReceived: p.budgetReceived,
            budgetGiven: p.budgetGiven,
          })),
        });
        for (const p of t.participants) {
          push("trades", "tradePlayerContributions", {
            tradeId: t.id,
            season: t.season,
            manager: name(p.uid),
            received: p.received.map((a) =>
              compact(a, [
                "player",
                "pos",
                "pts",
                "starts",
                "regularPoints",
                "postseasonPoints",
                "fromWeek",
                "toWeek",
                "missingWeeks",
              ]),
            ),
            sent: p.given.map((a) =>
              compact(a, [
                "player",
                "pos",
                "pts",
                "starts",
                "fromWeek",
                "toWeek",
              ]),
            ),
          });
        }
      }
    }
    if (section === "comebacks") {
      const data = ComebackHistory.analyze(sources);
      push("comebacks", "comebackHistoryCoverage", data.coverage);
      const rows = data.comebacks.filter(
        (g) =>
          (!uids.length || selected(g.winnerUid) || selected(g.loserUid)) &&
          (!safe.matchup ||
            `${g.season}|${g.week}|${g.matchupId}` === safe.matchup) &&
          (week === null || g.week === week),
      );
      for (const g of rows.slice(0, safe.matchup ? 1 : 5))
        push("comebacks", "historicalComeback", {
          winner: name(g.winnerUid),
          opponent: name(g.loserUid),
          finalMatchupScore: {
            winner: name(g.winnerUid),
            winnerPoints: g.winnerPoints,
            opponent: name(g.loserUid),
            opponentPoints: g.loserPoints,
          },
          ...compact(g, [
            "season",
            "week",
            "maxDeficit",
            "lowestWinProbability",
            "winnerPoints",
            "loserPoints",
            "method",
            "samples",
            "source",
            "probabilitySource",
            "deficitAt",
          ]),
          ...(safe.matchup ? { trace: g.trace } : {}),
        });
    }
    if (section === "starts") {
      const regularRequested = /\bregular (?:season|weeks|games)\b/.test(query);
      const postseasonRequested =
        /\bpostseason\b|\bpost season\b|\bplayoffs?\b|\bconsolation\b/.test(
          query,
        );
      const allRequested =
        /\ball (?:completed )?(?:weeks|games)\b|\bincluding (?:the )?(?:playoffs|postseason)\b/.test(
          query,
        );
      const phase =
        allRequested || (regularRequested && postseasonRequested)
          ? "all"
          : regularRequested
            ? "regular"
            : postseasonRequested
              ? "postseason"
              : safe.games;
      factsObject.scope.playerStartsGames = phase;
      const phaseMatches = (postseason) =>
        phase === "all" || (phase === "postseason") === postseason;
      const coverageRows = (D.startCoverage || [])
        .filter((r) => selected(r.uid))
        .map((r) => {
          const start =
            sources.find((s) => seasonLabel(s) === r.season)?.league.settings
              ?.playoff_week_start || 15;
          const completedWeeks = (r.completedWeekNumbers || []).filter((week) =>
            phaseMatches(week >= start),
          ).length;
          const lineupWeeks = (r.lineupWeekNumbers || []).filter((week) =>
            phaseMatches(week >= start),
          ).length;
          const missingWeeks = r.missingWeeks.filter((week) =>
            phaseMatches(week >= start),
          );
          return {
            manager: name(r.uid),
            season: r.season,
            games: phase,
            completedWeeks,
            lineupWeeks,
            missingWeeks,
            complete: !missingWeeks.length,
          };
        });
      push("starts", "playerStartCoverage", coverageRows);
      const rows = summarizePlayerStarts(
        (D.playerStartWeeks || []).filter(
          (r) =>
            selected(r.uid) &&
            (safe.position === "all" || r.position === safe.position) &&
            phaseMatches(r.postseason) &&
            (week === null || r.week === week),
        ),
      ).filter((r) => playerSelected(r.player));
      const top = [];
      const managerCounts = new Map();
      const perManager = uids.length || playerNames.length ? 10 : 1;
      for (const r of rows) {
        const count = managerCounts.get(r.uid) || 0;
        if (count >= perManager) continue;
        managerCounts.set(r.uid, count + 1);
        top.push(r);
      }
      for (const r of top)
        push("starts", "managerPlayerStarts", {
          manager: name(r.uid),
          games: phase,
          ...compact(r, [
            "player",
            "position",
            "starts",
            "regularStarts",
            "postseasonStarts",
            "points",
            "scoredStarts",
            "seasons",
            "firstSeason",
            "lastSeason",
          ]),
        });
      if (!rows.length)
        push(
          "starts",
          "coverageNotice",
          "No observed starter appearances match the selected player, manager, season and game scope; missing lineups are not evidence of zero starts.",
        );
    }
    if (
      ["saber", "charts"].includes(section) ||
      (section === "profile" && uids.length)
    ) {
      const metric = /regret/.test(query)
        ? "lineupRegret"
        : /efficiency/.test(query)
          ? "lineupEfficiency"
          : /volatility|consistent/.test(query)
            ? "volatility"
            : /dominance/.test(query)
              ? "dominance"
              : /boom/.test(query)
                ? "boom"
                : /bust/.test(query)
                  ? "bust"
                  : /pala/.test(query)
                    ? "pala"
                    : /xw|expected wins/.test(query)
                      ? "xw"
                      : "scoringPlus";
      const ascending =
        /worst|lowest|least/.test(query) ||
        (metric === "volatility" && /consistent|least/.test(query));
      const sortMetric = (a, b) => {
        const av = a[metric],
          bv = b[metric];
        if (av == null) return 1;
        if (bv == null) return -1;
        return ascending ? av - bv : bv - av;
      };
      const rows = D.saber.filter((r) => selected(r.uid)).sort(sortMetric);
      for (let i = 0; i < Math.min(rows.length, uids.length ? 12 : 8); i++)
        push("saber", "managerSeasonStatLine", decorate(rows[i]));
      if (!years.length)
        for (const r of D.saberCareer
          .filter((r) => selected(r.uid))
          .sort(sortMetric)
          .slice(0, uids.length ? 4 : 6))
          push("saber", "managerCareerStatLine", decorate(r));
      if (uids.length)
        for (const r of rows) {
          const weekly = r.weekly
            .filter((w) => week === null || w.week === week)
            .slice(0, week === null ? 5 : 2)
            .map((w) => ({
              ...compact(w, weeklyFields),
              opponent: name(w.opponentUid),
              optimumStarters:
                w.optimumStarters?.map(
                  (pid) =>
                    sources.find((s) => seasonLabel(s) === r.season)?.players?.[
                      pid
                    ]?.name || String(pid),
                ) ?? null,
            }));
          push("saber", "weeklyStatEvidence", {
            manager: name(r.uid),
            season: r.season,
            weekly,
          });
        }
    }
    if (section === "opportunity") {
      const rows = opportunityRows(sources, uids);
      for (const r of opportunitySummary(rows)
        .sort(
          (a, b) => (b.xfpPerWeek ?? -Infinity) - (a.xfpPerWeek ?? -Infinity),
        )
        .slice(0, uids.length ? 12 : 8))
        push("opportunity", "managerOpportunitySummary", {
          manager: name(r.uid),
          ...compact(r, [
            "season",
            "observed",
            "weeks",
            "xfp",
            "actual",
            "fpoe",
            "xfpPerWeek",
            "actualPerWeek",
            "fpoePctActual",
          ]),
        });
      const players = starterPlayers(sources, uids)
        .filter((p) => playerSelected(p.player))
        .sort((a, b) => b.xfp - a.xfp);
      for (const p of players.slice(0, 8))
        push(
          "opportunity",
          "starterPlayerOpportunity",
          compact(p, [
            "season",
            "player",
            "position",
            "starts",
            "xfp",
            "actual",
            "fpoe",
            "targets",
            "carries",
            "airYards",
            "nflTeamOpportunityShare",
          ]),
        );
      if (week !== null || uids.length)
        for (const r of rows
          .filter((r) => week === null || r.week === week)
          .slice(-6))
          push("opportunity", "weeklyOpportunityCoverage", {
            manager: name(r.uid),
            ...compact(r, [
              "season",
              "week",
              "complete",
              "covered",
              "total",
              "excluded",
            ]),
            xfp: r.complete ? rounded(r.xfp) : null,
            actual: r.complete ? rounded(r.actual) : null,
            fpoe: r.complete ? rounded(r.fpoe) : null,
          });
    }
    if (section === "drafts") {
      let rows = D.drafts.filter(
        (p) => selected(p.uid) && playerSelected(p.player),
      );
      const perStart = /per start|points?\s*\/\s*start|\brate\b/.test(query);
      const MIN_STARTS = 8;
      // Matches the site: a pick that never reached the drafting roster is not
      // evaluable and leaves both rankings, so a "worst pick" answer cannot be
      // a player who was traded away before week 1.
      const evaluable = (p) => p.rostered !== 0;
      const rateReady = (p) =>
        p.starts >= MIN_STARTS && p.valuePerStart !== null;
      if (/never start|not started|traded away|benched/.test(query))
        for (const n of rows
          .filter((p) => p.starts === 0)
          .sort((a, b) => a.round - b.round || a.pick - b.pick)
          .slice(0, 10))
          push("drafts", "draftPickNeverStarted", {
            manager: name(n.uid),
            ...compact(n, [
              "season",
              "player",
              "pos",
              "round",
              "pick",
              "rostered",
            ]),
            neverRostered: n.rostered === 0,
          });
      if (/bargain/.test(query)) rows = rows.filter((p) => p.round >= 8);
      if (/disappointment|bust|worst/.test(query))
        rows = rows
          .filter((p) => p.round <= 3 && evaluable(p))
          .filter((p) => !perStart || rateReady(p))
          .sort((a, b) =>
            perStart
              ? (a.valuePerStart ?? Infinity) - (b.valuePerStart ?? Infinity)
              : (a.value ?? Infinity) - (b.value ?? Infinity),
          );
      else {
        if (/value|bargain/.test(query)) rows = rows.filter(evaluable);
        if (perStart) rows = rows.filter(rateReady);
        rows.sort((a, b) =>
          perStart
            ? (b.valuePerStart ?? -Infinity) - (a.valuePerStart ?? -Infinity)
            : /value|bargain/.test(query)
              ? (b.value ?? -Infinity) - (a.value ?? -Infinity)
              : (b.pts ?? -Infinity) - (a.pts ?? -Infinity),
        );
      }
      for (const p of rows.slice(0, 10))
        push("drafts", "draftPickContribution", {
          manager: name(p.uid),
          ...compact(p, [
            "season",
            "player",
            "pos",
            "round",
            "pick",
            "pts",
            "starts",
            "scoredStarts",
            "rostered",
            "ptsPerStart",
            "value",
            "roundMean",
            "valuePerStart",
            "roundPerStart",
          ]),
        });
    }
    if (section === "players") {
      const rows = playerHistory(sources, uids, playerNames).sort(
        (a, b) => b.weeksStarted - a.weeksStarted,
      );
      if (!sources.some((s) => s.src === "Sleeper"))
        push(
          "players",
          "coverageNotice",
          "Player history page includes Sleeper history only; ESPN player history is not shown in that page.",
        );
      for (const r of rows.slice(0, playerNames.length ? 12 : 6))
        push("players", "playerSeasonManagerHistory", {
          manager: name(r.uid),
          ...compact(r, [
            "player",
            "position",
            "season",
            "weeksRostered",
            "weeksStarted",
            "starterPoints",
            "recordOnRoster",
            "recordWhenStarted",
            "averagePointsPerStart",
            "playoffs",
            "champion",
          ]),
        });
    }
    if (section === "moves") {
      const type = /trade/.test(query)
        ? "trade"
        : /waiver/.test(query)
          ? "waiver"
          : /free agent/.test(query)
            ? "free_agent"
            : null;
      const moves = D.moves.filter(
        (m) =>
          (!type || m.type === type) &&
          (!uids.length ||
            [...m.adds, ...m.drops].some((p) => selected(p.uid))) &&
          (!playerNames.length ||
            [...m.adds, ...m.drops].some((p) => playerSelected(p.player))),
      );
      push("moves", "transactionCoverage", {
        matchingRecords: moves.length,
        typeCounts: Object.fromEntries(
          ["trade", "waiver", "free_agent"].map((type) => [
            type,
            moves.filter((m) => m.type === type).length,
          ]),
        ),
        espnCompletenessUnverified: sources.some((s) => s.src === "ESPN"),
      });
      const value = (m) => m.adds.reduce((sum, p) => sum + (p.pts || 0), 0);
      moves.sort((a, b) =>
        /best|most|value|productive/.test(query)
          ? value(b) - value(a)
          : b.date - a.date,
      );
      for (const m of moves.slice(0, 8))
        push("moves", "completedTransaction", {
          ...compact(m, ["season", "type", "week", "details_incomplete"]),
          adds: m.adds.map((p) => ({
            manager: name(p.uid),
            ...compact(p, ["player", "pts", "starts"]),
          })),
          drops: m.drops.map((p) => ({
            manager: name(p.uid),
            player: p.player,
          })),
          draftPickTransfers: m.picks,
          faabTransfers: m.budget,
        });
    }
    if (section === "weekly") {
      const weeks = D.weeks
        .filter((w) => week === null || w.week === week)
        .slice(week === null ? -1 : 0);
      for (const w of weeks.slice(0, 3)) {
        const games = w.games.filter(
          (g) => !uids.length || selected(g.a) || selected(g.b),
        );
        push("weekly", "weekRecap", {
          season: w.season,
          week: w.week,
          postseason: !!w.postseason,
          highestScores: [...w.scores]
            .sort((a, b) => b.pts - a.pts)
            .slice(0, 3)
            .map((s) => ({ manager: name(s.uid), points: s.pts })),
          games: games.map((g) => ({
            managerA: name(g.a),
            managerB: name(g.b),
            ...compact(g, ["pa", "pb", "margin", "upset"]),
            winner: g.winner ? name(g.winner) : null,
          })),
          standingsChanges: w.changes
            .filter((s) => selected(s.uid))
            .slice(0, 4)
            .map((s) => ({
              manager: name(s.uid),
              rank: s.rank,
              change: s.change,
            })),
        });
      }
    }
    if (section === "records") {
      const games = D.games.filter(
        (g) => !uids.length || selected(g.a) || selected(g.b),
      );
      const g = (game) => ({
        managerA: name(game.a),
        managerB: name(game.b),
        ...compact(game, ["season", "week", "pa", "pb", "margin"]),
      });
      push(
        "records",
        "largestRegularSeasonMargins",
        [...games]
          .sort((a, b) => b.margin - a.margin)
          .slice(0, 3)
          .map(g),
      );
      push(
        "records",
        "closestRegularSeasonGames",
        [...games]
          .sort((a, b) => a.margin - b.margin)
          .slice(0, 3)
          .map(g),
      );
      push("records", "highAndLowRegularSeasonScores", {
        high: D.scores
          .filter((s) => selected(s[1]))
          .sort((a, b) => b[0] - a[0])
          .slice(0, 3)
          .map(([points, uid, season, week]) => ({
            manager: name(uid),
            season,
            week,
            points,
          })),
        low: D.scores
          .filter((s) => selected(s[1]))
          .sort((a, b) => a[0] - b[0])
          .slice(0, 3)
          .map(([points, uid, season, week]) => ({
            manager: name(uid),
            season,
            week,
            points,
          })),
      });
      push("records", "winningStreaksAndComebacks", {
        streaks: Object.entries(D.all)
          .filter(([uid]) => selected(uid))
          .sort(([, a], [, b]) => b.bestStreak - a.bestStreak)
          .slice(0, 4)
          .map(([uid, a]) => ({ manager: name(uid), wins: a.bestStreak })),
        comebacks: D.comebacks
          .filter((r) => selected(r.uid))
          .sort((a, b) => b.gain - a.gain)
          .slice(0, 3)
          .map((r) => ({
            manager: name(r.uid),
            ...compact(r, ["season", "from", "to", "gain"]),
          })),
      });
      push(
        "records",
        "competitiveRivalries",
        D.rivalries
          .filter(
            (r) =>
              r.games >= 2 && (!uids.length || selected(r.a) || selected(r.b)),
          )
          .sort(
            (a, b) =>
              a.balance / a.games - b.balance / b.games || b.games - a.games,
          )
          .slice(0, 4)
          .map((r) => ({
            managerA: name(r.a),
            managerB: name(r.b),
            ...compact(r, ["w", "l", "t", "games"]),
          })),
      );
    }
    if (
      ["overview", "luck", "profile", "charts", "sharing"].includes(section)
    ) {
      const ranked = Object.entries(D.all).sort(
        ([, a], [, b]) => rate(b) - rate(a) || b.pf - a.pf,
      );
      const rankByUid = Object.fromEntries(
        ranked.map(([uid], i) => [uid, i + 1]),
      );
      const ordered = [...ranked];
      if (/title|champion/.test(query))
        ordered.sort(([, a], [, b]) => b.titles - a.titles);
      else if (/luck/.test(query))
        ordered.sort(([, a], [, b]) =>
          /unluck|worst|least/.test(query)
            ? a.actual - a.expected - (b.actual - b.expected)
            : b.actual - b.expected - (a.actual - a.expected),
        );
      else if (/points|scoring/.test(query))
        ordered.sort(([, a], [, b]) => b.pf - a.pf);
      for (const [uid, a] of ordered)
        if (selected(uid))
          push("overview", "standingsTotals", {
            manager: name(uid),
            statisticsScope: "aggregate_selected_seasons",
            seasonsIncluded: D.bySeason
              .filter((s) => s.rows.some((r) => r.uid === uid))
              .map((s) => s.season),
            rank: rankByUid[uid],
            ...compact(a, [
              "w",
              "l",
              "t",
              "pf",
              "pa",
              "seasons",
              "po",
              "titles",
              "finals",
              "actual",
              "expected",
              "played",
              "apw",
              "apl",
              "apt",
            ]),
            aggregateWinPctFraction: rounded(rate(a)),
            aggregateWinPctPercent: rounded(100 * rate(a)),
            scheduleLuck: rounded(a.actual - a.expected),
            aggregatePointsPerGame:
              a.w + a.l + a.t ? rounded(a.pf / (a.w + a.l + a.t)) : null,
          });
      push(
        "overview",
        "championships",
        D.champs.map((r) => ({
          season: r.season,
          champion: r.champ ? name(r.champ) : null,
          runnerUp: r.runner ? name(r.runner) : null,
          regularSeasonTop: r.top ? name(r.top) : null,
        })),
      );
      if (uids.length || section === "charts")
        for (const s of D.bySeason) {
          push("profile", "seasonStandings", managerSeasonStandings(s));
        }
      if (uids.length && ["profile", "overview"].includes(section))
        for (const uid of uids) {
          push("profile", "headToHead", {
            manager: name(uid),
            regularSeason: Object.entries(D.h2h[uid] || {})
              .sort(([, a], [, b]) => b[1] - a[1] || a[0] - b[0])
              .slice(0, 5)
              .map(([opponent, [w, l, t]]) => ({
                opponent: name(opponent),
                w,
                l,
                t,
              })),
            playoff: Object.entries(D.playoffH2h[uid] || {}).map(
              ([opponent, [w, l, t]]) => ({
                opponent: name(opponent),
                w,
                l,
                t,
              }),
            ),
            consolation: Object.entries(D.consolationH2h[uid] || {}).map(
              ([opponent, [w, l, t]]) => ({
                opponent: name(opponent),
                w,
                l,
                t,
              }),
            ),
          });
        }
    }
  }
  const coverage = {
    savedLeague: true,
    externalLeague: false,
    savedSnapshotOnly: true,
    snapshotUpdatedAt: c.updatedAt,
    requestedScopeAvailable: sources.length > 0,
    selectedSeasons: sources.map(seasonLabel),
    selectedManagers: uids.map((id) => name(id)),
    boundedRetrieval: true,
    espnTransactionsComplete: sources.some((s) => s.src === "ESPN")
      ? "unverified"
      : "not_applicable",
  };
  return {
    facts: JSON.stringify(factsObject),
    sources: [...sourceMap.values()],
    coverage,
  };
}

module.exports = { buildContext, getCatalog, parseSnapshot };
