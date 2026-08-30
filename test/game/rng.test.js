import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../lib/game/rng.js';

test('same seed, same sequence', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});

test('values are in [0, 1) and different seeds diverge', () => {
  const r = mulberry32(1), s = mulberry32(2);
  const rs = Array.from({ length: 100 }, () => r());
  assert.ok(rs.every((v) => v >= 0 && v < 1));
  assert.notEqual(rs[0], s());
});
