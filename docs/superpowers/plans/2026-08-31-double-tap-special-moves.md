# Double-Tap Special Moves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the long press. A **double tap** on a player toggles his
special move (tuck / prepare to tackle / defend position / cut block), a
**double tap then drag** off him throws the ball exactly as it does today, and
**dragging back onto him** calls the throw off and leaves the double tap's
stance in its place. Separately, an armed cut block draws its grey friction
ring from the moment it is enabled rather than only during the drive turn, so
the board says whether the move is on.

**Architecture:** `classifyGesture` (`lib/game/gesture.js`) already decides
"drag vs tap" and already knows whether this player was tapped a moment ago
(`prevClickAt`, kept by `app/input.js`). Today those two facts combine into
three of the four verbs and a *duration* threshold produces the fourth
(`longpress`). This plan deletes the duration threshold and lets the same two
facts produce all four: armed + no travel is the new `doubletap`, which
inherits the entire body of the old `longpress` branch in `app/main.js`. The
cancel rule is the one piece the classifier cannot decide — it is a fact about
where the player's body is, not about the pointer — so it becomes a small pure
predicate in `lib/game/pass.js` (`backOnPasser`) that `app/main.js` applies to
downgrade a `passdrag` back to a `doubletap`. The cut-block indicator is a
one-condition widening in `render.js`'s `playerMark`.

**Tech Stack:** Plain ES modules, `node --test` (`npm test`). No new
dependencies, no build step, no new constants.

**Spec:** The user's own request, quoted in full because there is no separate
spec document for this feature:

> Currently, when a user long presses on a player, it activates their special
> move. I'd like to keep their special move, but make double tap activate it
> instead, and remove the long press mechanic. When double tapping on a person
> who has the ball, this should enable tuck. if you double tap and drag, that
> should then start the pass selection, if you drag back onto the player, it
> would cancel the pass and go back to the tuck. Please make the cut block show
> the grey "extra friction" area once it's enabled, not just during the next
> turn. I'd like this to signify that this special move is enabled or not as
> right now this is not indicator showing for the cut block other then the
> message on screen.

## Global Constraints

- No npm dependencies, no build step, no DOM or `node:` imports inside
  `lib/game/` (existing project-wide rule).
- `npm test` (`node --test`) must pass after every task.
- Comment style: prose explaining **why**, matching the density and voice of
  the surrounding file. Never write a comment that only restates the code.
- No new constants. `DRAG_MIN_UNITS` (4), `DOUBLE_TAP_MS` (400) and
  `PICK_SLOP_UNITS` (2) already exist and are reused as-is.
- `PLAN.md` at the repository root is the historical record of the original
  v1 build and is **not** updated by this plan. `README.md` is user-facing and
  **is**.

## Design decisions (resolving spec ambiguities — read before implementing)

1. **The stance applies only when the gesture *ends* as a double tap.**
   (Confirmed with the user.) A double-tap-drag released away from the player
   commits a throw and nothing else — the carrier is not left tucked. "Go back
   to the tuck" means falling back to what a plain double tap would have done,
   which is exactly what downgrading the gesture's kind achieves. Nothing is
   written to the state at the second `pointerdown`; every commit still happens
   on `pointerup`, as it does for every other verb in this game.

2. **The cancel is geometry about the player, not about the pointer.**
   `classifyGesture` measures *displacement* (`up - down`), not path length, so
   a second tap that wanders out and returns to its exact starting point
   already classifies as `doubletap` with no help. What it cannot catch is a
   finger that went down on one edge of a player and came up on the other:
   a lineman is 3.5 units across the radius, `DRAG_MIN_UNITS` is 4, so that
   round trip reads as a drag while never leaving him. `backOnPasser` closes
   that gap, in `lib/game/pass.js` where `receiverAt` already answers the
   neighbouring question with the same `PICK_SLOP_UNITS` margin.

3. **Cancelling clears a throw already on the board, and re-aims the snap.**
   The user said "cancel the pass"; the most useful reading is that a throw
   committed by an earlier gesture is called off too, which makes the whole
   thing reversible — double-tap-drag out to throw, double-tap-drag back to
   take it back. The catch is that on turn 0 the automatic snap *is* a planned
   pass (`aimSnap`, `state.js`), so a bare `clearPass` on the centre would
   leave a down that cannot start. `clearAllPlans` already solves this exact
   problem by calling `aimSnap` straight afterwards; the cancel path copies it.
   A plain double tap (no drag at all) does **not** touch an existing planned
   pass — only the drag-out-and-back gesture the user described as cancelling.

