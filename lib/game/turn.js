/**
 * One half-second turn: SUBSTEPS_PER_TURN physics sub-steps, rules checked
 * after each, stopping at the whistle. Pure with respect to time and
 * randomness — the caller supplies `random`, and frames come back as data
 * for app/main.js to animate.
 */
import { stepPhysics } from './physics.js';
import { checkTackles, checkPickup, checkDeadBall } from './rules.js';
import { ballPos } from './state.js';
import { DT, SUBSTEPS_PER_TURN } from './constants.js';

function snapshot(state) {
  const bp = ballPos(state);
  return {
    players: state.players.map((p) => ({ id: p.id, x: p.pos.x, y: p.pos.y })),
    ball: bp ? { x: bp.x, y: bp.y } : null,
  };
}

export function unplannedPlayers(state) {
  return state.players.filter((p) => p.plan === null).map((p) => p.id);
}

export function runTurn(state, random) {
  state.phase = 'running';
  const frames = [];
  const events = [];
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) {
    stepPhysics(state, DT);
    events.push(...checkTackles(state, random));
    events.push(...checkPickup(state));
    events.push(...checkDeadBall(state));
    frames.push(snapshot(state));
    if (state.deadReason) break;
  }
  for (const p of state.players) p.charge = 0; // the burst lasts one turn (spec)
  state.turnIndex += 1;
  state.phase = state.deadReason ? 'playOver' : 'planning';
  return { frames, events };
}
