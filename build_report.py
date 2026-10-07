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


def season_done(d):
    """Sleeper marks finished seasons 'complete'; ESPN data has no status (always finished)."""
    return d["league"].get("status", "complete") == "complete"


def playoff_roster_ids(d):
    """Roster ids that made the playoffs that season (none until the season is complete)."""
    if not season_done(d):
        return set()
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
    h2h = {k: defaultdict(lambda: [0, 0]) for k in ("reg", "po", "con")}
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
        final = next((m for m in d["bracket"] if m.get("p") == 1), None) if season_done(d) else None
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
                h2h["reg"][(win, lose)][0] += 1
                h2h["reg"][(lose, win)][1] += 1

        # ---- playoff / consolation games (head-to-head only) ----
        def add_h2h(kind, w_rid, l_rid, roster_owner=roster_owner):
            win, lose = roster_owner.get(w_rid), roster_owner.get(l_rid)
            if win and lose:
                h2h[kind][(win, lose)][0] += 1
                h2h[kind][(lose, win)][1] += 1

        if src == "Sleeper":
            for kind, bracket in (("po", d["bracket"]),
                                  ("con", load(folder / "losers_bracket.json", []) or [])):
                for m in bracket:
                    if isinstance(m.get("w"), int) and isinstance(m.get("l"), int):
                        add_h2h(kind, m["w"], m["l"])
        else:
            for week in range(playoff_start, 19):
                matchups = load(folder / f"matchups_week_{week}.json")
                if not matchups:
                    continue
                groups = defaultdict(list)
                for m in matchups:
                    if m.get("matchup_id") is not None:
                        groups[m["matchup_id"]].append(m)
                for pair in groups.values():
                    if len(pair) != 2 or pair[0].get("bracket") in (None, "NONE"):
                        continue
                    a, b = pair
                    pa_, pb_ = a.get("points") or 0, b.get("points") or 0
                    if pa_ == pb_:
                        continue
                    kind = "po" if a["bracket"] == "WINNERS_BRACKET" else "con"
                    if pa_ > pb_:
                        add_h2h(kind, a["roster_id"], b["roster_id"])
                    else:
                        add_h2h(kind, b["roster_id"], a["roster_id"])

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

    def grid(kind):
        rows = []
        for a in uids:
            row = [n(a)]
            for b in uids:
                if a == b:
                    row.append("-")
                    continue
                kinds = ("reg", "po", "con") if kind == "all" else (kind,)
                w = sum(h2h[k][(a, b)][0] for k in kinds)
                l = sum(h2h[k][(a, b)][1] for k in kinds)
                row.append(f"{w}-{l}" if (w or l) else "")
            rows.append(row)
        return table(headers, rows)

    modes = [("reg", "Regular season"), ("po", "Playoffs"), ("con", "Consolation"), ("all", "All games")]
    btns = "".join(f'<button class="mode{" on" if k == "reg" else ""}" data-m="{k}">{esc(t)}</button>'
                   for k, t in modes)
    grids = "".join(f'<div class="scroll h2h" data-m="{k}"{"" if k == "reg" else " hidden"}>{grid(k)}</div>'
                    for k, _ in modes)
    parts.append("<h2>Head-to-head</h2><p class=\"sub\">Row manager's record vs the column manager.</p>"
                 + f'<div class="toggle">{btns}</div>' + grids)

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
  .toggle {{ margin: 8px 0 12px; }}
  button.mode {{ padding: 6px 12px; margin-right: 6px; border: 1px solid var(--line); background: var(--head); color: var(--fg); border-radius: 6px; cursor: pointer; }}
  button.mode.on {{ background: var(--fg); color: var(--bg); }}
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
document.querySelectorAll('button.mode').forEach(b => b.addEventListener('click', () => {{
  document.querySelectorAll('button.mode').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.h2h').forEach(g => {{ g.hidden = g.dataset.m !== b.dataset.m; }});
}}));
const at = document.querySelector('#alltime');
if (at) {{ const th = at.tHead.rows[0].cells[3]; th.classList.add('desc'); th.dataset.asc = '0'; }}
</script>
</body></html>"""


PLAYERS_HTML = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Players</title>
<style>
  :root { --bg:#fff; --fg:#1a1a1a; --muted:#666; --line:#e2e2e2; --head:#f4f4f4; }
  @media (prefers-color-scheme: dark) { :root { --bg:#15171a; --fg:#e8e8e8; --muted:#9aa0a6; --line:#2c2f33; --head:#1f2226; } }
  body { font-family: -apple-system, system-ui, sans-serif; background:var(--bg); color:var(--fg); max-width:1200px; margin:0 auto; padding:24px 16px 64px; }
  nav a { margin-right: 14px; } .sub { color:var(--muted); }
  input { width:100%; max-width:420px; padding:8px 10px; font-size:16px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
  #list button { display:block; width:100%; max-width:420px; text-align:left; padding:8px 10px; border:1px solid var(--line); border-top:0; background:var(--head); color:var(--fg); cursor:pointer; font-size:14px; }
  table { border-collapse:collapse; width:100%; font-size:14px; } .scroll { overflow-x:auto; }
  th, td { padding:6px 10px; border-bottom:1px solid var(--line); text-align:left; white-space:nowrap; } th { background:var(--head); }
  small { color:var(--muted); font-weight:normal; }
</style></head><body>
<h1>Players</h1>
<nav>__NAV__</nav>
<p class="sub">Search any player who was ever on a roster in your Sleeper league. ESPN seasons aren't included yet.</p>
<input id="q" placeholder="Search a player, e.g. Mahomes" autocomplete="off">
<div id="list"></div><div id="out"></div>
<script>
const DATA = __DATA__;
const q = document.getElementById('q'), list = document.getElementById('list'), out = document.getElementById('out');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function show(i) {
  const [name, pos, tm, rows] = DATA[i];
  let h = `<h2>${esc(name)} <small>${esc(pos)} ${esc(tm)}</small></h2><div class="scroll"><table><thead><tr><th>Season</th><th>Manager</th><th>Record on roster</th><th>Record when started</th><th>Weeks rostered</th><th>Weeks started</th><th>Avg PPG</th><th>Playoffs</th><th>Champion</th></tr></thead><tbody>`;
  for (const r of rows) h += `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td><td>${r[6] === null ? '–' : r[6]}</td><td>${r[7] ? '✔' : ''}</td><td>${r[8] ? '🏆' : ''}</td></tr>`;
  out.innerHTML = h + '</tbody></table></div>';
  list.innerHTML = '';
}
q.addEventListener('input', () => {
  const t = q.value.trim().toLowerCase();
  list.innerHTML = '';
  if (t.length < 2) return;
  let n = 0;
  for (let i = 0; i < DATA.length && n < 10; i++) {
    if (DATA[i][0].toLowerCase().includes(t)) {
      const b = document.createElement('button');
      b.textContent = DATA[i][0] + (DATA[i][1] ? ' · ' + DATA[i][1] : '');
      b.onclick = () => { q.value = DATA[i][0]; show(i); };
      list.appendChild(b); n++;
    }
  }
});
</script></body></html>"""


