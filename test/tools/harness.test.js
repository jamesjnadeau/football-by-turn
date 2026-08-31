import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TURNS_PER_PLAY, scenario, playOnePlay, defenseCoach,
  scriptedOffenseCoach, evaluateDefense, learnedOffenseCoach, evaluateMatch,
} from '../../tools/harness.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { makeGenome } from '../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../lib/game/learned/offense-spec.js';

test('scenario deals a plannable hot-seat down inside the field', () => {
  const rand = mulberry32(11);
  for (let i = 0; i < 10; i++) {
    const s = scenario(rand);
    assert.equal(s.phase, 'planning');
    assert.equal(s.turnIndex, 0);
    assert.equal(s.aiTeam, null);
    assert.ok(s.down >= 1 && s.down <= 4);
    assert.ok(s.losYard >= 15 && s.losYard <= 80);
    assert.ok(s.toGoYard > s.losYard && s.toGoYard <= 100);
    assert.ok(s.plannedPass, 'the snap is aimed');
  }
});

test('playOnePlay runs to a whistle (or the cap) and reports the yardage', () => {
  const genome = makeGenome(DEFENSE_SPEC);
  const s = scenario(mulberry32(2));
  const r = playOnePlay(s, scriptedOffenseCoach, defenseCoach(genome), mulberry32(3));
  assert.ok(Number.isFinite(r.yards));
  assert.ok(s.turnIndex <= MAX_TURNS_PER_PLAY);
  assert.ok(s.phase === 'playOver' || s.turnIndex === MAX_TURNS_PER_PLAY);
  assert.equal(typeof r.touchdown, 'boolean');
  assert.equal(typeof r.turnover, 'boolean');
  assert.ok(Array.isArray(r.events));
});

test('a play is deterministic for its seeds', () => {
  const genome = makeGenome(DEFENSE_SPEC);
  const run = () => {
    const s = scenario(mulberry32(4));
    return playOnePlay(s, scriptedOffenseCoach, defenseCoach(genome), mulberry32(5));
  };
  assert.deepEqual(run(), run());
});

test('evaluateDefense aggregates deterministically', () => {
  const g = makeGenome(DEFENSE_SPEC);
  const a = evaluateDefense(g, { plays: 3, seed: 5 });
  const b = evaluateDefense(g, { plays: 3, seed: 5 });
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.yardsPerPlay));
  assert.ok(a.touchdownRate >= 0 && a.touchdownRate <= 1);
  assert.ok(a.turnoverRate >= 0 && a.turnoverRate <= 1);
});

test('evaluateMatch pits two learned genomes deterministically', () => {
  const off = makeGenome(OFFENSE_SPEC);
  const def = makeGenome(DEFENSE_SPEC);
  const a = evaluateMatch(off, def, { plays: 3, seed: 6 });
  const b = evaluateMatch(off, def, { plays: 3, seed: 6 });
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.yardsPerPlay));
});

test('learnedOffenseCoach stands its formation and coaches the play', () => {
  const off = makeGenome(OFFENSE_SPEC);
  const s = scenario(mulberry32(8));
  learnedOffenseCoach(off)(s);
  assert.ok(s.aiPlay, 'a call was made at the snap');
});
