/**
 * Football rules: tackles, fumbles, pickups (this half), dead-ball, downs
 * and scoring (Task 8's half). Physics moves bodies; this file decides what
 * the contact means. All randomness comes in through `random`.
 */
import { add, sub, len, dist, scale, norm } from './vec.js';
import { tackleReach, fumbleChance, effectiveMass, inStanceCone } from './modes.js';
import { carrier, getPlayer, ballPos } from './state.js';
import { yardsOfY, fieldPos, GOAL_YARD, TOP_YARD } from './view.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT } from '../field/geometry.js';
import { formationPlayers } from './state.js';
import {
  TACKLE_BASE, PREPARED_TACKLE_BONUS, TUCK_BREAK_BONUS,
  NEARBY_RADIUS, NEARBY_BONUS, MOMENTUM_SCALE,
  TACKLE_COOLDOWN_SUBSTEPS, FUMBLE_BALL_SPEED,
  PICKUP_RADIUS_BONUS, FUMBLE_SPAWN_EPSILON, LOOSE_BALL_GRACE_SUBSTEPS,
  PASS_DEAD_SPEED,
} from './constants.js';

/**
 * P(tackle succeeds) = tackleScore / (tackleScore + breakScore).
 *
 * The spec's balance point is engineered in, not tuned in: with both players
 * the same size and stationary and the carrier square in the defender's
 * wedge, tucked-vs-prepared gives (BASE + PREPARED_TACKLE_BONUS) vs
 * (BASE + TUCK_BREAK_BONUS) = 2 vs 2 = 0.5 exactly. Momentum terms are
 * symmetric (mass × speed on each side) so the balance holds whenever "all
 * other things" really are equal.
 *
 * The power bonus itself only pays off when the hit is actually square: a
 * defender who broke down facing the wrong way is still braced against
 * nothing, so PREPARED_TACKLE_BONUS is gated by the same wedge tackleReach
 * uses. Getting behind him should mean getting behind his stance too.
 */
export function tackleProbability(state, defender, car) {
  let tackle = TACKLE_BASE;
  if (defender.mode === 'prepared' && inStanceCone(defender, sub(car.pos, defender.pos))) {
    tackle += PREPARED_TACKLE_BONUS;
  }
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

/**
 * The ball pops out along one random direction — the same `dir` sets both the
 * spawn offset and the velocity, so the ball leaves from the side it flies
 * toward. It spawns strictly outside the fumbler's own scoop range
 * (radius + PICKUP_RADIUS_BONUS, the exact radius checkPickup uses) and
 * carries a `loose` grace countdown during which nobody may claim it; without
 * both, the fumbler stands on top of the ball and re-takes it the same
 * sub-step, which makes fumbles inert.
 */
function dropBall(state, car, random) {
  const angle = random() * 2 * Math.PI;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const offset = car.radius + PICKUP_RADIUS_BONUS + FUMBLE_SPAWN_EPSILON;
  state.ball = {
    carrierId: null,
    pos: add(car.pos, scale(dir, offset)),
    vel: scale(dir, FUMBLE_BALL_SPEED),
    loose: LOOSE_BALL_GRACE_SUBSTEPS,
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
    // Reach is the defender's stance reach, which for a broken-down defender is
    // doubled inside the wedge he committed to — so where he is looking decides
    // whether a runner this far out is in range at all.
    const toCar = sub(car.pos, d.pos);
    if (len(toCar) > tackleReach(d, toCar) + car.radius) continue;
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

/**
 * A loose ball is claimed by the first player touching it — but not while its
 * `loose` grace countdown (ticked down once per sub-step by stepPhysics) is
 * still running. That window is what makes a fumble a live ball rather than a
 * formality: it gives the pop-out time to travel away from the pile.
 */
export function checkPickup(state) {
  if (state.ball.carrierId !== null || !state.ball.pos || state.deadReason) return [];
  if (state.ball.loose > 0) return [];
  for (const p of state.players) {
    if (dist(p.pos, state.ball.pos) <= p.radius + PICKUP_RADIUS_BONUS) {
      state.ball = { carrierId: p.id, pos: null, vel: null };
      if (p.team === 'defense') state.deadReason = 'recovered';
      return [{ type: 'pickup', by: p.id, team: p.team }];
    }
  }
  return [];
}

/**
 * A forward pass nobody caught. There is no z axis in this game, so "the ball
 * hit the ground" is modelled as the throw having decayed to PASS_DEAD_SPEED:
 * at that point the play is dead, the down counts, and nextDown spots the ball
 * back at the previous line — an incomplete pass gains nothing.
 *
 * A BACKWARD throw gets no such mercy, and needs no code here: a lateral on
 * the ground is a live ball, which is exactly what the loose-ball machinery
 * already does with it. Only `forward` throws are checked.
 */
export function checkIncomplete(state) {
  if (state.deadReason || state.ball.carrierId !== null || !state.ball.forward) return [];
  if (len(state.ball.vel) > PASS_DEAD_SPEED) return [];
  state.deadReason = 'incomplete';
  return [{ type: 'incomplete' }];
}

/** Touchdown and out-of-bounds. Tackles and recoveries set deadReason themselves. */
export function checkDeadBall(state) {
  if (state.deadReason) return [];
  const car = carrier(state);
  const bp = ballPos(state);
  if (!bp) return [];
  // The plane is broken by the ball, drawn at the carrier's leading edge.
  const ballFrontY = car ? bp.y + car.radius : bp.y;
  if (car && car.team === 'offense' && yardsOfY(ballFrontY) >= GOAL_YARD) {
    state.deadReason = 'touchdown';
    return [{ type: 'touchdown' }];
  }
  if (car && (car.pos.x < SIDELINE_LEFT || car.pos.x > SIDELINE_RIGHT)) {
    state.deadReason = 'out-of-bounds';
    return [{ type: 'out-of-bounds' }];
  }
  return [];
}

/**
 * The between-downs bookkeeping. Spot = the ball's yard when the play died,
 * clamped so a deep sack can't push the formation out of frame.
 */
export function nextDown(state) {
  if (state.deadReason === 'touchdown') {
    state.phase = 'gameOver';
    state.result = 'touchdown';
    return;
  }
  if (state.deadReason === 'recovered') {
    state.phase = 'gameOver';
    state.result = 'turnover-fumble';
    return;
  }
  if (state.down >= 4) {
    state.phase = 'gameOver';
    state.result = 'turnover-on-downs';
    return;
  }
  const spot = Math.max(TOP_YARD + 8, Math.min(GOAL_YARD - 0.5, yardsOfY(ballPos(state).y)));
  state.down += 1;
  state.losYard = spot;
  state.phase = 'planning';
  state.turnIndex = 0;
  state.players = formationPlayers(spot);
  state.ball = { carrierId: 'o-qb', pos: null, vel: null };
  state.deadReason = null;
}
