import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maxSpeed, reach, effectiveMass, accelMult, fumbleChance, headingOf, tackleReach, clampToStance,
  inStanceCone,
} from '../../lib/game/modes.js';
import {
  SPEED_FACTOR, TUCK_SPEED_MULT, STANCE_LATERAL_MULT, HOLD_SPEED_MULT,
  PREPARED_REACH, HOLD_REACH, HOLD_MASS_MULT, CHARGE_MULT,
  PREPARED_REACH_MULT, STANCE_CONE_HALF_ANGLE,
  FUMBLE_UNTUCKED, FUMBLE_TUCKED,
} from '../../lib/game/constants.js';

const p = (over) => ({
  radius: 3, mass: 9, mode: 'normal', charge: 0,
  team: 'defense', vel: { x: 0, y: 0 }, plan: null, facing: null,
  ...over,
});

test('smaller players are faster (spec)', () => {
  assert.ok(maxSpeed(p({ radius: 2.5 })) > maxSpeed(p({ radius: 3.5 })));
  assert.equal(maxSpeed(p()), SPEED_FACTOR / 3);
});

test('each mode caps speed as specified', () => {
  assert.equal(maxSpeed(p({ mode: 'tucked' })), (SPEED_FACTOR / 3) * TUCK_SPEED_MULT);
  assert.equal(maxSpeed(p({ mode: 'holding' })), (SPEED_FACTOR / 3) * HOLD_SPEED_MULT);
  // Prepared no longer costs a flat slice of top speed. maxSpeed is now the cap
  // ALONG his locked axis — full tilt — and clampToStance is what taxes the
  // sideways shuffle.
  assert.equal(maxSpeed(p({ mode: 'prepared' })), SPEED_FACTOR / 3);
});

test('prepared and holding extend reach; normal reach is just the radius', () => {
  assert.equal(reach(p()), 3);
  assert.equal(reach(p({ mode: 'prepared' })), 3 + PREPARED_REACH);
  assert.equal(reach(p({ mode: 'holding' })), 3 + HOLD_REACH);
});

test('holding multiplies effective mass (resists charging defenders)', () => {
  assert.equal(effectiveMass(p()), 9);
  assert.equal(effectiveMass(p({ mode: 'holding' })), 9 * HOLD_MASS_MULT);
});

test('charge gives a one-turn accel burst', () => {
  assert.equal(accelMult(p()), 1);
  assert.equal(accelMult(p({ charge: 1 })), CHARGE_MULT);
});

test('tucking protects the ball', () => {
  assert.equal(fumbleChance(p()), FUMBLE_UNTUCKED);
  assert.equal(fumbleChance(p({ mode: 'tucked' })), FUMBLE_TUCKED);
});

test('headingOf prefers momentum, then the plan arrow, then the way the team faces', () => {
  // A special move commits to where the player is actually moving, not the
  // arrow he just drew — he cannot pivot instantly. Momentum wins whenever
  // there is any.
  const drifting = p({ plan: { dir: { x: 1, y: 0 }, throttle: 1 }, vel: { x: 0, y: 9 } });
  assert.deepEqual(headingOf(drifting), { x: 0, y: 1 }, 'velocity wins over the arrow');
  // The plan arrow is only the fallback for a player with no momentum yet
  // (e.g. at the snap).
  assert.deepEqual(headingOf(p({ plan: { dir: { x: 3, y: 4 }, throttle: 1 } })), { x: 0.6, y: 0.8 }, 'no velocity: the arrow, normalised');
  assert.deepEqual(headingOf(p({ team: 'offense' })), { x: 0, y: 1 }, 'nothing at all: offense faces downfield');
  assert.deepEqual(headingOf(p({ team: 'defense' })), { x: 0, y: -1 }, 'nothing at all: defense faces the offense');
});

// Facing straight up the field at the offense; `off` degrees swings the target
// away from that axis, which is the only thing the cone test looks at.
const squaredUp = (over) => p({ mode: 'prepared', facing: { x: 0, y: -1 }, ...over });
const offAxis = (deg) => {
  const a = -Math.PI / 2 + (deg * Math.PI) / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
};

