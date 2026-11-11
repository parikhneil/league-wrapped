/* Power-rankings analyzer: turns the hand-written weekly lists in
 * power-rankings-data.js into per-manager rank series and summary stats.
 * Movement is computed from the rank order, never from hand-typed +/- labels. */
(function (root) {
  "use strict";
  const label = (w) => w.label || `Week ${w.week}`;

  function analyze(data) {
    const weeks = [...(data?.weeks || [])].sort((a, b) => a.week - b.week);
    const managers = [
      ...new Set(weeks.flatMap((w) => w.entries.map((e) => e[0]))),
    ];
    const ranks = Object.fromEntries(managers.map((m) => [m, []]));
    // Every manager's series, with null for a week they were not listed.
    weeks.forEach((w, i) => {
      for (const m of managers) {
        const j = w.entries.findIndex((e) => e[0] === m);
        ranks[m][i] = j < 0 ? null : j + 1;
      }
    });
    const lists = weeks.map((w, i) =>
      w.entries.map(([manager, record], j) => {
        const rank = j + 1;
        const prev = i ? ranks[manager][i - 1] : null;
        return {
          rank,
          manager,
          record: record || "",
          move: prev == null ? null : prev - rank,
        };
      }),
    );
    const last = weeks.length - 1;
    const summary = managers.map((m) => {
      const r = ranks[m].filter((x) => x != null);
      let rise = null,
        fall = null;
      ranks[m].forEach((x, i) => {
        const p = ranks[m][i - 1];
        if (i && x != null && p != null) {
          const d = p - x;
          if (rise === null || d > rise.by) rise = { by: d, week: label(weeks[i]) };
          if (fall === null || d < fall.by) fall = { by: d, week: label(weeks[i]) };
        }
      });
      let streak = 0;
      for (let i = last; i >= 0 && ranks[m][i] === ranks[m][last]; i--) streak++;
      return {
        manager: m,
        current: ranks[m][last],
        currentStreak: streak,
        first: r.filter((x) => x === 1).length,
        top3: r.filter((x) => x <= 3).length,
        last: r.filter((x) => x === Math.max(...lists.flat().map((e) => e.rank))).length,
        best: r.length ? Math.min(...r) : null,
        worst: r.length ? Math.max(...r) : null,
        avg: r.length ? r.reduce((a, b) => a + b, 0) / r.length : null,
        rise,
        fall,
      };
    });
    summary.sort((a, b) => (a.current ?? 99) - (b.current ?? 99));
    return {
      weeks: weeks.map((w) => ({ week: w.week, label: label(w) })),
      managers,
      ranks,
      lists,
      summary,
      size: Math.max(0, ...weeks.map((w) => w.entries.length)),
    };
  }

  const api = { analyze };
  if (typeof module !== "undefined") module.exports = api;
  root.PowerRankings = api;
})(typeof window !== "undefined" ? window : globalThis);
