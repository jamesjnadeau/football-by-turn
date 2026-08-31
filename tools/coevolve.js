/**
 * Competitive co-evolution: two populations, alternating generations, each
 * side scored by playing the other's champion — plus a small HALL OF FAME
 * of past champions, because pure champion-vs-champion co-evolution chases
 * its own tail (beat today's opponent, forget yesterday's). Scoring against
 * a few generations of history keeps improvements real.
 *
 * This is the training the spec actually asks for; train-defense.js's
 * scripted-opponent run was the bootstrap that made the first defense
 * genome worth playing against.
 *
 * Both fitness functions moved to lib/game/train/fitness.js with the rest of
 * the training core; the offense's is re-exported here so that every existing
 * importer still finds it.
 */
import { mulberry32 } from '../lib/game/rng.js';
import { clampGenome, mutateGenome } from '../lib/game/learned/genome.js';
import { OFFENSE_SPEC } from '../lib/game/learned/offense-spec.js';
import { DEFENSE_SPEC } from '../lib/game/learned/defense-spec.js';
import { evaluateMatch } from '../lib/game/train/harness.js';
import {
  defenseFitness, offenseFitness, TD_BONUS_YARDS, TURNOVER_PENALTY_YARDS,
} from '../lib/game/train/fitness.js';

export { offenseFitness, TD_BONUS_YARDS, TURNOVER_PENALTY_YARDS };

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function coevolve({
  offSeed, defSeed,
  popSize = 12, generations = 20, elite = 3, sigma = 0.06,
  plays = 12, hof = 2, seed = 1, onGeneration = null,
}) {
  const rand = mulberry32(seed);
  const mut = (spec, g) => mutateGenome(spec, g, rand, sigma);
  const fill = (spec, parents) => {
    const pop = [...parents];
    while (pop.length < popSize) {
      pop.push(mut(spec, parents[Math.floor(rand() * parents.length)]));
    }
    return pop;
  };

  let bestOff = clampGenome(OFFENSE_SPEC, offSeed);
  let bestDef = clampGenome(DEFENSE_SPEC, defSeed);
  let popOff = fill(OFFENSE_SPEC, [bestOff]);
  let popDef = fill(DEFENSE_SPEC, [bestDef]);
  const hallOff = [];
  const hallDef = [];
  const history = [];

  const step = (pop, spec, score) => {
    const scored = pop
      .map((genome) => ({ genome, score: score(genome) }))
      .sort((a, b) => b.score - a.score);
    return { champion: scored[0], next: fill(spec, scored.slice(0, elite).map((s) => s.genome)) };
  };

  for (let g = 0; g < generations; g++) {
    const genSeed = seed * 1000003 + g;

    // Offense generation: every candidate against the defense champion and
    // the recent hall, on common seeds.
    const defOpp = [bestDef, ...hallDef.slice(-hof)];
    const offStep = step(popOff, OFFENSE_SPEC, (genome) => mean(
      defOpp.map((d, i) => offenseFitness(
        evaluateMatch(genome, d, { plays, seed: genSeed * 31 + i }),
      )),
    ));
    bestOff = offStep.champion.genome;
    popOff = offStep.next;

    // Defense generation, against the offense that just improved.
    const offOpp = [bestOff, ...hallOff.slice(-hof)];
    const defStep = step(popDef, DEFENSE_SPEC, (genome) => mean(
      offOpp.map((o, i) => defenseFitness(
        evaluateMatch(o, genome, { plays, seed: genSeed * 37 + i }),
      )),
    ));
    bestDef = defStep.champion.genome;
    popDef = defStep.next;

    hallOff.push(bestOff);
    hallDef.push(bestDef);
    history.push({ gen: g, offense: offStep.champion.score, defense: defStep.champion.score });
    if (onGeneration) onGeneration(g, history[history.length - 1]);
  }
  return { offense: bestOff, defense: bestDef, history };
}
