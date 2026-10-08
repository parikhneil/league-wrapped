"""Refresh public forecast inputs and export a snapshot for the static matchup page.

Usage: python3 fetch_matchup_data.py [--offline] [--league LEAGUE_ID]
No credentials or third-party Python packages are required. NFL schedule data is
used only for dates/opponents/byes; its sportsbook odds are never exported.
"""

import argparse
import csv
import io
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DEFAULT_LEAGUE = "1381121078079795200"
API = "https://api.sleeper.app/v1"
SCHEDULE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
NFL_TEAMS = set("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LA LAC LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split())


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save(value, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    os.replace(temp, path)


def fetch(url):
    request = Request(url, headers={"User-Agent": "LeagueWrapped/1.0 (public fantasy forecasts)"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def get(endpoint):
    value = json.loads(fetch(f"{API}/{endpoint}"))
    time.sleep(0.08)
    return value


def regular_end(league):
    settings = league.get("settings") or {}
    playoff_start = int(settings.get("playoff_week_start") or 0)
    return min(18, playoff_start - 1) if playoff_start > 0 else 18


def current_week(league, state):
    """Use NFL state only when its season agrees with this league's season."""
    if league.get("status") == "complete":
        return 19, "season complete"
    if str(state.get("season")) == str(league.get("season")):
        week = int(state.get("week") or state.get("display_week") or 0)
        if state.get("season_type") == "regular" and 1 <= week <= 18:
            return week, "Sleeper NFL state"
        if state.get("season_type") in {"post", "postseason"}:
            return 19, "NFL regular season complete"
    completed = int((league.get("settings") or {}).get("last_scored_leg") or 0)
    return min(19, max(1, completed + 1)), "saved last scored week + 1"


def normalize_team(team):
    return {"LAR": "LA", "JAC": "JAX", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}.get(team, team)


def parse_schedule(body, season):
    games = []
    for row in csv.DictReader(io.StringIO(body)):
        if row.get("season") != str(season) or row.get("game_type") != "REG":
            continue
        away, home = normalize_team(row["away_team"]), normalize_team(row["home_team"])
        week = int(row["week"])
        if away not in NFL_TEAMS or home not in NFL_TEAMS or away == home or not 1 <= week <= 18:
            continue
        local_time = row.get("gametime")
        kickoff = None
        if local_time:
            kickoff = datetime.fromisoformat(f"{row['gameday']}T{local_time}").replace(
                tzinfo=ZoneInfo("America/New_York")).isoformat()
        games.append({"week": week, "away": away, "home": home,
                      "kickoff": kickoff, "date": row["gameday"],
                      "kickoffTimezone": "America/New_York", "gameId": row["game_id"]})
    games.sort(key=lambda game: (game["week"], game["date"], game["kickoff"] or "", game["gameId"]))
    return games


def schedule_complete(games):
    """A missing/partial schedule must never turn an unknown game into a bye."""
    counts = {team: 0 for team in NFL_TEAMS}
    seen = set()
    weekly = set()
    for game in games:
        key = game.get("gameId")
        if not key or key in seen:
            return False
        seen.add(key)
        for side in ("home", "away"):
            team = normalize_team(game.get(side))
            pair = (game.get("week"), team)
            if team not in counts or pair in weekly:
                return False
            weekly.add(pair)
            counts[team] += 1
    return (len(games) == 272 and all(count == 17 for count in counts.values())
            and {game["week"] for game in games} == set(range(1, 19)))


def refresh(data_dir, league_id):
    """Refresh league data atomically per file; failure preserves the last export."""
    sources = load(data_dir / "matchup_sources.json", {}) or {}
    state = get("state/nfl")
    sources["state"] = state
    sources["stateUpdatedAt"] = now_iso()
    seasons, seen = [], set()
    next_id = league_id
    while next_id and next_id != "0" and next_id not in seen:
        seen.add(next_id)
        league = get(f"league/{next_id}")
        if not isinstance(league, dict) or not league.get("season"):
            raise ValueError(f"Sleeper league {next_id} was not found")
        folder = data_dir / str(league["season"])
        saved = load(folder / "league.json", {}) or {}
        saved_same_league = str(saved.get("league_id")) == str(next_id)
        required = ("matchups_week_1.json", "users.json", "rosters.json")
        if not saved_same_league or league.get("status") != "complete" or not all((folder / name).exists() for name in required):
            users = get(f"league/{next_id}/users")
            rosters = get(f"league/{next_id}/rosters")
            rows = [get(f"league/{next_id}/matchups/{week}") for week in range(1, 19)]
            if not isinstance(users, list) or not isinstance(rosters, list) or not all(isinstance(row, list) for row in rows):
                raise ValueError("Sleeper returned incomplete league inputs; keeping the previous export")
            save(users, folder / "users.json")
            save(rosters, folder / "rosters.json")
            for week, values in enumerate(rows, 1):
                save(values, folder / f"matchups_week_{week}.json")
            sources.setdefault("leagueUpdatedAt", {})[str(next_id)] = now_iso()
        save(league, folder / "league.json")
        seasons.append({key: league.get(key) for key in ("season", "league_id", "name", "status", "total_rosters")})
        next_id = league.get("previous_league_id")
    save(seasons, data_dir / "seasons.json")

    # Sleeper asks clients to download the large NFL player list at most daily.
    players_path = data_dir / "players.json"
    stamp_path = data_dir / "players_fetched.txt"
    try:
        stamp = float(stamp_path.read_text())
    except (OSError, ValueError):
        stamp = players_path.stat().st_mtime if players_path.exists() else 0
    if not players_path.exists() or time.time() - stamp >= 24 * 3600:
        players = get("players/nfl")
        if not isinstance(players, dict) or not players:
            raise ValueError("Sleeper returned an empty NFL player database")
        save(players, players_path)
        stamp = time.time()
        stamp_path.write_text(str(stamp))
    sources["playersUpdatedAt"] = datetime.fromtimestamp(stamp, timezone.utc).isoformat(timespec="seconds")
    season = seasons[0]["season"]
    try:
        games = parse_schedule(fetch(SCHEDULE_URL), season)
        save({"season": str(season), "games": games, "complete": schedule_complete(games), "updatedAt": now_iso()},
             data_dir / "nfl_schedule.json")
    except (OSError, ValueError) as exc:
        print(f"NFL schedule refresh unavailable; using cached schedule if valid ({exc})")
    save(sources, data_dir / "matchup_sources.json")


def compact_week(rows):
    keys = ("roster_id", "matchup_id", "points", "custom_points", "starters", "players_points")
    return [{key: row[key] for key in keys if key in row} for row in rows or [] if isinstance(row, dict)]


def player_metadata(player_id, metadata):
    name = metadata.get("full_name") or " ".join(filter(None, (metadata.get("first_name"), metadata.get("last_name"))))
    value = {"name": name or str(player_id), "position": metadata.get("position"),
             "team": normalize_team(metadata.get("team")), "injuryStatus": metadata.get("injury_status")}
    if isinstance(metadata.get("fantasy_positions"), list):
        value["fantasy_positions"] = metadata["fantasy_positions"]
    return value


def export_player_catalog(data_dir=ROOT / "data", output=ROOT / "forecast-players.js"):
    """Public minimal metadata for any NFL roster, including IDP and defenses."""
    data_dir, output = Path(data_dir), Path(output)
    raw = load(data_dir / "players.json", {})
    if not isinstance(raw, dict) or not raw:
        raise ValueError("No saved NFL player database; run python3 fetch_matchup_data.py first")
    sources = load(data_dir / "matchup_sources.json", {}) or {}
    # Export time does not establish freshness of the source injury metadata.
    updated = sources.get("playersUpdatedAt")
    if not updated:
        try:
            stamp = float((data_dir / "players_fetched.txt").read_text())
            updated = datetime.fromtimestamp(stamp, timezone.utc).isoformat(timespec="seconds")
        except (OSError, ValueError, OverflowError):
            updated = None
    catalog = {"players": {str(pid): player_metadata(pid, metadata)
                           for pid, metadata in sorted(raw.items()) if isinstance(metadata, dict)},
               "updatedAt": updated}
    content = "// Minimal public NFL player catalog for any Sleeper league. Generated by fetch_matchup_data.py.\nwindow.FORECAST_PLAYERS = "
    content += json.dumps(catalog, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/") + ";\n"
    temp = output.with_suffix(output.suffix + ".tmp")
    temp.write_text(content, encoding="utf-8")
    os.replace(temp, output)
    return catalog


def build_snapshot(data_dir=ROOT / "data", output=ROOT / "matchup-data.js", league_id=DEFAULT_LEAGUE):
    data_dir = Path(data_dir)
    summaries = load(data_dir / "seasons.json", []) or []
    seasons = []
    for summary in summaries:
        folder = data_dir / str(summary["season"])
        league = load(folder / "league.json", {}) or {}
        if league:
            seasons.append((folder, league))
    active = next(((folder, league) for folder, league in seasons if str(league.get("league_id")) == str(league_id)), None)
    if not active:
        raise ValueError(f"No saved data for league {league_id}; run python3 fetch_matchup_data.py first")
    folder, league = active
    sources = load(data_dir / "matchup_sources.json", {}) or {}
    week, week_source = current_week(league, sources.get("state") or {})
    history, referenced = [], set()
    for history_folder, history_league in seasons:
        weeks = [compact_week(load(history_folder / f"matchups_week_{number}.json", [])) for number in range(1, 19)]
        completed = int((history_league.get("settings") or {}).get("last_scored_leg") or 0)
        if str(history_league.get("season")) == str(league.get("season")):
            completed = min(completed, week - 1)
        completed = min(completed, regular_end(history_league))
        for rows in weeks:
            for row in rows:
                referenced.update(str(value) for value in row.get("starters") or [] if value and str(value) != "0")
                referenced.update((row.get("players_points") or {}).keys())
        history.append({"season": history_league["season"], "league_id": history_league["league_id"],
                        "scoring_settings": history_league.get("scoring_settings") or {},
                        "playoffWeekStart": (history_league.get("settings") or {}).get("playoff_week_start", 0),
                        "lastCompletedWeek": max(0, completed), "weeks": weeks})
    rosters = load(folder / "rosters.json", []) or []
    for roster in rosters:
        referenced.update(str(value) for value in roster.get("players") or [] if value)
        referenced.update(str(value) for value in roster.get("starters") or [] if value and str(value) != "0")
    raw_players = load(data_dir / "players.json", {}) or {}
    players = {}
    for player_id in sorted(referenced):
        metadata = raw_players.get(player_id) or {}
        name = metadata.get("full_name") or " ".join(filter(None, (metadata.get("first_name"), metadata.get("last_name"))))
        if name or metadata.get("position"):
            players[player_id] = player_metadata(player_id, metadata)
    schedule = load(data_dir / "nfl_schedule.json", {}) or {}
    games = schedule.get("games", []) if str(schedule.get("season")) == str(league["season"]) else []
    users = load(folder / "users.json", []) or []
    snapshot = {
        "league": {key: league.get(key) for key in ("season", "league_id", "name", "status", "total_rosters", "roster_positions", "settings", "scoring_settings")},
        "users": [{key: user.get(key) for key in ("user_id", "display_name", "username")} for user in users],
        "rosters": [{key: roster.get(key) for key in ("roster_id", "owner_id", "starters", "players", "reserve", "taxi")} for roster in rosters],
        "weeks": [compact_week(load(folder / f"matchups_week_{number}.json", [])) for number in range(1, 19)],
        "history": history, "players": players, "currentWeek": week, "currentWeekSource": week_source,
        "schedule": games, "scheduleComplete": schedule_complete(games), "scheduleUpdatedAt": schedule.get("updatedAt"),
        "asOf": now_iso(), "sourceUpdatedAt": (sources.get("leagueUpdatedAt") or {}).get(str(league_id)),
        "playersUpdatedAt": sources.get("playersUpdatedAt"),
        "sources": {"sleeper": "https://docs.sleeper.com/", "schedule": "https://github.com/nflverse/nfldata/blob/master/data/games.csv"},
    }
    content = "// Public Sleeper fantasy inputs + NFL schedule. Generated by fetch_matchup_data.py.\nwindow.MATCHUP_DATA = "
    content += json.dumps(snapshot, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/") + ";\n"
    output = Path(output)
    temp = output.with_suffix(output.suffix + ".tmp")
    temp.write_text(content, encoding="utf-8")
    os.replace(temp, output)
    return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="export saved inputs without network requests")
    parser.add_argument("--league", default=DEFAULT_LEAGUE, help="Sleeper league ID (default: our league)")
    args = parser.parse_args()
    data_dir = ROOT / "data"
    data_dir.mkdir(exist_ok=True)
    if not args.offline:
        refresh(data_dir, args.league)
    snapshot = build_snapshot(data_dir, league_id=args.league)
    catalog = export_player_catalog(data_dir)
    print(f"Wrote forecast-players.js: {len(catalog['players'])} NFL players and defenses")
    print(f"Wrote matchup-data.js: {snapshot['league']['season']} week {snapshot['currentWeek']}, "
          f"{len(snapshot['players'])} players, {len(snapshot['schedule'])} NFL games, "
          f"complete bye schedule: {snapshot['scheduleComplete']}")


if __name__ == "__main__":
    main()