test('a prepared defender reaches twice as far inside the wedge he is facing', () => {
  const d = squaredUp();
  const near = reach(d);
  assert.equal(tackleReach(d, offAxis(0)), near * PREPARED_REACH_MULT, 'straight ahead');
  assert.equal(tackleReach(d, offAxis(44)), near * PREPARED_REACH_MULT, 'inside the wedge');
  assert.equal(tackleReach(d, offAxis(-44)), near * PREPARED_REACH_MULT, 'and on the other side');
  // Distance to the target must not matter — only the angle to it.
  assert.equal(tackleReach(d, { x: 0, y: -100 }), near * PREPARED_REACH_MULT);
});

test('outside that wedge a prepared defender reaches no further than his stance', () => {
  const d = squaredUp();
  assert.equal(tackleReach(d, offAxis(46)), reach(d), 'just past the edge');
  assert.equal(tackleReach(d, offAxis(90)), reach(d), 'straight to the side');
  assert.equal(tackleReach(d, offAxis(180)), reach(d), 'behind him');
});

test('the wedge is exactly the arc the board draws', () => {
  assert.equal(STANCE_CONE_HALF_ANGLE, Math.PI / 4);
});

test('inStanceCone is the shared wedge test tackleReach and tackleProbability both key off', () => {
  const d = squaredUp();
  assert.equal(inStanceCone(d, offAxis(0)), true, 'straight ahead');
  assert.equal(inStanceCone(d, offAxis(44)), true, 'inside the wedge');
  assert.equal(inStanceCone(d, offAxis(46)), false, 'just past the edge');
  assert.equal(inStanceCone(d, offAxis(180)), false, 'behind him');
  assert.equal(inStanceCone(p(), offAxis(0)), false, 'no locked facing at all: never in cone');
  assert.equal(inStanceCone(d, { x: 0, y: 0 }), false, 'nothing to judge the angle against');
});

test('nobody else gets a cone: reach stays a plain circle', () => {
  assert.equal(tackleReach(p(), offAxis(0)), reach(p()), 'normal');
  assert.equal(tackleReach(p({ mode: 'holding' }), offAxis(0)), reach(p({ mode: 'holding' })));
  // Prepared without a locked axis (never set through setMode) has no wedge.
  assert.equal(tackleReach(p({ mode: 'prepared' }), offAxis(0)), reach(p({ mode: 'prepared' })));
  // A zero-length offset has no direction to judge, so it cannot earn the cone.
  assert.equal(tackleReach(squaredUp(), { x: 0, y: 0 }), reach(squaredUp()));
});

test('a prepared defender keeps full speed along his axis, both ways down it', () => {
  const d = squaredUp();
  const top = maxSpeed(d);
  assert.deepEqual(clampToStance(d, { x: 0, y: -top * 3 }), { x: 0, y: -top }, 'driving forward');
  assert.deepEqual(clampToStance(d, { x: 0, y: top * 3 }), { x: 0, y: top }, 'and back down it');
  assert.deepEqual(clampToStance(d, { x: 0, y: -10 }), { x: 0, y: -10 }, 'under the cap, untouched');
});

test('a prepared defender can only shuffle across his axis', () => {
  const d = squaredUp();
  const side = maxSpeed(d) * STANCE_LATERAL_MULT;
  assert.deepEqual(clampToStance(d, { x: 999, y: 0 }), { x: side, y: 0 }, 'sideways is taxed');
  assert.deepEqual(clampToStance(d, { x: -999, y: 0 }), { x: -side, y: 0 }, 'either side');
  // The two limits apply independently, so a diagonal keeps all its drive.
  assert.deepEqual(clampToStance(d, { x: 999, y: -999 }), { x: side, y: -maxSpeed(d) });
});

test('everyone else is capped by a plain circle', () => {
  const rb = p({ mode: 'normal' });
  const top = maxSpeed(rb);
  assert.deepEqual(clampToStance(rb, { x: 0, y: top * 2 }), { x: 0, y: top });
  assert.deepEqual(clampToStance(rb, { x: top * 2, y: 0 }), { x: top, y: 0 });
  // Prepared without a locked axis has no stance to resolve against either.
  const loose = p({ mode: 'prepared' });
  assert.deepEqual(clampToStance(loose, { x: maxSpeed(loose) * 2, y: 0 }), { x: maxSpeed(loose), y: 0 });
});
