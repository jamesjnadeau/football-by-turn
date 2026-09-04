# The controls come out of the SVG — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the board's twelve SVG button plates with real HTML buttons —
the right-hand column on a desktop, a bottom bar with a playbook sheet on a
phone — so a control is big enough to hit with a thumb.

**Architecture:** One pure function, `controlsFor(state, opts)`, returns a data
description of every control that should exist right now. `node --test` holds
every rule there. A thin DOM layer builds the buttons once from that list and
thereafter only syncs text, `disabled` and classes. Layout is CSS, so the two
arrangements are a media query rather than a second renderer.

**Tech Stack:** Vanilla ES modules, no build step. Tests: `npm test`
(`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-03-controls-out-of-the-svg-design.md`

## Global Constraints

- **This moves where rules are stated, never what they say.** Every enable
  condition in Task 1's table is copied from the code that exists today.
- **`lib/game/controls.js` is pure** — no DOM, no `window`, no `document`, and
  no import of `lib/game/render.js` or anything under `app/`.
- **`controls.js` must not import `lib/game/ai.js`.** The AI mode label is
  threaded in as `aiLabel`, exactly as it is threaded into `renderFieldButtons`
  today: importing `ai.js` for one string drags `learned/*`, `tendencies.js`,
  `defense.js`, `pursuit.js` and `cover.js` into a module whose job is
  describing buttons.
- **`app/controls.js` must not import `app/main.js`.** `main.js` mounts it and
  hands over the press handlers as a `name → handler` map. One-way dependency.
- **Every emoji is written down exactly once**, in the `CONTROLS` table in
  `lib/game/controls.js`. No test, no label and no markup may hold an emoji
  literal — `index.html`'s dialog `<h1>` is the one deliberate exception, and a
  test asserts it matches the table.
- **`allow` stays deny-by-default.** No file under `lib/game/tutorial/` may be
  edited by any task in this plan.
- **Buttons are sized in `rem`** with a `min-width`/`min-height` of `2.75rem`.
  Never a `px` size.
- Comments explain *why*, in full prose sentences, in the voice of the
  surrounding file.
- Commit after every task. **Do not run `git push`.**

---

### Task 1: `controlsFor` — the rules, as data

Pure addition. Nothing renders from it yet, and no existing behaviour changes.

**Files:**
- Create: `lib/game/controls.js`
- Test: `test/game/controls.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CONTROL_ICONS` — `{ [name]: emoji }`, derived from the private `CONTROLS`
    table. Replaces `FIELD_BUTTON_ICONS` in later tasks.
  - `controlNames()` → `string[]` in display order.
  - `controlsFor(state, { repositioning, animating, book, allow, aiLabel, highlight })`
    → `Control[]`, where a `Control` is
    `{ name, icon, label, aria, group, disabled, pressed?, ringed }`.
    `pressed` is present only on `reposition`.

- [ ] **Step 1: Write the failing test**

Create `test/game/controls.test.js`:

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test 2>&1 | grep -A 5 "controls.test"
```

Expected: FAIL — `Cannot find module '../../lib/game/controls.js'`.

- [ ] **Step 3: Write the module**

Create `lib/game/controls.js`:

```js
/**
 * What controls the coach has in front of him right now, as data.
 *
 * This is the whole of the rules: which controls exist, what each is called,
 * and when each is live. It renders nothing and touches no DOM, so `node --test`
 * can hold every one of those rules — which is the point. They used to be
 * stated three times over (the press function's own guard, `*.disabled` in
 * app/main.js's paint, and `off:` in the SVG renderer), and two of the three
 * lived where no test could reach them.
 *
 * The Coaches Menu and the button bar both render from this list, so a rule is
 * written once and both surfaces obey it by construction.
 */
import { canReposition } from './formation.js';
import { canUsePlays } from './play.js';
import { personnelId } from './rosters.js';
import { coachedSide } from './hud.js';
import { PLAY_SLOTS } from './playbook.js';

/**
 * Every control, in the order they are shown: the game controls as they stand
 * in the column today, then the playbook.
 *
 * The icons are written down here and nowhere else. They are `\u{…}` escapes
 * rather than literal characters — a keycap is three codepoints (`1`, U+FE0F,
 * U+20E3), and a careless paste or a diff tool that drops the variation
 * selector leaves a bare digit that still looks very nearly right.
 */
const CONTROLS = {
  ai: { icon: '\u{1F916}', group: 'game' },
  personnel: { icon: '\u{1F465}', group: 'game' },
  reposition: { icon: '\u{1F500}', group: 'game' },
  menu: { icon: '\u{1F4CB}', group: 'game' },
  autoplan: { icon: '\u{1F381}', group: 'game' },
  run: { icon: '\u{23E9}', group: 'game' },
  save: { icon: '\u{1F4BE}', group: 'playbook' },
  play1: { icon: '1\u{FE0F}\u{20E3}', group: 'playbook' },
  play2: { icon: '2\u{FE0F}\u{20E3}', group: 'playbook' },
  play3: { icon: '3\u{FE0F}\u{20E3}', group: 'playbook' },
  play4: { icon: '4\u{FE0F}\u{20E3}', group: 'playbook' },
  play5: { icon: '5\u{FE0F}\u{20E3}', group: 'playbook' },
};

/**
 * The playbook column is built by counting to PLAY_SLOTS and looking each slot
 * up by name, so a sixth slot added to playbook.js without a sixth row here
 * would ask for a control that does not exist. Checked once at load instead,
 * so the failure says which of the two moved.
 */
const PLAY_CONTROLS = Object.keys(CONTROLS).filter((n) => /^play\d+$/.test(n));
if (PLAY_CONTROLS.length !== PLAY_SLOTS) {
  throw new Error(
    `controls.js holds ${PLAY_CONTROLS.length} play controls, but the playbook has ${PLAY_SLOTS} slots`,
  );
}

/** The icons, by control name — for the Coaches Menu's own labels. */
export const CONTROL_ICONS = Object.fromEntries(
  Object.entries(CONTROLS).map(([name, c]) => [name, c.icon]),
);

/** Every control the game knows about, in display order. */
export function controlNames() {
  return Object.keys(CONTROLS);
}

export function controlsFor(state, {
  repositioning = false,
  animating = false,
  book = [],
  allow = null,
  // Threaded in rather than read: AI_MODES lives in ai.js, and importing that
  // for one string would drag the whole learned-AI module graph into a module
  // whose job is describing buttons.
  aiLabel = 'Defense',
  highlight = null,
} = {}) {
  // `allow` is what a tutorial lesson uses to field only the controls it is
  // teaching. A normal drive passes nothing and gets everything.
  const fielded = (name) => allow === null || allow.includes(name);
  const ringedName = highlight?.kind === 'button' ? highlight.name : null;
  const planning = !animating && state.phase === 'planning';
  const setUp = !animating && canReposition(state);
  const plays = !animating && canUsePlays(state);

  const rows = [];
  const add = (name, { label, aria = label, disabled, pressed }) => {
    if (!fielded(name)) return;
    const c = CONTROLS[name];
    rows.push({
      name, icon: c.icon, group: c.group, label, aria, disabled,
      ringed: name === ringedName,
      ...(pressed === undefined ? {} : { pressed }),
    });
  };

  add('ai', { label: aiLabel, disabled: !planning });
  add('personnel', {
    label: `Personnel: ${personnelId(state.variantId)}`,
    // Not the human's to press when the computer coaches the defense: it picks
    // its own package, and the two would fight on every press.
    disabled: !setUp || state.aiTeam === 'defense',
  });
  // The one control that goes rather than greys. Repositioning is illegal once
  // the first turn has run, and its absence is the coach's cue that the play is
  // under way — every other control greys in place, because a button that moves
  // or vanishes is one you have to go looking for.
  if (canReposition(state) && !animating) {
    add('reposition', {
      label: `Reposition: ${repositioning ? 'on' : 'off'}`,
      disabled: false,
      pressed: repositioning,
    });
  }
  // Never dead. Everything the menu holds is behind it, including the way out
  // of a game, so it stays pressable even while a turn is being drawn.
  add('menu', { label: 'Coaches Menu', aria: 'Open the Coaches Menu', disabled: false });
  add('autoplan', { label: `Autoplan ${coachedSide(state)}`, disabled: !planning });
  add('run', { label: 'Run Turn', disabled: !planning });

  // A play is what you come to the line with, so saving and calling one are
  // offered only on the first turn of a down.
  add('save', { label: 'Save current play', aria: 'Save the current play', disabled: !plays });
  for (let i = 0; i < PLAY_SLOTS; i++) {
    const play = book[i];
    add(`play${i + 1}`, {
      label: play ? play.name : '(empty)',
      // The bar's button is a bare digit, so its name is the only place the
      // play — or the fact that there is not one — can be said at all.
      aria: play ? `Call play ${i + 1}: ${play.name}` : `Play slot ${i + 1} is empty`,
      disabled: !plays || !play,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test 2>&1 | tail -8
```

Expected: every new test passes, and the pre-existing suite is unchanged at
856 + 15 = **871** pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add lib/game/controls.js test/game/controls.test.js
git commit -m "feat: the controls, as rules rather than plates"
```

---

### Task 2: The Coaches Menu renders from the list

Proves `controlsFor` against a live surface before anything is deleted. The
board is still SVG plates when this task ends; only the menu's twelve buttons
change where their text and disabled state come from.

**Files:**
- Modify: `app/main.js` (`paint`, `paintPlays`, the startup prefix loop, imports)

**Interfaces:**
- Consumes: `controlsFor`, `CONTROL_ICONS` from Task 1.
- Produces: a `menuButtons` map in `app/main.js` from control name to its
  `<button>`, used again in Task 3.

There is no `node --test` coverage of `app/main.js`; the gate is the browser
check in Step 4.

- [ ] **Step 1: Map the buttons by control name**

In `app/main.js`, below the existing `document.getElementById` lines, add:

```js
/**
 * The Coaches Menu's own buttons, by the control name they answer to. Both
 * this menu and the board's buttons are painted from one controlsFor list, so
 * a control's label and its enable rule are written once — see
 * lib/game/controls.js. `menu` has no entry: it is the control that opens this
 * dialog, so inside the dialog there is nothing for it to be.
 */
const menuButtons = {
  ai: aiBtn, personnel: personnelBtn, reposition: repositionBtn,
  autoplan: autoplanBtn, run: runBtn, save: savePlayBtn,
};
for (let i = 0; i < PLAY_SLOTS; i++) menuButtons[`play${i + 1}`] = slotBtns[i];
```

Place it after the `slotBtns` build loop, so `slotBtns` is populated.

- [ ] **Step 2: Paint the menu from the list**

In `paint()`, delete these lines — every one of them is now stated in
`controls.js`:

```js
  aiBtn.textContent = `${FIELD_BUTTON_ICONS.ai} ${AI_MODES[aiModeIndex(state)].label}`;
  aiBtn.disabled = animating || state.phase !== 'planning';
  repositionBtn.textContent = `${FIELD_BUTTON_ICONS.reposition} Reposition: ${repositioning ? 'on' : 'off'}`;
  repositionBtn.disabled = animating || !canReposition(state);
  personnelBtn.textContent = `${FIELD_BUTTON_ICONS.personnel} Personnel: ${personnelId(state.variantId)}`;
  personnelBtn.disabled = animating || !canReposition(state) || state.aiTeam === 'defense';
```

and

```js
  runBtn.disabled = animating || state.phase !== 'planning';
  autoplanBtn.textContent = `${FIELD_BUTTON_ICONS.autoplan} Autoplan ${coachedSide(state)}`;
  autoplanBtn.disabled = animating || state.phase !== 'planning';
```

Keep `clearBtn`, `debugBtn`, `nextBtn`, `newBtn`, `homeBtn` and the log and
training lines exactly as they are — those are menu-only controls and are not
in the list.

In their place, call one function, and define it next to `paintPlays`:

```js
/**
 * The Coaches Menu's buttons, from the same list the board's are painted from.
 * A control the list leaves out is hidden rather than greyed — that is how the
 * shuffle disappears once the play is under way, and hiding rather than
 * disabling keeps the menu's own reading of it identical to the board's.
 */
function paintMenuButtons() {
  const live = new Map(controlsFor(state, {
    repositioning,
    animating,
    book: myBook(),
    aiLabel: AI_MODES[aiModeIndex(state)].label,
  }).map((c) => [c.name, c]));
  for (const [name, btn] of Object.entries(menuButtons)) {
    const c = live.get(name);
    btn.hidden = !c;
    if (!c) continue;
    btn.textContent = `${c.icon} ${c.label}`;
    btn.disabled = c.disabled;
  }
}
```

Call `paintMenuButtons()` from `paint()` where the deleted lines were.

- [ ] **Step 3: Retire what the list replaces**

`paintPlays()` no longer sets slot text or disabled state — `paintMenuButtons`
does. Reduce it to the heading and the save button's own text, or delete it and
move the heading line into `paintMenuButtons`; either is fine, but no line may
set a slot's `textContent` or `disabled` twice.

Delete the startup prefix loop (`for (const [btn, name] of [[runBtn, 'run'], …]`)
and the comment above `runBtn.disabled` warning not to give those buttons a
template — both exist only because those labels were written in two places, and
now they are written in one. Drop `FIELD_BUTTON_ICONS` from the `render.js`
import if nothing else uses it.

Add `controlsFor` to the imports from `../lib/game/controls.js`.

- [ ] **Step 4: Run the suite, then check the menu in the browser**

```bash
npm test 2>&1 | tail -6
```

Expected: **871** pass, 0 fail — no test reaches this file, so this only
confirms nothing else broke.

Then, via the Browser pane (`preview_start` with name `football-by-turn`; never
a dev server from Bash): open a game, open the Coaches Menu, and confirm every
button reads exactly as it did before — same icon, same text, same greying.
Run a turn and confirm Reposition disappears from the menu at the snap and
comes back on the next down.

- [ ] **Step 5: Commit**

```bash
git add app/main.js
git commit -m "refactor: the menu's buttons come off the control list"
```

---

### Task 3: The switchover — HTML buttons in, SVG plates out

The one task that cannot be split: the plates and the buttons cannot both be on
screen, and the tutorial's ring dies with `fieldButtonAnchor`. Desktop layout
only — the phone bar is Task 4.

**Files:**
- Create: `app/controls.js`
- Modify: `index.html` (markup and desktop CSS), `app/main.js`,
  `lib/game/render.js`, `test/game/render.test.js`

**Interfaces:**
- Consumes: `controlsFor`, `CONTROL_ICONS`, `controlNames` from Task 1;
  `menuButtons` from Task 2.
- Produces: `mountControls(root, handlers)` → `{ sync(controls) }` from
  `app/controls.js`.

- [ ] **Step 1: Move the icon table's tests before moving the table**

In `test/game/render.test.js`, the three tests that guard the icon table —
"every plate the table names is drawn", the off-table-icon sweep, and the
`index.html` heading assertion — must move to `test/game/controls.test.js` and
read from `CONTROL_ICONS`/`controlNames`. The first two are about plates and
die with them; **the `index.html` one must survive**, rewritten:

```js
test('the menu heading wears the clipboard the table gives it', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(`${CONTROL_ICONS.menu} Coaches Menu`),
    'the one icon written in markup still matches the table');
});
```

with `import { readFile } from 'node:fs/promises';` at the top of the file.

- [ ] **Step 2: Write the markup and the desktop CSS**

In `index.html`, after the `<svg id="board">` element:

```html
  <div id="controls" hidden>
    <div class="control-group" data-group="game"></div>
    <button id="playbook-toggle" type="button" hidden></button>
    <div class="control-group" data-group="playbook"></div>
  </div>
```

`#controls` is hidden until a game starts, the way `#board` is. The toggle is
hidden at every width until Task 4 gives it a job.

Add to the `<style>` block:

```css
    /* The controls used to be SVG plates drawn in field units, which welded
       their size to the board's scale: on a phone a plate came out about
       12.5px against the 44 a thumb needs. They are real buttons now, sized in
       rem, so the reader's own text size decides how big they are and the
       board's scale has nothing to do with it. */
    #controls {
      position: fixed; display: flex; gap: .5rem;
      top: 50%; right: .5rem; transform: translateY(-50%);
      flex-direction: row; align-items: center;
    }
    #controls[hidden] { display: none; }
    .control-group { display: flex; flex-direction: column; gap: .5rem; }
    .control {
      min-width: 2.75rem; min-height: 2.75rem;
      display: flex; align-items: center; justify-content: center;
      font: inherit; font-size: 1.25rem; line-height: 1; cursor: pointer;
      background: #fff; border: 1px solid #1a7f37; border-radius: .35rem;
    }
    .control[aria-pressed="true"] { background: #d7ebdc; border-width: 2px; }
    .control:disabled { border-color: #ccc; opacity: .4; cursor: default; }
    /* The tutorial's ring. A player is ringed in SVG because a player is on the
       field; a control is ringed here, because a control is not. */
    .control.is-ringed { outline: 3px solid #c9962c; outline-offset: 2px; }
```

- [ ] **Step 3: Write the DOM layer**

Create `app/controls.js`:

```js
/**
 * The control buttons, as real DOM.
 *
 * Every rule about which controls exist and when they are live is in
 * lib/game/controls.js; this file only paints them. It builds each button once
 * and thereafter writes only text, `disabled` and classes — never innerHTML,
 * which would throw away the focus of anyone working the controls from the
 * keyboard. app/main.js already learned that with the menu's slot buttons.
 *
 * It does not import app/main.js: main.js mounts this and hands the press
 * handlers over, so the dependency runs one way and main.js stays the single
 * owner of what a press does.
 */

/**
 * @param root the #controls element
 * @param handlers a map of control name to the function its press calls
 */
export function mountControls(root, handlers) {
  const groups = new Map(
    [...root.querySelectorAll('.control-group')].map((el) => [el.dataset.group, el]),
  );
  const buttons = new Map();

  const buttonFor = (control) => {
    let btn = buttons.get(control.name);
    if (btn) return btn;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'control';
    btn.dataset.control = control.name;
    btn.addEventListener('click', () => handlers[control.name]?.());
    groups.get(control.group).appendChild(btn);
    buttons.set(control.name, btn);
    return btn;
  };

  return {
    sync(controls) {
      const live = new Map(controls.map((c) => [c.name, c]));
      // Build or update everything the list holds, in the list's own order.
      for (const c of controls) {
        const btn = buttonFor(c);
        // The icon is the button's whole visible content; `aria-label` is what
        // it announces, because there is no text beside it to read.
        if (btn.textContent !== c.icon) btn.textContent = c.icon;
        btn.setAttribute('aria-label', c.aria);
        btn.disabled = c.disabled;
        btn.hidden = false;
        btn.classList.toggle('is-ringed', c.ringed);
        if (c.pressed === undefined) btn.removeAttribute('aria-pressed');
        else btn.setAttribute('aria-pressed', String(c.pressed));
      }
      // A control the list left out is hidden rather than removed, so its
      // button — and anything the browser is tracking about it — survives to
      // the next down instead of being rebuilt.
      for (const [name, btn] of buttons) if (!live.has(name)) btn.hidden = true;
    },
  };
}
```

- [ ] **Step 4: Mount it, and stop painting plates**

In `app/main.js`:

```js
import { mountControls } from './controls.js';
```

After the `menuButtons` map from Task 2, mount:

```js
/**
 * The board's own controls. They call exactly the functions the Coaches Menu's
 * buttons call — one rule per control, never a second copy — which is why the
 * handlers are handed over here rather than reached for inside app/controls.js.
 */
const controlsEl = document.getElementById('controls');
const boardControls = mountControls(controlsEl, {
  menu: openMenu,
  reposition: toggleReposition,
  ai: pressAi,
  personnel: pressPersonnel,
  autoplan: pressAutoplan,
  run: pressRun,
  save: savePlay,
  ...Object.fromEntries(
    Array.from({ length: PLAY_SLOTS }, (_, i) => [`play${i + 1}`, () => callPlay(i)]),
  ),
});
```

Give `paintMenuButtons` from Task 2 the list rather than computing it, and
paint both surfaces from the one call. Rename it `paintControls`:

```js
function paintControls() {
  const controls = controlsFor(state, {
    repositioning,
    animating,
    book: myBook(),
    allow: lesson ? lesson.buttons() : null,
    aiLabel: AI_MODES[aiModeIndex(state)].label,
    highlight: lesson ? lesson.card().highlight : null,
  });
  boardControls.sync(controls);
  // The menu shows every control the game has, not only the ones a lesson
  // fields, so it is painted from an unfiltered list of the same rules.
  const forMenu = new Map(controlsFor(state, {
    repositioning, animating, book: myBook(),
    aiLabel: AI_MODES[aiModeIndex(state)].label,
  }).map((c) => [c.name, c]));
  for (const [name, btn] of Object.entries(menuButtons)) {
    const c = forMenu.get(name);
    btn.hidden = !c;
    if (!c) continue;
    btn.textContent = `${c.icon} ${c.label}`;
    btn.disabled = c.disabled;
  }
}
```

In `aimCamera`, delete the two lines that clear and repaint `game-menu` and
`game-buttons`, and the `menuButtonMark`/`renderFieldButtons` imports.

In `anchorFor`, delete the button branch — a button ring is a CSS class now:

```js
/** Where the ring goes. Only a player: a control is ringed on its own button,
 *  in app/controls.js, because a control is no longer on the field. */
function anchorFor(highlight, cam) {
  if (!highlight || highlight.kind === 'button') return null;
  const p = state.players.find((pl) => pl.id === highlight.id);
  return p ? { x: p.pos.x, y: p.pos.y, r: p.radius } : null;
}
```

Show `#controls` wherever `#board` is shown. This lives entirely in
`app/home.js`, which has a `show(el, visible)` helper (`app/home.js:41`) and
exactly three calls that move the board: `showHome()` hides it, `startTutorial()`
and `start()` show it. Add a `show(controls, …)` beside each of the three, and
grab `#controls` next to where that file already grabs `#board`. Use the helper
rather than assigning `.hidden` — the comment above it explains why: `#board` is
an `<svg>`, and `SVGElement` has no `hidden` property, so only the attribute
does anything.

In `pressBoardButton`, delete every `data-…-button` branch. Only
`[data-tutorial-next]` remains; if nothing else is left, the board's `click`
and `keydown` listeners reduce to that one case.

- [ ] **Step 5: Delete the plates**

From `lib/game/render.js`, delete: `FIELD_BTN_SIZE`, `FIELD_BTN_GAP`,
`FIELD_BTN_PITCH`, `YARD_LABEL_WIDTH`, `FIELD_BTN_X`, `FIELD_BTN_FONT`,
`FIELD_BTN_RADIUS`, `FIELD_BTN_STROKE`, `GAME_VIEWBOX_WIDTH`, `FIELD_BUTTONS`,
`PLAY_PLATES` and its load-time check, `FIELD_BUTTON_ICONS`,
`fieldButtonNames`, `fieldButtonAnchor`, `menuButtonMark`, `buttonColumnMidY`,
`fieldButtonMark`, `renderFieldButtons`, and the five `.fbtn-*` rules in
`STYLE_GAME`. Drop the now-unused imports (`canReposition`, `canUsePlays`,
`personnelId`, `coachedSide`, `PLAY_SLOTS`, `YARD_LABEL_RIGHT_X`,
`escapeText` — check each; some are used elsewhere in the file).

`cameraViewBox` and `renderBoardShell` go back to `VIEWBOX_WIDTH`:

```js
  return `0 ${num(view.windowTopY)} ${VIEWBOX_WIDTH} ${num(view.height)}`;
```

and in `renderBoardShell`'s returned `viewBox`. Delete the `game-menu` and
`game-buttons` layers from its markup, and rewrite the section comment that
introduced the button column — it describes something that is no longer in this
file. Say instead why the crop is the field's own width again: the controls
left the SVG, so the ten units that held their second column are not needed.

- [ ] **Step 6: Delete the tests that describe plates**

From `test/game/render.test.js`, delete every test that names a plate,
`fieldButtonAnchor`, `renderFieldButtons`, `menuButtonMark`, `fbtn`, or a
`data-…-button` attribute, and the `rectBox`/`buttonGroup` helpers if nothing
else uses them. Update the two viewBox assertions from 280 back to **270**.

Do not delete anything that tests the field, the players, the message plate,
the arrows or the tutorial's card.

- [ ] **Step 7: Run the suite and check the desktop layout**

```bash
npm test 2>&1 | tail -8
```

Expected: 0 fail. The count drops by the deleted plate tests — record the new
number in your report rather than matching a figure here, since how many go
depends on Step 6.

In the browser at a desktop width: twelve buttons in two columns on the right,
each doing what its menu twin does; Reposition vanishing at the snap; disabled
buttons genuinely unclickable and skipped by Tab; the field visibly wider than
before (the crop is 270 again); no console errors.

Then start "How to play" and confirm the lesson's ring lands on the right
button — an outline on the actual `run` / `reposition` / `menu` button — and
that the lesson fields only the controls it names.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: the controls become buttons, and leave the board"
```

---

### Task 4: The phone layout

**Files:**
- Modify: `index.html` (media query, the toggle), `app/controls.js`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: `mountControls` gains a third parameter — its signature becomes
  `mountControls(root, handlers, playbookIcon)`. Task 3's two-parameter call in
  `app/main.js` is updated in Step 2 below.

- [ ] **Step 1: Add the media query**

In `index.html`'s `<style>`, below the desktop rules:

```css
    /* On a narrow screen the right-hand column would cost 23% of the width, so
       the controls go to the bottom instead — the thumb zone — and the playbook
       moves behind a toggle rather than sitting where a thumb rests, since a
       stray press on it replaces the whole formation with no undo. */
    @media (max-width: 700px) {
      #controls {
        top: auto; right: 0; left: 0; bottom: 0; transform: none;
        flex-direction: column; align-items: stretch;
        gap: 0; padding: .375rem; box-sizing: border-box;
        background: #fff; border-top: 1px solid #ccc;
      }
      #controls [data-group="game"] {
        flex-direction: row; justify-content: space-evenly; order: 2;
      }
      #playbook-toggle { order: 3; }
      /* The sheet sits above the bar and is closed until the toggle opens it. */
      #controls [data-group="playbook"] {
        order: 1; flex-direction: row; justify-content: space-evenly;
        padding-bottom: .375rem;
      }
      #controls:not(.playbook-open) [data-group="playbook"] { display: none; }
      /* The bar takes its height from the field rather than covering it: the
         bottom of the window is behind the offense at the snap, which is
         exactly where a coach is dragging. */
      #board { height: calc(100% - var(--control-bar, 7rem)); }
    }
```

Show the toggle at every width in the markup and let the desktop rules hide it:

```css
    #playbook-toggle { display: none; }
    @media (max-width: 700px) { #playbook-toggle { display: flex; } }
```

Give `#playbook-toggle` the `.control` class in the markup so it is sized and
styled like the rest.

- [ ] **Step 2: Wire the toggle**

In `app/controls.js`'s `mountControls`, after the groups are found:

```js
  // The playbook lives behind a toggle on a narrow screen — see the media
  // query. Its open/closed state is view state and belongs here; nothing in the
  // game knows or cares whether the sheet is showing.
  const toggle = root.querySelector('#playbook-toggle');
  const setOpen = (open) => {
    root.classList.toggle('playbook-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.textContent = playbookIcon;
  toggle.setAttribute('aria-label', 'Show the playbook');
  toggle.hidden = false;
  toggle.addEventListener('click', () => setOpen(!root.classList.contains('playbook-open')));
  setOpen(false);
```

`playbookIcon` is a new `mountControls` parameter, passed from `app/main.js` so
the emoji stays written down in one place. Add a `playbook` row to `CONTROLS`
in `lib/game/controls.js` with icon `'\u{1F4D3}'` and group `'playbook'` — and
**exclude it from `controlsFor`'s output**, since it is chrome rather than a
game control. Its own test:

```js
test('the playbook toggle is a mark in the table but not a control', () => {
  assert.ok(CONTROL_ICONS.playbook, 'the toggle has an icon like everything else');
  assert.ok(!controlsFor(createGame({ seed: 1 })).some((c) => c.name === 'playbook'),
    'but it is chrome, not something the game enables or disables');
});
```

Update the two tests from Task 1 that count `controlNames()` against the list
length, since the table now holds one more name than the list returns.

- [ ] **Step 3: Run the suite**

```bash
npm test 2>&1 | tail -6
```

Expected: 0 fail.

- [ ] **Step 4: Check the phone layout in the browser**

Use `resize_window` with preset `mobile` (375×812), reload, and confirm: the
bar across the bottom with six game controls and the 📓 toggle; the toggle
opening a sheet of 💾 and 1️⃣–5️⃣ above it; **the field not hidden behind the
bar** — drag a player standing on the last few yards and confirm you can reach
him; every button at least 44px; the tutorial's ring still landing correctly.
Then `resize_window` preset `desktop` and confirm the column is back.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: on a phone the controls come to the thumb"
```

---

### Task 5: The lesson-visibility guard, and verification at both widths

**Files:**
- Test: `test/game/controls.test.js`

- [ ] **Step 1: Pin the constraint the phone layout creates**

A lesson may only ring a control that is visible in the current layout. On a
phone the playbook is inside a closed sheet, so a lesson ringing a play button
would be pointing at nothing. Nothing else would catch this.

```js
import { SCENARIOS } from '../../lib/game/tutorial/script.js';

test('no lesson rings a control that a phone keeps behind the playbook sheet', () => {
  const gameControls = new Set(
    controlsFor(createGame({ seed: 1 })).filter((c) => c.group === 'game').map((c) => c.name),
  );
  for (const scenario of SCENARIOS) {
    for (const step of scenario.steps) {
      if (step.highlight?.kind !== 'button') continue;
      assert.ok(gameControls.has(step.highlight.name),
        `${scenario.id} rings ${step.highlight.name}, which is not in the bar's visible row`);
    }
  }
});
```

`SCENARIOS` is the export — verified: `lib/game/tutorial/script.js:350` reads
`export const SCENARIOS = [SNAP_AND_RUN, BLOCK_AND_THROW, PLAYING_DEFENSE,
WHERE_THEY_STAND]`. **Do not edit `script.js`** to make the test convenient.

- [ ] **Step 2: Run it**

```bash
npm test 2>&1 | tail -6
```

Expected: PASS — today only `run`, `reposition` and `menu` are ringed, and all
three are game controls. If it fails, a lesson is already ringing something the
phone would hide, and that is a real finding: report it rather than weakening
the test.

- [ ] **Step 3: Verify both layouts end to end**

At desktop width and again at `mobile`, for each of the twelve controls: press
it, and press its Coaches Menu twin, and confirm the two do the same thing.
Confirm the greying matches between board and menu in each of these states: a
fresh down; mid-animation; after the whistle; with the computer coaching the
defense; with an empty playbook. Confirm focus survives a repaint — tab to a
button, run a turn, confirm focus is not lost. Read the console.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: no lesson may ring a control a phone hides"
```

---

## Notes for the implementer

- **Do not edit anything under `lib/game/tutorial/`.** `allow` and the
  highlight descriptors keep their present shape; if a lesson seems to need
  changing, that is a finding to report, not a change to make.
- **Do not add a confirmation or an undo to `callPlay`.** A 44px target and a
  genuinely inert disabled button are the fix being made here.
- **Do not change `canUsePlays`.** The play-call rule was already correct; only
  its refusal was silent, and a native `disabled` button fixes that by being
  unpressable.
- Never run a dev server from Bash — use the Browser pane's `preview_start`
  with the name `football-by-turn`.
