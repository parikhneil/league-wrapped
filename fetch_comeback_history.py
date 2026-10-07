"""Reconstruct overnight fantasy comebacks from final points and NFL game dates.

This does not estimate win probability or intraday scores. Each checkpoint is
before the first NFL kickoff on a new game day, using corrected final fantasy
points from starters whose games were on earlier dates. Run this after downloading
fantasy history: python fetch_comeback_history.py. Public NFL files are cached in
data_nfl/comebacks/. Use --offline to rebuild from cache, --no-build to skip HTML.
"""

import argparse
import csv
from datetime import datetime, timezone
import io
import json
import math
from pathlib import Path
import subprocess
import sys
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
STATS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv'
CACHE_DIR = Path('data_nfl/comebacks')
METHOD = 'reconstructed_day_boundary'
SOURCE = 'nflverse_game_day_reconstruction'
# Franchise identities are stable; historical player team assignments never use
# today's roster database. ESPN defense names identify the franchise itself.
DEFENSES = {
    'Cardinals': 'ARI', 'Falcons': 'ATL', 'Ravens': 'BAL', 'Bills': 'BUF',
    'Panthers': 'CAR', 'Bears': 'CHI', 'Bengals': 'CIN', 'Browns': 'CLE',
    'Cowboys': 'DAL', 'Broncos': 'DEN', 'Lions': 'DET', 'Packers': 'GB',
    'Texans': 'HOU', 'Colts': 'IND', 'Jaguars': 'JAX', 'Chiefs': 'KC',
    'Chargers': 'LAC', 'Rams': 'LA', 'Raiders': 'LV', 'Dolphins': 'MIA',
    'Vikings': 'MIN', 'Patriots': 'NE', 'Saints': 'NO', 'Giants': 'NYG',
    'Jets': 'NYJ', 'Eagles': 'PHI', 'Steelers': 'PIT', '49ers': 'SF',
    'Seahawks': 'SEA', 'Buccaneers': 'TB', 'Titans': 'TEN', 'Commanders': 'WAS',
}
TEAM_ALIASES = {'JAC': 'JAX', 'LAR': 'LA', 'WSH': 'WAS'}


def number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def load_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, separators=(',', ':')))
    temporary.replace(path)


def download_csv(url, parser, max_bytes=25_000_000):
    """Stream a bounded public CSV; retain only fields needed for game mapping."""
    request = Request(url, headers={'User-Agent': 'league-wrapped-comeback-history/1.0'})
    with urlopen(request, timeout=60) as response:
        length = response.headers.get('Content-Length')
        if length and int(length) > max_bytes:
            raise ValueError('NFL source exceeds download size limit')
        raw = response.read(max_bytes + 1)
        if len(raw) > max_bytes:
            raise ValueError('NFL source exceeds download size limit')
    return parser(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))


def compact_schedules(rows):
    output = []
    for row in rows:
        if row.get('game_type') != 'REG' or not row.get('game_id'):
            continue
        try:
            datetime.strptime(row['gameday'], '%Y-%m-%d')
            season, week = int(row['season']), int(row['week'])
        except (ValueError, KeyError):
            continue
        output.append({key: row.get(key) for key in
                       ('game_id', 'gameday', 'gametime', 'home_team', 'away_team')} |
                      {'season': season, 'week': week,
                       'complete': number(row.get('home_score')) is not None and number(row.get('away_score')) is not None})
    if not output:
        raise ValueError('NFL schedule schema unavailable')
    return output


def compact_player_games(rows, season):
    result = []
    for row in rows:
        if row.get('season_type') != 'REG' or str(row.get('season')) != str(season):
            continue
        if not row.get('player_id') or not row.get('game_id'):
            continue
        try:
            week = int(row['week'])
        except (ValueError, KeyError):
            continue
        if 1 <= week <= 18:
            result.append({'player_id': row['player_id'], 'week': week,
                           'game_id': row['game_id'], 'team': row.get('team')})
    if not result:
        raise ValueError('NFL weekly player/game schema unavailable')
    return result


def kickoff(game):
    try:
        local = datetime.strptime(f"{game['gameday']} {game['gametime']}", '%Y-%m-%d %H:%M')
        return local.replace(tzinfo=ZoneInfo('America/New_York')).astimezone(timezone.utc)
    except (ValueError, KeyError, TypeError):
        return None


