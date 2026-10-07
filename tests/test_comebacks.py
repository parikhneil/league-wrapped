import copy
import unittest

from fetch_comeback_history import compact_player_games, compact_schedules, reconstruct
from record_comebacks import create_snapshots, merge_snapshots


def fixture():
    schedules = [
        {'game_id': '2025_01_PHI_DAL', 'season': 2025, 'week': 1, 'gameday': '2025-09-04',
         'gametime': '20:20', 'away_team': 'PHI', 'home_team': 'DAL', 'complete': True},
        {'game_id': '2025_01_KC_LA', 'season': 2025, 'week': 1, 'gameday': '2025-09-07',
         'gametime': '13:00', 'away_team': 'KC', 'home_team': 'LA', 'complete': True},
        {'game_id': '2025_01_MIN_CHI', 'season': 2025, 'week': 1, 'gameday': '2025-09-08',
         'gametime': '20:15', 'away_team': 'MIN', 'home_team': 'CHI', 'complete': True},
    ]
    player_games = [
        {'player_id': 'qb', 'week': 1, 'game_id': '2025_01_PHI_DAL', 'team': 'PHI'},
        {'player_id': 'k', 'week': 1, 'game_id': '2025_01_PHI_DAL', 'team': 'PHI'},
        {'player_id': 'rb', 'week': 1, 'game_id': '2025_01_MIN_CHI', 'team': 'MIN'},
        {'player_id': 'wr', 'week': 1, 'game_id': '2025_01_KC_LA', 'team': 'KC'},
    ]
    season = {
        'src': 'Sleeper',
        'league': {'season': '2025', 'league_id': '123', 'status': 'complete', 'settings': {'last_scored_leg': 1}},
        # Today's teams deliberately differ from historical weekly games.
        'players': {'pqb': {'position': 'QB', 'gsis_id': 'qb', 'team': 'NYJ'},
                    'pk': {'position': 'K', 'gsis_id': 'k', 'team': 'NYJ'},
                    'prb': {'position': 'RB', 'gsis_id': 'rb', 'team': 'NYJ'},
                    'pwr': {'position': 'WR', 'gsis_id': 'wr', 'team': 'NYJ'},
                    'PHI': {'position': 'DEF'}, 'espn:def': {'position': 'D/ST', 'name': 'Rams D/ST'}},
        'weeks': [[
            {'roster_id': 1, 'matchup_id': 1, 'starters': ['pqb', 'pk', 'PHI', 'prb'],
             'players_points': {'pqb': 10, 'pk': 5, 'PHI': 5, 'prb': 50}, 'points': 70},
            {'roster_id': 2, 'matchup_id': 1, 'starters': ['pwr', 'espn:def'],
             'players_points': {'pwr': 45, 'espn:def': 10}, 'points': 55},
        ]],
    }
    return season, schedules, player_games


class ReconstructionTests(unittest.TestCase):
    def test_exact_historical_game_ids_kickers_and_franchise_defense(self):
        history = reconstruct(*fixture())
        self.assertEqual(history['coverage']['reconstructedMatchups'], 1)
        self.assertEqual(len(history['snapshots']), 2)
        before_sunday, before_monday = history['snapshots']
        self.assertEqual([t['points'] for t in before_sunday['teams']], [20, 0])
        self.assertEqual([t['points'] for t in before_monday['teams']], [20, 55])
        self.assertEqual(before_monday['captured_at'], '2025-09-09T00:15:00+00:00')
        self.assertEqual(before_monday['method'], 'reconstructed_day_boundary')
        self.assertNotIn('win_probability', before_monday['teams'][0])

    def test_unknown_nonzero_player_never_uses_current_team(self):
        season, schedules, games = fixture()
        season['players']['prb'].pop('gsis_id')
        history = reconstruct(season, schedules, games)
        self.assertEqual(history['snapshots'], [])
        self.assertEqual(history['coverage']['reasons'], {'unmapped_historical_player_game': 1})

    def test_lineup_and_commissioner_score_mismatch_skips_whole_pair(self):
        season, schedules, games = fixture()
        season['weeks'][0][0]['points'] = 71
        history = reconstruct(season, schedules, games)
        self.assertEqual(history['snapshots'], [])
        self.assertIn('starter_total_differs_from_team_score', history['coverage']['reasons'])

    def test_unfinished_games_and_unknown_first_kickoff_are_not_invented(self):
        season, schedules, games = fixture()
        schedules[0]['complete'] = False
        self.assertEqual(reconstruct(season, schedules, games)['snapshots'], [])
        season, schedules, games = fixture()
        schedules[1]['gametime'] = ''
        history = reconstruct(season, schedules, games)
        self.assertEqual(len(history['snapshots']), 1)
        self.assertIn('2025-09-08', history['snapshots'][0]['checkpoint'])

    def test_zero_final_points_can_contribute_zero_without_assuming_a_game(self):
        season, schedules, games = fixture()
        season['weeks'][0][0]['starters'].append('bye_player')
        season['weeks'][0][0]['players_points']['bye_player'] = 0
        history = reconstruct(season, schedules, games)
        self.assertEqual(history['coverage']['reconstructedMatchups'], 1)
        self.assertEqual(history['snapshots'][1]['teams'][0]['points'], 20)

    def test_only_completed_fantasy_weeks_are_reconstructed(self):
        season, schedules, games = fixture()
        season['league']['settings']['last_scored_leg'] = 0
        history = reconstruct(season, schedules, games)
        self.assertEqual(history['snapshots'], [])
        self.assertEqual(history['coverage']['completedMatchups'], 0)

    def test_sources_only_keep_regular_season_with_valid_game_identity(self):
        rows = [{'game_type': 'REG', 'game_id': 'g', 'gameday': '2025-09-07', 'season': '2025',
                 'week': '1', 'home_score': '0', 'away_score': '3', 'gametime': '13:00'}]
        self.assertTrue(compact_schedules(rows)[0]['complete'])
        player = {'season_type': 'REG', 'season': '2025', 'player_id': 'p', 'game_id': 'g', 'week': '1', 'team': 'LA'}
        self.assertEqual(len(compact_player_games([player, dict(player, season_type='POST')], 2025)), 1)