4. **Any press that does not travel is a tap.** With `LONGPRESS_MS` gone there
   is no duration threshold left, so pressing and holding a player for two
   seconds and releasing is a `click` (which arms the next gesture) rather than
   a stance. This is the plain consequence of deleting the mechanic the user
   asked to delete, and it is harmless: the only thing a stale-feeling arm can
   do is turn a run drag begun within 400ms into a throw, which is the same
   risk the existing tap-then-drag already carries.

5. **The armed cut block draws the same ring as the driving one.** (Confirmed
   with the user.) One `.drive-aura` circle for `cutBlock` and `cutBlockDrive`
   alike, so the mark reads as one thing: the move is on. Its radius
   (`player.radius + CUT_BLOCK_DRIVE_REACH`) is still exactly the distance
   `driveReachBonus` grabs at — during the lunge turn it is a promise of the
   turn after rather than a live hitbox, which is the honest thing for an
   "enabled" indicator to be.

6. **A cancelled drag previews as nothing.** While the finger is back over the
   player the preview layer is cleared, so the red throw arrow vanishes under
   it. That disappearance is the promise that releasing here throws nothing.
   There is no "stance preview" mark in `render.js` to show instead, and
   inventing one is outside what was asked.

7. **Non-carriers keep their existing fallback.** A `passdrag` from a man
   without the ball still commits a run arrow ("doesn't have the ball —
   running instead"), unchanged. Dragging back onto *him* cancels into his own
   special move (prepare to tackle / defend position), by the same downgrade —
   the rule is written about the gesture, not about the ball.

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `lib/game/gesture.js` | Pointer log → one of four verbs: `click`, `doubletap`, `drag`, `passdrag`. `LONGPRESS_MS` is gone. |
| `lib/game/pass.js` | Adds `backOnPasser(passer, point)` — "this throw drag came back to the man throwing it". Sits beside `receiverAt`, which answers the same shape of question about everyone else. |
| `app/main.js` | Reads `doubletap` where it read `longpress`; downgrades a `passdrag` that ended on the passer to `doubletap` and clears any planned pass; clears the drag preview in that state. |
| `app/input.js` | Unchanged behaviour (a `doubletap` disarms via the existing `else` branch); one comment refreshed. |
| `lib/game/render.js` | Draws the friction ring for `cutBlock` as well as `cutBlockDrive`. |
| `README.md` | "Double-tap a player" replaces "Long-press a player"; documents the cut block and the drag-back cancel. |

---

### Task 1: The gesture classifier learns the double tap

**Files:**
- Modify: `lib/game/gesture.js`
- Test: `test/game/gesture.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `classifyGesture(log, prevClickAt = null)` returning one of
  `{ kind: 'click' }`, `{ kind: 'doubletap' }`,
  `{ kind: 'drag', dir, throttle, travel }`, or
  `{ kind: 'passdrag', dir, throttle, travel }`. Exports `DRAG_MIN_UNITS` (4)
  and `DOUBLE_TAP_MS` (400). `LONGPRESS_MS` no longer exists.

- [x] **Step 1: Rewrite the classifier's tests**

Replace the whole of `test/game/gesture.test.js` with the file below. Three
tests change (the long-press one becomes a hold-is-just-a-tap one, and the two
that imported `LONGPRESS_MS` to build slow gestures now use plain millisecond
numbers), two are new (`doubletap`), and the rest are untouched.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGesture, DRAG_MIN_UNITS, DOUBLE_TAP_MS } from '../../lib/game/gesture.js';
import { MAX_ARROW_UNITS } from '../../lib/game/constants.js';

test('a quick tap with no movement is a click', () => {
  const g = classifyGesture([{ t: 0, x: 10, y: 10 }, { t: 120, x: 10.5, y: 10 }]);
  assert.deepEqual(g, { kind: 'click' });
});

test('holding still is just a click — duration means nothing now', () => {
  const g = classifyGesture([{ t: 0, x: 10, y: 10 }, { t: 2000, x: 11, y: 10 }]);
  assert.deepEqual(g, { kind: 'click' });
});

test('a second tap in time on the same player is a doubletap', () => {
  const tap = [{ t: 1100, x: 0, y: 0 }, { t: 1150, x: 0, y: 1 }];
  assert.deepEqual(classifyGesture(tap, 1000), { kind: 'doubletap' }, 'tapped 100ms before');
  assert.deepEqual(classifyGesture(tap), { kind: 'click' }, 'no tap at all: an ordinary tap');
  assert.deepEqual(
    classifyGesture(tap, 1100 - DOUBLE_TAP_MS - 1), { kind: 'click' },
    'a stale tap does not make a double tap',
  );
});

test('a long hold after a tap is still a doubletap, not a third thing', () => {
  const hold = [{ t: 1100, x: 0, y: 0 }, { t: 3000, x: 0, y: 1 }];
  assert.deepEqual(classifyGesture(hold, 1000), { kind: 'doubletap' });
});

test('moving past DRAG_MIN_UNITS is a drag with direction and throttle', () => {
  const g = classifyGesture([
    { t: 0, x: 10, y: 10 },
    { t: 100, x: 10, y: 20 },
    { t: 200, x: 10, y: 10 + MAX_ARROW_UNITS / 2 },
  ]);
  assert.equal(g.kind, 'drag');
  assert.deepEqual(g.dir, { x: 0, y: 1 });
  assert.equal(g.throttle, 0.5);
});

test('a drag past full length clamps throttle to 1', () => {
  const g = classifyGesture([
    { t: 0, x: 0, y: 0 },
    { t: 300, x: 0, y: MAX_ARROW_UNITS * 3 },
  ]);
  assert.equal(g.throttle, 1);
});

test('a slow drag is still a drag — movement wins over duration', () => {
  const g = classifyGesture([
    { t: 0, x: 0, y: 0 },
    { t: 1000, x: 20, y: 0 },
  ]);
  assert.equal(g.kind, 'drag');
});

test('tiny drags below the threshold fall back to click', () => {
  const g = classifyGesture([{ t: 0, x: 0, y: 0 }, { t: 100, x: DRAG_MIN_UNITS - 1, y: 0 }]);
  assert.deepEqual(g, { kind: 'click' });
});

test('a drag soon after a tap on the same player is a throw, not a run', () => {
  const log = [{ t: 1100, x: 0, y: 0 }, { t: 1200, x: 0, y: 20 }];
  assert.equal(classifyGesture(log, 1000).kind, 'passdrag', 'tapped 100ms before the drag');
  assert.equal(classifyGesture(log).kind, 'drag', 'no tap at all: an ordinary run arrow');
  assert.equal(classifyGesture(log, null).kind, 'drag');
  assert.equal(
    classifyGesture(log, 1100 - DOUBLE_TAP_MS - 1).kind, 'drag',
    'a stale tap does not arm a throw',
  );
});

test('a throw drag carries the same direction and throttle as a run drag', () => {
  const log = [{ t: 1100, x: 0, y: 0 }, { t: 1200, x: 0, y: MAX_ARROW_UNITS }];
  const g = classifyGesture(log, 1000);
  assert.equal(g.kind, 'passdrag');
  assert.deepEqual(g.dir, { x: 0, y: 1 });
  assert.equal(g.throttle, 1);
});

test('a drag out and back to where it started is a doubletap, not a throw', () => {
  const log = [
    { t: 1100, x: 0, y: 0 },
    { t: 1150, x: 0, y: 30 },
    { t: 1200, x: 0, y: 0 },
  ];
  assert.deepEqual(
    classifyGesture(log, 1000), { kind: 'doubletap' },
    'displacement, not path length, is what makes a drag',
  );
});

test('movement still beats repetition, armed or not', () => {
  const slow = [{ t: 1000, x: 0, y: 0 }, { t: 2000, x: 0, y: DRAG_MIN_UNITS + 1 }];
  assert.equal(classifyGesture(slow).kind, 'drag', 'no tap: a slow drag is still a drag');
  assert.equal(
    classifyGesture(slow, 900).kind, 'passdrag',
    'armed: a slow drag is a throw, never a stance',
  );
  assert.equal(
    classifyGesture(slow, 1000 - DOUBLE_TAP_MS - 1).kind, 'drag',
    'a genuinely stale tap does not arm a throw',
  );
});

test('a drag reports the raw drag vector alongside direction and throttle', () => {
  const g = classifyGesture([
    { t: 0, x: 100, y: 100 },
    { t: 50, x: 100, y: 112 },
  ]);
  assert.equal(g.kind, 'drag');
  assert.deepEqual(g.travel, { x: 0, y: 12 });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/gesture.test.js`

Expected: FAIL. `SyntaxError: The requested module '../../lib/game/gesture.js'
does not provide an export named 'LONGPRESS_MS'` is *not* what you should see
(the import of `LONGPRESS_MS` is gone) — instead the whole file fails on the
double-tap tests, e.g. `'a second tap in time on the same player is a
doubletap'` reporting `{ kind: 'click' }` where `{ kind: 'doubletap' }` was
expected, and `'holding still is just a click'` reporting
`{ kind: 'longpress' }`.

- [x] **Step 3: Rewrite the classifier**

Replace the whole of `lib/game/gesture.js` with:

```js
/**
 * Pointer-log → intent. The verbs on a player are a click (reposition,
 * pre-snap only), a hold-and-drag (set direction and force), a double tap
 * (toggle a stance mode), and a double-tap-then-drag (throw the ball). Two
 * facts decide all four: did the pointer travel, and was this same player
 * tapped a moment ago. Duration decides nothing — a slow deliberate drag is a
 * drag, and a press held for a second is a tap.
 */
import { sub, len, norm } from './vec.js';
import { MAX_ARROW_UNITS } from './constants.js';

export const DRAG_MIN_UNITS = 4;
export const DOUBLE_TAP_MS = 400;

/**
 * `prevClickAt` is when THIS SAME player was last tapped, or null if he wasn't
 * (app/input.js keeps that book, because it is pointer state). A gesture that
 * begins within DOUBLE_TAP_MS of that tap is the second half of a double tap:
 * released in place it is the stance toggle, and dragged away it is a throw
 * rather than a run. A throw carries the same direction and throttle as a run
 * drag — only the verb changes — so the caller reads one field to tell them
 * apart.
 *
 * What separates a drag from a tap is DISPLACEMENT, not path length, and that
 * is load-bearing for the cancel: a second tap that wanders out and comes back
 * to where it started is a `doubletap` here, with nobody having to ask about
 * it. The rest of "drag back onto the player" — coming up on his far edge,
 * further from the start than DRAG_MIN_UNITS but still on his body — is
 * geometry about the player rather than about the pointer, so it belongs to
 * the caller (pass.js's backOnPasser).
 */
export function classifyGesture(log, prevClickAt = null) {
  const down = log[0];
  const up = log[log.length - 1];
  const travel = sub(up, down);
  const armed = prevClickAt !== null && down.t - prevClickAt <= DOUBLE_TAP_MS;
  if (len(travel) >= DRAG_MIN_UNITS) {
    return {
      kind: armed ? 'passdrag' : 'drag',
      dir: norm(travel),
      throttle: Math.min(1, len(travel) / MAX_ARROW_UNITS),
      // The raw vector as well as the unit direction, because a run drag is
      // read two ways now: as a force (throttle, above — still what a throw
      // uses) and as a distance on the board, which is what predict.js turns
      // into the spot the player will actually reach.
      travel,
    };
  }
  return { kind: armed ? 'doubletap' : 'click' };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test test/game/gesture.test.js`
Expected: PASS, all tests.

- [x] **Step 5: Confirm nothing else imported the dead constant**

Run: `grep -rn "LONGPRESS_MS\|longpress" --include='*.js' . | grep -v node_modules`
Expected: no output. (`app/main.js`'s `longpress` branch is renamed in Task 3;
if this grep still shows it, that is expected until then — but the *constant*
must have no remaining importers.)

Run: `npm test`
Expected: PASS. `app/main.js` is not exercised by the suite, so the suite is
green even though the app's stance branch is momentarily dead code — Task 3
closes that in the same session.

- [x] **Step 6: Commit**

```bash
git add lib/game/gesture.js test/game/gesture.test.js && git commit -m "feat: a double tap, not a long press, is the second verb on a player"
```

---

### Task 2: `backOnPasser` — a throw drag that came home

**Files:**
- Modify: `lib/game/pass.js` (add one exported function after `receiverAt`)
- Test: `test/game/pass.test.js` (add one test; extend the existing import)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `backOnPasser(passer, point) → boolean`, where `passer` is a player
  object (needs `.pos` and `.radius`) and `point` is `{x, y}` in board units.
  True when the point is within `passer.radius + PICK_SLOP_UNITS` of his
  centre. `app/main.js` (Task 3) is the only caller.

- [x] **Step 1: Write the failing test**

In `test/game/pass.test.js`, add `backOnPasser` to the existing import from
`../../lib/game/pass.js` (the list that already carries `receiverAt`,
`lockOnPass`, `passLanding`), and append this test to the end of the file:

```js
test('a throw drag that ends on the passer himself is a cancel', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const edge = qb.radius + PICK_SLOP_UNITS;
  assert.equal(backOnPasser(qb, qb.pos), true, 'dead centre');
  assert.equal(
    backOnPasser(qb, { x: qb.pos.x + edge - 0.01, y: qb.pos.y }), true,
    'inside the same fat-finger margin every other pick uses',
  );
  assert.equal(
    backOnPasser(qb, { x: qb.pos.x + edge + 0.01, y: qb.pos.y }), false,
    'past it: a real throw, however short',
  );
  assert.equal(
    backOnPasser(qb, { x: qb.pos.x, y: qb.pos.y - edge + 0.01 }), true,
    'it is a disc, not a forward-only test',
  );
});
```

`PICK_SLOP_UNITS`, `createGame` and `getPlayer` are already imported by this
file; no other import changes are needed.

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/pass.test.js`
Expected: FAIL with `SyntaxError: The requested module
'../../lib/game/pass.js' does not provide an export named 'backOnPasser'`.

- [x] **Step 3: Write the implementation**

In `lib/game/pass.js`, directly after the closing brace of `receiverAt`, add:

```js
/**
 * Whether a throw drag has come back to rest on the man throwing it — the
 * coach calling the pass off. The margin is PICK_SLOP_UNITS, the same one
 * receiverAt gives every other man on the board, for the same reason: how
 * forgiving a drag is should not depend on which verb it is.
 *
 * This exists because gesture.js measures displacement rather than path, so a
 * drag that returns to its exact starting point is already a tap and needs no
 * help. What it cannot see is a finger that went down on one edge of a lineman
 * and came up on the other: that is 7 units of displacement against a
 * DRAG_MIN_UNITS of 4, a drag by the pointer's reckoning, while never having
 * left the player at all. Only the board knows how big he is, so the test
 * lives here rather than in the classifier.
 */
export function backOnPasser(passer, point) {
  return dist(passer.pos, point) <= passer.radius + PICK_SLOP_UNITS;
}
```

`dist` and `PICK_SLOP_UNITS` are already imported at the top of `pass.js`; no
import changes are needed.

- [x] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/pass.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib/game/pass.js test/game/pass.test.js && git commit -m "feat: a throw drag dropped back on the passer is a cancel"
```

---

### Task 3: Wire the double tap and the cancel into the board

**Files:**
- Modify: `app/main.js` (imports; `hitTest` comment; `onGesture`;
  `onDragPreview`)
- Modify: `app/input.js` (one comment)

**Interfaces:**
- Consumes: `classifyGesture` returning `'doubletap'` (Task 1) and
  `backOnPasser(passer, point)` from `../lib/game/pass.js` (Task 2). Also
  `clearPass(state)` and `aimSnap(state)` from `../lib/game/state.js` —
  `aimSnap` is already imported; `clearPass` is not.
- Produces: nothing consumed by later tasks.

**Why there is no unit test here:** `app/main.js` is the DOM shell. It imports
`./vendor/svg.esm.js` and touches `document`, so `node --test` cannot load it
and no test in `test/` does. Every decision this task makes that *could* be
tested in isolation was pushed into Tasks 1 and 2 for exactly that reason.
Step 6 is a hand-run browser script; do not skip it.

- [x] **Step 1: Extend the imports**

In `app/main.js`, add `clearPass` to the existing `state.js` import list, so it
reads:

```js
import {
  createGame, setPlan, setMode, getPlayer, clearAllPlans, isControllable, setPass, ballPos,
  aimSnap, clearPass,
} from '../lib/game/state.js';
```

and add `backOnPasser` to the existing `pass.js` import:

```js
import { receiverAt, lockOnPass, passLanding, backOnPasser } from '../lib/game/pass.js';
```

- [x] **Step 2: Rewrite `onGesture`'s verb dispatch**

In `app/main.js`, replace everything from `if (gesture.kind === 'passdrag') {`
through the end of `onGesture` with the block below. The `passdrag` and `drag`
bodies are byte-identical to what is there now; what changes is the `kind`
they are switched on, the new cancel paragraph above them, and the former
`longpress` branch becoming `doubletap`.

```js
  // A throw drag dropped back on the man throwing it is not a throw at all: it
  // is the double tap that started it, with the pass called off. Decided here
  // rather than in classifyGesture because it is a fact about how big the
  // player is, not about the pointer — the classifier only ever sees
  // coordinates. Everything downstream then reads one verb, so the cancel
  // needs no branch of its own.
  const cancelled = gesture.kind === 'passdrag' && backOnPasser(p, point);
  if (cancelled && state.plannedPass && state.plannedPass.from === playerId) {
    // "Cancel the pass" means the throw already on the board too, not only the
    // one this drag was drawing — which is what makes the gesture reversible.
    // Re-aiming the snap afterwards is what clearAllPlans does for the same
    // reason: taking back the coach's throw must leave a down that can still
    // start, not a centre standing on the ball.
    clearPass(state);
    aimSnap(state);
  }
  const kind = cancelled ? 'doubletap' : gesture.kind;
  if (kind === 'passdrag') {
    // Double-tap-then-drag is a throw only from the man with the ball. From
    // anyone else it is an ordinary run arrow — which is what the drag preview
    // showed him, so committing anything less would break that promise.
    //
    // Dropping it on one of your own inside the lock zone aims the throw at
    // HIM: direction and power both come from where he is standing, and the
    // drag's own length stops mattering. That is the same bargain a run drag
    // onto an opponent already makes when it becomes a cover order.
    const lock = state.ball.carrierId === playerId ? receiverAt(state, point, playerId) : null;
    const rec = lock ? getPlayer(state, lock) : null;
    const aim = rec ? lockOnPass(p, rec) : { dir: gesture.dir, power: gesture.throttle };
    if (setPass(state, playerId, aim.dir, aim.power, lock)) {
      say(rec ? `${p.role} will throw to ${rec.role}.`
        : passLanding(p, aim.dir, aim.power) ? `${p.role} will lob it deep.`
        : `${p.role} will throw.`);
    } else {
      const run = planForDrag(p, gesture.travel);
      setPlan(state, playerId, run.dir, run.throttle, run.target, run.short);
      say(`${p.role} doesn't have the ball — running instead.`);
    }
    pendingWarning = false;
  } else if (kind === 'drag') {
    const opp = opponentAt(state, point, p.team);
    if (opp && setCover(state, playerId, opp)) {
      say(`${p.role} will cover ${getPlayer(state, opp).role}.`);
    } else {
      const run = planForDrag(p, gesture.travel);
      setPlan(state, playerId, run.dir, run.throttle, run.target, run.short);
      say('');
    }
    pendingWarning = false;
  } else if (kind === 'doubletap') {
    const target =
      p.mode !== 'normal' ? 'normal'
      // An offensive lineman can never tuck (setMode refuses it outright), so
      // this has to be checked before the carrier-tucked branch below —
      // otherwise a double tap on the centre pre-snap (he's the placeholder
      // ball carrier before the snap) would offer 'tucked' and setMode would
      // silently refuse it. On the snap itself he gets the cut block instead;
      // any other turn he falls through to holding like any other lineman.
      : p.team === 'offense' && OFFENSIVE_LINE_ROLES.has(p.role) && state.turnIndex === 0 ? 'cutBlock'
      : state.ball.carrierId === playerId && !OFFENSIVE_LINE_ROLES.has(p.role) ? 'tucked'
      : p.team === 'defense' ? 'prepared'
      : 'holding';
    if (!setMode(state, playerId, target)) say(`${p.role} can't do that.`);
    else say(target === 'normal' ? `${p.role} back to normal.` : `${p.role}: ${target === 'cutBlock' ? 'cut block' : target}.`);
  }
  // kind === 'click': a single tap on a player does nothing on its own. Moving
  // him is a drag, and only in reposition mode — one tap is how you arm the
  // second, and it cannot also be how you move somebody.
  paint();
}
```

Leave the `if (repositioning) { ... }` block above this untouched, including
its comment. It still keys off `gesture.kind` rather than `kind`, and that is
deliberate: setting a formation has no stances and no throws to cancel, so a
drag out and back is a move onto the spot he is already standing on — a
harmless no-op either way, and not worth a second code path.

- [x] **Step 3: Clear the preview while the drag is home**

In `app/main.js`, replace the tail of `onDragPreview` — everything from the
`// A throw only previews as a throw...` comment to the end of the function —
with:

