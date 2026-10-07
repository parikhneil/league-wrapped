import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from fetch_espn_details import bootstrap_season, credentials, normalize_lineup, normalize_transaction


class ESPNImportTests(unittest.TestCase):
    def test_bootstrap_fresh_checkout_and_preserve_enriched_files(self):
        record = {'wins': 1, 'losses': 0, 'ties': 0, 'pointsFor': 101.25, 'pointsAgainst': 90.5}
        raw = {'seasonId': 2024, 'id': 123,
               'settings': {'name': 'Test', 'scheduleSettings': {'matchupPeriods': {'1': [1], '2': [2]}, 'matchupPeriodCount': 1, 'playoffTeamCount': 2}},
               'status': {'isActive': True, 'latestScoringPeriod': 3, 'finalScoringPeriod': 2},
               'teams': [{'id': i, 'owners': [str(i)], 'playoffSeed': i, 'rankCalculatedFinal': i, 'record': {'overall': record}} for i in (1, 2)],
               'members': [{'id': str(i), 'firstName': 'Manager', 'lastName': str(i)} for i in (1, 2)],
               'schedule': [{'id': 7, 'matchupPeriodId': 1, 'home': {'teamId': 1, 'totalPoints': 101.25}, 'away': {'teamId': 2, 'totalPoints': 90.5}}]}
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'data_espn' / '2024'
            bootstrap_season(raw, folder)
            league = json.loads((folder / 'league.json').read_text())
            self.assertEqual(league['status'], 'complete')
            self.assertEqual(league['settings']['playoff_week_start'], 2)
            self.assertEqual(json.loads((folder / 'winners_bracket.json').read_text())[0]['w'], 1)
            self.assertEqual(json.loads((folder / 'rosters.json').read_text())[0]['settings']['fpts_decimal'], 25)
            matchup = folder / 'matchups_week_1.json'
            matchup.write_text('[{"enriched": true}]')
            bootstrap_season(raw, folder)
            self.assertEqual(json.loads(matchup.read_text()), [{'enriched': True}])
            self.assertEqual(len(json.loads((folder.parent / 'seasons.json').read_text())), 1)

    def test_lineup_namespaces_ids_and_excludes_bench(self):
        lineup = [SimpleNamespace(playerId=42, slot_position='RB', points=15),
                  SimpleNamespace(playerId=99, slot_position='BE', points=20)]
        result = normalize_lineup(lineup)
        self.assertEqual(result['starters'], ['espn:42'])
        self.assertEqual(result['players_points']['espn:99'], 20)

    def test_trade_and_incomplete_details(self):
        raw = {'id': 7, 'type': 'TRADE_ACCEPT', 'status': 'EXECUTED',
               'scoringPeriodId': 4, 'items': [{'playerId': 42, 'fromTeamId': 1, 'toTeamId': 2}]}
        result = normalize_transaction(raw)
        self.assertEqual(result['adds'], {'espn:42': 2})
        self.assertEqual(result['drops'], {'espn:42': 1})
        self.assertFalse(result['details_incomplete'])
        self.assertTrue(normalize_transaction(dict(raw, items=[]))['details_incomplete'])
        self.assertIsNone(normalize_transaction(dict(raw, status='PENDING')))

    def test_missing_credentials_fail_without_printing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'secrets.json'
            path.write_text(json.dumps({'espn_s2': 'sensitive-test-value', 'SWID': ''}))
            with self.assertRaises(SystemExit) as error:
                credentials(path)
            self.assertNotIn('sensitive-test-value', str(error.exception))


if __name__ == '__main__':
    unittest.main()
