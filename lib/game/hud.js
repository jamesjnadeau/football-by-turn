/**
 * Turning state into the down/distance/spot line a broadcast graphic would
 * show. Pure and DOM-free like the rest of lib/game/ — app/main.js is the
 * only thing that ever writes this into the page.
 */
import { GOAL_YARD } from './view.js';

const ORDINALS = ['1st', '2nd', '3rd', '4th'];

export function spotText(yard) {
  const y = Math.round(yard);
  if (y === 50) return '50';
  return y < 50 ? `OWN ${y}` : `OPP ${100 - y}`;
}

export function downDistanceText(state) {
  const toGo = state.toGoYard >= GOAL_YARD
    ? 'Goal'
    : String(Math.max(0, Math.round(state.toGoYard - state.losYard)));
  return `${ORDINALS[state.down - 1]} & ${toGo} at the ${spotText(state.losYard)}`;
}