```js
  // A throw only previews as a throw from the man actually holding the ball;
  // from anyone else a double-tap-drag is an ordinary run. Both marks come
  // from render.js, so the arrow being dragged and the arrow committed are the
  // same picture either way.
  const tip = log[log.length - 1];
  if (g.kind === 'passdrag' && backOnPasser(p, tip)) {
    // Back on the man himself: releasing here throws nothing, so nothing is
    // drawn. The arrow vanishing out from under the finger is the promise that
    // the pass is off.
    layer('game-preview').clear();
    return;
  }
  const throwing = g.kind === 'passdrag' && state.ball.carrierId === playerId;
  const mark = throwing
    ? throwMark(p, g, tip)
    : runOrCoverMark(p, g.travel, tip);
  layer('game-preview').clear().svg(mark);
}
```

- [x] **Step 4: Refresh the two stale comments in this file**

In `app/main.js`'s `hitTest`, change:

```js
    // The computer's players take no orders. Gating here covers all three ways
    // in — drag, drag preview, and long-press — because every one of them
    // starts from a hit test that returns a player id.
```

to:

```js
    // The computer's players take no orders. Gating here covers all three ways
    // in — drag, drag preview, and double tap — because every one of them
    // starts from a hit test that returns a player id.
```

In `app/input.js`, change the `lastTapAt` comment:

