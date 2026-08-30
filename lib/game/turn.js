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

/**
 * `ball` is where the ball is this sub-step (the carrier's spot, or the loose
 * ball's). `looseBall` is non-null only while nobody is carrying it — that's
 * the flag app/main.js needs, because a carried ball is drawn inside the
 * carrier's group and rides along for free, while a loose one needs its own
 * animated node.
 */
function snapshot(state) {
  const bp = ballPos(state);
  const loose = state.ball.carrierId === null ? state.ball.pos : null;
  return {
    players: state.players.map((p) => ({ id: p.id, x: p.pos.x, y: p.pos.y })),
    ball: bp ? { x: bp.x, y: bp.y } : null,
    looseBall: loose ? { x: loose.x, y: loose.y } : null,
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
    // Dead-ball first: if the carrier's leading edge broke the goal plane (or
    // he stepped out) during this sub-step, that already physically happened,
    // so it must be locked in before a tackle roll in the same sub-step can
    // claim him. checkDeadBall's own `if (state.deadReason) return []` guard
    // still keeps a tackle from an EARLIER sub-step standing — the loop breaks
    // on deadReason, so it never gets a second look anyway.
    events.push(...checkDeadBall(state));
    events.push(...checkTackles(state, random));
    events.push(...checkPickup(state));
    frames.push(snapshot(state));
    if (state.deadReason) break;
  }
  for (const p of state.players) p.charge = 0; // the burst lasts one turn (spec)
  state.turnIndex += 1;
  state.phase = state.deadReason ? 'playOver' : 'planning';
  return { frames, events };
}
