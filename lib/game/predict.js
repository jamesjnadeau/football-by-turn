/**
 * Where a plan lands. The board now shows a player the spot he will actually
 * reach this turn rather than an arrow of abstract force, and that promise is
 * only keepable if the preview and the simulation are the same arithmetic — so
 * this module replays physics.js's own `steer` on a throwaway clone for a whole
 * turn. What it deliberately does NOT model is contact: it is one player alone
 * on the field. A blocker in his way is exactly the sort of thing the player is
 * supposed to be planning around, and a preview that quietly folded in a
 * collision that has not happened yet would be predicting his opponent's turn
 * as well as his own.
 */
import { steer } from './physics.js';
import { norm, len, sub, dot } from './vec.js';
import { DT, SUBSTEPS_PER_TURN } from './constants.js';

/** How many halvings the throttle solver takes: 2^-24 of the range, plenty. */
const SOLVE_STEPS = 24;

/** A private copy deep enough that steering it cannot touch the real player. */
function ghost(player, dir, throttle) {
  return {
    ...player,
    pos: { ...player.pos },
    vel: { ...player.vel },
    plan: { dir, throttle, target: null },
  };
}

/** Where one uncontested turn at this plan leaves him, in board coordinates. */
export function predictDestination(player, dir, throttle) {
  const g = ghost(player, dir, throttle);
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) steer(g, DT);
  return g.pos;
}

/**
 * How far he gets ALONG `dir` — a signed projection, not a distance. A player
 * with momentum across the arrow drifts sideways, and measuring the raw
 * displacement would credit that drift as progress toward where the user
 * pointed. It also keeps the quantity monotonic in throttle, which is what
 * lets throttleForDistance bisect it.
 */
export function travelAlong(player, dir, throttle) {
  return dot(sub(predictDestination(player, dir, throttle), player.pos), dir);
}

export function maxTravelAlong(player, dir) {
  return travelAlong(player, dir, 1);
}

/**
 * The throttle that covers `distance` along `dir` this turn, by bisection —
 * there is no closed form once clampToStance's ellipse is in play. Saturates at
 * both ends rather than failing: asking for more than he has gives 1, and
 * asking for less than he coasts (throttle 0 still leaves a moving player
 * drifting) gives 0.
 */
export function throttleForDistance(player, dir, distance) {
  if (distance >= maxTravelAlong(player, dir)) return 1;
  if (distance <= travelAlong(player, dir, 0)) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < SOLVE_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (travelAlong(player, dir, mid) < distance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A drag, read as a destination. `travel` is the raw drag vector from
 * gesture.js: its direction is where the player is being sent and its LENGTH is
 * how far, in board units, rather than an abstract throttle.
 *
 * `target` is the contract with the renderer. Non-null means "he lands here,
 * draw the circle"; null means the user pointed past what a half-second buys
 * and the old arrow is drawn instead, at full throttle — the honest reading of
 * a drag that asks for more ground than exists.
 *
 * The target is the PREDICTED spot, not the drag point. They agree to within
 * the solver's tolerance whenever the player has no sideways momentum, and when
 * he does the predicted spot is the true one — the circle never lies about
 * where he ends up.
 */
export function planForDrag(player, travel) {
  const d = len(travel);
  if (d === 0) return { dir: { x: 0, y: 0 }, throttle: 0, target: null };
  const dir = norm(travel);
  if (d > maxTravelAlong(player, dir)) return { dir, throttle: 1, target: null };
  const throttle = throttleForDistance(player, dir, d);
  return { dir, throttle, target: predictDestination(player, dir, throttle) };
}
