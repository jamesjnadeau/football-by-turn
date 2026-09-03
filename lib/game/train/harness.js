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
 * half-real game mode.
 *
 * This lives under lib/ rather than tools/ because the browser trains too:
 * .github/workflows/deploy.yml copies index.html, app/ and lib/ to Pages and
 * never tools/, so app/train-worker.js could not reach a trainer that lived
 * there. Nothing in this directory may import a node: module or touch the
 * DOM — test/game/train/browser-safe.test.js holds the whole directory, and
 * everything it reaches, to that.
 */
import {
  createGame, formationPlayers, aimSnap, ballPos, SNAPPER_ID, SNAP_TARGET_ID, carrier,
} from '../state.js';
import { runTurn } from '../turn.js';
import { yardsOfY, GOAL_YARD, fieldPos } from '../view.js';
import { mulberry32 } from '../rng.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT, CENTRE_X, xToYards } from '../../field/geometry.js';
import { applyOrders, applyAiModes } from '../ai.js';
import { smartOrders } from '../defense.js';
import { learnedOrders } from '../learned/defense-policy.js';
import { applyLearnedOffenseFormation } from '../learned/formation.js';
import { applyLearnedLook, onTheLine } from '../formation.js';
import { autoplanOffense } from '../offense.js';
import {
  coachLearnedOffense, planLearnedRun, planLearnedPassSnap, planThrow,
} from '../learned/offense-policy.js';
import { FIRST_DOWN_YARDS, TURN_SECONDS, ON_LINE_YARDS } from '../constants.js';
import { baseVariantId } from '../rosters.js';
import { ghostCoach } from './ghost.js';

// Shared by dealOffensiveLook and varyOffensiveLook: floating-point rounding
// must not land a nudged spot exactly back on a boundary spotFault refuses
// (occupied, or the on/off-line divide below).
const CLEAR_MARGIN = 1e-6;

/** A play that has not died by now never will (both sides re-plan every
 *  turn); call it over and score the ball where it lies. */
export const MAX_TURNS_PER_PLAY = 24;

/**
 * Move the offense's skill players somewhere legal and different every play.
 *
 * Training used to show the defense one formation forever — scenario dealt the
 * roster default, the scripted offense never moves anybody pre-snap, and the
 * learned offense stands a fixed genome formation. A defense cannot learn to
 * answer a look that never changes, so every adapt weight was scored as noise.
 *
 * Only the skill players move, and only inside the band that keeps the
 * formation legal: the seven-a-side offense fields exactly minOnLine men on
 * the line, so both receivers must STAY on it (down within ON_LINE_YARDS of
 * the ball, and never across it), and the interior three are left alone
 * because the snapper has to stand where the ball is spotted.
 *
 * Every draw comes from the passed rand: two genomes at one seed must face the
 * same downs and the same looks, or common random numbers stops holding and
 * their fitnesses stop being comparable.
 *
 * The bands below (the 5-24 yard across range, the [-2, -1] on-the-line depth
 * band, leaving the interior three alone) are geometry read straight off the
 * seven-a-side roster and its minOnLine of 5 — they are not derived from
 * `state` and so cannot adapt themselves to a different one. `scenario`
 * accepts any variant, so the check below makes that assumption a refusal
 * rather than a silent one: dealing an eleven-a-side offense through these
 * bands would drag a receiver who is meant to stay off the line onto it.
 */
