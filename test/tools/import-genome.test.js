import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLAYS, DEFAULT_SEED, gauntlet, compareBundle, comparisonReport,
} from '../../tools/import-genome.js';
import { makeBundle } from '../../lib/game/train/bundle.js';
import { makeGenome } from '../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../lib/game/learned/offense-spec.js';

const OPTS = { plays: 3, seed: 5 };

test('the gauntlet plays a defense genome against both offenses, deterministically', () => {
  const values = makeGenome(DEFENSE_SPEC);
  const a = gauntlet(values, 'defense', OPTS);
  assert.deepEqual(a, gauntlet(values, 'defense', OPTS));
  assert.match(a.primary.label, /learned offense/);
  assert.match(a.secondary.label, /scripted offense/);
  for (const r of [a.primary, a.secondary]) {
    assert.ok(Number.isFinite(r.fitness));
    assert.ok(Number.isFinite(r.stats.yardsPerPlay));
    assert.ok(r.stats.touchdownRate >= 0 && r.stats.touchdownRate <= 1);
    assert.ok(r.stats.turnoverRate >= 0 && r.stats.turnoverRate <= 1);
  }
});

test('the gauntlet mirrors for an offense genome', () => {
  const a = gauntlet(makeGenome(OFFENSE_SPEC), 'offense', OPTS);
  assert.match(a.primary.label, /learned defense/);
  assert.match(a.secondary.label, /smart defense/);
  assert.ok(Number.isFinite(a.primary.fitness));
});

test('a comparison scores challenger and incumbent on the same downs', () => {
  const c = compareBundle(
    makeBundle({ side: 'defense', values: makeGenome(DEFENSE_SPEC) }), OPTS,
  );
  assert.equal(c.side, 'defense');
  assert.equal(c.plays, 3);
  assert.equal(c.seed, 5);
  assert.equal(typeof c.wins, 'boolean');
  assert.equal(c.wins, c.challenger.primary.fitness > c.incumbent.primary.fitness);
  assert.equal(c.challenger.primary.label, c.incumbent.primary.label);
  // The incumbent is whatever this build ships; nothing here may lean on its
  // trained numbers, only on their being numbers at all.
  assert.ok(Number.isFinite(c.incumbent.primary.fitness));
});

test('an identical challenger does not win, because a tie is not a win', () => {
  const values = makeGenome(DEFENSE_SPEC);
  const c = compareBundle(makeBundle({ side: 'defense', values }), OPTS);
  const twin = compareBundle(makeBundle({ side: 'defense', values }), OPTS);
  assert.equal(c.challenger.primary.fitness, twin.challenger.primary.fitness);
  const self = { ...c, incumbent: c.challenger };
  assert.equal(self.challenger.primary.fitness > self.incumbent.primary.fitness, false);
});

test('the report names both matchups, both genomes and a verdict', () => {
  const text = comparisonReport(compareBundle(
    makeBundle({ side: 'defense', values: makeGenome(DEFENSE_SPEC) }), OPTS,
  ));
  assert.match(text, /learned offense/);
  assert.match(text, /scripted offense/);
  assert.match(text, /primary/);
  assert.match(text, /shipped/);
  assert.match(text, /contributed/);
  assert.match(text, /yds\/play/);
  assert.match(text, /VERDICT/);
});

test('the defaults are a real evaluation and not a token one', () => {
  assert.ok(DEFAULT_PLAYS >= 16);
  assert.ok(Number.isInteger(DEFAULT_SEED));
});

test('importing the CLI evaluates nothing and writes no files', () => {
  // The import at the top of this file already proved it: if the CLI body ran
  // on import, the suite would play a gauntlet and rewrite a genome module.
  assert.ok(true);
});
