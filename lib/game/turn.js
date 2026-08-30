/**
 * One half-second turn: SUBSTEPS_PER_TURN physics sub-steps, rules checked
 * after each, stopping at the whistle. Pure with respect to time and
 * randomness — the caller supplies `random`, and frames come back as data
 * for app/main.js to animate.
 */
import { stepPhysics } from './physics.js';
import { checkTackles, checkPickup, checkDeadBall, checkIncomplete } from './rules.js';
import { ballPos, clearPass } from './state.js';
import { DT, SUBSTEPS_PER_TURN } from './constants.js';
import { coachAi, clearAiPlans } from './ai.js';
import { releasePass } from './pass.js';
import { updateCoverPlans } from './cover.js';
import { formationFoul } from './formation.js';

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

/**
 * Who still needs an arrow — the human's warning feed, so it skips the team the
 * computer coaches. Those players are planned inside runTurn, after this has
 * had its say.
 */
export function unplannedPlayers(state) {
  return state.players
    .filter((p) => p.plan === null && p.team !== state.aiTeam
      && state.plannedPass?.from !== p.id)
    .map((p) => p.id);
}

export function runTurn(state, random) {
  state.phase = 'running';
  // The snap is the moment a formation counts, so it is judged once per down
  // and never again: everyone has scattered by the second turn, and that is a
  // play, not a formation. One flag per down, as pass.js keeps it — a foul
  // already on the books is not overwritten.
  if (state.turnIndex === 0 && !state.penalty) {
    const foul = formationFoul(state);
    if (foul) state.penalty = { foul, spot: state.losYard };
  }
  // The computer plans here and nowhere else. Doing it at the top of the turn
  // rather than during the planning phase is what hides its intentions: while
  // the human is drawing arrows there is simply no plan of the computer's in
  // the state for anything to render.
  coachAi(state);
  const frames = [];
  const events = [];
  // The throw leaves before anyone moves. The arrow said where the ball goes;
  // from here it is an ordinary loose ball and the machinery below flies it,
  // decides who catches it, and rules on what that catch means.
  events.push(...releasePass(state));
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) {
    // Before the bodies move, not after: a cover order is an aim at where the
    // covered man is NOW, and re-aiming after the step would have every blocker
    // chasing a position one sub-step stale, all turn long.
    updateCoverPlans(state);
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
    // Last: a catch in this same sub-step beats the ball settling.
    events.push(...checkIncomplete(state));
    frames.push(snapshot(state));
    if (state.deadReason) break;
  }
  // A forward pass is decided inside the turn it was thrown: if nobody has
  // claimed it by the whistle, it is incomplete. Without this the ball stays
  // live through a whole planning phase — BALL_FRICTION only decays a throw to
  // PASS_DEAD_SPEED after ~57 sub-steps, so no throw a human can draw settles
  // inside its own turn — and a defender falling on it next turn would turn an
  // incompletion into a game-ending turnover.
  events.push(...checkIncomplete(state, { endOfTurn: true }));
  for (const p of state.players) p.charge = 0; // the burst lasts one turn (spec)
  clearAiPlans(state); // ...and the computer's arrows do not outlive the turn either
  clearPass(state);    // ...nor does a throw: it is planned one turn at a time
  state.turnIndex += 1;
  state.phase = state.deadReason ? 'playOver' : 'planning';
  return { frames, events };
}