def build_players_page(all_seasons, shown, canon, nav_html):
    """Per-player history from Sleeper weekly rosters (data/ + data/players.json)."""
    pdb = load(Path("data") / "players.json", {}) or {}
    stats, info = {}, {}
    for d in all_seasons:
        if d["src"] != "Sleeper":
            continue
        season, folder = d["season"], d["folder"]
        owner = {r["roster_id"]: canon.get(("Sleeper", r.get("owner_id"))) for r in d["rosters"]}
        final = next((m for m in d["bracket"] if m.get("p") == 1), None) if season_done(d) else None
        champ = final.get("w") if final else None
        po_ids = playoff_roster_ids(d)
        for r in d["rosters"]:
            st = r.get("settings", {})
            rec = f"{st.get('wins', 0)}-{st.get('losses', 0)}" + (f"-{st['ties']}" if st.get("ties") else "")
            info[(season, r["roster_id"])] = {"m": shown.get(owner.get(r["roster_id"]), "Unknown"), "rec": rec,
                                              "po": int(r["roster_id"] in po_ids), "ch": int(r["roster_id"] == champ)}
        start = d["league"].get("settings", {}).get("playoff_week_start", 15) or 15
        for week in range(1, 19):
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
                for me, opp in (pair, pair[::-1]):
                    mine, theirs = me.get("points") or 0, opp.get("points") or 0
                    if not (mine or theirs):
                        continue  # week hasn't been played yet
                    res = None
                    if week < start:
                        res = "w" if mine > theirs else "l" if mine < theirs else "t"
                    starters, pp = set(me.get("starters") or []), me.get("players_points") or {}
                    for pid in me.get("players") or []:
                        s = stats.setdefault((pid, season, me["roster_id"]),
                                             {"wk": 0, "st": 0, "pts": 0.0, "w": 0, "l": 0, "t": 0, "xw": 0, "xl": 0, "xt": 0})
                        s["wk"] += 1
                        if pid in starters:
                            s["st"] += 1
                            s["pts"] += pp.get(pid) or 0
                            if res:
                                s["x" + res] += 1
                        if res:
                            s[res] += 1
    by_player = defaultdict(list)
    for (pid, season, rid), s in stats.items():
        t = info.get((season, rid))
        if t:
            wl = f"{s['w']}-{s['l']}" + (f"-{s['t']}" if s["t"] else "")
            xl = f"{s['xw']}-{s['xl']}" + (f"-{s['xt']}" if s["xt"] else "")
            ppg = round(s["pts"] / s["st"], 1) if s["st"] else None
            by_player[pid].append([season, t["m"], wl, xl, s["wk"], s["st"], ppg, t["po"], t["ch"]])
    out = []
    for pid, rows in by_player.items():
        p = pdb.get(pid, {})
        name = p.get("full_name") or f"{p.get('first_name', '')} {p.get('last_name', '')}".strip() or str(pid)
        out.append([name, p.get("position") or "", p.get("team") or "", sorted(rows, key=lambda r: r[0])])
    out.sort(key=lambda x: x[0].lower())
    data = json.dumps(out).replace("</", "<\\/")
    return PLAYERS_HTML.replace("__NAV__", nav_html).replace("__DATA__", data)


