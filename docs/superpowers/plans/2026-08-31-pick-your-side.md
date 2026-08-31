# Pick Your Side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After choosing 7 or 11 Player on the home screen, the coach picks
how to play — Play Offense or Play Defense against the learned AI, or
Training Mode, which is today's game left exactly as it is — and the in-game
copy (kickoff line, win/lose call) follows the side the human ends up
coaching.

**Architecture:** A second home-screen step rendered the way the first one is:
`lib/game/home.js` builds the markup as a testable string (`sideMarkup`), and
`app/home.js` swaps it in when a variant is pressed and reads the
`data-side` press. Which computer answers which choice is one pure lookup in
`ai.js` (`defaultModeForSide`), reusing modes that already exist in
`AI_MODES` — Play Offense deals the learned computer defense, Play Defense
deals the learned computer offense (the only offense brain), and Training
Mode deals the smart computer defense every visit dealt before this feature
existed. The side-dependent copy moves out of `app/main.js` into two pure
functions in `lib/game/hud.js`, where `node --test` can hold every string.

**Tech Stack:** Plain ES modules, `node --test` (`npm test`). No new
dependencies, no build step, no CSS additions (the side buttons reuse the
`.home-choice` classes `index.html` already styles).

**Spec:** The user's request, quoted in full because there is no separate
spec document for this feature:

> create a play [plan] to have you choose either playing offense or defense
> after selecting 7 or 11 man. Then the user should play as either the
> offense or defense during the game.

and the follow-up:

> please leave the current mode as is and call it training mode

Design decisions argued from them (the executor implements these, not
alternatives):

1. **Two-step home screen.** Pressing a playable variant swaps the choice
   list for a side chooser (Play Offense / Play Defense / Training Mode /
   Back). Back — and every return via the in-game Back to Home button —
   lands on the variant list again.
2. **Who the computer is.** Play Offense → `{ai: 'defense', level:
   'learned'}` (you against the trained defense). Play Defense →
   `{ai: 'offense', level: 'learned'}` (the only computer offense). Training
   Mode → `{ai: 'defense', level: 'smart'}` — the current mode left as is:
   exactly the game every visit dealt before sides existed. All three are
   entries that already exist in `AI_MODES`, and the in-game mode button
   still cycles all five modes mid-visit, unchanged.
3. **The side is held per visit, like the variant.** New Game re-deals the
   same variant AND the same side; changing either is what Back to Home is
   for. (New Game already resets a mid-visit mode-button change today; the
   reset target simply becomes the chosen side instead of hardcoded smart.)
4. **Copy follows the side.** The kickoff line and the game-over call
   currently assume the human is the offense ("TOUCHDOWN — you win!"). They
   become pure `hud.js` functions keyed off `state.aiTeam`: a touchdown is a
   win for the offense coach and a loss for the defense coach, turnovers the
   reverse, and hot-seat (reachable via the mode button) gets a neutral
   "offense wins / defense wins" call.

## Global Constraints

- No npm dependencies and no build step, ever.
- Nothing under `lib/` may import `node:` modules or touch the DOM; all
  markup is built as strings (the discipline `home.js` and `render.js`
  already keep), and all text goes through `escapeText`.
- `app/` files have no unit tests (they touch the DOM); everything with
  logic or copy in it lives in `lib/` where `node --test` reaches it. The
  app wiring task is verified in the browser.
- No behavior change for the existing default path: Training Mode (and any
  caller that never names a side) must deal byte-for-byte the game today's
  variant press deals (`ai: 'defense', aiLevel: 'smart'`).

## File Structure

- Modify: `lib/game/home.js` — add `SIDES` and `sideMarkup(variant, sides)`.
- Modify: `lib/game/ai.js` — add `defaultModeForSide(side)`.
- Modify: `lib/game/hud.js` — add `humanSide(state)`, `gameOverMessage(state)`,
  `kickoffMessage(state)`.
- Modify: `app/home.js` — the two-step press flow.
- Modify: `app/main.js` — `startGame` takes `side`; `startNewGame` and
  `goToNextDown` use the new lib functions.
- Tests: `test/game/home.test.js`, `test/game/ai.test.js`,
  `test/game/hud.test.js` (all existing files, appended).

---

### Task 1: The side chooser markup

**Files:**
- Modify: `lib/game/home.js`
- Test: `test/game/home.test.js`

