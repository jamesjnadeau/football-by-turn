/**
 * Train the defense genome against the scripted offense and write the result
 * into lib/game/learned/defense-genome.js, where the game imports it.
 *
 * Usage:
 *   node tools/train-defense.js --generations 30 --pop 16 --plays 24 --seed 1
 *
 * The opponent here is offense.js's scripted autoplan — a bootstrap, not the
 * end state. The Offense plan's tools/train-coevolve.js retrains this genome
 * against the LEARNED offense, population against population; keep using
 * that once it exists.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DEFENSE_SPEC } from '../lib/game/learned/defense-spec.js';
import { DEFENSE_GENOME } from '../lib/game/learned/defense-genome.js';
import { genomeModuleSource } from '../lib/game/learned/genome.js';
import { evolve } from './evolve.js';
import { evaluateDefense } from './harness.js';

// A turnover is worth about a possession's field position; a touchdown given
// up costs more than any one play's yardage. Both in "yards" so the three
// terms share a scale.
export const TURNOVER_BONUS_YARDS = 8;
export const TOUCHDOWN_PENALTY_YARDS = 10;

export function defenseFitness(stats) {
  return -stats.yardsPerPlay
    + TURNOVER_BONUS_YARDS * stats.turnoverRate
    - TOUCHDOWN_PENALTY_YARDS * stats.touchdownRate;
}

export function trainDefense({ generations, popSize, plays, seed, sigma }) {
  return evolve({
    spec: DEFENSE_SPEC,
    seedGenome: DEFENSE_GENOME.values,
    popSize,
    generations,
    sigma,
    seed,
    // Common random numbers: every candidate in generation g sees the same
    // downs and the same dice, so their scores actually compare.
    fitness: (genome, gen) =>
      defenseFitness(evaluateDefense(genome, { plays, seed: seed * 1000003 + gen })),
    onGeneration: (gen, scored) =>
      console.log(`gen ${gen}: champion ${scored[0].score.toFixed(3)}`),
  });
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

// CLI body — guarded so importing this module (tests, the co-evolution
// trainer) runs nothing and writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = {
    generations: arg('generations', 30),
    popSize: arg('pop', 16),
    plays: arg('plays', 24),
    seed: arg('seed', 1),
    sigma: arg('sigma', 0.08),
  };
  console.log('training defense vs the scripted offense:', opts);
  const { best, score } = trainDefense(opts);
  console.log(`champion fitness ${score.toFixed(3)} — writing defense-genome.js`);
  writeFileSync(
    new URL('../lib/game/learned/defense-genome.js', import.meta.url),
    genomeModuleSource('DEFENSE_GENOME', best, {
      variant: '7',
      trainedBy: 'tools/train-defense.js',
      opponent: 'scripted autoplanOffense',
      options: opts,
      fitness: score,
    }),
  );
}
