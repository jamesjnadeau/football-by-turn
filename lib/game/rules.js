/**
 * Football rules: tackles, fumbles, pickups (this half), dead-ball, downs
 * and scoring (Task 8's half). Physics moves bodies; this file decides what
 * the contact means. All randomness comes in through `random`.
 */
import { sub, len, dist, scale, norm } from './vec.js';
import { reach, fumbleChance, effectiveMass } from './modes.js';
import { carrier, getPlayer, ballPos } from './state.js';
import {
  TACKLE_BASE, PREPARED_TACKLE_BONUS, TUCK_BREAK_BONUS,
  NEARBY_RADIUS, NEARBY_BONUS, MOMENTUM_SCALE,
  TACKLE_COOLDOWN_SUBSTEPS, FUMBLE_BALL_SPEED,
} from './constants.js';

/**
 * P(tackle succeeds) = tackleScore / (tackleScore + breakScore).
 *
 * The spec's balance point is engineered in, not tuned in: with both players
 * the same size and stationary, tucked-vs-prepared gives
 * (BASE + PREPARED_TACKLE_BONUS) vs (BASE + TUCK_BREAK_BONUS) = 2 vs 2 = 0.5
 * exactly. Momentum terms are symmetric (mass × speed on each side) so the
 * balance holds whenever "all other things" really are equal.
 */
export function tackleProbability(state, defender, car) {
  let tackle = TACKLE_BASE;
  if (defender.mode === 'prepared') tackle += PREPARED_TACKLE_BONUS;
  tackle += effectiveMass(defender) * len(defender.vel) * MOMENTUM_SCALE;
  const helpers = state.players.filter(
    (p) => p.team === 'defense' && p.id !== defender.id &&
      dist(p.pos, car.pos) <= NEARBY_RADIUS,
  ).length;
  tackle += helpers * NEARBY_BONUS;

  let breaks = TACKLE_BASE;
  if (car.mode === 'tucked') breaks += TUCK_BREAK_BONUS;
  breaks += effectiveMass(car) * len(car.vel) * MOMENTUM_SCALE;

  return tackle / (tackle + breaks);
}

function dropBall(state, car, random) {
  const angle = random() * 2 * Math.PI;
  state.ball = {
    carrierId: null,
    pos: { ...car.pos },
    vel: scale({ x: Math.cos(angle), y: Math.sin(angle) }, FUMBLE_BALL_SPEED),
  };
}

/**
 * One pass over defender/carrier pairs in tackle range. Called every physics
 * sub-step by turn.js, so cooldowns keep a broken tackle from re-rolling
 * thirty times in one contact.
 */
export function checkTackles(state, random) {
  const car = carrier(state);
  if (!car || state.deadReason) return [];
  const events = [];
  for (const d of state.players) {
    if (d.team !== 'defense' || d.tackleCooldown > 0) continue;
    if (dist(d.pos, car.pos) > reach(d) + car.radius) continue;
    if (random() < tackleProbability(state, d, car)) {
      if (random() < fumbleChance(car)) {
        dropBall(state, car, random);
        events.push({ type: 'fumble', by: d.id });
      } else {
        state.deadReason = 'tackled';
        events.push({ type: 'tackled', by: d.id });
      }
      return events; // one decisive event per sub-step is plenty
    }
    d.tackleCooldown = TACKLE_COOLDOWN_SUBSTEPS;
    events.push({ type: 'broken', by: d.id });
  }
  return events;
}

/** A loose ball is claimed by the first player touching it. */
export function checkPickup(state) {
  if (state.ball.carrierId !== null || !state.ball.pos || state.deadReason) return [];
  for (const p of state.players) {
    if (dist(p.pos, state.ball.pos) <= p.radius + 1) {
      state.ball = { carrierId: p.id, pos: null, vel: null };
      if (p.team === 'defense') state.deadReason = 'recovered';
      return [{ type: 'pickup', by: p.id, team: p.team }];
    }
  }
  return [];
}
