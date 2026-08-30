import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderField } from '../../lib/field/field.js';
import { gameView } from '../../lib/game/view.js';

// A minimal view: enough shape for renderField to run, no end zone, no posts.
const plainView = () => ({
  scaleY: 3.75,
  anchorY: 40,
  fieldTopY: 10,
  bottomYard: 10,
  goalYard: null,
  height: 100,
  yardLines: [],
});

test('the sideline legend still reads PRESS BOX when a view says nothing', () => {
  const { svg } = renderField(plainView());
  assert.ok(svg.includes('>PRESS BOX</text>'), 'the diagrams keep their legend');
  assert.ok(svg.includes('class="pb"'));
});

test('a view can relabel the sideline legend', () => {
  const { svg } = renderField({ ...plainView(), sidelineLabel: 'COACHES MENU' });
  assert.ok(svg.includes('>COACHES MENU</text>'));
  assert.ok(!svg.includes('PRESS BOX'), 'the default is replaced, not appended');
});

test('a view can drop the sideline legend entirely', () => {
  const { svg } = renderField({ ...plainView(), sidelineLabel: null });
  assert.ok(!svg.includes('class="pb"'), 'no legend at all');
});

test('the sideline legend is escaped, because a view supplies it', () => {
  const { svg } = renderField({ ...plainView(), sidelineLabel: 'A & <B>' });
  assert.ok(svg.includes('>A &amp; &lt;B&gt;</text>'));
});

test('the game view labels the sideline COACHES MENU', () => {
  assert.equal(gameView(0).sidelineLabel, 'COACHES MENU');
});
