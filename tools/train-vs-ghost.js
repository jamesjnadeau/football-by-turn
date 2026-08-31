/**
 * Train a genome against a GHOST OF YOU — the log the game's Coaches Menu
 * exports, replayed by tools/ghost.js as the opponent coach.
 *
 * Usage:
 *   node tools/train-vs-ghost.js --log coach-log.json --side defense \
 *     --generations 20 --pop 12 --plays 16 --seed 1
 *
 * `--side` names the genome to TRAIN; the ghost always plays the other one,
 * which is the side the human was recorded coaching. Training the defense
 * against a ghost of your offense is the normal use, and it writes
 * lib/game/learned/defense-genome.js exactly as tools/train-defense.js does;
 * training the offense against a ghost of your defense writes
 * offense-genome.js the same way.
 *
 * Everything else is the existing machinery: harness.js plays the downs,
 * evolve.js hill-climbs, and the fitness functions are the ones the other two
 * trainers already use, so a genome trained here is comparable to one trained
 * against the scripted offense or in co-evolution. The only new thing is who
 * is standing across the ball.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { formationPlayers, aimSnap, SNAPPER_ID } from '../lib/game/state.js';
import { GOAL_YARD } from '../lib/game/view.js';
import { mulberry32 } from '../lib/game/rng.js';
import { DEFENSE_SPEC } from '../lib/game/learned/defense-spec.js';
import { DEFENSE_GENOME } from '../lib/game/learned/defense-genome.js';
import { OFFENSE_SPEC } from '../lib/game/learned/offense-spec.js';
import { OFFENSE_GENOME } from '../lib/game/learned/offense-genome.js';
import { genomeModuleSource } from '../lib/game/learned/genome.js';
import { evolve } from './evolve.js';
import {
  scenario, playOnePlay, defenseCoach, learnedOffenseCoach,
} from './harness.js';
import { defenseFitness } from './train-defense.js';
import { offenseFitness } from './coevolve.js';
import { ghostCoach, logSituations, loadGhostLog } from './ghost.js';

/**
 * How often a training down is dealt from a situation the log actually holds
 * rather than from the harness's uniform sample of the field. Half and half on
 * purpose: all-recorded would overfit the genome to the handful of spots one
 * human happened to play from, and all-random would spend most of its downs in
 * situations the ghost has nothing near and therefore plays badly in.
 */
export const GHOST_SITUATION_SHARE = 0.5;

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

export function trainVsGhost({ log, side, generations, popSize, plays, seed, sigma }) {
  const spec = side === 'defense' ? DEFENSE_SPEC : OFFENSE_SPEC;
  const seedGenome = side === 'defense' ? DEFENSE_GENOME.values : OFFENSE_GENOME.values;
  const fitness = side === 'defense' ? defenseFitness : offenseFitness;
  return evolve({
    spec,
    seedGenome,
    popSize,
    generations,
    sigma,
    seed,
    // Common random numbers: every candidate in generation g sees the same
    // downs and the same dice — and the same ghost, which rolls none.
    fitness: (genome, gen) => fitness(
      evaluateVsGhost(genome, { log, side, plays, seed: seed * 1000003 + gen }),
    ),
    onGeneration: (gen, scored) =>
      console.log(`gen ${gen}: champion ${scored[0].score.toFixed(3)}`),
  });
}

function numArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

function strArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

// CLI body — guarded so importing this module (the tests) runs nothing and
// writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logPath = strArg('log', null);
  const side = strArg('side', 'defense');
  if (!logPath) {
    console.error('usage: node tools/train-vs-ghost.js --log <path> [--side defense|offense]');
    process.exit(1);
  }
  if (side !== 'defense' && side !== 'offense') {
    console.error(`--side must be "defense" or "offense", not "${side}"`);
    process.exit(1);
  }
  const log = loadGhostLog(logPath);
  const ghostSide = side === 'defense' ? 'offense' : 'defense';
  // A ghost with nothing to imitate stands still for every down, and a genome
  // trained against a statue is worse than the one it started from. Refuse
  // loudly rather than spend twenty minutes producing that.
  const usable = log.filter(
    (s) => s.situation.side === ghostSide && s.situation.variant === '7',
  );
  if (usable.length === 0) {
    console.error(`${logPath} holds no '7' ${ghostSide} snapshots — the ghost would have nobody to imitate.`);
    process.exit(1);
  }
  // A log of nothing but play calls leaves the ghost standing still the moment
  // a down starts running, and a side that stands still turns most plays into
  // stalemates scored at the turn cap rather than into football. A log exported
  // from real drives always has mid-play snapshots; say so when one does not,
  // rather than quietly training on nonsense.
  if (!usable.some((s) => s.situation.turnIndex > 0)) {
    console.warn('warning: no mid-play snapshots in this log — the ghost will stand still once a play is running.');
  }
  const opts = {
    generations: numArg('generations', 20),
    popSize: numArg('pop', 12),
    plays: numArg('plays', 16),
    seed: numArg('seed', 1),
    sigma: numArg('sigma', 0.08),
  };
  console.log(
    `training ${side} against a ghost of ${usable.length} recorded ${ghostSide} snapshots:`,
    opts,
  );
  const { best, score } = trainVsGhost({ log, side, ...opts });
  const file = side === 'defense' ? 'defense-genome.js' : 'offense-genome.js';
  const exportName = side === 'defense' ? 'DEFENSE_GENOME' : 'OFFENSE_GENOME';
  console.log(`champion fitness ${score.toFixed(3)} — writing ${file}`);
  writeFileSync(
    new URL(`../lib/game/learned/${file}`, import.meta.url),
    genomeModuleSource(exportName, best, {
      variant: '7',
      trainedBy: 'tools/train-vs-ghost.js',
      opponent: `ghost of ${logPath} (${usable.length} ${ghostSide} snapshots)`,
      options: opts,
      fitness: score,
    }),
  );
}
