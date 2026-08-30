# Coaches Menu Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the board the whole viewport by moving the control panel into a modal overlay opened by pressing a **COACHES MENU** label on the field (where **PRESS BOX** used to be), and move the status message out of the panel and onto the board, drawn inside the end zone on the topmost layer.

**Architecture:** Three separable pieces. (1) `lib/field/field.js` stops hard-coding the sideline legend — the view supplies the text, so the game can say `COACHES MENU` while the standalone diagrams keep saying `PRESS BOX`. (2) `lib/game/render.js` gains two new string renderers and two new layers: a transparent hit rectangle over the sideline label (`game-menu`) and an end-zone message plate (`game-message`), both built the same string-only way as everything else so `node --test` can assert on them without a DOM. (3) `index.html` turns `#panel` into a native `<dialog>` and `app/main.js` wires the board-side click to `showModal()` and routes `say()` into the board layer instead of a DOM node.

**Tech Stack:** Vanilla ES modules, SVG built as strings, native `<dialog>`, `node --test` (no DOM) for `lib/`, manual browser check for `app/` and `index.html`.

**Spec:** this document — the request below is the spec verbatim, plus the three clarifying decisions recorded under *Decisions*.

> I'd like the panel menu on the page to be an overlay instead of taking of main board/game/screen real estate. Please make the "press box" text in the game field be replaced by "coaches menu". When that is pressed. It should display the panel menu overlay.

### Decisions (asked and answered before planning)

1. **Scope:** *Everything* moves into the overlay — the heading, the HUD, and all five buttons. Nothing but the board and the message stays on screen.
2. **Message:** the status text (`TOUCHDOWN!`, `FUMBLE!`, the unplanned-player warning) does **not** go in the overlay. It renders **inside the end zone**, on the **top z layer** of the board.
3. **Overlay mechanics:** native `<dialog>` + `showModal()` — free dimmed backdrop, Esc to close, focus trapped, board inert while open.

### Known consequence of decision 1 (accepted, do not "fix")

**Run Turn** and **Next Down** now live behind the menu, so every turn costs an extra press to open it. This was raised and chosen deliberately. Do not leave a duplicate on-board button "for convenience" — the point of the change is that the board owns the screen.

## Global Constraints

- **Never edit `lib/field/style.js` or `lib/field/geometry.js`.** `.pb`, `.mv` and `#ar` there are shared by the standalone field diagrams; the game overrides them with its own rules in `STYLE_GAME` / `DEFS_GAME`. `STYLE_GAME` is emitted *after* `STYLE` inside one `<style>` element, so a same-specificity rule in `STYLE_GAME` wins.
- **`lib/field/field.js` must keep drawing `PRESS BOX` when no view asks otherwise.** It is shared with the standalone diagrams; the game relabels it through the view, not by changing the default.
- All coordinates written into markup go through `num()` from `lib/field/geometry.js` (2-decimal rounding, no `-0`).
- All caller-supplied text written into markup goes through `escapeText()` from `lib/field/escape.js`.
- Units are SVG units: 1 yard = 3.75 units. The game viewBox is `0 0 270 170`.
- Tests are `node --test`; run the whole suite with `npm test`. **There is no DOM in tests** — anything in `app/` or `index.html` is verified by hand in the browser per Task 4's script.
- The exact green is `#1a7f37`. Use that literal string.
- Existing behaviour that must not regress: the computer-coached team's arrows are never rendered (`renderArrows` filters on `state.aiTeam`); arrows and the drag preview paint beneath the players; the loose-ball overlay stays above the players.

## Sequencing — read this before starting

**Baseline:** `main` at `1417e55` ("Merge pull request #1 … passing/handoffs"), working tree clean apart from this plan file, `npm test` **159 passing**.

Two other efforts have landed on `main` since this plan was first drafted — the velocity-line debug toggle and the whole passing/handoff feature. Both are merged and green. What that means here:

- `index.html` already carries a `#debug` button. Task 4 rewrites that file and **keeps it**, inside the dialog with the other controls.
- `lib/game/render.js` has grown `passArrowMark`, `passArrowTip`, `renderPassArrow`, a `.pass`/`.arh-r` style pair and an `#ar-r` marker. Tasks 2 and 3 only **append** to `STYLE_GAME` and **append** layers to `renderBoardShell`; they touch none of that.
- `app/main.js` has grown a throw gesture, a `showVelocity` flag and penalty messages. Task 4 touches only the element lookups, `say()`, the six button handlers and the bootstrap.
- **Appendix A is dead.** It was the fallback for a velocity toggle that had not landed. It has. Skip it; it is kept only so the plan reads the same as when it was reviewed.

**The penalty messages are why `renderMessage` clamps.** `FLAG: forward pass from beyond the line. 5 yards from the previous spot, loss of down.` wraps to three lines, which is taller than the end zone. The renderer is built to handle that (Task 3) rather than the copy being shortened to fit — **do not edit anyone's message strings in this plan.**

Every commit step below **stages named paths only — never `git add -A`**.

## Reference geometry (already true today — do not change it, just use it)

`gameView(losYard)` from `lib/game/view.js` yields, for every down:

