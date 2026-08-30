/**
 * Throwing: the forward-pass rules, and the act of letting go of the ball.
 *
 * The spec's rule is one forward pass per down and only from behind the line
 * of scrimmage; backward throws are unlimited, and a handoff is simply a short
 * one — so there is a single throw mechanic here, not two. An illegal throw is
 * never blocked. It happens exactly as asked, a flag is recorded on the state,
 * and rules.js's nextDown enforces it after the whistle.
 *
 * A thrown ball IS a loose ball: same shape, same per-sub-step decay in
 * physics.js, same checkPickup. That is what makes a catch, a dropped handoff
 * and an interception one code path instead of three.
 */
import { add, scale } from './vec.js';
import { carrier } from './state.js';
import { yardsOfY } from './view.js';
import {
  PASS_SPEED_MIN, PASS_SPEED_MAX, PASS_SPAWN_EPSILON, PASS_GRACE_SUBSTEPS,
  PICKUP_RADIUS_BONUS,
} from './constants.js';

/**
 * Forward means the throw carries the ball toward the goal the offense
 * attacks, which is +y. A dead-flat sideways throw is a lateral, not a forward
 * pass — hence the strict comparison.
 */
export function isForward(dir) {
  return dir.y > 0;
}

/**
 * Why this throw would draw a flag, or null if it is clean.
 *
 * Backward throws are always clean. A forward throw is clean only from behind
 * the line and only if this down has not already had one — and "already had
 * one" counts an earlier ILLEGAL forward pass too, which is why releasePass
 * increments the tally whatever the verdict here. Behind the line is judged on
 * the passer's centre: the ball is drawn at his leading edge, but that edge
 * swings with his facing and the rule should not depend on where he is looking.
 */
export function passFoul(state, passer, dir) {
  if (!isForward(dir)) return null;
  if (state.forwardPasses > 0) return 'second-forward-pass';
  if (yardsOfY(passer.pos.y) > state.losYard) return 'illegal-forward-pass';
  return null;
}

/**
 * Put the planned throw in the air, and report what happened: a `pass` event
 * always, plus a `flag` event when it drew one. Returns [] and changes nothing
 * when no throw is planned, or when the man who planned it is no longer the
 * one holding the ball — a fumble between planning and the whistle cancels it.
 */
export function releasePass(state) {
  const planned = state.plannedPass;
  if (!planned) return [];
  const car = carrier(state);
  if (!car || car.id !== planned.from) return [];

  const forward = isForward(planned.dir);
  const foul = passFoul(state, car, planned.dir);
  if (forward) state.forwardPasses += 1;
  // One flag per down: a second foul does not overwrite the first.
  if (foul && !state.penalty) state.penalty = { foul, spot: state.losYard };

  const speed = PASS_SPEED_MIN + (PASS_SPEED_MAX - PASS_SPEED_MIN) * planned.power;
  const offset = car.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON;
  state.ball = {
    carrierId: null,
    pos: add(car.pos, scale(planned.dir, offset)),
    vel: scale(planned.dir, speed),
    loose: PASS_GRACE_SUBSTEPS,
    forward,
  };

  const events = [{ type: 'pass', by: car.id, forward }];
  if (foul) events.push({ type: 'flag', foul });
  return events;
}
