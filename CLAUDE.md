# League Wrapped — architecture notes

A fantasy-football history dashboard for **Sleeper** leagues, plus an authenticated
**ESPN** import of the league's 2024 season, plus an optional LLM assistant
("LeagueGuide"). No framework, no bundler, no TypeScript: plain browser
JavaScript, Python importers, and one Node HTTP server.

Repo: `parikhneil/league-wrapped`. Deployed as static assets + one serverless
function (Netlify Functions; a Cloudflare Workers config is also checked in).

---

## The one idea that explains the layout

**There is exactly one statistics engine, `league-stats.js`, and it runs in three
places:** the live browser page, the generated self-contained `report*.html`
files, and Node (tests, chat context). Python never recalculates dashboard
statistics — `build_report.py` normalizes raw platform JSON into a common shape
and then *embeds* the same JS files into the saved reports.

Every shared module uses the same UMD-ish wrapper so it works in both environments:

```js
(function (root) {
  "use strict";
  /* ... */
  const api = { analyze, /* ... */ };
  if (typeof module !== "undefined") module.exports = api;
  root.LeagueStats = api;   // also TradeAnalysis, ComebackHistory, LeagueUI
})(typeof window !== "undefined" ? window : globalThis);
```

If you add a calculation, it goes in `league-stats.js` (or a sibling analyzer),
never duplicated into Python or into `league-ui.js`.

---

## Data flow

```
Sleeper API   --fetch_sleeper_history.py--> data/<season>/*.json
ESPN API      --fetch_espn_details.py-----> data_espn/<season>/*.json  (espn_s2 + SWID)
ffopportunity --fetch_nfl_opportunity.py--> data_nfl/*.json            (cached)
nflverse      --fetch_comeback_history.py-> data/<season>/comeback_history.json
                              |
                              v
                        build_report.py
                 (identity resolution + normalization)
                              |
          +-------------------+-------------------------+
          v                   v                         v
   league-data.js        report.html               espn_league.js
 window.LEAGUE_SNAPSHOT  report_sleeper.html       window.ESPN_SEASONS
 (committed snapshot)    report_espn.html          window.LEAGUE_NAMES
                         players.html
                         (self-contained; engine inlined)
                              |
                              v
                          index.html
             renders the snapshot instantly, then refreshes
                live Sleeper history over the top
```

All three `data*` folders are **gitignored and absent from a fresh checkout**.
The generated `league-data.js` (~2.2 MB), `espn_league.js` (~940 KB) and the
`report*.html` files **are committed** — that is what makes the site work with no
backend, and what the chat assistant reads as its evidence base.

### Season shape (the contract between Python and JS)

`build_report.py::snapshot()` emits one object per season, and `index.html` builds
the *same* shape from the live Sleeper API:

```js
{ src: "Sleeper" | "ESPN", league, users: [{user_id, display_name}], rosters,
  bracket, losersBracket, weeks /* 18 entries, 1-indexed weeks */,
  picks, transactions,
  players /* id -> {name, position, fantasy_positions, gsis_id, espn_id, team} */,
  detailCoverage, opportunity, comebackHistory }
```

`LeagueStats.analyze(seasons, namesOverride)` consumes an array of those and
returns one `D` object keyed roughly by feature: `all`, `bySeason`, `saber`,
`saberCareer`, `playerStarts`, `playerStartWeeks`, `startCoverage`, `drafts`,
`pickups`, `drops`, `moves`, `champs`, `comebacks`, `rivalries`, `h2h`,
`playoffH`, `consolationH`, `scores`, `weeks`, `games`, `names`.

---

## File map

### Browser / shared engine
| File | Role |
|---|---|
| `league-stats.js` | **The** statistics engine. Slot eligibility (`slotPositions`, `slotAliases`), `optimizeLineup`, sabermetrics (`summarizeSaber`), player starts, drafts, pickups/drops, rivalries. Exports `{analyze, rate, optimizeLineup, summarizePlayerStarts}`. |
| `trade-analysis.js` | Completed trade packages, holding-period contribution, before/after season comparison, balance score. Exports `{analyze}`. |
| `comeback-history.js` | Validates score checkpoints, ranks comeback wins, reports coverage gaps. Exports `{analyze}`. |
| `league-ui.js` | Everything visual: ~2300 lines, one large `mount(el, seasons, names)`, plus `table()` and `sort()`. All tabs, filters, charts, PNG recap cards. |
| `league.css` | Responsive styling + dark mode. |
| `index.html` | Live page. `DEFAULT_LEAGUE` constant, Sleeper API client, `loadHistory()` walks `previous_league_id` backwards (with cycle detection), Combined/Sleeper/ESPN switcher, falls back to the saved snapshot per-request when the API fails. |
| `chat-widget.js` / `chat-widget.css` | LeagueGuide UI; sends the current section/manager/season/platform filters as `selection`. |

### Generated (committed — do not hand-edit)
`league-data.js`, `espn_league.js`, `report.html`, `report_sleeper.html`,
`report_espn.html`, `players.html`. Regenerate with `python build_report.py`.

### Python importers
| File | Role |
|---|---|
| `build_report.py` | Identity resolution + normalization + page generation. Holds `ESPN_TO_SLEEPER` (cross-platform account matching) and `REAL_NAMES` (display only). |
| `fetch_sleeper_history.py` | Walks the league chain, writes `data/<season>/`. Its `LEAGUE_ID` constant is separate from `DEFAULT_LEAGUE` in `index.html`. |
| `fetch_espn_details.py` | Authenticated ESPN drafts / lineups / transactions. Reads `espn_secrets.json` (gitignored), never logs it. |
| `fetch_nfl_opportunity.py` | ffopportunity expected stats, ID crosswalks, league-scoring normalization. Also exports `build_opportunity()`, which `build_report.py` imports. |
| `fetch_comeback_history.py` | nflverse game mapping → reconstructed overnight score checkpoints. |
| `record_comebacks.py` | Optional live Sleeper score poller (minimum 15s interval). |
| `setup_data.py` | First-run orchestrator for all of the above. `--espn-only`, `--skip-nfl`, `--skip-comebacks`, `--league-id`, `--season`. |
| `show_playoffs.py` | Diagnostic playoff list. |

