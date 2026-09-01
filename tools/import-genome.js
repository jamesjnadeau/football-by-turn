/**
 * Take a genome somebody trained in his browser and decide whether this
 * repository should ship it.
 *
 * Usage:
 *   node tools/import-genome.js --bundle contributed.json
 *   node tools/import-genome.js --bundle contributed.json --plays 40 --seed 3
 *   node tools/import-genome.js --bundle contributed.json --force
 *
 * Three gates, in order. It has to BE a bundle (lib/game/train/bundle.js
 * refuses a file from another build, another version, or a genome whose values
 * do not fit this spec). It has to WIN — the same downs and the same dice as
 * the genome currently shipped, judged on the matchup that genome was last
 * trained on. And only then is the generated module rewritten, carrying the
 * contributor's own meta and the numbers actually measured here, so that
 * `git log` on defense-genome.js says where its values came from.
 *
 * --force ships a loser anyway, for the one case worth having it: a genome
 * that is interesting rather than better.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseBundle } from '../lib/game/train/bundle.js';
import { defenseFitness, offenseFitness } from '../lib/game/train/fitness.js';
import {
  evaluateDefense, evaluateOffense, evaluateMatch,
} from '../lib/game/train/harness.js';
import { shippedGenome } from '../lib/game/learned/active.js';
import { genomeModuleSource } from '../lib/game/learned/genome.js';

/** Enough downs that a yard per play means something, few enough that the
 *  whole comparison — four evaluations — is over in a few seconds. */
export const DEFAULT_PLAYS = 24;
export const DEFAULT_SEED = 7;

/**
 * Two matchups for one genome. The PRIMARY is against the learned opponent —
 * the matchup the shipped genomes were last co-evolved on, and therefore the
 * one a challenger has to win. The secondary is against the opponent that has
 * no genome at all: the scripted run option for a defense, the assignment
 * defense for an offense. A genome that wins the first and collapses in the
 * second has learned an opponent rather than football, and the maintainer
 * should see that before adopting it.
 */
export function gauntlet(values, side, { plays, seed }) {
  if (side === 'defense') {
    const primary = evaluateMatch(shippedGenome('offense'), values, { plays, seed });
    const secondary = evaluateDefense(values, { plays, seed });
    return {
      primary: {
        label: 'defense vs the learned offense',
        stats: primary,
        fitness: defenseFitness(primary),
      },
      secondary: {
        label: 'defense vs the scripted offense',
        stats: secondary,
        fitness: defenseFitness(secondary),
      },
    };
  }
  const primary = evaluateMatch(values, shippedGenome('defense'), { plays, seed });
  const secondary = evaluateOffense(values, { plays, seed });
  return {
    primary: {
      label: 'offense vs the learned defense',
      stats: primary,
      fitness: offenseFitness(primary),
    },
    secondary: {
      label: 'offense vs the smart defense',
      stats: secondary,
      fitness: offenseFitness(secondary),
    },
  };
}

/**
 * Challenger and incumbent through the same gauntlet at the same seed — common
 * random numbers, exactly as within a training generation: both genomes see
 * the same downs and the same tackle rolls, which is the only way two
 * fitnesses compare at all. A tie is not a win: the shipped genome keeps its
 * place unless somebody actually beats it.
 */
export function compareBundle(bundle, { plays = DEFAULT_PLAYS, seed = DEFAULT_SEED } = {}) {
  const incumbent = gauntlet(shippedGenome(bundle.side), bundle.side, { plays, seed });
  const challenger = gauntlet(bundle.values, bundle.side, { plays, seed });
  return {
    side: bundle.side,
    plays,
    seed,
    incumbent,
    challenger,
    wins: challenger.primary.fitness > incumbent.primary.fitness,
  };
}

const num = (v) => v.toFixed(2);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

function row(label, r) {
  return `  ${label.padEnd(13)}${num(r.stats.yardsPerPlay).padStart(9)}`
    + `${pct(r.stats.touchdownRate).padStart(8)}${pct(r.stats.turnoverRate).padStart(8)}`
    + `${num(r.fitness).padStart(10)}`;
}

