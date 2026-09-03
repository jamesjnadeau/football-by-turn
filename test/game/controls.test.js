import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlsFor, controlNames, CONTROL_ICONS } from '../../lib/game/controls.js';
import { createGame } from '../../lib/game/state.js';
import { PLAY_SLOTS } from '../../lib/game/playbook.js';

/** The control by that name, or undefined if the list left it out. */
const byName = (list, name) => list.find((c) => c.name === name);

test('the list is every control, in the order they are shown', () => {
  const list = controlsFor(createGame({ seed: 1 }));
  assert.deepEqual(list.map((c) => c.name), [
    'ai', 'personnel', 'reposition', 'menu', 'autoplan', 'run',
    'save', 'play1', 'play2', 'play3', 'play4', 'play5',
  ]);
  assert.deepEqual(list.map((c) => c.name), controlNames());
});

test('the game controls and the playbook are told apart by group', () => {
  const list = controlsFor(createGame({ seed: 1 }));
  const game = list.filter((c) => c.group === 'game').map((c) => c.name);
  const book = list.filter((c) => c.group === 'playbook').map((c) => c.name);
  assert.deepEqual(game, ['ai', 'personnel', 'reposition', 'menu', 'autoplan', 'run']);
  assert.equal(book.length, PLAY_SLOTS + 1, 'save, and one per slot');
});

test('every control wears the icon the table gives it, and no other', () => {
  const list = controlsFor(createGame({ seed: 1 }));
  for (const c of list) assert.equal(c.icon, CONTROL_ICONS[c.name], `${c.name}'s icon`);
  assert.equal(Object.keys(CONTROL_ICONS).length, controlNames().length);
});

test('a control carries a short label and a standalone accessible name', () => {
  const list = controlsFor(createGame({ seed: 1 }), { book: [{ name: 'Fly sweep' }] });
  // The menu shows the icon beside the label; the bar's button has only the
  // icon, so its name has to say what pressing it would do, unaided.
  assert.equal(byName(list, 'play1').label, 'Fly sweep');
  assert.equal(byName(list, 'play1').aria, 'Call play 1: Fly sweep');
  assert.equal(byName(list, 'play2').label, '(empty)');
  assert.equal(byName(list, 'play2').aria, 'Play slot 2 is empty');
});

test('nothing is greyed on a fresh down', () => {
  const list = controlsFor(createGame({ seed: 1 }), { book: [{ name: 'Fly sweep' }] });
  for (const name of ['ai', 'personnel', 'reposition', 'menu', 'autoplan', 'run', 'save', 'play1']) {
    assert.equal(byName(list, name).disabled, false, `${name} is live`);
  }
});

test('every control but the clipboard dies while the turn is drawn', () => {
  const list = controlsFor(createGame({ seed: 1 }), { animating: true, book: [{ name: 'Fly sweep' }] });
  for (const c of list) {
    if (c.name === 'menu') assert.equal(c.disabled, false, 'the menu still opens');
    else assert.equal(c.disabled, true, `${c.name} is dead`);
  }
});

test('the shuffle leaves the list rather than greying, once the play is under way', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 1;
  assert.equal(byName(controlsFor(s), 'reposition'), undefined, 'gone, not greyed');
  // And it is the ONLY one that goes: a control that vanished would be one you
  // had to go looking for, so everything else greys in place.
  assert.equal(controlsFor(s).length, controlNames().length - 1);
});

test('the shuffle says whether it is on', () => {
  const s = createGame({ seed: 1 });
  assert.equal(byName(controlsFor(s, { repositioning: true }), 'reposition').pressed, true);
  assert.equal(byName(controlsFor(s, { repositioning: false }), 'reposition').pressed, false);
});

test('run, autoplan and defense grey off the planning phase, with nothing drawn', () => {
  const s = createGame({ seed: 1 });
  s.phase = 'playOver';
  const list = controlsFor(s, { animating: false });
  for (const name of ['run', 'autoplan', 'ai']) {
    assert.equal(byName(list, name).disabled, true, `${name} is greyed off planning`);
  }
});

test('personnel is not the human to press when the computer has the defense', () => {
  const s = createGame({ seed: 1 });
  s.aiTeam = 'defense';
  assert.equal(byName(controlsFor(s), 'personnel').disabled, true);
});

test('personnel greys once the play is under way', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 1;
  assert.equal(byName(controlsFor(s), 'personnel').disabled, true);
});

test('the playbook is a first-turn thing, and an empty slot cannot be called', () => {
  const fresh = controlsFor(createGame({ seed: 1 }), { book: [{ name: 'Fly sweep' }] });
  assert.equal(byName(fresh, 'save').disabled, false);
  assert.equal(byName(fresh, 'play1').disabled, false, 'a saved play can be called');
  assert.equal(byName(fresh, 'play2').disabled, true, 'an empty slot cannot');

  const under = createGame({ seed: 1 });
  under.turnIndex = 1;
  const list = controlsFor(under, { book: [{ name: 'Fly sweep' }] });
  assert.equal(byName(list, 'save').disabled, true, 'a play is what you come to the line with');
  assert.equal(byName(list, 'play1').disabled, true);
});

test('the defense label is handed in, not reached for', () => {
  const list = controlsFor(createGame({ seed: 1 }), { aiLabel: 'Defense: computer (learned)' });
  assert.equal(byName(list, 'ai').label, 'Defense: computer (learned)');
});

test('a lesson fields only the controls it names', () => {
  const list = controlsFor(createGame({ seed: 1 }), { allow: ['run', 'menu'] });
  assert.deepEqual(list.map((c) => c.name), ['menu', 'run']);
});

test('the ring lands on the control a lesson is pointing at', () => {
  const list = controlsFor(createGame({ seed: 1 }), {
    highlight: { kind: 'button', name: 'run' },
  });
  assert.equal(byName(list, 'run').ringed, true);
  assert.equal(byName(list, 'menu').ringed, false);
  // A player highlight is drawn on the field, not on a button.
  const onPlayer = controlsFor(createGame({ seed: 1 }), {
    highlight: { kind: 'player', id: 'o-qb' },
  });
  assert.ok(onPlayer.every((c) => c.ringed === false));
});
