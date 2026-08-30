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
import { add, scale, norm, sub, len, dist } from './vec.js';
import { carrier, getPlayer } from './state.js';
import { yardsOfY } from './view.js';
import { passSpeed, passReach, passTravel, powerForTravel, spawnOffset } from './flight.js';
import { PASS_GRACE_SUBSTEPS, PICK_SLOP_UNITS } from './constants.js';

// The throw's distance arithmetic lives in flight.js, where state.js can reach
// it without importing this module — but it is a fact about throwing, so it is
// still handed out from here and every caller and test imports it from one
// place.
export { passSpeed, passReach, passTravel, powerForTravel } from './flight.js';
import { isLob, planLob, scatterRadius, LOCK_UNITS } from './lob.js';

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
 * Where the ball leaves the passer's hand: his leading edge, strictly outside
 * his own scoop range so he cannot re-take his own throw where he stands. The
 * direction is normalized here, so a non-unit `dir` cannot secretly move the
 * spawn point.
 */
export function passOrigin(player, dir) {
  return add(player.pos, scale(norm(dir), spawnOffset(player)));
}

/** The spot this throw is aimed at: a whole reach on from where it left the hand. */
export function passAim(player, dir, power) {
  const d = norm(dir);
  return add(passOrigin(player, d), scale(d, passReach(power)));
}

/**
 * The man a throw drag has landed on, or null.
 *
 * Three things have to be true: he is one of yours, he is not you, and he is
 * inside the lock zone. That last one is the rule the whole feature turns on —
 * past LOB_LOCK_YARDS the ball would be above him by the time it got there, so
 * there is nothing to lock onto and the drag means a lob instead.
 *
 * The pick slop is PICK_SLOP_UNITS, the same fat-finger margin app/main.js uses
 * to choose the man being ordered and cover.js uses to choose the man being
 * taken on: how forgiving a drag is should not depend on which verb it is.
 */
export function receiverAt(state, point, passerId) {
  const passer = getPlayer(state, passerId);
  let best = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.id === passerId || p.team !== passer.team) continue;
    if (dist(p.pos, passer.pos) > LOCK_UNITS) continue;
    const d = dist(p.pos, point);
    if (d <= p.radius + PICK_SLOP_UNITS && d < bestD) { best = p.id; bestD = d; }
  }
  return best;
}

/**
 * The throw that puts the ball on this man THIS TURN: aimed where he is
 * standing, and thrown exactly hard enough to arrive before the whistle rather
 * than at whatever force the drag happened to carry. That is what locking on
 * is — the coach picks the man, the passer picks the pace.
 *
 * Sizing it for one turn rather than for the throw's eventual reach is the
 * whole point: a throw sized to arrive "in the end" is only 84% of the way
 * there when the whistle blows, which for a man at the edge of the lock zone
 * is an incompletion at his feet.
 *
 * He is of course free to move between now and the whistle, and the ball is
 * not: a lock-on is an aim, not a guarantee.
 */
export function lockOnPass(passer, receiver) {
  const to = sub(receiver.pos, passer.pos);
  const dir = norm(to);
  const gap = Math.max(0, len(to) - spawnOffset(passer));
  return { dir, power: powerForTravel(gap) };
}

/**
 * The landing circle this throw earns: where it is aimed and how big the guess
 * is — or null when the throw is short enough to go where it is pointed. One
 * function, so the live drag preview, the committed arrow and the ball's own
 * flight are all drawn from the same numbers.
 */
export function passLanding(player, dir, power) {
  const reach = passReach(power);
  if (!isLob(reach)) return null;
  return { pos: passAim(player, dir, power), radius: scatterRadius(reach) };
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
