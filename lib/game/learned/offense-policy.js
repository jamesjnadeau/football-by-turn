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

/**
 * The learned run: offense.js's option snap with its three judgment calls —
 * which side, how wide "contain" is, how hard the runners lean — read off
 * the genome instead of constants.js. Everything structural is the scripted
 * play's own: a contain read means a direct snap to the diving back with the
 * QB selling a boot; a crash read means the QB keeps it around the edge.
 */
export function planLearnedRun(state, genome) {
  const offense = state.players.filter((p) => p.team === 'offense');
  const qb = offense.find((p) => p.id === SNAP_TARGET_ID);
  const rb = offense.find((p) => p.role === 'RB');
  const line = offense.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role));
  if (!qb || !rb) return null;

  const side = chooseSide(state, genome);
  const reader = readDefender(state, side);
  const give = reader !== null
    && side * (reader.pos.x - playSideEdgeX(side, line)) > genome['run:read'];

  if (give) {
    const from = getPlayer(state, SNAPPER_ID);
    const gap = sub(rb.pos, from.pos);
    if (len(gap) > 0) {
      setPass(state, SNAPPER_ID, norm(gap),
        powerForTravel(Math.max(0, len(gap) - spawnOffset(from)), Infinity), rb.id);
    }
  }

  const lean = norm({ x: side * genome['run:lean'], y: 1 });
  for (const p of line) {
    setPlan(state, p.id, lean, 1);
    setMode(state, p.id, 'cutBlock');
  }
  setPlan(state, rb.id, lean, 1);
  setPlan(
    state, qb.id,
    give
      ? norm({ x: -side, y: OPTION_FAKE_FORWARD })
      : norm({ x: side * Math.max(1, genome['run:lean'] * 2), y: 1 }),
    give ? OPTION_FAKE_THROTTLE : 1,
  );
  applyBlocks(state, offense.filter(
    (p) => p.id !== qb.id && p.id !== rb.id && !OFFENSIVE_LINE_ROLES.has(p.role),
  ));
  return { call: 'run', side, give };
}

/** Who a forward pass may be thrown to: the skill men. Offensive linemen
 *  are ineligible (checkPickup lets a forward pass sail through them), so
 *  they are never worth targeting. */
export function eligibleReceivers(state) {
  return state.players.filter((p) => p.team === 'offense'
    && p.id !== SNAP_TARGET_ID && p.id !== SNAPPER_ID
    && !OFFENSIVE_LINE_ROLES.has(p.role));
}

/** A route angle off straight-upfield (positive bends right), as a unit
 *  direction. A man the genome has no route for runs straight upfield. */
export function routeDir(genome, id, phase) {
  const deg = genome[`route:${id}:${phase}`];
  if (typeof deg !== 'number') return { x: 0, y: 1 };
  const rad = (deg * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad) };
}

/**
 * The pass snap: receivers release on their genome routes, the QB drops
 * straight back at his genome throttle, the line pass-protects (the same
 * nearest-pair blocks the scripted autoplan throws). The ordinary auto snap
 * to the QB is left standing — the throw itself is a later turn's decision
 * (planThrow), once the routes have had time to come open.
 */
export function planLearnedPassSnap(state, genome) {
  const offense = state.players.filter((p) => p.team === 'offense');
  const qb = offense.find((p) => p.id === SNAP_TARGET_ID);
  if (!qb) return null;
  for (const r of eligibleReceivers(state)) {
    setPlan(state, r.id, routeDir(genome, r.id, 'deg0'), 1);
  }
  setPlan(state, qb.id, { x: 0, y: -1 }, genome['qb:drop']);
  applyBlocks(state, offense.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role)));
  return { call: 'pass' };
}

/** How good this throw looks, in yards: separation from the nearest
 *  defender, plus progress downfield, minus how far the ball must travel. */
export function receiverScore(state, genome, qb, r) {
  const defenders = state.players.filter((p) => p.team === 'defense');
  const sep = defenders.length
    ? Math.min(...defenders.map((d) => dist(d.pos, r.pos))) / UNITS_PER_YARD_X
    : 99;
  const depth = yardsOfY(r.pos.y) - state.losYard;
  const range = dist(qb.pos, r.pos) / UNITS_PER_YARD_X;
  return genome['tgt:sep'] * sep
    + genome['tgt:depth'] * depth
    + genome['tgt:dist'] * range;
}

/**
 * Throw, or keep holding. The best-scoring receiver gets the ball when he
 * clears the genome's bar — or when the hold clock runs out and the best
 * available has to do. Inside the lock zone the throw is locked on
 * (releasePass re-solves the meeting itself, so dir/power here are just the
 * fallback); beyond it a locked ball would have to fly flat forever, so the
 * throw goes up as an unlocked lob at the receiver's lead.
 *
 * The two refusals are the two flags pass.js would throw: never a second
 * forward pass, never one from past the line. An offense that cannot throw
 * legally scrambles instead (coachLearnedOffense's job).
 */
export function planThrow(state, genome, qb) {
  if (state.forwardPasses > 0) return false;
  if (yardsOfY(qb.pos.y) > state.losYard) return false;
  const receivers = eligibleReceivers(state);
  if (!receivers.length) return false;
  const scored = receivers
    .map((r) => ({ r, score: receiverScore(state, genome, qb, r) }))
    .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
  const best = scored[0];
  const mustThrow = state.turnIndex >= Math.round(genome['throw:hold']);
  if (best.score <= genome['throw:go'] && !mustThrow) return false;
  const gap = sub(best.r.pos, qb.pos);
  if (len(gap) === 0) return false;
  if (len(gap) <= LOCK_UNITS) {
    setPass(state, qb.id, norm(gap), 0.5, best.r.id);
    return true;
  }
  const lead = add(best.r.pos, scale(best.r.vel, 0.5));
  const to = sub(lead, qb.pos);
  if (len(to) === 0) return false;
  setPass(state, qb.id, norm(to),
    powerForTravel(Math.max(0, len(to) - spawnOffset(qb)), Infinity), null);
  return true;
}
