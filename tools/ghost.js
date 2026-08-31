/**
 * A ghost of the coach: the recorded log (lib/game/coach-log.js) played back
 * as an opponent.
 *
 * Given a live state it finds the recorded snapshot whose SITUATION is nearest
 * — same game, same side of the ball, closest down, distance, spot and turn —
 * and puts that call on the board. Nearest-neighbor rather than a fitted model
 * because a few hundred snapshots of one human is far too little to fit
 * anything and exactly enough to look things up in; and deterministic rather
 * than sampled because the whole point of the training path is that a seed
 * reproduces it exactly. The ghost rolls no dice at all.
 *
 * Node-only (it reads files); lib/ must never import from here.
 */
import { readFileSync } from 'node:fs';
import { parseCoachLog, applySnapshot } from '../lib/game/coach-log.js';

/**
 * What "a similar situation" means, in weights.
 *
 * turnIndex is heaviest because it is the difference between a call and a
 * scramble: turn zero is a play the coach drew up from a formation, and turn
 * three is what he did about it once it broke — replaying one as the other is
 * the one mistake that would make the ghost a stranger. down comes next (third
 * down is a different game from first), then distance, then field position,
 * which matters least: a coach's third-and-two is his third-and-two whether he
 * is on his own 30 or the other 40.
 */
export const SITUATION_WEIGHTS = {
  turnIndex: 4,
  down: 3,
  toGo: 1,
  losYard: 0.15,
};

/** A log as exported by the game's Coaches Menu, read off disk. */
export function loadGhostLog(path) {
  return parseCoachLog(readFileSync(path, 'utf8'));
}

/** The situation a live state is in, in captureSnapshot's own shape. */
export function liveSituation(state, team) {
  return {
    down: state.down,
    toGo: state.toGoYard - state.losYard,
    losYard: state.losYard,
    turnIndex: state.turnIndex,
    variant: state.variantId,
    side: team,
  };
}

/**
 * How unlike each other two situations are. Infinity across variants, because
 * a call made with eleven men on the field is not a nearer version of a
 * seven-man call — it is a call for a different set of bodies, and the ids in
 * it would half-apply.
 */
export function situationDistance(a, b) {
  if (a.variant !== b.variant) return Infinity;
  return SITUATION_WEIGHTS.turnIndex * Math.abs(a.turnIndex - b.turnIndex)
    + SITUATION_WEIGHTS.down * Math.abs(a.down - b.down)
    + SITUATION_WEIGHTS.toGo * Math.abs(a.toGo - b.toGo)
    + SITUATION_WEIGHTS.losYard * Math.abs(a.losYard - b.losYard);
}

/**
 * The recorded call nearest this situation, or null when the log holds nothing
 * for this side of the ball in this game. Ties go to the OLDEST matching
 * snapshot (strictly-nearer wins), which is what makes the lookup reproducible
 * for a given log rather than dependent on how it was ordered.
 */
export function nearestSnapshot(log, situation) {
  let best = null;
  let bestD = Infinity;
  for (const snap of log) {
    if (snap.situation.side !== situation.side) continue;
    const d = situationDistance(snap.situation, situation);
    if (!Number.isFinite(d) || d >= bestD) continue;
    best = snap;
    bestD = d;
  }
  return best;
}

/**
 * The ghost as a coach function — the same `(state) => void` shape
 * tools/harness.js's playOnePlay takes for either side, so it drops straight
 * into the training loop where a scripted or learned coach would go.
 *
 * A situation the log has nothing for leaves the board alone rather than
 * guessing: the trainer refuses to start against an empty ghost (see
 * train-vs-ghost.js), so a silent turn here means one odd down and not a whole
 * training run against a statue.
 */
export function ghostCoach(log, team) {
  return (state) => {
    const snap = nearestSnapshot(log, liveSituation(state, team));
    if (!snap) return;
    applySnapshot(state, team, snap);
  };
}

/**
 * The situations this log actually holds for one side, at the top of a down —
 * the down-and-distances the human really played, which is what the trainer
 * deals its scenarios from so the genome is judged on the football this coach
 * actually calls rather than on a uniform sample of the field.
 */
export function logSituations(log, side) {
  return log
    .filter((s) => s.situation.side === side && s.situation.turnIndex === 0)
    .map((s) => s.situation);
}