def reconstruct(season, schedules, player_games):
    league = season['league']
    year = str(league['season'])
    games = {g['game_id']: g for g in schedules if str(g['season']) == year}
    team_games = {}
    weekly_dates = {}
    for game in games.values():
        for team in (game['home_team'], game['away_team']):
            team_games[(game['week'], TEAM_ALIASES.get(team, team))] = game
        weekly_dates.setdefault(game['week'], {}).setdefault(game['gameday'], []).append(game)
    player_lookup = {}
    for row in player_games:
        key = (row['week'], row['player_id'])
        player_lookup.setdefault(key, set()).add(row['game_id'])
    coverage = {'completedMatchups': 0, 'reconstructedMatchups': 0,
                'skippedMatchups': 0, 'checkpoints': 0, 'reasons': {}}
    output = {'version': 1, 'season': year, 'league_id': str(league['league_id']),
              'source': SOURCE, 'method': METHOD, 'generated_at': datetime.now(timezone.utc).isoformat(),
              'source_urls': [SCHEDULE_URL, STATS_URL.format(season=year)],
              'method_description': 'Scores before the first NFL kickoff of each game day, reconstructed from corrected final starter points from earlier game dates. No intraday scores or win probabilities.',
              'coverage': coverage, 'snapshots': []}
    cutoff = league.get('settings', {}).get('last_scored_leg', 18 if league.get('status') == 'complete' else 0)

    def skip(reason):
        coverage['skippedMatchups'] += 1
        coverage['reasons'][reason] = coverage['reasons'].get(reason, 0) + 1

    def starter_days(team, week):
        starters, points = team.get('starters'), team.get('players_points')
        if not isinstance(starters, list) or not isinstance(points, dict):
            return None, 'missing_lineup_points'
        ids = [str(pid) for pid in starters if str(pid) not in ('0', '', 'None')]
        if len(set(ids)) != len(ids):
            return None, 'duplicate_starters'
        total = 0
        dated = []
        for pid in ids:
            value = number(points.get(pid))
            if value is None:
                return None, 'missing_starter_points'
            total += value
            # Zero final points are zero at every between-game-day checkpoint.
            if value == 0:
                dated.append((None, value))
                continue
            info = season.get('players', {}).get(pid, {})
            pos = info.get('position') or info.get('pos')
            if pos in ('DEF', 'D/ST') or pid in set(DEFENSES.values()) | set(TEAM_ALIASES):
                franchise = TEAM_ALIASES.get(pid, pid) if pid in set(DEFENSES.values()) | set(TEAM_ALIASES) else DEFENSES.get(info.get('name', '').removesuffix(' D/ST'))
                game = team_games.get((week, franchise))
            else:
                gsis = info.get('gsis_id')
                matches = player_lookup.get((week, gsis), set()) if gsis else set()
                if len(matches) != 1:
                    return None, 'unmapped_historical_player_game'
                game = games.get(next(iter(matches)))
            if not game or game['week'] != week or not game['complete']:
                return None, 'missing_or_unfinished_nfl_game'
            dated.append((game['gameday'], value))
        final = number(team.get('points'))
        if final is None or abs(total - final) > 0.1:
            return None, 'starter_total_differs_from_team_score'
        return dated, None

    for index, teams in enumerate(season.get('weeks', []), 1):
        if index > cutoff:
            continue
        groups = {}
        for team in teams or []:
            if team.get('matchup_id') is not None:
                groups.setdefault(team['matchup_id'], []).append(team)
        for matchup_id, pair in groups.items():
            if len(pair) != 2 or pair[0]['roster_id'] == pair[1]['roster_id']:
                continue
            coverage['completedMatchups'] += 1
            dated = [starter_days(team, index) for team in pair]
            reason = next((reason for _, reason in dated if reason), None)
            if reason:
                skip(reason)
                continue
            checkpoints = []
            dates = sorted(weekly_dates.get(index, {}))
            for date in dates[1:]:
                earlier = [game for day in dates if day < date for game in weekly_dates[index][day]]
                today = weekly_dates[index][date]
                starts = [kickoff(game) for game in today]
                # A checkpoint is only valid if every earlier game is final,
                # and its first kickoff time is known (no date/time guesses).
                if not earlier or not all(g['complete'] for g in earlier) or any(t is None for t in starts):
                    continue
                capture = min(starts).isoformat()
                checkpoints.append({'week': index, 'matchup_id': matchup_id,
                                    'captured_at': capture, 'source': SOURCE, 'method': METHOD,
                                    'checkpoint': f'Before {date} first kickoff',
                                    'teams': [{'roster_id': team['roster_id'],
                                               'points': round(sum(value for day, value in player_days if day is not None and day < date), 4)}
                                              for team, (player_days, _) in zip(pair, dated)]})
            if not checkpoints:
                skip('no_between_day_checkpoint')
                continue
            coverage['reconstructedMatchups'] += 1
            coverage['checkpoints'] += len(checkpoints)
            output['snapshots'].extend(checkpoints)
    return output


