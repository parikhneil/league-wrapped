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

from fetch_nfl_opportunity import build_opportunity

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


def snapshot(all_seasons, shown, canon):
    """Normalize local platform data for the single shared JavaScript statistics engine."""
    pdb = load(Path("data") / "players.json", {}) or {}
    espn_players = {str(info['espn_id']): info for info in pdb.values() if info.get('espn_id')}
    nfl_ids = load(Path('data_nfl') / 'player_ids.json', {}) or {}
    sleeper_ids = load(Path('data_nfl') / 'sleeper_ids.json', {}) or {}
    seasons = []
    for d in all_seasons:
        folder, src = d["folder"], d["src"]
        weeks = [load(folder / f"matchups_week_{w}.json", []) or [] for w in range(1, 19)]
        picks = [p for draft in (load(folder / "drafts.json", []) or [])
                 for p in (load(folder / f"draft_{draft['draft_id']}_picks.json", []) or [])]
        transactions = [t for w in range(1, 19)
                        for t in (load(folder / f"transactions_week_{w}.json", []) or [])]
        player_ids = {pid for wk in weeks for m in wk for pid in (m.get("players") or [])}
        player_ids.update(p["player_id"] for p in picks)
        player_ids.update(pid for t in transactions for key in ("adds", "drops") for pid in (t.get(key) or {}))
        players = {}
        for pid in player_ids:
            info = pdb.get(pid, {}) if src == 'Sleeper' else espn_players.get(str(pid).removeprefix('espn:'), {})
            espn_id = str(info.get('espn_id') or (str(pid).removeprefix('espn:') if src == 'ESPN' else ''))
            nfl_info = sleeper_ids.get(str(pid), {}) if src == 'Sleeper' else nfl_ids.get(espn_id, {})
            players[pid] = {
                'name': info.get('full_name') or ' '.join(filter(None, [info.get('first_name'), info.get('last_name')])) or pid,
                'position': info.get('position') or nfl_info.get('position') or '',
                'fantasy_positions': info.get('fantasy_positions') or ([info['position']] if info.get('position') else []),
                'gsis_id': (nfl_info.get('gsis_id') or info.get('gsis_id') or '').strip() or None,
                'espn_id': espn_id or None,
                'team': info.get('team'),
            }
        if src == 'ESPN':
            for pid, info in (load(folder / 'players.json', {}) or {}).items():
                players[pid] = {**players.get(pid, {}), **info}
        rosters = [dict(r, owner_id=canon.get((src, r.get("owner_id")), r.get("owner_id"))) for r in d["rosters"]]
        owners = sorted({r["owner_id"] for r in rosters if r.get("owner_id")})
        league = dict(d["league"], status=d["league"].get("status", "complete"))
        opportunity = build_opportunity(league, weeks, players, load(Path('data_nfl') / f'{d["season"]}.json', {}))
        seasons.append({"src": src, "league": league,
                        "users": [{"user_id": u, "display_name": shown.get(u, u)} for u in owners],
                        "rosters": rosters, "bracket": d["bracket"], "weeks": weeks,
                        "losersBracket": load(folder / "losers_bracket.json", []) or [],
                        "picks": picks, "transactions": transactions, "players": players,
                        "detailCoverage": load(folder / 'detail_coverage.json', {}) or {},
                        "opportunity": opportunity,
                        "comebackHistory": load(folder / 'comeback_history.json', None)})
    return seasons


def build_page(include, seasons, title, nav_html):
    """Embed the shared engine and UI so saved reports also work without a server."""
    payload = json.dumps([s for s in seasons if s["src"] in include], separators=(",", ":")).replace("</", "<\\/")
    css = "\n".join(Path(f).read_text() for f in ("league.css", "chat-widget.css"))
    scripts = "\n".join(Path(f).read_text() for f in ("league-stats.js", "trade-analysis.js", "comeback-history.js", "league-ui.js"))
    chat_script = Path("chat-widget.js").read_text()
    return (f'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1"><title>{esc(title)}</title>'
            f'<style>{css}</style></head><body>'
            f'<header class="page-header"><h1>{esc(title)}</h1><div data-feature-nav></div></header>'
            f'<nav>{nav_html}</nav>'
            '<p class="sub">Saved snapshot. Active season results are provisional. <a href="index.html">Live dashboard</a></p>'
            f'<div id="out"></div><script>{scripts}</script><script>'
            f'LeagueUI.mount(document.getElementById("out"), {payload});</script>'
            f'<script>{chat_script}</script></body></html>')


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
    page = PLAYERS_HTML.replace("__NAV__", nav_html).replace("__DATA__", data)
    return page.replace("</head>", f'<style>{Path("chat-widget.css").read_text()}</style></head>').replace(
        "</body>", f'<script>{Path("chat-widget.js").read_text()}</script></body>')


