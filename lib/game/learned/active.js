/**
 * Which genome a learned brain actually plays, this game.
 *
 * Normally the shipped one — the champion committed into defense-genome.js and
 * offense-genome.js by the trainers. But a coach who has trained a genome in
 * his own browser (app/train-worker.js) is playing against THAT one, and it
 * reaches the engine as plain data on the state, because nothing under lib/
 * may read localStorage. The app loads it and hands it over, exactly the way it
 * hands over tendencyCounts.
 *
 * Deliberately imports nothing but the two generated data modules. ai.js reads
 * this, learned/formation.js reads it, and state.js imports formation.js —
 * anything heavier here would close an import cycle.
 */
import { DEFENSE_GENOME } from './defense-genome.js';
import { OFFENSE_GENOME } from './offense-genome.js';

/** The genome this build ships for one side of the ball. */
export function shippedGenome(side) {
  return side === 'defense' ? DEFENSE_GENOME.values : OFFENSE_GENOME.values;
}

/**
 * The values one side's learned brain should play: the state's override when
 * it has one, the shipped genome otherwise. A state built before overrides
 * existed — an old save, a test's hand-rolled object — carries no field at all
 * and reads as no override, so every existing caller behaves exactly as it did.
 */
export function activeGenome(state, side) {
  const override = state.genomeOverrides ? state.genomeOverrides[side] : null;
  return override ?? shippedGenome(side);
}
