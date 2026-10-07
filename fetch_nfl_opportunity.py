"""Download public ffopportunity expected NFL statistics and rebuild the dashboard.

Run: python fetch_nfl_opportunity.py
The upstream model estimates results of observed opportunities, not future games.
No ESPN credentials are used. Cached data lives in ignored data_nfl/.
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

DATA_DIR = Path('data_nfl')
MODEL_URL = 'https://ffopportunity.ffverse.com/'
BASE_URL = 'https://github.com/ffverse/ffopportunity/releases/download/latest-data'
PLAYER_IDS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv'
FANTASY_IDS_URL = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'
OFFENSE = {'QB', 'RB', 'WR', 'TE'}
EXCLUDED_OFFENSIVE_KEYS = {
    'fum', 'fum_lost', 'fum_rec', 'fum_rec_td', 'fum_ret_yd', 'kr_yd', 'pr_yd', 'st_td',
    'pass_sack', 'pass_int_td', 'pass_td_40p', 'pass_td_50p', 'rush_40p',
    'rush_td_40p', 'rush_td_50p', 'rec_td_40p', 'rec_td_50p',
    'rec_0_4', 'rec_5_9', 'rec_10_19', 'rec_20_29', 'rec_30_39', 'rec_40p',
    'pass_cmp_40p', 'bonus_pass_yd_300', 'bonus_pass_yd_400', 'bonus_pass_cmp_25',
    'bonus_rush_yd_100', 'bonus_rush_yd_200', 'bonus_rec_yd_100', 'bonus_rec_yd_200',
    'bonus_rush_rec_yd_100', 'bonus_rush_rec_yd_200', 'bonus_rush_att_20',
}
# Each actual column has a corresponding model prediction, except attempts.
COMPONENTS = {
    'pass_yd': 'pass_yards_gained', 'pass_td': 'pass_touchdown',
    'pass_int': 'pass_interception', 'pass_cmp': 'pass_completions',
    'pass_2pt': 'pass_two_point_conv', 'pass_fd': 'pass_first_down',
    'rush_yd': 'rush_yards_gained', 'rush_td': 'rush_touchdown',
    'rush_2pt': 'rush_two_point_conv', 'rush_fd': 'rush_first_down',
    'rec': 'receptions', 'rec_yd': 'rec_yards_gained',
    'rec_td': 'rec_touchdown', 'rec_2pt': 'rec_two_point_conv',
    'rec_fd': 'rec_first_down',
}


def numeric(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else 0.0
    except (TypeError, ValueError):
        return 0.0


def player_crosswalk(csv_text, id_column='espn_id'):
    """Use published ESPN IDs, rejecting collisions rather than guessing names."""
    result, collisions = {}, set()
    for row in csv.DictReader(io.StringIO(csv_text)):
        espn_id, gsis_id = (row.get(id_column) or '').strip(), (row.get('gsis_id') or '').strip()
        if not espn_id or espn_id == 'NA' or not gsis_id or gsis_id == 'NA':
            continue
        if espn_id in result and result[espn_id]['gsis_id'] != gsis_id:
            collisions.add(espn_id)
        result[espn_id] = {'gsis_id': gsis_id, 'position': row.get('position'), 'name': row.get('display_name') or row.get('name')}
    for espn_id in collisions:
        result.pop(espn_id, None)
    if not result:
        raise ValueError('No NFL player crosswalk found')
    return result


def score_row(row, scoring, expected=False):
    """Apply only comparable linear offensive components to both sides.

    Fumbles, special teams, defense and nonlinear bonuses have no matching model
    expectation here. They are excluded from both actual and expected totals.
    """
    suffix = '_exp' if expected else ''
    result = sum(numeric(scoring.get(key)) * numeric(row.get(column + suffix))
                 for key, column in COMPONENTS.items())
    result += numeric(scoring.get('pass_att')) * numeric(row.get('pass_attempt'))
    result += numeric(scoring.get('rush_att')) * numeric(row.get('rush_attempt'))
    completions = numeric(row.get('pass_completions' + suffix))
    result += numeric(scoring.get('pass_inc')) * (numeric(row.get('pass_attempt')) - completions)
    position = row.get('position', '').lower()
    result += numeric(scoring.get('bonus_rec_' + position)) * numeric(row.get('receptions' + suffix))
    result += numeric(scoring.get('bonus_fd_' + position)) * (
        numeric(row.get('pass_first_down' + suffix)) +
        numeric(row.get('rush_first_down' + suffix)) + numeric(row.get('rec_first_down' + suffix)))
    if position == 'qb':
        result += numeric(scoring.get('bonus_rush_td_qb')) * numeric(row.get('rush_touchdown' + suffix))
    return round(result, 4)


def compact_rows(csv_text, season):
    """Retain source statistics, not a fixed PPR fantasy-points column."""
    keep = set(COMPONENTS.values())
    keep.update(column + '_exp' for column in COMPONENTS.values())
    keep.update({'pass_attempt', 'rush_attempt', 'rec_attempt', 'rec_air_yards',
                 'total_fantasy_points_exp_team', 'pass_fantasy_points_exp_team',
                 'rec_fantasy_points_exp_team', 'rush_fantasy_points_exp_team'})
    rows = []
    reader = csv.DictReader(io.StringIO(csv_text))
    required = {'season', 'week', 'player_id', 'position', 'rush_yards_gained_exp',
                'rec_yards_gained_exp', 'pass_yards_gained_exp', 'receptions_exp'}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError('Upstream expected-stat schema is incomplete')
    for original in reader:
        if str(original.get('season')) != str(season):
            continue
        pid = original.get('player_id')
        week = int(numeric(original.get('week')))
        if not pid or pid == 'NA' or not 1 <= week <= 18 or original.get('position') not in OFFENSE:
            continue
        row = {key: numeric(original.get(key)) for key in keep}
        row.update({key: original.get(key) for key in ('player_id', 'full_name', 'position', 'posteam', 'game_id')})
        row['week'] = week
        rows.append(row)
    if not rows:
        raise ValueError('No regular-season offensive player rows found')
    return rows


def build_opportunity(league, weeks, players, source):
    """Join official GSIS IDs to fantasy lineups and calculate matched offense."""
    if not source or not source.get('rows') or not league.get('scoring_settings'):
        return None
    scoring = league['scoring_settings']
    by_week, player_rows = {}, {}
    for row in source['rows']:
        by_week.setdefault(int(row['week']), {})[row['player_id']] = row
    available = sorted(by_week)
    cutoff = int(league.get('settings', {}).get('last_scored_leg',
                 18 if league.get('status', 'complete') == 'complete' else 0))
    weekly, normalized_weeks, missing = [], {}, set()
    modeled_ids = {pid for pid, info in players.items() if info.get('position') in OFFENSE}
    matched_ids = {pid for pid in modeled_ids if players[pid].get('gsis_id')}
    for week_index, matchups in enumerate(weeks, 1):
        if week_index > cutoff or week_index not in by_week:
            continue
        normalized = normalized_weeks.setdefault(str(week_index), {})
        for matchup in matchups:
            starters = set(matchup.get('starters') or []) - {'0', ''}
            rostered = set(matchup.get('players') or []) | starters
            if not rostered:
                continue
            for pid in rostered:
                info = players.get(pid, {})
                if info.get('position') not in OFFENSE:
                    continue
                gsis = info.get('gsis_id')
                if not gsis:
                    missing.add(info.get('name') or pid)
                    continue
                row = by_week[week_index].get(gsis)
                if not row:
                    scored = (matchup.get('players_points') or {}).get(pid)
                    if not isinstance(scored, (int, float)) or not math.isfinite(scored) or scored != 0:
                        missing.add(info.get('name') or pid)
                        continue
                    # A confidently matched player with no offensive opportunity
                    # has zero modeled points (bye, inactive, or no touches).
                    row = {'position': info.get('position'), 'player_id': gsis}
                actual, xfp = score_row(row, scoring), score_row(row, scoring, True)
                modeled = {'xfp': xfp, 'actual': actual, 'fpoe': round(actual - xfp, 4),
                           'targets': numeric(row.get('rec_attempt')), 'carries': numeric(row.get('rush_attempt')),
                           'airYards': numeric(row.get('rec_air_yards'))}
                # Team share is upstream's standard-PPR offensive opportunity
                # share, excluding quarterback passing to avoid double counting.
                denom = numeric(row.get('rec_fantasy_points_exp_team')) + numeric(row.get('rush_fantasy_points_exp_team'))
                standard = {'rec': 1, 'rec_yd': .1, 'rec_td': 6, 'rush_yd': .1,
                            'rush_td': 6, 'rec_2pt': 2, 'rush_2pt': 2}
                modeled['opportunityShare'] = (round(score_row(row, standard, True) / denom, 4)
                                              if denom > 0 and info.get('position') != 'QB' else None)
                normalized[pid] = modeled
                aggregate = player_rows.setdefault(pid, {'player_id': pid, 'name': info.get('name') or pid,
                    'position': info.get('position'), 'weeks': 0, 'starts': 0,
                    'xfp': 0, 'actual': 0, 'fpoe': 0, 'targets': 0, 'carries': 0, 'airYards': 0,
                    '_seen': set(), '_shares': []})
                if pid in starters and week_index not in aggregate['_seen']:
                    aggregate['_seen'].add(week_index)
                    aggregate['weeks'] += 1
                    for key in ('xfp', 'actual', 'fpoe', 'targets', 'carries', 'airYards'):
                        aggregate[key] += modeled[key]
                    if modeled['opportunityShare'] is not None:
                        aggregate['_shares'].append(modeled['opportunityShare'])
                if pid in starters:
                    aggregate['starts'] += 1
            eligible = [pid for pid in starters if players.get(pid, {}).get('position') in OFFENSE]
            unknown = [pid for pid in starters if not players.get(pid, {}).get('position')]
            covered = [pid for pid in eligible if pid in normalized]
            values = {key: round(sum(normalized[pid][key] for pid in covered), 4)
                      for key in ('xfp', 'actual', 'fpoe')}
            total = len(eligible) + len(unknown)
            weekly.append({'roster_id': matchup['roster_id'], 'week': week_index, **values,
                'covered': len(covered), 'total': total, 'excluded': len(starters) - total,
                'complete': bool(total) and len(covered) == total})
    for aggregate in player_rows.values():
        aggregate.pop('_seen')
        shares = aggregate.pop('_shares')
        aggregate['opportunityShare'] = round(sum(shares) / len(shares), 4) if shares else None
        for key in ('xfp', 'actual', 'fpoe', 'airYards'):
            aggregate[key] = round(aggregate[key], 4)
    return {'model': {'name': 'ffopportunity', 'version': source.get('modelVersion', 'latest'),
                'training': '2006–2020', 'sourceUrl': source.get('sourceUrl'), 'methodologyUrl': MODEL_URL,
                'playerIdsSourceUrl': PLAYER_IDS_URL, 'fantasyIdsSourceUrl': FANTASY_IDS_URL,
                'license': 'CC BY-SA 4.0', 'downloadedAt': source.get('downloadedAt'),
                'scope': 'Modeled offensive points only. Fumbles, nonlinear bonuses, returns, kickers and defense excluded.',
                'shareScope': 'Mean weekly share of NFL team rushing/receiving xFP under standard PPR scoring; QB passing excluded.',
                'excludedScoringKeys': sorted(key for key in EXCLUDED_OFFENSIVE_KEYS if numeric(scoring.get(key)) != 0),
                'scoringSettings': scoring},
            'coverage': {'availableWeeks': available, 'lastWeek': max(available),
                'matchedPlayers': len(matched_ids), 'eligiblePlayers': len(modeled_ids),
                'missingPlayers': sorted(missing)},
            'weekly': weekly, 'weeks': normalized_weeks,
            'players': sorted((row for row in player_rows.values() if row['starts']), key=lambda row: -row['xfp'])}


def saved_seasons():
    years = set()
    for root in (Path('data'), Path('data_espn')):
        try:
            years.update(int(s['season']) for s in json.loads((root / 'seasons.json').read_text()))
        except (OSError, ValueError, KeyError):
            pass
    return sorted(years)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seasons', type=int, nargs='+', help='Defaults to downloaded fantasy seasons')
    parser.add_argument('--no-build', action='store_true')
    parser.add_argument('--offline', action='store_true', help='Use existing cache only')
    args = parser.parse_args()
    seasons = args.seasons or saved_seasons()
    if not seasons:
        raise SystemExit('Download fantasy league history first with setup_data.py.')
    import requests
    DATA_DIR.mkdir(exist_ok=True)
    if not args.offline:
        try:
            response = requests.get(PLAYER_IDS_URL, timeout=60)
            response.raise_for_status()
            ids = player_crosswalk(response.text)
            temporary = DATA_DIR / 'player_ids.json.tmp'
            temporary.write_text(json.dumps(ids, separators=(',', ':')))
            temporary.replace(DATA_DIR / 'player_ids.json')
            print(f'NFL player identity crosswalk: {len(ids)} stable ESPN/GSIS matches')
        except (requests.RequestException, ValueError):
            print('NFL player crosswalk unavailable; existing cache retained')
        try:
            response = requests.get(FANTASY_IDS_URL, timeout=60)
            response.raise_for_status()
            ids = player_crosswalk(response.text, 'sleeper_id')
            temporary = DATA_DIR / 'sleeper_ids.json.tmp'
            temporary.write_text(json.dumps(ids, separators=(',', ':')))
            temporary.replace(DATA_DIR / 'sleeper_ids.json')
            print(f'Fantasy identity crosswalk: {len(ids)} stable Sleeper/GSIS matches')
        except (requests.RequestException, ValueError):
            print('Fantasy player crosswalk unavailable; existing cache retained')
    current = datetime.now(timezone.utc).year
    for season in seasons:
        destination = DATA_DIR / f'{season}.json'
        if args.offline or (destination.exists() and season < current):
            print(f'NFL opportunity {season}: using cached data' if destination.exists()
                  else f'NFL opportunity {season}: no local cache; unavailable')
            continue
        url = f'{BASE_URL}/ep_weekly_{season}.csv'
        try:
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            rows = compact_rows(response.text, season)
            payload = {'season': season, 'modelVersion': 'latest', 'sourceUrl': url,
                'downloadedAt': datetime.now(timezone.utc).isoformat(),
                'license': 'CC BY-SA 4.0', 'attribution': 'ffopportunity / ffverse, built from nflverse play-by-play',
                'rows': rows}
            temporary = destination.with_suffix('.json.tmp')
            temporary.write_text(json.dumps(payload, separators=(',', ':')))
            temporary.replace(destination)
            print(f'NFL opportunity {season}: {len(rows)} player weeks, through week {max(r["week"] for r in rows)}')
        except (requests.RequestException, ValueError):
            print(f'NFL opportunity {season}: upstream unavailable; existing cache retained')
    if not args.no_build:
        subprocess.run([sys.executable, 'build_report.py'], check=True)


if __name__ == '__main__':
    main()
