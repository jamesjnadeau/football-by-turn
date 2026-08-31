/**
 * Chasing the ball: the one aiming rule the pursuit brain, the smart brain's
 * loose-ball scramble and the offense's own autoplan all share. A leaf
 * module — it reads state.js and modes.js and nothing reads it back — so
 * both ai.js and offense.js may import it without forming a cycle.
 */
import { add, sub, len, scale } from './vec.js';
import { ballPos, carrier } from './state.js';
import { maxSpeed } from './modes.js';
import { AI_LEAD_MAX_SECONDS } from './constants.js';

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
  if (!car || car.id === player.id) return { ...bp };
  const t = Math.min(AI_LEAD_MAX_SECONDS, len(sub(bp, player.pos)) / maxSpeed(player));
  return add(bp, scale(car.vel, t));
}
