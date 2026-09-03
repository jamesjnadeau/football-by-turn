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
  // The nickel/dime newcomers, so a sub package is as learnable as the base one.
  for (const id of ['d-lb2', 'd-cb3']) {
    assert.ok(keys.has(`pos:${id}:across`), `pos:${id}:across`);
    assert.ok(keys.has(`pos:${id}:down`), `pos:${id}:down`);
  }
  for (const group of ['line', 'backer', 'back', 'deep']) {
    assert.ok(keys.has(`adapt:${group}:width`), `adapt:${group}:width`);
    assert.ok(keys.has(`adapt:${group}:depth`), `adapt:${group}:depth`);
  }
  for (const k of ['sub:spread', 'sub:backs', 'sub:toGo',
    'sub:nickel:bias', 'sub:dime:bias']) {
    assert.ok(keys.has(k), k);
  }
  assert.equal(DEFENSE_SPEC.length, 55);
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
  const g = clampGenome(DEFENSE_SPEC, DEFENSE_GENOME.values);
  // Every number the file carries comes back untouched...
  for (const [k, v] of Object.entries(DEFENSE_GENOME.values)) assert.equal(g[k], v, k);
  // ...and a key added after that genome was trained comes back at its init,
  // which is the whole reason a genome trained before the defense could adapt
  // still plays the formation it was trained to play.
  for (const p of DEFENSE_SPEC) {
    if (!(p.key in DEFENSE_GENOME.values)) assert.equal(g[p.key], p.init, p.key);
  }
});

test('an untrained genome neither adapts nor subs', () => {
  const g = makeGenome(DEFENSE_SPEC);
  for (const group of ['line', 'backer', 'back', 'deep']) {
    assert.equal(g[`adapt:${group}:width`], 0);
    assert.equal(g[`adapt:${group}:depth`], 0);
  }
  // Both cuts sit at the floor with every weight at zero, so the axis reads
  // zero and neither threshold is crossed: stacked, always.
  assert.equal(g['sub:spread'], 0);
  assert.equal(g['sub:backs'], 0);
  assert.equal(g['sub:toGo'], 0);
  assert.equal(g['sub:nickel:bias'], -4);
  assert.equal(g['sub:dime:bias'], -4);
});

test('the sub-package newcomers start on their own roster spots', () => {
  const g = makeGenome(DEFENSE_SPEC);
  assert.equal(g['pos:d-lb2:across'], 3);
  assert.equal(g['pos:d-lb2:down'], 4);
  assert.equal(g['pos:d-cb3:across'], 2.5);
  assert.equal(g['pos:d-cb3:down'], 2);
});
