/**
 * The training harness: deal a random down, let two coach functions plan
 * both teams hot-seat, run the engine to the whistle, score the play.
 *
 * Everything is seeded (mulberry32) and nothing here rolls its own dice, so
 * a fitness evaluation is exactly reproducible — and two candidate genomes
 * evaluated with the same seed see the SAME downs and the same tackle rolls,
 * which is what makes their fitnesses comparable (common random numbers).
 *
 * Runs hot-seat (aiTeam null) on purpose: runTurn's own coachAi stays inert
 * and the harness is the only coach of either side, so training needs no
 * half-real game mode. Node-only; lib/ must never import from here.
 */
import {
  createGame, formationPlayers, aimSnap, ballPos, SNAPPER_ID,
} from '../lib/game/state.js';
import { runTurn } from '../lib/game/turn.js';
import { yardsOfY, GOAL_YARD } from '../lib/game/view.js';
import { mulberry32 } from '../lib/game/rng.js';
import { applyOrders, applyAiModes } from '../lib/game/ai.js';
import { learnedOrders } from '../lib/game/learned/defense-policy.js';
import { applyLearnedDefenseFormation, applyLearnedOffenseFormation } from '../lib/game/learned/formation.js';
import { autoplanOffense } from '../lib/game/offense.js';
import { coachLearnedOffense } from '../lib/game/learned/offense-policy.js';
import { FIRST_DOWN_YARDS } from '../lib/game/constants.js';

/** A play that has not died by now never will (both sides re-plan every
 *  turn); call it over and score the ball where it lies. */
export const MAX_TURNS_PER_PLAY = 24;

/**
 * A fresh down somewhere a real drive could be: random down, random spot
 * (never so deep that MIN_SPOT_YARD clamping kicks in, never inside the 20),
 * random distance. Randomizing the situation is what gives the scheme gate's
 * down/toGo features something to learn from.
 */
export function scenario(rand, variant = '7') {
  const state = createGame({ seed: 1 + Math.floor(rand() * 2 ** 30), variant });
  state.down = 1 + Math.floor(rand() * 4);
  state.losYard = 15 + Math.floor(rand() * 66); // 15..80
  state.toGoYard = Math.min(
    state.losYard + 1 + Math.floor(rand() * FIRST_DOWN_YARDS), GOAL_YARD,
  );
  state.players = formationPlayers(state.losYard, variant);
  state.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  state.plannedPass = null;
  aimSnap(state);
  return state;
}

/**
 * One play, start to whistle. The coaches are (state) => void and are called
 * every planning phase, offense first (the human plans first in spirit; the
 * defense answers). Yards are the ball's final yard against the opening line
 * of scrimmage — zero for an incompletion, exactly as nextDown spots it.
 */
export function playOnePlay(state, offenseCoach, defenseCoach, random) {
  const startLos = state.losYard;
  const events = [];
  for (let t = 0; t < MAX_TURNS_PER_PLAY && state.phase !== 'playOver'; t++) {
    offenseCoach(state);
    defenseCoach(state);
    events.push(...runTurn(state, random).events);
  }
  const bp = ballPos(state);
  const yards = state.deadReason === 'incomplete' || !bp
    ? 0
    : yardsOfY(bp.y) - startLos;
  return {
    yards,
    deadReason: state.deadReason,
    touchdown: state.deadReason === 'touchdown',
    turnover: state.deadReason === 'recovered',
    events,
  };
}

/**
 * The learned defense as a coach function: its genome's formation at the top
 * of the down, the breakdown stance near the carrier (the same modes coachAi
 * applies), and learnedOrders every turn.
 */
export function defenseCoach(values) {
  return (state) => {
    if (state.turnIndex === 0 && state.phase === 'planning') {
      applyLearnedDefenseFormation(state, values);
    }
    applyAiModes(state, 'defense');
    applyOrders(state, learnedOrders(state, 'defense', values));
  };
}

/**
 * The interim opponent: the scripted QB run option (offense.js). The Offense
 * plan replaces this with the co-evolving learned offense; until then it is
 * the strongest offense the codebase can field without a human.
 */
export function scriptedOffenseCoach(state) {
  autoplanOffense(state);
}

/** Mean per-play stats for one defense genome over `plays` seeded scenarios. */
export function evaluateDefense(values, { plays, seed, offenseCoach = scriptedOffenseCoach }) {
  const rand = mulberry32(seed);
  const coach = defenseCoach(values);
  let yards = 0;
  let touchdowns = 0;
  let turnovers = 0;
  for (let i = 0; i < plays; i++) {
    const state = scenario(rand);
    const result = playOnePlay(
      state, offenseCoach, coach, mulberry32(1 + Math.floor(rand() * 2 ** 30)),
    );
    yards += result.yards;
    if (result.touchdown) touchdowns += 1;
    if (result.turnover) turnovers += 1;
  }
  return {
    yardsPerPlay: yards / plays,
    touchdownRate: touchdowns / plays,
    turnoverRate: turnovers / plays,
  };
}

/**
 * The learned offense as a coach function: its genome's formation at the
 * top of the down (the auto snap re-aims itself — it is locked on the QB,
 * and releasePass re-solves a locked throw at the whistle), then the
 * whole-down brain every turn.
 */
export function learnedOffenseCoach(values) {
  return (state) => {
    if (state.turnIndex === 0 && state.phase === 'planning') {
      applyLearnedOffenseFormation(state, values);
    }
    coachLearnedOffense(state, values);
  };
}

/** Learned offense vs learned defense: one stats object, read positively by
 *  the offense's fitness and negatively by the defense's. */
export function evaluateMatch(offValues, defValues, { plays, seed }) {
  return evaluateDefense(defValues, {
    plays, seed, offenseCoach: learnedOffenseCoach(offValues),
  });
}
