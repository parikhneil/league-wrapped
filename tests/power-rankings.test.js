const test = require("node:test");
const assert = require("node:assert");
const PowerRankings = require("../power-rankings.js");
const data = require("../power-rankings-data.js");

test("power rankings compute movement and summaries from the rank order", () => {
  const a = PowerRankings.analyze({
    weeks: [
      { week: 1, label: "Preseason", entries: [["A"], ["B"], ["C"]] },
      { week: 2, entries: [["C", "1-0"], ["A"], ["B"]] },
      { week: 3, entries: [["C"], ["B"], ["A"]] },
    ],
  });
  assert.deepEqual(a.ranks.C, [3, 1, 1]);
  assert.deepEqual(a.lists[0].map((e) => e.move), [null, null, null]);
  assert.deepEqual(a.lists[1].map((e) => e.move), [2, -1, -1]);
  const c = a.summary.find((s) => s.manager === "C");
  assert.equal(c.first, 2);
  assert.equal(c.last, 1);
  assert.equal(c.currentStreak, 2);
  assert.deepEqual(c.rise, { by: 2, week: "Week 2" });
  assert.equal(a.summary[0].manager, "C");
});

test("a manager missing from a week is unknown that week, not ranked", () => {
  const a = PowerRankings.analyze({
    weeks: [
      { week: 1, entries: [["A"], ["B"]] },
      { week: 2, entries: [["A"]] },
    ],
  });
  assert.deepEqual(a.ranks.B, [2, null]);
  assert.equal(a.summary.find((s) => s.manager === "B").current, null);
});

test("saved league rankings list every manager exactly once each week", () => {
  const managers = new Set(data.weeks[0].entries.map((e) => e[0]));
  for (const w of data.weeks) {
    const names = w.entries.map((e) => e[0]);
    assert.equal(new Set(names).size, names.length, `duplicate in week ${w.week}`);
    assert.deepEqual(new Set(names), managers, `roster mismatch in week ${w.week}`);
  }
});