```js
  // When each player was last tapped. A tap arms the NEXT gesture on that same
  // player: released in place it is a double tap (his special move), dragged
  // away it is a throw. Anything else disarms him, so a tap from ten seconds
  // ago can never turn a run into a throw. classifyGesture owns the timing
  // rule; this map only remembers the tap.
```

No code changes in `app/input.js` — a `doubletap` already falls into the
existing `else lastTapAt.delete(playerId)`, which is right: it means a third
tap starts a fresh pair rather than firing the stance again.

- [x] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS (unchanged — nothing in `test/` loads `app/main.js`).

Run: `grep -rn "longpress\|LONGPRESS" --include='*.js' . | grep -v node_modules`
Expected: no output.

- [ ] **Step 6: Verify by hand in the browser**

```bash
npm run serve
```

Open <http://localhost:8080> and start a game. Work through every line; each
one must hold before you commit.

1. **Double tap the QB after the snap** (run a turn first so he has the ball) —
   the message reads `QB: tucked.` and the football moves inside his circle.
2. **Double tap him again** — `QB back to normal.`; the football returns to his
   leading edge.
3. **Double tap a defender you control** — `... prepared.` and the dashed
   quarter-circle arc appears facing his direction of travel.
4. **Double tap a non-lineman offensive player without the ball** —
   `... holding.` with the same arc.
