"""Fetch authenticated ESPN draft, historical lineups, and transaction details.

Run: python3 fetch_espn_details.py
Credentials: local espn_secrets.json with espn_s2 and SWID (never logged).
Existing reports and browser-imported picks are preserved if authentication fails.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, indent=2) + '\n')
    tmp.replace(path)


def bootstrap_season(raw, folder):
    """Create the builder's base files from ESPN, without needing saved history."""
    season = str(raw['seasonId'])
    schedule = raw['settings']['scheduleSettings']
    periods = schedule['matchupPeriods']
    regular = schedule['matchupPeriodCount']
    playoff_start = max(w for p, weeks in periods.items() if int(p) <= regular for w in weeks) + 1
    teams = raw['teams']
    playoff_ids = [t['id'] for t in teams if 0 < t.get('playoffSeed', 0) <= schedule['playoffTeamCount']]
    league = {'league_id': str(raw['id']), 'season': season,
              'name': raw['settings']['name'], 'source': 'espn',
              'status': 'complete' if raw['status']['latestScoringPeriod'] > raw['status']['finalScoringPeriod'] else 'in_season',
              'settings': {'playoff_week_start': playoff_start},
              'playoff_roster_ids': playoff_ids, 'previous_league_id': None}
    users = [{'user_id': m['id'], 'display_name': m.get('displayName', ''),
              'full_name': ' '.join(filter(None, [m.get('firstName'), m.get('lastName')]))}
             for m in raw['members']]
    rosters = []
    for team in teams:
        record = team['record']['overall']
        settings = {k: record[k] for k in ('wins', 'losses', 'ties')}
        for key, field in [('fpts', 'pointsFor'), ('fpts_against', 'pointsAgainst')]:
            cents = round(record[field] * 100)
            settings[key], settings[key + '_decimal'] = divmod(cents, 100)
        rosters.append({'roster_id': team['id'], 'owner_id': team.get('primaryOwner') or team['owners'][0], 'settings': settings})
    weeks = {}
    for match in raw['schedule']:
        scoring_weeks = periods[str(match['matchupPeriodId'])]
        for week in scoring_weeks:
            for side in ('home', 'away'):
                entry = match.get(side)
                if not entry:
                    continue
                scores = entry.get('pointsByScoringPeriod', {})
                points = scores.get(str(week))
                if points is None and len(scoring_weeks) == 1:
                    points = entry['totalPoints']
                if points is None:
                    raise ValueError('ESPN did not provide individual scores for a multiweek matchup')
                weeks.setdefault(week, []).append({'roster_id': entry['teamId'], 'matchup_id': match['id'], 'points': points})
    ranked = {t.get('rankCalculatedFinal'): t['id'] for t in teams}
    bracket = []
    if league['status'] == 'complete' and 1 in ranked and 2 in ranked:
        bracket = [{'r': 1, 'm': 1, 't1': ranked[1], 't2': ranked[2], 'w': ranked[1], 'l': ranked[2], 'p': 1}]
    files = {'league.json': league, 'users.json': users, 'rosters.json': rosters,
             'winners_bracket.json': bracket, 'losers_bracket.json': []}
    files.update({f'matchups_week_{w}.json': rows for w, rows in weeks.items()})
    for filename, data in files.items():
        if not (folder / filename).exists():
            save(folder / filename, data)
    index = folder.parent / 'seasons.json'
    seasons = json.loads(index.read_text()) if index.exists() else []
    summary = dict(season=season, league_id=league['league_id'], name=league['name'], status=league['status'], total_rosters=len(teams))
    save(index, sorted([s for s in seasons if s['season'] != season] + [summary], key=lambda s: s['season'], reverse=True))


def normalize_lineup(lineup):
    """Namespace ESPN IDs to avoid collisions with Sleeper IDs."""
    players, starters, points = [], [], {}
    for player in lineup:
        pid = f'espn:{player.playerId}'
        players.append(pid)
        if player.slot_position not in ('BE', 'IR'):
            starters.append(pid)
        points[pid] = player.points
    return {'players': players, 'starters': starters, 'players_points': points}


def normalize_transaction(raw):
    kind = raw.get('type')
    if raw.get('status') != 'EXECUTED' or kind not in ('FREEAGENT', 'WAIVER', 'TRADE_ACCEPT'):
        return None
    adds, drops = {}, {}
    for item in raw.get('items') or []:
        if item.get('playerId') is None:
            continue
        pid = f"espn:{item['playerId']}"
        source, target = item.get('fromTeamId'), item.get('toTeamId')
        if isinstance(source, int) and source > 0:
            drops[pid] = source
        if isinstance(target, int) and target > 0:
            adds[pid] = target
    return {'transaction_id': str(raw['id']), 'status': 'complete',
            'type': {'FREEAGENT': 'free_agent', 'WAIVER': 'waiver', 'TRADE_ACCEPT': 'trade'}[kind],
            'leg': raw.get('scoringPeriodId', 1),
            'status_updated': raw.get('processDate') or raw.get('acceptedDate') or raw.get('proposedDate') or 0,
            'adds': adds, 'drops': drops, 'draft_picks': [], 'waiver_budget': [],
            'details_incomplete': not bool(raw.get('items')),
            'bid_amount': raw.get('bidAmount')}


