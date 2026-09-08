import test from 'node:test';
import assert from 'node:assert/strict';
import { frameAtElapsed } from '../../lib/game/animation.js';

// The real shape: runTurn hands back 30 frames for a turn meant to last 0.5s.
const TOTAL = 500;
const COUNT = 30;

test('the first frame is the one at the start of the turn', () => {
  assert.equal(frameAtElapsed(0, TOTAL, COUNT), 0);
  assert.equal(frameAtElapsed(-5, TOTAL, COUNT), 0, 'a clock that reads backwards still draws a frame');
});

test('the frame advances with the clock, not with the number of ticks', () => {
  // Halfway through the turn is halfway through the frames, give or take the
  // one frame that floating point costs at an exact boundary.
  assert.ok(Math.abs(frameAtElapsed(TOTAL / 2, TOTAL, COUNT) - COUNT / 2) <= 1);
  assert.ok(Math.abs(frameAtElapsed(TOTAL / 10, TOTAL, COUNT) - COUNT / 10) <= 1);
  // The property that matters: time only ever moves the frame forwards.
  let last = -1;
  for (let ms = 0; ms < TOTAL; ms += 3) {
    const at = frameAtElapsed(ms, TOTAL, COUNT);
    assert.ok(at >= last, `frame went backwards at ${ms}ms`);
    last = at;
  }
});

test('a throttled tab skips frames rather than falling behind', () => {
  // A background tab gets a timer about once a second, so its first tick lands
  // long after a 500ms animation was due to be over. It must finish there and
  // not walk 30 more frames one clamped second at a time -- that is the lockout
  // this whole module exists to prevent.
  assert.equal(frameAtElapsed(1000, TOTAL, COUNT), null);
  assert.equal(frameAtElapsed(30_000, TOTAL, COUNT), null);
});

test('the animation is over exactly at its own length', () => {
  assert.equal(frameAtElapsed(TOTAL - 1, TOTAL, COUNT), COUNT - 1);
  assert.equal(frameAtElapsed(TOTAL, TOTAL, COUNT), null);
});

test('the last frame is never indexed past the end', () => {
  // total is not always an exact multiple of the per-frame interval.
  for (const count of [1, 7, 29, 30, 31, 100]) {
    for (let ms = 0; ms < TOTAL; ms += 1) {
      const at = frameAtElapsed(ms, TOTAL, count);
      assert.ok(at !== null && at >= 0 && at < count, `count=${count} ms=${ms} gave ${at}`);
    }
  }
});

test('a turn with no frames to draw is already over', () => {
  assert.equal(frameAtElapsed(0, TOTAL, 0), null);
});
