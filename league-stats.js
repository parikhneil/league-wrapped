/* Shared calculations for live leagues, saved reports, and Node verification. */
(function (root) {
  "use strict";
  const fresh = () => ({
    w: 0,
    l: 0,
    t: 0,
    pf: 0,
    pa: 0,
    seasons: 0,
    po: 0,
    titles: 0,
    finals: 0,
    actual: 0,
    expected: 0,
    played: 0,
    apw: 0,
    apl: 0,
    apt: 0,
    streak: 0,
    bestStreak: 0,
  });
  const rate = (a) =>
    a.w + a.l + a.t ? (a.w + a.t / 2) / (a.w + a.l + a.t) : 0;
  function analyze(seasons, namesOverride = {}) {
    const D = {
      names: {},
      all: {},
      champs: [],
      scores: [],
      h2h: {},
      playoffH2h: {},
      consolationH2h: {},
      bySeason: [],
      weeks: [],
      games: [],
      drafts: [],
      moves: [],
      comebacks: [],
      sources: seasons,
    };
    const A = (u) => (D.all[u] ??= fresh());
    for (const s of seasons) {
      const L = s.league,
        label = `${L.season} (${s.src})`,
        owner = Object.fromEntries(
          s.rosters.map((r) => [r.roster_id, r.owner_id]),
        );
      s.users.forEach(
        (u) =>
          (D.names[u.user_id] =
            u.display_name || u.full_name || String(u.user_id)),
      );
      const done = L.status === "complete",
        start = L.settings?.playoff_week_start || 15;
      const cutoff = L.settings?.last_scored_leg ?? (done ? 18 : 0);
      const po = new Set(
        done
          ? L.playoff_roster_ids ||
            s.bracket.flatMap((m) =>
              ["t1", "t2", "w", "l"].map((k) => m[k]).filter(Number.isInteger),
            )
          : [],
      );
      const rows = s.rosters
        .filter((r) => r.owner_id)
        .map((r) => {
          const st = r.settings || {},
            a = A(r.owner_id),
            row = {
              uid: r.owner_id,
              w: st.wins || 0,
              l: st.losses || 0,
              t: st.ties || 0,
              pf: (st.fpts || 0) + (st.fpts_decimal || 0) / 100,
              pa: (st.fpts_against || 0) + (st.fpts_against_decimal || 0) / 100,
            };
          ["w", "l", "t", "pf", "pa"].forEach((k) => (a[k] += row[k]));
          if (row.w + row.l + row.t) a.seasons++;
          if (po.has(r.roster_id)) a.po++;
          return row;
        })
        .sort((a, b) => rate(b) - rate(a) || b.pf - a.pf);
      const fin = done ? s.bracket.find((m) => m.p === 1) : null,
        champ = owner[fin?.w],
        runner = owner[fin?.l];
      if (champ) {
        A(champ).titles++;
        A(champ).finals++;
      }
      if (runner) A(runner).finals++;
      D.champs.push({ season: label, champ, runner, top: rows[0]?.uid });
      D.bySeason.push({
        season: label,
        year: String(L.season),
        src: s.src,
        rows,
        champ,
        po: [...po].map((r) => owner[r]),
      });
      const cumulative = Object.fromEntries(
          rows.map((r) => [r.uid, { w: 0, l: 0, t: 0, pf: 0 }]),
        ),
        ranks = {},
        streaks = {};
      const rank = () =>
        Object.keys(cumulative).sort(
          (a, b) =>
            rate(cumulative[b]) - rate(cumulative[a]) ||
            cumulative[b].pf - cumulative[a].pf ||
            a.localeCompare(b),
        );
      (s.weeks || []).forEach((wk, i) => {
        const week = i + 1;
        if (
          week > cutoff ||
          week >= start ||
          !wk?.some((m) => Number(m.points) !== 0)
        )
          return;
        const teams = wk.filter(
            (m) => owner[m.roster_id] && m.matchup_id != null,
          ),
          groups = {};
        teams.forEach((m) => (groups[m.matchup_id] ??= []).push(m));
        const valid = Object.values(groups).filter((p) => p.length === 2),
          eligible = valid.flat();
        if (!eligible.length) return;
        const prev = week === 1 ? [] : rank(),
          games = [],
          scores = [];
        for (const me of eligible) {
          const uid = owner[me.roster_id],
            pts = Number(me.points) || 0,
            others = eligible.filter((x) => x.roster_id !== me.roster_id),
            a = A(uid);
          const wins = others.filter(
              (x) => pts > (Number(x.points) || 0),
            ).length,
            ties = others.filter((x) => pts === (Number(x.points) || 0)).length;
          a.apw += wins;
          a.apt += ties;
          a.apl += others.length - wins - ties;
          a.expected += (wins + ties / 2) / others.length;
          a.played++;
          scores.push({ uid, pts });
          D.scores.push([pts, uid, label, week]);
        }
        for (const [a, b] of valid) {
          const ua = owner[a.roster_id],
            ub = owner[b.roster_id],
            pa = Number(a.points) || 0,
            pb = Number(b.points) || 0;
          const winner = pa > pb ? ua : pb > pa ? ub : null,
            loser = winner === ua ? ub : winner === ub ? ua : null;
          const priorGap = winner
            ? rate(cumulative[loser]) - rate(cumulative[winner])
            : 0;
          const g = {
            season: label,
            week,
            a: ua,
            b: ub,
            pa,
            pb,
            winner,
            loser,
            margin: Math.abs(pa - pb),
            upset: week > 1 && winner && priorGap > 0 ? priorGap : 0,
          };
          games.push(g);
          D.games.push(g);
          for (const [u, v, p, q] of [
            [ua, ub, pa, pb],
            [ub, ua, pb, pa],
          ]) {
            const c = cumulative[u],
              total = A(u),
              r = ((D.h2h[u] ??= {})[v] ??= [0, 0, 0]);
            c.pf += p;
            const k = p > q ? "w" : p < q ? "l" : "t";
            c[k]++;
            r[k === "w" ? 0 : k === "l" ? 1 : 2]++;
            total.actual += k === "w" ? 1 : k === "t" ? 0.5 : 0;
            streaks[u] = k === "w" ? (streaks[u] || 0) + 1 : 0;
            total.bestStreak = Math.max(total.bestStreak, streaks[u]);
          }
        }
        const next = rank(),
          changes = next.map((uid, j) => ({
            uid,
            rank: j + 1,
            change: prev.length ? prev.indexOf(uid) - j : 0,
          }));
        next.forEach((u, j) => (ranks[u] ??= []).push(j + 1));
        D.weeks.push({ season: label, week, games, scores, changes });
      });
      const finalRanks = rank();
      for (const u of finalRanks) {
        if (ranks[u]?.length > 1)
          D.comebacks.push({
            uid: u,
            season: label,
            from: Math.max(...ranks[u]),
            to: finalRanks.indexOf(u) + 1,
            gain: Math.max(...ranks[u]) - finalRanks.indexOf(u) - 1,
          });
      }
      // Postseason recaps include bye scores, but never alter regular-season luck or ranks.
      (s.weeks || []).forEach((wk, i) => {
        if (
          i + 1 < start ||
          i + 1 > cutoff ||
          !wk?.some((m) => Number(m.points) !== 0)
        )
          return;
        const groups = {},
          scores = [];
        for (const m of wk) {
          if (!owner[m.roster_id]) continue;
          scores.push({ uid: owner[m.roster_id], pts: Number(m.points) || 0 });
          if (m.matchup_id != null) (groups[m.matchup_id] ??= []).push(m);
        }
        const games = Object.values(groups)
          .filter((p) => p.length === 2)
          .map(([a, b]) => {
            const pa = Number(a.points) || 0,
              pb = Number(b.points) || 0,
              ua = owner[a.roster_id],
              ub = owner[b.roster_id];
            return {
              season: label,
              week: i + 1,
              a: ua,
              b: ub,
              pa,
              pb,
              winner: pa > pb ? ua : pb > pa ? ub : null,
              loser: pa > pb ? ub : pb > pa ? ua : null,
              margin: Math.abs(pa - pb),
              upset: 0,
            };
          });
        if (scores.length)
          D.weeks.push({
            season: label,
            week: i + 1,
            games,
            scores,
            changes: [],
            postseason: true,
          });
      });
      const addBracket = (map, w, l) => {
        const a = owner[w],
          b = owner[l];
        if (!a || !b) return;
        ((map[a] ??= {})[b] ??= [0, 0, 0])[0]++;
        ((map[b] ??= {})[a] ??= [0, 0, 0])[1]++;
      };
      if (s.src === "Sleeper") {
        for (const m of s.bracket || [])
          if (Number.isInteger(m.w) && Number.isInteger(m.l))
            addBracket(D.playoffH2h, m.w, m.l);
        for (const m of s.losersBracket || [])
          if (Number.isInteger(m.w) && Number.isInteger(m.l))
            addBracket(D.consolationH2h, m.w, m.l);
      } else {
        (s.weeks || []).forEach((wk, i) => {
          if (i + 1 < start || i + 1 > cutoff) return;
          const groups = {};
          for (const m of wk || [])
            if (m.matchup_id != null) (groups[m.matchup_id] ??= []).push(m);
          for (const pair of Object.values(groups)) {
            if (pair.length !== 2) continue;
            const [a, b] = pair;
            if (!a.bracket || a.bracket === "NONE" || a.points === b.points)
              continue;
            addBracket(
              a.bracket === "WINNERS_BRACKET" ? D.playoffH2h : D.consolationH2h,
              a.points > b.points ? a.roster_id : b.roster_id,
              a.points > b.points ? b.roster_id : a.roster_id,
            );
          }
        });
      }
      const playerName = (pid, meta = {}) =>
        (s.players?.[pid]?.name !== pid ? s.players?.[pid]?.name : null) ||
        `${meta.first_name || ""} ${meta.last_name || ""}`.trim() ||
        String(pid);
      const contribution = (pid, rid, from = 1, to = cutoff) => {
        let pts = 0,
          starts = 0,
          rostered = 0;
        for (let w = from; w <= Math.min(to, cutoff); w++) {
          const m = s.weeks[w - 1]?.find((x) => x.roster_id === rid);
          if (!m || !s.weeks[w - 1]?.some((x) => Number(x.points) !== 0))
            continue;
          if (s.src === "ESPN" && !m.players_points)
            return { pts: null, starts: null, rostered: null };
          if (m.players?.includes(pid)) rostered++;
          if (m.starters?.includes(pid)) {
            starts++;
            pts += Number(m.players_points?.[pid]) || 0;
          }
        }
        return { pts, starts, rostered };
      };
      for (const p of s.picks || []) {
        const available =
          p.player_id_kind !== "local_placeholder" &&
          s.weeks.some((wk) => wk.some((m) => m.players_points));
        const v = available
          ? contribution(p.player_id, p.roster_id)
          : { pts: null, starts: null, rostered: null };
        D.drafts.push({
          season: label,
          src: s.src,
          uid: owner[p.roster_id],
          player: playerName(p.player_id, p.metadata),
          pos: p.metadata?.position || "",
          round: p.round,
          pick: p.pick_no,
          ...v,
        });
      }
      const transactions = (s.transactions || [])
        .filter((t) => t.status === "complete")
        .sort(
          (a, b) =>
            (a.status_updated || a.created) - (b.status_updated || b.created),
        );
      for (const t of transactions) {
        const when = t.status_updated || t.created,
          from = (Number(t.leg) || 1) + 1;
        const adds = Object.entries(t.adds || {}).map(([pid, rid]) => {
          const exit = transactions.find(
            (x) =>
              (x.status_updated || x.created) > when && x.drops?.[pid] === rid,
          );
          return {
            player: playerName(pid),
            uid: owner[rid],
            ...contribution(pid, rid, from, exit ? Number(exit.leg) : cutoff),
          };
        });
        D.moves.push({
          id: t.transaction_id,
          season: label,
          type: t.type,
          details_incomplete: t.details_incomplete || false,
          week: t.leg,
          date: when,
          adds,
          drops: Object.entries(t.drops || {}).map(([pid, rid]) => ({
            player: playerName(pid),
            uid: owner[rid],
          })),
          picks: t.draft_picks || [],
          budget: t.waiver_budget || [],
        });
      }
    }
    Object.assign(D.names, namesOverride);
    for (const d of D.drafts) {
      const peers = D.drafts.filter(
        (x) => x.season === d.season && x.round === d.round && x.pts !== null,
      );
      d.value =
        d.pts === null || !peers.length
          ? null
          : d.pts - peers.reduce((sum, x) => sum + x.pts, 0) / peers.length;
    }
    D.rivalries = [];
    const ids = Object.keys(D.all);
    ids.forEach((a, i) =>
      ids.slice(i + 1).forEach((b) => {
        const r = D.h2h[a]?.[b];
        if (r) {
          D.rivalries.push({
            a,
            b,
            w: r[0],
            l: r[1],
            t: r[2],
            games: r.reduce((x, y) => x + y, 0),
            balance: Math.abs(r[0] - r[1]),
          });
        }
      }),
    );
    return D;
  }
  const api = { analyze, rate };
  if (typeof module !== "undefined") module.exports = api;
  root.LeagueStats = api;
})(typeof window !== "undefined" ? window : globalThis);
