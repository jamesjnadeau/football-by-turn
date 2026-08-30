/**
 * Pointer-log → intent. The spec's verbs on a player are a click (reposition,
 * pre-snap only), a hold-and-drag (set direction and force), a long press
 * (toggle a stance mode), and a tap-then-drag (throw the ball). Movement beats
 * duration: a slow deliberate drag must never register as a long press.
 */
import { sub, len, norm } from './vec.js';
import { MAX_ARROW_UNITS } from './constants.js';

export const DRAG_MIN_UNITS = 4;
export const LONGPRESS_MS = 500;
export const DOUBLE_TAP_MS = 400;

/**
 * `prevClickAt` is when THIS SAME player was last tapped, or null if he wasn't
 * (app/input.js keeps that book, because it is pointer state). A drag that
 * begins within DOUBLE_TAP_MS of that tap is the spec's double-tap-then-drag:
 * a throw rather than a run. It carries the same direction and throttle as a
 * run drag — only the verb changes — so the caller reads one field to tell
 * them apart.
 */
export function classifyGesture(log, prevClickAt = null) {
  const down = log[0];
  const up = log[log.length - 1];
  const travel = sub(up, down);
  if (len(travel) >= DRAG_MIN_UNITS) {
    const armed = prevClickAt !== null && down.t - prevClickAt <= DOUBLE_TAP_MS;
    return {
      kind: armed ? 'passdrag' : 'drag',
      dir: norm(travel),
      throttle: Math.min(1, len(travel) / MAX_ARROW_UNITS),
      // The raw vector as well as the unit direction, because a run drag is
      // read two ways now: as a force (throttle, above — still what a throw
      // uses) and as a distance on the board, which is what predict.js turns
      // into the spot the player will actually reach.
      travel,
    };
  }
  if (up.t - down.t >= LONGPRESS_MS) return { kind: 'longpress' };
  return { kind: 'click' };
}