function dealOffensiveLook(state, rand) {
  if (baseVariantId(state.variantId) !== '7') return;
  const at = (id) => state.players.find((p) => p.id === id);
  const span = (lo, hi) => lo + rand() * (hi - lo);
  // Both receivers on one side a fair share of the time: a formation with a
  // strong side is the only thing that teaches a strength-shaded answer.
  const strongSide = rand() < 0.35 ? (rand() < 0.5 ? -1 : 1) : 0;
  // The inner edge is 5, not the interior guards' 2.5: a receiver drawn any
  // closer could stand exactly beside a guard's depth (both are within a
  // down of the line) with less than their combined radii between them, which
  // spotFault would refuse before the separation nudge below ever saw it.
  const wr = strongSide === 0
    ? [span(-24, -5), span(5, 24)]
    : [strongSide * span(5, 24), strongSide * span(5, 24)];
  const moved = [];
  ['o-wr1', 'o-wr2'].forEach((id, i) => {
    const p = at(id);
    if (!p) return;
    p.pos = fieldPos(wr[i], state.losYard + span(-2, -1));
    moved.push(p);
  });
  for (const id of ['o-qb', 'o-rb']) {
    const p = at(id);
    if (!p) continue;
    p.pos = fieldPos(span(-8, 8), yardsOfY(p.pos.y));
    moved.push(p);
  }
  // Two men dealt onto the same spot is a look the rulebook would refuse, and
  // a refused look is not a down anybody can learn from. settleMovedPlayers
  // (below) is what resolves that and holds everyone inbounds; see its own
  // comment for why the order and direction of the yield matter.
  settleMovedPlayers(state, moved);
}

/**
 * Settle a list of just-moved players against every body on the field and
 * against the sidelines, in place. Shared by dealOffensiveLook and
 * varyOffensiveLook so the separation rule exists in exactly one spot rather
 * than two copies that could drift apart.
 *
 * Only the across axis moves here -- depth is whatever the caller already
 * drew -- so a pair that is closer than they may stand gets slid apart along
 * x by exactly the amount that restores legal separation at their fixed
 * depths, rather than by a fraction of the straight-line gap (which left them
 * still overlapping whenever they also differed in depth).
 *
 * Movers are settled in the order `moved` lists them, and each one only ever
 * yields to a mover earlier in that order, never the other way -- otherwise
 * two receivers colliding near the same sideline can leapfrog each other
 * outward pass after pass and pile up on the boundary instead of settling. A
 * mover that must give ground always gives it AWAY from the centre, never
 * back toward it: sliding toward the ball is how an off-band receiver used to
 * end up standing on a guard.
 */
function settleMovedPlayers(state, moved) {
  const laterThan = new Map(moved.map((p, i) => [p.id, i]));
  for (const p of moved) {
    for (const q of state.players) {
      if (q === p) continue;
      // An earlier mover in the fixed order is settled ground for this one;
      // a later mover has not been placed yet and will yield to `p` instead.
      if (laterThan.has(q.id) && laterThan.get(q.id) > laterThan.get(p.id)) continue;
      const dy = p.pos.y - q.pos.y;
      const need = p.radius + q.radius + CLEAR_MARGIN;
      if (Math.abs(dy) >= need) continue; // depth alone already clears them
      const dx = p.pos.x - q.pos.x;
      if (Math.hypot(dx, dy) >= need) continue;
      const clearDx = Math.sqrt(need * need - dy * dy);
      const candidates = [q.pos.x + clearDx, q.pos.x - clearDx];
      const x = Math.abs(candidates[0] - CENTRE_X) >= Math.abs(candidates[1] - CENTRE_X)
        ? candidates[0] : candidates[1];
      p.pos = { x, y: p.pos.y };
    }
    // Hold him inbounds -- the nudge above only ever pushes further from a
    // neighbour, and near a sideline that can push a body past it.
    const lo = SIDELINE_LEFT + p.radius;
    const hi = SIDELINE_RIGHT - p.radius;
    p.pos = { x: Math.max(lo, Math.min(hi, p.pos.x)), y: p.pos.y };
  }
}

