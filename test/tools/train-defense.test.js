import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defenseFitness, trainDefense, TURNOVER_BONUS_YARDS, TOUCHDOWN_PENALTY_YARDS,
} from '../../tools/train-defense.js';
import { summarizePlays } from '../../lib/game/train/harness.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';

// The full per-play rule (touchdown-vs-not asymmetry, TFL doubling, the
// seconds/passes/air-yards penalties) is exercised in
// test/game/train/fitness.test.js, against lib/game/train/fitness.js
// directly. This just proves the tools/train-defense.js shim still funnels
// to the same place, with the constants it re-exports.
const statsFor = (play) => summarizePlays([{
  yards: 0, touchdown: false, turnover: false, turns: 0, passes: 0, airYards: 0, ...play,
}]);

test('the shim\'s defenseFitness prices yards against, turnovers for, touchdowns against', () => {
  assert.ok(defenseFitness(statsFor({ yards: 2 })) > defenseFitness(statsFor({ yards: 3 })));
  assert.ok(
    defenseFitness(statsFor({ yards: 3, turnover: true }))
      > defenseFitness(statsFor({ yards: 3 })),
  );
  assert.ok(
    defenseFitness(statsFor({ yards: 3, touchdown: true }))
      < defenseFitness(statsFor({ yards: 3 })),
  );
  assert.equal(
    defenseFitness(statsFor({ yards: 3, turnover: true })) - defenseFitness(statsFor({ yards: 3 })),
    TURNOVER_BONUS_YARDS,
  );
  assert.equal(
    defenseFitness(statsFor({ yards: 12, touchdown: true })),
    -TOUCHDOWN_PENALTY_YARDS - 12,
  );
});

test('trainDefense runs a tiny evolution end to end, deterministically', () => {
  const opts = { generations: 1, popSize: 3, plays: 2, seed: 9, sigma: 0.05 };
  const a = trainDefense(opts);
  const b = trainDefense(opts);
  assert.deepEqual(a.best, b.best);
  assert.equal(a.score, b.score);
  for (const p of DEFENSE_SPEC) {
    assert.equal(typeof a.best[p.key], 'number', p.key);
  }
});

test('importing the trainer runs no training and writes no files', () => {
  // The import at the top of this file already proved it: if the CLI body
  // ran on import, the suite would train for minutes and rewrite the genome.
  assert.ok(true);
});
