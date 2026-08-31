import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schemeShade, favoriteDiscount, anchorShift, schemeChoice,
  learnedCoverAssignments, zoneAnchorsFromGenome, learnedOrders,
} from '../../../lib/game/learned/defense-policy.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { emptyTendencies, observePlay, readTendencies } from '../../../lib/game/tendencies.js';
import { createGame, getPlayer, setPlan } from '../../../lib/game/state.js';
import { coachAi, clearAiPlans } from '../../../lib/game/ai.js';
import { fieldPos } from '../../../lib/game/view.js';
import {
  TENDENCY_SCHEME_SHADE, TENDENCY_COVER_DISCOUNT_YARDS, TENDENCY_ANCHOR_SHIFT_YARDS,
} from '../../../lib/game/constants.js';

function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

/** `n` identical calls, read back for this down and distance. */
function profile(obs, n, down, toGo) {
  let counts = emptyTendencies();
  for (let i = 0; i < n; i++) counts = observePlay(counts, obs);
  return readTendencies(counts, down, toGo);
}

test('with no history the learned defense plays exactly what it played before', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const g = makeGenome(DEFENSE_SPEC);
  const plain = learnedOrders(s, 'defense', g);
  assert.deepEqual(learnedOrders(s, 'defense', g, null), plain);
  // An empty history is not "a little bit of a read": it is no read at all.
  const blank = readTendencies(emptyTendencies(), s.down, s.toGoYard - s.losYard);
  assert.deepEqual(learnedOrders(s, 'defense', g, blank), plain);
  assert.equal(schemeShade(null), 0);
  assert.equal(schemeShade(blank), 0);
  assert.equal(anchorShift(blank), 0);
  assert.equal(favoriteDiscount(blank, 'o-wr1'), 0);
});

test('the scheme shade is bounded, signed, and zero without a read', () => {
  const passer = profile({ down: 3, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 40, 3, 10);
  const runner = profile({ down: 3, toGo: 10, call: 'run', side: 'middle', target: null }, 40, 3, 10);
  assert.ok(schemeShade(passer) > 0, 'a thrower earns zone');
  assert.ok(schemeShade(runner) < 0, 'a runner earns man');
  for (const t of [passer, runner]) {
    assert.ok(Math.abs(schemeShade(t)) <= TENDENCY_SCHEME_SHADE);
  }
});

test('a passing habit can tip a gate that was already close', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  s.down = 3;
  s.toGoYard = s.losYard + 10;
  const g = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': -0.5 };
  assert.equal(schemeChoice(s, g), 'man');
  const passer = profile({ down: 3, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 20, 3, 10);
  assert.equal(schemeChoice(s, g, passer), 'zone');
  // ...and cannot tip one that was not close: the clamp is the promise.
  const committed = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': -2 };
  assert.equal(schemeChoice(s, committed, passer), 'man');
});

test('the favorite receiver is claimed first, from further away', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  // The back close but shallow, the receiver a touch further but downfield —
  // by bare distance the corner takes the back.
  getPlayer(s, 'o-rb').pos = fieldPos(-14, s.losYard - 1);
  getPlayer(s, 'o-wr1').pos = fieldPos(-15, s.losYard + 6);
  const g = makeGenome(DEFENSE_SPEC);
  assert.equal(learnedCoverAssignments(s, 'defense', g).get('d-cb1'), 'o-rb');

  const favors = profile({ down: 1, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 10, 1, 10);
  assert.equal(learnedCoverAssignments(s, 'defense', g, favors).get('d-cb1'), 'o-wr1');
  assert.ok(favoriteDiscount(favors, 'o-wr1') > 0);
  assert.ok(favoriteDiscount(favors, 'o-rb') === 0, 'nobody else gets the discount');
  assert.ok(favoriteDiscount(favors, 'o-wr1') <= TENDENCY_COVER_DISCOUNT_YARDS);
});

test('zone anchors slide toward the side the runs have been going', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(DEFENSE_SPEC);
  const defense = s.players.filter((p) => p.team === 'defense');
  const plain = zoneAnchorsFromGenome(defense, g);
  const right = profile({ down: 1, toGo: 10, call: 'run', side: 'right', target: null }, 40, 1, 10);
  const shifted = zoneAnchorsFromGenome(defense, g, right);
  const shift = anchorShift(right);
  assert.ok(shift > 0);
  assert.ok(shift <= TENDENCY_ANCHOR_SHIFT_YARDS);
  for (const a of shifted) {
    const was = plain.find((p) => p.id === a.id);
    assert.ok(a.across > was.across, `${a.id} slid right`);
    assert.equal(a.depth, was.depth, 'depth is not a side');
  }
  // A shifted anchor is still on the field.
  const wide = { ...g, 'zone:d-cb2:across': 24 };
  const edge = zoneAnchorsFromGenome(defense, wide, right).find((a) => a.id === 'd-cb2');
  assert.ok(edge.across <= 160 / 6, `${edge.across} is inside the sideline`);
});

test("coachAi hands the learned defense the game's own history", () => {
  const s = afterSnap(createGame({ seed: 3, ai: 'defense', aiLevel: 'learned' }));
  assert.equal(s.tendencyCounts, null, 'a fresh game carries no history');
  let counts = emptyTendencies();
  for (let i = 0; i < 20; i++) {
    counts = observePlay(counts, {
      down: s.down, toGo: s.toGoYard - s.losYard, call: 'pass', side: null, target: 'o-wr1',
    });
  }
  s.tendencyCounts = counts;
  coachAi(s);
  const planned = s.players.filter((p) => p.team === 'defense' && (p.plan || p.cover));
  assert.ok(planned.length > 0, 'the defense still plays football');
  clearAiPlans(s);
});

test('history changes nothing at all for the levels that never learned', () => {
  const orders = (counts) => {
    const s = afterSnap(createGame({ seed: 5, ai: 'defense', aiLevel: 'smart' }));
    s.tendencyCounts = counts;
    setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
    coachAi(s);
    return s.players
      .filter((p) => p.team === 'defense')
      .map((p) => ({ id: p.id, plan: p.plan, cover: p.cover }));
  };
  let counts = emptyTendencies();
  for (let i = 0; i < 30; i++) {
    counts = observePlay(counts, { down: 1, toGo: 10, call: 'pass', side: null, target: 'o-wr1' });
  }
  assert.deepEqual(orders(counts), orders(null));
});
