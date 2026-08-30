/**
 * Pointer-log → intent. The spec's three verbs on a player are a click
 * (reposition, pre-snap only), a hold-and-drag (set direction and force),
 * and a long press (toggle a stance mode). Movement beats duration: a slow
 * deliberate drag must never register as a long press.
 */
import { sub, len, norm } from './vec.js';
import { MAX_ARROW_UNITS } from './constants.js';

export const DRAG_MIN_UNITS = 4;
export const LONGPRESS_MS = 500;

export function classifyGesture(log) {
  const down = log[0];
  const up = log[log.length - 1];
  const travel = sub(up, down);
  if (len(travel) >= DRAG_MIN_UNITS) {
    return {
      kind: 'drag',
      dir: norm(travel),
      throttle: Math.min(1, len(travel) / MAX_ARROW_UNITS),
    };
  }
  if (up.t - down.t >= LONGPRESS_MS) return { kind: 'longpress' };
  return { kind: 'click' };
}
