"""
Download an ESPN fantasy football league's history and save it in the same
JSON shape as the Sleeper files, so the report script can read both.

Setup:
    pip3 install espn-api

Put your ESPN cookies in espn_secrets.json (the script creates a blank one
the first time you run it), then run:
    python3 fetch_espn_history.py

Output goes to ./data_espn/ (same layout as ./data/ from the Sleeper script).

espn_secrets.json is listed in .gitignore. Never commit it: the cookies
work like a password for your ESPN login.
"""

import json
from pathlib import Path
from urllib.parse import unquote

from espn_api.football import League

LEAGUE_ID = 1706900528
YEARS = [2024]
OUT = Path("data_espn")
SECRETS = Path("espn_secrets.json")


def load_secrets():
    """Read the ESPN login cookies from espn_secrets.json (kept out of git)."""
    if not SECRETS.exists():
        SECRETS.write_text(json.dumps({"espn_s2": "PASTE_ESPN_S2_HERE",
                                       "swid": "{PASTE-SWID-HERE}"}, indent=2))
        raise SystemExit(f"Created {SECRETS}. Open it, paste your espn_s2 and SWID cookie values, "
                         "save, and run this script again.")
    data = json.loads(SECRETS.read_text())
    s2, swid = data.get("espn_s2", ""), data.get("swid", "")
    if not s2 or not swid or "PASTE" in s2 or "PASTE" in swid:
        raise SystemExit(f"Fill in espn_s2 and swid in {SECRETS} first.")
    return s2, swid


ESPN_S2, SWID = "", ""


def save(obj, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)


def owner_info(team):
    """Return (owner_id, display_name) for a team, handling different library versions."""
    owners = getattr(team, "owners", None) or []
    if owners:
        o = owners[0]
        if isinstance(o, dict):
            uid = o.get("id") or team.team_name
            name = (o.get("displayName")
                    or f"{o.get('firstName', '')} {o.get('lastName', '')}".strip()
                    or team.team_name)
            return str(uid), name
        return str(o), str(o)
    return team.team_name, team.team_name


def full_name(team):
    owners = getattr(team, "owners", None) or []
    if owners and isinstance(owners[0], dict):
        o = owners[0]
        return f"{o.get('firstName', '')} {o.get('lastName', '')}".strip()
    return ""


def split_points(x):
    whole = int(x)
    return whole, int(round((x - whole) * 100))


def fetch_year(year):
    print(f"\n=== ESPN {year} ===")
    try:
        league = League(league_id=LEAGUE_ID, year=year, espn_s2=ESPN_S2, swid=SWID)
    except Exception:
        # Some setups need the URL-decoded cookie value; try that before giving up
        league = League(league_id=LEAGUE_ID, year=year, espn_s2=unquote(ESPN_S2), swid=SWID)
    folder = OUT / str(year)

    reg_weeks = getattr(league.settings, "reg_season_count", 13)

    # Which teams made the playoffs: seeds 1..playoff_team_count
    playoff_n = getattr(league.settings, "playoff_team_count", 0) or 0
    playoff_ids = []
    if playoff_n:
        playoff_ids = [t.team_id for t in league.teams
                       if 0 < (getattr(t, "standing", 0) or 0) <= playoff_n]
    print(f"  playoff spots: {playoff_n}, playoff teams found: {len(playoff_ids)}")

    save({
        "league_id": str(LEAGUE_ID),
        "season": str(year),
        "name": getattr(league.settings, "name", "ESPN League"),
        "settings": {"playoff_week_start": reg_weeks + 1},
        "playoff_roster_ids": playoff_ids,
        "previous_league_id": None,
        "source": "espn",
    }, folder / "league.json")

    users, rosters = [], []
    champ_id = runner_id = None
    for team in league.teams:
        uid, name = owner_info(team)
        users.append({"user_id": uid, "display_name": name, "full_name": full_name(team),
                      "metadata": {"team_name": team.team_name}})
        fpts, fpts_dec = split_points(team.points_for)
        fpa, fpa_dec = split_points(team.points_against)
        rosters.append({
            "roster_id": team.team_id,
            "owner_id": uid,
            "settings": {
                "wins": team.wins, "losses": team.losses, "ties": team.ties,
                "fpts": fpts, "fpts_decimal": fpts_dec,
                "fpts_against": fpa, "fpts_against_decimal": fpa_dec,
            },
        })
        if getattr(team, "final_standing", None) == 1:
            champ_id = team.team_id
        elif getattr(team, "final_standing", None) == 2:
            runner_id = team.team_id

    save(users, folder / "users.json")
    save(rosters, folder / "rosters.json")

    bracket = []
    if champ_id:
        bracket.append({"r": 1, "m": 1, "t1": champ_id, "t2": runner_id,
                        "w": champ_id, "l": runner_id, "p": 1})
    save(bracket, folder / "winners_bracket.json")
    save([], folder / "losers_bracket.json")

    # Weekly regular-season matchups
    for week in range(1, 18):  # regular season plus playoff weeks; empty weeks are skipped
        try:
            boxes = league.box_scores(week)
        except Exception as e:
            print(f"  ! couldn't load week {week}: {e}")
            continue
        matchups = []
        for i, b in enumerate(boxes, 1):
            for side in ("home", "away"):
                team = getattr(b, f"{side}_team", None)
                score = getattr(b, f"{side}_score", 0)
                if team is None or isinstance(team, int):  # bye week
                    continue
                matchups.append({"roster_id": team.team_id, "matchup_id": i, "points": score,
                                 "bracket": str(getattr(b, "matchup_type", "NONE"))})
        if matchups:
            save(matchups, folder / f"matchups_week_{week}.json")
    print(f"  saved {len(league.teams)} teams (regular season = weeks 1-{reg_weeks}, plus any playoff weeks found)")
    return {"season": str(year), "league_id": str(LEAGUE_ID),
            "name": getattr(league.settings, "name", "ESPN League"),
            "status": "complete", "total_rosters": len(league.teams)}


def main():
    global ESPN_S2, SWID
    ESPN_S2, SWID = load_secrets()
    seasons = []
    for year in sorted(YEARS, reverse=True):
        try:
            seasons.append(fetch_year(year))
        except Exception as e:
            print(f"  ! failed for {year}: {e}")
    save(seasons, OUT / "seasons.json")
    print(f"\nDone. Fetched {len(seasons)} season(s).")


if __name__ == "__main__":
    main()
