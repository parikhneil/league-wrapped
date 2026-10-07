"""Print who the report counts as a playoff team in each season.

Run from the sleeper folder (next to build_report.py):
    python3 show_playoffs.py
"""

from build_report import apply_real_names, load_all, playoff_roster_ids, resolve_identities

all_seasons = load_all()
names, canon, _, _, aliases = resolve_identities(all_seasons)
shown, _ = apply_real_names(names, aliases)

for d in all_seasons:
    src, season = d["src"], d["season"]
    owner = {r["roster_id"]: shown.get(canon.get((src, r.get("owner_id"))), "Unknown") for r in d["rosters"]}
    ids = playoff_roster_ids(d)
    final = next((m for m in d["bracket"] if m.get("p") == 1), None)
    champ = owner.get(final.get("w")) if final else None
    status = d["league"].get("status", "complete")
    print(f"\n{season} {src} (status: {status}) - {len(ids)} playoff teams, champion: {champ or '-'}")
    for rid in sorted(ids):
        print("   ", owner.get(rid, f"roster {rid}"))