| quantity | value | where it comes from |
|---|---|---|
| `CENTRE_X` | `135` | `lib/field/geometry.js` |
| `SIDELINE_LEFT` / `SIDELINE_RIGHT` | `35` / `235` | `lib/field/geometry.js` |
| `PRESS_BOX_X` | `257` | `lib/field/geometry.js` |
| `view.fieldTopY` | `10` | `MARGIN_TOP` |
| `view.anchorY` | `85` | yard 0 in SVG y |
| goal line, `y(view, GOAL_YARD)` | `122.5` | `85 + 10 * 3.75` |
| end line, `y(view, END_YARD)` | `160` | `85 + 20 * 3.75` |
| `view.height` (viewBox height) | `170` | |

So the end zone is the band `y` 122.5 → 160, and its middle is **`y = 141.25`**. The sideline label sits at `x = 257`, `y = (10 + 160) / 2 = 85`, rotated 90°.

---

## File Structure

- `lib/field/field.js` — **modify**: the sideline legend text comes from `view.sidelineLabel` (default `'PRESS BOX'`, `null` suppresses it) and is escaped. Nothing else changes.
- `lib/game/view.js` — **modify**: `gameView()` returns `sidelineLabel: 'COACHES MENU'`.
- `lib/game/render.js` — **modify**: new constants for the menu hit box and the message plate; `STYLE_GAME` gains `.menu-hit`, `.msg-plate`, `.msg` and a `.pb` override; new exported `menuButtonMark()`, `wrapWords()`, `renderMessage()`; `renderBoardShell` emits the `game-menu` and `game-message` layers.
- `index.html` — **modify**: `#panel` becomes `<dialog id="menu">`; the board fills the viewport; `#message` is deleted (it lives on the board now); `#debug` moves into the dialog with the other buttons.
- `app/main.js` — **modify**: drop the `#message` DOM node in favour of a `messageText` module variable painted into `game-message`; open the dialog from a delegated board click; every action button closes it. No message copy changes.
- `test/field/field.test.js` — **create**: first test file for `lib/field/`, covering the sideline label.
- `test/game/render.test.js` — **modify**: layer-list assertions, menu button, message renderer, word wrap.
- `README.md` — **modify**: describe the Coaches Menu and the on-field message.

Task 1 → Task 2 → Task 3 are independent of each other and could be done in any order; Task 4 depends on all three.

---

## Task 1: The sideline legend text comes from the view

Right now `lib/field/field.js` writes the literal string `PRESS BOX`. The game needs `COACHES MENU` there, but `field.js` is shared with the standalone field diagrams, which must keep saying `PRESS BOX`. So the *view* supplies the label.

**Files:**
- Modify: `lib/field/field.js` (the legend block at the end of `renderField`)
- Modify: `lib/game/view.js` (`gameView`)
- Test: `test/field/field.test.js` (create), `test/game/render.test.js` (modify)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `renderField(view)` now honours `view.sidelineLabel` — a string to use instead of `PRESS BOX`, or `null` to draw no legend at all. `undefined`/absent means the `PRESS BOX` default. `gameView(losYard)` now returns an object that also has `sidelineLabel: 'COACHES MENU'`.

- [ ] **Step 1: Write the failing test**

Create `test/field/field.test.js` with exactly this content. (`test/field/` does not exist yet; create the directory. `node --test` discovers `**/*.test.js` from the repo root, so no config change is needed.)

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test test/field/field.test.js
```

Expected: FAIL. `a view can relabel the sideline legend` fails because the label is hard-coded; `a view can drop the sideline legend entirely` fails for the same reason; `the game view labels the sideline COACHES MENU` fails with `undefined !== 'COACHES MENU'`. The first test (`PRESS BOX`) already passes — that is the regression guard.

- [ ] **Step 3: Make the legend come from the view**

In `lib/field/field.js`, replace the final legend block — currently:

```js
  // Which sideline the press box is on orients the whole diagram, so it is
  // part of the field rather than an annotation.
  const pressBoxY = num((topY + bottomY) / 2);
  parts.push(
    `<text x="${num(PRESS_BOX_X)}" y="${pressBoxY}" class="pb" transform="rotate(90 ${num(PRESS_BOX_X)} ${pressBoxY})">PRESS BOX</text>`,
  );
```

with:

```js
  // Which sideline the press box is on orients the whole diagram, so it is
  // part of the field rather than an annotation. A view may relabel it — the
  // game turns this legend into its Coaches Menu button — or pass null to drop
  // it. Absent means PRESS BOX, so the standalone diagrams are untouched.
  const sidelineLabel =
    view.sidelineLabel === undefined ? 'PRESS BOX' : view.sidelineLabel;
  if (sidelineLabel !== null) {
    const labelY = num((topY + bottomY) / 2);
    parts.push(
      `<text x="${num(PRESS_BOX_X)}" y="${labelY}" class="pb" transform="rotate(90 ${num(PRESS_BOX_X)} ${labelY})">${escapeText(sidelineLabel)}</text>`,
    );
  }