**Interfaces:**
- Consumes: `escapeText` (already imported in `home.js`).
- Produces:
  - `SIDES` — three `{id, label, note}` entries: `'offense'`, `'defense'`,
    `'training'`.
  - `sideMarkup(variant, sides = SIDES) -> string` — heading naming the
    picked variant, one `.home-choice` button per side carrying
    `data-side="<id>"`, and a Back button carrying `data-home-back`.
    `app/home.js` (Task 4) matches on `data-side` and `data-home-back`.

- [ ] **Step 1: Write the failing test**

Append to `test/game/home.test.js` (extend the existing `home.js` import
with `SIDES, sideMarkup`, and add `getVariant` from
`'../../lib/game/variants.js'`):

```js
import { getVariant } from '../../lib/game/variants.js';

test('the side screen offers offense, defense, training, and the way back', () => {
  const html = sideMarkup(getVariant('7'));
  assert.ok(html.includes('7 Player'), 'names the picked game');
  assert.ok(html.includes('data-side="offense"'), 'an offense button');
  assert.ok(html.includes('data-side="defense"'), 'a defense button');
  assert.ok(html.includes('data-side="training"'), 'a training-mode button');
  assert.ok(html.includes('data-home-back'), 'a way back to the game list');
  assert.ok(html.includes('Training Mode'), 'the current mode keeps its name');
  for (const s of SIDES) {
    assert.ok(html.includes(s.label), `the label for ${s.id}`);
    assert.ok(html.includes(s.note), `the note for ${s.id}`);
  }
});

test('the side buttons reuse the home-choice styling', () => {
  const html = sideMarkup(getVariant('11'));
  // Three choices plus Back, all styled like the buttons on the first screen.
  assert.equal((html.match(/class="home-choice"/g) || []).length, 4);
});

test('side-screen text is escaped like every other home string', () => {
  const html = sideMarkup({ id: 'x', label: '<b>7</b>' }, [
    { id: 'offense', label: 'a "label" & more', note: '<i>note</i>' },
  ]);
  assert.ok(!html.includes('<b>'), 'no tag survives');
  assert.ok(html.includes('&lt;b&gt;7&lt;/b&gt;'));
  assert.ok(html.includes('&quot;label&quot; &amp; more'));
  assert.ok(html.includes('&lt;i&gt;note&lt;/i&gt;'));
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/home.test.js`
Expected: FAIL — `SIDES`/`sideMarkup` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/game/home.js`:

```js
/**
 * The second question the home screen asks: which side of the ball you
 * coach. Same discipline as the variant list — a list of choices, built as
 * a string, with the notes saying what the computer will be doing about it.
 */
export const SIDES = [
  {
    id: 'offense',
    label: 'Play Offense',
    note: 'You call the runs and throws against the computer’s learned defense.',
  },
  {
    id: 'defense',
    label: 'Play Defense',
    note: 'You set the coverage against the computer’s learned offense.',
  },
  {
    id: 'training',
    label: 'Training Mode',
    note: 'The game as it always was: coach the offense against the computer’s smart assignment defense.',
  },
];

/**
 * The side chooser for one picked variant. Buttons carry `data-side` the way
 * the first screen's carry `data-variant`, plus a `data-home-back` button
 * for a coach who pressed the wrong game — app/home.js matches on all three.
 */
