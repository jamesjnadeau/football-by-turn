import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyTendencies, distanceBucket, situationKey, runSideOf,
  observationFromSnapshot, observePlay, readTendencies, tendenciesForState,
  serializeTendencies, parseTendencies,
} from '../../lib/game/tendencies.js';
import { captureSnapshot } from '../../lib/game/coach-log.js';
import { createGame, setPlan, setPass, SNAPPER_ID } from '../../lib/game/state.js';

/** `n` identical calls folded into a fresh set of counts. */
function counted(obs, n) {
  let counts = emptyTendencies();
  for (let i = 0; i < n; i++) counts = observePlay(counts, obs);
  return counts;
}

test('distance buckets are short, medium and long', () => {
  assert.equal(distanceBucket(1), 'short');
  assert.equal(distanceBucket(3), 'short');
  assert.equal(distanceBucket(4), 'medium');
  assert.equal(distanceBucket(7), 'medium');
  assert.equal(distanceBucket(8), 'long');
  assert.equal(distanceBucket(25), 'long');
  assert.equal(situationKey(3, 9), '3:long');
});

test('a snapshot with a throw in it is a pass, and it names the target', () => {
  const s = createGame({ seed: 1 });
  s.down = 3;
  s.toGoYard = s.losYard + 9;
  setPass(s, SNAPPER_ID, { x: 0, y: -1 }, 0.6, 'o-wr2');
  const obs = observationFromSnapshot(captureSnapshot(s, 'offense'));
  assert.deepEqual(obs, { down: 3, toGo: 9, call: 'pass', side: null, target: 'o-wr2' });
});

test('a snapshot with only arrows is a run, and the arrows say which way', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0.9, y: 0.44 }, 1);
  setPlan(s, 'o-rg', { x: 0.8, y: 0.6 }, 1);
  const obs = observationFromSnapshot(captureSnapshot(s, 'offense'));
  assert.equal(obs.call, 'run');
  assert.equal(obs.side, 'right');
  assert.equal(obs.target, null);

  const left = createGame({ seed: 1 });
  setPlan(left, 'o-rb', { x: -0.9, y: 0.44 }, 1);
  assert.equal(runSideOf(captureSnapshot(left, 'offense')), 'left');

  const up = createGame({ seed: 1 });
  setPlan(up, 'o-rb', { x: 0, y: 1 }, 1);
  assert.equal(runSideOf(captureSnapshot(up, 'offense')), 'middle');
});

test('observePlay is pure and files each count where it belongs', () => {
  const base = emptyTendencies();
  const after = observePlay(base, {
    down: 2, toGo: 8, call: 'run', side: 'right', target: null,
  });
  assert.deepEqual(base, emptyTendencies(), 'the old counts are untouched');
  assert.deepEqual(after.calls['2:long'], { run: 1, pass: 0 });
  assert.equal(after.sides.right, 1);
  assert.equal(after.plays, 1);

  const withPass = observePlay(after, {
    down: 2, toGo: 8, call: 'pass', side: null, target: 'o-wr1',
  });
  assert.deepEqual(withPass.calls['2:long'], { run: 1, pass: 1 });
  assert.equal(withPass.sides.right, 1, 'a pass is not a run to anywhere');
  assert.equal(withPass.targets['o-wr1'], 1);
  assert.equal(withPass.plays, 2);
});

test('with no data every read is exactly neutral', () => {
  const t = readTendencies(emptyTendencies(), 1, 10);
  assert.equal(t.passRate, 0.5);
  assert.equal(t.runSide, 0);
  assert.equal(t.favorite, null);
  assert.equal(t.samples, 0);
});

test('smoothing means three plays barely move, and twenty move a lot', () => {
  const pass = { down: 3, toGo: 10, call: 'pass', side: null, target: 'o-wr1' };
  const few = readTendencies(counted(pass, 3), 3, 10);
  const many = readTendencies(counted(pass, 20), 3, 10);
  assert.ok(few.passRate > 0.5 && few.passRate < 0.66, `few: ${few.passRate}`);
  assert.ok(many.passRate > 0.8, `many: ${many.passRate}`);
  assert.ok(many.passRate < 1);
  assert.equal(few.samples, 3);
});

test('the read is per down and distance, not one number for the whole game', () => {
  const counts = counted({ down: 3, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 20);
  assert.ok(readTendencies(counts, 3, 10).passRate > 0.8, 'third and long: he throws');
  assert.equal(readTendencies(counts, 1, 10).passRate, 0.5, 'first and ten: no idea');
});

test('the run-side read leans toward the side the runs went to', () => {
  const right = counted({ down: 1, toGo: 10, call: 'run', side: 'right', target: null }, 20);
  assert.ok(readTendencies(right, 1, 10).runSide > 0.5);
  const left = counted({ down: 1, toGo: 10, call: 'run', side: 'left', target: null }, 20);
  assert.ok(readTendencies(left, 1, 10).runSide < -0.5);
  const middle = counted({ down: 1, toGo: 10, call: 'run', side: 'middle', target: null }, 20);
  assert.equal(readTendencies(middle, 1, 10).runSide, 0);
  // Never past the ends, however lopsided the sample.
  const wild = counted({ down: 1, toGo: 10, call: 'run', side: 'right', target: null }, 500);
  assert.ok(readTendencies(wild, 1, 10).runSide < 1);
});

test('the favorite receiver is the most-targeted one, with a growing edge', () => {
  let counts = counted({ down: 1, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 10);
  counts = observePlay(counts, { down: 1, toGo: 10, call: 'pass', side: null, target: 'o-wr2' });
  const t = readTendencies(counts, 1, 10);
  assert.equal(t.favorite.id, 'o-wr1');
  assert.ok(t.favorite.edge > 0.5 && t.favorite.edge < 1);
  const thin = readTendencies(
    counted({ down: 1, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 1), 1, 10,
  );
  assert.ok(thin.favorite.edge < 0.25, `one throw is not a habit: ${thin.favorite.edge}`);
});

test("tendenciesForState reads the state's own down and distance", () => {
  const s = createGame({ seed: 1 });
  assert.equal(tendenciesForState(s), null, 'a game with no history has no read');
  s.down = 3;
  s.toGoYard = s.losYard + 10;
  s.tendencyCounts = counted(
    { down: 3, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 20,
  );
  assert.ok(tendenciesForState(s).passRate > 0.8);
});

test('counts survive the round trip, and junk reads as no history at all', () => {
  const counts = counted({ down: 2, toGo: 4, call: 'run', side: 'left', target: null }, 3);
  assert.deepEqual(parseTendencies(serializeTendencies(counts)), counts);
  assert.deepEqual(parseTendencies(''), emptyTendencies());
  assert.deepEqual(parseTendencies('{not json'), emptyTendencies());
  assert.deepEqual(parseTendencies(JSON.stringify({ v: 99 })), emptyTendencies());
  assert.deepEqual(
    parseTendencies(JSON.stringify({ v: 1, calls: { '1:long': { run: 'x', pass: 1 } }, sides: {}, targets: {}, plays: 1 })),
    emptyTendencies(),
    'a count that is not a count is not half-loaded',
  );
});
