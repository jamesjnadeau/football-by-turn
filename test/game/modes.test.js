import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxSpeed, reach, effectiveMass, accelMult, fumbleChance } from '../../lib/game/modes.js';
import {
  SPEED_FACTOR, TUCK_SPEED_MULT, PREPARED_SPEED_MULT, HOLD_SPEED_MULT,
  PREPARED_REACH, HOLD_REACH, HOLD_MASS_MULT, CHARGE_MULT,
  FUMBLE_UNTUCKED, FUMBLE_TUCKED,
} from '../../lib/game/constants.js';

const p = (over) => ({ radius: 3, mass: 9, mode: 'normal', charge: 0, ...over });

test('smaller players are faster (spec)', () => {
  assert.ok(maxSpeed(p({ radius: 2.5 })) > maxSpeed(p({ radius: 3.5 })));
  assert.equal(maxSpeed(p()), SPEED_FACTOR / 3);
});

test('each mode caps speed as specified', () => {
  assert.equal(maxSpeed(p({ mode: 'tucked' })), (SPEED_FACTOR / 3) * TUCK_SPEED_MULT);
  assert.equal(maxSpeed(p({ mode: 'prepared' })), (SPEED_FACTOR / 3) * PREPARED_SPEED_MULT);
  assert.equal(maxSpeed(p({ mode: 'holding' })), (SPEED_FACTOR / 3) * HOLD_SPEED_MULT);
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
