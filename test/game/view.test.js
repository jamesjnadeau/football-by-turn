import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNITS_PER_YARD_X, y } from '../../lib/field/geometry.js';
import { gameView, fieldPos, yardsOfY, GOAL_YARD, OWN_GOAL_YARD } from '../../lib/game/view.js';
import { WINDOW_YARDS, FIELD_LOW_YARD } from '../../lib/game/constants.js';

test('the game view is uniform-scale: one yard down equals one yard across', () => {
  const view = gameView(20);
  assert.equal(view.scaleY, UNITS_PER_YARD_X);
});

test('the scrimmage line follows the losYard argument', () => {
  assert.equal(gameView(20).scrimmage.yard, 20);
  assert.equal(gameView(24.5).scrimmage.yard, 24.5);
});

test('the scrimmage line carries no label', () => {
  assert.equal(gameView(20).scrimmage.label, undefined);
});

test('fieldPos and yardsOfY invert each other and agree with geometry.js', () => {
  const view = gameView(20);
  const p = fieldPos(-10, 23);
  assert.equal(p.y, y(view, 23));
  assert.ok(Math.abs(yardsOfY(p.y) - 23) < 1e-9);
});

test('the window is WINDOW_YARDS tall and follows the line of scrimmage', () => {
  const near = gameView(50);
  assert.equal(near.bottomYard - (near.fieldTopY - near.anchorY) / near.scaleY, WINDOW_YARDS);
  const far = gameView(80);
  assert.ok(far.fieldTopY > near.fieldTopY); // scrolled forward with the LOS
});

test('the window clamps at the offense\'s own goal and never dips below FIELD_LOW_YARD', () => {
  const view = gameView(20); // the drive-start spot
  const topYard = (view.fieldTopY - view.anchorY) / view.scaleY;
  assert.ok(topYard >= FIELD_LOW_YARD - 1e-9);
});

test('the end zone is only drawn once the window actually reaches the goal line', () => {
  assert.equal(gameView(20).goalYard, null);
  assert.equal(gameView(95).goalYard, GOAL_YARD);
});

test('yard lines never repeat the goal lines themselves', () => {
  const view = gameView(95);
  assert.ok(view.yardLines.every((l) => l.yard !== GOAL_YARD && l.yard !== OWN_GOAL_YARD));
});
