import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGesture, DRAG_MIN_UNITS, LONGPRESS_MS } from '../../lib/game/gesture.js';
import { MAX_ARROW_UNITS } from '../../lib/game/constants.js';

test('a quick tap with no movement is a click', () => {
  const g = classifyGesture([{ t: 0, x: 10, y: 10 }, { t: 120, x: 10.5, y: 10 }]);
  assert.deepEqual(g, { kind: 'click' });
});

test('holding still past the threshold is a longpress', () => {
  const g = classifyGesture([{ t: 0, x: 10, y: 10 }, { t: LONGPRESS_MS + 50, x: 11, y: 10 }]);
  assert.deepEqual(g, { kind: 'longpress' });
});

test('moving past DRAG_MIN_UNITS is a drag with direction and throttle', () => {
  const g = classifyGesture([
    { t: 0, x: 10, y: 10 },
    { t: 100, x: 10, y: 20 },
    { t: 200, x: 10, y: 10 + MAX_ARROW_UNITS / 2 },
  ]);
  assert.equal(g.kind, 'drag');
  assert.deepEqual(g.dir, { x: 0, y: 1 });
  assert.equal(g.throttle, 0.5);
});

test('a drag past full length clamps throttle to 1', () => {
  const g = classifyGesture([
    { t: 0, x: 0, y: 0 },
    { t: 300, x: 0, y: MAX_ARROW_UNITS * 3 },
  ]);
  assert.equal(g.throttle, 1);
});

test('a slow drag is still a drag — movement wins over duration', () => {
  const g = classifyGesture([
    { t: 0, x: 0, y: 0 },
    { t: LONGPRESS_MS * 2, x: 20, y: 0 },
  ]);
  assert.equal(g.kind, 'drag');
});

test('tiny drags below the threshold fall back to click', () => {
  const g = classifyGesture([{ t: 0, x: 0, y: 0 }, { t: 100, x: DRAG_MIN_UNITS - 1, y: 0 }]);
  assert.deepEqual(g, { kind: 'click' });
});
