import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { controlsFor, controlNames, CONTROL_ICONS, CONTROL_GROUPS } from '../../lib/game/controls.js';
import { createGame } from '../../lib/game/state.js';
import { PLAY_SLOTS } from '../../lib/game/playbook.js';
import { SCENARIOS } from '../../lib/game/tutorial/script.js';

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
  // CONTROL_ICONS runs one ahead of controlNames(): it also carries the
  // playbook toggle, which wears an icon like everything else but is chrome
  // rather than a control — see the dedicated test below.
  assert.equal(Object.keys(CONTROL_ICONS).length, controlNames().length + 1);
});

test('the playbook toggle is a mark in the table but not a control', () => {
  assert.ok(CONTROL_ICONS.playbook, 'the toggle has an icon like everything else');
  assert.ok(!controlNames().includes('playbook'),
    'but it is chrome, so the button-building loop in app/controls.js must not see it');
  assert.ok(!controlsFor(createGame({ seed: 1 })).some((c) => c.name === 'playbook'),
    'nor is it something the game enables or disables');
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

test('the autoplan label names the side the coach actually has', () => {
  // One press draws up a whole play for whichever side is the human's, so the
  // label has to say which — a coach who has handed the computer the other
  // team is being offered a different thing by the same button.
  const mine = controlsFor(createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' }));
  assert.equal(byName(mine, 'autoplan').label, 'Autoplan offense');
  const theirs = controlsFor(createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' }));
  assert.equal(byName(theirs, 'autoplan').label, 'Autoplan defense');
});

test('the defense label is handed in, not reached for', () => {
  const list = controlsFor(createGame({ seed: 1 }), { aiLabel: 'Defense: computer (learned)' });
  assert.equal(byName(list, 'ai').label, 'Defense: computer (learned)');
});

test('Play Offense/Play Defense keep the 🤖 button off the board', () => {
  // The button lets a coach cycle who the computer plays and how well, which
  // is exactly what those two modes promise NOT to move mid-game. Training
  // Mode is the free-for-all, so it keeps the button, same as `showsMenu`'s
  // default leaves the clipboard on for everyone who doesn't say otherwise.
  const s = createGame({ seed: 1 });
  assert.ok(byName(controlsFor(s), 'ai'), 'fielded when nobody says otherwise');
  assert.ok(byName(controlsFor(s, { showsAi: true }), 'ai'), 'and when the gate is open');
  assert.equal(byName(controlsFor(s, { showsAi: false }), 'ai'), undefined,
    'and gone, not greyed, once a side is picked');
  assert.equal(controlsFor(s, { showsAi: false }).length, controlNames().length - 1);
});

test('a lesson fields only the controls it names', () => {
  const list = controlsFor(createGame({ seed: 1 }), { allow: ['run', 'menu'] });
  assert.deepEqual(list.map((c) => c.name), ['menu', 'run']);
});

test('a lesson can keep the clipboard off the board altogether', () => {
  // `allow` is a whole-scenario gate, so the lesson that teaches the clipboard
  // has to name `menu` in it for every step in order to ring it on the one
  // step that does the teaching. `showsMenu` is the per-step gate on top of
  // that: the clipboard stays off the board for the four steps before.
  const s = createGame({ seed: 1 });
  assert.ok(byName(controlsFor(s), 'menu'), 'fielded when nobody says otherwise');
  assert.ok(byName(controlsFor(s, { showsMenu: true }), 'menu'), 'and when the gate is open');
  assert.equal(byName(controlsFor(s, { showsMenu: false }), 'menu'), undefined,
    'and gone, not greyed, when the lesson has closed it');
  // And it is the only control the gate touches.
  assert.equal(controlsFor(s, { showsMenu: false }).length, controlNames().length - 1);
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

test('the menu heading wears the clipboard the table gives it', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(`${CONTROL_ICONS.menu} Coaches Menu`),
    'the one icon written in markup still matches the table');
});

test('every group a control names has a container in the markup', async () => {
  // app/controls.js does `groups.get(CONTROL_GROUPS[name]).appendChild(btn)`
  // for every control at mount. A group with no container in index.html is
  // therefore not a layout nuisance but `undefined.appendChild` — thrown
  // before a single button exists, taking the whole page down with it. The
  // two files are edited independently, so the pairing is asserted here.
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const inMarkup = new Set(
    [...html.matchAll(/class="control-group"\s+data-group="([^"]+)"/g)].map((m) => m[1]),
  );
  for (const group of new Set(Object.values(CONTROL_GROUPS))) {
    assert.ok(inMarkup.has(group), `index.html has no .control-group for the ${group} group`);
  }
});

test('no lesson rings a control that a phone keeps behind the playbook sheet', () => {
  // On a phone the playbook lives inside a sheet that is closed by default,
  // so a lesson that rings a play button would be pointing at something the
  // player cannot see. The bar's own game controls are always on screen at
  // any width, so a lesson may ring only those.
  //
  // The set comes from the table rather than from a list built for some
  // particular state: a guard whose whole job is to hold whatever the game is
  // doing should not itself depend on what the game is doing. Read off a
  // fresh game, `reposition` would be in the set only because a fresh game
  // happens to allow repositioning, and the day that stopped being true this
  // guard would start failing about the wrong thing entirely.
  const gameControls = new Set(
    Object.entries(CONTROL_GROUPS).filter(([, g]) => g === 'game').map(([name]) => name),
  );
  for (const scenario of SCENARIOS) {
    for (const step of scenario.steps) {
      if (step.highlight?.kind !== 'button') continue;
      assert.ok(gameControls.has(step.highlight.name),
        `${scenario.id} rings ${step.highlight.name}, which is not in the bar's visible row`);
    }
  }
});