class LiveRecorderTests(unittest.TestCase):
    def test_current_public_matchup_points_are_recorded_without_probabilities(self):
        league = {'league_id': '123', 'season': '2026', 'sport': 'nfl', 'status': 'in_season'}
        state = {'season': '2026', 'season_type': 'regular', 'week': 5}
        teams = [{'roster_id': 1, 'matchup_id': 1, 'points': 20.4},
                 {'roster_id': 2, 'matchup_id': 1, 'points': -1.2}]
        snapshots = create_snapshots(league, state, teams, '2026-10-11T19:00:00Z')
        self.assertEqual(snapshots[0]['teams'][1]['points'], -1.2)
        self.assertEqual(snapshots[0]['method'], 'observed')
        self.assertNotIn('win_probability', snapshots[0]['teams'][0])

    def test_past_or_future_week_cannot_be_presented_as_live_history(self):
        league = {'league_id': '123', 'season': '2026', 'sport': 'nfl', 'status': 'in_season'}
        state = {'season': '2026', 'season_type': 'regular', 'week': 5}
        with self.assertRaises(ValueError):
            create_snapshots(league, state, [], '2026-10-11T19:00:00Z', requested_week=4)
        league['season'] = '2025'
        with self.assertRaises(ValueError):
            create_snapshots(league, state, [], '2026-10-11T19:00:00Z')

    def test_merge_preserves_reconstructed_and_imported_odds_without_repeating_unchanged_scores(self):
        league = {'league_id': '123', 'season': '2026', 'sport': 'nfl', 'status': 'in_season'}
        state = {'season': '2026', 'season_type': 'regular', 'week': 5}
        snapshots = create_snapshots(league, state, [{'roster_id': 1, 'matchup_id': 1, 'points': 10},
                                                  {'roster_id': 2, 'matchup_id': 1, 'points': 20}], '2026-10-11T19:00:00Z')
        existing = {'version': 1, 'season': '2026', 'league_id': '123', 'snapshots': [
            {'source': 'nflverse_game_day_reconstruction', 'method': 'reconstructed_day_boundary', 'teams': []},
            {'source': 'Original source', 'probability_kind': 'fantasy_matchup', 'teams': []}]}
        before = copy.deepcopy(existing)
        merged, added = merge_snapshots(existing, league, snapshots)
        self.assertEqual(added, 1)
        self.assertEqual(merged['snapshots'][:2], before['snapshots'])
        self.assertEqual(existing, before)
        snapshots[0]['captured_at'] = '2026-10-11T19:01:00Z'
        merged, added = merge_snapshots(merged, league, snapshots)
        self.assertEqual(added, 0)
        self.assertEqual(len(merged['snapshots']), 3)

    def test_foreign_league_data_is_never_overwritten(self):
        with self.assertRaises(ValueError):
            merge_snapshots({'version': 1, 'season': '2026', 'league_id': 'other', 'snapshots': []},
                            {'season': '2026', 'league_id': '123'}, [])


if __name__ == '__main__':
    unittest.main()
