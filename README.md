# League Wrapped

A fantasy-football history dashboard for Sleeper leagues, with saved ESPN history for our league. Plain JavaScript frontend, Python data importers, and a Node service for the optional LeagueGuide assistant.

## Run

```sh
npm ci
npm start
```

Use Node 20 or newer and open the address printed by the server (normally http://127.0.0.1:8001). The default league renders the saved snapshot immediately, then refreshes Sleeper history. Enter another Sleeper league ID or username to explore another league. The Combined / Sleeper / ESPN buttons filter every feature.

For a dashboard without chat, `python3 -m http.server 8000 --bind 127.0.0.1` still works; open http://127.0.0.1:8000. LeagueGuide explains that it needs the chat server when opened there.

`report.html`, `report_sleeper.html`, and `report_espn.html` are self-contained saved dashboards: you can open them directly without a server or internet. They require JavaScript. `players.html` is the player-history search.

## LeagueGuide chat

Click **Ask LeagueGuide** on the dashboard or a saved report to ask about statistics, managers, matchups, drafts, transactions, lineup regret, NFL opportunity models, filters, and the Players page. Questions use the current section, manager, season, and platform filters. Answers link to relevant sections. The assistant analyzes the saved league snapshot; live Sleeper refreshes may be newer. When you load another league, it can explain metrics and site features but does not invent analysis of that league's unavailable data.

For local chat, create a project-root `.env` file containing a `GROQ_API_KEY` assignment with your own Groq key, then run `npm start`. `.env` is ignored and is never served by the Node server or copied into the publish directory. The default model is `openai/gpt-oss-120b`; optionally set `GROQ_MODEL` in `.env` or the server environment to change it. Chat shows an unavailable state if the key is absent; the dashboard still works. Keep keys out of HTML, JavaScript snapshots, Git, and shared data folders.

The server sends Groq the question, recent conversation, relevant saved dashboard facts, and metric definitions. It does not send ESPN authentication cookies or the Groq API key as conversation content. The widget keeps its visible conversation in memory, with no local-storage history. Sessions expire after 30 minutes. The local server keeps the last four question/answer pairs in memory; Netlify keeps them temporarily in a private Netlify Blobs store. Expired records are pruned during subsequent service activity. **New chat** clears the current session's conversation.

The assistant is scoped to the league, site, and fantasy-football statistics. Server-side request validation, origin checks, CSRF protection, bounded context/history, rate limits, and input/output screening limit abuse. It has no tools to execute code, browse arbitrary URLs, or change league data. Replies render as plain text; source links use known site sections. Prompt-injection defenses reduce risk but cannot guarantee that every adversarial question will be detected or every answer will be correct.

## Deploy with Netlify

Connect this repository to Netlify with Node 20 or newer. The checked-in `netlify.toml` selects `npm run build`, publishes only `dist/`, and bundles the chat function from `netlify/functions/`. Locally, run `npm ci` before `npm run build`. This build copies the allowlisted public dashboard assets and generated reports; it does not publish the repository root, raw data folders, `.env`, or `espn_secrets.json`. Generate refreshed reports before building if your local data has changed.

In your Netlify project's environment-variable settings, add `GROQ_API_KEY` with the **Functions** scope for the deployment contexts that should have chat. Optionally add `GROQ_MODEL` with the same scope; it defaults to `openai/gpt-oss-120b`. Save the variables and redeploy. Set these secrets through Netlify's UI rather than `netlify.toml`, since variables declared in that file are not available to Functions. See [Netlify's Functions environment-variable documentation](https://docs.netlify.com/build/functions/environment-variables/).

Deploy through the connected repository so Netlify builds the Functions and configures its private Blobs store. Uploading only static HTML files does not provide a chat backend. Generated reports and snapshots remain public league data, even though the raw data folders and credentials are excluded.

## Refresh saved data

For a fresh checkout, including ESPN history without sharing data folders:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python setup_data.py
npm ci
npm start
```

The helper prompts for your own `espn_s2` and `SWID` using hidden input unless valid local credentials already exist. It downloads Sleeper history, initializes ESPN 2024 standings, managers, matchups, playoff participants and championship result, imports drafts/player scores/transactions, refreshes public NFL opportunity data, reconstructs historical game-day comebacks, and rebuilds reports. Open the address printed by `npm start`. To enable chat, configure your own Groq key as described above. Use `python setup_data.py --espn-only` to skip Sleeper when its data already exists. Optional `--league-id` and `--season` select another ESPN league/year. `--skip-nfl` skips opportunity data and `--skip-comebacks` skips comeback reconstruction; the helper always performs a final report rebuild. Your ESPN account must have access to the league.

Both `data/` and `data_espn/` are ignored. Previously tracked ESPN files stay tracked until removed from Git's index with `git rm -r --cached data_espn` (local files remain). Generated reports and JavaScript snapshots also contain league data; ignoring raw folders alone does not remove those snapshots from Git.

Run from the project directory:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install requests
python fetch_sleeper_history.py
python fetch_nfl_opportunity.py --no-build
python fetch_comeback_history.py --no-build
python build_report.py
```

`fetch_sleeper_history.py` walks the league's previous-season chain and saves matchups, drafts, players, and transactions under `data/`. This folder is ignored by Git. Change `LEAGUE_ID` in that script to change the downloaded league; the live page has its own `DEFAULT_LEAGUE`.

ESPN data lives under `data_espn/`; its private fetch script and credentials are excluded. The builder refuses an ESPN-only rebuild if Sleeper data is absent, to avoid overwriting the combined history by mistake.

`ESPN_TO_SLEEPER` in `build_report.py` matches the same person's accounts across platforms. `REAL_NAMES` only controls display names. Kaushal (2024) and Winston (2025 onward) intentionally have separate records.

GitHub Actions refreshes Sleeper data, public NFL opportunity data, historical game-day comebacks, and saved reports every Tuesday at 10:00 UTC and supports manual runs. The generated `league-data.js` snapshot is committed alongside the report files. When raw ESPN files are absent, the builder preserves the published `espn_league.js` history, so scheduled Sleeper refreshes do not erase ESPN seasons. The weekly workflow does not continuously record live game scores.

## Features and definitions

- **Fantasy Stat Lab:** season and career Scoring+, PALA, schedule-neutral wins (xW), matchup dominance, boom/bust weeks, relative scoring volatility, legal lineup regret, lineup efficiency and hindsight wins found. Filter by season, manager and minimum weeks, inspect the weekly evidence, and compare actual wins against xW on the scatterplot. Manager profiles include baseball-style season lines.
- **xFP and opportunity:** published ffopportunity expected offensive stats, reweighted to league scoring. Compare actual modeled points against expected points (FPOE), inspect starter targets/carries/air yards, and check player-match coverage. Data come from the [ffopportunity models](https://ffopportunity.ffverse.com/) and [published releases](https://github.com/ffverse/ffopportunity/releases/tag/latest-data), attributed under CC BY-SA 4.0. K/DST, returns, fumbles and nonlinear bonuses are excluded from both expected and actual modeled points; these totals differ from full matchup scores. Model training uses 2006–2020 play-by-play. This describes opportunity after games, not future scoring or a calibrated win prediction.

Scoring+ = 100 × manager points / summed weekly league-average points, so 100 is average and 115 is 15% above average. PALA sums weekly points minus league average. xW is the existing all-play expected-wins calculation. Dominance averages matchup margin / weekly population scoring standard deviation. Boom/bust means at least one standard deviation above/below weekly mean; volatility is the population standard deviation of weekly scoring z-scores. Equal-score weeks use zero z-score and dominance.

Lineup regret uses maximum-weight legal player-to-slot assignment, including FLEX and SUPER_FLEX eligibility. Reserve/taxi players are excluded; empty slots are allowed. All roster scores, starter scores, positions and lineup rules must be known and validated against matchup points. Season/career totals stay unavailable if any qualifying week lacks coverage; weekly covered results remain visible. Efficiency is actual points / optimal points; hindsight wins count losses or ties an optimal lineup would turn into wins against the opponent's recorded lineup. This is hindsight, not a measure of decision quality before games.

All Stat Lab leaderboards use completed, paired regular-season weeks and exclude platform bonus wins and postseason games. Career Scoring+ weights the actual weekly scoring baselines rather than averaging season indices. Active seasons are to date.

Download or refresh public NFL model data with `python fetch_nfl_opportunity.py`. The setup helper does this automatically; `--skip-nfl` skips it. Historical model downloads are cached under ignored `data_nfl/`; the current season refreshes on each run. `--offline` uses only cached data. A source outage preserves the cache and displays coverage instead of substituting zero for unknown points.

- **Manager profiles:** click any manager for season history, titles, playoff appearances, scoring trends, biggest wins, and toughest opponents (most losses, then fewest wins).
- **Most started players:** each manager's all-time starter leaderboard, with filters for season, position and regular season/postseason. Starts count once per player in a completed paired matchup, including playoffs and consolation games. The Combined view joins the same NFL player across ESPN and Sleeper when its identity is established. All-manager view shows the top 10 per manager; selecting one manager shows their full list. Tied start counts share a rank. Profiles include the top 10, and coverage lists missing weekly lineups. Starts remain countable when the lineup is known but player points are unavailable; points stay unavailable rather than becoming zero.
- **Luck rankings:** each completed regular-season week compares a team against all other paired teams. Expected wins = (teams outscored + 0.5 × teams tied) / other teams. Luck = actual matchup wins (ties count 0.5) − expected wins. Platform bonus/median wins do not enter this calculation.
- **Weekly wrapped:** choose a regular-season or postseason week for the highest scorer, closest matchup, biggest upset, and standings movement. Upset magnitude is the opponent's prior win percentage minus the winner's; week 1 has no prior record, and postseason recaps do not rank upsets or change regular-season standings.
- **Records and rivalries:** longest within-season winning streak (ties break it), lowest scores, blowouts, closest games, standings comebacks, and balanced rivalries. Comebacks measure worst weekly rank to final available rank; rankings use win percentage then points. Rivalries require two meetings and minimize win imbalance / meetings, then favor more meetings.
- **Draft analysis:** starter points scored for the drafting manager, including completed playoff weeks. Two rankings are shown for both bargains and disappointments. **Points per start** divides a pick's starter points by its starts and compares that against the start-weighted points per start for the same round and season, so a pick that played four good weeks is neither flattered nor penalized against one that played sixteen; an adjustable minimum-starts filter, default 8, governs which picks appear in that ranking but never moves either baseline. **Total starter points** compares a pick against that round's mean, which rewards availability. **Points per week** divides starter points by weeks rostered — the completed weeks the drafting manager actually carried the player — which keeps a pick from being charged for weeks after it was traded or dropped while still charging it for the roster spot it occupied. All three measures also have a **position peers** form, which replaces the round baseline with the four picks taken nearest to this one at the same position and season — a third-round running back judged against the running backs who went around him rather than against the quarterbacks and kickers in his round. A pick is never its own peer, and a position too thin to supply two usable peers leaves the comparison unavailable instead of scoring itself as average; the first and last picks at a position can only have peers on one side, so their baselines lean on better- or worse-drafted company. Picks the drafting manager never started are listed separately with the number of weeks they were rostered, and are never rate-ranked. Zero weeks rostered means the pick never reached that manager's roster in any counted week — an immediate trade or drop, or a gap in imported transactions — so it is excluded from both rankings as not evaluable; a pick that was rostered and never started is a real disappointment and still ranks by total. Bargains are rounds 8+; disappointments are rounds 1–3. Use season filters to compare equal amounts of playing time; an in-progress season may have no pick above the minimum.
- **Best waiver pickups:** one sortable row per completed waiver, free-agent or commissioner acquisition, so pickups can be ranked against each other rather than read out of the transaction log. Filter by season, transaction type, manager and a minimum-starts slider; rank by **total points after pickup**, **starts after pickup**, **points per start**, or most recent. Every column heading is also clickable to re-sort the visible rows, and unavailable ESPN scores show as — and sort last. Starter points begin the week after the acquisition and stop after the week of the next recorded drop or trade away, so the numbers measure only what the player produced for the manager who picked him up; same-week points are excluded because weekly snapshots do not establish lineup timing. Points per start rewards a single good week, so a one-start pickup can top that ranking until the minimum-starts slider is raised. Trades are excluded because the trade analyzer values them as packages. The same board, scoped to one manager, appears at the bottom of each manager profile. The tab itself is named **Waiver wire** because it holds this board and **Worst drops** below it.
- **Worst drops:** the mirror of the pickup board, in the same waiver tab. One sortable row per completed non-trade drop that another manager then claimed, so a drop is judged by what it handed the rest of the league. Filter by season, manager and a minimum-starts slider, default 3; rank by **points per start above position**, **points per start**, **total points for other teams**, **starts for other teams**, or most recent. Raw points per start cannot compare a dropped kicker with a dropped quarterback, so the adjusted column subtracts the start-weighted mean points per start at that position for the season, taken from every start in the league: a positive figure means the player was worth more per start than a replacement start at his position, which is what makes a drop expensive. Starter points begin the week after the claim, stop after the week of the next recorded drop or trade away, and follow the player across every roster that claimed him. If the dropping manager wins the player back the window closes there, so nothing he scores for his original roster again counts against the drop. Trades are excluded because the player never reached waivers and nobody else had the chance to claim him, and drops nobody claimed are excluded because they cost nothing. Both per-start rankings reward a single good week, which is why the minimum-starts default is 3 rather than 1.
- **Trades and waivers:** completed acquisitions/departures with filters by season, manager, and transaction type. Contribution starts the week after acquisition, ends after the week of the next recorded drop/trade away, and counts actual starts in weekly snapshots. Same-week points are excluded because snapshots do not establish lineup timing. Preseason moves recorded as week 1 also exclude week 1 under this conservative rule. Draft-pick ownership and FAAB transfers are displayed when available.
- **Trade analyzer:** select a completed trade to inspect every participant's received/sent players, starter-point contributions while held, and season results before/after completion. Compare record, points per game, Scoring+, all-play xW, and weekly scoring; postseason is shown separately. The completion week is excluded from the comparison, and acquired-player contribution stops before a later transfer week. The starter-point balance score is 100 for equal received contribution and falls as the gap grows; incomplete packages or unsuitable comparisons stay unavailable. This measures realized lineup contribution, not trade value at the time: draft picks, FAAB, bench value, positional scarcity and replacement players are not assigned point values. Sent-package points show production in recipients' lineups. A team's improvement after a trade does not establish that the trade caused it, and unequal observation periods or missing transaction data limit comparisons.
- **Largest comebacks:** rank eventual wins by the largest deficit supported by historical score checkpoints, inspect each matchup's score history, and filter by season or manager. Reconstructed checkpoints are before the first NFL kickoff of each new game day, using corrected final starter points from earlier game dates. These are overnight recoveries; they can miss a much larger deficit during a game. The probability ranking stays unavailable unless original, explicitly sourced fantasy-matchup probability snapshots exist. A final win is an outcome, not proof that a calibrated model reached 100%. Season-long standings recoveries are shown separately.
- **Season charts:** points per game or win percentage, filtered by manager and platform. Hover for values; an exact-value table is available below the chart.
- **Recap cards:** preview and download a 1200 × 630 PNG with record, all-time rank, titles, win rate, best week, and schedule luck. Downloads stay on your computer; nothing is posted.

Regular-season analytics exclude future/in-progress weeks using Sleeper's `last_scored_leg`. Championship and playoff-appearance totals remain provisional until a season is complete. The 2024 ESPN import includes 192 authenticated draft picks, player lineups and scores for weeks 1–17, and 422 completed transaction records (184 waivers, 224 free-agent moves, and 14 trades). Historical transaction completeness remains unverified. Unknown contribution is shown as unavailable, not zero. Because that import is incomplete, some drafted players never appear on the drafting manager's roster in any saved week; those picks are reported as never rostered rather than counted as zero-point draft busts. ESPN blocks Recent Activity in its historical UI, so the importer uses authenticated API access. Active-season comparisons are to date, not full-season projections.

Historical comeback reconstruction uses public [nflverse player/game statistics](https://github.com/nflverse/nflverse-data/releases/tag/stats_player) and [NFL schedules](https://github.com/nflverse/nfldata/blob/master/data/games.csv), joined to saved fantasy lineups. Nonzero starter points require a historical player/week game identity; kickers are included and D/ST uses an explicit franchise identity. Today's player team is never substituted for a historical team. Each team's starter total must agree with its final matchup score; missing mappings, missing kickoff times or unfinished NFL games are skipped and reported as coverage. NFL statistics describe corrected final production, so reconstructed checkpoints can differ from what the fantasy app showed live before a stat correction. NFL play-by-play win probability refers to an NFL game's winner and cannot substitute for your fantasy matchup's chance of winning.

Refresh historical comeback data or collect future live checkpoints:

```sh
python fetch_comeback_history.py                    # Public download, reconstruction, final report rebuild
python fetch_comeback_history.py --offline          # Reuse compact local NFL caches
python fetch_comeback_history.py --no-build         # Reconstruct only
python record_comebacks.py --once                   # Capture the current Sleeper week once, then rebuild if changed
python record_comebacks.py                          # Capture changed scores every 60 seconds until Ctrl+C
python record_comebacks.py --interval 30 --no-build  # Capture only; rebuild separately
```

`fetch_comeback_history.py --seasons 2024 2025` limits the downloaded seasons, and `--refresh` refreshes historical caches. Current-season NFL mappings refresh automatically. Compact source caches live under ignored `data_nfl/comebacks/`; reconstructed and recorded history lives in each ignored fantasy season folder's `comeback_history.json`. Reconstructing preserves recorded live snapshots and imported probabilities. The recorder selects the active league from `data/seasons.json`; optionally pass `--league-id`, `--data-dir` or `--week` (which must match the current NFL week). Its minimum polling interval is 15 seconds. It records public Sleeper matchup scores, skips unchanged scores, and supplies no estimated win odds; the [documented weekly matchup API](https://docs.sleeper.com/) does not provide historical fantasy probability trajectories. Refresh saved fantasy results after the week finishes to rank those live captures against the eventual winner. A collector must be running during games to capture future intraday changes; existing historical final scores cannot recover missing live checkpoints.

## Code map

- `league-stats.js`: single shared statistics engine, also importable in Node.
- `trade-analysis.js`: completed trade packages, holding-period contributions, before/after results and realized balance comparisons.
- `comeback-history.js`: validates historical checkpoints, ranks completed comeback wins and reports missing coverage.
- `league-ui.js`: shared interactive dashboard, charts, filters, sorting, and PNG generation.
- `league.css`: responsive styling and dark mode.
- `index.html`: live API loading, league selection, and platform switching.
- `build_report.py`: identity resolution, data normalization, and self-contained report generation. It embeds the shared JavaScript instead of recalculating dashboard statistics in Python.
- `league-data.js`: generated local-data snapshot for instant default rendering.
- `espn_league.js`: generated ESPN data and canonical display names for the live dashboard.
- `show_playoffs.py`: diagnostic playoff list.
- `fetch_nfl_opportunity.py`: public NFL expected-stat downloads, stable player-ID crosswalks and league-scoring normalization.
- `fetch_comeback_history.py`: public historical NFL game mapping and overnight fantasy-score reconstruction.
- `record_comebacks.py`: optional live Sleeper score recorder for future intraday comeback history.
- `setup_data.py`: first-time Sleeper, ESPN, NFL opportunity and historical comeback setup.
- `chat-widget.js` / `chat-widget.css`: accessible LeagueGuide interface, current-filter context, and plain-text answers.
- `chat-context.cjs`: saved-league evidence selection and explanations for site metrics.
- `server.mjs`: local dashboard server, Groq requests, session handling, and chat protections.
- `netlify/functions/league-chat.mjs`: deployed chat API with private session storage and shared request controls.
- `netlify.toml` / the build script: publish configuration and an allowlisted `dist/` build.

## Verification

`fetch_espn_details.py` imports authenticated ESPN drafts, weekly starter scores, and retained transactions, then rebuilds the reports. It reads `espn_s2` and `SWID` from the ignored local `espn_secrets.json` and never logs their values. Dependencies are in `requirements.txt`. Run `python3 fetch_espn_details.py` after credentials are available. Failed authentication preserves existing data; missing historical lineups or transaction items are reported as coverage warnings. ESPN may omit historical transaction details even with valid credentials.

Node 20+ is needed for chat, the publish build, and JavaScript tests. Install dependencies first:

```sh
npm ci
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
```

Tests cover ties, conservation of expected/actual league wins, future-week exclusion, playoff separation, acquisition timing, separate Kaushal/Winston identities, platform-total consistency, all-time player starts and identity joins, trade completion/holding periods, historical game-day reconstruction, sourced probability validation, live recorder merging, and shared-engine embedding in saved reports.
