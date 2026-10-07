"""Record live Sleeper fantasy scores to measure future observed comebacks.

Run during games: python record_comebacks.py (polls every 60 seconds until Ctrl+C).
For one sample: python record_comebacks.py --once. Use --no-build to collect only.
This records current matchup points, never fabricated probabilities or past scores.
"""

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import Request, urlopen

from fetch_comeback_history import load_json, save_json

BASE = 'https://api.sleeper.app/v1'
SOURCE = 'Sleeper public matchup API'
MAX_SNAPSHOTS = 100_000


def valid_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def positive_id(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def get_json(path):
    request = Request(f'{BASE}/{path}', headers={'User-Agent': 'league-wrapped-comeback-recorder/1.0'})
    with urlopen(request, timeout=20) as response:
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('Sleeper response exceeds size limit')
        return json.loads(raw)


def create_snapshots(league, state, matchups, captured_at, requested_week=None):
    if not isinstance(league, dict) or not isinstance(state, dict):
        raise ValueError('Sleeper league or NFL state is invalid')
    week = state.get('week')
    if league.get('sport') != 'nfl' or league.get('status') != 'in_season' or \
            str(league.get('season')) != str(state.get('season')) or \
            state.get('season_type') != 'regular' or not positive_id(week) or week > 18:
        raise ValueError('Live recording requires a current active NFL fantasy season')
    if requested_week is not None and requested_week != week:
        raise ValueError('Only the current NFL week can be recorded; past weekly totals are not historical live scores')
    if not isinstance(matchups, list):
        raise ValueError('Sleeper matchup response is invalid')
    groups = {}
    for team in matchups:
        if not isinstance(team, dict) or not positive_id(team.get('roster_id')) or not positive_id(team.get('matchup_id')):
            continue
        # Use the same total returned by the public matchup API/dashboard.
        if not valid_number(team.get('points')):
            continue
        groups.setdefault(team['matchup_id'], []).append(team)
    output = []
    for matchup_id, teams in groups.items():
        if len(teams) != 2 or teams[0]['roster_id'] == teams[1]['roster_id']:
            continue
        output.append({'week': week, 'matchup_id': matchup_id, 'captured_at': captured_at,
                       'source': SOURCE, 'method': 'observed',
                       'source_url': f'{BASE}/league/{league["league_id"]}/matchups/{week}',
                       'teams': [{'roster_id': t['roster_id'], 'points': t['points']}
                                 for t in sorted(teams, key=lambda t: t['roster_id'])]})
    return output


def merge_snapshots(history, league, snapshots):
    """Preserve existing reconstructions and original probability sources."""
    if history:
        if history.get('version') != 1 or str(history.get('league_id')) != str(league['league_id']) or \
                str(history.get('season')) != str(league['season']) or not isinstance(history.get('snapshots'), list):
            raise ValueError('Existing comeback history belongs to another league or uses an unsupported format')
        result = dict(history)
        result['snapshots'] = list(history['snapshots'])
    else:
        result = {'version': 1, 'season': str(league['season']), 'league_id': str(league['league_id']),
                  'source': SOURCE, 'method': 'observed', 'snapshots': []}
    latest = {}
    for snap in result['snapshots']:
        if snap.get('source', result.get('source')) != SOURCE or snap.get('method', result.get('method')) != 'observed':
            continue
        key = (snap.get('week'), snap.get('matchup_id'))
        if key not in latest or str(snap.get('captured_at')) > str(latest[key].get('captured_at')):
            latest[key] = snap
    appended = 0
    for snap in snapshots:
        key = (snap['week'], snap['matchup_id'])
        if key in latest and latest[key].get('teams') == snap['teams']:
            continue
        if len(result['snapshots']) >= MAX_SNAPSHOTS:
            raise ValueError('Comeback history reached its snapshot limit; existing data retained')
        result['snapshots'].append(snap)
        latest[key] = snap
        appended += 1
    if appended:
        result['last_observed_at'] = max(s['captured_at'] for s in snapshots)
    return result, appended


def latest_league(data_dir):
    seasons = load_json(data_dir / 'seasons.json', [])
    active = [s for s in seasons if s.get('status') == 'in_season' and str(s.get('league_id', '')).isdigit()]
    if not active:
        raise ValueError('No active local Sleeper league found; download history with setup_data.py or pass --league-id')
    return str(max(active, key=lambda s: int(s['season']))['league_id'])


def record_once(league_id, data_dir, requested_week=None):
    state = get_json('state/nfl')
    league = get_json(f'league/{league_id}')
    if not isinstance(state, dict) or not positive_id(state.get('week')):
        raise ValueError('NFL current week unavailable')
    week = state['week']
    matchups = get_json(f'league/{league_id}/matchups/{week}')
    captured_at = datetime.now(timezone.utc).isoformat()
    snapshots = create_snapshots(league, state, matchups, captured_at, requested_week)
    path = data_dir / str(league['season']) / 'comeback_history.json'
    if path.exists():
        history = load_json(path)
        if history is None:
            raise ValueError('Existing comeback history is unreadable; it will not be overwritten')
    else:
        history = None
    merged, appended = merge_snapshots(history, league, snapshots)
    if appended:
        save_json(path, merged)
    return week, appended, len(snapshots)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true', help='Collect one current score snapshot, then exit')
    parser.add_argument('--interval', type=int, default=60, help='Polling seconds (minimum 15, default 60)')
    parser.add_argument('--league-id', help='Defaults to active league from local data/seasons.json')
    parser.add_argument('--week', type=int, help='Optional assertion; must equal the current NFL week')
    parser.add_argument('--data-dir', type=Path, default=Path('data'))
    parser.add_argument('--no-build', action='store_true', help='Collect only; skip report rebuilds')
    args = parser.parse_args()
    if args.interval < 15:
        parser.error('--interval must be at least 15 seconds')
    try:
        league_id = args.league_id or latest_league(args.data_dir)
        if not league_id.isdigit():
            parser.error('--league-id must contain only digits')
        print('Recording live fantasy scores; probabilities are not supplied by this API.', flush=True)
        while True:
            try:
                week, added, pairs = record_once(league_id, args.data_dir, args.week)
                print(f'Week {week}: {pairs} valid matchups, {added} changed score snapshots saved', flush=True)
                if added and not args.no_build:
                    subprocess.run([sys.executable, 'build_report.py'], check=True)
            except Exception as exc:
                detail = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
                print(f'Capture unavailable ({detail}); existing history retained', flush=True)
                if args.once:
                    return 1
            if args.once:
                return 0
            time.sleep(args.interval)
    except ValueError as exc:
        parser.error(str(exc))
    except KeyboardInterrupt:
        print('\nLive score recorder stopped; saved history retained.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
