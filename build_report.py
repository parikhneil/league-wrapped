"""
Build league history reports from the JSON files created by
fetch_sleeper_history.py (./data) and fetch_espn_history.py (./data_espn).

Usage (run in the same folder as the fetch scripts, after they have finished):
    python3 build_report.py
    open report.html

Creates:
    report.html          - Sleeper + ESPN combined (managers matched across leagues)
    report_sleeper.html  - Sleeper only
    report_espn.html     - ESPN only
"""

import html
import json
from collections import defaultdict
from pathlib import Path

SOURCES = [
    ("Sleeper", Path("data")),
    ("ESPN", Path("data_espn")),
]

# ESPN name (full name or display name, any capitalization) -> Sleeper username
ESPN_TO_SLEEPER = {
    "anirudh n": "anirudh0",
    "Ekaansh Agrawal": "eka416",
    "Koji Hamanaka": "SnakyDraky",
    "Abhi Singh": "AbhiS1ngh",
    "Alex Merceline": "wkeyalx",
    "Mayank Pandey": "DAEPICDUCKY",
    "Rafael Reyes": "rafarey1",
    "Safwan Hasan": "saffylaffy",
    "Sath S": "Goatkrith",
    "Shrev Kumar": "Shravu",
    "neil parikh": "neillll",
}


# Display-only: account names -> real names shown on the web page.
# Matching and data processing never use these. Keys are case-insensitive;
# both the Sleeper/ESPN account name and the ESPN full name can be listed.
REAL_NAMES = {
    "snakydraky": "Koji", "koji hamanaka": "Koji",
    "shravu": "Shravan", "shrev kumar": "Shravan",
    "goatkrith": "Sathkrith", "sath s": "Sathkrith",
    "neillll": "Neil", "neilll": "Neil", "neil parikh": "Neil",
    "anirudh0": "Ani", "anirudh n": "Ani",
    "rafarey1": "Rafael", "rafrey1": "Rafael", "rafael reyes": "Rafael",
    "eka416": "Ekaansh", "ekaansh agrawal": "Ekaansh",
    "saffylaffy": "Safwan", "safwan hasan": "Safwan",
    "abhis1ngh": "Abhi", "abhis1ingh": "Abhi", "abhi singh": "Abhi",
    "daepicducky": "Mayank", "mayank pandey": "Mayank",
    "wkeyalx": "Alex", "alex merceline": "Alex",
    "winston24": "Winston",
    "kaushal dabbiru": "Kaushal",
    "arnav11": "Arnav",
}


def esc(x):
    return html.escape(str(x))


def norm(x):
    return " ".join(str(x).lower().split())


