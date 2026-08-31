import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePair, evaluateDefense, evaluateOffense, evaluateMatch,
  defenseCoach, learnedOffenseCoach, scriptedOffenseCoach, smartDefenseCoach,
  scenario,
} from '../../../lib/game/train/harness.js';
import { mulberry32 } from '../../../lib/game/rng.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';

const DEF = makeGenome(DEFENSE_SPEC);
const OFF = makeGenome(OFFENSE_SPEC);
const OPTS = { plays: 4, seed: 12 };

test('evaluatePair reproduces evaluateDefense exactly, dice for dice', () => {
  assert.deepEqual(
    evaluatePair({ offense: scriptedOffenseCoach, defense: defenseCoach(DEF), ...OPTS }),
    evaluateDefense(DEF, OPTS),
  );
});

test('evaluatePair reproduces evaluateMatch exactly, dice for dice', () => {
  assert.deepEqual(
    evaluatePair({ offense: learnedOffenseCoach(OFF), defense: defenseCoach(DEF), ...OPTS }),
    evaluateMatch(OFF, DEF, OPTS),
  );
});

test('smartDefenseCoach gives the assignment defense its orders', () => {
  const s = scenario(mulberry32(21));
  smartDefenseCoach(s);
  const defenders = s.players.filter((p) => p.team === 'defense');
  assert.ok(defenders.some((p) => p.plan || p.cover), 'somebody was told something');
});

test('evaluateOffense scores an offense genome against the smart defense', () => {
  const a = evaluateOffense(OFF, OPTS);
  const b = evaluateOffense(OFF, OPTS);
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.yardsPerPlay));
  assert.ok(a.touchdownRate >= 0 && a.touchdownRate <= 1);
  assert.ok(a.turnoverRate >= 0 && a.turnoverRate <= 1);
});

test('evaluateOffense takes any defense coach, including a learned one', () => {
  assert.deepEqual(
    evaluateOffense(OFF, { ...OPTS, defenseCoach: defenseCoach(DEF) }),
    evaluateMatch(OFF, DEF, OPTS),
  );
});
