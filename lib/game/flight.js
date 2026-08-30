/**
 * How far a thrown ball goes, and how hard it has to be thrown to get there.
 *
 * physics.js multiplies a loose ball's velocity by BALL_FRICTION every
 * sub-step, so its flight is a geometric series with a closed form. Three
 * places in the game need that form and none of them should own it: pass.js
 * sizes a throw with it, lob.js measures an arc against it, and state.js
 * solves the snap's power out of it. Written twice it would be two models of
 * one ball, and the day BALL_FRICTION changes only one of them would follow.
 *
 * Pure arithmetic over the constants — no state, no vectors, no players — so
 * every module here can import it and none of them import each other.
 */
import {
  PASS_SPEED_MIN, PASS_SPEED_MAX, PASS_SPAWN_EPSILON, PICKUP_RADIUS_BONUS,
  BALL_FRICTION, DT, SUBSTEPS_PER_TURN,
} from './constants.js';

/** How fast the ball leaves the hand at this drag power. */
export function passSpeed(power) {
  return PASS_SPEED_MIN + (PASS_SPEED_MAX - PASS_SPEED_MIN) * power;
}

/**
 * How far that throw travels in the end, in units: the sum of the series,
 * speed * DT / (1 - BALL_FRICTION). It is the ball's OWN arithmetic rather
 * than a second model of it, which is what lets the board draw a landing
 * circle the throw actually reaches.
 */
export function passReach(power) {
  return (passSpeed(power) * DT) / (1 - BALL_FRICTION);
}

/**
 * The longest throw in the game — full power, run out to the end. The yardstick
 * a lob's hang time is measured against, and derived from passReach rather than
 * written out again, so it cannot drift from the throw it describes.
 */
export const PASS_REACH_MAX = passReach(1);

/** The same series stopped early: how far it has gone after `substeps`. */
export function passTravel(power, substeps) {
  return passReach(power) * (1 - Math.pow(BALL_FRICTION, substeps));
}

/**
 * The inverse: the power that carries the ball `units` down the field inside
 * `substeps`. A lock-on throw is sized with this — the coach picks the man and
 * the passer picks the pace, so the ball has to ARRIVE, not merely head that
 * way. Saturates at both ends rather than failing, exactly as predict.js's
 * throttleForDistance does.
 *
 * Pass `Infinity` for a throw with no deadline — the snap, which only has to
 * reach a man a few feet away and will get there whenever it gets there.
 */
export function powerForTravel(units, substeps = SUBSTEPS_PER_TURN) {
  const reach = units / (1 - Math.pow(BALL_FRICTION, substeps));
  const speed = (reach * (1 - BALL_FRICTION)) / DT;
  return Math.max(0, Math.min(1, (speed - PASS_SPEED_MIN) / (PASS_SPEED_MAX - PASS_SPEED_MIN)));
}

/**
 * How far outside his own centre a passer's throw begins. His leading edge,
 * strictly beyond his own scoop range so he cannot re-take his own throw where
 * he stands — the same reasoning, and the same arithmetic, as the fumble
 * pop-out's spawn offset.
 */
export function spawnOffset(player) {
  return player.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON;
}