def load(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def table(headers, rows, table_id=None):
    """cells can be plain values or (display_text, sort_value) tuples."""
    id_attr = f' id="{table_id}"' if table_id else ""
    out = [f'<table class="sortable"{id_attr}><thead><tr>']
    out += [f"<th>{esc(h)}</th>" for h in headers]
    out.append("</tr></thead><tbody>")
    for row in rows:
        out.append("<tr>")
        for c in row:
            if isinstance(c, tuple):
                text, val = c
                out.append(f'<td data-v="{esc(val)}">{esc(text)}</td>')
            else:
                out.append(f"<td>{esc(c)}</td>")
        out.append("</tr>")
    out.append("</tbody></table>")
    return "".join(out)


def pct(w, l, t):
    games = w + l + t
    return (w + 0.5 * t) / games if games else 0.0


def load_all():
    """Load every season from every source, oldest first."""
    out = []
    for src, root in SOURCES:
        for s in load(root / "seasons.json", []) or []:
            folder = root / s["season"]
            out.append({
                "src": src,
                "season": s["season"],
                "folder": folder,
                "league": load(folder / "league.json", {}) or {},
                "users": load(folder / "users.json", []) or [],
                "rosters": load(folder / "rosters.json", []) or [],
                "bracket": load(folder / "winners_bracket.json", []) or [],
            })
    out.sort(key=lambda d: (d["season"], d["src"] != "Sleeper"))
    return out


def resolve_identities(all_seasons):
    """Match ESPN managers to Sleeper accounts.

    Returns (names, canon, unmatched, sleeper_names):
      names:         canonical id -> display name
      canon:         (source, source_user_id) -> canonical id
      unmatched:     ESPN name -> reason it wasn't matched
      sleeper_names: Sleeper names found in the data (for troubleshooting)
    """
    # Sleeper's league data usually has display names but not login usernames,
    # so match the mapping against either one.
    lookup = {}
    names = {}
    aliases = defaultdict(set)   # canonical id -> every name we know for that person
    for d in all_seasons:
        if d["src"] != "Sleeper":
            continue
        for u in d["users"]:
            for key in (u.get("username"), u.get("display_name")):
                if key:
                    lookup[norm(key)] = u["user_id"]
                    aliases[u["user_id"]].add(norm(key))
            names[u["user_id"]] = u.get("display_name") or u["user_id"]

    espn_map = {norm(k): norm(v) for k, v in ESPN_TO_SLEEPER.items()}
    canon = {}
    unmatched = {}
    for d in all_seasons:
        for u in d["users"]:
            key = (d["src"], u["user_id"])
            if d["src"] == "Sleeper":
                canon[key] = u["user_id"]
                continue
            cands = [norm(u.get("full_name") or ""), norm(u.get("display_name") or "")]
            target = next((espn_map[c] for c in cands if c in espn_map), None)
            uid = lookup.get(target) if target else None
            if uid:
                canon[key] = uid
                aliases[uid].update(c for c in cands if c)
            else:
                shown = u.get("full_name") or u.get("display_name") or str(u["user_id"])
                cid = f"{d['src']}:{u['user_id']}"
                canon[key] = cid
                aliases[cid].update(c for c in cands if c)
                names.setdefault(cid, shown)
                if target:
                    unmatched[shown] = f"looked for Sleeper name '{target}' but didn't find it"
                else:
                    unmatched[shown] = "no entry in the ESPN_TO_SLEEPER list"
    sleeper_names = sorted({n for uid, n in names.items() if ":" not in str(uid)}, key=str.lower)
    return names, canon, unmatched, sleeper_names, aliases


def apply_real_names(names, aliases):
    """Display-only: swap account names for real names. Returns (shown, unlisted)."""
    real = {norm(k): v for k, v in REAL_NAMES.items()}
    shown, unlisted = dict(names), []
    for cid, nm in names.items():
        hit = next((real[a] for a in (set(aliases.get(cid, ())) | {norm(nm)}) if a in real), None)
        if hit:
            shown[cid] = hit
        else:
            unlisted.append(nm)
    return shown, sorted(unlisted, key=str.lower)


def playoff_roster_ids(d):
    """Roster ids that made the playoffs that season."""
    ids = d["league"].get("playoff_roster_ids")
    if ids:
        return set(ids)
    found = set()
    for m in d["bracket"]:
        for k in ("t1", "t2", "w", "l"):
            v = m.get(k)
            if isinstance(v, int) and not isinstance(v, bool):
                found.add(v)
    return found


def build_page(include, all_seasons, names, canon, title, nav_html):
    many = len(include) > 1
    alltime = defaultdict(lambda: {"w": 0, "l": 0, "t": 0, "pf": 0.0, "pa": 0.0,
                                   "seasons": 0, "titles": 0, "finals": 0, "playoffs": 0})
    season_sections, champ_rows = [], []
    scores = []   # (points, uid, label, week)
    games = []    # (margin, winner, loser, wpts, lpts, label, week)
    h2h = defaultdict(lambda: [0, 0])
    n = lambda uid: names.get(uid, "Unknown")
    used = []

    for d in all_seasons:
        if d["src"] not in include:
            continue
        src, season, folder = d["src"], d["season"], d["folder"]
        label = f"{season} ({src})" if many else season
        used.append(label)
        rosters = d["rosters"]

        def owner(r, src=src):
            oid = r.get("owner_id")
            return canon.get((src, oid)) if oid is not None else None

        roster_owner = {r["roster_id"]: owner(r) for r in rosters}

        # ---- standings ----
        rows = []
        for r in rosters:
            st = r.get("settings", {})
            w, l, t = st.get("wins", 0), st.get("losses", 0), st.get("ties", 0)
            pf = st.get("fpts", 0) + st.get("fpts_decimal", 0) / 100
            pa = st.get("fpts_against", 0) + st.get("fpts_against_decimal", 0) / 100
            uid = owner(r)
            rows.append((uid, w, l, t, pf, pa))
            if uid:
                a = alltime[uid]
                a["w"] += w; a["l"] += l; a["t"] += t
                a["pf"] += pf; a["pa"] += pa
                if w + l + t > 0:
                    a["seasons"] += 1
        rows.sort(key=lambda x: (-x[1], -x[4]))

        # ---- champion / runner-up ----
        final = next((m for m in d["bracket"] if m.get("p") == 1), None)
        champ = runner = None
        if final and final.get("w"):
            champ = roster_owner.get(final["w"])
            runner = roster_owner.get(final.get("l"))
            if champ:
                alltime[champ]["titles"] += 1
                alltime[champ]["finals"] += 1
            if runner:
                alltime[runner]["finals"] += 1
        for rid in playoff_roster_ids(d):
            po = roster_owner.get(rid)
            if po:
                alltime[po]["playoffs"] += 1
        top_seed = rows[0][0] if rows else None
        champ_rows.append((label, champ, runner, top_seed))

        season_rows = []
        for i, (uid, w, l, t, pf, pa) in enumerate(rows, 1):
            record = f"{w}-{l}" + (f"-{t}" if t else "")
            trophy = " 🏆" if uid and uid == champ else ""
            season_rows.append([i, (n(uid) + trophy, n(uid)), record, f"{pf:,.1f}", f"{pa:,.1f}"])
        season_sections.append((label, season_rows))

        # ---- weekly matchups (regular season only) ----
        playoff_start = d["league"].get("settings", {}).get("playoff_week_start", 15) or 15
        for week in range(1, playoff_start):
            matchups = load(folder / f"matchups_week_{week}.json")
            if not matchups:
                continue
            groups = defaultdict(list)
            for m in matchups:
                if m.get("matchup_id") is not None:
                    groups[m["matchup_id"]].append(m)
            for pair in groups.values():
                if len(pair) != 2:
                    continue
                a, b = pair
                pa_, pb_ = a.get("points") or 0, b.get("points") or 0
                if pa_ == 0 and pb_ == 0:
                    continue
                ua, ub = roster_owner.get(a["roster_id"]), roster_owner.get(b["roster_id"])
                if not ua or not ub:
                    continue
                scores.append((pa_, ua, label, week))
                scores.append((pb_, ub, label, week))
                if pa_ == pb_:
                    continue
                if pa_ > pb_:
                    win, lose, wp, lp = ua, ub, pa_, pb_
                else:
                    win, lose, wp, lp = ub, ua, pb_, pa_
                games.append((wp - lp, win, lose, wp, lp, label, week))
                h2h[(win, lose)][0] += 1
                h2h[(lose, win)][1] += 1

    parts = []

    rows = []
    for uid, a in alltime.items():
        gp = a["w"] + a["l"] + a["t"]
        wp = pct(a["w"], a["l"], a["t"])
        ppg = a["pf"] / gp if gp else 0.0
        papg = a["pa"] / gp if gp else 0.0
        rows.append([
            n(uid),
            a["seasons"],
            (f"{a['w']}-{a['l']}" + (f"-{a['t']}" if a["t"] else ""), a["w"]),
            (f"{wp * 100:.1f}%", f"{wp:.4f}"),
            (f"{ppg:,.2f}", f"{ppg:.4f}"),
            (f"{papg:,.2f}", f"{papg:.4f}"),
            (f"{a['pf']:,.1f}", a["pf"]),
            (f"{a['pa']:,.1f}", a["pa"]),
            a["playoffs"],
            a["titles"],
            a["finals"],
        ])
    rows.sort(key=lambda r: -float(r[3][1]))
    parts.append("<h2>All-time standings</h2>" + '<div class="scroll">' + table(
        ["Manager", "Seasons", "Record", "Win %", "PF/game", "PA/game", "Points for", "Points against",
         "Playoffs", "Titles", "Finals"], rows, table_id="alltime") + "</div>")

    rows = [[s, n(c) if c else "-", n(r) if r else "-", n(t) if t else "-"]
            for s, c, r, t in champ_rows]
    parts.append("<h2>Champions by season</h2>" + table(
        ["Season", "Champion", "Runner-up", "Best regular-season record"], rows))

    def score_rows(lst):
        return [[f"{p:,.2f}", n(u), s, f"Week {w}"] for p, u, s, w in lst]

    top = sorted(scores, key=lambda x: -x[0])[:10]
    low = sorted(scores, key=lambda x: x[0])[:10]
    parts.append("<h2>Highest single-week scores</h2>" + table(["Points", "Manager", "Season", "Week"], score_rows(top)))
    parts.append("<h2>Lowest single-week scores</h2>" + table(["Points", "Manager", "Season", "Week"], score_rows(low)))

    def game_rows(lst):
        return [[f"{n(w)} {wp:,.2f} - {lp:,.2f} {n(l)}", f"{mg:,.2f}", s, f"Week {wk}"]
                for mg, w, l, wp, lp, s, wk in lst]

    blow = sorted(games, key=lambda x: -x[0])[:10]
    close = sorted(games, key=lambda x: x[0])[:10]
    parts.append("<h2>Biggest blowouts</h2>" + table(["Game", "Margin", "Season", "Week"], game_rows(blow)))
    parts.append("<h2>Closest games</h2>" + table(["Game", "Margin", "Season", "Week"], game_rows(close)))

    uids = sorted(alltime.keys(), key=lambda u: n(u).lower())
    headers = ["Manager"] + [n(u) for u in uids]
    rows = []
    for a in uids:
        row = [n(a)]
        for b in uids:
            if a == b:
                row.append("-")
            else:
                w, l = h2h[(a, b)]
                row.append(f"{w}-{l}" if (w or l) else "")
        rows.append(row)
    parts.append("<h2>Head-to-head (row manager's record vs column manager, regular season)</h2>"
                 + '<div class="scroll">' + table(headers, rows) + "</div>")

    parts.append("<h2>Season standings</h2>")
    for label, srows in reversed(season_sections):
        parts.append(f"<h3>{esc(label)}</h3>" + table(["#", "Manager", "Record", "PF", "PA"], srows))

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<style>
  :root {{ --bg:#fff; --fg:#1a1a1a; --muted:#666; --line:#e2e2e2; --head:#f4f4f4; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --bg:#15171a; --fg:#e8e8e8; --muted:#9aa0a6; --line:#2c2f33; --head:#1f2226; }}
  }}
  body {{ font-family: -apple-system, system-ui, sans-serif; background:var(--bg); color:var(--fg);
         max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }}
  h1 {{ margin-bottom: 4px; }} .sub {{ color:var(--muted); margin-top:0; }}
  nav {{ margin: 12px 0 8px; }} nav a {{ margin-right: 14px; }}
  h2 {{ margin-top: 40px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }}
  table {{ border-collapse: collapse; width: 100%; font-size: 14px; }}
  th, td {{ padding: 6px 10px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }}
  th {{ background: var(--head); cursor: pointer; user-select: none; }}
  th::after {{ content: ' ↕'; opacity: .35; font-size: .85em; }}
  th.asc::after {{ content: ' ▲'; opacity: 1; }}
  th.desc::after {{ content: ' ▼'; opacity: 1; }}
  .scroll {{ overflow-x: auto; }}
</style></head><body>
<h1>{esc(title)}</h1>
<nav>{nav_html}</nav>
<p class="sub">Seasons: {esc(', '.join(used))}. Click a column header to sort.</p>
{''.join(parts)}
<script>
document.querySelectorAll('table.sortable').forEach(table => {{
  const ths = [...table.tHead.rows[0].cells];
  ths.forEach((th, i) => {{
    th.addEventListener('click', () => {{
      const tb = table.tBodies[0];
      const rows = [...tb.rows];
      const asc = th.dataset.asc !== '1';
      ths.forEach(t => {{ t.classList.remove('asc', 'desc'); delete t.dataset.asc; }});
      th.dataset.asc = asc ? '1' : '0';
      th.classList.add(asc ? 'asc' : 'desc');
      rows.sort((a, b) => {{
        const x = a.cells[i].dataset.v ?? a.cells[i].textContent;
        const y = b.cells[i].dataset.v ?? b.cells[i].textContent;
        const nx = parseFloat(x), ny = parseFloat(y);
        const c = (!isNaN(nx) && !isNaN(ny)) ? nx - ny : x.localeCompare(y);
        return asc ? c : -c;
      }});
      rows.forEach(r => tb.appendChild(r));
    }});
  }});
}});
const at = document.querySelector('#alltime');
if (at) {{ const th = at.tHead.rows[0].cells[3]; th.classList.add('desc'); th.dataset.asc = '0'; }}
</script>
</body></html>"""


def main():
    all_seasons = load_all()
    if not all_seasons:
        print("No data found. Run fetch_sleeper_history.py (and/or fetch_espn_history.py) first.")
        return

    names, canon, unmatched, sleeper_names, aliases = resolve_identities(all_seasons)
    shown, unlisted = apply_real_names(names, aliases)
    srcs = sorted({d["src"] for d in all_seasons})

    pages = [("report.html", set(srcs), "League History", "Combined")]
    if len(srcs) > 1:
        for s in srcs:
            pages.append((f"report_{s.lower()}.html", {s}, f"League History: {s}", s))

    nav = " ".join(f'<a href="{f}">{esc(label)}</a>' for f, _, _, label in pages)
    for filename, include, title, _ in pages:
        Path(filename).write_text(
            build_page(include, all_seasons, shown, canon, title, nav), encoding="utf-8")
        print(f"Wrote {filename}")

    if unmatched:
        print("\nThese ESPN managers weren't matched to a Sleeper account, so they show up as")
        print("separate people in the combined report:")
        for u, why in sorted(unmatched.items()):
            print(f"  - {u}  ({why})")
        if any("looked for" in why for why in unmatched.values()):
            print("\nSleeper names I can see in your data:")
            print("  " + ", ".join(sleeper_names))
        print("\nPaste all of this to Claude and it will fix the name matches.")
    if unlisted:
        print("\nShown by account name (no real name listed in REAL_NAMES): " + ", ".join(unlisted))
    print("\nOpen it with:  open report.html")


if __name__ == "__main__":
    main()
