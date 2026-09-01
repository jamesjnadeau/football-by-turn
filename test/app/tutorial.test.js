import test from 'node:test';
import assert from 'node:assert/strict';
import { createLesson } from '../../app/tutorial.js';
import { SCENARIOS } from '../../lib/game/tutorial/script.js';
import { runTurn } from '../../lib/game/turn.js';
import { getPlayer } from '../../lib/game/state.js';
import { placePlayer } from '../../lib/game/formation.js';

test('a lesson deals its first scenario at the fifty, computer on the other side', () => {
  const lesson = createLesson();
  const { state } = lesson.deal();
  assert.equal(state.losYard, 50);
  assert.equal(state.aiTeam, SCENARIOS[0].scripted);
  assert.equal(state.aiLevel, 'scripted');
  assert.equal(lesson.attempt(), 1);
  assert.deepEqual(lesson.buttons(), SCENARIOS[0].buttons);
});

test('the same seed deals the same down twice', () => {
  const a = createLesson().deal().state;
  const b = createLesson().deal().state;
  assert.equal(a.seed, b.seed);
  assert.deepEqual(a.players.map((p) => p.pos), b.players.map((p) => p.pos));
});

test('the gate refuses what the first step did not ask for', () => {
  const lesson = createLesson();
  lesson.deal();
  assert.equal(lesson.allows({ kind: 'run' }), null);
  assert.ok(lesson.allows({ kind: 'reposition' }), 'a nudge, not silence');
});

test('a step that lands moves the card on', () => {
  const lesson = createLesson();
  const { state, random } = lesson.deal();
  const before = lesson.card().progress;
  runTurn(state, random);
  lesson.saw(state, { repositioning: false });
  assert.notEqual(lesson.card().progress, before);
});

test('a play that dies early is replayed, with the attempt counted', () => {
  const lesson = createLesson();
  const { state } = lesson.deal();
  state.phase = 'playOver';
  state.deadReason = 'tackled';
  const result = lesson.saw(state, { repositioning: false });
  assert.equal(result.replay, true);
  const again = lesson.deal();
  assert.equal(lesson.attempt(), 2);
  assert.equal(again.state.phase, 'planning', 'a fresh down, from the top');
  assert.match(lesson.card().footer, /skip/i, 'and the door is pointed at');
});

test('the clipboard stays off the board while there is still football to teach', () => {
  const lesson = createLesson();
  lesson.deal();
  assert.equal(lesson.showsMenu(), false);
});

test('walking off the end of the last lesson is what finishes the tutorial', () => {
  const lesson = createLesson();
  for (let i = 1; i < SCENARIOS.length; i += 1) lesson.next(); // on to the last lesson
  const { state } = lesson.deal();
  const steps = SCENARIOS.at(-1).steps;
  assert.equal(steps.at(-1).allow.action, 'menu', 'the last beat is the menu');

  // Satisfy the football steps by fiat — Task 6 already holds that they are
  // reachable; this test is about what happens at the end of them. The one
  // exception is "move him": no ctx flag can fake a position change, so that
  // one beat is performed for real, while the down is still in the planning
  // phase a reposition needs. The whistle (which "coach it" is waiting for) is
  // likewise only forced once the highlighted step has stopped asking for a
  // man to be moved or a mode to be toggled — forcing it earlier would end the
  // down out from under a step that still needed it live.
  let guard = 0;
  while (lesson.showsMenu() === false && guard < steps.length + 2) {
    const highlight = lesson.highlight();
    if (highlight?.kind === 'player') {
      const p = getPlayer(state, highlight.id);
      assert.ok(placePlayer(state, highlight.id, { x: p.pos.x + 3, y: p.pos.y + 3 }),
        `${highlight.id} could not be moved`);
    } else if (highlight === null) {
      state.phase = 'playOver';
    }
    lesson.saw(state, { repositioning: guard % 2 === 0, menuOpen: false });
    guard += 1;
  }
  assert.equal(lesson.showsMenu(), true, 'the clipboard is offered at the end');
  assert.equal(lesson.saw(state, { menuOpen: false }).finished, false, 'not until it is pressed');
  assert.equal(lesson.saw(state, { menuOpen: true }).finished, true);
});

test('the control walks the lessons, and the last one finishes the tutorial', () => {
  const lesson = createLesson();
  lesson.deal();
  for (let i = 1; i < SCENARIOS.length; i += 1) {
    assert.equal(lesson.next().finished, false);
    lesson.deal();
    assert.equal(lesson.attempt(), 1, 'a new lesson starts on its first attempt');
  }
  assert.equal(lesson.next().finished, true);
});