5. **Single tap a player and wait a second, then release nothing else** —
   nothing happens. No stance, no message.
6. **Press and hold a player for three seconds, then release** — nothing
   happens (this is the removed long press; it must be inert).
7. **Tap the ball carrier, then press and drag away and release** — the red
   throw arrow previews under the finger and the message reads `... will
   throw.` on release. Unchanged from before.
8. **Tap the carrier, drag out until the red arrow shows, then drag back over
   his own circle and release** — the red arrow disappears while the finger is
   over him, and on release the message is the stance one (`QB: tucked.`), not
   a throw. Press Run Turn: no pass is thrown.
9. **Commit a throw (step 7), then double-tap-drag out and back on the same
   man** — the previously committed red arrow is gone from the board and he is
   tucked instead.
10. **Pre-snap, double-tap-drag the centre out and back** — he ends up in the
    cut block (`C: cut block.`), and the automatic red snap arrow to the QB is
    still on the board. This is the `aimSnap` re-arm; if the snap arrow is
    missing, Step 2's cancel paragraph is wrong.
11. **Enter reposition mode and double-tap-drag a player** — he moves to the
    drop spot as before. No stance is set.

- [x] **Step 7: Commit**

```bash
git add app/main.js app/input.js && git commit -m "feat: double tap sets the stance, and dragging home takes the throw back"
```

