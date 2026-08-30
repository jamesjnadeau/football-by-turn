/**
 * One physics sub-step: steering toward each player's planned velocity,
 * integration, loose-ball roll, then pairwise collision resolution.
 *
 * The steering model: a plan is a target velocity (direction × throttle ×
 * the player's mode-capped max speed). Each sub-step the velocity moves
 * toward the target by at most ACCEL × accelMult × dt — so heavy modes cap
 * speed, and a charge (feet set last turn) closes the gap faster, which is
 * exactly the spec's "more forward momentum and power".
 */
import { add, sub, scale, len, norm, clampLen } from './vec.js';
import { maxSpeed, accelMult, effectiveMass } from './modes.js';
import { ACCEL, IDLE_DAMPING, BALL_FRICTION } from './constants.js';

function steer(player, dt) {
  if (player.plan) {
    const target = scale(player.plan.dir, player.plan.throttle * maxSpeed(player));
    const change = clampLen(sub(target, player.vel), ACCEL * accelMult(player) * dt);
    player.vel = add(player.vel, change);
    player.vel = clampLen(player.vel, maxSpeed(player));
  } else {
    player.vel = scale(player.vel, IDLE_DAMPING);
  }
  player.pos = add(player.pos, scale(player.vel, dt));
}

export function stepPhysics(state, dt) {
  for (const p of state.players) {
    steer(p, dt);
    if (p.tackleCooldown > 0) p.tackleCooldown -= 1;
  }
  if (state.ball.carrierId === null && state.ball.pos) {
    state.ball.pos = add(state.ball.pos, scale(state.ball.vel, dt));
    state.ball.vel = scale(state.ball.vel, BALL_FRICTION);
  }
  return resolveCollisions(state);
}

/** Task 6 replaces this stub with real circle collision + friction. */
function resolveCollisions(state) {
  return [];
}
