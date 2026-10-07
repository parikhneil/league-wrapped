# League Wrapped

A fantasy-football history dashboard for Sleeper leagues, with saved ESPN history for our league. Plain JavaScript and Python; no frontend dependencies or database.

## Run

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000. The default league renders the saved snapshot immediately, then refreshes Sleeper history. Enter another Sleeper league ID or username to explore another league. The Combined / Sleeper / ESPN buttons filter every feature.

`report.html`, `report_sleeper.html`, and `report_espn.html` are self-contained saved dashboards: you can open them directly without a server or internet. They require JavaScript. `players.html` is the player-history search.

## Refresh saved data

For a fresh checkout, including ESPN history without sharing data folders:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python setup_data.py
python -m http.server 8000 --bind 127.0.0.1
```

The helper prompts for your own `espn_s2` and `SWID` using hidden input unless valid local credentials already exist. It downloads Sleeper history, initializes ESPN 2024 standings, managers, matchups, playoff participants and championship result, imports drafts/player scores/transactions, and rebuilds reports. Open http://127.0.0.1:8000. Use `python setup_data.py --espn-only` to skip Sleeper when its data already exists. Optional `--league-id` and `--season` select another ESPN league/year. Your ESPN account must have access to the league.

Both `data/` and `data_espn/` are ignored. Previously tracked ESPN files stay tracked until removed from Git's index with `git rm -r --cached data_espn` (local files remain). Generated reports and JavaScript snapshots also contain league data; ignoring raw folders alone does not remove those snapshots from Git.

Run from the project directory:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install requests
python fetch_sleeper_history.py
python build_report.py
```

`fetch_sleeper_history.py` walks the league's previous-season chain and saves matchups, drafts, players, and transactions under `data/`. This folder is ignored by Git. Change `LEAGUE_ID` in that script to change the downloaded league; the live page has its own `DEFAULT_LEAGUE`.

ESPN data lives under `data_espn/`; its private fetch script and credentials are excluded. The builder refuses an ESPN-only rebuild if Sleeper data is absent, to avoid overwriting the combined history by mistake.

`ESPN_TO_SLEEPER` in `build_report.py` matches the same person's accounts across platforms. `REAL_NAMES` only controls display names. Kaushal (2024) and Winston (2025 onward) intentionally have separate records.

GitHub Actions refreshes saved reports every Tuesday at 10:00 UTC and supports manual runs. The generated `league-data.js` snapshot is committed alongside the report files.

## Features and definitions

- **Manager profiles:** click any manager for season history, titles, playoff appearances, scoring trends, biggest wins, and toughest opponents (most losses, then fewest wins).
- **Luck rankings:** each completed regular-season week compares a team against all other paired teams. Expected wins = (teams outscored + 0.5 × teams tied) / other teams. Luck = actual matchup wins (ties count 0.5) − expected wins. Platform bonus/median wins do not enter this calculation.
- **Weekly wrapped:** choose a regular-season or postseason week for the highest scorer, closest matchup, biggest upset, and standings movement. Upset magnitude is the opponent's prior win percentage minus the winner's; week 1 has no prior record, and postseason recaps do not rank upsets or change regular-season standings.
- **Records and rivalries:** longest within-season winning streak (ties break it), lowest scores, blowouts, closest games, standings comebacks, and balanced rivalries. Comebacks measure worst weekly rank to final available rank; rankings use win percentage then points. Rivalries require two meetings and minimize win imbalance / meetings, then favor more meetings.
- **Draft analysis:** starter points scored for the drafting manager, including completed playoff weeks. Pick value is contribution minus that season's draft-round average. Bargains are rounds 8+; disappointments are rounds 1–3. Use season filters to compare equal amounts of playing time.
- **Trades and waivers:** completed acquisitions/departures with filters by season, manager, and transaction type. Contribution starts the week after acquisition, ends after the week of the next recorded drop/trade away, and counts actual starts in weekly snapshots. Same-week points are excluded because snapshots do not establish lineup timing. Preseason moves recorded as week 1 also exclude week 1 under this conservative rule. Draft-pick ownership and FAAB transfers are displayed when available.
- **Season charts:** points per game or win percentage, filtered by manager and platform. Hover for values; an exact-value table is available below the chart.
- **Recap cards:** preview and download a 1200 × 630 PNG with record, all-time rank, titles, win rate, best week, and schedule luck. Downloads stay on your computer; nothing is posted.

Regular-season analytics exclude future/in-progress weeks using Sleeper's `last_scored_leg`. Championship and playoff-appearance totals remain provisional until a season is complete. The 2024 ESPN import includes 192 authenticated draft picks, player lineups and scores for weeks 1–17, and 422 completed transaction records (184 waivers, 224 free-agent moves, and 14 trades). Historical transaction completeness remains unverified. Unknown contribution is shown as unavailable, not zero. ESPN blocks Recent Activity in its historical UI, so the importer uses authenticated API access. Active-season comparisons are to date, not full-season projections.

## Code map

- `league-stats.js`: single shared statistics engine, also importable in Node.
- `league-ui.js`: shared interactive dashboard, charts, filters, sorting, and PNG generation.
- `league.css`: responsive styling and dark mode.
- `index.html`: live API loading, league selection, and platform switching.
- `build_report.py`: identity resolution, data normalization, and self-contained report generation. It embeds the shared JavaScript instead of recalculating dashboard statistics in Python.
- `league-data.js`: generated local-data snapshot for instant default rendering.
- `espn_league.js`: generated ESPN data and canonical display names for the live dashboard.
- `show_playoffs.py`: diagnostic playoff list.

## Verification

`fetch_espn_details.py` imports authenticated ESPN drafts, weekly starter scores, and retained transactions, then rebuilds the reports. It reads `espn_s2` and `SWID` from the ignored local `espn_secrets.json` and never logs their values. Dependencies are in `requirements.txt`. Run `python3 fetch_espn_details.py` after credentials are available. Failed authentication preserves existing data; missing historical lineups or transaction items are reported as coverage warnings. ESPN may omit historical transaction details even with valid credentials.

Node 20+ is needed only for tests:

```sh
node --test tests/stats.test.js
```

Tests cover ties, conservation of expected/actual league wins, future-week exclusion, playoff separation, acquisition timing, separate Kaushal/Winston identities, platform-total consistency, and shared-engine embedding in saved reports.
