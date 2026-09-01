import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defenseFitness, offenseFitness,
  TURNOVER_BONUS_YARDS, TOUCHDOWN_PENALTY_YARDS, TFL_MULTIPLIER,
  SECONDS_PENALTY, PASS_PENALTY, AIR_YARD_PENALTY,
  TD_BONUS_YARDS, TURNOVER_PENALTY_YARDS,
} from '../../../lib/game/train/fitness.js';
import { summarizePlays } from '../../../lib/game/train/harness.js';
import { TURN_SECONDS } from '../../../lib/game/constants.js';

/** A single-play aggregate: summarizePlays of one playOnePlay-shaped result,
 *  which is the cleanest way to test one rule of defenseFitness in isolation
 *  without hand-assembling the aggregate's field names ourselves. */
const statsFor = (play) => summarizePlays([{
  yards: 0, touchdown: false, turnover: false, turns: 0, passes: 0, airYards: 0, ...play,
}]);

test('a touchdown scores exactly -TOUCHDOWN_PENALTY_YARDS minus its yards, and gains nothing from being quick', () => {
  // Same yardage, wildly different clocks and pass counts -- a touchdown
  // must not care, or a defense could learn that a FAST touchdown is a
  // lesser sin than a slow one.
  const quick = statsFor({
    yards: 40, touchdown: true, turns: 2, passes: 1, airYards: 30,
  });
  const slow = statsFor({
    yards: 40, touchdown: true, turns: 20, passes: 4, airYards: 30,
  });
  assert.equal(defenseFitness(quick), -TOUCHDOWN_PENALTY_YARDS - 40);
  assert.equal(defenseFitness(slow), -TOUCHDOWN_PENALTY_YARDS - 40);
  assert.equal(defenseFitness(quick), defenseFitness(slow));
});

test('a touchdown earns nothing from the turnover bonus either -- no other term applies', () => {
  // A touchdown is never itself also a turnover, but the rule is that NOTHING
  // but yards applies once touchdown fires -- prove it holds even so.
  const td = statsFor({ yards: 25, touchdown: true, turnover: false });
  assert.equal(defenseFitness(td), -TOUCHDOWN_PENALTY_YARDS - 25);
});

test('a tackle for loss is scored at TFL_MULTIPLIER; a gain of the same size is scored at face value', () => {
  assert.equal(defenseFitness(statsFor({ yards: -3 })), TFL_MULTIPLIER * 3);
  assert.equal(defenseFitness(statsFor({ yards: 3 })), -3);
});

test('a turnover earns its bonus on top of the yardage term', () => {
  const withTurnover = defenseFitness(statsFor({ yards: -2, turnover: true }));
  const without = defenseFitness(statsFor({ yards: -2, turnover: false }));
  assert.equal(withTurnover - without, TURNOVER_BONUS_YARDS);
});

test('time on the clock, throws allowed, and air yards each cost the defense on top of the yardage term', () => {
  const base = defenseFitness(statsFor({ yards: 5 }));
  assert.equal(
    defenseFitness(statsFor({ yards: 5, turns: 3 / TURN_SECONDS })),
    base - SECONDS_PENALTY * 3,
  );
  assert.equal(defenseFitness(statsFor({ yards: 5, passes: 2 })), base - PASS_PENALTY * 2);
  assert.equal(defenseFitness(statsFor({ yards: 5, airYards: 15 })), base - AIR_YARD_PENALTY * 15);
});

test('a 20-yard completion costs more than a 20-yard run: air yards charge on top of total yards', () => {
  const run = defenseFitness(statsFor({ yards: 20 }));
  const completion = defenseFitness(statsFor({ yards: 20, passes: 1, airYards: 20 }));
  assert.equal(run, -20);
  assert.equal(completion, -40 - PASS_PENALTY);
});

test('defenseFitness over many plays equals the mean of the per-play rule applied to each play', () => {
  // The interface constraint is that defenseFitness stays a pure function of
  // aggregates, recovering the per-play rule algebraically rather than by
  // inspecting individual plays. Verify the algebra actually holds for a
  // realistic mix: a gain, a loss with a turnover, and a touchdown.
  const plays = [
    {
      yards: 6, touchdown: false, turnover: false, turns: 4, passes: 1, airYards: 5,
    },
    {
      yards: -4, touchdown: false, turnover: true, turns: 2, passes: 0, airYards: 0,
    },
    {
      yards: 55, touchdown: true, turnover: false, turns: 3, passes: 2, airYards: 40,
    },
  ];
  const playScore = (p) => {
    if (p.touchdown) return -TOUCHDOWN_PENALTY_YARDS - p.yards;
    const yardTerm = p.yards >= 0 ? p.yards : TFL_MULTIPLIER * p.yards;
    return -yardTerm
      + (p.turnover ? TURNOVER_BONUS_YARDS : 0)
      - SECONDS_PENALTY * (p.turns * TURN_SECONDS)
      - PASS_PENALTY * p.passes
      - AIR_YARD_PENALTY * p.airYards;
  };
  const expected = plays.reduce((sum, p) => sum + playScore(p), 0) / plays.length;
  assert.equal(defenseFitness(summarizePlays(plays)), expected);
});

test('offenseFitness still reads only yardsPerPlay, touchdownRate and turnoverRate, unchanged', () => {
  const base = { yardsPerPlay: 3, turnoverRate: 0, touchdownRate: 0 };
  assert.equal(
    offenseFitness({ ...base, yardsPerPlay: 4, turnoverRate: 0.25, touchdownRate: 0.1 }),
    4 + TD_BONUS_YARDS * 0.1 - TURNOVER_PENALTY_YARDS * 0.25,
  );
});