/**
 * Nudge the offense that is ALREADY on the board, rather than dealing a fresh
 * one. dealOffensiveLook (above) assigns absolute positions and is what
 * `train:defense`'s scripted-offense path uses; by the time the learned
 * offense (learnedOffenseCoach, below) runs, it has already written its own
 * genome's formation, and overwriting it the way dealOffensiveLook does would
 * erase the very thing co-evolution is supposed to be training the defense
 * against. This perturbs it instead: small enough that the offense stays
 * recognisably its own, large enough that the defense sees a different
 * picture every play — which is what gives its `adapt:*` weights something
 * to learn from at all (see learnedOffenseCoach's comment for the fuller
 * story of why train:coevolve needed this).
 *
 * The invariant that makes this safe: the nudge never changes who is on the
 * line. `onTheLine` is a depth window around losYard, and the offense may
 * never stand past the line at all (spotFault's `past-line` refusal), so an
 * on-the-line man's yard already sits in [losYard - ON_LINE_YARDS, losYard]
 * and an off-the-line man's sits strictly below that floor. Recording each
 * moved player's status BEFORE the nudge and clamping his post-nudge depth
 * back into the matching band keeps lineCount -- and therefore
 * formationFoul -- exactly what it was: legal by construction, not by luck.
 * Only the receivers' depth is ever touched (the backs' is left alone by
 * design), so that is the only place this clamp has to run.
 *
 * Every draw comes from the passed rand, and — unlike dealOffensiveLook,
 * which branches on one of its own draws (`strongSide`) and so does not
 * always draw the same count — this draws a FIXED six values every call:
 * across and depth for each of wr1/wr2, then across alone for qb and rb, in
 * that order, whatever they land on and whatever the roster holds. Two
 * genomes compared at one seed must see identical dice turn by turn, and a
 * variable draw count would desync that stream between them.
 */
const WR_ACROSS_YARDS = 6;
const WR_DEPTH_YARDS = 0.75;
const BACK_ACROSS_YARDS = 4;

export function varyOffensiveLook(state, rand) {
  if (baseVariantId(state.variantId) !== '7') return;
  const at = (id) => state.players.find((p) => p.id === id);
  const span = (lo, hi) => lo + rand() * (hi - lo);

  const dAcrossWr1 = span(-WR_ACROSS_YARDS, WR_ACROSS_YARDS);
  const dDepthWr1 = span(-WR_DEPTH_YARDS, WR_DEPTH_YARDS);
  const dAcrossWr2 = span(-WR_ACROSS_YARDS, WR_ACROSS_YARDS);
  const dDepthWr2 = span(-WR_DEPTH_YARDS, WR_DEPTH_YARDS);
  const dAcrossQb = span(-BACK_ACROSS_YARDS, BACK_ACROSS_YARDS);
  const dAcrossRb = span(-BACK_ACROSS_YARDS, BACK_ACROSS_YARDS);

  const moved = [];
  const nudgeReceiver = (id, dAcross, dDepth) => {
    const p = at(id);
    if (!p) return;
    const wasOnLine = onTheLine(state, p);
    const across = xToYards(p.pos.x) + dAcross;
    const wantDown = yardsOfY(p.pos.y) + dDepth;
    const lineFloor = state.losYard - ON_LINE_YARDS;
    // Clamp back into the band matching his PRE-nudge status -- on-the-line
    // stays within [lineFloor, losYard], off-the-line stays strictly below
    // lineFloor -- so lineCount cannot change underneath him.
    const down = wasOnLine
      ? Math.max(lineFloor, Math.min(state.losYard, wantDown))
      : Math.min(lineFloor - CLEAR_MARGIN, wantDown);
    p.pos = fieldPos(across, down);
    moved.push(p);
  };
  nudgeReceiver('o-wr1', dAcrossWr1, dDepthWr1);
  nudgeReceiver('o-wr2', dAcrossWr2, dDepthWr2);

  const nudgeBack = (id, dAcross) => {
    const p = at(id);
    if (!p) return;
    // Depth is left alone by design -- only the receivers' band needs the
    // on-line clamp above, since a back's spec range never reaches it.
    p.pos = fieldPos(xToYards(p.pos.x) + dAcross, yardsOfY(p.pos.y));
    moved.push(p);
  };
  nudgeBack('o-qb', dAcrossQb);
  nudgeBack('o-rb', dAcrossRb);

  settleMovedPlayers(state, moved);
}

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
  dealOffensiveLook(state, rand);
  aimSnap(state);
  return state;
}