```

`escapeText` is already imported at the top of the file — no new import.

- [ ] **Step 4: Have the game view ask for COACHES MENU**

In `lib/game/view.js`, inside the object `gameView` returns, add one property. Put it next to `goalPosts` so the field-furniture keys stay together:

```js
    goalPosts: true,
    sidelineLabel: 'COACHES MENU',
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS, 164 tests (159 existing + 5 new), 0 failures.

- [ ] **Step 6: Commit**

```bash
git add lib/field/field.js lib/game/view.js test/field/field.test.js && git commit -m "feat: the sideline legend text comes from the view, and the game says COACHES MENU"
```

---

## Task 2: A pressable hit target over the COACHES MENU label

The label is 8.5px rotated text in the right margin — a fiddly thing to tap, and `<text>` only hit-tests on the glyphs themselves. So the game paints a transparent rectangle over the label's column in a layer of its own, and marks it `data-menu-button` so `app/main.js` can find it by delegation after every board rebuild.

The rectangle lives in the *game*, not in `lib/field/`: turning field furniture into a button is a game concern.

**Files:**
- Modify: `lib/game/render.js` (`STYLE_GAME`, new constants, new `menuButtonMark()`, `renderBoardShell`)
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: `PRESS_BOX_X` (`257`) and `num()` from `lib/field/geometry.js`; `gameView`, `END_YARD` from `lib/game/view.js`; `y` from `lib/field/geometry.js`.
- Produces: `menuButtonMark(): string` — the transparent `<rect data-menu-button="1" class="menu-hit" .../>`, exported for testing. `renderBoardShell` now emits `<g id="game-menu">` containing it, after `game-overlay`.

- [ ] **Step 1: Write the failing test**

Add these two tests to the end of `test/game/render.test.js`, and add `menuButtonMark` to the existing import list from `../../lib/game/render.js` at the top of that file:

```js
test('the COACHES MENU label carries a transparent hit target of its own', () => {
  const { markup } = renderBoardShell(0);
  assert.ok(markup.includes('>COACHES MENU</text>'), 'the field says COACHES MENU');
  assert.ok(markup.includes('id="game-menu"'), 'the button gets a layer of its own');
  assert.equal(
    menuButtonMark(),
    '<rect data-menu-button="1" class="menu-hit" x="247" y="37" width="20" height="96"/>',
  );
  assert.ok(STYLE_GAME.includes('.menu-hit{fill:transparent;pointer-events:all;cursor:pointer}'));
  assert.ok(STYLE_GAME.includes('.pb{fill:#1a7f37;cursor:pointer}'), 'the label reads as pressable');
});

test('the menu hit target sits over the label and inside the frame', () => {
  const { viewBox } = renderBoardShell(0);
  const [, , w, h] = viewBox.split(' ').map(Number);
  const m = menuButtonMark().match(/x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/);
  const [x, y0, rw, rh] = m.slice(1).map(Number);
  assert.ok(x < 257 && x + rw > 257, 'straddles the label column at x=257');
  assert.ok(x + rw <= w, 'inside the viewBox width');
  assert.ok(y0 > 0 && y0 + rh <= h, 'inside the viewBox height');
  assert.ok(y0 < 85 && y0 + rh > 85, 'straddles the label centre at y=85');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test test/game/render.test.js
```

Expected: FAIL with `SyntaxError` / `menuButtonMark is not defined` — the import does not resolve because `render.js` does not export it yet.

- [ ] **Step 3: Add the constants, the style rules, and the mark**

In `lib/game/render.js`:

(a) Extend the existing import from `../field/geometry.js`. The file currently has two separate imports from that module (`VIEWBOX_WIDTH` on one line, `num` on another); leave that as it is and add the two new names to the first one:

```js
import { VIEWBOX_WIDTH, PRESS_BOX_X, y as yardToY } from '../field/geometry.js';
```

and extend the `./view.js` import:

```js
import { gameView, END_YARD } from './view.js';
```

(b) Add the constants just below the existing imports:

```js
/**
 * The pressable area over the sideline label. `<text>` only hit-tests where
 * its glyphs are, and 8.5px rotated type in the margin is a hard tap — so the
 * button is a transparent rectangle straddling the label's column, wide and
 * tall enough to hit with a thumb. Half-extents, in SVG units.
 */
const MENU_HIT_HALF_W = 10;
const MENU_HIT_HALF_H = 48;
```

(c) Append to the `STYLE_GAME` array, before the closing `].join('')`:

```js
  // `fill:transparent` still hit-tests under the default `visiblePainted`, but
  // `pointer-events:all` says so outright rather than relying on that.
  '.menu-hit{fill:transparent;pointer-events:all;cursor:pointer}',
  // Overrides `.pb` from the shared stylesheet — same specificity, and
  // STYLE_GAME is emitted after STYLE inside one <style>, so this wins. The
  // legend is a button in the game, so it is green like the plan arrows and
  // takes the pointer cursor; the standalone diagrams keep the grey.
  '.pb{fill:#1a7f37;cursor:pointer}',
```

(d) Add the renderer, next to `arrowMark`:

```js
/**
 * The Coaches Menu button: an invisible rectangle over the sideline label.
 * Marked with `data-menu-button` rather than an id because app/main.js binds
 * the click on the board and matches on the way up — `rebuildBoard()` throws
 * every node under the <svg> away on each new down, and a listener bound to
 * this rect would go with it.
 */
export function menuButtonMark() {
  const view = gameView(0);
  const midY = (view.fieldTopY + yardToY(view, END_YARD)) / 2;
  return (
    `<rect data-menu-button="1" class="menu-hit"` +
    ` x="${num(PRESS_BOX_X - MENU_HIT_HALF_W)}" y="${num(midY - MENU_HIT_HALF_H)}"` +
    ` width="${num(MENU_HIT_HALF_W * 2)}" height="${num(MENU_HIT_HALF_H * 2)}"/>`
  );
}
```

(e) In `renderBoardShell`, add the layer after `game-overlay`:

```js
      `<g id="game-players"></g><g id="game-overlay"></g>` +
      `<g id="game-menu">${menuButtonMark()}</g>`,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS, 166 tests (164 + 2 new), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add lib/game/render.js test/game/render.test.js && git commit -m "feat: the COACHES MENU label gets a transparent hit target"
```

---

## Task 3: The status message renders in the end zone

The message leaves the panel and goes on the board, centred in the end zone (nobody stands there), on the topmost layer, on a white plate so it reads over the hatch pattern.

SVG does not wrap text, so wrapping is a pure function of its own — which is also the only part worth unit-testing hard.

**Files:**
- Modify: `lib/game/render.js` (`STYLE_GAME`, message constants, `wrapWords()`, `renderMessage()`, `renderBoardShell`)
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: `CENTRE_X`, `SIDELINE_LEFT`, `SIDELINE_RIGHT`, `num`, `y as yardToY` from `lib/field/geometry.js`; `escapeText` from `lib/field/escape.js`; `gameView`, `GOAL_YARD`, `END_YARD` from `lib/game/view.js`.
- Produces:
  - `wrapWords(text: string, maxChars: number): string[]` — greedy word wrap. Empty/whitespace-only text gives `[]`. A single word longer than `maxChars` gets its own over-long line rather than being broken.
  - `renderMessage(text: string): string` — the plate plus the wrapped `<text>`, or `''` for empty text. `app/main.js` writes this into the `game-message` layer.
  - `renderBoardShell` emits `<g id="game-message"></g>` as the last (topmost) layer.

- [ ] **Step 1: Write the failing test**

Add these tests to the end of `test/game/render.test.js`, and add `wrapWords, renderMessage` to the existing import list from `../../lib/game/render.js`:

```js
test('wrapWords breaks greedily at the character budget', () => {
  assert.deepEqual(wrapWords('', 34), []);
  assert.deepEqual(wrapWords('   ', 34), []);
  assert.deepEqual(wrapWords('TOUCHDOWN!', 34), ['TOUCHDOWN!']);
  assert.deepEqual(
    wrapWords('Fumble recovered by the defense. Game over.', 34),
    ['Fumble recovered by the defense.', 'Game over.'],
  );
  // A word that cannot fit gets a line to itself rather than being broken.
  assert.deepEqual(wrapWords('a supercalifragilistic b', 8), ['a', 'supercalifragilistic', 'b']);
  // Runs of whitespace collapse.
  assert.deepEqual(wrapWords('a   b', 34), ['a b']);
});

test('an empty message draws nothing', () => {
  assert.equal(renderMessage(''), '');
  assert.equal(renderMessage('   '), '');
});

test('a one-line message is a plate and a tspan centred in the end zone', () => {
  assert.equal(
    renderMessage('TOUCHDOWN!'),
    '<rect class="msg-plate" x="104" y="129.75" width="62" height="23" rx="2"/>' +
    '<text class="msg"><tspan x="135" y="144">TOUCHDOWN!</tspan></text>',
  );
});

test('a two-line message stacks tspans and grows the plate, staying in the end zone', () => {
  const svg = renderMessage('Fumble recovered by the defense. Game over.');
  assert.equal((svg.match(/<tspan /g) || []).length, 2);
  assert.ok(svg.includes('<tspan x="135" y="138.5">Fumble recovered by the defense.</tspan>'));
  assert.ok(svg.includes('<tspan x="135" y="149.5">Game over.</tspan>'));
  const plate = svg.match(/y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/);
  const [py, pw, ph] = plate.slice(1).map(Number);
  assert.ok(py >= 122.5, 'the plate starts at or below the goal line');
  assert.ok(py + ph <= 160, 'and ends at or above the end line');
  assert.ok(pw <= 200, 'and never runs wider than the sidelines');
});

test('a long message grows past the end zone but never off the board', () => {
  // The real penalty message: three lines, taller than the 37.5-unit end zone.
  const flag = 'FLAG: forward pass from beyond the line. 5 yards from the previous spot, loss of down.';
  const svg = renderMessage(flag);
  assert.equal((svg.match(/<tspan /g) || []).length, 3, 'three lines at this budget');
  const [py, ph] = svg.match(/y="([-\d.]+)" width="[-\d.]+" height="([-\d.]+)"/).slice(1).map(Number);
  assert.ok(py > 0, 'still on the board at the top');
  assert.ok(py + ph <= 170, 'and still on the board at the bottom');
  // Ten lines could not be centred and stay on the board; the clamp catches it.
  const huge = renderMessage(new Array(40).fill('word').join(' '));
  const [hy, hh] = huge.match(/y="([-\d.]+)" width="[-\d.]+" height="([-\d.]+)"/).slice(1).map(Number);
  assert.ok(hy >= 0 && hy + hh <= 170, 'clamped inside the viewBox');
});

test('message text is escaped', () => {
  assert.ok(renderMessage("QB can't do that.").includes('can&#39;t'));
  assert.ok(renderMessage('A & B').includes('A &amp; B'));
});

test('the message layer is the topmost layer on the board', () => {
  const { markup } = renderBoardShell(0);
  const at = (id) => markup.indexOf(`id="${id}"`);
  assert.ok(at('game-message') > -1, 'the message has a layer of its own');
  assert.ok(at('game-message') > at('game-overlay'), 'above the loose-ball overlay');
  assert.ok(at('game-message') > at('game-menu'), 'and above the menu button');
  // Both message rules must be click-through — the plate covers the end zone.
  // Checked per-rule on purpose: `pointer-events:none` is already in STYLE_GAME
  // for .gp-role and .vel, so a bare substring check would pass without them.
  const msgRules = STYLE_GAME.split('}').filter((r) => r.startsWith('.msg'));
  assert.equal(msgRules.length, 2, '.msg-plate and .msg');
  for (const rule of msgRules) assert.ok(rule.includes('pointer-events:none'), rule);
});
```

