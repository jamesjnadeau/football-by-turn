/**
 * Train a genome against a GHOST OF YOU — the log the game's Coaches Menu
 * records, replayed by ghost.js as the opponent coach.
 *
 * `side` names the genome to TRAIN; the ghost always plays the other one,
 * which is the side the human was recorded coaching. Training the defense
 * against a ghost of your offense is the normal use.
 *
 * Everything else is the existing machinery: harness.js plays the downs,
 * evolve.js hill-climbs, and fitness.js prices the result, so a genome trained
 * here is comparable to one trained against the scripted offense or in
 * co-evolution. The only new thing is who is standing across the ball.
 *
 * Two front doors run this: tools/train-vs-ghost.js (a log off disk, progress
 * to the console) and app/train-worker.js (a log out of localStorage, progress
 * posted to the page). Both get the same walk for the same seed.
 */
import { formationPlayers, aimSnap, SNAPPER_ID } from '../state.js';
import { GOAL_YARD } from '../view.js';
import { mulberry32 } from '../rng.js';
import { DEFENSE_SPEC } from '../learned/defense-spec.js';
import { DEFENSE_GENOME } from '../learned/defense-genome.js';
import { OFFENSE_SPEC } from '../learned/offense-spec.js';
import { OFFENSE_GENOME } from '../learned/offense-genome.js';
import { evolve } from './evolve.js';
import {
  scenario, playOnePlay, defenseCoach, learnedOffenseCoach,
} from './harness.js';
import { defenseFitness, offenseFitness } from './fitness.js';
import { ghostCoach, logSituations } from './ghost.js';

/**
 * How often a training down is dealt from a situation the log actually holds
 * rather than from the harness's uniform sample of the field. Half and half on
 * purpose: all-recorded would overfit the genome to the handful of spots one
 * human happened to play from, and all-random would spend most of its downs in
 * situations the ghost has nothing near and therefore plays badly in.
 */
export const GHOST_SITUATION_SHARE = 0.5;

/**
 * How many recorded calls it takes before a ghost is worth training against.
 * Twelve is about three downs of coaching — few enough that a coach reaches it
 * in his first drive, many enough that the nearest-neighbor lookup has a real
 * choice to make rather than one answer for every situation on the field.
 */
export const MIN_GHOST_SNAPSHOTS = 12;

/**
 * The one run size the browser offers. 12 x 10 x 12 is 1,440 simulated downs:
 * about a second of a laptop's worker and a few of a phone's, which is what
 * makes this a button rather than a job. `seed` is fixed rather than random on
 * purpose — training twice on the same log gives the same genome, and it still
 * improves, because the second run starts from the first one's champion (see
 * trainVsGhost's seedGenome). No knobs in v1: a coach who wants to sweep them
 * has tools/train-vs-ghost.js.
 */
export const BROWSER_TRAINING_RUN = {
  generations: 12, popSize: 10, plays: 12, sigma: 0.08, seed: 1,
};

/**
 * Whether this log can be trained against, which side it would train, and a
 * sentence the board can say either way.
 *
 * The ghost imitates the side the human was RECORDED coaching — whichever side
 * he has more snapshots of, offense on a tie because coaching the offense
 * against a learned defense is the game's own default — and the genome that
 * gets trained is the other one. That is tools/train-vs-ghost.js's convention
 * exactly, arrived at from the log instead of from a flag.
 *
 * Two refusals, both of them the CLI's own guards. Too few calls, and there is
 * nothing to imitate. No calls past the first turn of a down, and the ghost
 * stands still the moment the ball is live: the CLI merely warns about that,
 * because a person is reading the terminal and can judge; here nobody is, and
 * a run that produces a genome trained against a statue is worse than no run.
 */
