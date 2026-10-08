"""Data-boundary checks: week cutoffs, NFL byes, and safe static export."""

import json
import tempfile
import unittest
from pathlib import Path

from fetch_matchup_data import (NFL_TEAMS, build_snapshot, current_week, export_player_catalog,
                                parse_schedule, save, schedule_complete)


class MatchupDataTests(unittest.TestCase):
    def test_catalog_covers_unrostered_players_and_eligibility_without_source_details(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            save({"unrostered": {"first_name": "Another", "last_name": "Player", "position": "DE",
                                 "fantasy_positions": ["DL", "LB"], "team": "LAR", "injury_status": "Out",
                                 "birth_date": "private", "news_updated": "unneeded"},
                  "KC": {"full_name": "Kansas City Chiefs", "position": "DEF", "team": "KC"}}, data / "players.json")
            save({"playersUpdatedAt": "2026-10-01T11:00:00Z"}, data / "matchup_sources.json")
            output = data / "forecast-players.js"
            catalog = export_player_catalog(data, output)
            self.assertEqual(set(catalog["players"]), {"unrostered", "KC"})
            self.assertEqual(catalog["players"]["unrostered"]["fantasy_positions"], ["DL", "LB"])
            self.assertEqual(catalog["players"]["unrostered"]["team"], "LA")
            self.assertEqual(catalog["updatedAt"], "2026-10-01T11:00:00Z")
            self.assertNotIn("birth_date", output.read_text())
            self.assertNotIn("news_updated", output.read_text())
            exported = json.loads(output.read_text().split("window.FORECAST_PLAYERS = ")[1].rstrip(";\n"))
            self.assertEqual(exported, catalog)

    def test_catalog_does_not_present_export_time_as_injury_freshness(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            save({"p": {"full_name": "Player </script>", "position": "WR"}}, data / "players.json")
            output = data / "forecast-players.js"
            self.assertIsNone(export_player_catalog(data, output)["updatedAt"])
            self.assertNotIn("</script>", output.read_text())
            (data / "players_fetched.txt").write_text("1791370800")
            self.assertEqual(export_player_catalog(data, output)["updatedAt"], "2026-10-07T11:00:00+00:00")

    def test_state_must_match_league_season(self):
        league = {"season": "2026", "status": "in_season", "settings": {"last_scored_leg": 4}}
        self.assertEqual(current_week(league, {"season": "2025", "week": 14, "season_type": "regular"})[0], 5)
        self.assertEqual(current_week(league, {"season": "2026", "week": 6, "season_type": "regular"})[0], 6)
        self.assertEqual(current_week(dict(league, status="complete"), {"season": "2026", "week": 6})[0], 19)

    def test_partial_duplicate_or_missing_season_schedule_is_not_complete(self):
        teams = sorted(NFL_TEAMS)
        games = [{"week": week, "home": teams[i], "away": teams[i + 1], "gameId": f"{week}-{i}"}
                 for week in range(1, 18) for i in range(0, 32, 2)]
        self.assertFalse(schedule_complete(games))  # no week 18 coverage
        for game in games[-16:]:
            game["week"] = 18
        games[0]["week"] = 17
        self.assertTrue(schedule_complete(games))
        self.assertFalse(schedule_complete(games[:-1]))
        self.assertFalse(schedule_complete(games + [games[0]]))
        games[1]["home"] = games[2]["home"]
        self.assertFalse(schedule_complete(games))

    def test_schedule_parser_exports_dates_and_teams_only(self):
        csv = ("season,game_type,week,gameday,gametime,home_team,away_team,game_id,home_moneyline\n"
               "2026,REG,5,2026-10-08,20:15,LAR,WSH,game1,-130\n"
               "2025,REG,5,2025-10-09,20:15,KC,DEN,old,-120\n"
               "2026,POST,19,2027-01-10,13:00,KC,DEN,post,-120\n")
        games = parse_schedule(csv, "2026")
        self.assertEqual(len(games), 1)
        self.assertEqual((games[0]["home"], games[0]["away"]), ("LA", "WAS"))
        self.assertEqual(games[0]["kickoff"], "2026-10-08T20:15:00-04:00")
        self.assertNotIn("home_moneyline", games[0])

    def test_export_excludes_future_scores_and_private_or_unneeded_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            league = {"season": "2026", "league_id": "league1", "name": "</script>league", "status": "in_season",
                      "settings": {"last_scored_leg": 8, "playoff_week_start": 7},
                      "roster_positions": ["QB"], "scoring_settings": {"pass_td": 4}, "not_needed": "private"}
            save([{"season": "2026"}], data / "seasons.json")
            save(league, data / "2026/league.json")
            save({"state": {"season": "2026", "week": 5, "season_type": "regular"}}, data / "matchup_sources.json")
            save([{"user_id": "u", "display_name": "</script>", "email": "private@example.com"}], data / "2026/users.json")
            save([{"roster_id": 1, "owner_id": "u", "starters": ["p"]}], data / "2026/rosters.json")
            save([{"roster_id": 1, "matchup_id": 1, "players_points": {"p": 40}, "starters": ["p"]}],
                 data / "2026/matchups_week_5.json")
            save({"p": {"full_name": "Player", "position": "QB", "team": "KC", "unneeded": "private"}}, data / "players.json")
            save({"season": "2025", "games": [{"week": 5, "home": "KC", "away": "DEN", "gameId": "old"}]}, data / "nfl_schedule.json")
            output = data / "matchup-data.js"
            snapshot = build_snapshot(data, output, "league1")
            self.assertEqual(snapshot["history"][0]["lastCompletedWeek"], 4)
            self.assertEqual(snapshot["currentWeek"], 5)
            self.assertEqual(snapshot["schedule"], [])
            self.assertFalse(snapshot["scheduleComplete"])
            self.assertNotIn("email", snapshot["users"][0])
            self.assertNotIn("not_needed", snapshot["league"])
            self.assertNotIn("unneeded", snapshot["players"]["p"])
            text = output.read_text()
            self.assertNotIn("</script>", text)
            exported = json.loads(text.split("window.MATCHUP_DATA = ")[1].rstrip(";\n"))
            self.assertEqual(exported["league"]["name"], "</script>league")


if __name__ == "__main__":
    unittest.main()