def credentials(path):
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        raise SystemExit('Authentication required: espn_secrets.json must contain espn_s2 and SWID.')
    s2, swid = data.get('espn_s2'), data.get('SWID') or data.get('swid')
    if not all(isinstance(v, str) and v.strip() and not v.upper().startswith(('YOUR', 'PASTE', '<')) for v in (s2, swid)):
        raise SystemExit('Authentication required: no usable ESPN cookies in espn_secrets.json. Existing data was not changed.')
    os.chmod(path, 0o600)
    return s2, swid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--league-id', type=int, default=1706900528)
    parser.add_argument('--season', type=int, default=2024)
    args = parser.parse_args()
    s2, swid = credentials(Path('espn_secrets.json'))
    try:
        from espn_api.football import League
    except ImportError:
        raise SystemExit('Install dependencies with: python3 -m pip install -r requirements.txt')
    try:
        league = League(league_id=args.league_id, year=args.season, espn_s2=s2, swid=swid)
    except Exception:
        raise SystemExit('ESPN authentication or league access failed. Cookie values were not logged; existing data was not changed.')
    folder = Path('data_espn') / str(args.season)
    if not (folder / 'rosters.json').exists():
        try:
            raw = league.espn_request.league_get(params={'view': ['mTeam', 'mSettings', 'mMatchup', 'mSchedule']})
            bootstrap_season(raw, folder)
        except Exception:
            raise SystemExit('Could not initialize ESPN league history. Check league access and try again.')
    draft_id = f'espn-{args.season}-api'
    players = {}
    def remember(player):
        players[f'espn:{player.playerId}'] = {'name': player.name, 'position': getattr(player, 'position', '')}
    picks = []
    team_count = len(league.teams)
    for pick in league.draft:
        pid = f'espn:{pick.playerId}'
        name = league.player_map.get(pick.playerId, pick.playerName or pid)
        players[pid] = {'name': name}
        picks.append({'draft_id': draft_id, 'round': pick.round_num,
                      'pick_no': (pick.round_num - 1) * team_count + pick.round_pick,
                      'roster_id': pick.team.team_id, 'player_id': pid,
                      'metadata': {'first_name': name, 'last_name': ''}})
    enriched, transactions, warnings = {}, {}, []
    final_week = min(18, league.finalScoringPeriod)
    for week in range(1, final_week + 1):
        original = json.loads((folder / f'matchups_week_{week}.json').read_text()) if (folder / f'matchups_week_{week}.json').exists() else []
        try:
            boxes = league.box_scores(week=week)
            lineups = {}
            for box in boxes:
                for side in ('home', 'away'):
                    team, lineup = getattr(box, side + '_team'), getattr(box, side + '_lineup')
                    if not team or not lineup:
                        continue
                    lineups[team.team_id] = normalize_lineup(lineup)
                    for p in lineup:
                        remember(p)
            expected = {m['roster_id'] for m in original}
            if not expected or not expected.issubset(lineups):
                raise ValueError('Incomplete historical lineups')
            # Protect against ESPN returning a different week's lineups/totals.
            for m in original:
                lineup = lineups[m['roster_id']]
                total = sum(lineup['players_points'][pid] for pid in lineup['starters'])
                if abs(total - m.get('points', 0)) > 0.1:
                    raise ValueError('Lineup scores disagree with saved matchup')
            enriched[week] = [dict(m, **lineups[m['roster_id']]) for m in original]
        except Exception:
            warnings.append(f'Week {week}: historical lineups unavailable or failed score validation; kept existing matchups.')
        try:
            raw = league.espn_request.league_get(params={'view': 'mTransactions2', 'scoringPeriodId': week},
                headers={'x-fantasy-filter': json.dumps({'transactions': {'filterType': {'value': ['FREEAGENT', 'WAIVER', 'TRADE_ACCEPT']}}})})
            if 'transactions' not in raw:
                raise ValueError('Missing transactions field')
            rows = [t for r in raw['transactions'] if (t := normalize_transaction(r)) is not None]
            transactions[week] = list({t['transaction_id']: t for t in rows if int(t['leg']) == week}.values())
            if any(t['details_incomplete'] for t in rows):
                warnings.append(f'Week {week}: some transaction player details were omitted by ESPN.')
        except Exception:
            warnings.append(f'Week {week}: transaction query failed; kept existing transaction data.')
        print(f'Fetched week {week}/{final_week}')
    for pid, info in players.items():
        for pick in picks:
            if pick['player_id'] == pid:
                pick['metadata']['position'] = info.get('position', '')
    # Draft IDs are replaced only when ESPN actually returns the complete draft.
    previous = json.loads((folder / 'drafts.json').read_text()) if (folder / 'drafts.json').exists() else []
    previous_count = sum(len(json.loads((folder / f"draft_{d['draft_id']}_picks.json").read_text())) for d in previous)
    if picks and len(picks) >= previous_count:
        save(folder / f'draft_{draft_id}_picks.json', picks)
        save(folder / 'drafts.json', [{'draft_id': draft_id, 'season': str(args.season), 'status': 'complete', 'source': 'ESPN authenticated API'}])
    else:
        warnings.append('Draft response was empty or shorter than the saved recap; kept the original draft.')
    for week, rows in enriched.items():
        save(folder / f'matchups_week_{week}.json', rows)
    for week, rows in transactions.items():
        save(folder / f'transactions_week_{week}.json', rows)
    existing = json.loads((folder / 'players.json').read_text()) if (folder / 'players.json').exists() else {}
    save(folder / 'players.json', {**existing, **players})
    save(folder / 'detail_coverage.json', {'lineup_weeks': sorted(enriched), 'transaction_weeks': sorted(transactions), 'warnings': warnings,
         'notes': 'Historical transaction completeness is unverified; API access does not guarantee retention.'})
    for warning in warnings:
        print(warning)
    subprocess.run([sys.executable, 'build_report.py'], check=True)


if __name__ == '__main__':
    main()
