import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coevolve, offenseFitness, TD_BONUS_YARDS, TURNOVER_PENALTY_YARDS,
} from '../../tools/coevolve.js';
import { OFFENSE_SPEC } from '../../lib/game/learned/offense-spec.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { makeGenome } from '../../lib/game/learned/genome.js';

test('offenseFitness prices yards for, touchdowns for, turnovers against', () => {
  const base = { yardsPerPlay: 3, turnoverRate: 0, touchdownRate: 0 };
  assert.ok(offenseFitness({ ...base, yardsPerPlay: 5 }) > offenseFitness(base));
  assert.ok(offenseFitness({ ...base, touchdownRate: 0.5 }) > offenseFitness(base));
  assert.ok(offenseFitness({ ...base, turnoverRate: 0.5 }) < offenseFitness(base));
  assert.equal(
    offenseFitness({ yardsPerPlay: 4, turnoverRate: 0.25, touchdownRate: 0.1 }),
    4 + TD_BONUS_YARDS * 0.1 - TURNOVER_PENALTY_YARDS * 0.25,
  );
});

test('a tiny co-evolution runs end to end, deterministically', () => {
  const opts = {
    offSeed: makeGenome(OFFENSE_SPEC),
    defSeed: makeGenome(DEFENSE_SPEC),
    popSize: 3, generations: 2, elite: 1, sigma: 0.05,
    plays: 2, hof: 1, seed: 5,
  };
  const a = coevolve(opts);
  const b = coevolve(opts);
  assert.deepEqual(a, b);
  for (const p of OFFENSE_SPEC) assert.equal(typeof a.offense[p.key], 'number', p.key);
  for (const p of DEFENSE_SPEC) assert.equal(typeof a.defense[p.key], 'number', p.key);
  assert.equal(a.history.length, 2);
  assert.equal(typeof a.history[0].offense, 'number');
  assert.equal(typeof a.history[0].defense, 'number');
});
