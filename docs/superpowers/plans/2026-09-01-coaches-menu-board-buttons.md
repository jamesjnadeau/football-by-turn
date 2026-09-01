# The coaches menu, out on the board — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put nine more of the Coaches Menu's controls on the board as
quick-press plates — 🧹 🤖 👥 joining the existing column, and 💾 1️⃣–5️⃣ in a
second column beside it — and give every one of those icons to its own button
inside the menu.

**Architecture:** `lib/game/render.js` already keeps the button column as a
table (`FIELD_BUTTONS`) that both the plates and the tutorial's highlight ring
read their geometry from. That table gains a `col` field and nine new entries,
the board's crop widens from 270 to 280 to make room for the second column, and
`app/main.js` imports the same table to compose its menu labels — so a plate
and its menu line cannot wear different marks.

**Tech Stack:** Vanilla ES modules, no build step. SVG rendered as strings so
`node --test` can assert on markup without a DOM. Tests: `npm test`
(`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-01-coaches-menu-board-buttons-design.md`

## Global Constraints

- **Nothing that is on the board today moves or changes size.** The four
  existing plates keep slots -1, 0, 1, 2 in column 0, and `FIELD_BTN_X` keeps
  its current value.
- **`lib/field/geometry.js` is not touched.** `VIEWBOX_WIDTH` stays 270 for the
  standalone field diagrams; only the game's crop widens.
- **Every emoji is written down exactly once**, in `FIELD_BUTTONS`. No test and
  no menu label may contain an emoji literal — they read it from the table.
- **`allow` is deny-by-default.** Every new plate must sit behind
  `fielded(name)`, so no lesson fields it and the tutorial needs no change.
- **The board's press functions are the menu's press functions.** Never write a
  second copy of a rule; extract and share.
- Icons, as codepoints: 🧹 `\u{1F9F9}`, 🤖 `\u{1F916}`, 👥 `\u{1F465}`,
  💾 `\u{1F4BE}`, keycaps `1️⃣` … `5️⃣`.
- Commit after every task. Do not run `git push`.

---

### Task 1: The board's crop widens to 280

The second column needs 10 units of margin that the 270-wide crop does not
have. The field is unchanged — it simply sits in a wider frame.

**Files:**
- Modify: `lib/game/render.js` (the `VIEWBOX_WIDTH` import site,
  `cameraViewBox`, `renderBoardShell`)
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `GAME_VIEWBOX_WIDTH` — a module-private constant, value `280`. Later
  tasks assume the crop is this wide.

- [ ] **Step 1: Write the failing test**

Add to `test/game/render.test.js`:

```js
test('the game crops wider than the field, to make room for the button columns', () => {
  const shell = Number(renderBoardShell(20, 30).viewBox.split(' ')[2]);
  assert.equal(shell, 280, 'the shell leaves room for two columns of plates');
  // animate() writes cameraViewBox on every frame; if the two disagree the
  // board would jump a few units wider or narrower at the snap.
  for (const cam of [20, 35, 80]) {
    const live = Number(cameraViewBox(20, cam).split(' ')[2]);
    assert.equal(live, shell, `cameraViewBox agrees at camera ${cam}`);
  }
});
```

`cameraViewBox` is already exported; add it to the import list at the top of
the file if it is not already there.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm test 2>&1 | grep -A 5 "crops wider"
```

Expected: FAIL — `Expected values to be strictly equal: 270 !== 280`.

- [ ] **Step 3: Widen the crop**

In `lib/game/render.js`, just below the `FIELD_BTN_*` constants, add:

```js
/**
 * The game crops wider than the field's own frame. `VIEWBOX_WIDTH` is the
 * width the standalone diagrams draw at, and it leaves 18.8 units of margin to
 * the right of the yard numbers — enough for one column of plates, not two. So
 * the game — and only the game — takes ten more units of empty air on the
 * right, and the second column lives there.
 *
 * The field is not redrawn or rescaled by this: every yard of it is still
 * placed by lib/field/geometry.js, and this only moves where the crop's right
 * edge falls. The cost is that the field renders 3.6% smaller on a
 * width-constrained screen, and its centre line sits 5 units left of the
 * frame's — both imperceptible, and the price of never moving a plate the
 * coach already knows.
 */
const GAME_VIEWBOX_WIDTH = 280;
```

Then replace `VIEWBOX_WIDTH` with `GAME_VIEWBOX_WIDTH` in exactly two places —
the template literal in `cameraViewBox`, and the `viewBox:` line in
`renderBoardShell`. **Leave the `FIELD_BTN_X` line alone**: it derives column
0's position and must keep its current value so nothing moves.

Update `FIELD_BTN_X`'s comment, which now claims something untrue. Replace the
sentence "so the free strip runs from about x 251 to the viewBox's 270" with:

```js
 * free strip runs from about x 251 to the field frame's 270. This is no longer
 * the middle of anything — the game crops to GAME_VIEWBOX_WIDTH now, and the
 * second column of plates lives in the air past 270 — but it is pinned at the
 * value it has always had, because moving it would move every plate the coach
 * has learned the position of.
```

- [ ] **Step 4: Run the full suite and find the two stale assertions**

```bash
npm test 2>&1 | tail -20
```

Expected: the new test PASSES, and exactly two older tests now fail because
they hardcode the old width.

- [ ] **Step 5: Update the two stale assertions**

`test/game/render.test.js:25` — the shell's whole viewBox string:

```js
  assert.match(viewBox, /^0 56\.25 280 170$/);
```

`test/game/render.test.js:686` — the shuffle plate staying inside the frame.
Derive the bound instead of writing it again, so this one cannot go stale a
second time:

```js
  const frameWidth = Number(renderBoardShell(20, 30).viewBox.split(' ')[2]);
  assert.ok(shuffle.x + shuffle.w <= frameWidth, 'and stay inside the viewBox');
```

- [ ] **Step 6: Run the full suite**

```bash
npm test 2>&1 | tail -8
```

Expected: `pass 838`, `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add lib/game/render.js test/game/render.test.js
git commit -m "feat: the board crops wider, to make room for a second column"
```

---

### Task 2: The button table learns about columns

`FIELD_BUTTONS` places a plate by `slot` — its distance from the middle of the
window. It gains `col`, its distance from column 0 in the same pitch, so the
one table still answers "where is this plate" for both the paint and the
tutorial's ring.

**Files:**
- Modify: `lib/game/render.js` (`FIELD_BUTTONS`, `fieldButtonAnchor`,
  `fieldButtonMark`, the three `fieldButtonMark` calls in `renderFieldButtons`,
  and `menuButtonMark`)
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: `GAME_VIEWBOX_WIDTH` from Task 1.
- Produces:
  - `FIELD_BUTTONS[name].col` — integer, 0 for every existing entry.
  - `fieldButtonAnchor(name, losYard, cameraYard)` → `{ x, y, r }` where
    `x = FIELD_BTN_X + col * FIELD_BTN_PITCH`.
  - `fieldButtonMark({ attr, attrValue, icon, label, cx, cy, on, off, pressed })`
    — `cx` is now required; `attrValue` defaults to `'1'`.

- [ ] **Step 1: Write the failing test**

```js
test('plates in one column share an x and are told apart by their row', () => {
  // Every entry is col 0 until Task 4, so this pins what must NOT change: the
  // refactor threads col and cx through without moving a single plate. The
  // two-column assertion lands in Task 4, with the plates that need it.
  const a = fieldButtonAnchor('run', 20);
  const b = fieldButtonAnchor('menu', 20);
  assert.equal(a.x, b.x, 'two plates in one column share an x');
  assert.notEqual(a.y, b.y, 'and are told apart by their row');
});

test('the anchor still refuses a name there is no button for', () => {
  assert.equal(fieldButtonAnchor('nonesuch', 20), null);
});
```

- [ ] **Step 2: Run the tests and watch them pass**

```bash
npm test 2>&1 | grep -A 3 "further column"
```

Expected: PASS. These two pin the behaviour that must survive the edit —
write them first, watch them pass, and they become the net for Step 3.

- [ ] **Step 3: Add `col` and thread `cx` through**

In `FIELD_BUTTONS`, give every entry `col: 0`, and note why in the table's
comment:

```js
const FIELD_BUTTONS = {
  menu: { attr: 'data-menu-button', icon: '\u{1F4CB}', col: 0, slot: 0 },
  reposition: { attr: 'data-reposition-button', icon: '\u{1F500}', col: 0, slot: -1 },
  autoplan: { attr: 'data-autoplan-button', icon: '\u{1F381}', col: 0, slot: 1 },
  run: { attr: 'data-run-button', icon: '\u{23E9}', col: 0, slot: 2 },
};
```

Add to the table's doc comment, above `slot`'s explanation:

```js
 * `col` is the plate's distance from the first column in the same pitch, so
 * the band is a square grid: column 0 is the one that has always been here,
 * and column 1 is the playbook out in the air the wider crop opened up.
```

`fieldButtonAnchor` derives x from `col`:

```js
export function fieldButtonAnchor(name, losYard, cameraYard = losYard) {
  const b = FIELD_BUTTONS[name];
  if (!b) return null;
  return {
    x: FIELD_BTN_X + b.col * FIELD_BTN_PITCH,
    y: buttonColumnMidY(losYard, cameraYard) + b.slot * FIELD_BTN_PITCH,
    r: FIELD_BTN_SIZE / 2,
  };
}
```

`fieldButtonMark` takes `cx` and an optional attribute value. Replace its
signature and the two places `FIELD_BTN_X` appears in its body:

```js
function fieldButtonMark({
  attr, attrValue = '1', icon, label, cx, cy, on = false, off = false, pressed = null,
}) {
  const classes = `fbtn${on ? ' fbtn-on' : ''}${off ? ' fbtn-off' : ''}`;
  return (
    `<g class="${classes}">` +
    `<rect ${attr}="${escapeText(attrValue)}" class="fbtn-plate" tabindex="0" role="button"` +
    (pressed === null ? '' : ` aria-pressed="${pressed ? 'true' : 'false'}"`) +
    (off ? ' aria-disabled="true"' : '') +
    ` aria-label="${escapeText(label)}"` +
    ` x="${num(cx - FIELD_BTN_SIZE / 2)}" y="${num(cy - FIELD_BTN_SIZE / 2)}"` +
    ` width="${num(FIELD_BTN_SIZE)}" height="${num(FIELD_BTN_SIZE)}" rx="${num(FIELD_BTN_RADIUS)}"/>` +
    `<text class="fbtn-icon" x="${num(cx)}" y="${num(cy)}">${escapeText(icon)}</text>` +
    `</g>`
  );
}
```

Add to its doc comment:

```js
 * `attrValue` is the attribute's value, and is '1' for every plate that is the
 * only one of its kind. The playbook's five share one attribute and are told
 * apart by it, which is what lets one dispatch line in app/main.js read the
 * slot straight off the plate that was pressed.
```

Now every caller must pass `cx`. There are four. In `menuButtonMark`:

```js
export function menuButtonMark(losYard, cameraYard = losYard) {
  const at = fieldButtonAnchor('menu', losYard, cameraYard);
  return fieldButtonMark({
    attr: FIELD_BUTTONS.menu.attr,
    icon: FIELD_BUTTONS.menu.icon,
    label: 'Open the Coaches Menu',
    cx: at.x,
    cy: at.y,
  });
}
```

And in `renderFieldButtons`, each of the three existing blocks changes from
`cy: fieldButtonAnchor('X', los, cam).y,` to holding the anchor once:

```js
  if (fielded('reposition') && canReposition(state) && !animating) {
    const at = fieldButtonAnchor('reposition', los, cam);
    parts.push(fieldButtonMark({
      attr: FIELD_BUTTONS.reposition.attr,
      icon: FIELD_BUTTONS.reposition.icon,
      label: repositioning ? 'Reposition players: on' : 'Reposition players: off',
      cx: at.x,
      cy: at.y,
      on: repositioning,
      pressed: repositioning,
    }));
  }
```

Do the same for the `autoplan` and `run` blocks, keeping their existing
`label` and `off` expressions exactly as they are.

- [ ] **Step 4: Run the full suite**

```bash
npm test 2>&1 | tail -8
```

Expected: `pass 840`, `fail 0`. Nothing has moved — every existing plate is
`col: 0`, so every existing geometry assertion still holds.

- [ ] **Step 5: Commit**

```bash
git add lib/game/render.js test/game/render.test.js
git commit -m "refactor: the button table places a plate by column as well as row"
```

---

### Task 3: 🧹 🤖 👥 join the first column

**Files:**
- Modify: `lib/game/render.js` (`FIELD_BUTTONS`, `renderFieldButtons`)
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: `FIELD_BUTTONS[name].col`, `fieldButtonMark({ cx, cy, … })` from
  Task 2.
- Produces: three new table entries — `ai` (slot -3), `personnel` (slot -2),
  `clear` (slot 3), all `col: 0` — drawn by `renderFieldButtons`, each behind
  `fielded(name)`.

- [ ] **Step 1: Write the failing tests**

`FIELD_BUTTONS` is module-private, so assert against the markup and against
`fieldButtonAnchor`, which is the table's public face.

```js
test('the first column carries the three controls that used to be menu-only', () => {
  const markup = renderFieldButtons(createGame({ seed: 1 }));
  for (const attr of ['data-clear-button', 'data-ai-button', 'data-personnel-button']) {
    assert.ok(markup.includes(attr), `${attr} is on the board`);
  }
});

test('the new controls stack in the column the four old ones are in', () => {
  const pitch = fieldButtonAnchor('run', 20).y - fieldButtonAnchor('autoplan', 20).y;
  for (const name of ['ai', 'personnel', 'clear']) {
    assert.equal(fieldButtonAnchor(name, 20).x, fieldButtonAnchor('menu', 20).x,
      `${name} is in the first column`);
  }
  // Slots -3, -2, 3 against the menu's 0.
  assert.equal(fieldButtonAnchor('ai', 20).y, fieldButtonAnchor('menu', 20).y - 3 * pitch);
  assert.equal(fieldButtonAnchor('personnel', 20).y, fieldButtonAnchor('menu', 20).y - 2 * pitch);
  assert.equal(fieldButtonAnchor('clear', 20).y, fieldButtonAnchor('menu', 20).y + 3 * pitch);
});

test('a lesson fields none of the new controls unless it names them', () => {
  const markup = renderFieldButtons(createGame({ seed: 1 }), { allow: ['run', 'menu'] });
  for (const attr of ['data-clear-button', 'data-ai-button', 'data-personnel-button']) {
    assert.ok(!markup.includes(attr), `${attr} stays off a lesson's board`);
  }
});

test('the new controls grey on the same conditions their menu buttons do', () => {
  const s = createGame({ seed: 1 });
  const live = renderFieldButtons(s);
  assert.ok(!buttonGroup(live, 'data-clear-button').includes('fbtn-off'), 'clear is live before the snap');
  assert.ok(!buttonGroup(live, 'data-ai-button').includes('fbtn-off'), 'defense is live before the snap');
  assert.ok(!buttonGroup(live, 'data-personnel-button').includes('fbtn-off'), 'personnel is live before the snap');

  const drawing = renderFieldButtons(s, { animating: true });
  for (const attr of ['data-clear-button', 'data-ai-button', 'data-personnel-button']) {
    assert.ok(buttonGroup(drawing, attr).includes('fbtn-off'),
      `${attr} is dead while the turn is drawn`);
  }

  // The computer's own package to pick: not the human's to press.
  const aiDef = createGame({ seed: 1 });
  aiDef.aiTeam = 'defense';
  assert.ok(buttonGroup(renderFieldButtons(aiDef), 'data-personnel-button').includes('fbtn-off'),
    'personnel is dead when the computer coaches the defense');
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test 2>&1 | grep -E "used to be menu-only|stack in the column|fields none|grey on the same" -A 4
```

Expected: FAIL — the attributes are absent and `fieldButtonAnchor` returns
`null` for the new names, so `buttonGroup(...)` returns `null` and the
`.includes` calls throw.

- [ ] **Step 3: Add the three entries**

In `FIELD_BUTTONS`, after `run`:

```js
  // Three the Coaches Menu used to keep to itself. They are as much a part of
  // a down as the shuffle is — a plan cleared, a package changed, the defense
  // handed over — so they sit where a coach's hand already is.
  ai: { attr: 'data-ai-button', icon: '\u{1F916}', col: 0, slot: -3 },
  personnel: { attr: 'data-personnel-button', icon: '\u{1F465}', col: 0, slot: -2 },
  // Below Run the Turn rather than up with the planning tools: Run is the
  // most-pressed plate on the board, and a broom is not worth moving it for.
  clear: { attr: 'data-clear-button', icon: '\u{1F9F9}', col: 0, slot: 3 },
```

- [ ] **Step 4: Draw them**

In `renderFieldButtons`, after the `run` block and before `return`:

```js
  if (fielded('clear')) {
    const at = fieldButtonAnchor('clear', los, cam);
    parts.push(fieldButtonMark({
      attr: FIELD_BUTTONS.clear.attr,
      icon: FIELD_BUTTONS.clear.icon,
      label: 'Clear the arrows',
      cx: at.x,
      cy: at.y,
      off: animating || state.phase !== 'planning',
    }));
  }
  // The icon never changes with the setting and the plate carries no badge:
  // pressing one says what it changed to on the message plate, and the men on
  // the field show it. See the spec's decision 4.
  if (fielded('ai')) {
    const at = fieldButtonAnchor('ai', los, cam);
    parts.push(fieldButtonMark({
      attr: FIELD_BUTTONS.ai.attr,
      icon: FIELD_BUTTONS.ai.icon,
      label: AI_MODES[aiModeIndex(state)].label,
      cx: at.x,
      cy: at.y,
      off: animating || state.phase !== 'planning',
    }));
  }
  if (fielded('personnel')) {
    const at = fieldButtonAnchor('personnel', los, cam);
    parts.push(fieldButtonMark({
      attr: FIELD_BUTTONS.personnel.attr,
      icon: FIELD_BUTTONS.personnel.icon,
      label: `Personnel: ${personnelId(state.variantId)}`,
      cx: at.x,
      cy: at.y,
      // Not the human's to press when the computer coaches the defense: it
      // picks its own package, and the two would fight on every press.
      off: animating || !canReposition(state) || state.aiTeam === 'defense',
    }));
  }
```

Add the imports these need at the top of `lib/game/render.js`:

```js
import { AI_MODES, aiModeIndex } from './ai.js';
import { personnelId } from './rosters.js';
```

Neither `ai.js` nor `rosters.js` imports `render.js`, so there is no cycle —
verified with
`grep -n "^import" lib/game/ai.js lib/game/rosters.js | grep render`, which
matches nothing.

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -8
```

Expected: `pass 844`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add lib/game/render.js test/game/render.test.js
git commit -m "feat: clear, defense and personnel come out onto the board"
```

---

### Task 4: The playbook gets a column of its own

**Files:**
- Modify: `lib/game/render.js` (`FIELD_BUTTONS`, `renderFieldButtons`, imports)
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: everything from Tasks 2 and 3.
- Produces: six new `col: 1` entries — `save` (slot -3) and `play1`…`play5`
  (slots -2 … 2) — and a new `renderFieldButtons` option
  `book` (array of `PLAY_SLOTS` entries, each a play object or `undefined`;
  defaults to `[]`). The five slots render `data-play-button="0"` … `="4"`.

- [ ] **Step 1: Write the failing tests**

```js
test('the playbook is a second column, one pitch right and row-aligned', () => {
  const pitch = fieldButtonAnchor('run', 20).y - fieldButtonAnchor('autoplan', 20).y;
  assert.equal(fieldButtonAnchor('save', 20).x, fieldButtonAnchor('menu', 20).x + pitch,
    'one pitch to the right of the first column');
  // play3 holds slot 0, the row the menu plate holds.
  assert.equal(fieldButtonAnchor('play3', 20).y, fieldButtonAnchor('menu', 20).y,
    'and its rows line up with the first column');
});

test('the board offers a plate per playbook slot', () => {
  const markup = renderFieldButtons(createGame({ seed: 1 }), { book: [] });
  assert.ok(markup.includes('data-save-button'), 'save is offered');
  for (let i = 0; i < PLAY_SLOTS; i++) {
    assert.ok(markup.includes(`data-play-button="${i}"`), `slot ${i} is offered`);
  }
  assert.ok(!markup.includes(`data-play-button="${PLAY_SLOTS}"`), 'and no more than five');
});

test('an empty slot is greyed and a filled one is live', () => {
  const s = createGame({ seed: 1 });
  const book = [{ name: 'Fly sweep' }];
  const markup = renderFieldButtons(s, { book });
  assert.ok(!buttonGroup(markup, 'data-play-button="0"').includes('fbtn-off'), 'a saved play can be called');
  assert.ok(buttonGroup(markup, 'data-play-button="1"').includes('fbtn-off'), 'an empty slot cannot');
  assert.match(buttonGroup(markup, 'data-play-button="0"'), /aria-label="[^"]*Fly sweep/,
    'and the label names the play, since the plate cannot');
});

test('the whole playbook is dead once the down is under way', () => {
  const s = createGame({ seed: 1 });
  const drawing = renderFieldButtons(s, { book: [{ name: 'Fly sweep' }], animating: true });
  assert.ok(buttonGroup(drawing, 'data-save-button').includes('fbtn-off'));
  assert.ok(buttonGroup(drawing, 'data-play-button="0"').includes('fbtn-off'));
});

test('a lesson fields no playbook plates unless it names them', () => {
  const markup = renderFieldButtons(createGame({ seed: 1 }), { allow: ['run', 'menu'], book: [] });
  assert.ok(!markup.includes('data-save-button'));
  assert.ok(!markup.includes('data-play-button'));
});

test('no two plates overlap, and every one is inside the crop', () => {
  const s = createGame({ seed: 1 });
  const frame = Number(renderBoardShell(20, 30).viewBox.split(' ')[2]);
  const markup = menuButtonMark(20) + renderFieldButtons(s, { book: [] });
  const boxes = markup.split('<g ').slice(1).map((g) => rectBox(`<g ${g}`));
  assert.equal(boxes.length, fieldButtonNames().length, 'one plate per table entry');
  for (const b of boxes) {
    assert.ok(b.x >= 0 && b.x + b.w <= frame, 'inside the crop');
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const c = boxes[j];
      const apart = a.x + a.w <= c.x || c.x + c.w <= a.x
        || a.y + a.h <= c.y || c.y + c.h <= a.y;
      assert.ok(apart, `plates ${i} and ${j} do not overlap`);
    }
  }
});

test('every plate the table names is drawn, and no plate wears an off-table icon', () => {
  const s = createGame({ seed: 1 });
  const drawn = menuButtonMark(20) + renderFieldButtons(s, { book: [] });
  for (const name of fieldButtonNames()) {
    assert.ok(drawn.includes(FIELD_BUTTON_ICONS[name]), `${name}'s icon is on the board`);
  }
  // Every icon in the markup came from the table — the check that keeps the
  // board and the menu from ever wearing different marks.
  const icons = Object.values(FIELD_BUTTON_ICONS);
  for (const m of drawn.matchAll(/class="fbtn-icon"[^>]*>([^<]+)</g)) {
    assert.ok(icons.includes(m[1]), `${m[1]} is written down in the table`);
  }
});
```

Add `PLAY_SLOTS` to the test file's imports:

```js
import { PLAY_SLOTS } from '../../lib/game/playbook.js';
```

and `FIELD_BUTTON_ICONS`, `fieldButtonNames` to the `render.js` import list —
both are added in Step 3.

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test 2>&1 | grep -E "second column|plate per playbook|empty slot is greyed|whole playbook is dead|no playbook plates|off-table icon" -A 4
```

Expected: FAIL — the exports do not exist and no playbook plate is drawn.

- [ ] **Step 3: Add the six entries and the table's public face**

In `FIELD_BUTTONS`, after `clear`:

```js
  // The playbook, in a column of its own. Save on top, then the five slots in
  // order, so the column reads the way the menu's Plays section does.
  save: { attr: 'data-save-button', icon: '\u{1F4BE}', col: 1, slot: -3 },
  play1: { attr: 'data-play-button', attrValue: '0', icon: '1️⃣', col: 1, slot: -2 },
  play2: { attr: 'data-play-button', attrValue: '1', icon: '2️⃣', col: 1, slot: -1 },
  play3: { attr: 'data-play-button', attrValue: '2', icon: '3️⃣', col: 1, slot: 0 },
  play4: { attr: 'data-play-button', attrValue: '3', icon: '4️⃣', col: 1, slot: 1 },
  play5: { attr: 'data-play-button', attrValue: '4', icon: '5️⃣', col: 1, slot: 2 },
```

Below the table, export what the menu and the tests need. The table itself
stays private — callers get the icons, not the geometry:

```js
/**
 * The icons, by control name. Exported because app/main.js writes them into
 * the Coaches Menu's own buttons: the plate on the board and the line in the
 * menu wear the same mark because there is one place to write a mark down.
 */
export const FIELD_BUTTON_ICONS = Object.fromEntries(
  Object.entries(FIELD_BUTTONS).map(([name, b]) => [name, b.icon]),
);

/** Every control the column knows about. */
export function fieldButtonNames() {
  return Object.keys(FIELD_BUTTONS);
}
```

- [ ] **Step 4: Draw the playbook column**

Import what the greying needs, at the top of `lib/game/render.js`:

```js
import { canUsePlays } from './play.js';
import { PLAY_SLOTS } from './playbook.js';
```

Extend `renderFieldButtons`'s options and add the block, after the personnel
block:

```js
export function renderFieldButtons(
  state,
  { repositioning = false, animating = false, cameraYard, allow = null, book = [] } = {},
) {
```

```js
  // A play is what you come to the line with, so saving and calling one are
  // offered only on the first turn of a down — the same rule the menu's Plays
  // section keeps. `book` is handed in rather than read here: the library
  // lives in app/main.js behind localStorage, and this stays a pure function
  // of what it is given.
  const plays = !animating && canUsePlays(state);
  if (fielded('save')) {
    const at = fieldButtonAnchor('save', los, cam);
    parts.push(fieldButtonMark({
      attr: FIELD_BUTTONS.save.attr,
      icon: FIELD_BUTTONS.save.icon,
      label: 'Save the current play',
      cx: at.x,
      cy: at.y,
      off: !plays,
    }));
  }
  for (let i = 0; i < PLAY_SLOTS; i++) {
    const name = `play${i + 1}`;
    if (!fielded(name)) continue;
    const b = FIELD_BUTTONS[name];
    const at = fieldButtonAnchor(name, los, cam);
    const play = book[i];
    parts.push(fieldButtonMark({
      attr: b.attr,
      attrValue: b.attrValue,
      icon: b.icon,
      // The plate is a bare digit, so the label is the only place the play's
      // name — and whether there is one — can be said at all.
      label: play ? `Call play ${i + 1}: ${play.name}` : `Play slot ${i + 1} is empty`,
      cx: at.x,
      cy: at.y,
      off: !plays || !play,
    }));
  }
```

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -8
```

Expected: `pass 851`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add lib/game/render.js test/game/render.test.js
git commit -m "feat: the playbook comes out onto the board, in a column of its own"
```

---

### Task 5: The board's presses reach the menu's own functions

**Files:**
- Modify: `app/main.js` (`aimCamera`, `pressBoardButton`, the `clear`/`ai`/
  `personnel` listeners, `paint`)

**Interfaces:**
- Consumes: the `data-*` attributes from Tasks 3 and 4.
- Produces: `pressClear()`, `pressAi()`, `pressPersonnel()` — module-scope
  functions in `app/main.js`, each carrying its own guard and calling `paint()`.

There is no `node --test` coverage here: this file needs a DOM. The gate is the
browser check in Task 7, and the discipline is that no rule may be written
twice.

- [ ] **Step 1: Extract the three handlers**

Replace the `clearBtn`, `aiBtn` and `personnelBtn` listeners with named
functions plus thin listeners. The bodies are moved verbatim except for the
one guard noted below:

```js
/**
 * Clear, Defense and Personnel, from the menu or from their plates on the
 * board. One function each so the two surfaces cannot drift: whichever is
 * pressed, the same rule runs and the same thing is said.
 */
function pressClear() {
  if (animating || state.phase !== 'planning') return;
  clearAllPlans(state);
  pendingWarning = false;
  paint();
}

function pressAi() {
  if (animating || state.phase !== 'planning') return;
  const next = nextAiMode(state);
  state.aiTeam = next.ai;
  state.aiLevel = next.level;
  // Handing the defense back to the computer — or to a different brain — drops
  // whatever arrows and coverage were already on it. They are not that
  // coach's any more.
  if (state.aiTeam) clearAiPlans(state);
  pendingWarning = false;
  say(next.note);
  paint();
}

function pressPersonnel() {
  // The aiTeam check is new here. paint() has always greyed the menu button on
  // it — the computer picks its own package, and the two would fight on every
  // press — but the handler never carried it, which was safe only while a
  // disabled button was the sole way in. A plate on the board is a second way.
  if (animating || !canReposition(state) || state.aiTeam === 'defense') return;
  const order = PERSONNEL_PACKAGES;
  const next = order[(order.indexOf(personnelId(state.variantId)) + 1) % order.length];
  if (!setPersonnel(state, next)) return;
  // A new package means new bodies on the field — realign them the same way
  // a drag during reposition mode does, and for the same reason: only when
  // the computer is coaching the defense, so a human coach's own drags are
  // never overwritten.
  realignDefense();
  pendingWarning = false;
  say(`Personnel: ${next}.`);
  paint();
}

clearBtn.addEventListener('click', () => { closeMenu(); pressClear(); });
aiBtn.addEventListener('click', () => { closeMenu(); pressAi(); });
personnelBtn.addEventListener('click', () => { closeMenu(); pressPersonnel(); });
```

- [ ] **Step 2: Close the Clear button's greying gap**

In `paint()`, `clearBtn.disabled = animating;` has always disagreed with its
own handler, which returns early off the planning phase — so the button looked
pressable and did nothing. Bring it in line with the plate:

```js
  clearBtn.disabled = animating || state.phase !== 'planning';
```

- [ ] **Step 3: Dispatch the new plates**

In `pressBoardButton`, after the `data-autoplan-button` line and before
`else return false;`:

```js
  else if (target.closest('[data-clear-button]')) pressClear();
  else if (target.closest('[data-ai-button]')) pressAi();
  else if (target.closest('[data-personnel-button]')) pressPersonnel();
  else if (target.closest('[data-save-button]')) savePlay();
  else return callPlayFromBoard(target);
  return true;
}

/**
 * The five load plates share one attribute and are told apart by its value, so
 * one line reads the slot straight off the plate that was pressed rather than
 * five branches saying the same thing.
 */
function callPlayFromBoard(target) {
  const el = target.closest('[data-play-button]');
  if (!el) return false;
  callPlay(Number(el.getAttribute('data-play-button')));
  return true;
}
```

Note the shape: the last branch `return`s the helper's answer rather than
falling through to `return true`, because a press that hit no plate at all must
still report `false` — that is what lets a keyboard press fall through to the
browser.

- [ ] **Step 4: Hand the renderer the coached side's book**

In `aimCamera`, add `book` to the options `renderFieldButtons` is called with:

```js
    renderFieldButtons(state, {
      repositioning, animating, cameraYard: cam, allow: lesson ? lesson.buttons() : null,
      book: myBook(),
    }),
```

- [ ] **Step 5: Run the suite, then load the game**

```bash
npm test 2>&1 | tail -8
```

Expected: `pass 851`, `fail 0` — no test touches `app/main.js`, so this only
confirms nothing else broke.

Then start the preview and confirm the page loads with no console errors and
thirteen plates on the board. Do not use `Bash` to run the server — use the
Browser pane's `preview_start`, with a `.claude/launch.json` entry running
`npm run serve` on the port `serve.py` uses.

- [ ] **Step 6: Commit**

```bash
git add app/main.js
git commit -m "feat: the new plates press the same functions the menu does"
```

---

### Task 6: The menu wears the same icons

**Files:**
- Modify: `app/main.js` (imports, `paint`, `paintPlays`, one startup block)
- Modify: `index.html` (the dialog's `<h1>`)

**Interfaces:**
- Consumes: `FIELD_BUTTON_ICONS` from Task 4.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Import the icons**

Add `FIELD_BUTTON_ICONS` to the existing `lib/game/render.js` import block in
`app/main.js`.

- [ ] **Step 2: Prefix the labels that are rewritten every paint**

In `paint()`, four labels gain their icon:

```js
  aiBtn.textContent = `${FIELD_BUTTON_ICONS.ai} ${AI_MODES[aiModeIndex(state)].label}`;
```
```js
  repositionBtn.textContent = `${FIELD_BUTTON_ICONS.reposition} Reposition: ${repositioning ? 'on' : 'off'}`;
```
```js
  personnelBtn.textContent = `${FIELD_BUTTON_ICONS.personnel} Personnel: ${personnelId(state.variantId)}`;
```
```js
  autoplanBtn.textContent = `${FIELD_BUTTON_ICONS.autoplan} Autoplan ${coachedSide(state)}`;
```

- [ ] **Step 3: Prefix the three static labels, once**

`run`, `clear` and `save-play` never have their text rewritten, so they are
labelled at startup. Put this next to the other one-time menu wiring, just
after the `slotBtns` loop:

```js
/**
 * The menu's own buttons wear the icons their plates wear. Written from the
 * same table the board reads, so the two can never say different things —
 * which is the whole point of a coach being able to relate one to the other.
 *
 * Only the three whose text is never rewritten need doing here; the rest get
 * their icon from paint()'s templates.
 */
for (const [btn, name] of [[runBtn, 'run'], [clearBtn, 'clear'], [savePlayBtn, 'save']]) {
  btn.textContent = `${FIELD_BUTTON_ICONS[name]} ${btn.textContent}`;
}
```

- [ ] **Step 4: Label the slots with their keycaps**

In `paintPlays()`, the slot's own number is now carried by the keycap:

```js
    slotBtns[i].textContent = `${FIELD_BUTTON_ICONS[`play${i + 1}`]} ${play ? play.name : '(empty)'}`;
```

- [ ] **Step 5: Put the clipboard on the menu's heading**

In `index.html`, so the plate that opens the menu and the menu it opens wear
the same mark:

```html
      <h1>📋 Coaches Menu</h1>
```

- [ ] **Step 6: Run the suite and reload the preview**

```bash
npm test 2>&1 | tail -8
```

Expected: `pass 851`, `fail 0`.

Reload the browser preview, open the Coaches Menu, and confirm every button
that has a plate shows that plate's icon, and that Velocity, Next Down, New
Game, Back to Home, the log section and the training section show none.

- [ ] **Step 7: Commit**

```bash
git add app/main.js index.html
git commit -m "feat: the menu wears the icons its plates wear"
```

---

### Task 7: Verify it in the browser, end to end

The renderer is covered by `node --test`; the wiring is not. This task is the
gate on everything `app/main.js` does.

**Files:** none changed unless a defect is found.

- [ ] **Step 1: Open the game**

Start the preview via the Browser pane (`preview_start`), pick a game off the
home screen, and take a screenshot. Confirm: two columns of plates, thirteen
in total, the field not clipped at either sideline, and nothing overlapping the
yard numbers.

- [ ] **Step 2: Press all nine, and check each against its menu twin**

For each of 🧹 🤖 👥 💾 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣: press the plate, note what the
message plate says and what changed on the field; then do the same from the
menu button and confirm the two are identical. 💾 and the digits need a play
saved first — save one from the board, then call it back.

- [ ] **Step 3: Check the greying**

- Run a turn: while it animates, every plate should be greyed.
- After the whistle (`phase` is no longer `planning`): 🧹 🤖 ⏩ 🎁 greyed,
  🔀 gone, the whole playbook column greyed.
- Personnel and the Defense mode: a new game starts with the computer coaching
  the defense, so 👥 should be greyed from the first paint, on the board and in
  the menu. Press 🤖 until the menu reads `Defense: you` (hot-seat) and confirm
  👥 goes live; press on to `Offense: computer (learned)` and confirm it stays
  live, since the computer is not on the defense in that mode either.
- An empty playbook: 1️⃣–5️⃣ all greyed, 💾 live.

- [ ] **Step 4: Check the keyboard**

Tab through the board. Every one of the thirteen plates should take focus, and
Enter and Space should work it without scrolling the page.

- [ ] **Step 5: Run a tutorial lesson**

From the home screen, start "How to play". Confirm the lesson's board shows
**only** the plates that lesson fields — no 🧹, no 🤖, no 👥, no playbook
column — and that the coach card is still centred over the field. Play the
first lesson to its whistle.

- [ ] **Step 6: Read the console**

Check the browser console for errors and warnings across everything above.
Expected: none.

- [ ] **Step 7: Final check and commit**

```bash
npm test 2>&1 | tail -8
git status --short
```

Expected: `fail 0`, and a clean tree. If Step 2–6 turned up a defect, fix it,
re-run, and commit the fix on its own.

---

## Notes for the implementer

- **Do not touch `lib/field/geometry.js`.** `VIEWBOX_WIDTH` stays 270; the
  standalone field diagrams draw at that width and are not part of this work.
- **Do not add `refused({ kind })` guards** to the new press functions. No
  lesson fields these plates, so none is reachable during the tutorial — the
  `allow` whitelist is the lock, and `pressAutoplan` sets the precedent. See
  decision 6 in the spec.
- **Do not change any tutorial file.** `fielded(name)` is deny-by-default, so
  the new plates are absent from every existing lesson for free.
- If a test asserts an emoji, it is wrong: read the icon from
  `FIELD_BUTTON_ICONS` instead, so the test cannot drift from the table.
