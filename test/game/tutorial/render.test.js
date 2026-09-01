import test from 'node:test';
import assert from 'node:assert/strict';
import { coachCardMark, highlightMark } from '../../../lib/game/tutorial/render.js';
import { STYLE_GAME } from '../../../lib/game/render.js';
import { gameView } from '../../../lib/game/view.js';

const CARD = {
  title: 'The snap, and running with it',
  progress: 'Step 1 of 6',
  text: 'Every play starts with the snap. Press the fast-forward button.',
  highlight: null,
  control: 'Skip lesson',
  footer: null,
};

test('the card says all of it: the lesson, the count, the words and the way out', () => {
  const m = coachCardMark(CARD, 50, 50);
  assert.ok(m.includes('The snap, and running with it'));
  assert.ok(m.includes('Step 1 of 6'));
  assert.ok(m.includes('Skip lesson'));
  assert.ok(m.includes('data-tutorial-next'), 'the control is pressable');
});

test('the words wrap rather than run off the sideline', () => {
  const long = { ...CARD, text: 'x'.repeat(20) + ' ' + 'y'.repeat(20) + ' ' + 'z'.repeat(20) };
  const m = coachCardMark(long, 50, 50);
  assert.ok((m.match(/<tspan/g) ?? []).length >= 3, 'three long words, at least three lines');
});

test('the card sits at the bottom of the window that is actually on screen', () => {
  const view = gameView(50, 50);
  const m = coachCardMark(CARD, 50, 50);
  const plateY = Number(/class="tut-plate"[^>]*\by="([-\d.]+)"/.exec(m)[1]);
  assert.ok(plateY > view.windowTopY + view.height / 2, 'below the middle');
  assert.ok(plateY < view.windowTopY + view.height, 'and inside the crop');
});

test('a footer is drawn only when there is one to draw', () => {
  assert.ok(!coachCardMark(CARD, 50, 50).includes('tut-foot'));
  assert.ok(coachCardMark({ ...CARD, footer: 'Stuck? Skip lesson moves you on.' }, 50, 50)
    .includes('Stuck? Skip lesson moves you on.'));
});

test('the card escapes what it is given, like every other plate on this board', () => {
  const m = coachCardMark({ ...CARD, text: 'press <b>run</b> & go' }, 50, 50);
  assert.ok(!m.includes('<b>'));
  assert.ok(m.includes('&amp;'));
});

function plateBottom(m) {
  const [, y, h] = /class="tut-plate"[^>]*\by="([-\d.]+)"[^>]*\bheight="([-\d.]+)"/.exec(m);
  return Number(y) + Number(h);
}

function controlBottom(m) {
  const [, y, h] = /class="tut-next"[^>]*\by="([-\d.]+)"[^>]*\bheight="([-\d.]+)"/.exec(m);
  return Number(y) + Number(h);
}

test('the control sits fully inside the plate, footer or no footer', () => {
  const withoutFooter = coachCardMark(CARD, 50, 50);
  assert.ok(
    controlBottom(withoutFooter) <= plateBottom(withoutFooter),
    'no footer: the button does not hang out past the bottom of the card',
  );

  const withFooter = coachCardMark({ ...CARD, footer: 'Stuck? Skip lesson moves you on.' }, 50, 50);
  assert.ok(
    controlBottom(withFooter) <= plateBottom(withFooter),
    'with a footer: the button does not hang out past the bottom of the card',
  );
});

test('the ring is drawn round the anchor, and nothing is drawn for nothing', () => {
  const m = highlightMark({ x: 100, y: 200, r: 5 });
  assert.ok(m.includes('class="tut-ring"'));
  assert.ok(m.includes('cx="100"'));
  assert.ok(m.includes('cy="200"'));
  assert.equal(highlightMark(null), '');
});

test('the ring pulses, so it reads as a thing to press', () => {
  assert.ok(STYLE_GAME.includes('@keyframes tut-pulse'));
  assert.ok(STYLE_GAME.includes('.tut-ring{'));
});
