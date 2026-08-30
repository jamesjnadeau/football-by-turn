# Home Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the page on a home screen offering **7 Player** (the game as it exists today) and **11 Player** (visible, disabled, marked *coming soon*), start the seven-a-side game when it is pressed, and give the Coaches Menu a **Back to Home** button that returns there.

**Architecture:** Four separable pieces. (1) `lib/game/variants.js` is the one list of games this page can deal — id, label, team size, and whether it is playable. (2) `lib/game/home.js` turns that list into the screen's markup as a *string*, the same discipline `lib/game/render.js` follows, so `node --test` can assert on it without a DOM. (3) `app/home.js` becomes the page's only entry point: it writes the markup in, listens for the press, and `import()`s the game the first time one is asked for. (4) `app/main.js` stops booting itself at module scope and exports `startGame({ onExit })` instead, so a drive can be started more than once and can hand control back.

**Tech Stack:** Vanilla ES modules, no build step, native `<dialog>` for the existing menu, `node --test` (no DOM) for `lib/`, manual browser check for `app/` and `index.html`.

**Spec:** this document. The request, verbatim:

> Create a home screen for the user to land on when they first enter the game. This screen should allow them to select between 7 player and 11 player(not available yet). When the user sselectes one of these buttons, it should take them to that version of the game.

### Decisions (asked and answered before planning)

1. **Back navigation:** there *is* a way back — a **Back to Home** button in the Coaches Menu. This is why `app/main.js` gets a start/stop lifecycle instead of the one-line "boot on import" it has today.
2. **The 11-player button:** rendered and **disabled**, labelled `11 Player — coming soon`. It is a promise, not a dead end, and it needs no click handling.

### Explicitly out of scope (do not build these)

- **The eleven-a-side game itself.** `TEAM_SIZE`, the `OFFENSE`/`DEFENSE` formations in `lib/game/state.js`, and every rule keyed off them are untouched. The button is disabled precisely because that game does not exist.
- **Remembering the choice** across reloads, and **deep-linking** a variant by URL (`?variant=7`). Nobody asked; a reload lands on the home screen, which is what "land on when they first enter" means.
- **Passing a variant into `startGame()`.** There is one playable variant, so a parameter selecting between them would have exactly one legal value. Add it with the second game, not before.

## Global Constraints

- **No build step and no dependencies.** Everything is plain ES modules with relative imports, loaded straight from disk. `package.json` gains nothing.
- **There is no DOM in tests.** `node --test` runs bare Node. Anything in `app/` or `index.html` is verified by hand in the browser, per the verification scripts in Tasks 3 and 4. Anything that can be a string in `lib/` **must** be, so it can be tested.
- **All caller-supplied text written into markup goes through `escapeText()`** from `lib/field/escape.js`.
- **Baseline:** `main` at `84ea5e4` ("Replace the sideline legend with a clipboard button"), working tree clean apart from untracked plan files under `docs/superpowers/plans/`. `npm test` reports **320 passing**. Every task below states the count it should leave behind.
- **The green is `#1a7f37`.** Use that literal string — it is the green `lib/game/render.js` already draws plans and cover halos in.
- **Author `display` rules beat the UA `[hidden]` rule.** `index.html` already carries this lesson for `.menu-body button[hidden]`. Anything given an author `display` and hidden via the `hidden` property needs its own `[hidden] { display: none; }` rule, or it will not hide. This bites both `#board` and `#home` in Task 3.
- **The deploy workflow needs no change.** `.github/workflows/deploy.yml` copies `index.html`, `app/`, and `lib/` wholesale, so new files under those directories ship automatically.
- Every commit step **stages named paths only — never `git add -A`.** Untracked plan files live in the tree and must not be swept in.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/game/variants.js` | create | The list of games this page can deal, and the two lookups over it. Pure data — no markup, no DOM. |
| `lib/game/home.js` | create | The home screen as a markup string, built from a variant list. Pure — no DOM. |
| `test/game/variants.test.js` | create | Covers the list and the lookups, and pins the playable variant's team size to the `TEAM_SIZE` the game actually fields. |
| `test/game/home.test.js` | create | Covers the markup: one button per variant, the disabled one, and escaping. |
| `app/home.js` | create | DOM wiring for the screen, and the page's entry point. Imports the game on demand. |
| `app/main.js` | modify (bottom, plus four small edits) | Stops booting at import; exports `startGame({ onExit })`. Gains the Back to Home handler. |
| `index.html` | modify | Adds the `#home` section and its styles, hides `#board` until a game starts, adds the Back to Home button to the menu, and points the module script at `app/home.js`. |
| `README.md` | modify | Documents the home screen and Back to Home under *How to play*. |