def preserve_saved_espn(seasons, shown):
    """Keep published ESPN history when ignored raw data is absent on CI."""
    try:
        text = Path('espn_league.js').read_text()
        prefix = 'window.ESPN_SEASONS = '
        if not text.startswith(prefix):
            return seasons
        saved, _ = json.JSONDecoder().raw_decode(text[len(prefix):])
        present = {(s['src'], s['league']['season']) for s in seasons}
        for season in saved:
            key = (season['src'], season['league']['season'])
            if season['src'] != 'ESPN' or key in present:
                continue
            for user in season['users']:
                shown.setdefault(user['user_id'], user['display_name'])
            source = load(Path('data_nfl') / f"{season['league']['season']}.json", {})
            if source:
                season['opportunity'] = build_opportunity(season['league'], season['weeks'], season['players'], source)
            seasons.append(season)
            present.add(key)
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return sorted(seasons, key=lambda s: (s['league']['season'], s['src']))


def export_espn_js(all_seasons, shown, canon, normalized=None):
    """Write espn_league.js: ESPN seasons (managers matched to Sleeper ids) + real names, for index.html."""
    seasons = [s for s in (normalized if normalized is not None else snapshot(all_seasons, shown, canon)) if s["src"] == "ESPN"]
    js = ("window.ESPN_SEASONS = " + json.dumps(seasons) + ";\nwindow.LEAGUE_NAMES = " + json.dumps(shown) + ";\n")
    Path("espn_league.js").write_text(js.replace("</", "<\\/"), encoding="utf-8")


def main():
    all_seasons = load_all()
    if not all_seasons:
        print("No data found. Run fetch_sleeper_history.py (and/or fetch_espn_history.py) first.")
        return

    names, canon, unmatched, sleeper_names, aliases = resolve_identities(all_seasons)
    shown, unlisted = apply_real_names(names, aliases)
    srcs = sorted({d["src"] for d in all_seasons})
    if "ESPN" in srcs and "Sleeper" not in srcs:
        print("Sleeper data is missing. Run python3 fetch_sleeper_history.py first, then rebuild.")
        print("Reports were not overwritten: rebuilding with ESPN alone would remove Sleeper seasons and manager matches.")
        return

    seasons = preserve_saved_espn(snapshot(all_seasons, shown, canon), shown)
    srcs = sorted({s['src'] for s in seasons})
    Path("league-data.js").write_text("window.LEAGUE_SNAPSHOT = " + json.dumps(seasons, separators=(",", ":")).replace("</", "<\\/") + ";\n", encoding="utf-8")

    pages = [("report.html", set(srcs), "League History", "Combined")]
    if len(srcs) > 1:
        for s in srcs:
            pages.append((f"report_{s.lower()}.html", {s}, f"League History: {s}", s))

    nav = " ".join(f'<a href="{f}">{esc(label)}</a>' for f, _, _, label in pages)
    if "Sleeper" in srcs:
        nav += ' <a href="players.html">Players</a>'
        nav += ' <a href="matchups.html">Betting lines</a>'
    for filename, include, title, _ in pages:
        Path(filename).write_text(
            build_page(include, seasons, title, nav), encoding="utf-8")
        print(f"Wrote {filename}")

    if "ESPN" in srcs:
        export_espn_js(all_seasons, shown, canon, seasons)
        print("Wrote espn_league.js")
    if "Sleeper" in srcs:
        Path("players.html").write_text(build_players_page(all_seasons, shown, canon, nav), encoding="utf-8")
        print("Wrote players.html")

    if "Sleeper" in srcs:
        from fetch_matchup_data import build_snapshot, export_player_catalog
        try:
            build_snapshot()
            export_player_catalog()
            print("Wrote matchup-data.js (saved forecast inputs)")
            print("Wrote forecast-players.js (public NFL player metadata)")
        except ValueError as exc:
            print(f"Matchup snapshot skipped: {exc}")

    if unmatched:
        print("\nThese ESPN managers weren't matched to a Sleeper account, so they show up as")
        print("separate people in the combined report:")
        for u, why in sorted(unmatched.items()):
            print(f"  - {u}  ({why})")
        if any("looked for" in why for why in unmatched.values()):
            print("\nSleeper names I can see in your data:")
            print("  " + ", ".join(sleeper_names))
        print("\nUnmatched ESPN managers keep separate records. Add a mapping only when they are the same person.")
    if unlisted:
        print("\nShown by account name (no real name listed in REAL_NAMES): " + ", ".join(unlisted))
    print("\nOpen it with:  open report.html")


if __name__ == "__main__":
    main()
