import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OFFENSE_SPEC, OFFENSE_VARIANT } from '../../../lib/game/learned/offense-spec.js';
import { OFFENSE_GENOME } from '../../../lib/game/learned/offense-genome.js';
import { makeGenome, clampGenome } from '../../../lib/game/learned/genome.js';
import { ON_LINE_YARDS } from '../../../lib/game/constants.js';

test('the spec covers formation, the call gate, run, pass and routes', () => {
  const keys = new Set(OFFENSE_SPEC.map((p) => p.key));
  for (const id of ['o-c', 'o-lg', 'o-rg', 'o-wr1', 'o-wr2', 'o-qb', 'o-rb']) {
    assert.ok(keys.has(`pos:${id}:across`), `pos:${id}:across`);
    assert.ok(keys.has(`pos:${id}:down`), `pos:${id}:down`);
  }
  for (const k of ['call:bias', 'call:down', 'call:toGo', 'call:box',
    'run:sideBias', 'run:read', 'run:lean',
    'throw:go', 'throw:hold', 'qb:drop',
    'tgt:sep', 'tgt:depth', 'tgt:dist']) {
    assert.ok(keys.has(k), k);
  }
  for (const id of ['o-wr1', 'o-wr2', 'o-rb']) {
    assert.ok(keys.has(`route:${id}:deg0`), id);
    assert.ok(keys.has(`route:${id}:degLate`), id);
  }
  assert.equal(OFFENSE_SPEC.length, 33);
});

test('no training run can pull the line off the line, or anyone past it', () => {
  const byKey = new Map(OFFENSE_SPEC.map((p) => [p.key, p]));
  for (const id of ['o-c', 'o-lg', 'o-rg', 'o-wr1', 'o-wr2']) {
    const p = byKey.get(`pos:${id}:down`);
    assert.ok(p.min >= -ON_LINE_YARDS + 0.2, `${id} stays on the line`);
    assert.ok(p.max <= -0.5, `${id} stays behind the line`);
  }
  for (const id of ['o-qb', 'o-rb']) {
    assert.ok(byKey.get(`pos:${id}:down`).max <= -0.5, `${id} stays behind the line`);
  }
});

test('the spec inits reproduce the roster formation', () => {
  const g = makeGenome(OFFENSE_SPEC);
  assert.equal(g['pos:o-c:across'], 0);
  assert.equal(g['pos:o-c:down'], -1);
  assert.equal(g['pos:o-wr2:across'], 15);
  assert.equal(g['pos:o-qb:down'], -4);
  assert.equal(g['pos:o-rb:down'], -7);
});

test('the shipped genome loads, matches the variant, and is already clamped', () => {
  assert.equal(OFFENSE_GENOME.meta.variant, OFFENSE_VARIANT);
  assert.deepEqual(clampGenome(OFFENSE_SPEC, OFFENSE_GENOME.values), OFFENSE_GENOME.values);
});