/**
 * How many real forward throws a play's events hold. The automatic snap
 * fires a `pass` event of its own (see releasePass), so `auto` has to be
 * excluded or every play — even a called run — counts at least one; `forward`
 * excludes a lateral or a handoff, which the rulebook does not limit and the
 * fitness signal has no business punishing.
 */
export function countPasses(events) {
  return events.filter((e) => e.type === 'pass' && e.auto !== true && e.forward === true).length;
}

/**
 * Yards the ball travelled through the air on completed forward throws. A
 * throw leaves its `fromYard` (pass.js, at release) in the event stream;
 * whichever `pickup` follows it is the verdict — an offensive one is the
 * completion this yardage belongs to, and anything else (an interception, or
 * no pickup at all before the whistle) leaves nothing to credit. Floored at
 * zero: a throw caught behind the line of scrimmage is not the defense's gift
 * of negative air yards.
 */
export function pairAirYards(events) {
  let airYards = 0;
  let fromYard = null;
  for (const e of events) {
    if (e.type === 'pass' && e.auto !== true && e.forward === true) {
      fromYard = e.fromYard;
    } else if (e.type === 'pickup' && fromYard !== null) {
      if (e.team === 'offense') airYards += Math.max(0, e.atYard - fromYard);
      fromYard = null;
    }
  }
  return airYards;
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
  let turns = 0;
  for (; turns < MAX_TURNS_PER_PLAY && state.phase !== 'playOver'; turns++) {
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
    turns,
    passes: countPasses(events),
    airYards: pairAirYards(events),
    events,
  };
}

/**
 * The learned defense as a coach function: at the top of the down, the
 * formation it stands is now the candidate's package AND its answer to the
 * offense's look — which is what makes the `adapt:*` and `sub:*` weights
 * something evolution can score at all. The loop (playOnePlay, above) already
 * runs `offenseCoach` before this one, so the offense's formation is already
 * on the board when the defense reads it — that ordering is what makes
 * adaptation trainable in the first place. Then the breakdown stance near the
 * carrier (the same modes coachAi applies), and learnedOrders every turn.
 */