export function sideMarkup(variant, sides = SIDES) {
  const buttons = sides.map((s) =>
    `<button class="home-choice" type="button" data-side="${escapeText(s.id)}">`
    + `<span class="home-choice-label">${escapeText(s.label)}</span>`
    + `<span class="home-choice-note">${escapeText(s.note)}</span>`
    + '</button>').join('');
  return `<h1>${escapeText(variant.label)}</h1>`
    + '<p class="home-blurb">Pick your side.</p>'
    + `<div class="home-choices">${buttons}`
    + '<button class="home-choice" type="button" data-home-back>'
    + '<span class="home-choice-label">Back</span>'
    + '<span class="home-choice-note">Pick a different game.</span>'
    + '</button></div>';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/home.test.js`
Expected: PASS (the three existing tests plus the three new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/game/home.js test/game/home.test.js
git commit -m "feat: the home screen's side chooser markup"
```

---

### Task 2: Which computer answers which side

**Files:**
- Modify: `lib/game/ai.js`
- Test: `test/game/ai.test.js`

**Interfaces:**
- Produces: `defaultModeForSide(side) -> {ai, level}` — `'offense'` maps to
  `{ai: 'defense', level: 'learned'}`, `'defense'` maps to
  `{ai: 'offense', level: 'learned'}`, and anything else — `'training'`,
  `undefined`, a stranger's string — maps to `{ai: 'defense', level:
  'smart'}`, the game every visit has always dealt. Consumed by
  `app/main.js` in Task 4.

- [ ] **Step 1: Write the failing test**

Append to `test/game/ai.test.js` (add `defaultModeForSide` to the existing
`ai.js` import):

```js
test('picking a side picks the computer for the other one', () => {
  assert.deepEqual(defaultModeForSide('offense'), { ai: 'defense', level: 'learned' });
  assert.deepEqual(defaultModeForSide('defense'), { ai: 'offense', level: 'learned' });
  // Training mode is the current mode, as is — and so is anything unrecognized.
  assert.deepEqual(defaultModeForSide('training'), { ai: 'defense', level: 'smart' });
  assert.deepEqual(defaultModeForSide(undefined), { ai: 'defense', level: 'smart' });
  // Every answer is a real mode the in-game button also knows.
  for (const side of ['offense', 'defense', 'training']) {
    const m = defaultModeForSide(side);
    assert.ok(
      AI_MODES.some((e) => e.ai === m.ai && e.level === m.level),
      `${side} maps to a listed mode`,
    );
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/ai.test.js`
Expected: FAIL — `defaultModeForSide` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/game/ai.js` (next to `AI_MODES`, whose entries it points at):

```js
/**
 * The mode a fresh game starts in for the choice the coach made on the home
 * screen. Playing a side means facing the learned brain on the other one;
 * training mode is the current mode left exactly as is — the smart computer
 * defense every visit dealt before sides existed. All three answers are
 * entries the mode button already cycles: this is a default, not a sixth
 * mode, and an unrecognized side falls back to the training game.
 */
export function defaultModeForSide(side) {
  if (side === 'offense') return { ai: 'defense', level: 'learned' };
  if (side === 'defense') return { ai: 'offense', level: 'learned' };
  return { ai: 'defense', level: 'smart' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/ai.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/game/ai.js test/game/ai.test.js
git commit -m "feat: defaultModeForSide — the computer for the side you didn't pick"
```

---

### Task 3: Copy that knows whose side you are on

**Files:**
- Modify: `lib/game/hud.js`
- Test: `test/game/hud.test.js`

**Interfaces:**
- Produces (all consumed by `app/main.js` in Task 4):
  - `humanSide(state) -> 'offense' | 'defense' | null` — the team the
    computer is not; null in hot-seat.
  - `gameOverMessage(state) -> string` — the final call for
    `state.result` of `'touchdown'`, `'turnover-on-downs'`, or any other
    turnover, from the human's point of view (neutral in hot-seat).
  - `kickoffMessage(state) -> string` — the New Game opening line, facing
    whichever way the human is facing.

- [ ] **Step 1: Write the failing test**

Append to `test/game/hud.test.js` (extend the `hud.js` import with
`humanSide, gameOverMessage, kickoffMessage`; add `createGame` from
`'../../lib/game/state.js'` if the file does not already import it):

```js
import { createGame } from '../../lib/game/state.js';

test('humanSide is the team the computer is not', () => {
  assert.equal(humanSide(createGame({ seed: 1, ai: 'defense' })), 'offense');
  assert.equal(humanSide(createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' })), 'defense');
  assert.equal(humanSide(createGame({ seed: 1 })), null);
});

test('the final call knows whose side you were on', () => {
  const o = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' }); // you: offense
  o.result = 'touchdown';
  assert.equal(gameOverMessage(o), 'TOUCHDOWN — you win!');
  o.result = 'turnover-on-downs';
  assert.equal(gameOverMessage(o), 'Turnover on downs. Game over — you lose.');
  o.result = 'turnover-fumble';
  assert.equal(gameOverMessage(o), 'Turnover. Game over — you lose.');

  const d = createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' }); // you: defense
  d.result = 'touchdown';
  assert.equal(gameOverMessage(d), 'Touchdown. Game over — you lose.');
  d.result = 'turnover-on-downs';
  assert.equal(gameOverMessage(d), 'Turnover on downs — you win!');
  d.result = 'turnover-fumble';
  assert.equal(gameOverMessage(d), 'Turnover — you win!');
});

test('hot-seat gets a neutral call', () => {
  const s = createGame({ seed: 1 });
  s.result = 'touchdown';
  assert.equal(gameOverMessage(s), 'TOUCHDOWN — offense wins!');
  s.result = 'turnover-on-downs';
  assert.equal(gameOverMessage(s), 'Turnover on downs — defense wins!');
  s.result = 'turnover-fumble';
  assert.equal(gameOverMessage(s), 'Turnover — defense wins!');
});

test('the kickoff line points whichever way you are facing', () => {
  const o = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  assert.equal(kickoffMessage(o),
    'New game. 1st and 10 from your own 20 — 80 yards to the house.');
  const d = createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' });
  assert.equal(kickoffMessage(d),
    'New game. They start 1st and 10 from their own 20 — keep them out of the house.');
  const h = createGame({ seed: 1 }); // hot-seat reads as the offense line
  assert.equal(kickoffMessage(h),
    'New game. 1st and 10 from your own 20 — 80 yards to the house.');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/hud.test.js`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/game/hud.js`:

```js
/**
 * Which side the human is coaching: the team the computer is not. Null in
 * hot-seat, where both teams are the human's and nobody gets to gloat.
 */
export function humanSide(state) {
  if (state.aiTeam === 'offense') return 'defense';
  if (state.aiTeam === 'defense') return 'offense';
  return null;
}

/**
 * The final call, from the human's own point of view. These strings lived
 * inline in app/main.js while the human could only ever be the offense;
 * a touchdown stopped being unconditionally "you win" the moment a coach
 * could pick the other side, so the words moved here where a test can hold
 * every combination.
 */
export function gameOverMessage(state) {
  const side = humanSide(state);
  if (state.result === 'touchdown') {
    if (side === 'offense') return 'TOUCHDOWN — you win!';
    if (side === 'defense') return 'Touchdown. Game over — you lose.';
    return 'TOUCHDOWN — offense wins!';
  }
  const call = state.result === 'turnover-on-downs' ? 'Turnover on downs' : 'Turnover';
  if (side === 'offense') return `${call}. Game over — you lose.`;
  if (side === 'defense') return `${call} — you win!`;
  return `${call} — defense wins!`;
}

/** The New Game opening line, facing whichever way the human is facing.
 *  Hot-seat reads as the offense line — the drive is still yours to script. */
export function kickoffMessage(state) {
  return humanSide(state) === 'defense'
    ? 'New game. They start 1st and 10 from their own 20 — keep them out of the house.'
    : 'New game. 1st and 10 from your own 20 — 80 yards to the house.';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/hud.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`.

```bash
git add lib/game/hud.js test/game/hud.test.js
git commit -m "feat: kickoff and game-over copy that knows your side"
```

---

### Task 4: Wire the flow through the app

**Files:**
- Modify: `app/home.js`
- Modify: `app/main.js`

**Interfaces:**
- Consumes: `sideMarkup` (Task 1), `defaultModeForSide` (Task 2),
  `gameOverMessage`/`kickoffMessage` (Task 3), and `getVariant`
  (variants.js, already exported).
- Produces: `startGame({variant, side, onExit})` — `side` defaults to
  `'training'`, so any older caller still deals today's game.

No unit tests — these two files touch the DOM, which `node --test` does not
have; the codebase keeps all logic out of them for exactly this reason, and
Tasks 1–3 already hold everything these files merely wire together.
Verification is Step 3's browser walk.

- [ ] **Step 1: Rewire `app/home.js`**

Replace the imports at the top:

```js
import { homeMarkup, sideMarkup } from '../lib/game/home.js';
import { isPlayable, getVariant } from '../lib/game/variants.js';
```

Add a module-level holder and a reset function (after the `let game = null;`
declaration):

```js
// The variant whose side chooser is on screen, or null when the variant
// list is. Only the click handler reads it, so the two screens cannot get
// out of step with what a press means.
let pickedVariant = null;

function showChoices() {
  pickedVariant = null;
  home.innerHTML = homeMarkup();
}
```

Change `showHome` so every return from a game lands on the variant list:

```js
function showHome() {
  show(board, false);
  show(home, true);
  showChoices();
}
```

Change `start` to carry the side through:

```js
async function start(variantId, side) {
  // The unplayable button is disabled in the markup; this is that same rule
  // said again, because a disabled button is a picture and this is the gate.
  if (!isPlayable(variantId)) return;
  show(home, false);
  show(board, true);
  game ??= await import('./main.js');
  game.startGame({ variant: variantId, side, onExit: showHome });
}
```

Replace the bottom of the file (the `home.innerHTML = ...` line and the
click listener) with:

```js
// One listener on the section for both screens: the buttons are written in
// as markup, so matching on the way up means there is nothing to re-bind
// when the screen swaps from the game list to the side chooser and back.
home.addEventListener('click', (e) => {
  if (e.target.closest?.('[data-home-back]')) {
    showChoices();
    return;
  }
  const sideBtn = e.target.closest?.('[data-side]');
  if (sideBtn && pickedVariant) {
    start(pickedVariant, sideBtn.dataset.side);
    return;
  }
  const btn = e.target.closest?.('[data-variant]');
  if (btn && isPlayable(btn.dataset.variant)) {
    pickedVariant = btn.dataset.variant;
    home.innerHTML = sideMarkup(getVariant(pickedVariant));
  }
});
showHome();
```

- [ ] **Step 2: Rewire `app/main.js`**

Extend two existing imports:

```js
import { clearAiPlans, AI_MODES, aiModeIndex, nextAiMode, defaultModeForSide } from '../lib/game/ai.js';
```

```js
import { downDistanceText, gameOverMessage, kickoffMessage } from '../lib/game/hud.js';
```

Next to the module-level `variantId` holder (see the comment "Which game
this drive is" near the top), add:

```js
// How the human chose to play this visit — 'offense', 'defense' or
// 'training', held exactly the way variantId is: New Game re-deals it,
// Back to Home is how you change it.
let sideId = 'training';
```

In `startNewGame`, replace

```js
  state = createGame({
    seed: (Math.random() * 2 ** 31) | 0, ai: 'defense', aiLevel: 'smart', variant: variantId,
  });
```

with

```js
  const mode = defaultModeForSide(sideId);
  state = createGame({
    seed: (Math.random() * 2 ** 31) | 0, ai: mode.ai, aiLevel: mode.level, variant: variantId,
  });
```

and replace its say line

```js
  say('New game. 1st and 10 from your own 20 — 80 yards to the house.');
```

with

```js
  say(kickoffMessage(state));
```

In `goToNextDown`, replace the game-over say

```js
    say(state.result === 'touchdown' ? 'TOUCHDOWN — you win!'
      : state.result === 'turnover-on-downs' ? 'Turnover on downs. Game over — you lose.'
      : 'Turnover. Game over — you lose.');
```

with

```js
    say(gameOverMessage(state));
```

In `startGame`, accept and hold the side:

```js
export function startGame({ variant = DEFAULT_VARIANT, side = 'training', onExit = () => {} } = {}) {
  exitToHome = onExit;
  variantId = variant;
  sideId = side;
```

(the rest of the function is unchanged).

- [ ] **Step 3: Verify in the browser**

Run: `npm test` first — all green (nothing in this task can break lib
tests, so a failure here means a lib file was touched by mistake).

Then `npm run serve`, open http://localhost:8080 and walk the flow:

1. Home shows 7/11 as before. Press **7 Player** → the side chooser appears
   (Play Offense / Play Defense / Training Mode / Back).
2. Press **Back** → the variant list returns.
3. **7 Player → Training Mode** → game starts; the message is the familiar
   "80 yards to the house" line; the Coaches Menu mode button reads
   "Defense: computer (smart)". This path must feel identical to the game
   before this feature existed.
4. Back to Home → **7 Player → Play Offense** → same offense experience,
   but the mode button reads "Defense: computer (learned)" and the defense
   stands in its learned formation.
5. Back to Home → **7 Player → Play Defense** → the message is the "keep
   them out of the house" line; the mode button reads
   "Offense: computer (learned)"; the OFFENSE lines up in the computer's
   learned formation and you can drag defenders.
6. Coaches Menu → **New Game** re-deals the same choice; **Back to Home**
   returns to the variant list.
7. No console errors anywhere in the walk.

(If verifying in the embedded preview pane rather than a real browser, turn
animations crawl — `requestAnimationFrame` barely fires there. The flow,
labels, and messages above are all still checkable; only smooth playback is
not.)

- [ ] **Step 4: Commit**

```bash
git add app/home.js app/main.js
git commit -m "feat: pick your side on the home screen"
```

---

## Verification checklist (whole plan)

- `npm test` green from a clean checkout.
- The browser walk in Task 4 Step 3 passes end to end.
- Training Mode is byte-for-byte the old default game (smart defense, same
  kickoff line, same win/lose calls) — the current mode, as is, under its
  new name.
- Play Offense faces the learned defense; Play Defense starts against the
  learned offense with defense-facing copy at kickoff and the final whistle.