---

### Task 4: The cut block shows its friction ring the moment it is on

**Files:**
- Modify: `lib/game/render.js` (the `.drive-aura` style comment, the
  `driveAura` doc comment, one condition in `playerMark`)
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing consumed by later tasks. `renderPlayers(state, opts)` is
  unchanged in signature; it now emits `class="drive-aura"` for a player whose
  `mode` is `'cutBlock'` as well as `'cutBlockDrive'`.

- [x] **Step 1: Write the failing test**

In `test/game/render.test.js`, insert this test immediately after the existing
`'a driving blocker draws his friction aura at radius + CUT_BLOCK_DRIVE_REACH'`
test:

```js
test('an armed cut block draws the same ring, a turn before it drives', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-lg').mode = 'cutBlock';
  const group = renderPlayers(s).match(/data-id="o-lg"[\s\S]*?<\/g>/)[0];
  const match = group.match(/<circle cx="0" cy="0" r="([-\d.]+)" class="drive-aura"\/>/);
  assert.ok(match, 'the ring is the indicator that the move is enabled, so it is on now');
  const expected = getPlayer(s, 'o-lg').radius + CUT_BLOCK_DRIVE_REACH;
  assert.ok(Math.abs(Number(match[1]) - expected) < 1e-6, 'and at the radius that will grab');
});
```

