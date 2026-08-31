import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spotText, downDistanceText, humanSide, gameOverMessage, kickoffMessage } from '../../lib/game/hud.js';
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

test('humanSide is the team the computer is not', () => {
  assert.equal(humanSide(createGame({ seed: 1, ai: 'defense' })), 'offense');
  assert.equal(humanSide(createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' })), 'defense');
  assert.equal(humanSide(createGame({ seed: 1 })), null);
});

test('the final call knows whose side you were on', () => {
  const o = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' }); // you: offense
  o.result = 'touchdown';
  assert.equal(gameOverMessage(o), 'TOUCHDOWN — you win!');
  o.result = 'turnover-on-downs';
  assert.equal(gameOverMessage(o), 'Turnover on downs. Game over — you lose.');
  o.result = 'turnover-fumble';
  assert.equal(gameOverMessage(o), 'Turnover. Game over — you lose.');

  const d = createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' }); // you: defense
  d.result = 'touchdown';
  assert.equal(gameOverMessage(d), 'Touchdown. Game over — you lose.');
  d.result = 'turnover-on-downs';
  assert.equal(gameOverMessage(d), 'Turnover on downs — you win!');
  d.result = 'turnover-fumble';
  assert.equal(gameOverMessage(d), 'Turnover — you win!');
});

test('hot-seat gets a neutral call', () => {
  const s = createGame({ seed: 1 });
  s.result = 'touchdown';
  assert.equal(gameOverMessage(s), 'TOUCHDOWN — offense wins!');
  s.result = 'turnover-on-downs';
  assert.equal(gameOverMessage(s), 'Turnover on downs — defense wins!');
  s.result = 'turnover-fumble';
  assert.equal(gameOverMessage(s), 'Turnover — defense wins!');
});

test('the kickoff line points whichever way you are facing', () => {
  const o = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  assert.equal(kickoffMessage(o),
    'New game. 1st and 10 from your own 20 — 80 yards to the house.');
  const d = createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' });
  assert.equal(kickoffMessage(d),
    'New game. They start 1st and 10 from their own 20 — keep them out of the house.');
  const h = createGame({ seed: 1 }); // hot-seat reads as the offense line
  assert.equal(kickoffMessage(h),
    'New game. 1st and 10 from your own 20 — 80 yards to the house.');
});
