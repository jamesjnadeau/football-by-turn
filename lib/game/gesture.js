/**
 * Pointer-log → intent. The verbs on a player are a click (reposition,
 * pre-snap only), a hold-and-drag (set direction and force), a double tap
 * (toggle a stance mode), and a double-tap-then-drag (throw the ball). Two
 * facts decide all four: did the pointer travel, and was this same player
 * tapped a moment ago. Duration decides nothing — a slow deliberate drag is a
 * drag, and a press held for a second is a tap.
 */
import { sub, len, norm } from './vec.js';
import { MAX_ARROW_UNITS } from './constants.js';

export const DRAG_MIN_UNITS = 4;
export const DOUBLE_TAP_MS = 400;

/**
 * `prevClickAt` is when THIS SAME player was last tapped, or null if he wasn't
 * (app/input.js keeps that book, because it is pointer state). A gesture that
 * begins within DOUBLE_TAP_MS of that tap is the second half of a double tap:
 * released in place it is the stance toggle, and dragged away it is a throw
 * rather than a run. A throw carries the same direction and throttle as a run
 * drag — only the verb changes — so the caller reads one field to tell them
 * apart.
 *
 * What separates a drag from a tap is DISPLACEMENT, not path length, and that
 * is load-bearing for the cancel: a second tap that wanders out and comes back
 * to where it started is a `doubletap` here, with nobody having to ask about
 * it. The rest of "drag back onto the player" — coming up on his far edge,
 * further from the start than DRAG_MIN_UNITS but still on his body — is
 * geometry about the player rather than about the pointer, so it belongs to
 * the caller (pass.js's backOnPasser).
 */
export function classifyGesture(log, prevClickAt = null) {
  const down = log[0];
  const up = log[log.length - 1];
  const travel = sub(up, down);
  const armed = prevClickAt !== null && down.t - prevClickAt <= DOUBLE_TAP_MS;
  if (len(travel) >= DRAG_MIN_UNITS) {
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
  return { kind: armed ? 'doubletap' : 'click' };
}
