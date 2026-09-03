/**
 * Train the defense genome against a dealt offense — recorded human runs,
 * recorded human passes, and a written play-action fake — and write the
 * result into lib/game/learned/defense-genome.js, where the game imports it.
 *
 * Usage:
 *   node tools/train-defense.js --generations 30 --pop 16 --plays 24 --seed 1
 *
 * The opponent here is a bootstrap, not the end state: tools/train-coevolve.js
 * retrains this genome against the LEARNED offense, population against
 * population; keep using that.
 *
 * The fitness function moved to lib/game/train/fitness.js with the rest of the
 * training core (the browser trains too); it is re-exported here so that every
 * existing importer — tools/coevolve.js, the tests — still finds it.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DEFENSE_SPEC } from '../lib/game/learned/defense-spec.js';
import { DEFENSE_GENOME } from '../lib/game/learned/defense-genome.js';
import { genomeModuleSource } from '../lib/game/learned/genome.js';
import { evolve } from '../lib/game/train/evolve.js';
import { evaluateDefense, dealtOffenseCoach } from '../lib/game/train/harness.js';
import { mulberry32 } from '../lib/game/rng.js';
import { loadGhostLog } from './ghost.js';
import {
  defenseFitness, TURNOVER_BONUS_YARDS, TOUCHDOWN_PENALTY_YARDS,
} from '../lib/game/train/fitness.js';

export { defenseFitness, TURNOVER_BONUS_YARDS, TOUCHDOWN_PENALTY_YARDS };

/**
 * The recorded football this genome is scored against. Committed to the
 * repository (see coaching-logs/ and .gitignore) so that a genome trained here
 * can be rebuilt from a clean checkout rather than from a log only one
 * contributor happens to have.
 */
const RUN_LOG = new URL('../coaching-logs/default-offense.json', import.meta.url);
const PASS_LOG = new URL('../coaching-logs/default-offense2.json', import.meta.url);

export function trainDefense({ generations, popSize, plays, seed, sigma }) {
  return evolve({
    spec: DEFENSE_SPEC,
    seedGenome: DEFENSE_GENOME.values,
    popSize,
    generations,
    sigma,
    seed,
    // Common random numbers: every candidate in generation g sees the same
    // downs, the same dice and the same dealt offense, so their scores
    // actually compare.
    fitness: (genome, gen) => {
      const seedForGen = seed * 1000003 + gen;
      return defenseFitness(evaluateDefense(genome, {
        plays,
        seed: seedForGen,
        offenseCoach: dealtOffenseCoach({
          runLog: loadGhostLog(RUN_LOG),
          passLog: loadGhostLog(PASS_LOG),
          rand: mulberry32(seedForGen),
        }),
      }));
    },
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
  console.log('training defense vs recorded runs, recorded passes and a fake:', opts);
  const { best, score } = trainDefense(opts);
  console.log(`champion fitness ${score.toFixed(3)} — writing defense-genome.js`);
  writeFileSync(
    new URL('../lib/game/learned/defense-genome.js', import.meta.url),
    genomeModuleSource('DEFENSE_GENOME', best, {
      variant: '7',
      trainedBy: 'tools/train-defense.js',
      opponent: 'dealt: default-offense.json, default-offense2.json, play-action',
      options: opts,
      fitness: score,
    }),
  );
}