/** The whole comparison as something a maintainer can read in one glance. */
export function comparisonReport(c) {
  const lines = [
    `${c.side} genome — ${c.plays} seeded downs per matchup at seed ${c.seed}, same downs for both`,
    '',
  ];
  for (const key of ['primary', 'secondary']) {
    lines.push(c.incumbent[key].label + (key === 'primary' ? '   (primary)' : ''));
    lines.push(`  ${''.padEnd(13)}${'yds/play'.padStart(9)}${'TD'.padStart(8)}`
      + `${'TO'.padStart(8)}${'fitness'.padStart(10)}`);
    lines.push(row('shipped', c.incumbent[key]));
    lines.push(row('contributed', c.challenger[key]));
    lines.push('');
  }
  lines.push(c.wins
    ? `VERDICT: the contributed genome wins the primary matchup, ${num(c.challenger.primary.fitness)} to ${num(c.incumbent.primary.fitness)}.`
    : `VERDICT: the contributed genome does not beat the shipped one, ${num(c.challenger.primary.fitness)} to ${num(c.incumbent.primary.fitness)}.`);
  return lines.join('\n');
}

function numArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

function strArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

// CLI body — guarded so importing this module (the tests) evaluates nothing
// and writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bundlePath = strArg('bundle', null);
  if (!bundlePath) {
    console.error('usage: node tools/import-genome.js --bundle <path> [--plays N] [--seed N] [--force]');
    process.exit(1);
  }
  let text;
  try {
    text = readFileSync(bundlePath, 'utf8');
  } catch (err) {
    console.error(`cannot read ${bundlePath}: ${err.message}`);
    process.exit(1);
  }
  const { bundle, error } = parseBundle(text);
  if (error) {
    console.error(`${bundlePath} is not a genome bundle this build can use: ${error}`);
    process.exit(1);
  }
  const opts = { plays: numArg('plays', DEFAULT_PLAYS), seed: numArg('seed', DEFAULT_SEED) };
  console.log(
    `${bundlePath}: a ${bundle.side} genome for the '${bundle.variant}' game,`
    + ` trained by ${bundle.meta.trainedBy ?? 'someone'}`
    + (bundle.meta.snapshots ? ` against ${bundle.meta.snapshots} recorded calls` : ''),
  );
  const comparison = compareBundle(bundle, opts);
  console.log('');
  console.log(comparisonReport(comparison));
  const force = process.argv.includes('--force');
  if (!comparison.wins && !force) {
    console.log('Not adopted. Pass --force to ship it anyway.');
    process.exit(0);
  }
  const file = bundle.side === 'defense' ? 'defense-genome.js' : 'offense-genome.js';
  const exportName = bundle.side === 'defense' ? 'DEFENSE_GENOME' : 'OFFENSE_GENOME';
  writeFileSync(
    new URL(`../lib/game/learned/${file}`, import.meta.url),
    genomeModuleSource(exportName, bundle.values, {
      variant: bundle.variant,
      trainedBy: 'tools/import-genome.js',
      opponent: `contributed bundle ${bundlePath}`,
      // The contributor's own account of the run, carried verbatim so the
      // genome module records where its numbers actually came from.
      contributed: bundle.meta,
      gauntlet: {
        plays: comparison.plays,
        seed: comparison.seed,
        primary: {
          label: comparison.challenger.primary.label,
          stats: comparison.challenger.primary.stats,
        },
        secondary: {
          label: comparison.challenger.secondary.label,
          stats: comparison.challenger.secondary.stats,
        },
      },
      fitness: comparison.challenger.primary.fitness,
    }),
  );
  console.log(
    `${comparison.wins ? 'Adopted' : 'Forced'} — wrote lib/game/learned/${file}.`
    + ' Run npm test, play a drive, and commit it like any other source file.',
  );
}