Also update the existing layer test near the top of the file. Replace:

```js
  for (const id of ['game-field', 'game-arrows', 'game-players', 'game-overlay']) {
```

with:

```js
  for (const id of ['game-field', 'game-arrows', 'game-preview', 'game-players', 'game-overlay', 'game-menu', 'game-message']) {
```

and change that test's name from `'the board shell has the field and three empty game layers'` to `'the board shell has the field and every game layer'`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test test/game/render.test.js
```

Expected: FAIL — `wrapWords is not defined` / `renderMessage is not defined` from the import.

- [ ] **Step 3: Implement the message renderer**

In `lib/game/render.js`:

(a) Extend the geometry import again so it reads:

```js
import { VIEWBOX_WIDTH, PRESS_BOX_X, CENTRE_X, SIDELINE_LEFT, SIDELINE_RIGHT, y as yardToY } from '../field/geometry.js';
```

extend the view import:

```js
import { gameView, GOAL_YARD, END_YARD } from './view.js';
```

and add:

```js
import { escapeText } from '../field/escape.js';
```

(b) Add the constants below the menu-hit constants:

```js
/**
 * The message plate. SVG does not wrap text, so the wrap is done here by
 * character count against a budget that fits the end zone: at 9px the plate
 * is sized by an approximate advance width, which is why MESSAGE_CHAR_WIDTH
 * is a measured-ish constant rather than derived from anything. Keep the
 * copy in app/main.js short enough for two lines — three would spill past the
 * goal line and the end line.
 */
const MESSAGE_MAX_CHARS = 34;
const MESSAGE_LINE_HEIGHT = 11;
const MESSAGE_CHAR_WIDTH = 5;
const MESSAGE_PAD = 6;
```

(c) Append to `STYLE_GAME`, before the closing `].join('')`:

```js
  // The plate sits on the hatched end zone, so it needs a ground of its own.
  // Both parts are click-through: the board underneath still takes drags.
  '.msg-plate{fill:#ffffff;fill-opacity:.92;stroke:#000;stroke-width:.6;pointer-events:none}',
  '.msg{font:bold 9px system-ui,sans-serif;text-anchor:middle;fill:#000;pointer-events:none}',
```

(d) Add the two functions, after `arrowMark`:

```js
/**
 * Greedy word wrap to a character budget. A word longer than the budget gets
 * a line to itself rather than being broken: hyphenating "TOUCHDOWN!" would
 * read worse than letting it run a little wide.
 */
