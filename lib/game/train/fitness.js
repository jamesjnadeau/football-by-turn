/**
 * What "better" means, for each side of the ball. One number per side, both
 * denominated in yards so their three terms share a scale.
 *
 * Lifted out of the two trainers that used to own one each (train-defense.js
 * and coevolve.js) so that the browser trainer scores a genome exactly the way
 * the CLIs do — a genome trained on a phone has to be comparable to one
 * trained on a laptop, or tools/import-genome.js is comparing nothing.
 */

// A turnover is worth about a possession's field position; a touchdown given
// up costs more than any one play's yardage.
export const TURNOVER_BONUS_YARDS = 8;
export const TOUCHDOWN_PENALTY_YARDS = 10;

export function defenseFitness(stats) {
  return -stats.yardsPerPlay
    + TURNOVER_BONUS_YARDS * stats.turnoverRate
    - TOUCHDOWN_PENALTY_YARDS * stats.touchdownRate;
}

// The same two prices, read from the other sideline.
export const TD_BONUS_YARDS = 10;
export const TURNOVER_PENALTY_YARDS = 8;

export function offenseFitness(stats) {
  return stats.yardsPerPlay
    + TD_BONUS_YARDS * stats.touchdownRate
    - TURNOVER_PENALTY_YARDS * stats.turnoverRate;
}
