/**
 * Learned starting positions: where a genome says each defender stands at
 * the snap. The one mutating module in learned/ — it writes player.pos the
 * way formation.js's placeFormation does, during planning of turn 0 only.
 *
 * Deliberately imports NOTHING from state.js, defense.js or formation.js:
 * createGame (state.js) has to be able to call maybeApplyLearnedFormations,
 * so this module reaches no further than view/vec/geometry and the genome
 * files. The little legality machinery it needs — inbounds clamp, occupied-
 * spot nudge — is its own (same shape as formation.js's clearX, same
 * constants-by-value), and the tests hold every spot it produces against
 * formation.js's own spotFault so the two rulebooks cannot drift apart
 * silently.
 */
import { fieldPos } from '../view.js';
import { dist } from '../vec.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT, hashCentresX } from '../../field/geometry.js';
import { clampGenome } from './genome.js';
import { DEFENSE_SPEC, DEFENSE_VARIANT } from './defense-spec.js';
import { activeGenome } from './active.js';
import { OFFENSE_SPEC, OFFENSE_VARIANT } from './offense-spec.js';
import { baseVariantId } from '../rosters.js';

const NUDGE_UNITS = 1;
const NUDGE_STEPS = 200;
// Keep a deep-genome spot on the drawn field even when the line of scrimmage
// is deep in the red zone (END_YARD is 110; 108 leaves a body's clearance).
export const MAX_YARD = 108;

function inbounds(x, radius) {
  return Math.max(SIDELINE_LEFT + radius, Math.min(SIDELINE_RIGHT - radius, x));
}

/** The nearest clear x to `want` at depth `y` — formation.js's clearX,
 *  re-kept here (see the module comment for why it cannot be imported). */
function clearX(placed, want, y, radius) {
  for (let k = 0; k <= NUDGE_STEPS; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const x = inbounds(want + sign * k * NUDGE_UNITS, radius);
      if (!placed.some((q) => dist(q.pos, { x, y }) < q.radius + radius)) return x;
    }
  }
  return inbounds(want, radius);
}

/**
 * The genome's spots for this defense, clamped legal: on the defense's own
 * side (the spec's own down >= 0.5 floor), on the drawn field, inside the
 * sidelines, clear of everyone already standing — the offense as it is, and
 * teammates as they are placed. Ids the genome does not name keep their
 * roster spot (they are simply absent from the result).
 */
export function learnedDefenseSpots(state, values) {
  const g = clampGenome(DEFENSE_SPEC, values);
  const placed = state.players
    .filter((p) => p.team !== 'defense')
    .map((p) => ({ radius: p.radius, pos: p.pos }));
  const spots = [];
  for (const p of state.players) {
    if (p.team !== 'defense') continue;
    const across = g[`pos:${p.id}:across`];
    if (typeof across !== 'number') continue;
    const down = Math.min(g[`pos:${p.id}:down`], MAX_YARD - state.losYard);
    const want = fieldPos(across, state.losYard + down);
    const x = clearX(placed, want.x, want.y, p.radius);
    const pos = { x, y: want.y };
    placed.push({ radius: p.radius, pos });
    spots.push({ id: p.id, pos });
  }
  return spots;
}

/**
 * Write the genome's formation onto the board. A formation is what you come
 * to the line with, so this is gated exactly as placePlayer is: planning
 * phase, turn 0, and never after. A moved man's plan and cover are wiped —
 * an order worked out from where he used to stand is a lie now, the same
 * rule placeFormation keeps.
 */
export function applyLearnedDefenseFormation(state, values) {
  if (state.phase !== 'planning' || state.turnIndex !== 0) return false;
  for (const { id, pos } of learnedDefenseSpots(state, values)) {
    const p = state.players.find((pl) => pl.id === id);
    p.pos = pos;
    p.plan = null;
    p.cover = null;
  }
  return true;
}

/**
 * True exactly when the computer is coaching defense with a learned genome
 * trained for the variant currently on the board. Factored out so that
 * maybeApplyLearnedFormations (below) and formation.js's answerOffense share
 * one gate instead of two copies of the same three comparisons — the module
 * comment's "two rulebooks cannot drift apart silently" promise, applied to
 * this condition as much as to the spots themselves.
 *
 * Compares on baseVariantId, not variantId, because nickel and dime are
 * personnel packages within the seven-a-side game, not different games — a
 * genome trained for '7' is trained for the same field, the same roster
 * slots, the same rules, just with a sub or two swapped in. The distinction
 * this gate exists to draw is seven-a-side against eleven, not package
 * against package.
 */
export function isLearnedDefense(state) {
  return state.aiTeam === 'defense' && state.aiLevel === 'learned'
    && baseVariantId(state.variantId) === DEFENSE_VARIANT;
}

/**
 * The game hook createGame and nextDown call at the top of every down: if
 * the computer is coaching a learned-level team in the variant its genome
 * was trained for, its formation goes on the board — visibly, during
 * planning, exactly as the roster's own alignment does. The human gets to
 * see it and answer it; only the computer's IN-PLAY intentions are hidden
 * (ai.js's whole design), not where its men are standing.
 */
export function maybeApplyLearnedFormations(state) {
  if (isLearnedDefense(state)) {
    applyLearnedDefenseFormation(state, activeGenome(state, 'defense'));
  }
  if (state.aiTeam === 'offense' && state.aiLevel === 'learned'
    && state.variantId === OFFENSE_VARIANT) {
    applyLearnedOffenseFormation(state, activeGenome(state, 'offense'));
  }
}

/**
 * The genome's spots for the offense. Legality is mostly the SPEC's doing —
 * the line five's `down` range keeps minOnLine satisfied, and no `down` may
 * reach past the line — so what is enforced here is what a range cannot
 * express: the snapper stands between the hashes (the ball is spotted
 * there; formation.js's spotFault refuses him anywhere else), everyone is
 * inside the sidelines, and nobody stands inside another body.
 */
export function learnedOffenseSpots(state, values) {
  const g = clampGenome(OFFENSE_SPEC, values);
  const [hashLeft, hashRight] = hashCentresX();
  const placed = state.players
    .filter((p) => p.team !== 'offense')
    .map((p) => ({ radius: p.radius, pos: p.pos }));
  const spots = [];
  for (const p of state.players) {
    if (p.team !== 'offense') continue;
    const across = g[`pos:${p.id}:across`];
    if (typeof across !== 'number') continue;
    const want = fieldPos(across, state.losYard + g[`pos:${p.id}:down`]);
    if (p.id === state.ball.carrierId) {
      want.x = Math.max(hashLeft, Math.min(hashRight, want.x));
    }
    const x = clearX(placed, want.x, want.y, p.radius);
    const pos = { x, y: want.y };
    placed.push({ radius: p.radius, pos });
    spots.push({ id: p.id, pos });
  }
  return spots;
}

/** The offense twin of applyLearnedDefenseFormation — same gate, same wipe. */
export function applyLearnedOffenseFormation(state, values) {
  if (state.phase !== 'planning' || state.turnIndex !== 0) return false;
  for (const { id, pos } of learnedOffenseSpots(state, values)) {
    const p = state.players.find((pl) => pl.id === id);
    p.pos = pos;
    p.plan = null;
    p.cover = null;
  }
  return true;
}
