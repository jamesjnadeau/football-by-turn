import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shippedGenome, activeGenome } from '../../../lib/game/learned/active.js';
import { createGame } from '../../../lib/game/state.js';
import { nextDown } from '../../../lib/game/rules.js';
import { coachLearnedDefense } from '../../../lib/game/ai.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';
import { yardsOfY } from '../../../lib/game/view.js';

const deepSafety = {
  ...makeGenome(DEFENSE_SPEC), 'pos:d-s:across': 0, 'pos:d-s:down': 11,
};

test('the shipped genome holds every key its spec names', () => {
  for (const p of DEFENSE_SPEC) {
    assert.equal(typeof shippedGenome('defense')[p.key], 'number', p.key);
  }
  for (const p of OFFENSE_SPEC) {
    assert.equal(typeof shippedGenome('offense')[p.key], 'number', p.key);
  }
});

test('a game with no override plays the shipped genome', () => {
  const s = createGame({ seed: 1 });
  assert.deepEqual(s.genomeOverrides, { defense: null, offense: null });
  assert.equal(activeGenome(s, 'defense'), shippedGenome('defense'));
  assert.equal(activeGenome(s, 'offense'), shippedGenome('offense'));
});

test('a state from before overrides existed still reads as no override', () => {
  assert.equal(activeGenome({}, 'defense'), shippedGenome('defense'));
});

test('an override is played for its own side only', () => {
  const s = createGame({ seed: 1, genomeOverrides: { defense: deepSafety } });
  assert.equal(activeGenome(s, 'defense'), deepSafety);
  assert.equal(activeGenome(s, 'offense'), shippedGenome('offense'));
});

test('the override survives the next down', () => {
  const s = createGame({ seed: 1, genomeOverrides: { defense: deepSafety } });
  s.deadReason = 'tackled';
  nextDown(s);
  assert.equal(s.down, 2);
  assert.equal(activeGenome(s, 'defense'), deepSafety);
});

test('a learned defense stands the override formation, not the shipped one', () => {
  const s = createGame({
    seed: 2, ai: 'defense', aiLevel: 'learned', genomeOverrides: { defense: deepSafety },
  });
  const safety = s.players.find((p) => p.id === 'd-s');
  assert.ok(Math.abs((yardsOfY(safety.pos.y) - s.losYard) - 11) < 0.6);
});

test('the learned defense brain reads the override too', () => {
  const zone = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': 4 };
  const man = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': -4 };
  const covers = (values) => {
    const s = createGame({
      seed: 3, ai: 'defense', aiLevel: 'learned', genomeOverrides: { defense: values },
    });
    coachLearnedDefense(s);
    return s.players.filter((p) => p.cover).length;
  };
  assert.ok(covers(man) > 0, 'a man-leaning override takes receivers');
  assert.equal(covers(zone), 0, 'a zone-leaning override takes spots');
});
