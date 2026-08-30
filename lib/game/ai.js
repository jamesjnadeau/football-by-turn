/**
 * The computer opponent: a pursuit brain simple enough to read in one sitting.
 * Every player it coaches runs at the ball — at where the carrier is going,
 * not where he is — and nothing in here rolls dice, so a coached turn is as
 * reproducible as a hand-planned one.
 *
 * turn.js is the only caller. It coaches at the top of the turn and calls
 * clearAiPlans at the bottom, which is the whole trick to keeping the
 * computer's intentions off the human's screen: no plan of the computer's ever
 * exists while `phase === 'planning'`, so there is never anything to draw.
 */
import { add, sub, len, norm, scale } from './vec.js';
import { ballPos, carrier, setPlan, clearPlan } from './state.js';
import { maxSpeed } from './modes.js';
import { AI_LEAD_MAX_SECONDS } from './constants.js';

/** The players the computer coaches — nobody at all in hot-seat games. */
export function aiPlayers(state) {
  if (!state.aiTeam) return [];
  return state.players.filter((p) => p.team === state.aiTeam);
}

/**
 * Where `player` should run. A loose ball is chased where it lies; a carrier is
 * LED — his position plus his current velocity over the time this player needs
 * to cover the gap at his own top speed, capped at AI_LEAD_MAX_SECONDS.
 * Aiming at where the carrier stands right now would leave every pursuer
 * trailing him by exactly one turn, forever.
 */
export function pursuitTarget(state, player) {
  const bp = ballPos(state);
  if (!bp) return null;
  const car = carrier(state);
  if (!car || car.id === player.id) return bp;
  const t = Math.min(AI_LEAD_MAX_SECONDS, len(sub(bp, player.pos)) / maxSpeed(player));
  return add(bp, scale(car.vel, t));
}

/**
 * One full-throttle plan per coached player. Pure: nothing in `state` moves,
 * which is what lets the turn decide when (and whether) to apply them.
 */
export function defensePlans(state) {
  const plans = [];
  for (const p of aiPlayers(state)) {
    const target = pursuitTarget(state, p);
    if (target === null) continue;
    const to = sub(target, p.pos);
    if (len(to) === 0) continue; // standing on the ball: no direction to run
    plans.push({ id: p.id, dir: norm(to), throttle: 1 });
  }
  return plans;
}

/** Everything the computer decides for one turn, written into `state`. */
export function coachAi(state) {
  for (const { id, dir, throttle } of defensePlans(state)) setPlan(state, id, dir, throttle);
}

/**
 * Wipe the computer's arrows. runTurn calls this at the end of every turn, so
 * that no plan of the computer's survives into a planning phase where
 * renderArrows would happily draw it for the human to read.
 */
export function clearAiPlans(state) {
  for (const p of aiPlayers(state)) clearPlan(state, p.id);
}
