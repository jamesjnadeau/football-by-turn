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
 * The trainer itself lives in lib/game/train/vs-ghost.js, because the browser
 * runs the same one (app/train-worker.js). What is here is the terminal: a log
 * read off disk, per-generation printing, and the file write.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { genomeModuleSource } from '../lib/game/learned/genome.js';
import { trainVsGhost } from '../lib/game/train/vs-ghost.js';
import { loadGhostLog } from './ghost.js';

export * from '../lib/game/train/vs-ghost.js';

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
  const { best, score } = trainVsGhost({
    log,
    side,
    ...opts,
    onGeneration: (gen, scored) =>
      console.log(`gen ${gen}: champion ${scored[0].score.toFixed(3)}`),
  });
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