Everything it needs (`createGame`, `getPlayer`, `renderPlayers`,
`CUT_BLOCK_DRIVE_REACH`) is already imported by that file.

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/render.test.js`
Expected: FAIL on `an armed cut block draws the same ring, a turn before it
drives` — `AssertionError: the ring is the indicator that the move is enabled,
so it is on now` (the regex found nothing, because `playerMark` still only
draws the ring for `cutBlockDrive`).

- [x] **Step 3: Widen the condition and say why**

In `lib/game/render.js`, change the `playerMark` line:

```js
  if (player.mode === 'cutBlockDrive') parts.push(driveAura(player));
```

to:

```js
  if (player.mode === 'cutBlock' || player.mode === 'cutBlockDrive') parts.push(driveAura(player));
```

Then update `driveAura`'s doc comment to:

```js
/**
 * The cut block's friction zone: a dashed ring at
 * player.radius + CUT_BLOCK_DRIVE_REACH — the same extra distance
 * physics.js's driveReachBonus adds to every collision he is a party to, so
 * the ring on the board is literally the radius that grabs.
 *
 * Drawn from the moment the move is enabled (mode 'cutBlock', during
 * planning) and not only once he is driving, because this ring is the only
 * thing on the board that says the cut block is on at all — a stance arc is
 * what every other special move gets, and this one had nothing but a line of
 * message text. On the lunge turn it is a promise about the turn after rather
 * than a live hitbox; that is the honest shape for an "enabled" mark, and it
 * is the same ring either way so there is only one thing to learn.
 */
