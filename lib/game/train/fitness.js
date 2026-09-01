/**
 * What "better" means, for each side of the ball. One number per side, both
 * denominated in yards so their terms share a scale.
 *
 * Lifted out of the two trainers that used to own one each (train-defense.js
 * and coevolve.js) so that the browser trainer scores a genome exactly the way
 * the CLIs do — a genome trained on a phone has to be comparable to one
 * trained on a laptop, or tools/import-genome.js is comparing nothing.
 *
 * defenseFitness used to be nothing but -yardsPerPlay + a turnover bonus - a
 * touchdown penalty, and training zeroed every `adapt:*` weight in
 * defense-spec.js — measured: swinging adapt:back:width from 0 to 1.0 moved
 * yards allowed by less than a play's own noise (2.40 / 2.29 / 2.43 / 2.31
 * yd/play over 400 plays each). A score built only from yards, turnovers and
 * touchdowns cannot see pre-snap position, because a learned defense's
 * post-snap coverage lets it catch up whatever it started from. The terms
 * below all move on how the defense used its LOOK: how fast it ended the
 * play, how many throws it let go up, how far those throws travelled.
 */

// A turnover is worth about a possession's field position. Everything below
// is priced in "yards" so the terms share a scale.
export const TURNOVER_BONUS_YARDS = 8;
// A touchdown given up is the one outcome no amount of good play elsewhere on
// the down can excuse — raised from 10 once a defense that plainly still gave
// up the goal line was scoring better than one that gave up half the field
// but held. See defenseFitness: nothing else about the play counts once this
// applies.
export const TOUCHDOWN_PENALTY_YARDS = 50;
// A loss counts double against the offense the same way it already does for
// the down marker on the sideline: three yards lost is a bigger swing in the
// down than three yards gained is in the other direction.
export const TFL_MULTIPLIER = 2;
// Pre-snap position cannot change what the ball does after the whistle, but
// it can change how quickly the defense gets there, how many throws it lets
// the offense get away, and how far those throws travel — which is exactly
// what varying `adapt:*` used to do nothing to the score. One yard per
// second, per throw, and per air yard keeps all three on the same scale as
// the yardage term above rather than drowning it out or vanishing beside it.
export const SECONDS_PENALTY = 1;
export const PASS_PENALTY = 1;
export const AIR_YARD_PENALTY = 1;

/**
 * The per-play rule, recovered from pure aggregates rather than from
 * individual plays (see harness.js's summarizePlays, which is where the
 * touchdown/non-touchdown split and the gain/loss split actually happen):
 *
 *   touchdown  -> score is exactly -TOUCHDOWN_PENALTY_YARDS - yards, and
 *                 NOTHING else applies — no time, no turnover bonus. A
 *                 touchdown must never come out cheaper for being quick.
 *   otherwise  -> -(yards, doubled when negative) + TURNOVER_BONUS_YARDS if a
 *                 turnover, minus a yard per second/pass/air-yard.
 *
 * Each aggregate field is a sum over its qualifying plays divided by the
 * TOTAL play count, which is what lets the terms below compose additively
 * into that per-play mean instead of double-counting or dropping plays.
 */
export function defenseFitness(stats) {
  return -stats.gainYardsPerPlay
    + TFL_MULTIPLIER * stats.lossYardsPerPlay
    + TURNOVER_BONUS_YARDS * stats.turnoverRate
    - SECONDS_PENALTY * stats.secondsPerPlay
    - PASS_PENALTY * stats.passesPerPlay
    - AIR_YARD_PENALTY * stats.airYardsPerPlay
    - TOUCHDOWN_PENALTY_YARDS * stats.touchdownRate
    - stats.tdYardsPerPlay;
}

// The same two prices, read from the other sideline.
export const TD_BONUS_YARDS = 10;
export const TURNOVER_PENALTY_YARDS = 8;

export function offenseFitness(stats) {
  return stats.yardsPerPlay
    + TD_BONUS_YARDS * stats.touchdownRate
    - TURNOVER_PENALTY_YARDS * stats.turnoverRate;
}