def export_espn_js(all_seasons, shown, canon):
    """Write espn_league.js: ESPN seasons (managers matched to Sleeper ids) + real names, for index.html."""
    seasons = []
    for d in all_seasons:
        if d["src"] != "ESPN":
            continue
        rosters = [dict(r, owner_id=canon.get(("ESPN", r.get("owner_id")), r.get("owner_id"))) for r in d["rosters"]]
        owners = sorted({r["owner_id"] for r in rosters if r.get("owner_id")})
        weeks = [load(d["folder"] / f"matchups_week_{w}.json", []) or [] for w in range(1, 19)]
        seasons.append({"src": "ESPN", "league": dict(d["league"], status="complete"),
                        "users": [{"user_id": o, "display_name": shown.get(o, o)} for o in owners],
                        "rosters": rosters, "bracket": d["bracket"], "weeks": weeks})
    js = ("window.ESPN_SEASONS = " + json.dumps(seasons) + ";\nwindow.LEAGUE_NAMES = " + json.dumps(shown) + ";\n")
    Path("espn_league.js").write_text(js.replace("</", "<\\/"), encoding="utf-8")


def export_player_names_js(all_seasons):
    """Write player_names.js: {player_id: [name, position, team]} for every player who
    appeared on a roster in the Sleeper league, so index.html doesn't need Sleeper's
    full multi-megabyte player list."""
    pdb = load(Path("data") / "players.json", {}) or {}
    ids = set()
    for d in all_seasons:
        if d["src"] != "Sleeper":
            continue
        for week in range(1, 19):
            for m in load(d["folder"] / f"matchups_week_{week}.json", []) or []:
                ids.update(m.get("players") or [])
    out = {}
    for pid in ids:
        p = pdb.get(pid, {})
        name = p.get("full_name") or f"{p.get('first_name', '')} {p.get('last_name', '')}".strip() or pid
        out[pid] = [name, p.get("position") or "", p.get("team") or ""]
    js = "window.PLAYER_NAMES = " + json.dumps(out, separators=(",", ":")) + ";\n"
    Path("player_names.js").write_text(js.replace("</", "<\\/"), encoding="utf-8")


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
    if "Sleeper" in srcs:
        nav += ' <a href="players.html">Players</a>'
    for filename, include, title, _ in pages:
        Path(filename).write_text(
            build_page(include, all_seasons, shown, canon, title, nav), encoding="utf-8")
        print(f"Wrote {filename}")

    if "ESPN" in srcs:
        export_espn_js(all_seasons, shown, canon)
        print("Wrote espn_league.js")
    if "Sleeper" in srcs:
        export_player_names_js(all_seasons)
        print("Wrote player_names.js")
    if "Sleeper" in srcs:
        Path("players.html").write_text(build_players_page(all_seasons, shown, canon, nav), encoding="utf-8")
        print("Wrote players.html")

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
