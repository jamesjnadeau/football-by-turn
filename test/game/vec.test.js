import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, sub, scale, dot, len, dist, norm, clampLen } from '../../lib/game/vec.js';

test('arithmetic', () => {
  assert.deepEqual(add({ x: 1, y: 2 }, { x: 3, y: 4 }), { x: 4, y: 6 });
  assert.deepEqual(sub({ x: 1, y: 2 }, { x: 3, y: 4 }), { x: -2, y: -2 });
  assert.deepEqual(scale({ x: 1, y: -2 }, 3), { x: 3, y: -6 });
  assert.equal(dot({ x: 1, y: 2 }, { x: 3, y: 4 }), 11);
});

test('lengths', () => {
  assert.equal(len({ x: 3, y: 4 }), 5);
  assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test('norm returns a unit vector, and zero for the zero vector', () => {
  assert.deepEqual(norm({ x: 0, y: -2 }), { x: 0, y: -1 });
  assert.deepEqual(norm({ x: 0, y: 0 }), { x: 0, y: 0 });
});

test('clampLen shortens long vectors and leaves short ones alone', () => {
  assert.deepEqual(clampLen({ x: 6, y: 8 }, 5), { x: 3, y: 4 });
  assert.deepEqual(clampLen({ x: 1, y: 0 }, 5), { x: 1, y: 0 });
});

test('nothing mutates its arguments', () => {
  const a = { x: 1, y: 2 };
  add(a, a); sub(a, a); scale(a, 2); norm(a); clampLen(a, 1);
  assert.deepEqual(a, { x: 1, y: 2 });
});
