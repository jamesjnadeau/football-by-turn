/**
 * A small elitist (mu+lambda) evolution loop over genome objects. Nothing in
 * it knows about football: it takes a spec, a fitness function and a seed,
 * and hill-climbs. Selection keeps the top `elite`, refill mutates random
 * elites, and the whole walk is deterministic from `seed`.
 *
 * Fitness receives (genome, generationIndex) so the caller can key common
 * random numbers to the generation: every candidate within one generation
 * should be scored on the same simulated downs, or selection is choosing
 * lucky schedules rather than good genomes.
 */
import { mulberry32 } from '../lib/game/rng.js';
import { clampGenome, mutateGenome } from '../lib/game/learned/genome.js';

export function evolve({
  spec, fitness, seedGenome = null,
  popSize = 16, generations = 20, elite = 4, sigma = 0.08, seed = 1,
  onGeneration = null,
}) {
  const rand = mulberry32(seed);
  const base = clampGenome(spec, seedGenome);
  let pop = [base];
  while (pop.length < popSize) pop.push(mutateGenome(spec, base, rand, sigma));

  let best = null;
  const history = [];
  for (let g = 0; g < generations; g++) {
    const scored = pop
      .map((genome) => ({ genome, score: fitness(genome, g) }))
      .sort((a, b) => b.score - a.score);
    if (!best || scored[0].score > best.score) best = scored[0];
    history.push(scored[0].score);
    if (onGeneration) onGeneration(g, scored);

    const parents = scored.slice(0, elite).map((s) => s.genome);
    pop = [...parents];
    while (pop.length < popSize) {
      const parent = parents[Math.floor(rand() * parents.length)];
      pop.push(mutateGenome(spec, parent, rand, sigma));
    }
  }
  return { best: best.genome, score: best.score, history };
}
