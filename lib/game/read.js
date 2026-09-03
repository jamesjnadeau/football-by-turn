/**
 * The down, as one object instead of a stream of instants.
 *
 * Before this file, the brains were called once a turn and answered from
 * whatever was in front of them at that instant: the man/zone gate re-read a
 * spread that grows as men scatter, so a coverage call could flip in the
 * middle of a play, and the coverage assignment re-ran its greedy claim every
 * turn, so a defender could hand his man off between turn one and turn two.
 * Neither was a decision anybody made.
 *
 * This is the down as one object instead — the look it snapped against, and
 * the call it committed to — advanced once per turn by turn.js and cleared by
 * rules.js at every whistle.
 *
 * PURE and dice-free, like defense.js and zone.js beside it.
 */
import { onTheLine } from './formation.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT } from '../field/geometry.js';

/**
 * The picture the down started from, frozen at the top of turn 0.
 *
 * `spread` is what the scheme gate reads, and it is deliberately the same
 * number formation.js's learnedPersonnel already computes off a look -- the
 * same question, asked once and kept. Taking it from here rather than
 * measuring it live is what stops the man/zone call flipping in the middle
 * of a play: men scatter, so a live width grows all down long, and a gate
 * reading it would answer a different question every turn. A scheme is a
 * pre-snap call.
 */
export function snapLook(state) {
  const them = state.players.filter((p) => p.team === 'offense');
  const xs = them.map((p) => p.pos.x);
  const width = SIDELINE_RIGHT - SIDELINE_LEFT;
  return {
    spread: xs.length ? (Math.max(...xs) - Math.min(...xs)) / width : 0,
    backs: them.length ? them.filter((p) => !onTheLine(state, p)).length / them.length : 0,
  };
}

/**
 * A fresh down's percept. THE one constructor: setCalledPlay builds a percept
 * too, and when two constructors disagree the difference is invisible until
 * something depends on it.
 */
function newPlayRead(state) {
  return {
    look: snapLook(state),
    // Whether the snap read has been taken yet. advancePlay branches on THIS
    // and not on whether the percept exists, because the percept can exist
    // first: the training harness coaches both sides before runTurn, and the
    // offense's autoplan button runs during the planning phase. If existence
    // decided it, those downs would skip the snap read altogether.
    snapped: false,
    call: { offense: null, defense: null },
    // The turnIndex this percept was last advanced for, so a turn cannot be
    // advanced twice. The training harness advances it itself, before it
    // gives orders, and runTurn then advances it again a moment later — one
    // of those has to be a no-op or the down's evidence is counted twice.
    advancedTurn: null,
  };
}

/**
 * The down, one turn on. turn.js is the only caller, and calls it
 * UNCONDITIONALLY — never gated on state.aiTeam, because the training harness
 * runs hot-seat with no aiTeam at all and coaches both sides itself, so a
 * percept that needed one would be missing from every play a genome is
 * scored on.
 *
 * Built here rather than in rules.js's nextDown because nextDown ends before
 * the planning phase does: the coach then spends it dragging people around,
 * and a look frozen back there would be a picture nobody ever lined up in.
 *
 * The percept can already exist by the time this runs — setCalledPlay may
 * have built it first (see below) — so the snap read is gated on the
 * `snapped` flag, not on `state.playRead` itself.
 *
 * Idempotent per turn (`advancedTurn`): the training harness advances the
 * percept itself before it gives orders (see train/harness.js's
 * defenseCoach), and runTurn calls this again a moment later on the same
 * turn. Without the guard the second call would re-measure a look that had
 * already frozen; with it, runTurn's own call is simply a no-op.
 */
export function advancePlay(state) {
  if (!state.playRead) state.playRead = newPlayRead(state);
  const p = state.playRead;
  if (p.advancedTurn === state.turnIndex) return;
  // Until the snap, the look is whatever is on the field NOW. setCalledPlay
  // can build the percept during the planning phase — the offense's autoplan
  // button does exactly that — and the coach may then drag somebody before he
  // snaps. Re-measuring here is what keeps the frozen look the picture they
  // actually lined up in rather than the one that happened to be there first.
  if (!p.snapped) p.look = snapLook(state);
  p.snapped = true;
  p.advancedTurn = state.turnIndex;
}

/**
 * The call one side committed to this down, and the way to set it.
 *
 * Tolerant of a missing percept on purpose: the training harness coaches both
 * sides BEFORE runTurn (see playOnePlay), so a coach can be the first thing to
 * touch a fresh down, ahead of advancePlay. Rather than make every caller
 * check, the setter builds the down through the same constructor advancePlay
 * uses, so a call written before the first advancePlay does not cost the down
 * its snap look.
 */
export function calledPlay(state, side) {
  return state.playRead ? state.playRead.call[side] : null;
}

export function setCalledPlay(state, side, play) {
  if (!state.playRead) state.playRead = newPlayRead(state);
  state.playRead.call[side] = play;
}
