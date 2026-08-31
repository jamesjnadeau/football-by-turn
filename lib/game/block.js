/**
 * The cut block: an offensive lineman's "tucked special". Committing to it
 * on the first turn of a play (setMode, state.js) fires a discrete shove
 * against the nearest defender ahead of him — the one thing in this game
 * that moves a player by a scripted offset rather than letting physics work
 * it out over a turn, the same trick dropBall (rules.js) uses for a fumble's
 * pop-out. The turn after, turn.js walks him from this stance into the drive
 * phase (cutBlockDrive), where he is slow but hard to slide past —
 * modes.js and physics.js are where that phase's numbers actually live;
 * this file only owns the instant that starts it and the aura around it.
 */
import { add, sub, len, norm, scale, dot } from './vec.js';
import { CUT_BLOCK_ENGAGE_UNITS, CUT_BLOCK_PUSH_UNITS, CUT_BLOCK_IMPULSE_SPEED, STANCE_CONE_HALF_ANGLE } from './constants.js';

const CONE_COS = Math.cos(STANCE_CONE_HALF_ANGLE);

/**
 * The nearest defender ahead of `blocker` within cutting range, or null.
 * "Ahead" is the same wedge every other stance strikes in
 * (STANCE_CONE_HALF_ANGLE) measured against `heading` — the axis setMode is
 * about to freeze into `facing` — so a cut block only ever hits the man he
 * is squared up on, never someone lined up behind or beside him.
 */
function cutTarget(state, blocker, heading) {
  let best = null;
  let bestDist = Infinity;
  for (const d of state.players) {
    if (d.team !== 'defense') continue;
    const toD = sub(d.pos, blocker.pos);
    const dd = len(toD);
    if (dd === 0 || dd > blocker.radius + d.radius + CUT_BLOCK_ENGAGE_UNITS) continue;
    if (dot(norm(toD), heading) < CONE_COS) continue;
    if (dd < bestDist) { best = d; bestDist = dd; }
  }
  return best;
}

/**
 * The lunge: pushes the nearest defender ahead of `blocker` straight back
 * CUT_BLOCK_PUSH_UNITS and sets him staggering away at
 * CUT_BLOCK_IMPULSE_SPEED. Called once, from setMode, at the instant the
 * lineman commits — not a per-sub-step effect, so it happens before the
 * turn's own physics ever runs. Whatever the shove leaves overlapping a
 * third player is untangled by the very next stepPhysics call the same way
 * any other overlap is; this function does not resolve collisions itself.
 *
 * Returns the defender who was cut, or null if nobody was in range — a whiff
 * is legal; the lineman still enters the stance (setMode already decided
 * that), he just has nobody in front of him to cut.
 */
export function applyCutBlock(state, blocker, heading) {
  const target = cutTarget(state, blocker, heading);
  if (!target) return null;
  const dir = norm(sub(target.pos, blocker.pos));
  target.pos = add(target.pos, scale(dir, CUT_BLOCK_PUSH_UNITS));
  target.vel = scale(dir, CUT_BLOCK_IMPULSE_SPEED);
  return target;
}