export function defenseCoach(values) {
  return (state) => {
    if (state.turnIndex === 0 && state.phase === 'planning') {
      applyLearnedLook(state, values);
    }
    // The candidate has to reach the engine, not just this function. runTurn
    // advances the down's read through activeGenome(state, 'defense'), which
    // falls back to the SHIPPED genome unless the state carries an override —
    // so without this, every candidate would be scored on the shipped genome's
    // read and its own read:* weights would be invisible to fitness. This is
    // the channel active.js documents for exactly that: a genome that is not
    // the shipped one, arriving as plain data on the state, which is how the
    // browser trainer already reaches the engine.
    state.genomeOverrides = { ...state.genomeOverrides, defense: values };
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

/**
 * The one thing neither recorded log has: a play that sells a run and throws.
 *
 * Written rather than replayed because a fake is exactly what a human coach
 * does not happen to have recorded, and read:inertia — the weight that decides
 * how long a defense stays wrong after it has been fooled — has nothing to
 * learn without one. Turn 0 is planLearnedRun's own picture, so the run keys
 * are the real ones: the line drives, the back leans, the quarterback carries
 * out a fake. Turn 2 is the throw.
 *
 * The genome is a constant rather than a learned one on purpose. This is a
 * fixed opponent, the way scriptedOffenseCoach is; a play-action that evolved
 * would move the target the defense is being scored against.
 */
const PLAY_ACTION_GENOME = {
  'run:sideBias': 0, 'run:read': 0, 'run:lean': 0.4,
  'qb:drop': 0.6, 'throw:go': -Infinity, 'throw:hold': 2,
  'tgt:sep': 1, 'tgt:depth': 1, 'tgt:dist': -0.5,
};

export function playActionCoach(state) {
  if (state.turnIndex === 0) {
    planLearnedRun(state, PLAY_ACTION_GENOME);
    return;
  }
  const qb = state.players.find((p) => p.id === SNAP_TARGET_ID);
  const car = carrier(state);
  if (!qb || !car || car.id !== qb.id) return; // the fake got the ball: let it run
  planLearnedPassSnap(state, PLAY_ACTION_GENOME);
  if (state.turnIndex >= 2) planThrow(state, PLAY_ACTION_GENOME, qb);
}

/**
 * One offense that is three, dealt per down.
 *
 * The run arm and the pass arm are recorded human football (see
 * coaching-logs/default-*.json): twenty-seven real downs are better than
 * anything this file would make up, and the pitches in the run log are real
 * examples of the ball being in the air on a running play, which is exactly
 * the ambiguity read:ballAir has to price. The third arm is written, because
 * no coach recorded a fake.
 *
 * The arm is chosen once per DOWN and kept on the state, not re-rolled every
 * turn: a play that changed its mind at turn two would teach the read that
 * evidence means nothing.
 */
export function dealtOffenseCoach({ runLog, passLog, rand }) {
  const arms = [
    { name: 'run', coach: ghostCoach(runLog, 'offense') },
    { name: 'pass', coach: ghostCoach(passLog, 'offense') },
    { name: 'play-action', coach: playActionCoach },
  ];
  return (state) => {
    if (state.turnIndex === 0 && !state.dealtArm) {
      state.dealtArm = arms[Math.floor(rand() * arms.length)].name;
    }
    const arm = arms.find((a) => a.name === state.dealtArm) ?? arms[0];
    arm.coach(state);
  };
}

/**
 * Turn a batch of playOnePlay results into the aggregate defenseFitness
 * needs (see fitness.js). A mean of yards alone cannot express an asymmetric,
 * per-play rule — the sign is gone, and nothing says which plays were
 * touchdowns — so this keeps gain and loss summed separately, touchdown
 * yards apart from the rest, and time/passes/air-yards summed only over the
 * non-touchdown plays they apply to. Every field is a sum over its
 * qualifying plays divided by the TOTAL play count, so the terms compose
 * additively into a per-play mean. touchdownRate, turnoverRate and
 * yardsPerPlay are kept exactly as before: offenseFitness and the analysis
 * scripts read them.
 *
 * The single place both evaluatePair (below) and vs-ghost.js's
 * evaluateVsGhost reach for this aggregation, so a defense trained against
 * the scripted offense, another genome, or a ghost of a human are all scored
 * the same way.
 */
export function summarizePlays(results) {
  const n = results.length;
  const totals = {
    yards: 0, touchdowns: 0, turnovers: 0,
    gainYards: 0, lossYards: 0, tdYards: 0,
    seconds: 0, passes: 0, airYards: 0,
  };
  for (const r of results) {
    totals.yards += r.yards;
    if (r.turnover) totals.turnovers += 1;
    if (r.touchdown) {
      totals.touchdowns += 1;
      totals.tdYards += r.yards;
    } else {
      totals.gainYards += Math.max(0, r.yards);
      totals.lossYards += Math.max(0, -r.yards);
      totals.seconds += r.turns * TURN_SECONDS;
      totals.passes += r.passes;
      totals.airYards += r.airYards;
    }
  }
  return {
    yardsPerPlay: totals.yards / n,
    touchdownRate: totals.touchdowns / n,
    turnoverRate: totals.turnovers / n,
    gainYardsPerPlay: totals.gainYards / n,
    lossYardsPerPlay: totals.lossYards / n,
    tdYardsPerPlay: totals.tdYards / n,
    secondsPerPlay: totals.seconds / n,
    passesPerPlay: totals.passes / n,
    airYardsPerPlay: totals.airYards / n,
  };
}

/**
 * Mean per-play stats for two coaches over `plays` seeded scenarios. The one
 * place a fitness evaluation's dice are rolled: the scenarios come off one
 * `rand`, and each play's own randomness is a fresh generator seeded from it,
 * so two genomes evaluated at the same seed see the same downs and the same
 * tackle rolls whichever side of the ball each is on.
 */
export function evaluatePair({ offense, defense, plays, seed }) {
  const rand = mulberry32(seed);
  const results = [];
  for (let i = 0; i < plays; i++) {
    const state = scenario(rand);
    results.push(playOnePlay(
      state, offense, defense, mulberry32(1 + Math.floor(rand() * 2 ** 30)),
    ));
  }
  return summarizePlays(results);
}

/** Mean per-play stats for one defense genome over `plays` seeded scenarios. */
export function evaluateDefense(values, { plays, seed, offenseCoach = scriptedOffenseCoach }) {
  return evaluatePair({
    offense: offenseCoach, defense: defenseCoach(values), plays, seed,
  });
}

/**
 * The assignment defense (defense.js) as a coach function — the `smart` level,
 * hot-seat. It is to a contributed OFFENSE what scriptedOffenseCoach is to a
 * contributed defense: the best opponent this codebase can field with no
 * genome at all, and therefore the second opinion worth having when the
 * learned matchup is the only other evidence.
 */
export function smartDefenseCoach(state) {
  applyAiModes(state, 'defense');
  applyOrders(state, smartOrders(state, 'defense'));
}

/** The offense twin of evaluateDefense: one offense genome's mean per-play
 *  stats against a given defense coach, on the same downs and the same dice. */
export function evaluateOffense(values, { plays, seed, defenseCoach: defense = smartDefenseCoach }) {
  return evaluatePair({
    offense: learnedOffenseCoach(values, mulberry32(seed)), defense, plays, seed,
  });
}

/**
 * The learned offense as a coach function: its genome's formation at the
 * top of the down (the auto snap re-aims itself — it is locked on the QB,
 * and releasePass re-solves a locked throw at the whistle), a perturbation on
 * top of it, then the whole-down brain every turn.
 *
 * applyLearnedOffenseFormation OVERWRITES the whole look with the offense
 * genome's fixed spots — so without a further step, a play run through this
 * coach would show the defense the same formation every time, regardless of
 * what dealOffensiveLook drew for the scenario. varyOffensiveLook is that
 * further step: it nudges the formation just written, so the defense being
 * scored through evaluateMatch (below) — and therefore `npm run
 * train:coevolve` — sees a formation that is different every play AND still
 * recognisably the offense's own, which is what its `adapt:*` weights need to
 * have anything to learn from.
 *
 * `rand` is the caller's own — every call site below builds it from the same
 * `seed` the rest of the evaluation already turns on, exactly the way
 * evaluatePair/evaluateVsGhost build their own scenario-dealing `rand` from
 * it. There is no random source already reaching this factory function (it
 * closes only over `values`), and a fresh generator seeded the same way
 * everything else here is seeded is the smallest way to get one — reaching
 * for Math.random would break the one property this whole harness exists to
 * keep, that two candidates scored at the same seed see identical dice.
 */
export function learnedOffenseCoach(values, rand) {
  // Named here rather than left to fail inside varyOffensiveLook: without
  // this, calling the old one-argument form throws several frames deep in
  // the middle of a play, which reads as an engine fault rather than a
  // caller passing the wrong thing.
  if (typeof rand !== 'function') {
    throw new TypeError('learnedOffenseCoach needs a seeded rand: the offense varies its look every play');
  }
  return (state) => {
    if (state.turnIndex === 0 && state.phase === 'planning') {
      applyLearnedOffenseFormation(state, values);
      varyOffensiveLook(state, rand);
    }
    coachLearnedOffense(state, values);
  };
}

/**
 * Learned offense vs learned defense: one stats object, read positively by
 * the offense's fitness and negatively by the defense's.
 *
 * This is co-evolution's evaluator. The offense's formation is perturbed by
 * varyOffensiveLook (see learnedOffenseCoach) before the defense ever reads
 * it, which is what makes this path — and not just evaluateDefense's
 * scripted-offense one — able to train the `adapt:*` weights too.
 */
export function evaluateMatch(offValues, defValues, { plays, seed }) {
  return evaluateDefense(defValues, {
    plays, seed, offenseCoach: learnedOffenseCoach(offValues, mulberry32(seed)),
  });
}