export function wrapWords(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The status message, drawn on a plate centred in the end zone — the one
 * patch of the board no player runs through, so it never covers the play.
 * app/main.js writes this into `game-message`, which is the topmost layer.
 */
export function renderMessage(text) {
  const lines = wrapWords(text, MESSAGE_MAX_CHARS);
  if (lines.length === 0) return '';

  const view = gameView(0);
  const midY = (yardToY(view, GOAL_YARD) + yardToY(view, END_YARD)) / 2;
  const blockHeight = lines.length * MESSAGE_LINE_HEIGHT;

  const widest = Math.max(...lines.map((l) => l.length));
  const plateW = Math.min(
    widest * MESSAGE_CHAR_WIDTH + MESSAGE_PAD * 2,
    SIDELINE_RIGHT - SIDELINE_LEFT,
  );
  const plateH = blockHeight + MESSAGE_PAD * 2;

  // Centred in the end zone, but clamped to the board. A three-line message —
  // the illegal-pass penalty is one — is taller than the end zone, so it grows
  // up over the goal line rather than sliding off the bottom edge. Messages are
  // not shortened to fit: the renderer is the thing that has to cope.
  const plateY = Math.max(
    MESSAGE_PAD / 2,
    Math.min(midY - plateH / 2, view.height - plateH - MESSAGE_PAD / 2),
  );

  // Baselines sit three quarters down each line box, which reads as centred.
  const firstBaseline = plateY + MESSAGE_PAD + MESSAGE_LINE_HEIGHT * 0.75;
  const tspans = lines
    .map((l, i) => `<tspan x="${num(CENTRE_X)}" y="${num(firstBaseline + i * MESSAGE_LINE_HEIGHT)}">${escapeText(l)}</tspan>`)
    .join('');

  return (
    `<rect class="msg-plate" x="${num(CENTRE_X - plateW / 2)}" y="${num(plateY)}"` +
    ` width="${num(plateW)}" height="${num(plateH)}" rx="2"/>` +
    `<text class="msg">${tspans}</text>`
  );
}
```

(e) In `renderBoardShell`, make the message layer the last one:

```js
      `<g id="game-players"></g><g id="game-overlay"></g>` +
      `<g id="game-menu">${menuButtonMark()}</g>` +
      `<g id="game-message"></g>`,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS, 173 tests (166 + 7 new), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add lib/game/render.js test/game/render.test.js && git commit -m "feat: the status message renders on a plate in the end zone"
```

---

## Task 4: The panel becomes a modal Coaches Menu overlay

The last piece, and the only one with no automated coverage — there is no DOM in this repo's tests, so it is verified by hand against the checklist in Step 7. Do not add a DOM test framework for this.

**Files:**
- Modify: `index.html`
- Modify: `app/main.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `renderMessage` (Task 3) and the `game-message` / `game-menu` layers and `data-menu-button` attribute (Tasks 2 and 3).
- Produces: nothing further downstream — this is the top of the stack.

- [ ] **Step 1: Rewrite `index.html`**

Replace the whole file with:

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
    #board { display: block; width: 100vw; height: 100vh; touch-action: none; }

    /* Padding lives on .menu-body, not the dialog, so a click landing on the
       dialog element itself is unambiguously a backdrop click. */
    #menu { padding: 0; border: 1px solid #999; border-radius: .5rem; }
    #menu::backdrop { background: rgba(0, 0, 0, .45); }
    .menu-body { width: 16rem; padding: 1rem; }
    .menu-body h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
    #hud { margin-bottom: .5rem; }
    .menu-body button { display: block; width: 100%; margin: .25rem 0; padding: .5rem; }
    .menu-body button[hidden] { display: none; } /* author `button{display:block}` above would otherwise beat the UA [hidden] rule */
    #close-menu { margin-top: .75rem; }
  </style>
</head>
<body>
  <svg id="board" xmlns="http://www.w3.org/2000/svg"></svg>
  <dialog id="menu">
    <div class="menu-body">
      <h1>Coaches Menu</h1>
      <div id="hud"></div>
      <button id="run">Run Turn</button>
      <button id="clear">Clear Arrows</button>
      <button id="ai">Defense: computer</button>
      <button id="debug">Velocity lines: off</button>
      <button id="next" hidden>Next Down</button>
      <button id="new">New Game</button>
      <button id="close-menu">Close</button>
    </div>
  </dialog>
  <script type="module" src="app/main.js"></script>
</body>
</html>
```

Note what left: the `#message` div (it is on the board now) and the `#panel` wrapper. Note what stayed: `#debug`, from the velocity plan — it is a control, so it lives in the menu with the rest.

- [ ] **Step 2: Point `app/main.js` at the new DOM**

Add `renderMessage` to the existing import from `../lib/game/render.js`:

```js
import {
  renderBoardShell, renderPlayers, renderArrows, renderLooseBall, looseBallMark, arrowMark,
  renderMessage,
} from '../lib/game/render.js';
```

Replace the element lookups. Currently:

```js
const hud = document.getElementById('hud');
const message = document.getElementById('message');
```

becomes:

```js
const hud = document.getElementById('hud');
const menu = document.getElementById('menu');
const closeMenuBtn = document.getElementById('close-menu');
```

Leave `const debugBtn = document.getElementById('debug');` exactly where it is — that button moved into the overlay, but its id did not change.

- [ ] **Step 3: Route `say()` onto the board**

Replace the existing `say`:

```js
function say(text) {
  message.textContent = text;
}
```

with a module variable plus a painter. Put `let messageText = '';` beside the other module-level `let`s (next to `pendingWarning`), and:

```js
/**
 * The message lives on the board now, in the end zone. It is kept in a
 * variable rather than read back out of the DOM because `rebuildBoard()`
 * throws the whole layer away on every new down — `paint()` repaints it from
 * here afterwards.
 */
function drawMessage() {
  layer('game-message').clear().svg(renderMessage(messageText));
}

function say(text) {
  messageText = text;
  drawMessage();
}
```

and add `drawMessage();` as the last line of `paint()`, after `nextBtn.hidden = ...`. `say()` repaints on its own too, because `finish()` calls `say()` *after* `paint()`.

- [ ] **Step 4: Wire the overlay open and close**

Add, after the `attachInput(...)` line is defined but before the bottom bootstrap block — put this block just above the existing `runBtn.addEventListener` so all the wiring reads together:

```js
function openMenu() {
  if (!menu.open) menu.showModal();
}

function closeMenu() {
  if (menu.open) menu.close();
}

// The hit rect is re-created by every rebuildBoard(), so the listener goes on
// the board and matches on the way up rather than on the rect itself.
board.on('click', (e) => {
  if (e.target.closest && e.target.closest('[data-menu-button]')) openMenu();
});

// Content is inside .menu-body, so a click whose target IS the dialog landed
// on the backdrop. Esc is handled natively by showModal().
menu.addEventListener('click', (e) => {
  if (e.target === menu) closeMenu();
});

closeMenuBtn.addEventListener('click', closeMenu);
```

- [ ] **Step 5: Close the menu on every action**

Every one of the six action buttons changes the board, and the board is behind the backdrop — including the status message, which is now on the field. So each handler dismisses the menu first. Add `closeMenu();` as the **first statement** in the body of each of the six existing handlers: `runBtn`, `clearBtn`, `aiBtn`, `debugBtn`, `nextBtn`, `newBtn`. For example `runBtn` becomes:

```js
runBtn.addEventListener('click', () => {
  closeMenu();
  if (animating || state.phase !== 'planning') return;
  ...
```

**Change no message copy.** Task 3's renderer handles three-line messages; the unplanned-player warning and the two `FLAG:` penalty strings stay exactly as they are.

- [ ] **Step 6: Give the board an opening message**

At the very bottom of `app/main.js`, the bootstrap currently reads:

```js
attachInput(board, { hitTest, onGesture, onDragPreview });
rebuildBoard();
paint();
```

Add a fourth line — `say()` must come after `rebuildBoard()`, because the layer it writes into does not exist until then:

```js
attachInput(board, { hitTest, onGesture, onDragPreview });
rebuildBoard();
paint();
say('Drag your players, then open the Coaches Menu to run the turn.');
```

- [ ] **Step 7: Verify by hand in the browser**

The unit suite cannot see any of this. Start the server:

```bash
npm run serve
```

Open http://localhost:8080 and check every line:

1. The field fills the window. There is no panel taking width on the right, and the page does not scroll.
2. The right margin reads **COACHES MENU** in green, running vertically. It does not read PRESS BOX anywhere.
3. The opening message — *"Drag your players, then open the Coaches Menu to run the turn."* — is on a white plate inside the hatched end zone, on two lines, not overlapping any player.
4. Hovering the COACHES MENU label shows a pointer cursor, and the cursor stays a pointer a little to either side of the glyphs (that is the hit rect).
5. Clicking COACHES MENU opens the overlay: dimmed backdrop, the heading **Coaches Menu**, the HUD line, and Run Turn / Clear Arrows / Defense / Velocity lines / New Game. Next Down is hidden.
6. Pressing **Esc** closes it. Clicking the dimmed area outside the panel closes it. Clicking inside the panel — on its padding, not just a button — does **not** close it.
7. With the overlay open, dragging on the board does nothing (the modal makes it inert). Close the overlay; dragging a player draws a green arrow again.
8. Draw one arrow, open the menu, press **Run Turn**. The overlay closes, the turn animates, and the outcome message (`Tackled!`, `FUMBLE! The ball is loose!`, `Out of bounds.` …) appears in the end zone.
9. Press **Run Turn** with players unplanned: the overlay closes and the end zone reads *"N player(s) have no direction set. Press Run Turn again to run anyway."* — three lines, overhanging the goal line and the end line a little, but wholly on the board. Reopen the menu, press Run Turn again — the turn runs.
10. End a play, open the menu: **Next Down** is now visible. Press it. The overlay closes, the board rebuilds at the new line of scrimmage, **and the down message is still showing in the end zone** (this is the `rebuildBoard()` wipe that `paint()`'s `drawMessage()` repairs — if the end zone goes blank here, `drawMessage()` is missing from `paint()`).
11. Press **New Game** from the menu: the board resets and the end zone reads *"New game. 1st and goal from the 10."*
12. Long-press a player you cannot give a special move to; the refusal message (`QB can't do that.` style) renders with a real apostrophe, not `&#39;`.
13. Throw an illegal forward pass (tap the carrier, drag to throw, from beyond the line) and let the down end: the `FLAG:` message renders on three lines and stays on the board. Then run a turn so players are moving, open the menu and press **Velocity lines: off**. The overlay closes, the label will read `on` next time you open it, and blue hairlines are drawn out of the moving players. Press it again to turn them back off.
14. Narrow the window to phone width and re-check 1, 3, and 5: the board letterboxes rather than clipping, and the overlay stays on screen.

Stop the server when done.

- [ ] **Step 8: Update the README**

In `README.md`, under **How to play**, insert this as the first bullet of that list, before the "Drag a player" bullet:

```markdown
- All the controls live in the **Coaches Menu**. Press the vertical green
  **COACHES MENU** text down the right-hand side of the field to open it; press
  Esc, click outside it, or press **Close** to dismiss it. Every button in it
  closes the menu as it acts, so you can watch the board. The play's status —
  the warning about unplanned players, `TOUCHDOWN!`, `FUMBLE!` — is drawn on the
  field itself, in the end zone, so it stays readable with the menu shut.
```

Then in the same section, change the sentence "If any player doesn't have an arrow set yet, you'll get a warning naming how many; press **Run Turn** again to run the turn anyway." — it is still accurate, so leave the wording, but confirm nothing else in the README describes a side panel. (Search for "panel"; there should be no hits.)

- [ ] **Step 9: Run the full suite one more time**

```bash
npm test
```

Expected: PASS, 173 tests, 0 failures. (Nothing in this task is covered by tests, but this catches an accidental edit to `lib/`.)

- [ ] **Step 10: Commit**

```bash
git add index.html app/main.js README.md && git commit -m "feat: the control panel becomes a modal Coaches Menu overlay"
```

---

## Self-Review

**Spec coverage.**

| Spec requirement | Task |
|---|---|
| Panel is an overlay, not screen real estate | 4 (Steps 1, 4) |
| "PRESS BOX" → "COACHES MENU" | 1 |
| Pressing it displays the overlay | 2 (hit target), 4 Step 4 (wiring) |
| Decision 1 — everything moves into the overlay | 4 Step 1 |
| Decision 2 — messages in the end zone, top z layer | 3 (renderer, layer order), 4 Step 3 (wiring) |
| Decision 3 — modal `<dialog>` | 4 Steps 1 and 4 |

No gaps.

**Placeholder scan.** No TBDs, no "handle edge cases", no "similar to Task N". Every code step carries the literal code. The one step with no code block is Task 4 Step 7, which is a manual verification checklist — deliberately prose, with 13 concrete checks.

**Type consistency.** `menuButtonMark()`, `wrapWords()`, `renderMessage()`, `drawMessage()`, `say()`, `openMenu()`, `closeMenu()` are each named identically everywhere they appear. Layer ids used in tests and in `renderBoardShell` match: `game-field`, `game-arrows`, `game-preview`, `game-players`, `game-overlay`, `game-menu`, `game-message`. `view.sidelineLabel` is the same key in Task 1's `field.js` read, Task 1's `view.js` write, and Task 1's tests. `data-menu-button` matches between Task 2's markup and Task 4's `closest()` selector. Element ids `menu` / `close-menu` / `hud` match between `index.html` and `app/main.js`.

**One consistency note for the implementer:** Tasks 2 and 3 both edit the `../field/geometry.js` import line in `lib/game/render.js`. If the tasks are done in order the line ends up as
`import { VIEWBOX_WIDTH, PRESS_BOX_X, CENTRE_X, SIDELINE_LEFT, SIDELINE_RIGHT, y as yardToY } from '../field/geometry.js';`
with the pre-existing separate `import { num } from '../field/geometry.js';` line left alone. If a task is done out of order, take only the names that task needs.


---

## Appendix A: the velocity toggle button, if it has not landed

Only do this if `grep -c 'id="debug"' index.html` printed `0`. It is Task 4 of `docs/superpowers/plans/2026-08-30-velocity-debug-and-arrow-restyle.md`, restated in full, and it must be finished and committed before Task 4 of this plan begins — otherwise this plan's rewrite of `index.html` drops a button that `app/main.js` will then fail to find.

`lib/game/render.js` already exports `renderPlayers(state, { showVelocity = false } = {})` as of commit `955b220`; this is only the wiring.

- [ ] **A1.** In `index.html`, after the `#ai` button line, add:

```html
    <button id="debug">Velocity lines: off</button>
```

- [ ] **A2.** In `app/main.js`, after `const aiBtn = document.getElementById('ai');` add:

```js
const debugBtn = document.getElementById('debug');
```

and after `let animating = false;` add:

```js
// A debug read-out, not game state: New Game replaces `state` wholesale, and
// having asked to see velocities should survive that.
let showVelocity = false;
```

- [ ] **A3.** In `paint()`, change

```js
  layer('game-players').clear().svg(renderPlayers(state) + renderLooseBall(state));
```

to

```js
  layer('game-players').clear().svg(renderPlayers(state, { showVelocity }) + renderLooseBall(state));
```

and add after the `aiBtn.disabled` line:

```js
  debugBtn.textContent = `Velocity lines: ${showVelocity ? 'on' : 'off'}`;
  debugBtn.disabled = animating;
```

- [ ] **A4.** In the `runBtn` click handler, in the block that disables the controls by hand, add after `aiBtn.disabled = true;`:

```js
    debugBtn.disabled = true;
```

- [ ] **A5.** After the `aiBtn.addEventListener(...)` block, add:

```js
debugBtn.addEventListener('click', () => {
  // Dead while a turn is being drawn, like every other control: paint()
  // rewrites the player layer, which would throw away the transforms the
  // animation loop is driving. The lines a running turn shows are the
  // velocities from the last paint — the read-out refreshes when it lands.
  if (animating) return;
  showVelocity = !showVelocity;
  paint();
});
```

- [ ] **A6.** Verify and commit.

```bash
npm test
```

Expected: PASS, 123 tests, 0 failures (this adds no tests — it is `app/` wiring, which has no DOM harness).

```bash
git add index.html app/main.js && git commit -m "feat: a button toggles the debug velocity lines"
```
