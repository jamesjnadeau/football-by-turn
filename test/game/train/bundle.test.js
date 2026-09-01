import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUNDLE_KIND, BUNDLE_VERSION, specForSide, makeBundle, serializeBundle, parseBundle,
} from '../../../lib/game/train/bundle.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';

const META = {
  trainedBy: 'app/train-worker.js', generations: 12, popSize: 10, plays: 12,
  sigma: 0.08, seed: 1, fitness: -2.5, snapshots: 84,
  exportedAt: '2026-08-31T00:00:00.000Z',
};

/** A bundle serialized and mutated, the way a stranger's file might arrive. */
function tampered(mutate) {
  const raw = JSON.parse(serializeBundle(
    makeBundle({ side: 'defense', values: makeGenome(DEFENSE_SPEC) }),
  ));
  mutate(raw);
  return parseBundle(JSON.stringify(raw));
}

test('specForSide names each side spec and the variant it was written for', () => {
  assert.equal(specForSide('defense').spec, DEFENSE_SPEC);
  assert.equal(specForSide('defense').variant, '7');
  assert.equal(specForSide('offense').spec, OFFENSE_SPEC);
  assert.equal(specForSide('offense').variant, '7');
  assert.equal(specForSide('special-teams'), null);
});

test('a bundle round trips through text unchanged', () => {
  const made = makeBundle({
    side: 'defense', values: makeGenome(DEFENSE_SPEC), meta: META,
  });
  assert.equal(made.kind, BUNDLE_KIND);
  assert.equal(made.version, BUNDLE_VERSION);
  assert.equal(made.side, 'defense');
  assert.equal(made.variant, '7');
  assert.deepEqual(made.meta, META);
  const { bundle, error } = parseBundle(serializeBundle(made));
  assert.equal(error, undefined);
  assert.deepEqual(bundle, made);
});

test('an offense bundle round trips too', () => {
  const made = makeBundle({ side: 'offense', values: makeGenome(OFFENSE_SPEC) });
  const { bundle } = parseBundle(serializeBundle(made));
  assert.equal(bundle.side, 'offense');
  assert.deepEqual(bundle.values, makeGenome(OFFENSE_SPEC));
});

test('makeBundle clamps into the spec and refuses a side it does not know', () => {
  const made = makeBundle({ side: 'defense', values: { 'cov:dist': 99, junk: 1 } });
  assert.equal(made.values['cov:dist'], 3); // the spec's max
  assert.equal('junk' in made.values, false);
  assert.equal(Object.keys(made.values).length, DEFENSE_SPEC.length);
  assert.throws(() => makeBundle({ side: 'kickoff', values: {} }), /kickoff/);
});

test('parseBundle refuses anything that is not this format', () => {
  assert.match(parseBundle('').error, /no bundle text/);
  assert.match(parseBundle(null).error, /no bundle text/);
  assert.match(parseBundle('{oops').error, /not JSON/);
  assert.match(parseBundle('[]').error, /not a JSON object/);
  assert.match(tampered((b) => { b.kind = 'something-else'; }).error, /kind/);
  assert.match(tampered((b) => { b.version = 2; }).error, /version/);
  assert.match(tampered((b) => { b.side = 'special-teams'; }).error, /side/);
  assert.match(tampered((b) => { b.variant = '11'; }).error, /variant/);
});

test('parseBundle refuses values that would not survive a clamp', () => {
  assert.match(tampered((b) => { delete b.values['cov:dist']; }).error, /cov:dist/);
  assert.match(tampered((b) => { b.values['cov:dist'] = 99; }).error, /outside/);
  assert.match(tampered((b) => { b.values['cov:dist'] = 'wide'; }).error, /finite/);
  assert.match(tampered((b) => { b.values['cov:dist'] = null; }).error, /finite/);
  assert.match(tampered((b) => { b.values.junk = 1; }).error, /junk/);
});

test('a JSON __proto__ key is refused as a stray parameter', () => {
  // A mutation (`values.__proto__ = 1`) cannot build this attack: assignment
  // hits the inherited setter and no own key appears. Only JSON text can put
  // an own "__proto__" key on the object — JSON.parse defines it rather than
  // assigning — so the attack is crafted in the text itself.
  const good = serializeBundle(makeBundle({ side: 'defense', values: makeGenome(DEFENSE_SPEC) }));
  const evil = good.replace('"cov:dist":', '"__proto__": 1, "cov:dist":');
  assert.match(parseBundle(evil).error, /__proto__/);
});

test('a bundle with no meta parses, with an empty meta', () => {
  const { bundle } = tampered((b) => { delete b.meta; });
  assert.deepEqual(bundle.meta, {});
  assert.deepEqual(tampered((b) => { b.meta = 'notes'; }).bundle.meta, {});
});
