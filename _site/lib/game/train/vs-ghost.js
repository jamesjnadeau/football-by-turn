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
  scenario, playOnePlay, defenseCoach, learnedOffenseCoach, summarizePlays,
  evaluateMatch,
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
  // learnedOffenseCoach's own perturbation needs a random source of its own;
  // see harness.js's comment on the factory for why a fresh generator off the
  // same `seed` the rest of this evaluation already turns on is the smallest
  // legitimate way to get one.
  const offense = side === 'defense' ? ghost : learnedOffenseCoach(values, mulberry32(seed));
  const defense = side === 'defense' ? defenseCoach(values) : ghost;

  const rand = mulberry32(seed);
  const results = [];
  for (let i = 0; i < plays; i++) {
    const state = ghostScenario(rand, situations);
    results.push(playOnePlay(
      state, offense, defense, mulberry32(1 + Math.floor(rand() * 2 ** 30)),
    ));
  }
  return summarizePlays(results);
}

/**
 * The defense's other final exam: the learned offense, played exactly the way
 * harness.js's evaluateMatch plays it for train:coevolve — throwing the ball,
 * and varying its formation every play via varyOffensiveLook. That variation
 * is the whole point of reaching for this over a second call to
 * evaluateVsGhost: a ghost only ever shows the looks one human happened to
 * stand in, so it cannot tell a defense apart from one that memorized those
 * looks. Fixed at the SHIPPED offense genome (not whatever a co-evolution run
 * last produced) so this stays a stable yardstick between training runs
 * rather than a target that moves out from under the comparison.
 */
export function evaluateVsGeneralOffense(values, { plays, seed }) {
  return evaluateMatch(OFFENSE_GENOME.values, values, { plays, seed });
}

/**
 * The general evaluation's seed, offset from the ghost evaluation's by this
 * fixed, nonzero constant. That is all it takes to keep the two apart for
 * every (seed, gen) pair — they differ by exactly GENERAL_SEED_OFFSET no
 * matter what seed or generation produced the ghost seed, so there is no
 * hashing or modular arithmetic to get right, and nothing to double check as
 * `seed` or the generation count grows. A collision would not even be a real
 * hazard (two evaluations sharing a seed just run the same downs), but a
 * fixed offset is the deliberate choice the task asked for, not an accident
 * of two unrelated formulas landing on the same number.
 */
export const GENERAL_SEED_OFFSET = 998244353;

/**
 * The blended defense objective this file exists to add. A genome trained
 * against a ghost alone can buy a great ghost score by forgetting how to play
 * football against anyone else (see this repo's docs for the overfit this
 * fixes); scoring every candidate against the ghost AND the learned offense —
 * and averaging, weighted by `ghostShare` — means it cannot buy that edge
 * without paying for it on the general side too.
 *
 * `ghostShare` 1 collapses this to exactly evaluateVsGhost's own
 * defenseFitness (the pre-blend objective, still reachable and still tested);
 * `ghostShare` 0 collapses it to exactly evaluateVsGeneralOffense's. Returns
 * the three numbers together, not just the blend, because the caller wants
 * the champion's components for its log line and there is no getting them
 * back out of a bare score afterward.
 */
export function blendedDefenseFitness(values, { log, plays, seed, ghostShare = 0.5 }) {
  const ghostScore = defenseFitness(
    evaluateVsGhost(values, { log, side: 'defense', plays, seed }),
  );
  const generalScore = defenseFitness(
    evaluateVsGeneralOffense(values, { plays, seed: seed + GENERAL_SEED_OFFSET }),
  );
  return {
    score: ghostShare * ghostScore + (1 - ghostShare) * generalScore,
    ghostScore,
    generalScore,
  };
}

/**
 * The whole run. `seedGenome` is where the walk starts: the shipped champion
 * by default, or — in the browser — the genome this coach already trained, so
 * that pressing the button twice keeps climbing instead of starting over.
 * `onGeneration` is how the caller watches: the CLI prints, the worker posts.
 *
 * `ghostShare` only matters for the defense: an offense trained against a
 * ghost has no "general" opponent of its own devising here (that would be its
 * own objective, not this one — see this file's header), so its path stays
 * exactly evaluateVsGhost + offenseFitness, untouched by the option.
 */
export function trainVsGhost({
  log, side, generations, popSize, plays, seed, sigma, ghostShare = 0.5,
  seedGenome = null, onGeneration = null,
}) {
  const spec = side === 'defense' ? DEFENSE_SPEC : OFFENSE_SPEC;
  const shipped = side === 'defense' ? DEFENSE_GENOME.values : OFFENSE_GENOME.values;
  // Common random numbers: every candidate in generation g sees the same
  // downs and the same dice — and the same ghost, which rolls none — in
  // BOTH halves of a defense candidate's blended evaluation.
  const fitness = side === 'defense'
    ? (genome, gen) => blendedDefenseFitness(genome, {
      log, plays, seed: seed * 1000003 + gen, ghostShare,
    }).score
    : (genome, gen) => offenseFitness(
      evaluateVsGhost(genome, { log, side, plays, seed: seed * 1000003 + gen }),
    );
  return evolve({
    spec,
    seedGenome: seedGenome ?? shipped,
    popSize,
    generations,
    sigma,
    seed,
    fitness,
    onGeneration,
  });
}
