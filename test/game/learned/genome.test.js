import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGenome, clampGenome, mutateGenome, gaussian, genomeModuleSource,
} from '../../../lib/game/learned/genome.js';
import { mulberry32 } from '../../../lib/game/rng.js';

const SPEC = [
  { key: 'a', min: -1, max: 1, init: 0 },
  { key: 'b', min: 0, max: 10, init: 5 },
];

test('makeGenome starts every key at its init', () => {
  assert.deepEqual(makeGenome(SPEC), { a: 0, b: 5 });
});

test('clampGenome holds values inside [min,max] and fills missing keys', () => {
  assert.deepEqual(clampGenome(SPEC, { a: 7 }), { a: 1, b: 5 });
  assert.deepEqual(clampGenome(SPEC, { a: -3, b: -2 }), { a: -1, b: 0 });
  assert.deepEqual(clampGenome(SPEC, null), { a: 0, b: 5 });
  // Keys the spec has never heard of do not survive into the clamp.
  assert.deepEqual(clampGenome(SPEC, { a: 0.5, junk: 99 }), { a: 0.5, b: 5 });
});

test('gaussian is deterministic for a seed and roughly standard', () => {
  const r1 = mulberry32(3);
  const r2 = mulberry32(3);
  assert.equal(gaussian(r1), gaussian(r2));
  const rand = mulberry32(4);
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += gaussian(rand);
  assert.ok(Math.abs(sum / 2000) < 0.1);
});

test('mutateGenome is deterministic for a seed and stays in range', () => {
  const base = makeGenome(SPEC);
  const g1 = mutateGenome(SPEC, base, mulberry32(9), 0.1);
  const g2 = mutateGenome(SPEC, base, mulberry32(9), 0.1);
  assert.deepEqual(g1, g2);
  assert.notDeepEqual(g1, base);
  const wild = mutateGenome(SPEC, base, mulberry32(10), 5);
  for (const p of SPEC) {
    assert.ok(wild[p.key] >= p.min && wild[p.key] <= p.max);
  }
});

test('genomeModuleSource emits a loadable ES module literal', () => {
  const src = genomeModuleSource('X_GENOME', { a: 1.5 }, { variant: '7' });
  assert.match(src, /^\/\/ GENERATED/);
  assert.match(src, /export const X_GENOME = /);
  assert.ok(src.includes('"a": 1.5'));
  assert.ok(src.includes('"variant": "7"'));
});
