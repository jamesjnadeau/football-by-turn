/**
 * Which frame of a turn belongs to a given moment. The one DECISION inside
 * app/main.js's animate(), lifted out here so it can be tested without a
 * board -- the same discipline lib/game/turn.js's runTurn and
 * worker/match-engine.js already follow.
 *
 * It exists because walking the frames one timer at a time is not the same
 * thing as animating for half a second. A browser clamps setTimeout to about
 * a second in a tab that is not on screen, and stops requestAnimationFrame
 * there altogether. In a match one of the two windows is always the one the
 * coach is not looking at, so a 30-frame animation meant to take 0.5s took
 * something nearer 30 timer-seconds in that window -- and `animating` is what
 * gates End Turn, so that coach was locked out of his own board for longer
 * than the 12s turn clock he was being timed by, every turn, for ever.
 *
 * Reading the frame off the clock is what fixes it: a slow or throttled tab
 * SKIPS frames rather than falling behind, and the animation costs what it
 * says it costs wherever it runs.
 */

/**
 * The frame to draw `elapsed` ms into an animation of `count` frames meant to
 * last `total` ms, or null when the animation is over and the caller should
 * finish rather than draw again.
 */
export function frameAtElapsed(elapsed, total, count) {
  if (count <= 0) return null;
  if (elapsed >= total) return null;
  if (elapsed <= 0) return 0;
  // Clamped as well as floored: `total` is not always an exact multiple of the
  // per-frame interval, so the last sliver of the animation must not index off
  // the end of the frames.
  return Math.min(count - 1, Math.floor(elapsed / (total / count)));
}
