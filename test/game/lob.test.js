import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCK_UNITS, CATCH_UNITS, isLob, scatterRadius, scatterPoint, lobSubsteps,
  planLob, lobProgress, lobPoint, lobLanded, lobCatchable, lobBallScale,
  stepLob, ballScale, deadZoneSpan,
} from '../../lib/game/lob.js';
import {
  LOB_LOCK_YARDS, LOB_CATCH_YARDS, LOB_SCATTER_PER_YARD, LOB_TIME_MULT,
  LOB_BALL_SCALE, SUBSTEPS_PER_TURN, LOB_MIN_TIME_MULT,
} from '../../lib/game/constants.js';
import { PASS_REACH_MAX } from '../../lib/game/flight.js';
import { UNITS_PER_YARD_X } from '../../lib/field/geometry.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { dist } from '../../lib/game/vec.js';

/** A full-power bomb straight downfield, for the zone tests to walk. */
const bomb = () => ({
  from: { x: 100, y: 0 },
  to: { x: 100, y: PASS_REACH_MAX },
  substeps: 60,
  elapsed: 0,
});

test('the zones are the spec\'s yardages, in the board\'s own units', () => {
  assert.ok(Math.abs(LOCK_UNITS - LOB_LOCK_YARDS * UNITS_PER_YARD_X) < 1e-9);
  assert.ok(Math.abs(CATCH_UNITS - LOB_CATCH_YARDS * UNITS_PER_YARD_X) < 1e-9);
});

test('a throw is a lob only once it reaches past the lock zone', () => {
  assert.equal(isLob(LOCK_UNITS - 0.001), false);
  assert.equal(isLob(LOCK_UNITS), false, 'the boundary itself is still an ordinary throw');
  assert.equal(isLob(LOCK_UNITS + 0.001), true);
});

test('the landing circle starts at a catch window and widens with the throw', () => {
  assert.ok(Math.abs(scatterRadius(LOCK_UNITS) - LOB_CATCH_YARDS * UNITS_PER_YARD_X) < 1e-9);
  const deep = scatterRadius(PASS_REACH_MAX);
  const overYards = (PASS_REACH_MAX - LOCK_UNITS) / UNITS_PER_YARD_X;
  const want = (LOB_CATCH_YARDS + LOB_SCATTER_PER_YARD * overYards) * UNITS_PER_YARD_X;
  assert.ok(Math.abs(deep - want) < 1e-9);
  assert.ok(deep > scatterRadius(LOCK_UNITS), 'the longer the throw, the bigger the guess');
});

test('the ball lands somewhere inside that circle, and nowhere else', () => {
  const aim = { x: 100, y: 50 };
  const random = mulberry32(9);
  for (let i = 0; i < 200; i++) {
    const p = scatterPoint(aim, 10, random);
    assert.ok(dist(p, aim) <= 10 + 1e-9, 'inside the circle');
  }
  // Uniform over the DISC, not over the radius: the sqrt is what stops every
  // throw clustering on the aim point.
  const middle = scatterPoint(aim, 10, () => 0.25);
  assert.ok(Math.abs(dist(middle, aim) - 5) < 1e-9, 'a quarter of the area is half the radius');
});

test('hang time is measured against the deepest throw in the game, and loft stretches it', () => {
  const bombAt = (loft) => lobSubsteps(PASS_REACH_MAX, loft);
  const lockAt = (loft) => lobSubsteps(LOCK_UNITS, loft);
  assert.equal(bombAt(0), Math.round(LOB_MIN_TIME_MULT * SUBSTEPS_PER_TURN),
    'the fastest this throw can arrive, at no loft at all');
  assert.equal(bombAt(1), LOB_TIME_MULT * SUBSTEPS_PER_TURN, 'full loft: exactly how a lob has always hung');
  assert.equal(bombAt(1), 60, 'two whole turns, same as always');
  assert.equal(lockAt(1), 30, 'and the shortest lob for exactly one turn, same as always');
  const half = LOB_MIN_TIME_MULT + 0.5 * (LOB_TIME_MULT - LOB_MIN_TIME_MULT);
  assert.equal(bombAt(0.5), Math.round(half * SUBSTEPS_PER_TURN), 'loft interpolates between the two');
  assert.equal(lobSubsteps(0, 0), 1, 'never zero, at any loft');
  assert.equal(lobSubsteps(0, 1), 1);
  assert.equal(lobSubsteps(PASS_REACH_MAX), bombAt(0), 'no loft argument means no loft at all');
});

test('deadZoneSpan is the same lock-to-catch-window arithmetic a live lob already flies by', () => {
  const total = PASS_REACH_MAX;
  const span = deadZoneSpan(total);
  assert.equal(span.start, LOCK_UNITS);
  assert.equal(span.end, total - CATCH_UNITS);
  // Proven against a real lob's own lobCatchable, at the same boundaries.
  const lob = bomb();
  const catchableAt = (units) => { lob.elapsed = (units / total) * lob.substeps; return lobCatchable(lob); };
  assert.equal(catchableAt(span.start - 1), true);
  assert.equal(catchableAt(span.start + 1), false);
  assert.equal(catchableAt(span.end - 1), false);
  assert.equal(catchableAt(span.end + 1), true);
});

