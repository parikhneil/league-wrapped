"""Opportunity scoring and coverage tests; no network or private credentials."""
import unittest

from fetch_nfl_opportunity import build_opportunity, player_crosswalk, score_row


class OpportunityTests(unittest.TestCase):
    def test_reweights_expected_stats_and_excludes_unmodeled_components(self):
        row = {'position': 'RB', 'rush_yards_gained': 100, 'rush_yards_gained_exp': 80,
               'rush_touchdown': 2, 'rush_touchdown_exp': .5, 'receptions': 4,
               'receptions_exp': 3, 'rec_yards_gained': 40, 'rec_yards_gained_exp': 30,
               'rush_fumble_lost': 1}
        scoring = {'rush_yd': .1, 'rush_td': 6, 'rec': 1, 'rec_yd': .1,
                   'fum_lost': -2, 'bonus_rush_yd_100': 5}
        self.assertEqual(score_row(row, scoring), 30)
        self.assertEqual(score_row(row, scoring, True), 17)
        scoring['rec'] = .5
        self.assertEqual(score_row(row, scoring, True), 15.5)

    def test_identity_crosswalk_trims_and_rejects_collisions(self):
        csv_text = ('sleeper_id,gsis_id,position,name\n'
                    '11, 00-one,RB,Same Name\n'
                    '22,00-two,WR,Same Name\n'
                    '33,00-three,QB,Collision\n'
                    '33,00-four,QB,Collision\n')
        result = player_crosswalk(csv_text, 'sleeper_id')
        self.assertEqual(result['11']['gsis_id'], '00-one')
        self.assertEqual(result['22']['gsis_id'], '00-two')
        self.assertNotIn('33', result)

    def test_starter_totals_conserve_points_and_exclude_future_weeks_and_bench(self):
        league = {'status': 'in_season', 'settings': {'last_scored_leg': 1},
                  'scoring_settings': {'rec': 1, 'rec_yd': .1}}
        players = {'p': {'name': 'Same', 'position': 'WR', 'gsis_id': 'one'},
                   'bench': {'name': 'Same', 'position': 'WR', 'gsis_id': 'two'}}
        source = {'rows': [
            {'player_id': 'one', 'position': 'WR', 'week': 1, 'receptions': 5,
             'receptions_exp': 4, 'rec_yards_gained': 100, 'rec_yards_gained_exp': 70},
            {'player_id': 'two', 'position': 'WR', 'week': 1, 'receptions': 10,
             'receptions_exp': 8, 'rec_yards_gained': 200, 'rec_yards_gained_exp': 140},
            {'player_id': 'one', 'position': 'WR', 'week': 2, 'receptions': 50,
             'receptions_exp': 40} ]}
        matchup = {'roster_id': 1, 'players': ['p', 'bench'], 'starters': ['p'],
                   'players_points': {'p': 15, 'bench': 30}}
        result = build_opportunity(league, [[matchup], [matchup]], players, source)
        self.assertEqual(len(result['weekly']), 1)
        self.assertEqual(len(result['players']), 1)
        self.assertEqual(result['players'][0]['player_id'], 'p')
        self.assertEqual(result['weekly'][0]['xfp'], 11)
        self.assertEqual(result['weekly'][0]['actual'], 15)
        self.assertEqual(result['weekly'][0]['fpoe'], 4)
        self.assertEqual(sum(p['xfp'] for p in result['players']), sum(w['xfp'] for w in result['weekly']))
        league['settings']['last_scored_leg'] = 0
        self.assertEqual(build_opportunity(league, [[matchup]], players, source)['weekly'], [])

    def test_missing_identity_and_missing_score_are_not_zero_opportunity(self):
        players = {
            'active': {'name': 'Active', 'position': 'RB', 'gsis_id': 'one'},
            'idle': {'name': 'Idle', 'position': 'WR', 'gsis_id': 'two'},
            'missing': {'name': 'Missing', 'position': 'TE', 'gsis_id': 'three'},
            'unknown': {'name': 'Unknown', 'position': 'QB'},
            'dst': {'name': 'Defense', 'position': 'DEF'},
        }
        league = {'status': 'complete', 'settings': {}, 'scoring_settings': {'rush_yd': .1}}
        source = {'rows': [{'player_id': 'one', 'position': 'RB', 'week': 1,
                           'rush_yards_gained': 100, 'rush_yards_gained_exp': 80}]}
        matchup = {'roster_id': 1, 'starters': list(players), 'players': list(players),
                   'players_points': {'active': 10, 'idle': 0, 'unknown': 20, 'dst': 8}}
        result = build_opportunity(league, [[matchup]], players, source)
        weekly = result['weekly'][0]
        self.assertEqual((weekly['covered'], weekly['total'], weekly['excluded']), (2, 4, 1))
        self.assertFalse(weekly['complete'])
        self.assertEqual(result['weeks']['1']['idle']['xfp'], 0)
        self.assertNotIn('missing', result['weeks']['1'])
        self.assertNotIn('unknown', result['weeks']['1'])
        self.assertEqual(result['coverage']['missingPlayers'], ['Missing', 'Unknown'])


if __name__ == '__main__':
    unittest.main()
