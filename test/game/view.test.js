import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNITS_PER_YARD_X, y } from '../../lib/field/geometry.js';
import {
  gameView, fieldPos, yardsOfY, followYard, GOAL_YARD, OWN_GOAL_YARD, END_YARD,
} from '../../lib/game/view.js';
import {
  WINDOW_YARDS, FIELD_LOW_YARD, CAMERA_DEADZONE_YARDS,
} from '../../lib/game/constants.js';

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

test('the whole field is drawn whatever the camera is looking at', () => {
  // The camera scrolls the viewBox over a field that is drawn once, so the
  // drawn field cannot depend on where the camera is -- scroll past what was
  // drawn and the window would show blank turf.
  const near = gameView(20);
  const far = gameView(95);
  assert.equal(near.fieldTopY, far.fieldTopY, 'the field starts in the same place');
  assert.equal(near.bottomYard, far.bottomYard, 'and ends in the same place');
  assert.equal((near.fieldTopY - near.anchorY) / near.scaleY, FIELD_LOW_YARD);
  assert.equal(near.bottomYard, END_YARD);
});

test('the end zone is drawn wherever the camera happens to be looking', () => {
  // It used to appear only once the window reached it, which was right when
  // the field was drawn one window at a time. Now the field is drawn once and
  // the window slides over it, so the end zone is simply part of the field.
  // Only the ATTACKED end zone: the offense's own goal line stays an ordinary
  // yard line, per design decision 7 of the full-field plan -- nothing happens
  // there in this game, and field.js hatches exactly one end zone.
  for (const los of [20, 95]) assert.equal(gameView(los).goalYard, GOAL_YARD);
});

// MARGIN_TOP + MARGIN_BOTTOM in view.js: the clear space the window keeps
// above and below the crop it shows.
const MARGIN_UNITS = 20;

test('the window is WINDOW_YARDS tall and follows the camera, not the field', () => {
  const near = gameView(50);
  // The window is the WINDOW_YARDS crop plus the margin above and below it,
  // not the whole 120 yards the field is drawn across.
  assert.equal((near.height - MARGIN_UNITS) / near.scaleY, WINDOW_YARDS);
  assert.ok(gameView(80).windowTopY > near.windowTopY, 'scrolled forward with the LOS');
});

test('the window clamps at the offense\'s own goal and never dips below FIELD_LOW_YARD', () => {
  const view = gameView(20); // the drive-start spot
  const topYard = (view.windowTopY - view.anchorY) / view.scaleY;
  assert.ok(topYard >= FIELD_LOW_YARD - 1e-9);
});

test('the camera holds on the line of scrimmage while the ball is inside the deadzone', () => {
  assert.equal(followYard(20, 20), 20, 'at the snap');
  assert.equal(followYard(20, 20 + CAMERA_DEADZONE_YARDS), 20, 'right on the edge');
  assert.equal(followYard(20, 25), 20, 'a short gain moves nothing');
});

test('past the deadzone the camera trails the ball by exactly the deadzone', () => {
  assert.equal(followYard(20, 45), 45 - CAMERA_DEADZONE_YARDS);
  assert.equal(followYard(20, 80), 80 - CAMERA_DEADZONE_YARDS);
});

test('the camera never backs up behind the line of scrimmage', () => {
  // A sack needs no special case: the window already shows WINDOW_BEHIND_YARDS
  // of ground behind the line, so a quarterback dropping back is on screen.
  assert.equal(followYard(20, 12), 20, 'driven backwards');
  assert.equal(followYard(20, -5), 20, 'all the way into his own end zone');
});

test('yard lines never repeat the goal lines themselves', () => {
  const view = gameView(95);
  assert.ok(view.yardLines.every((l) => l.yard !== GOAL_YARD && l.yard !== OWN_GOAL_YARD));
});
