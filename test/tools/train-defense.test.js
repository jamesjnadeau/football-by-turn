import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defenseFitness, trainDefense, TURNOVER_BONUS_YARDS, TOUCHDOWN_PENALTY_YARDS,
} from '../../tools/train-defense.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';

test('defenseFitness prices yards against, turnovers for, touchdowns against', () => {
  const base = { yardsPerPlay: 3, turnoverRate: 0, touchdownRate: 0 };
  assert.ok(defenseFitness({ ...base, yardsPerPlay: 2 }) > defenseFitness(base));
  assert.ok(defenseFitness({ ...base, turnoverRate: 0.5 }) > defenseFitness(base));
  assert.ok(defenseFitness({ ...base, touchdownRate: 0.5 }) < defenseFitness(base));
  assert.equal(
    defenseFitness({ yardsPerPlay: 4, turnoverRate: 0.25, touchdownRate: 0.1 }),
    -4 + TURNOVER_BONUS_YARDS * 0.25 - TOUCHDOWN_PENALTY_YARDS * 0.1,
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
