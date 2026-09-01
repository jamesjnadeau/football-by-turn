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
  createGame, formationPlayers, aimSnap, ballPos, SNAPPER_ID,
} from '../state.js';
import { runTurn } from '../turn.js';
import { yardsOfY, GOAL_YARD, fieldPos } from '../view.js';
import { mulberry32 } from '../rng.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT, CENTRE_X } from '../../field/geometry.js';
import { applyOrders, applyAiModes } from '../ai.js';
import { smartOrders } from '../defense.js';
import { learnedOrders } from '../learned/defense-policy.js';
import { applyLearnedOffenseFormation } from '../learned/formation.js';
import { applyLearnedLook } from '../formation.js';
import { autoplanOffense } from '../offense.js';
import { coachLearnedOffense } from '../learned/offense-policy.js';
import { FIRST_DOWN_YARDS } from '../constants.js';
import { baseVariantId } from '../rosters.js';

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
  // a refused look is not a down anybody can learn from. Only the across axis
  // moves here -- depth is already whatever the bands above drew -- so a pair
  // that is closer than they may stand gets slid apart along x by exactly the
  // amount that restores legal separation at their fixed depths, rather than
  // by a fraction of the straight-line gap (which left them still overlapping
  // whenever they also differed in depth).
  //
  // Movers are fixed up in a set order (wr1, wr2, qb, rb) and each one only
  // ever yields to a mover earlier in that order, never the other way --
  // otherwise two receivers colliding near the same sideline can leapfrog
  // each other outward pass after pass and pile up on the boundary instead of
  // settling. A mover that must give ground always gives it AWAY from the
  // centre, never back toward it: sliding toward the ball is how an off-band
  // receiver used to end up standing on a guard. A hair of margin over the
  // true minimum keeps floating-point rounding from landing exactly back on
  // the boundary spotFault refuses.
  const CLEAR_MARGIN = 1e-6;
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
 * Mean per-play stats for two coaches over `plays` seeded scenarios. The one
 * place a fitness evaluation's dice are rolled: the scenarios come off one
 * `rand`, and each play's own randomness is a fresh generator seeded from it,
 * so two genomes evaluated at the same seed see the same downs and the same
 * tackle rolls whichever side of the ball each is on.
 */
export function evaluatePair({ offense, defense, plays, seed }) {
  const rand = mulberry32(seed);
  let yards = 0;
  let touchdowns = 0;
  let turnovers = 0;
  for (let i = 0; i < plays; i++) {
    const state = scenario(rand);
    const result = playOnePlay(
      state, offense, defense, mulberry32(1 + Math.floor(rand() * 2 ** 30)),
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
    offense: learnedOffenseCoach(values), defense, plays, seed,
  });
}

/**
 * The learned offense as a coach function: its genome's formation at the
 * top of the down (the auto snap re-aims itself — it is locked on the QB,
 * and releasePass re-solves a locked throw at the whistle), then the
 * whole-down brain every turn.
 *
 * Unlike scenario's dealOffensiveLook, applyLearnedOffenseFormation OVERWRITES
 * the whole look with the offense genome's fixed spots — so a play run
 * through this coach shows the defense the same formation every time,
 * regardless of what dealOffensiveLook drew. That is the one condition
 * evaluateMatch (below), and therefore `npm run train:coevolve`, cannot
 * avoid: a defense trained down this path sees one look, never the varied
 * ones dealOffensiveLook exists to deal, and its `adapt:*` weights score as
 * noise and drift toward it. `train:defense` (evaluateDefense with the
 * scripted offense) is the path that actually exercises them — see the
 * README's training section.
 */
export function learnedOffenseCoach(values) {
  return (state) => {
    if (state.turnIndex === 0 && state.phase === 'planning') {
      applyLearnedOffenseFormation(state, values);
    }
    coachLearnedOffense(state, values);
  };
}

/**
 * Learned offense vs learned defense: one stats object, read positively by
 * the offense's fitness and negatively by the defense's.
 *
 * This is co-evolution's evaluator, and it inherits learnedOffenseCoach's
 * fixed-look limitation directly: the defense being scored here never sees
 * the varied looks dealOffensiveLook deals, so its `adapt:*` weights are not
 * being trained through this path, whatever `npm run train:coevolve`'s
 * fitness numbers might suggest.
 */
export function evaluateMatch(offValues, defValues, { plays, seed }) {
  return evaluateDefense(defValues, {
    plays, seed, offenseCoach: learnedOffenseCoach(offValues),
  });
}
