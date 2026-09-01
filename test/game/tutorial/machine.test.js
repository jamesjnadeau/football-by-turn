import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stepAt, allows, advance, offScript, cardFor, showsMenu,
} from '../../../lib/game/tutorial/machine.js';

// A scenario of this test's own, so the assertions describe the machine rather
// than whatever the real script happens to say this week.
const SCENARIO = {
  id: 'fake', title: 'A lesson', outro: 'Well done.',
  steps: [
    {
      id: 'one', text: 'Press it.', highlight: { kind: 'button', name: 'run' },
      allow: { action: 'run' }, nudge: 'Press run.', needsLivePlay: true,
      demo: [{ verb: 'run' }], done: (s) => s.turnIndex > 0,
    },
    {
      id: 'two', text: 'Drag him.', highlight: { kind: 'player', id: 'o-qb' },
      allow: { action: 'gesture', playerIds: ['o-qb'], kinds: ['drag'] },
      nudge: 'Drag the quarterback.', needsLivePlay: true,
      demo: [], done: (s) => s.dragged === true,
    },
    {
      id: 'three', text: 'Run it out.', highlight: null,
      allow: { action: 'any' }, nudge: null, needsLivePlay: false,
      demo: [], done: (s) => s.phase === 'playOver',
    },
  ],
};

test('the clipboard is on the board only for the step that asks for it', () => {
  const withMenu = {
    ...SCENARIO,
    steps: [...SCENARIO.steps, {
      id: 'four', text: 'Open the menu.', highlight: { kind: 'button', name: 'menu' },
      allow: { action: 'menu' }, nudge: 'Press the clipboard.', needsLivePlay: false,
      demo: [], done: (s, ctx) => ctx.menuOpen === true,
    }],
  };
  assert.equal(showsMenu(withMenu, 0), false);
  assert.equal(showsMenu(withMenu, 3), true);
  assert.equal(showsMenu(withMenu, 4), false, 'past the last step there is no lesson left');
});

test('a menu press is refused everywhere except the step that teaches it', () => {
  assert.equal(allows(SCENARIO, 0, { kind: 'menu' }), 'Press run.');
  const menuStep = {
    ...SCENARIO,
    steps: [{
      id: 'only', text: 'Open it.', highlight: { kind: 'button', name: 'menu' },
      allow: { action: 'menu' }, nudge: 'Press the clipboard.', needsLivePlay: false,
      demo: [], done: (s, ctx) => ctx.menuOpen === true,
    }],
  };
  assert.equal(allows(menuStep, 0, { kind: 'menu' }), null);
  assert.equal(allows(menuStep, 0, { kind: 'run' }), 'Press the clipboard.');
});

test('a step allows exactly the action it asked for and refuses the rest', () => {
  assert.equal(allows(SCENARIO, 0, { kind: 'run' }), null);
  assert.equal(allows(SCENARIO, 0, { kind: 'reposition' }), 'Press run.');
  assert.equal(allows(SCENARIO, 0, { kind: 'menu' }), 'Press run.');
});

test('a gesture is judged on the man and the verb, both', () => {
  const ok = { kind: 'gesture', playerId: 'o-qb', gestureKind: 'drag' };
  assert.equal(allows(SCENARIO, 1, ok), null);
  assert.equal(
    allows(SCENARIO, 1, { kind: 'gesture', playerId: 'o-c', gestureKind: 'drag' }),
    'Drag the quarterback.', 'the wrong man');
  assert.equal(
    allows(SCENARIO, 1, { kind: 'gesture', playerId: 'o-qb', gestureKind: 'doubletap' }),
    'Drag the quarterback.', 'the wrong verb');
});

test('a single tap is never refused: it is how the double tap is armed', () => {
  // input.js records the arming tap before onGesture is ever called, and a lone
  // tap does nothing in the real game either — so nudging one would only
  // scold a coach halfway through a legal double tap.
  assert.equal(allows(SCENARIO, 0, { kind: 'gesture', playerId: 'o-qb', gestureKind: 'click' }), null);
  assert.equal(allows(SCENARIO, 1, { kind: 'gesture', playerId: 'o-c', gestureKind: 'click' }), null);
});

test("an 'any' step lets a coach do whatever he likes", () => {
  assert.equal(allows(SCENARIO, 2, { kind: 'run' }), null);
  assert.equal(allows(SCENARIO, 2, { kind: 'gesture', playerId: 'o-c', gestureKind: 'drag' }), null);
});

test('past the last step nothing is gated — that card is the sign-off', () => {
  assert.equal(stepAt(SCENARIO, 3), null);
  assert.equal(allows(SCENARIO, 3, { kind: 'reposition' }), null);
});

test('advancing walks past every step that has already landed, not just one', () => {
  const ctx = {};
  assert.equal(advance(SCENARIO, 0, { turnIndex: 0, phase: 'planning' }, ctx), 0);
  assert.equal(advance(SCENARIO, 0, { turnIndex: 1, phase: 'planning' }, ctx), 1);
  // One press satisfied the run step AND ended the play: the machine must not
  // strand the coach on a step whose condition is already true.
  assert.equal(
    advance(SCENARIO, 0, { turnIndex: 1, dragged: true, phase: 'playOver' }, ctx), 3);
});

test('a play that dies while a step still needs it is off script', () => {
  assert.equal(offScript(SCENARIO, 0, { phase: 'planning', penalty: null }), false);
  assert.equal(offScript(SCENARIO, 0, { phase: 'playOver', penalty: null }), true);
  assert.equal(offScript(SCENARIO, 2, { phase: 'playOver', penalty: null }), false,
    'the closing beat is meant to outlive the whistle');
  assert.equal(offScript(SCENARIO, 3, { phase: 'playOver', penalty: null }), false,
    'so is the sign-off');
});

test('a flag is off script whatever the phase says', () => {
  assert.equal(
    offScript(SCENARIO, 2, { phase: 'planning', penalty: { foul: 'second-forward-pass' } }),
    true);
});

test('the card counts the steps and carries the highlight through', () => {
  const c = cardFor(SCENARIO, 1, { attempt: 1, isLastScenario: false });
  assert.equal(c.title, 'A lesson');
  assert.equal(c.progress, 'Step 2 of 3');
  assert.equal(c.text, 'Drag him.');
  assert.deepEqual(c.highlight, { kind: 'player', id: 'o-qb' });
  assert.equal(c.control, 'Skip lesson');
  assert.equal(c.footer, null);
});

test('a second attempt is told, on the card, where the door is', () => {
  assert.match(cardFor(SCENARIO, 0, { attempt: 2 }).footer, /skip/i);
});

test('the sign-off card says the outro and offers the way on', () => {
  const c = cardFor(SCENARIO, 3, { attempt: 1, isLastScenario: false });
  assert.equal(c.text, 'Well done.');
  assert.equal(c.highlight, null);
  assert.equal(c.control, 'Next lesson');
  assert.equal(cardFor(SCENARIO, 3, { isLastScenario: true }).control, 'Finish');
});