test('a planned lob starts at the hand, lands inside the circle, and knows how long it hangs', () => {
  const from = { x: 100, y: 0 };
  const aim = { x: 100, y: PASS_REACH_MAX };
  const lob = planLob(from, aim, mulberry32(3));
  assert.deepEqual(lob.from, from);
  assert.equal(lob.elapsed, 0);
  assert.ok(dist(lob.to, aim) <= scatterRadius(PASS_REACH_MAX) + 1e-9);
  assert.equal(lob.substeps, lobSubsteps(dist(lob.from, lob.to)));
  assert.deepEqual(lob.aim, aim, 'the raw aim rides along too, not just where it landed');
  assert.equal(lob.radius, scatterRadius(dist(from, aim)), 'and the guess it was thrown into');
  const same = planLob(from, aim, mulberry32(3));
  assert.deepEqual(same.to, lob.to, 'the same seed throws the same ball');
  const other = planLob(from, aim, mulberry32(4));
  assert.notDeepEqual(other.to, lob.to, 'a different one does not');
});

test('the ball walks its line at a constant pace and stops on the spot', () => {
  const lob = bomb();
  assert.deepEqual(lobPoint(lob), lob.from);
  assert.equal(lobProgress(lob), 0);
  assert.equal(lobLanded(lob), false);
  lob.elapsed = 30;
  assert.ok(Math.abs(lobPoint(lob).y - PASS_REACH_MAX / 2) < 1e-9, 'halfway at half the clock');
  lob.elapsed = 60;
  assert.deepEqual(lobPoint(lob), lob.to);
  assert.equal(lobLanded(lob), true);
  stepLob(lob);
  assert.deepEqual(lobPoint(lob), lob.to, 'a landed ball goes no further');
  assert.equal(lob.elapsed, 60);
});

test('stepLob advances the flight one sub-step', () => {
  const lob = bomb();
  const p = stepLob(lob);
  assert.equal(lob.elapsed, 1);
  assert.ok(Math.abs(p.y - PASS_REACH_MAX / 60) < 1e-9);
});

test('a lob is live for its first fifteen yards, dead over the middle, live again as it comes down', () => {
  const lob = bomb();
  const total = PASS_REACH_MAX;
  const at = (units) => { lob.elapsed = (units / total) * lob.substeps; return lobCatchable(lob); };
  assert.equal(at(0), true, 'out of the hand');
  assert.equal(at(LOCK_UNITS - 1), true, 'still inside the lock zone');
  assert.equal(at(LOCK_UNITS + 1), false, 'up over everyone');
  assert.equal(at(total - CATCH_UNITS - 1), false, 'still up there');
  assert.equal(at(total - CATCH_UNITS + 1), true, 'come down into the catch window');
  assert.equal(at(total), true, 'and on the ground');
});

test('a lob too short to have a dead zone is catchable the whole way', () => {
  // Long enough to arc, short enough that the lock zone and the catch window
  // still overlap: the ball never gets out of reach, and never gets drawn any
  // bigger either. Derived from the two constants rather than written as a
  // number, so retuning either of them cannot quietly make this fixture a
  // lob with a dead zone and leave the test asserting the opposite.
  const total = (LOB_LOCK_YARDS + LOB_CATCH_YARDS / 2) * UNITS_PER_YARD_X;
  const lob = { from: { x: 0, y: 0 }, to: { x: 0, y: total }, substeps: 30, elapsed: 0 };
  for (let i = 0; i <= 30; i++) {
    lob.elapsed = i;
    assert.equal(lobCatchable(lob), true, `sub-step ${i}`);
    assert.equal(lobBallScale(lob), 1, `sub-step ${i}`);
  }
});

test('the ball swells to its biggest at the top of the arc and comes back to size', () => {
  const lob = bomb();
  const total = PASS_REACH_MAX;
  lob.elapsed = 0;
  assert.equal(lobBallScale(lob), 1, 'normal size in the hand');
  lob.elapsed = lob.substeps;
  assert.equal(lobBallScale(lob), 1, 'and normal size on the ground');
  const mid = (LOCK_UNITS + (total - CATCH_UNITS)) / 2;
  lob.elapsed = (mid / total) * lob.substeps;
  assert.ok(Math.abs(lobBallScale(lob) - LOB_BALL_SCALE) < 1e-9, 'biggest at the apex');
  lob.elapsed = ((LOCK_UNITS + mid) / 2 / total) * lob.substeps;
  const rising = lobBallScale(lob);
  assert.ok(rising > 1 && rising < LOB_BALL_SCALE, 'and on the way up, in between');
});

test('a ball that is not lobbing is drawn at its ordinary size', () => {
  assert.equal(ballScale({ carrierId: null, pos: { x: 0, y: 0 }, lob: null }), 1);
  assert.equal(ballScale({ carrierId: 'o-qb', pos: null }), 1, 'and so is a carried one');
  const lob = bomb();
  // Not 30 (exactly half the flight's clock): at this bomb's exact numbers
  // that lands at 55.56 units, a hair short of the 56.25-unit lock boundary,
  // so the ball would still read as ordinary size. 40 is unambiguously in the
  // dead zone (74.1 of 111.1 units, well past the 56.25 boundary).
  lob.elapsed = 40;
  assert.ok(ballScale({ carrierId: null, pos: lobPoint(lob), lob }) > 1);
});
