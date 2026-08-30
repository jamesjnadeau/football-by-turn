/**
 * One physics sub-step: steering toward each player's planned velocity,
 * integration, loose-ball roll, then pairwise collision resolution.
 *
 * The steering model: a plan is a target velocity (direction × throttle ×
 * the player's mode-capped max speed). Each sub-step the velocity moves
 * toward the target by at most ACCEL × accelMult × dt — so heavy modes cap
 * speed, and a charge (feet set last turn) closes the gap faster, which is
 * exactly the spec's "more forward momentum and power". The cap itself is the
 * stance's, not a plain circle: a defender who has broken down keeps full
 * speed along the axis he committed to and loses most of it across that axis.
 */
import { add, sub, scale, len, norm, clampLen, dot } from './vec.js';
import { maxSpeed, accelMult, effectiveMass, clampToStance } from './modes.js';
import { ACCEL, IDLE_DAMPING, BALL_FRICTION, FRICTION_BLOCK, FRICTION_RELEASE, FRICTION_HOLD, RELEASE_SPEED } from './constants.js';

function steer(player, dt) {
  if (player.plan) {
    const wanted = scale(player.plan.dir, player.plan.throttle * maxSpeed(player));
    // clampToStance, not clampLen: for a broken-down defender the limit is an
    // ellipse around his locked axis rather than a circle, so the same arrow
    // buys him a full sprint forward and only a shuffle sideways. Both the
    // target he steers toward and the velocity he ends up with go through it.
    const target = clampToStance(player, wanted);
    const change = clampLen(sub(target, player.vel), ACCEL * accelMult(player) * dt);
    player.vel = add(player.vel, change);
    player.vel = clampToStance(player, player.vel);
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
    // The no-pickup grace window burns down with the ball's flight, so every
    // sub-step nobody may claim it is a sub-step it has actually travelled.
    if (state.ball.loose > 0) state.ball.loose -= 1;
  }
  return resolveCollisions(state);
}

/**
 * Pairwise circle collision with positional correction and a friction
 * impulse. Restitution is zero — football players don't bounce. The
 * friction coefficient is contextual, which is where three spec lines live:
 * blocking hand-fighting (FRICTION_BLOCK), the lighter touch on a fast
 * release downfield (FRICTION_RELEASE above RELEASE_SPEED), and the extra
 * grab of a player holding position (FRICTION_HOLD).
 */
function frictionFor(a, b, tangentialSpeed) {
  if (a.mode === 'holding' || b.mode === 'holding') return FRICTION_HOLD;
  if (Math.abs(tangentialSpeed) > RELEASE_SPEED) return FRICTION_RELEASE;
  return FRICTION_BLOCK;
}

function resolveCollisions(state) {
  const contacts = [];
  const players = state.players;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const delta = sub(b.pos, a.pos);
      const d = len(delta);
      const overlap = a.radius + b.radius - d;
      if (overlap <= 0) continue;
      const n = d === 0 ? { x: 0, y: 1 } : scale(delta, 1 / d);
      const invA = 1 / effectiveMass(a);
      const invB = 1 / effectiveMass(b);
      const invSum = invA + invB;

      // Push out of overlap, split by inverse mass: the heavy (or holding) one holds ground.
      a.pos = add(a.pos, scale(n, -overlap * (invA / invSum)));
      b.pos = add(b.pos, scale(n, overlap * (invB / invSum)));

      const rv = sub(b.vel, a.vel);
      const vn = dot(rv, n);
      if (vn < 0) {
        // Normal impulse, restitution 0.
        const jn = -vn / invSum;
        a.vel = add(a.vel, scale(n, -jn * invA));
        b.vel = add(b.vel, scale(n, jn * invB));

        // Friction impulse along the tangent, clamped by the coefficient.
        const t = { x: -n.y, y: n.x };
        const vt = dot(rv, t);
        const mu = frictionFor(a, b, vt);
        const jtRaw = -vt / invSum;
        const jt = Math.max(-mu * jn, Math.min(mu * jn, jtRaw));
        a.vel = add(a.vel, scale(t, -jt * invA));
        b.vel = add(b.vel, scale(t, jt * invB));
      } else {
        // Not closing, but still in contact: rub friction directly on velocity
        // so a player sliding along another (route release, blocker riding a
        // rusher) is slowed even without a closing impulse to clamp against.
        const t = { x: -n.y, y: n.x };
        const vt = dot(rv, t);
        const mu = frictionFor(a, b, vt);
        const drag = vt * mu * 0.5;
        a.vel = add(a.vel, scale(t, drag * invA * effectiveMass(a) * (invA / invSum)));
        b.vel = add(b.vel, scale(t, -drag * invB * effectiveMass(b) * (invB / invSum)));
      }

      contacts.push({ a, b, point: add(a.pos, scale(n, a.radius)) });
    }
  }
  return contacts;
}
