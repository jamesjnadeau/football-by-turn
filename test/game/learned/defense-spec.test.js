import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFENSE_SPEC, DEFENSE_VARIANT } from '../../../lib/game/learned/defense-spec.js';
import { DEFENSE_GENOME } from '../../../lib/game/learned/defense-genome.js';
import { makeGenome, clampGenome } from '../../../lib/game/learned/genome.js';

test('the spec covers formation, zones, coverage weights and the scheme gate', () => {
  const keys = new Set(DEFENSE_SPEC.map((p) => p.key));
  for (const id of ['d-nt', 'd-dt1', 'd-dt2', 'd-cb1', 'd-cb2', 'd-lb', 'd-s']) {
    assert.ok(keys.has(`pos:${id}:across`), `pos:${id}:across`);
    assert.ok(keys.has(`pos:${id}:down`), `pos:${id}:down`);
  }
  for (const id of ['d-cb1', 'd-cb2', 'd-lb', 'd-s']) {
    assert.ok(keys.has(`zone:${id}:across`), `zone:${id}:across`);
    assert.ok(keys.has(`zone:${id}:depth`), `zone:${id}:depth`);
  }
  for (const k of ['cov:dist', 'cov:depth', 'cov:width',
    'scheme:bias', 'scheme:down', 'scheme:toGo', 'scheme:spread']) {
    assert.ok(keys.has(k), k);
  }
  assert.equal(DEFENSE_SPEC.length, 29);
});

test('every spec entry is well-formed and its init is inside its range', () => {
  for (const p of DEFENSE_SPEC) {
    assert.equal(typeof p.key, 'string');
    assert.ok(p.min < p.max, p.key);
    assert.ok(p.init >= p.min && p.init <= p.max, p.key);
  }
});

test('formation depth can never reach back across the line', () => {
  for (const p of DEFENSE_SPEC) {
    if (p.key.startsWith('pos:') && p.key.endsWith(':down')) {
      assert.ok(p.min >= 0.5, p.key);
    }
  }
});

test('the spec inits reproduce the roster alignment', () => {
  const g = makeGenome(DEFENSE_SPEC);
  assert.equal(g['pos:d-nt:across'], 0);
  assert.equal(g['pos:d-nt:down'], 1);
  assert.equal(g['pos:d-cb2:across'], 15);
  assert.equal(g['pos:d-cb2:down'], 2);
  assert.equal(g['pos:d-s:down'], 8);
});

test('the shipped genome loads, matches the variant, and is already clamped', () => {
  assert.equal(DEFENSE_GENOME.meta.variant, DEFENSE_VARIANT);
  assert.deepEqual(clampGenome(DEFENSE_SPEC, DEFENSE_GENOME.values), DEFENSE_GENOME.values);
});