```

And update the style comment above `.drive-aura` in `STYLE_GAME` to:

```js
  // The cut block's friction zone: the same radius physics.js's
  // driveReachBonus actually grabs at, so the ring on the board is the
  // radius that grabs, not a decoration guessing at it. It doubles as the
  // move's on/off indicator — see driveAura, below.
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test test/game/render.test.js`
Expected: PASS, including the existing `'nobody else draws the drive aura'`
(every player starts in `'normal'`, so it is unaffected).

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Verify by hand**

```bash
npm run serve
```

Pre-snap, double tap an offensive guard. The message reads `LG: cut block.`
**and** a faint dashed grey ring now appears around him immediately. Double tap
him again: `LG back to normal.` and the ring disappears. Set it again and press
Run Turn — the ring stays on him through the lunge turn and through the drive
turn that follows, then goes when he returns to normal.

- [x] **Step 6: Commit**

```bash
git add lib/game/render.js test/game/render.test.js && git commit -m "feat: the cut block's friction ring is its on switch, not its aftermath"
```

---

### Task 5: The manual, and the last of the long press

**Files:**
- Modify: `README.md` (the stance bullet and the throw bullet, lines 203–217)
- Modify: `lib/game/turn.js` (one comment, ~line 65)
- Modify: `lib/game/constants.js` (one comment, ~line 77)
- Modify: `test/game/play.test.js` (one assertion message, ~line 140)
- Modify: `test/game/state.test.js` (one comment, ~line 90)

**Interfaces:**
- Consumes: the behaviour shipped by Tasks 1–4.
- Produces: nothing.

- [x] **Step 1: Rewrite the README's stance bullet**

In `README.md`, replace the eleven lines from `- **Long-press a player** to
toggle their stance,` through `  Long-press the same player again to go back to
normal.` with:

```markdown
- **Double-tap a player** to toggle their special move. Most of them are shown
  by a quarter-circle arc around them facing their direction of travel:
  - The **ball carrier** double-tapped **tucks** the ball in — a little slower,
    but much better protected against fumbling.
  - A **defender** double-tapped gets ready to **tackle**: they slow down a lot,
    but gain extra reach and a better chance of bringing the runner down.
  - An **offensive lineman** double-tapped *before the snap* throws a **cut
    block**: as the turn starts he lunges at the man across from him and shoves
    him back half a yard, then spends the turn after driving — slow, but with a
    grey ring of extra friction around him that nobody slides through, and a
    speed boost for any teammate running past inside it. He gets that grey ring
    from the moment you set it, so you can see the move is on before you run
    the turn. Linemen only, first turn only.
  - Any other **offensive player** double-tapped drops into **defend position**:
    movement is severely limited, but their reach goes up and they become much
    harder to shove out of the way — useful for holding a block.

  Double-tap the same player again to go back to normal.
```

- [x] **Step 2: Add the cancel to the README's throw bullet**

In `README.md`, change the opening of the throw bullet from:

```markdown
- **Tap the ball carrier, then drag** to throw.
```

to:

```markdown
- **Tap the ball carrier, then press and drag** to throw — the second tap of a
  double tap, held and pulled away instead of released. Drag back onto him and
  let go and the throw is called off: any pass you had planned is torn up and
  you get the double tap's tuck instead.
```

Leave the rest of that bullet, and its two sub-bullets (lock-on and lob),
exactly as they are.

- [x] **Step 3: Refresh the four stale code comments**

In `lib/game/turn.js`, change `// moment the turn actually starts — not back
when the coach long-pressed` to `// moment the turn actually starts — not back
when the coach double-tapped`.

In `lib/game/constants.js`, change `// the snap, not to the long press.` to
`// the snap, not to the double tap that called it.`

In `test/game/play.test.js`, change the assertion message `'the stance arms the
next-turn burst, as a long press would'` to `'the stance arms the next-turn
burst, as a double tap would'`.

In `test/game/state.test.js`, change `// this used to be exactly the bug where
a long press on the centre before` to `// this used to be exactly the bug where
a double tap on the centre before`.

- [x] **Step 4: Verify nothing is left**

Run: `grep -rni "long press\|long-press\|longpress" --include='*.js' --include='*.md' . | grep -v node_modules | grep -v '^./PLAN.md' | grep -v '^./docs/superpowers/plans/'`
Expected: no output. (`PLAN.md` and the archived plans under
`docs/superpowers/plans/` are historical records and are left alone; note that
`README.md:382` quotes the *original spec* verbatim inside the "Design notes"
section and its mention of "activated by a long press" is part of that quote —
if the grep surfaces it, confirm it is inside the quoted spec paragraph and
leave it.)

Run: `npm test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add README.md lib/game/turn.js lib/game/constants.js test/game/play.test.js test/game/state.test.js && git commit -m "docs: the long press is gone; the double tap is how a special move goes on"
```
