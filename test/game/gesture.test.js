import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGesture, DRAG_MIN_UNITS, LONGPRESS_MS, DOUBLE_TAP_MS } from '../../lib/game/gesture.js';
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

test('a drag soon after a tap on the same player is a throw, not a run', () => {
  const log = [{ t: 1100, x: 0, y: 0 }, { t: 1200, x: 0, y: 20 }];
  assert.equal(classifyGesture(log, 1000).kind, 'passdrag', 'tapped 100ms before the drag');
  assert.equal(classifyGesture(log).kind, 'drag', 'no tap at all: an ordinary run arrow');
  assert.equal(classifyGesture(log, null).kind, 'drag');
  assert.equal(
    classifyGesture(log, 1100 - DOUBLE_TAP_MS - 1).kind, 'drag',
    'a stale tap does not arm a throw',
  );
});

test('a throw drag carries the same direction and throttle as a run drag', () => {
  const log = [{ t: 1100, x: 0, y: 0 }, { t: 1200, x: 0, y: MAX_ARROW_UNITS }];
  const g = classifyGesture(log, 1000);
  assert.equal(g.kind, 'passdrag');
  assert.deepEqual(g.dir, { x: 0, y: 1 });
  assert.equal(g.throttle, 1);
});

test('arming changes nothing about a tap or a long press', () => {
  const tap = [{ t: 1100, x: 0, y: 0 }, { t: 1150, x: 0, y: 1 }];
  assert.equal(classifyGesture(tap, 1000).kind, 'click');
  const hold = [{ t: 1100, x: 0, y: 0 }, { t: 1100 + LONGPRESS_MS, x: 0, y: 1 }];
  assert.equal(classifyGesture(hold, 1000).kind, 'longpress');
});

test('movement still beats duration, armed or not', () => {
  const slow = [{ t: 1000, x: 0, y: 0 }, { t: 1000 + LONGPRESS_MS + 200, x: 0, y: DRAG_MIN_UNITS + 1 }];
  assert.equal(classifyGesture(slow).kind, 'drag', 'no tap: a slow drag is still a drag');
  assert.equal(
    classifyGesture(slow, 900).kind, 'passdrag',
    'armed: a slow drag is a throw, never a long press',
  );
  assert.equal(
    classifyGesture(slow, 1000 - DOUBLE_TAP_MS - 1).kind, 'drag',
    'a genuinely stale tap does not arm a throw',
  );
});

test('a drag reports the raw drag vector alongside direction and throttle', () => {
  const g = classifyGesture([
    { t: 0, x: 100, y: 100 },
    { t: 50, x: 100, y: 112 },
  ]);
  assert.equal(g.kind, 'drag');
  assert.deepEqual(g.travel, { x: 0, y: 12 });
});