`variants.js` and `home.js` are two files rather than one because they answer two different questions — *what games exist* and *how the screen reads* — and the codebase already splits those (`constants.js` vs `render.js`). Each is under thirty lines.

---

### Task 1: The variant list

**Files:**
- Create: `lib/game/variants.js`
- Test: `test/game/variants.test.js`

**Interfaces:**
- Consumes: `TEAM_SIZE` from `lib/game/constants.js` (in the *test* only — see Step 3).
- Produces:
  - `VARIANTS: Array<{ id: string, label: string, note: string, teamSize: number, available: boolean }>`
  - `getVariant(id: string): object | null`
  - `isPlayable(id: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/game/variants.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VARIANTS, getVariant, isPlayable } from '../../lib/game/variants.js';
import { TEAM_SIZE } from '../../lib/game/constants.js';

test('two games are offered: seven a side to play, eleven not yet', () => {
  assert.deepEqual(VARIANTS.map((v) => v.id), ['7', '11']);
  assert.equal(isPlayable('7'), true);
  assert.equal(isPlayable('11'), false);
});

test('every variant carries what the screen needs to draw it', () => {
  for (const v of VARIANTS) {
    assert.equal(typeof v.label, 'string', `${v.id} label`);
    assert.ok(v.label.length > 0, `${v.id} label is not empty`);
    assert.equal(typeof v.note, 'string', `${v.id} note`);
    assert.ok(v.note.length > 0, `${v.id} note is not empty`);
    assert.equal(typeof v.available, 'boolean', `${v.id} available`);
  }
});

test('the playable variant fields the team the game actually builds', () => {
  assert.equal(getVariant('7').teamSize, TEAM_SIZE);
});

test('an id nobody offers is neither found nor playable', () => {
  assert.equal(getVariant('9'), null);
  assert.equal(isPlayable('9'), false);
});
```

The third test is the point of the file: `teamSize` is written out as a literal below rather than imported from `constants.js`, so raising `TEAM_SIZE` to eleven one day fails *here* and points at the home screen, instead of silently leaving the screen offering a seven that is no longer seven.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/variants.test.js`
Expected: FAIL — `Cannot find module .../lib/game/variants.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/variants.js`:

```js
/**
 * Which games this page can deal. The home screen is built from this list and
 * nothing else, so offering the eleven-a-side game one day is a flag flipped
 * here plus the formations that game needs — not a second screen.
 *
 * `teamSize` is written out rather than imported from constants.js on purpose.
 * It is a claim ABOUT the game the button starts, and the test that holds it
 * against TEAM_SIZE is what stops this list quietly lying about it.
 */
export const VARIANTS = [
  {
    id: '7',
    label: '7 Player',
    note: 'Three linemen, two receivers, a quarterback and a back.',
    teamSize: 7,
    available: true,
  },
  {
    id: '11',
    label: '11 Player',
    note: 'The full field. Not built yet.',
    teamSize: 11,
    available: false,
  },
];

/** The variant with this id, or null — an id from a button is still a string a stranger could have typed. */
export function getVariant(id) {
  return VARIANTS.find((v) => v.id === id) ?? null;
}

