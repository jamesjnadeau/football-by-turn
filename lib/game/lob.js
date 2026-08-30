/**
 * The lob: the throw that goes up.
 *
 * An ordinary throw is a loose ball with a big initial speed — physics.js rolls
 * it and friction decides where it stops. A lob cannot work that way. Its whole
 * point is that the ball spends the middle of its flight ABOVE the players, and
 * a board with no z axis has to say that some other way: with a flight plan
 * fixed at release (where it comes down, and how long it hangs), a stretch of
 * that flight where nobody may touch it, and a ball drawn bigger while it is up
 * there.
 *
 * So a lob is FLOWN, not rolled. Everything here is pure arithmetic over one
 * plain object:
 *
 *   {from: {x,y}, to: {x,y}, substeps: number, elapsed: number}
 *
 * `from` is the passer's hand, `to` is the spot it will come down on (already
 * scattered — see planLob), `substeps` is the hang time and `elapsed` is the
 * clock. Nothing here reads `state`, and nothing here imports pass.js: the
 * throw's own arithmetic lives there, and one direction of dependency is all
 * this feature needs.
 */
import { UNITS_PER_YARD_X } from '../field/geometry.js';
import { dist } from './vec.js';
import {
  LOB_LOCK_YARDS, LOB_CATCH_YARDS, LOB_SCATTER_PER_YARD, LOB_TIME_MULT,
  LOB_BALL_SCALE, PASS_REACH_MAX, SUBSTEPS_PER_TURN,
} from './constants.js';

/** The two zone boundaries, in board units — the spec's yardages, converted once. */
export const LOCK_UNITS = LOB_LOCK_YARDS * UNITS_PER_YARD_X;
export const CATCH_UNITS = LOB_CATCH_YARDS * UNITS_PER_YARD_X;

/**
 * Whether a throw that reaches this far arcs at all. At or inside the lock zone
 * it does not: the ball never leaves anybody's reach, so there is nothing for
 * the arc to model and it stays the ordinary rolling throw it has always been.
 */
export function isLob(distanceUnits) {
  return distanceUnits > LOCK_UNITS;
}

/** The radius of the landing circle for a lob this long, in units. */
export function scatterRadius(distanceUnits) {
  const overYards = Math.max(0, (distanceUnits - LOCK_UNITS) / UNITS_PER_YARD_X);
  return (LOB_CATCH_YARDS + LOB_SCATTER_PER_YARD * overYards) * UNITS_PER_YARD_X;
}

/**
 * A uniformly random point inside the circle of `radius` about `aim`.
 *
 * The square root is not decoration: drawing the radius flat would put half
 * of every throw inside the middle quarter of the circle, and the coach would
 * learn to treat the aim point as the landing spot. Area-uniform is what makes
 * the circle mean what it is drawn to mean.
 */
export function scatterPoint(aim, radius, random) {
  const r = radius * Math.sqrt(random());
  const a = 2 * Math.PI * random();
  return { x: aim.x + r * Math.cos(a), y: aim.y + r * Math.sin(a) };
}

/**
 * How many sub-steps a lob this long hangs, measured against the deepest throw
 * in the game: that one takes LOB_TIME_MULT turns, and everything shorter takes
 * its share. Never zero — a flight has to take some time, or the ball would
 * teleport and the zones would never be visited.
 */
export function lobSubsteps(distanceUnits) {
  const share = distanceUnits / PASS_REACH_MAX;
  return Math.max(1, Math.round(LOB_TIME_MULT * SUBSTEPS_PER_TURN * share));
}

/**
 * The flight plan for a throw from `from` aimed at `aim`. The scatter is rolled
 * HERE, once, at release — not per sub-step and not at paint time — so the ball
 * has a landing spot from the moment it leaves the hand and a seeded game
 * replays the same throw every time.
 */
export function planLob(from, aim, random) {
  const to = scatterPoint(aim, scatterRadius(dist(from, aim)), random);
  return { from: { ...from }, to, substeps: lobSubsteps(dist(from, to)), elapsed: 0 };
}

/** How far along its flight the ball is: 0 in the hand, 1 on the ground. */
export function lobProgress(lob) {
  return lob.substeps === 0 ? 1 : Math.min(1, lob.elapsed / lob.substeps);
}

/**
 * Where the ball is right now. A straight line at a constant pace: the arc is
 * vertical, and this game has no vertical — the height is told by lobBallScale
 * and by the stretch where nobody can catch it, not by bending the path across
 * the ground.
 */
export function lobPoint(lob) {
  const t = lobProgress(lob);
  return {
    x: lob.from.x + (lob.to.x - lob.from.x) * t,
    y: lob.from.y + (lob.to.y - lob.from.y) * t,
  };
}

export function lobLanded(lob) {
  return lob.elapsed >= lob.substeps;
}

/**
 * The stretch of the flight where the ball is above everybody, as distances
 * from the hand: from the lock zone's edge to a catch window short of the
 * landing spot. On a lob under LOB_LOCK_YARDS + LOB_CATCH_YARDS the two ends
 * cross over (`end <= start`) and there is no such stretch at all — that throw
 * arcs and scatters, but it is never out of reach.
 */
function deadZone(lob) {
  const total = dist(lob.from, lob.to);
  return { start: LOCK_UNITS, end: total - CATCH_UNITS, total };
}

/** Whether the ball can be taken where it is now, by either team. */
export function lobCatchable(lob) {
  const { start, end, total } = deadZone(lob);
  if (end <= start) return true;
  const flown = lobProgress(lob) * total;
  return flown <= start || flown >= end;
}

/**
 * How big to draw the ball: its ordinary size on the way out and on the way in,
 * LOB_BALL_SCALE at the top of the arc, and a half-sine between — so it grows
 * exactly where it stops being catchable and is back to size exactly where it
 * can be caught again. One number tells the coach both things at once.
 */
export function lobBallScale(lob) {
  const { start, end, total } = deadZone(lob);
  if (end <= start) return 1;
  const flown = lobProgress(lob) * total;
  if (flown <= start || flown >= end) return 1;
  return 1 + (LOB_BALL_SCALE - 1) * Math.sin(Math.PI * ((flown - start) / (end - start)));
}

/** One sub-step of flight. Returns where the ball has got to. */
export function stepLob(lob) {
  if (lob.elapsed < lob.substeps) lob.elapsed += 1;
  return lobPoint(lob);
}

/**
 * How big to draw whatever ball this is. The one entry point for the renderer
 * and for turn.js's frames, so neither has to know whether a ball is lobbing.
 */
export function ballScale(ball) {
  return ball && ball.lob ? lobBallScale(ball.lob) : 1;
}
