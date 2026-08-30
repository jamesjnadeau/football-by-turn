import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNITS_PER_YARD_X, y, yToYards } from '../../lib/field/geometry.js';
import { gameView, fieldPos, yardsOfY, GOAL_YARD, END_YARD, TOP_YARD } from '../../lib/game/view.js';

test('the game view is uniform-scale: one yard down equals one yard across', () => {
  const view = gameView(0);
  assert.equal(view.scaleY, UNITS_PER_YARD_X);
});

test('the frame runs from 20 yards behind the start to the end line', () => {
  const view = gameView(0);
  assert.equal(view.goalYard, GOAL_YARD);
  assert.equal(view.bottomYard, END_YARD);
  // the top of the drawn field is TOP_YARD
  assert.ok(Math.abs(yToYards(view, view.fieldTopY) - TOP_YARD) < 1e-9);
});

test('the scrimmage line follows the losYard argument', () => {
  assert.equal(gameView(0).scrimmage.yard, 0);
  assert.equal(gameView(4.5).scrimmage.yard, 4.5);
});

test('the scrimmage line carries no label', () => {
  assert.equal(gameView(0).scrimmage.label, undefined);
});

test('fieldPos and yardsOfY invert each other and agree with geometry.js', () => {
  const view = gameView(0);
  const p = fieldPos(-10, 3);
  assert.equal(p.y, y(view, 3));
  assert.ok(Math.abs(yardsOfY(p.y) - 3) < 1e-9);
});