def refresh_cache(path, url, parser, offline, refresh):
    cached = load_json(path)
    if offline or (cached is not None and not refresh):
        return cached
    try:
        value = download_csv(url, parser)
        save_json(path, value)
        return value
    except Exception as exc:
        print(f'NFL game-day source unavailable ({type(exc).__name__}); existing cache retained')
        return cached


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--refresh', action='store_true', help='Refresh compact NFL schedule/player mapping caches')
    parser.add_argument('--seasons', nargs='+', type=int)
    parser.add_argument('--no-build', action='store_true')
    args = parser.parse_args()
    # Reuse the same player identity normalization as the dashboard.
    from build_report import load_all, resolve_identities, apply_real_names, snapshot
    saved = load_all()
    names, canon, _, _, aliases = resolve_identities(saved)
    shown, _ = apply_real_names(names, aliases)
    seasons = snapshot(saved, shown, canon)
    if args.seasons:
        seasons = [s for s in seasons if int(s['league']['season']) in args.seasons]
    if not seasons:
        raise SystemExit('Download fantasy league history first with setup_data.py.')
    current = datetime.now(timezone.utc).year
    schedules = refresh_cache(CACHE_DIR / 'schedules.json', SCHEDULE_URL,
                              compact_schedules, args.offline,
                              args.refresh or any(int(s['league']['season']) >= current for s in seasons))
    if not schedules:
        raise SystemExit('NFL schedules unavailable; no existing comeback history changed.')
    mappings = {}
    for year in sorted({int(s['league']['season']) for s in seasons}):
        mappings[year] = refresh_cache(CACHE_DIR / f'player_games_{year}.json', STATS_URL.format(season=year),
                                      lambda rows, year=year: compact_player_games(rows, year),
                                      args.offline, args.refresh or year >= current)
    for season in seasons:
        year = str(season['league']['season'])
        mapping = mappings.get(int(year))
        if not mapping:
            print(f'{year} {season["src"]}: NFL weekly game mapping unavailable; existing history retained')
            continue
        history = reconstruct(season, schedules, mapping)
        folder = Path('data_espn' if season['src'] == 'ESPN' else 'data') / year
        path = folder / 'comeback_history.json'
        previous = load_json(path, {})
        if previous and (previous.get('version') != 1 or str(previous.get('season')) != year or
                         str(previous.get('league_id')) != str(season['league']['league_id'])):
            print(f'{year} {season["src"]}: existing history has different league metadata; retained unchanged')
            continue
        # Preserve separately recorded live scores and imported probability sources.
        keep = []
        for sample in previous.get('snapshots', []):
            if sample.get('source', previous.get('source')) == SOURCE:
                continue
            kept = dict(sample)
            for field in ('source', 'method', 'probability_kind', 'probability_source'):
                if not kept.get(field) and previous.get(field):
                    kept[field] = previous[field]
            # Live observations in a previously mixed file must never inherit
            # the new reconstruction's method merely because they lack a tag.
            kept.setdefault('method', 'observed')
            keep.append(kept)
        history['snapshots'].extend(keep)
        save_json(path, history)
        c = history['coverage']
        print(f'{year} {season["src"]}: reconstructed {c["reconstructedMatchups"]}/{c["completedMatchups"]} matchups, {c["checkpoints"]} day checkpoints; {c["skippedMatchups"]} skipped')
    if not args.no_build:
        subprocess.run([sys.executable, 'build_report.py'], check=True)


if __name__ == '__main__':
    main()
