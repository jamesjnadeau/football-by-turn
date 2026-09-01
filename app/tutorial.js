/**
 * The bridge between the tutorial's pure parts and the game app/main.js runs.
 *
 * It owns exactly three things: which lesson is on, which step of it, and how
 * many attempts this lesson has taken. Everything else is asked of
 * lib/game/tutorial/, and the game state itself belongs to main.js — deal()
 * hands one over rather than keeping it, so there is only ever one `state` in
 * the app and no chance of the board painting a different down from the one the
 * lesson is judging.
 */
import { SCENARIOS, TUTORIAL_LOS_YARD } from '../lib/game/tutorial/script.js';
import {
  allows as machineAllows, advance, offScript, cardFor, stepAt,
  showsMenu as machineShowsMenu,
} from '../lib/game/tutorial/machine.js';
import { createGame } from '../lib/game/state.js';
import { mulberry32 } from '../lib/game/rng.js';
import { saveTutorialDone } from './tutorial-store.js';

export function createLesson() {
  let scenarioIndex = 0;
  let stepIndex = 0;
  let attempts = 1;
  // Where everybody stood before the coach touched anything. Scenario 4's
  // "move him" step is the only thing that reads it, and it has to be captured
  // at the deal — by the time the drag lands, the old spot is gone.
  let startSpots = {};

  const scenario = () => SCENARIOS[scenarioIndex];
  const isLast = () => scenarioIndex === SCENARIOS.length - 1;
  const ctx = (repositioning, menuOpen) => ({ repositioning, menuOpen, startSpots });

  return {
    scenario,
    attempt: () => attempts,
    buttons: () => scenario().buttons,
    highlight: () => stepAt(scenario(), stepIndex)?.highlight ?? null,
    showsMenu: () => machineShowsMenu(scenario(), stepIndex),

    /** A fresh down for the lesson as it stands. The seed is the scenario's, so
     *  a replay deals the identical down and only the coaching differs. */
    deal() {
      const s = scenario();
      stepIndex = 0;
      const state = createGame({
        seed: s.seed,
        variant: s.variantId,
        losYard: TUTORIAL_LOS_YARD,
        ai: s.scripted,
        aiLevel: 'scripted',
        scriptedOrders: s.orders,
      });
      startSpots = {};
      for (const p of state.players) startSpots[p.id] = { x: p.pos.x, y: p.pos.y };
      return { state, random: mulberry32(s.seed) };
    },

    allows(action) {
      return machineAllows(scenario(), stepIndex, action);
    },

    /**
     * What just happened. Advances past every beat that has landed, then asks
     * whether the down is still the one the script was written for — in that
     * order, so the closing beat is reached before the whistle it is meant to
     * outlive can be called a failure.
     */
    saw(state, { repositioning = false, menuOpen = false } = {}) {
      stepIndex = advance(scenario(), stepIndex, state, ctx(repositioning, menuOpen));
      if (offScript(scenario(), stepIndex, state)) {
        attempts += 1;
        return { replay: true, finished: false };
      }
      // Walking past the last step of the last lesson IS the end of the
      // tutorial. There is no sign-off card to press, because the press that
      // got here was opening the menu — and the menu is the way out. Ending
      // now rather than on the way home is what makes that menu the real one:
      // a lesson still running would offer New Game against a two-man drill.
      if (isLast() && stepIndex >= scenario().steps.length) {
        saveTutorialDone();
        return { replay: false, finished: true };
      }
      return { replay: false, finished: false };
    },

    card() {
      return cardFor(scenario(), stepIndex, { attempt: attempts, isLastScenario: isLast() });
    },

    /** The card's one control: on to the next lesson, or out of the tutorial. */
    next() {
      if (isLast()) {
        saveTutorialDone();
        return { finished: true };
      }
      scenarioIndex += 1;
      stepIndex = 0;
      attempts = 1;
      return { finished: false };
    },
  };
}
