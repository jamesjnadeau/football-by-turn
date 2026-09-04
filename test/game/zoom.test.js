import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEWBOX_WIDTH } from '../../lib/field/geometry.js';
import { gameView } from '../../lib/game/view.js';
import { applyZoomPan } from '../../lib/game/zoom.js';

test('identity transform (scale 1, no pan) reproduces the base window exactly', () => {
  const view = gameView(20);
  const box = applyZoomPan(view, VIEWBOX_WIDTH, { scale: 1, panX: 0, panY: 0 });
  assert.deepEqual(box, {
    x: 0, y: view.windowTopY, width: VIEWBOX_WIDTH, height: view.height,
  });
});

test('scale halves both dimensions of the crop, centered at the base window\'s corner', () => {
  const view = gameView(20);
  const box = applyZoomPan(view, VIEWBOX_WIDTH, { scale: 2, panX: 0, panY: 0 });
  assert.equal(box.width, VIEWBOX_WIDTH / 2);
  assert.equal(box.height, view.height / 2);
});

test('pan moves the crop by the requested offset, within bounds', () => {
  const view = gameView(20);
  const panY = 5;
  const box = applyZoomPan(view, VIEWBOX_WIDTH, { scale: 2, panX: 0, panY });
  assert.equal(box.y, view.windowTopY + panY);
});

test('pan is clamped so the crop never scrolls past the field\'s own top edge', () => {
  const view = gameView(20); // near the drive-start spot, close to FIELD_LOW_YARD already
  const box = applyZoomPan(view, VIEWBOX_WIDTH, { scale: 2, panX: 0, panY: -1000 });
  assert.equal(box.y, view.fieldTopY);
});

test('pan is clamped so the crop never scrolls past the field\'s own bottom edge', () => {
  const view = gameView(20);
  const box = applyZoomPan(view, VIEWBOX_WIDTH, { scale: 2, panX: 0, panY: 1000 });
  const fieldBottomY = view.anchorY + view.bottomYard * view.scaleY;
  assert.equal(box.y, fieldBottomY - box.height);
});

test('horizontal pan is clamped to the field\'s own left and right edges', () => {
  const view = gameView(20);
  const left = applyZoomPan(view, VIEWBOX_WIDTH, { scale: 2, panX: -1000, panY: 0 });
  assert.equal(left.x, 0);
  const right = applyZoomPan(view, VIEWBOX_WIDTH, { scale: 2, panX: 1000, panY: 0 });
  assert.equal(right.x, VIEWBOX_WIDTH - right.width);
});

test('at scale 1 the crop already fills the field width, so horizontal pan has nowhere to go', () => {
  const view = gameView(20);
  const box = applyZoomPan(view, VIEWBOX_WIDTH, { scale: 1, panX: 50, panY: 0 });
  assert.equal(box.x, 0);
});
