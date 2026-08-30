/**
 * What a mode does to a player's numbers, and which way a stance points. The
 * one place `player.mode` is interpreted — physics and rules ask these
 * functions, so a new mode (or a retuned one) is a change here and in
 * constants.js, nowhere else.
 */
import { norm, dot, len, add, scale, clampLen } from './vec.js';
import {
  SPEED_FACTOR, TUCK_SPEED_MULT, STANCE_LATERAL_MULT, HOLD_SPEED_MULT,
  PREPARED_REACH, HOLD_REACH, HOLD_MASS_MULT, CHARGE_MULT,
  PREPARED_REACH_MULT, STANCE_CONE_HALF_ANGLE,
  FUMBLE_UNTUCKED, FUMBLE_TUCKED,
} from './constants.js';

const SPEED_MULT = { normal: 1, tucked: TUCK_SPEED_MULT, prepared: 1, holding: HOLD_SPEED_MULT };
const REACH_BONUS = { normal: 0, tucked: 0, prepared: PREPARED_REACH, holding: HOLD_REACH };

/**
 * Top speed in the best case. For a broken-down defender that best case is
 * along his locked axis only — clampToStance is what applies the sideways tax,
 * so anything that wants a player's real speed limit in a given direction must
 * go through that rather than reading this number as a circle.
 */
export function maxSpeed(player) {
  return (SPEED_FACTOR / player.radius) * SPEED_MULT[player.mode];
}

export function reach(player) {
  return player.radius + REACH_BONUS[player.mode];
}

export function effectiveMass(player) {
  return player.mass * (player.mode === 'holding' ? HOLD_MASS_MULT : 1);
}

export function accelMult(player) {
  return player.charge ? CHARGE_MULT : 1;
}

export function fumbleChance(player) {
  return player.mode === 'tucked' ? FUMBLE_TUCKED : FUMBLE_UNTUCKED;
}

/**
 * Which way a player is pointed: the way he is actually moving, else the
 * arrow he was given, else the way his team faces from the snap. A special
 * move commits to real momentum, not to the arrow just drawn — a body cannot
 * pivot instantly, so the plan arrow is only the fallback for a player with
 * no momentum yet (e.g. at the snap). state.js freezes this into `facing`
 * when a player commits to a stance, and render.js draws the stance arc from
 * it, so the picture and the hitbox agree by construction.
 */
export function headingOf(player) {
  if (player.vel && (player.vel.x !== 0 || player.vel.y !== 0)) return norm(player.vel);
  if (player.plan) return norm(player.plan.dir);
  return { x: 0, y: player.team === 'offense' ? 1 : -1 };
}

const CONE_COS = Math.cos(STANCE_CONE_HALF_ANGLE);

/**
 * Whether `toTarget` falls inside the wedge a player with a locked axis is
 * facing — the one geometry test both the reach bonus (tackleReach, prepared
 * only) and the tackle-power bonus (rules.js's tackleProbability, also
 * prepared only) key off, so "which way he's squared up" means the same thing
 * to both. False for anyone with no locked facing at all, and for a
 * zero-length offset, which has no direction to judge.
 */
export function inStanceCone(player, toTarget) {
  if (!player.facing || len(toTarget) === 0) return false;
  return dot(norm(toTarget), player.facing) >= CONE_COS;
}

/**
 * How far this player can reach toward something at offset `toTarget` from
 * him. A circle for everyone — except a defender who has broken down, who
 * reaches PREPARED_REACH_MULT times as far inside the wedge he committed to.
 * Only the angle matters here; how far away the target actually is is the
 * caller's comparison to make.
 */
export function tackleReach(player, toTarget) {
  const r = reach(player);
  if (player.mode !== 'prepared') return r;
  return inStanceCone(player, toTarget) ? r * PREPARED_REACH_MULT : r;
}

/**
 * Hold a velocity inside what the player's stance allows. A circle for
 * everyone in `normal` mode — anyone who has committed to a special move
 * (tucked, prepared, holding — anything with a locked `facing`) instead gets
 * an ellipse flattened across that axis: full speed either way ALONG it, a
 * shuffle across it. The two components are clamped independently, so
 * committing forward never costs him his drive; it costs him the cut.
 */
export function clampToStance(player, v) {
  const top = maxSpeed(player);
  if (!player.facing) return clampLen(v, top);
  const f = player.facing;
  const side = { x: -f.y, y: f.x };
  const along = Math.max(-top, Math.min(top, dot(v, f)));
  const lateralCap = top * STANCE_LATERAL_MULT;
  const across = Math.max(-lateralCap, Math.min(lateralCap, dot(v, side)));
  return add(scale(f, along), scale(side, across));
}
