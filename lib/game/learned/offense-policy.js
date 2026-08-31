/**
 * The learned offense's brain. Unlike the defense's pure-orders pattern,
 * this is a MUTATING coach in the mold of offense.js's autoplanOffense —
 * an offense has to plan throws (setPass) and stances (setMode), which the
 * {id, aim, cover} order shape cannot carry. ai.js dispatches
 * coachLearnedOffense (Task 7's entry point) exactly where it dispatches the
 * defense brains, and runTurn's clearAiPlans/clearPass still wipe everything
 * at the whistle, so nothing the computer plans ever survives onto the
 * human's screen.
 *
 * Structure hand-written, numbers learned, same as the defense: a run/pass
 * logit over the situation, a generalized option read for the run (the
 * scripted autoplan's read with its threshold and leans made learnable),
 * genome routes and a scored throw decision for the pass, and offense.js's
 * own daylight/block helpers for every broken play.
 */
import { sub, len, norm, dist, add, scale } from '../vec.js';
import {
  setPlan, setMode, setPass, getPlayer, carrier, ballPos,
  SNAPPER_ID, SNAP_TARGET_ID,
} from '../state.js';
import { yardsOfY } from '../view.js';
import { UNITS_PER_YARD_X } from '../../field/geometry.js';
import { OFFENSIVE_LINE_ROLES } from '../rosters.js';
import { powerForTravel, spawnOffset } from '../flight.js';
import { LOCK_UNITS } from '../lob.js';
import {
  readDefender, playSideEdgeX, daylightDirection, applyBlocks,
} from '../offense.js';
import {
  OPTION_FAKE_FORWARD, OPTION_FAKE_THROTTLE, AI_BREAKDOWN_UNITS,
} from '../constants.js';

const BOX_DEPTH_YARDS = 3;
const BOX_HALF_WIDTH_YARDS = 8;

/** The defenders crowding the line near the ball — the men a run must beat. */
export function boxDefenders(state) {
  const ball = ballPos(state);
  if (!ball) return [];
  return state.players.filter((p) => p.team === 'defense'
    && Math.abs(yardsOfY(p.pos.y) - state.losYard) <= BOX_DEPTH_YARDS
    && Math.abs(p.pos.x - ball.x) <= BOX_HALF_WIDTH_YARDS * UNITS_PER_YARD_X);
}

/** The situation, squashed to roughly [0,1] — the call gate's whole world. */
export function callFeatures(state) {
  const defenders = state.players.filter((p) => p.team === 'defense').length;
  return {
    down: (state.down - 1) / 3,
    toGo: Math.min(1, (state.toGoYard - state.losYard) / 10),
    box: defenders ? boxDefenders(state).length / defenders : 0,
  };
}

export function chooseCall(state, genome) {
  const f = callFeatures(state);
  const z = genome['call:bias']
    + genome['call:down'] * f.down
    + genome['call:toGo'] * f.toGo
    + genome['call:box'] * f.box;
  return z > 0 ? 'pass' : 'run';
}

/**
 * Which way the run goes: away from the heavier half of the box, tilted by
 * the genome's own side preference. 1 is right, -1 is left.
 */
export function chooseSide(state, genome) {
  const ball = ballPos(state);
  const box = boxDefenders(state);
  const left = box.filter((p) => p.pos.x < ball.x).length;
  const right = box.length - left;
  const z = genome['run:sideBias'] + 0.5 * (left - right);
  return z >= 0 ? 1 : -1;
}
