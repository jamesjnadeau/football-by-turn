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

/**
 * Which side the human is coaching: the team the computer is not. Null in
 * hot-seat, where both teams are the human's and nobody gets to gloat.
 */
export function humanSide(state) {
  if (state.aiTeam === 'offense') return 'defense';
  if (state.aiTeam === 'defense') return 'offense';
  return null;
}

/**
 * The side a coach's own controls act on. His own team when the computer has
 * the other one; in hot-seat, where both teams are his, the offense — the
 * drive is still the thing being scripted. playbook.js's playbookSide and
 * autoplan.js's 🎁 both need exactly this answer, and a button that disagreed
 * with the book beside it would be a bug nobody could see.
 */
export function coachedSide(state) {
  return humanSide(state) ?? 'offense';
}

/**
 * The final call, from the human's own point of view. These strings lived
 * inline in app/main.js while the human could only ever be the offense;
 * a touchdown stopped being unconditionally "you win" the moment a coach
 * could pick the other side, so the words moved here where a test can hold
 * every combination.
 */
export function gameOverMessage(state) {
  const side = humanSide(state);
  if (state.result === 'touchdown') {
    if (side === 'offense') return 'TOUCHDOWN — you win!';
    if (side === 'defense') return 'Touchdown. Game over — you lose.';
    return 'TOUCHDOWN — offense wins!';
  }
  const call = state.result === 'turnover-on-downs' ? 'Turnover on downs' : 'Turnover';
  if (side === 'offense') return `${call}. Game over — you lose.`;
  if (side === 'defense') return `${call} — you win!`;
  return `${call} — defense wins!`;
}

/** The New Game opening line, facing whichever way the human is facing.
 *  Hot-seat reads as the offense line — the drive is still yours to script. */
export function kickoffMessage(state) {
  return humanSide(state) === 'defense'
    ? 'New game. They start 1st and 10 from their own 20 — keep them out of the house.'
    : 'New game. 1st and 10 from your own 20 — 80 yards to the house.';
}
