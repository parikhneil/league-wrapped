# League Wrapped

A static dashboard for Sleeper NFL leagues and our archived ESPN seasons. Open
`index.html` for history or `matchups.html` for upcoming fantasy matchups.

## Run locally

```sh
python3 -m http.server 8002 --bind 127.0.0.1
```

Visit http://localhost:8002/matchups.html. The generated `matchup-data.js`
snapshot lets this page work on any static host, including Netlify or Cloudflare
Pages. The forecast page needs no backend, credentials, or paid odds API.

Enter any **Sleeper NFL league ID or HTTPS league URL** in the matchup page's
league picker. It loads that league's managers, rosters, matchup schedule, and
scoring rules directly from the public Sleeper API. It also follows up to ten
linked seasons, training only on completed regular-season games with matching
scoring rules. No scores or manager aliases from our league are substituted for
another league. The complete compact NFL catalog supports players who have
never appeared on our own rosters.

Share a board using `matchups.html?league=LEAGUE_ID`. The dashboard links preserve
your selected league, and **Our league** returns to the bundled default board.
Completed seasons and leagues awaiting their schedule show an empty state.
NBA and best-ball leagues are currently unsupported.

## Update the upcoming matchup page

```sh
python3 fetch_matchup_data.py
```

This uses Python's standard library to refresh our public Sleeper league,
completed player fantasy scores, full rosters, manager names, NFL state,
and the NFL schedule. It writes raw inputs to ignored `data/` and exports the
public snapshot `matchup-data.js` and the compact universal player catalog
`forecast-players.js`. The large raw NFL player database is
downloaded at most daily. To export saved inputs without network requests:

```sh
python3 fetch_matchup_data.py --offline
```

The page's refresh button updates the selected league's roster, schedule, and
historical scoring inputs from Sleeper in the browser. NFL player metadata
comes from the published universal catalog; run the script and publish both
generated data assets to refresh it. The NFL schedule is shared only across
leagues of the same season, otherwise loaded from nflverse. A failed league
switch or refresh keeps the last usable board and identifies which league is
still displayed.

If individual weekly requests fail, the page can retain saved matchup pairings.
It only reuses historical scores that were already completed in the saved
snapshot, and uses the fresh full roster for lineup optimization. Previously
saved unfinished scores are excluded from model training.

For all historical reports and player pages:

```sh
python3 -m pip install requests
python3 fetch_sleeper_history.py
python3 fetch_matchup_data.py
python3 build_report.py
```

The existing GitHub weekly update workflow runs these commands and commits the
generated pages and forecast snapshot. `build_report.py` also exports saved
forecast inputs and keeps the upcoming matchups link in generated navigation.
Serve/publish `matchups.html`, `matchups.css`, `matchups-ui.js`,
`matchup-lines.js`, `sleeper-forecast-data.js`, `matchup-data.js`,
`forecast-players.js`, `espn_league.js`, and `player_names.js`
together with the existing website files.

## What the simulated lines mean

The model resamples completed regular-season **player fantasy scores under the
same league scoring rules**, mixing each player's observed scores with a
positional score pool to reduce overconfidence from small samples. Historical
seasons with different scoring are excluded. The page reports sample coverage
and its assumptions.

Before simulation, the model chooses each team's **strongest projected legal
lineup from its full current roster**, maximizing expected fantasy points across
the league's exact starting positions. The assignment handles FLEX and
superflex constraints without reusing a player. Submitted starters and bench
order have no effect on the odds. Reserve and taxi players are excluded until
activated. Known NFL byes and fresh current-week OUT/IR assumptions affect
selection, allowing eligible bench alternatives to replace those players.
Future weeks optimize again using the same current roster and that week's
byes. This selects a projected lineup in advance; it does not choose the
highest actual scorers after seeing a simulated outcome.

Simulations produce fair moneylines, point spreads, matchup/team totals,
alternative lines, player fantasy-point over/unders and score thresholds, and
each team's chance of being the week's highest scorer. Moneylines split tie
probability equally for pricing; the actual tie probability is kept separate.
Spread/total/prop prices exclude pushes. Prices have no bookmaker margin.

These are uncalibrated full-week forecasts, not live win probabilities or
sportsbook offers. They don't adjust for opponent strength, weather, player
correlations, or evolving game results. Future weeks assume the **current
roster** remains unchanged. Fresh OUT/IR metadata only affects the current
week as a cached-status assumption, rather than a confirmed gameday inactive;
unavailable or stale injury information is ignored and disclosed. Rosters that
cannot fill a legal lineup don't receive complete-team estimates. Future playoff
opponents are left TBD rather than inferred from placeholder matchup IDs.

Sources: [Sleeper API documentation](https://docs.sleeper.com/) and
[nflverse NFL schedule](https://github.com/nflverse/nfldata/blob/master/data/games.csv).
Only NFL schedule fields are imported; NFL sportsbook odds are not used.

## Check the model and export

```sh
node --test tests/*.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
```

The checks cover deterministic simulations, probability/price consistency,
spread direction, completed-week cutoffs, incompatible scoring, verified byes,
optimal legal lineups, immunity to starter/bench changes, cross-league data
isolation, browser loading/refresh behavior, and safe static data export.
