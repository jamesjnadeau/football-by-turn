/**
 * The 🎁 button: prefill the coach's own board with what the LEARNED brain
 * would play from here.
 *
 * It plans for whichever side he is coaching — his offense, or his defense
 * when he has taken that side — and it plans it with the genome actually in
 * play this game (learned/active.js: his own trained one when he has trained
 * one, the shipped champion otherwise). There is no second copy of either
 * brain in here: the offense branch calls coachLearnedOffense and the defense
 * branch calls learnedOrders through ai.js's own applyOrders, which is
 * exactly what ai.js does for the computer and what train/harness.js does for
 * a training run. What the button draws IS what the computer would have
 * played, and the tests hold the two together.
 *
 * Mutating, in the mould of offense.js's autoplanOffense and play.js's
 * applyPlay: a one-shot planning-time action a press triggers, not a per-turn
 * brain turn.js calls. offense.js's scripted autoplan stays where it is —
 * train/harness.js's scriptedOffenseCoach is the opponent the shipped defense
 * genome was trained against.
 */
import {
  setMode, clearPlan, clearPass, aimSnap, getPlayer, carrier,
} from './state.js';
import { clearCover } from './cover.js';
import { coachedSide } from './hud.js';
import { activeGenome } from './learned/active.js';
import { coachLearnedOffense } from './learned/offense-policy.js';

/**
 * Wipe one team's current orders, the way applyPlay wipes the human's board
 * before drawing a new play over it. Cover goes with the arrows: a man left
 * without an arrow by the new plan would otherwise keep chasing last play's
 * assignment.
 *
 * `modes` is off for a defense, where applyAiModes is the mode policy and
 * owns the whole question — resetting to `normal` first would re-arm the
 * next-turn `charge` burst on every single press, which is a gift no human
 * gets from a drag.
 *
 * A planned throw is only cleared when it belongs to this team: a hot-seat
 * coach's throw drawn for the OTHER side of the ball is not this button's to
 * take away.
 */
export function clearTeamOrders(state, team, { modes = false } = {}) {
  for (const p of state.players) {
    if (p.team !== team) continue;
    if (modes) setMode(state, p.id, 'normal');
    clearPlan(state, p.id);
    clearCover(state, p.id);
  }
  if (state.plannedPass && getPlayer(state, state.plannedPass.from).team === team) {
    clearPass(state);
  }
}

/**
 * What the learned offense just drew, in a sentence. Turn 0 is read off
 * state.aiPlay, which is where coachLearnedOffense records the call it made
 * (and where it looks the call up again on later turns); everything after is
 * read off the board, because a broken play is whatever the ball is doing.
 */
function offenseNote(state) {
  const car = carrier(state);
  if (!car) return 'Loose ball -- everybody goes and gets it.';
  if (car.team !== 'offense') return 'They have the ball -- there is nothing for the offense to draw up.';

  if (state.turnIndex === 0) {
    const play = state.aiPlay;
    // planLearnedRun/planLearnedPassSnap both hand back null when the
    // formation has no quarterback for them to run, and leave the board bare.
    if (!play) return 'Nothing to draw up -- this formation has no quarterback for the learned offense.';
    if (play.call === 'pass') {
      return 'Learned call: pass. Routes on, the quarterback drops back, the line protects.';
    }
    const way = play.side > 0 ? 'right' : 'left';
    return play.give
      ? `Learned call: run ${way}. Contain outside -- direct snap to the back, the quarterback fakes the boot.`
      : `Learned call: run ${way}. Crash inside -- the quarterback keeps it, the back fakes the dive.`;
  }

  const throwing = state.plannedPass
    && !state.plannedPass.auto
    && getPlayer(state, state.plannedPass.from).team === 'offense';
  if (throwing) {
    const { target } = state.plannedPass;
    return target
      ? `The throw goes to the ${getPlayer(state, target).role}.`
      : 'The throw goes up -- a lob to where he will be.';
  }
  return `${car.role} runs the learned offense -- everybody else blocks.`;
}

/** The offense half: wipe, run the brain, put the snap back. */
export function autoplanLearnedOffense(state) {
  clearTeamOrders(state, 'offense', { modes: true });
  coachLearnedOffense(state, activeGenome(state, 'offense'));
  // Restores the automatic snap-to-QB, but only if nothing above set an
  // override of its own -- a give is a direct snap to the back, and aimSnap
  // leaves a coach's own call alone (see state.js).
  aimSnap(state);
  return offenseNote(state);
}

/**
 * The button. A short sentence for the board to say, or null when it declined
 * — which is only ever the wrong phase, since the side it plans for is by
 * definition the side the computer is not coaching.
 */
export function autoplanLearned(state) {
  if (state.phase !== 'planning') return null;
  return autoplanLearnedOffense(state);
}
