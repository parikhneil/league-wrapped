"""
Download the full history of a Sleeper fantasy football league to local JSON files.

Usage:
    pip install requests
    python fetch_sleeper_history.py

Output (in ./data/):
    players.json                      - NFL player ID -> name/position/team (cached)
    seasons.json                      - list of season summaries, newest first
    {season}/league.json              - league settings and scoring
    {season}/users.json               - managers
    {season}/rosters.json             - rosters with season W/L/T and points
    {season}/matchups_week_{n}.json   - weekly matchups and scores
    {season}/transactions_week_{n}.json - trades, waivers, free agent moves
    {season}/drafts.json              - draft metadata
    {season}/draft_{draft_id}_picks.json - every pick in each draft
    {season}/winners_bracket.json     - playoff bracket (champion lives here)
    {season}/losers_bracket.json
"""

import json
import time
from pathlib import Path

import requests

LEAGUE_ID = "1381121078079795200"
BASE = "https://api.sleeper.app/v1"
DATA_DIR = Path("data")
MAX_WEEKS = 18          # regular season + playoffs; empty weeks are skipped
PAUSE = 0.15            # polite delay between calls (Sleeper asks to stay under ~1000 calls/min)


def get(path):
    """GET a Sleeper endpoint and return parsed JSON (or None on failure)."""
    url = f"{BASE}/{path}"
    for attempt in range(3):
        try:
            resp = requests.get(url, timeout=30)
            if resp.status_code == 200:
                time.sleep(PAUSE)
                return resp.json()
            print(f"  ! {resp.status_code} for {path}")
            return None
        except requests.RequestException as e:
            print(f"  ! error on {path}: {e} (retry {attempt + 1}/3)")
            time.sleep(1.5)
    return None


def save(obj, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)


def fetch_players():
    """Big file (~5MB+). Download once, reuse afterward."""
    out = DATA_DIR / "players.json"
    if out.exists():
        print("players.json already cached, skipping")
        return
    print("Downloading NFL player database (one time)...")
    players = get("players/nfl")
    if players:
        save(players, out)


def fetch_season(league_id):
    """Fetch everything for one season. Returns the league dict (for previous_league_id)."""
    league = get(f"league/{league_id}")
    if not league:
        return None

    season = league["season"]
    folder = DATA_DIR / season
    print(f"\n=== Season {season} (league {league_id}) ===")

    save(league, folder / "league.json")
    save(get(f"league/{league_id}/users"), folder / "users.json")
    save(get(f"league/{league_id}/rosters"), folder / "rosters.json")
    save(get(f"league/{league_id}/winners_bracket"), folder / "winners_bracket.json")
    save(get(f"league/{league_id}/losers_bracket"), folder / "losers_bracket.json")

    # Weekly matchups and transactions
    for week in range(1, MAX_WEEKS + 1):
        matchups = get(f"league/{league_id}/matchups/{week}")
        if matchups:
            save(matchups, folder / f"matchups_week_{week}.json")
        txns = get(f"league/{league_id}/transactions/{week}")
        if txns:
            save(txns, folder / f"transactions_week_{week}.json")
    print(f"  saved matchups/transactions for weeks 1-{MAX_WEEKS} (empty weeks skipped)")

    # Drafts and picks
    drafts = get(f"league/{league_id}/drafts") or []
    save(drafts, folder / "drafts.json")
    for d in drafts:
        picks = get(f"draft/{d['draft_id']}/picks")
        if picks:
            save(picks, folder / f"draft_{d['draft_id']}_picks.json")
    print(f"  saved {len(drafts)} draft(s)")

    return league


def main():
    DATA_DIR.mkdir(exist_ok=True)
    fetch_players()

    seasons = []
    league_id = LEAGUE_ID
    # Walk backward through previous_league_id until the chain ends
    while league_id and league_id != "0":
        league = fetch_season(league_id)
        if not league:
            break
        seasons.append({
            "season": league["season"],
            "league_id": league["league_id"],
            "name": league.get("name"),
            "status": league.get("status"),
            "total_rosters": league.get("total_rosters"),
        })
        league_id = league.get("previous_league_id")

    save(seasons, DATA_DIR / "seasons.json")
    print(f"\nDone. Fetched {len(seasons)} season(s): "
          f"{', '.join(s['season'] for s in seasons)}")


if __name__ == "__main__":
    main()
