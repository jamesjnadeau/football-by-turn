/**
 * Retrain BOTH learned genomes against each other and ship the champions.
 *
 * Usage:
 *   node tools/train-coevolve.js --generations 20 --pop 12 --plays 12 --seed 1
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { OFFENSE_GENOME } from '../lib/game/learned/offense-genome.js';
import { DEFENSE_GENOME } from '../lib/game/learned/defense-genome.js';
import { genomeModuleSource } from '../lib/game/learned/genome.js';
import { coevolve } from './coevolve.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = {
    generations: arg('generations', 20),
    popSize: arg('pop', 12),
    plays: arg('plays', 12),
    elite: arg('elite', 3),
    sigma: arg('sigma', 0.06),
    hof: arg('hof', 2),
    seed: arg('seed', 1),
  };
  console.log('co-evolving offense and defense:', opts);
  const { offense, defense, history } = coevolve({
    offSeed: OFFENSE_GENOME.values,
    defSeed: DEFENSE_GENOME.values,
    ...opts,
    onGeneration: (g, h) =>
      console.log(`gen ${g}: offense ${h.offense.toFixed(3)}, defense ${h.defense.toFixed(3)}`),
  });
  const last = history[history.length - 1];
  const meta = (side, fitness) => ({
    variant: '7',
    trainedBy: 'tools/train-coevolve.js',
    opponent: 'co-evolved learned ' + side,
    options: opts,
    fitness,
  });
  writeFileSync(
    new URL('../lib/game/learned/offense-genome.js', import.meta.url),
    genomeModuleSource('OFFENSE_GENOME', offense, meta('defense', last.offense)),
  );
  writeFileSync(
    new URL('../lib/game/learned/defense-genome.js', import.meta.url),
    genomeModuleSource('DEFENSE_GENOME', defense, meta('offense', last.defense)),
  );
  console.log('wrote offense-genome.js and defense-genome.js');
}