/** Whether pressing this id should start a game. The one gate; the disabled button is only the picture of it. */
export function isPlayable(id) {
  const v = getVariant(id);
  return v !== null && v.available;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/variants.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: **324 passing**, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add lib/game/variants.js test/game/variants.test.js && git commit -m "Add the list of games the home screen can deal"
```

---

### Task 2: The home screen markup

**Files:**
- Create: `lib/game/home.js`
- Test: `test/game/home.test.js`

**Interfaces:**
- Consumes: `VARIANTS` from `lib/game/variants.js` (Task 1); `escapeText` from `lib/field/escape.js`.
- Produces:
  - `homeMarkup(variants = VARIANTS): string` — the whole inside of `#home`.
  - `COMING_SOON: string` — the words appended to an unplayable variant's label.

- [ ] **Step 1: Write the failing test**

Create `test/game/home.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeMarkup, COMING_SOON } from '../../lib/game/home.js';
import { VARIANTS } from '../../lib/game/variants.js';

test('the screen names the game and offers one button per variant', () => {
  const html = homeMarkup();
  assert.ok(html.includes('Football By Turn'), 'the game is named');
  assert.equal((html.match(/class="home-choice"/g) || []).length, VARIANTS.length);
  for (const v of VARIANTS) {
    assert.ok(html.includes(`data-variant="${v.id}"`), `a button for ${v.id}`);
    assert.ok(html.includes(v.label), `the label for ${v.id}`);
  }
});

test('the playable variant presses; the one that is not is disabled and says so', () => {
  const html = homeMarkup([
    { id: 'a', label: 'Ready', note: 'now', teamSize: 7, available: true },
    { id: 'b', label: 'Later', note: 'not now', teamSize: 11, available: false },
  ]);
  assert.match(html, /data-variant="a"(?![^>]*disabled)/, 'the playable one is pressable');
  assert.match(html, /data-variant="b"[^>]*disabled/, 'the other one is not');
  assert.ok(html.includes(`Later — ${COMING_SOON}`), 'and says why');
  assert.ok(!html.includes(`Ready — ${COMING_SOON}`), 'which the playable one does not');
});

test('text with markup in it is escaped rather than written through', () => {
  const html = homeMarkup([
    { id: 'x', label: '<b>7</b>', note: 'a "note" & more', teamSize: 7, available: true },
  ]);
  assert.ok(!html.includes('<b>'), 'no tag survives');
  assert.ok(html.includes('&lt;b&gt;7&lt;/b&gt;'));
  assert.ok(html.includes('&quot;note&quot; &amp; more'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/home.test.js`
Expected: FAIL — `Cannot find module .../lib/game/home.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/home.js`:

```js
/**
 * The home screen, as a markup string — the same discipline render.js follows
 * for the board, and for the same reason: `node --test` has no DOM, so the
 * only way to test what the page says is to build it as text. app/home.js
 * writes this into the page and listens for the press.
 *
 * `variants` is a parameter rather than a straight import so a test can hand
 * it a list of its own; the default is the real one, which is what the app
 * uses.
 */
import { escapeText } from '../field/escape.js';
import { VARIANTS } from './variants.js';

/** What an unplayable variant's button says after its name. */
export const COMING_SOON = 'coming soon';

function choiceMarkup(variant) {
  const label = variant.available
    ? escapeText(variant.label)
    : `${escapeText(variant.label)} — ${COMING_SOON}`;
  return `<button class="home-choice" type="button" data-variant="${escapeText(variant.id)}"`
    + `${variant.available ? '' : ' disabled'}>`
    + `<span class="home-choice-label">${label}</span>`
    + `<span class="home-choice-note">${escapeText(variant.note)}</span>`
    + '</button>';
}

export function homeMarkup(variants = VARIANTS) {
  return '<h1>Football By Turn</h1>'
    + '<p class="home-blurb">Draw where your players run, half a second at a time.'
    + ' Pick a game.</p>'
    + `<div class="home-choices">${variants.map(choiceMarkup).join('')}</div>`;
}
```

`data-variant` comes before `disabled` in the button tag, which is what the second test's lookahead reads. Keep that order.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/home.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: **327 passing**, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add lib/game/home.js test/game/home.test.js && git commit -m "Build the home screen's markup from the variant list"
```

---

### Task 3: The screen itself — land on it, and start the seven-a-side game

**Files:**
- Create: `app/home.js`
- Modify: `index.html` (whole file given below)
- Modify: `app/main.js:673-676` (the four bootstrap lines at the very bottom)
- Test: none automated — there is no DOM in `node --test`. Step 5 is a browser script.

**Interfaces:**
- Consumes: `homeMarkup()` from `lib/game/home.js` (Task 2); `isPlayable()` from `lib/game/variants.js` (Task 1).
- Produces: `startGame(): void`, exported from `app/main.js`. Starts a fresh drive; safe to call more than once. Task 4 widens it to `startGame({ onExit }): void`.

- [ ] **Step 1: Give `app/main.js` a start function instead of a bootstrap**

The file currently *ends* with these four lines (`app/main.js:673-676`):

```js
attachInput(board, { hitTest, onGesture, onDragPreview });
rebuildBoard();
paint();
say('Drag your players, then open the Coaches Menu to run the turn.');
```

Replace exactly those four lines with:

```js
/**
 * Start a drive. app/home.js calls this when a coach picks a game off the home
 * screen — the first press imports this module and lands here, and every press
 * after a trip home lands here again. That is why the pointer plumbing is
 * attached once and the state is built fresh every time: the listeners on the
 * board (and on the menu's buttons, registered above at module scope) belong to
 * the module, and a second set of them would run every gesture twice.
 *
 * startNewGame() is the whole of a fresh drive — it cancels any pending
 * advance, drops reposition mode, builds the state, rebuilds the board and
 * paints. The only thing said differently here is the opening line, which is
 * an instruction rather than a score report.
 */
let inputAttached = false;

export function startGame() {
  if (!inputAttached) {
    attachInput(board, { hitTest, onGesture, onDragPreview });
    inputAttached = true;
  }
  startNewGame();
  say('Drag your players, then open the Coaches Menu to run the turn.');
}
```

Nothing else in `app/main.js` moves. Every other statement in the file is a declaration or a listener registration, and those are still meant to run on import.

- [ ] **Step 2: Write `app/home.js`**

Create it:

```js
/**
 * The home screen: what a coach lands on, and the only script the page loads.
 * The game is import()ed the first time somebody picks one off it, so nothing
 * about a drive — no state, no board, no listeners — exists until one is asked
 * for.
 *
 * The markup comes from lib/game/home.js as a string, the same way the board's
 * does. This file only writes it into the page and listens for the press.
 */
import { homeMarkup } from '../lib/game/home.js';
import { isPlayable } from '../lib/game/variants.js';

const home = document.getElementById('home');
const board = document.getElementById('board');

// The game module, once it has been asked for. main.js registers its listeners
// at module scope, so it is imported exactly once however many drives get
// played; startGame() is what every visit after the first calls.
let game = null;

function showHome() {
  board.hidden = true;
  home.hidden = false;
}

async function start(variantId) {
  // The unplayable button is disabled in the markup; this is that same rule
  // said again, because a disabled button is a picture and this is the gate.
  if (!isPlayable(variantId)) return;
  home.hidden = true;
  board.hidden = false;
  game ??= await import('./main.js');
  game.startGame();
}

home.innerHTML = homeMarkup();
// One listener on the section rather than one per button: the buttons are
// written in as markup, so matching on the way up means there is nothing to
// re-bind if the list of games ever changes.
home.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-variant]');
  if (btn) start(btn.dataset.variant);
});
showHome();
```

- [ ] **Step 3: Rewrite `index.html`**

The whole file, after the change:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Football By Turn</title>
  <style>
    html, body { height: 100%; }
    /* The board owns the viewport; the menu floats above it. */
    body { font-family: system-ui, sans-serif; margin: 0; overflow: hidden; }
    #board { display: block; width: 100vw; height: 100%; touch-action: none; }
    /* Author `#board{display:block}` above would otherwise beat the UA [hidden]
       rule — the same trap the menu buttons below carry a note about. The board
       is hidden until a game is picked off the home screen. */
    #board[hidden] { display: none; }

    /* The home screen owns the whole viewport until a game starts, and gets it
       back when one is left. It is empty in the markup: app/home.js writes the
       heading and the buttons in from lib/game/home.js. */
    #home {
      position: fixed; inset: 0; box-sizing: border-box; padding: 1.5rem;
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: .75rem; text-align: center; background: #fff;
    }
    #home[hidden] { display: none; }
    #home h1 { font-size: 2rem; margin: 0; }
    .home-blurb { margin: 0 0 .5rem; max-width: 26rem; color: #454545; }
    .home-choices { display: flex; flex-direction: column; gap: .75rem; width: 16rem; }
    .home-choice {
      display: block; width: 100%; padding: .75rem; font: inherit; cursor: pointer;
      border: 2px solid #1a7f37; border-radius: .5rem; background: #1a7f37; color: #fff;
    }
    /* The game that is not built yet reads as a promise rather than a control:
       no fill, no green, and no pointer that suggests it will do something. */
    .home-choice:disabled {
      background: #fff; color: #666; border-color: #ccc; cursor: default;
    }
    .home-choice-label { display: block; font-size: 1.1rem; font-weight: 600; }
    .home-choice-note { display: block; font-size: .85rem; opacity: .85; margin-top: .25rem; }

    /* Padding lives on .menu-body, not the dialog, so a click landing on the
       dialog element itself is unambiguously a backdrop click. */
    #menu { padding: 0; border: 1px solid #999; border-radius: .5rem; }
    #menu::backdrop { background: rgba(0, 0, 0, .45); }
    .menu-body { width: 16rem; padding: 1rem; }
    .menu-body h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
    #hud { margin-bottom: .5rem; }
    .menu-body button { display: block; width: 100%; margin: .25rem 0; padding: .5rem; }
    .menu-body button[hidden] { display: none; } /* author `button{display:block}` above would otherwise beat the UA [hidden] rule */
    .menu-body h2 { font-size: 1rem; margin: 1rem 0 .25rem; }
    .play-slot { font-size: .9rem; }
    #close-menu { margin-top: .75rem; }
  </style>
</head>
<body>
  <section id="home"></section>
  <svg id="board" xmlns="http://www.w3.org/2000/svg" hidden></svg>
  <dialog id="menu">
    <div class="menu-body">
      <h1>Coaches Menu</h1>
      <div id="hud"></div>
      <button id="run">Run Turn</button>
      <button id="clear">Clear Arrows</button>
      <button id="ai">Defense: computer (smart)</button>
      <button id="reposition">Reposition: off</button>
      <button id="debug">Velocity lines: off</button>
      <button id="next" hidden>Next Down</button>
      <button id="new">New Game</button>
      <h2>Plays</h2>
      <button id="save-play">Save current play</button>
      <div id="play-slots"></div>
      <button id="close-menu">Close</button>
    </div>
  </dialog>
  <script type="module" src="app/home.js"></script>
</body>
</html>
```

Three things changed and nothing else: `#home` and its styles plus the `#board[hidden]` rule; `<section id="home">` and `hidden` on the board; and the module script now points at `app/home.js`. `#home` is *not* hidden in the markup — it is what the page opens on, so a broken script leaves an empty white page rather than a blank one that was supposed to be a game.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: **327 passing**, 0 failing — unchanged from Task 2. Nothing in `lib/` moved; this is a check that nothing was knocked over.

- [ ] **Step 5: Verify in the browser**

```bash
npm run serve
```

Open **http://localhost:8080** and confirm, in order:

1. The page opens on the home screen: the heading **Football By Turn**, a green **7 Player** button, and a greyed **11 Player — coming soon** button. No football field is visible.
2. The **11 Player** button does not press — no hover pointer, no reaction to a click.
3. Pressing **7 Player** replaces the screen with the field, both teams lined up, and the message `Drag your players, then open the Coaches Menu to run the turn.` in the end zone.
4. The game plays as it always did: drag a player and a green destination circle appears; press the board's ⏩ button and the turn runs.
5. The browser console is clean — no errors, and in particular no `Cannot find module`.
6. Tab from a fresh load: the first tab stop is **7 Player**; the disabled **11 Player** is skipped. Pressing Enter on **7 Player** starts the game.

- [ ] **Step 6: Commit**

```bash
git add index.html app/home.js app/main.js && git commit -m "Open the page on a home screen that starts the 7-player game"
```

---

### Task 4: Back to Home

**Files:**
- Modify: `index.html` (one button inside `.menu-body`)
- Modify: `app/main.js` (five edits, all given below)
- Modify: `app/home.js` (one line)
- Modify: `README.md` (*How to play*)
- Test: none automated — browser script in Step 6.

**Interfaces:**
- Consumes: `showHome()`, already defined in `app/home.js` (Task 3).
- Produces: `startGame({ onExit }: { onExit?: () => void } = {}): void` — the same function Task 3 exported, now taking the callback the Back to Home button fires. Called with no argument it still starts a drive; the button then does nothing on press but close the menu.

- [ ] **Step 1: Add the button to the menu**

In `index.html`, inside `.menu-body`, immediately after the New Game button:

```html
      <button id="new">New Game</button>
      <button id="home-btn">Back to Home</button>
```

Its id is `home-btn` rather than `home`, which is the section's.

- [ ] **Step 2: Wire it up in `app/main.js`**

Five edits.

**(a)** With the other element lookups, after `const newBtn = ...` (currently `app/main.js:42`):

```js
const homeBtn = document.getElementById('home-btn');
```

**(b)** In `paint()`, after `newBtn.disabled = animating;` (currently `app/main.js:105`):

```js
  homeBtn.disabled = animating;
```

**(c)** In `pressRun()`, in the block that locks the controls before `animate()`, after `newBtn.disabled = true;` (currently `app/main.js:536`):

```js
    homeBtn.disabled = true;
```

**(d)** Change the exported `startGame` at the bottom of the file to take and keep the callback. Replace:

```js
let inputAttached = false;

export function startGame() {
  if (!inputAttached) {
```

with:

```js
let inputAttached = false;
// How the Back to Home button gets back to the screen that started us. It is
// handed in rather than imported so the dependency runs one way only: home.js
// knows about the game, and the game knows nothing about home.
let exitToHome = () => {};

export function startGame({ onExit = () => {} } = {}) {
  exitToHome = onExit;
  if (!inputAttached) {
```

**(e)** Beside the New Game listener (currently `app/main.js:667`), add the handler:

```js
/**
 * Leave the drive and go back to the home screen. Everything that could still
 * fire after we are gone is stopped first: a pending auto-advance would bring
 * up the next down behind a hidden board, and the menu would still be open on
 * the next visit. The board itself is left as it is — startGame() rebuilds it
 * from scratch, so clearing it here would only be a flicker on the way out.
 *
 * Dead while a turn is being drawn, exactly like Next Down and New Game: the
 * animate() loop is still walking the frames, and its finish() would paint over
 * a drive nobody is watching.
 */
function goHome() {
  cancelAutoAdvance();
  stopRepositioning();
  exitToHome();
}

homeBtn.addEventListener('click', () => {
  closeMenu();
  if (animating) return;
  goHome();
});
```

- [ ] **Step 3: Hand the callback in from `app/home.js`**

In `app/home.js`, in `start()`, change:

```js
  game.startGame();
```

to:

```js
  game.startGame({ onExit: showHome });
```

- [ ] **Step 4: Document it in `README.md`**

Two edits, both in *How to play*.

First, insert a paragraph immediately **before** the section's opening line (`Each drive starts 1st and goal from the offense's own 10-yard line...`):

```markdown
The page opens on a **home screen** listing the games it can deal: **7 Player**,
which is the game described below, and **11 Player**, which is greyed out and
marked *coming soon* — the eleven-a-side game is not built yet. Press **7
Player** and the board takes over the screen.
```

Second, add a bullet immediately **after** the `New Game` bullet near the end of the section (`- **New Game** resets everything and starts a fresh drive from the 10.`):

```markdown
- **Back to Home** leaves the drive and returns to the home screen. It abandons
  the play you were in — the next press of **7 Player** starts a fresh drive —
  but your saved plays are kept, the same as they are across a reload. Like
  **Next Down** and **New Game**, it is dead while a turn is being drawn.
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: **327 passing**, 0 failing — unchanged. Nothing in `lib/` moved.

- [ ] **Step 6: Verify in the browser**

```bash
npm run serve
```

Open **http://localhost:8080** and confirm, in order:

1. Press **7 Player**, open the Coaches Menu with the 📋 button: **Back to Home** sits under **New Game**.
2. Press it. The menu closes and the home screen comes back, board gone.
3. Press **7 Player** again: a fresh drive — `Down 1 of 4` in the menu's HUD, everyone back in the drive-start formation, and dragging a player still draws a destination circle. Gestures fire **once**, not twice: drag one player and exactly one destination circle appears, on him.
4. Run a turn, and while the players are still moving, open the menu: **Back to Home** is greyed out alongside **Next Down** and **New Game**. It is live again once the turn lands.
5. Draw some arrows, save a play, go home, start again, open the menu: the saved play is still in its slot.
6. Let a tackle end a play and go home during the four-second pause *before* the next down comes up. The home screen stays put — no next down arrives behind it, and no message flashes.
7. The console is still clean.

- [ ] **Step 7: Commit**

```bash
git add index.html app/main.js app/home.js README.md && git commit -m "Add a Back to Home button to the Coaches Menu"
```

---

## Self-review notes

- **Spec coverage.** "Home screen to land on" → Task 3 (`index.html`, `app/home.js`). "Select between 7 player and 11 player (not available yet)" → Tasks 1 and 2 (the list and the disabled button), rendered in Task 3. "Takes them to that version of the game" → Task 3's `startGame()` for the seven; the eleven is disabled and cannot be taken anywhere, which is the spec. Decision 1 (Back to Home) → Task 4.
- **The one thing this plan changes that nobody asked for** is `app/main.js`'s bootstrap becoming an exported function. It is unavoidable: a game that boots itself on import can be entered once, and Decision 1 asks for it to be entered twice.
- **`startNewGame()` is reused rather than reimplemented** — it already cancels the pending auto-advance, drops reposition mode, rebuilds the board and paints. Task 3's `startGame()` adds only the input plumbing (once) and the opening message.