export function ghostReadiness(log, variant) {
  const forSide = (s) => log.filter(
    (snap) => snap.situation.side === s && snap.situation.variant === variant,
  );
  const offense = forSide('offense');
  const defense = forSide('defense');
  const ghostSide = defense.length > offense.length ? 'defense' : 'offense';
  const snaps = ghostSide === 'defense' ? defense : offense;
  const side = ghostSide === 'defense' ? 'offense' : 'defense';
  const midPlay = snaps.filter((s) => s.situation.turnIndex > 0).length;
  const base = { side, ghostSide, snapshots: snaps.length, midPlay };
  if (snaps.length < MIN_GHOST_SNAPSHOTS) {
    return {
      ...base,
      ok: false,
      reason: `Only ${snaps.length} recorded call(s) — run at least ${MIN_GHOST_SNAPSHOTS} turns and try again.`,
    };
  }
  if (midPlay === 0) {
    return {
      ...base,
      ok: false,
      reason: 'Every recorded call is a first-turn call — play some downs past the snap, so the ghost has something to do once the ball is live.',
    };
  }
  return {
    ...base,
    ok: true,
    reason: `Training the ${side} against a ghost of ${snaps.length} of your ${ghostSide} calls.`,
  };
}

/**
 * A training down: the harness's own random scenario, or — half the time — the
 * same thing re-spotted to a down and distance the human really played. Every
 * value is clamped back into the harness's own legal range, because a log can
 * carry a goal-line snap or a fourth-and-thirty and the scenario contract is
 * what the rest of the harness relies on.
 */
export function ghostScenario(rand, situations, variant = '7') {
  const state = scenario(rand, variant);
  if (!situations.length || rand() >= GHOST_SITUATION_SHARE) return state;
  const pick = situations[Math.floor(rand() * situations.length)];
  state.down = Math.max(1, Math.min(4, Math.round(pick.down)));
  state.losYard = Math.max(15, Math.min(80, Math.round(pick.losYard)));
  state.toGoYard = Math.min(
    state.losYard + Math.max(1, Math.round(pick.toGo)), GOAL_YARD,
  );
  state.players = formationPlayers(state.losYard, variant);
  state.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  state.plannedPass = null;
  aimSnap(state);
  return state;
}

/**
 * Mean per-play stats for one genome over `plays` seeded downs against the
 * ghost. Same aggregation as harness.js's evaluateDefense — one stats object,
 * read negatively by the defense's fitness and positively by the offense's.
 */
export function evaluateVsGhost(values, { log, side, plays, seed }) {
  const ghostSide = side === 'defense' ? 'offense' : 'defense';
  const situations = logSituations(log, ghostSide);
  const ghost = ghostCoach(log, ghostSide);
  const offense = side === 'defense' ? ghost : learnedOffenseCoach(values);
  const defense = side === 'defense' ? defenseCoach(values) : ghost;

  const rand = mulberry32(seed);
  let yards = 0;
  let touchdowns = 0;
  let turnovers = 0;
  for (let i = 0; i < plays; i++) {
    const state = ghostScenario(rand, situations);
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

/**
 * The whole run. `seedGenome` is where the walk starts: the shipped champion
 * by default, or — in the browser — the genome this coach already trained, so
 * that pressing the button twice keeps climbing instead of starting over.
 * `onGeneration` is how the caller watches: the CLI prints, the worker posts.
 */
export function trainVsGhost({
  log, side, generations, popSize, plays, seed, sigma,
  seedGenome = null, onGeneration = null,
}) {
  const spec = side === 'defense' ? DEFENSE_SPEC : OFFENSE_SPEC;
  const shipped = side === 'defense' ? DEFENSE_GENOME.values : OFFENSE_GENOME.values;
  const fitness = side === 'defense' ? defenseFitness : offenseFitness;
  return evolve({
    spec,
    seedGenome: seedGenome ?? shipped,
    popSize,
    generations,
    sigma,
    seed,
    // Common random numbers: every candidate in generation g sees the same
    // downs and the same dice — and the same ghost, which rolls none.
    fitness: (genome, gen) => fitness(
      evaluateVsGhost(genome, { log, side, plays, seed: seed * 1000003 + gen }),
    ),
    onGeneration,
  });
}
