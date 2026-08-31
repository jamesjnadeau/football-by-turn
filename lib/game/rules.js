/**
 * Football rules: tackles, fumbles, pickups (this half), dead-ball, downs
 * and scoring (Task 8's half). Physics moves bodies; this file decides what
 * the contact means. All randomness comes in through `random`.
 */
import { add, sub, len, dist, scale, norm } from './vec.js';
import { tackleReach, fumbleChance, effectiveMass, inStanceCone } from './modes.js';
import { carrier, getPlayer, ballPos, aimSnap, SNAPPER_ID } from './state.js';
import { yardsOfY, fieldPos, GOAL_YARD } from './view.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT } from '../field/geometry.js';
import { formationPlayers } from './state.js';
import { lobCatchable, lobLanded } from './lob.js';
import {
  TACKLE_BASE, PREPARED_TACKLE_BONUS, TUCK_BREAK_BONUS,
  NEARBY_RADIUS, NEARBY_BONUS, MOMENTUM_SCALE,
  TACKLE_COOLDOWN_SUBSTEPS, FUMBLE_BALL_SPEED,
  PICKUP_RADIUS_BONUS, FUMBLE_SPAWN_EPSILON, LOOSE_BALL_GRACE_SUBSTEPS,
  PASS_DEAD_SPEED, PENALTY_YARDS, MIN_SPOT_YARD, FIRST_DOWN_YARDS,
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
  // A lob spends the middle of its flight above everybody. Nobody may take it
  // there — not the receiver it was thrown to and not the defender standing
  // under it — until it comes back down inside the catch window at the end.
  if (state.ball.lob && !lobCatchable(state.ball.lob)) return [];
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
 * hit the ground" is modelled as the throw having decayed to PASS_DEAD_SPEED —
 * that mid-flight check only ever catches a throw soft enough to settle on its
 * own before the whistle.
 *
 * A forward pass is decided within the turn it was thrown, whichever way: the
 * `endOfTurn` call from turn.js, made once after the sub-step loop, is what
 * actually guarantees the ruling lands. BALL_FRICTION only decays a throw to
 * PASS_DEAD_SPEED after roughly 57 sub-steps, so no gesture a human can draw
 * settles inside its own 30-sub-step turn on the mid-flight check alone —
 * without the end-of-turn call an uncaught throw would stay a live ball into
 * the next turn, where a defender falling on it would wrongly turn an
 * incompletion into a recovery/turnover.
 *
 * A BACKWARD throw gets no such mercy, in either mode: a lateral on the
 * ground is a live ball, which is exactly what the loose-ball machinery
 * already does with it. Only `forward` throws are ever checked.
 *
 * A LOB is ruled where it lands rather than when the whistle blows. Hanging
 * past the end of the turn is the whole point of throwing one — the coach gets
 * a planning phase to run somebody under it — so until it is down there is
 * nothing to rule, `endOfTurn` or not.
 */
export function checkIncomplete(state, { endOfTurn = false } = {}) {
  if (state.deadReason || state.ball.carrierId !== null || !state.ball.forward) return [];
  if (state.ball.lob) {
    if (!lobLanded(state.ball.lob)) return [];
  } else if (!endOfTurn && len(state.ball.vel) > PASS_DEAD_SPEED) return [];
  state.deadReason = 'incomplete';
  return [{ type: 'incomplete' }];
}

/**
 * Touchdown and out-of-bounds. Tackles and recoveries set deadReason
 * themselves. Out-of-bounds checks both a carrier's position and a loose
 * ball's — a thrown or fumbled ball that sails past the sideline has to end
 * the play too, or it would just sit out there live and unclaimed.
 */
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
  // A forward lob is in the air, and the air over the sideline is not out of
  // bounds. It is ruled where it comes down, and a forward pass coming down is
  // an incompletion whichever side of the paint it lands on — checkIncomplete
  // has that ruling, and this check would otherwise beat it to the whistle.
  // A BACKWARD lob is a lateral: on the ground or over the paint, the ordinary
  // loose-ball rule is the right one.
  const airborne = state.ball.lob && state.ball.forward;
  if (!car && !airborne && (bp.x < SIDELINE_LEFT || bp.x > SIDELINE_RIGHT)) {
    state.deadReason = 'out-of-bounds';
    return [{ type: 'out-of-bounds' }];
  }
  return [];
}

/**
 * The between-downs bookkeeping: any flag the down earned, whether it earned
 * a fresh set of downs, and — the only way this game ends short of a score —
 * whether a failed 4th down just lost the offense the ball.
 *
 * A flag is enforced unless the defense would rather have the football: when
 * the play ended in a defensive recovery — an interception, or a fumble they
 * fell on — they decline it and keep the ball. That is the whole decline rule
 * here, the one case where declining is obviously right. No menu, no prompt.
 *
 * Enforcement wipes whatever the illegal play produced, a touchdown included,
 * and spots the ball PENALTY_YARDS behind the previous line of scrimmage. The
 * down still counts — real football's "loss of down" — and, since enforcement
 * always wipes the play's own yardage, it is also never a first down whatever
 * the wiped play gained (design decision 5).
 *
 * Spot = the ball's yard when the play died, clamped so a deep sack can't
 * push the formation out of frame or behind the offense's own goal. Two
 * cases ignore where the ball stopped: an enforced flag comes back from the
 * previous line, and so does an incomplete pass, which by rule gains
 * nothing.
 */
export function nextDown(state) {
  const enforcing = state.penalty && state.deadReason !== 'recovered';
  if (!enforcing) {
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
  }
  const raw =
    enforcing ? state.penalty.spot - PENALTY_YARDS
    : state.deadReason === 'incomplete' ? state.losYard
    : yardsOfY(ballPos(state).y);
  const spot = Math.max(MIN_SPOT_YARD, Math.min(GOAL_YARD - 0.5, raw));
  const gotFirstDown = !enforcing && spot >= state.toGoYard;
  if (!gotFirstDown && state.down >= 4) {
    state.phase = 'gameOver';
    state.result = 'turnover-on-downs';
    return;
  }
  state.down = gotFirstDown ? 1 : state.down + 1;
  state.losYard = spot;
  if (gotFirstDown) state.toGoYard = Math.min(spot + FIRST_DOWN_YARDS, GOAL_YARD);
  state.phase = 'planning';
  state.turnIndex = 0;
  state.players = formationPlayers(spot, state.variantId);
  state.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  state.deadReason = null;
  state.plannedPass = null;
  state.forwardPasses = 0;
  state.penalty = null;
  // Everyone is back in formation with the ball on the centre, so the down
  // comes up ready to snap, the same as the first one did.
  aimSnap(state);
}
