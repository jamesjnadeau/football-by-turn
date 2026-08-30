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
import { add, scale, norm } from './vec.js';
import { carrier } from './state.js';
import { yardsOfY } from './view.js';
import {
  PASS_SPEED_MIN, PASS_SPEED_MAX, PASS_SPAWN_EPSILON, PASS_GRACE_SUBSTEPS,
  PICKUP_RADIUS_BONUS, BALL_FRICTION, DT, SUBSTEPS_PER_TURN,
} from './constants.js';
import { isLob, planLob } from './lob.js';

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

/** How fast the ball leaves the hand at this drag power. */
export function passSpeed(power) {
  return PASS_SPEED_MIN + (PASS_SPEED_MAX - PASS_SPEED_MIN) * power;
}

/**
 * How far that throw travels in the end, in units.
 *
 * physics.js multiplies a loose ball's velocity by BALL_FRICTION every
 * sub-step, so the distance is a geometric series and this is its sum:
 * speed * DT / (1 - BALL_FRICTION). It is the ball's OWN arithmetic rather
 * than a second model of it, which is what lets the board draw a landing
 * circle the throw actually reaches.
 */
export function passReach(power) {
  return (passSpeed(power) * DT) / (1 - BALL_FRICTION);
}

/** The same series stopped early: how far it has gone after `substeps`. */
export function passTravel(power, substeps) {
  return passReach(power) * (1 - Math.pow(BALL_FRICTION, substeps));
}

/**
 * The inverse: the power that carries the ball `units` down the field inside
 * `substeps`. A lock-on throw is sized with this — the coach picks the man and
 * the passer picks the pace, so the ball has to ARRIVE, not merely head that
 * way. Saturates at both ends rather than failing, exactly as
 * predict.js's throttleForDistance does.
 */
export function powerForTravel(units, substeps = SUBSTEPS_PER_TURN) {
  const reach = units / (1 - Math.pow(BALL_FRICTION, substeps));
  const speed = (reach * (1 - BALL_FRICTION)) / DT;
  return Math.max(0, Math.min(1, (speed - PASS_SPEED_MIN) / (PASS_SPEED_MAX - PASS_SPEED_MIN)));
}

/**
 * Where the ball leaves the passer's hand: his leading edge, strictly outside
 * his own scoop range so he cannot re-take his own throw where he stands. The
 * direction is normalized here, so a non-unit `dir` cannot secretly move the
 * spawn point.
 */
export function passOrigin(player, dir) {
  const d = norm(dir);
  return add(player.pos, scale(d, player.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON));
}

/** The spot this throw is aimed at: a whole reach on from where it left the hand. */
export function passAim(player, dir, power) {
  const d = norm(dir);
  return add(passOrigin(player, d), scale(d, passReach(power)));
}

/**
 * Put the planned throw in the air, and report what happened: a `pass` event
 * always, plus a `flag` event when it drew one. Returns [] and changes nothing
 * when no throw is planned, or when the man who planned it is no longer the
 * one holding the ball — a fumble between planning and the whistle cancels it.
 *
 * `random` is the turn's own, and is drawn from ONLY when the throw actually
 * lobs: the landing scatter is the one roll of the dice in a throw, and a
 * handoff must not shift a seeded game's stream by taking one it doesn't need.
 */
export function releasePass(state, random) {
  const planned = state.plannedPass;
  if (!planned) return [];
  const car = carrier(state);
  if (!car || car.id !== planned.from) return [];

  // Throw speed scales with |dir|. Every in-app caller passes a unit vector,
  // but setPass is a public API, so a non-unit dir must not silently change
  // the throw's power (or the drawn arrow) — normalize once, here, and use
  // this local `dir` for everything below.
  const dir = norm(planned.dir);
  const forward = isForward(dir);
  const foul = passFoul(state, car, dir);
  if (forward) state.forwardPasses += 1;
  // One flag per down: a second foul does not overwrite the first.
  if (foul && !state.penalty) state.penalty = { foul, spot: state.losYard };

  const speed = passSpeed(planned.power);
  const reach = passReach(planned.power);
  const pos = passOrigin(car, dir);
  state.ball = {
    carrierId: null,
    pos,
    vel: scale(dir, speed),
    loose: PASS_GRACE_SUBSTEPS,
    forward,
    // A throw long enough to arc is FLOWN rather than rolled: planLob fixes
    // where it comes down — somewhere inside the landing circle the coach was
    // shown — and how long it hangs, and physics.js walks it there. A throw
    // aimed at a man never arcs, whatever its power: the whole point of locking
    // on is that the ball stays in his reach, and a lob would go over his head.
    //
    // `vel` above is still what it left the hand at, which is true of a lob as
    // much as of a handoff and is what the arrow and the flag were drawn from.
    // It simply is not what moves the ball any more once `lob` is set.
    lob: !planned.target && isLob(reach)
      ? planLob(pos, add(pos, scale(dir, reach)), random)
      : null,
  };

  const events = [{ type: 'pass', by: car.id, forward }];
  if (foul) events.push({ type: 'flag', foul });
  return events;
}
