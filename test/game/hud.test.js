import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spotText, downDistanceText } from '../../lib/game/hud.js';
import { createGame } from '../../lib/game/state.js';

test('spotText names the side of the field', () => {
  assert.equal(spotText(20), 'OWN 20');
  assert.equal(spotText(50), '50');
  assert.equal(spotText(65), 'OPP 35');
});

test('a new game reads 1st & 10 at the OWN 20', () => {
  const s = createGame({ seed: 1 });
  assert.equal(downDistanceText(s), '1st & 10 at the OWN 20');
});

test('goal-to-go reads "Goal" instead of a yardage', () => {
  const s = createGame({ seed: 1 });
  s.losYard = 92;
  s.toGoYard = 100;
  s.down = 2;
  assert.equal(downDistanceText(s), '2nd & Goal at the OPP 8');
});
