import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evolve } from '../../tools/evolve.js';

const SPEC = [{ key: 'a', min: 0, max: 1, init: 0 }];
const peakAt = (target) => (g) => -((g.a - target) ** 2);

test('evolve climbs a one-dimensional hill', () => {
  const { best, score, history } = evolve({
    spec: SPEC,
    fitness: peakAt(0.7),
    popSize: 12,
    generations: 25,
    elite: 3,
    sigma: 0.15,
    seed: 4,
  });
  assert.ok(Math.abs(best.a - 0.7) < 0.1, `got ${best.a}`);
  assert.ok(score > -0.01);
  assert.equal(history.length, 25);
  // Champions never get worse than the first generation's.
  assert.ok(history[history.length - 1] >= history[0]);
});

test('evolve is deterministic for a seed', () => {
  const opts = {
    spec: SPEC, fitness: peakAt(0.3), popSize: 8, generations: 5,
    elite: 2, sigma: 0.2, seed: 9,
  };
  assert.deepEqual(evolve(opts), evolve(opts));
});

test("a seed genome is generation zero's starting point", () => {
  const seen = [];
  evolve({
    spec: SPEC,
    seedGenome: { a: 0.9 },
    fitness: (g) => { seen.push(g.a); return 0; },
    popSize: 4, generations: 1, elite: 1, sigma: 0.01, seed: 2,
  });
  assert.equal(seen[0], 0.9); // the seed itself is candidate one
  for (const a of seen.slice(1)) assert.ok(Math.abs(a - 0.9) < 0.2);
});

test('onGeneration sees the scored population, best first', () => {
  let calls = 0;
  evolve({
    spec: SPEC,
    fitness: peakAt(0.5),
    popSize: 6, generations: 3, elite: 2, sigma: 0.2, seed: 1,
    onGeneration: (gen, scored) => {
      calls += 1;
      assert.equal(scored.length, 6);
      for (let i = 1; i < scored.length; i++) {
        assert.ok(scored[i - 1].score >= scored[i].score);
      }
    },
  });
  assert.equal(calls, 3);
});
