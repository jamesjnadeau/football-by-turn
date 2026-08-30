/**
 * What a mode does to a player's numbers. The one place `player.mode` is
 * interpreted — physics and rules ask these functions, so a new mode (or a
 * retuned one) is a change here and in constants.js, nowhere else.
 */
import {
  SPEED_FACTOR, TUCK_SPEED_MULT, PREPARED_SPEED_MULT, HOLD_SPEED_MULT,
  PREPARED_REACH, HOLD_REACH, HOLD_MASS_MULT, CHARGE_MULT,
  FUMBLE_UNTUCKED, FUMBLE_TUCKED,
} from './constants.js';

const SPEED_MULT = { normal: 1, tucked: TUCK_SPEED_MULT, prepared: PREPARED_SPEED_MULT, holding: HOLD_SPEED_MULT };
const REACH_BONUS = { normal: 0, tucked: 0, prepared: PREPARED_REACH, holding: HOLD_REACH };

export function maxSpeed(player) {
  return (SPEED_FACTOR / player.radius) * SPEED_MULT[player.mode];
}

export function reach(player) {
  return player.radius + REACH_BONUS[player.mode];
}

export function effectiveMass(player) {
  return player.mass * (player.mode === 'holding' ? HOLD_MASS_MULT : 1);
}

export function accelMult(player) {
  return player.charge ? CHARGE_MULT : 1;
}

export function fumbleChance(player) {
  return player.mode === 'tucked' ? FUMBLE_TUCKED : FUMBLE_UNTUCKED;
}
