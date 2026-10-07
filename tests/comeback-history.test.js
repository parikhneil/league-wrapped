const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../comeback-history');

function season(overrides = {}) {
  return {
    src: 'Sleeper',
    league: { season: '2025', league_id: '123456', status: 'complete', settings: { last_scored_leg: 1 } },
    rosters: [{ roster_id: 1, owner_id: 'alice' }, { roster_id: 2, owner_id: 'bob' }],
    weeks: [[{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 99 }]],
    comebackHistory: { version: 1, season: '2025', league_id: '123456', source: 'Sleeper public matchup API', snapshots: [] },
    ...overrides,
  };
}
function sample(points = [30, 60], extras = {}) {
  return { week: 1, matchup_id: 1, captured_at: '2025-09-07T19:00:00Z',
    teams: points.map((points, i) => ({ roster_id: i + 1, points })), ...extras };
}

test('records largest observed deficit only for the actual eventual winner', () => {
  const s = season();
  s.comebackHistory.snapshots.push(sample(), sample([45, 85], { captured_at: '2025-09-07T22:00:00Z' }));
  const d = analyze([s]);
  assert.equal(d.comebacks.length, 1);
  assert.equal(d.comebacks[0].maxDeficit, 40);
  assert.equal(d.comebacks[0].winnerUid, 'alice');
  assert.equal(d.comebacks[0].winnerPoints, 100);
  assert.equal(d.comebacks[0].lowestWinProbability, null);
  assert.equal(d.comebacks[0].samples, 2);
  assert.equal(d.coverage.sampledMatchups, 1);
});

test('source-labelled fantasy probabilities record a 1% comeback without inventing odds', () => {
  const s = season(), snap = sample([60, 50], { probability_kind: 'fantasy_matchup', probability_source: 'Imported original fantasy provider' });
  snap.teams[0].win_probability = 0.01;
  snap.teams[1].win_probability = 0.99;
  s.comebackHistory.snapshots.push(snap);
  const d = analyze([s]);
  assert.equal(d.comebacks[0].lowestWinProbability, 0.01);
  assert.equal(d.comebacks[0].maxDeficit, 0);
  assert.equal(d.comebacks[0].probabilitySource, snap.probability_source);
  assert.equal(d.coverage.probabilityMatchups, 1);
});

test('NFL probabilities, unlabelled odds, invalid odds and mismatched pairs are excluded', () => {
  for (const kind of ['nfl_game', undefined, 'fantasy_matchup']) {
    const s = season(), snap = sample([30, 60], { probability_kind: kind });
    snap.teams[0].win_probability = 0.01;
    snap.teams[1].win_probability = 0.99;
    s.comebackHistory.snapshots.push(snap);
    assert.equal(analyze([s]).comebacks.length, 0);
  }
  const s = season();
  const wrongPair = sample(); wrongPair.teams[1].roster_id = 3;
  const invalidPoints = sample(); invalidPoints.teams[0].points = null;
  const wrongOdds = sample([30, 60], { probability_kind: 'fantasy_matchup', probability_source: 'Provider' });
  wrongOdds.teams[0].win_probability = 0.01; wrongOdds.teams[1].win_probability = 0.5;
  s.comebackHistory.snapshots.push(wrongPair, invalidPoints, wrongOdds);
  assert.equal(analyze([s]).coverage.rejectedSnapshots, 3);
});

test('snapshots from another league or season cannot attach to reused roster IDs', () => {
  for (const wrong of [{ league_id: 'other' }, { season: '2024' }, { version: 2 }]) {
    const s = season(); Object.assign(s.comebackHistory, wrong); s.comebackHistory.snapshots.push(sample());
    const d = analyze([s]); assert.equal(d.comebacks.length, 0); assert.equal(d.coverage.rejectedSnapshots, 1);
  }
});

test('pending matchups and ties never become comeback wins', () => {
  const pending = season(); pending.league.settings.last_scored_leg = 0; pending.comebackHistory.snapshots.push(sample());
  let d = analyze([pending]); assert.equal(d.comebacks.length, 0); assert.equal(d.coverage.pendingMatchups, 1);
  const tied = season(); tied.weeks[0][0].points = 99; tied.comebackHistory.snapshots.push(sample());
  d = analyze([tied]); assert.equal(d.comebacks.length, 0); assert.equal(d.coverage.sampledMatchups, 1);
});

test('duplicate samples do not inflate sample counts and conflicting timestamps are excluded', () => {
  const s = season(); s.comebackHistory.snapshots.push(sample(), sample());
  let d = analyze([s]); assert.equal(d.comebacks[0].samples, 1); assert.equal(d.coverage.duplicateSnapshots, 1);
  s.comebackHistory.snapshots.push(sample([10, 90])); d = analyze([s]);
  assert.equal(d.comebacks.length, 0); assert.equal(d.coverage.rejectedSnapshots, 2);
});

test('day boundary reconstruction keeps its method and checkpoint label', () => {
  const s = season(); s.comebackHistory.snapshots.push(sample([10, 70], { source: 'nflverse_game_day_reconstruction',
    method: 'reconstructed_day_boundary', checkpoint: 'Before 2025-09-08 first kickoff' }));
  const c = analyze([s]).comebacks[0];
  assert.equal(c.method, 'reconstructed_day_boundary'); assert.match(c.checkpoint, /first kickoff/);
  assert.equal(c.lowestWinProbability, null);
});

test('missing historical snapshots remain explicit missing coverage', () => {
  const s = season(); delete s.comebackHistory;
  const d = analyze([s]); assert.equal(d.comebacks.length, 0); assert.equal(d.coverage.completedMatchups, 1);
  assert.equal(d.coverage.sampledMatchups, 0); assert.equal(d.coverage.probabilityMatchups, 0);
});
