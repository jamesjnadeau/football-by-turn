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
  assert.equal(DEFENSE_SPEC.length, 51);
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
  const specKeys = new Set(DEFENSE_SPEC.map((p) => p.key));
  // Every number the file carries for a key the spec still names comes back
  // untouched. read:ballAir is the one key this file carries that the spec no
  // longer names -- clampGenome drops it, by the same discipline documented
  // above for a key a genome predates -- so it is excluded here rather than
  // asserted equal to a value nothing reads any more.
  for (const [k, v] of Object.entries(DEFENSE_GENOME.values)) {
    if (specKeys.has(k)) assert.equal(g[k], v, k);
  }
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

test('the per-man read keys are inert at init', () => {
  const g = makeGenome(DEFENSE_SPEC);
  for (const key of ['read:man:downfield', 'read:man:lateral', 'read:man:inertia', 'read:trigger']) {
    assert.equal(g[key], 0, `${key} must start at zero`);
  }
  // read:man:commit starts at its own FLOOR, not its ceiling -- the zero
  // weights above are what make z identically zero and keep the read inert;
  // a threshold the evidence can never reach would instead be a floor
  // evolution has no gradient to lower, since nothing would ever cross it to
  // show a difference in fitness. Permissive at init, cautious only once
  // selection earns it.
  const commit = DEFENSE_SPEC.find((p) => p.key === 'read:man:commit');
  assert.equal(g['read:man:commit'], commit.min);
});

/**
 * The maximum |z| a genome could ever present for one defender on a turn
 * learnedOrders actually consults (t >= 1, once a cover assignment exists --
 * see read.js's advanceRead). Both cues are clamped to [-1, 1] before their
 * weight applies (read.js's clamp1), so the most one turn's evidence can add
 * is |read:man:downfield| + |read:man:lateral|, with both cues driven to
 * whichever sign matches their own weight's sign. read:man:inertia carries a
 * fraction of that forward turn over turn, so the accumulator's own fixed
 * point -- cueMax / (1 - inertia) -- is the largest |z| repeated evidence can
 * ever build to; at inertia 1 nothing decays and the reach is unbounded.
 */
function maxReachableZ(genome) {
  const cueMax = Math.abs(genome['read:man:downfield']) + Math.abs(genome['read:man:lateral']);
  const inertia = genome['read:man:inertia'];
  if (inertia >= 1) return Infinity;
  return cueMax / (1 - inertia);
}

test('the read is reachable: the shipped genome can actually cross its own read:man:commit', () => {
  // This is the invariant whose absence let the whole feature ship inert
  // three times running: a genome whose evidence cannot reach read:man:commit
  // never commits, never triggers, and no read:man:* weight ever moves
  // fitness -- selection has nothing to climb and nothing to notice. It is
  // not enough for the weights to be non-zero; the accumulator has to be able
  // to CROSS the threshold on a turn learnedOrders will actually ask about.
  //
  // EXPECTED TO FAIL until the next retrain: this genome was trained against
  // the global read's seven keys, which the per-man read replaces, so its
  // four read:man:* weights all come back at their spec init (0) through
  // clampGenome -- see 'the shipped genome loads, matches the variant, and is
  // already clamped' above for why that is the correct, honest reading of a
  // genome trained before this design existed, not a bug in this test.
  const g = clampGenome(DEFENSE_SPEC, DEFENSE_GENOME.values);
  const maxZ = maxReachableZ(g);
  assert.ok(
    maxZ > g['read:man:commit'],
    `the shipped genome's evidence can only ever reach |z| = ${maxZ}, `
      + `short of its own read:man:commit = ${g['read:man:commit']} -- the read can never commit to anything`,
  );
});