### Chat backend
| File | Role |
|---|---|
| `server.mjs` | Local dev server **and** the shared security core. Exports `loadLocalEnv`, `validateChatBody`, `isInjection`, `createGuide`, `createApp`. Serves only the `ASSETS` allowlist. Routes `GET/POST /api/chat/session` and `POST /api/chat`. |
| `netlify/functions/league-chat.mjs` | Deployed chat API. **Imports `createGuide`, `isInjection`, `validateChatBody` from `server.mjs`** — validation is not duplicated. Sessions live in a private Netlify Blobs store with a 30-minute TTL. |
| `chat-context.cjs` | Chooses the evidence sent to the model: parses `league-data.js`, `SECTION_LABELS`, the `GUIDE` metric definitions, `MAX_FACTS = 14000`. Exports `{buildContext, getCatalog, parseSnapshot}`. |

Provider is **Groq** (`GROQ_API_KEY`, default `GROQ_MODEL=openai/gpt-oss-120b`),
called with a JSON response schema. A separate "scope" completion gates
off-topic questions before the answer call.

### Build / deploy
| File | Role |
|---|---|
| `build-netlify.mjs` | Copies the frozen `PUBLIC_ASSETS` allowlist into `dist/`. Refuses symlinks, non-root files, and any asset matching `gsk_…` (API-key leak guard). |
| `netlify.toml` | `publish = dist`, esbuild bundler, `included_files` for the function, strict CSP + security headers. |
| `wrangler.jsonc` | Cloudflare equivalent; runs `npm run build` itself so the dashboard build command does not matter. |
| `.github/workflows/update.yml` | Tuesdays 10:00 UTC + manual dispatch. Refreshes Sleeper/NFL/comebacks, rebuilds reports, runs both test suites, commits the generated files. |

---

## Commands

```sh
npm ci && npm start     # dev server on http://127.0.0.1:8001 (chat on if .env has a key)
npm test                # node --test tests/*.test.js
python -m unittest discover -s tests -p 'test_*.py'
npm run build           # allowlisted dist/
python build_report.py  # regenerate snapshot + reports
python setup_data.py    # first-time full data bootstrap (prompts for ESPN creds)
```

Node 20+. `python3 -m http.server 8000` also serves the dashboard, just without chat.

---

## Invariants worth not breaking

1. **One engine.** Don't reimplement a stat in Python or in `league-ui.js`.
   `build_page()` inlines `league-stats.js`, `trade-analysis.js`,
   `comeback-history.js`, `league-ui.js` and both CSS files into each report.
2. **Unknown is `null`, never `0`.** Missing lineups, missing ESPN scores and
   missing NFL mappings surface as "unavailable" plus a coverage note. Tests
   enforce this; substituting zero silently invents data.
3. **Identity.** `ESPN_TO_SLEEPER` is the only cross-platform join; `REAL_NAMES`
   is display-only and must never affect matching. Kaushal (2024) and Winston
   (2025+) are deliberately separate people.
4. **Timing is conservative.** Acquired-player contribution starts the week
   *after* the transaction and ends after the week of the next drop/trade away;
   same-week points are excluded because weekly snapshots don't establish lineup
   timing. Trades are excluded from the waiver boards — the trade analyzer values
   them as packages instead.
5. **Completed, paired regular-season weeks only** for Stat Lab leaderboards;
   future weeks are cut using Sleeper's `last_scored_leg`. Platform bonus/median
   wins never enter luck or expected-wins math.
6. **ESPN preservation.** `preserve_saved_espn()` keeps the published
   `espn_league.js` history when raw ESPN files are absent, so a Sleeper-only CI
   refresh cannot erase ESPN seasons. `build_report.py` also refuses an
   ESPN-only rebuild when Sleeper data is missing.
7. **Nothing secret gets published.** Publishing is allowlist-based in
   `build-netlify.mjs`; `.env`, `espn_secrets.json`, `data*/`, `server.mjs` and
   the Python scripts are never copied into `dist/` and never served by
   `server.mjs` (which has an explicit `ASSETS` map, not a static file handler).
8. **Chat validation is shared.** Change `validateChatBody` / `isInjection` /
   `createGuide` in `server.mjs` only — the Netlify function imports them.
   `validateChatBody` uses `exactObject()`, so adding a `selection` field means
   updating its allowlist *and* `SECTIONS` in `server.mjs` *and*
   `SECTION_LABELS` in `chat-context.cjs`.

## Gotchas

- Two different league IDs: `DEFAULT_LEAGUE` in `index.html` (what the site
  renders) and `LEAGUE_ID` in `fetch_sleeper_history.py` (what gets downloaded).
- `data/`, `data_espn/`, `data_nfl/` are absent in a fresh clone, so
  `build_report.py` exits with "No data found" until `setup_data.py` runs.
- `league-data.js` is ~2.2 MB and `report.html` ~2.4 MB — grep them, don't read
  them whole.
- `espn_league.js` contains `window.ESPN_SEASONS` *and* `window.LEAGUE_NAMES`;
  the live page applies `LEAGUE_NAMES` only for the default league.
- The weekly workflow commits generated files, so a local rebuild conflicts with
  CI if you don't pull first.
- The `README.md` is the user-facing doc and is unusually detailed about metric
  definitions and their caveats — check it before changing a stat's semantics.
