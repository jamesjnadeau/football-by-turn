# Full-Field Downs and Possession Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 sandbox's single fixed "goal-to-go from the 10, 4 downs, no first downs" drive with a real football down structure on a full field: the offense starts **1st and 10 from its own 20**, 80 yards from the opponent's goal, and has to **reach the line to gain within 4 downs to earn a fresh set of downs** — over and over, however many sets it takes to score. The one thing that does not change is the win condition already built: **any way the offense loses the ball — sacked back into a 4th-down failure, a fumble the defense recovers, an interception, a flag that wipes a touchdown — ends the game as a loss**, exactly as turnovers already do today. Only a touchdown wins.

**Architecture:** The game is already single-drive, and that stays: there is still one offense, no possession swap, no clock, no scoreboard — this plan does not turn it into a two-team season. What changes is what "the drive" covers. Today `state.losYard` is a small number (0–10) measured from a drive-start line that the *view* also treats as fixed, because the whole legal range of play (goal-to-go from the 10, at most a short sack backward) fits inside one 40-yard window that never has to move. Once a drive can run from the 20 to the opponent's goal, `losYard` has to mean **absolute yards from the offense's own goal line** (0–100) so a play never runs out of coordinate space, and the *view* has to become a scrolling camera that recentres on the line of scrimmage every down instead of a fixed crop. Those are the two structural changes everything else hangs off: `lib/game/view.js` gets a movable window (Task 1); `lib/game/state.js` starts the drive at yard 20 instead of yard 0 and tracks the current line-to-gain (Task 2); `lib/game/rules.js`'s `nextDown` grows the actual "did they make it" logic real football has instead of always ending the game after a fixed four downs (Task 3); `lib/game/render.js` draws the line-to-gain marker and stops assuming the camera never moves (Task 4); a new `lib/game/hud.js` turns state into the down/distance/spot text a broadcast would show (Task 5); `app/main.js` wires the new text and win/lose language in (Task 6); README and a full regression pass close it out (Task 7).

Crucially, the *physics* coordinate system does not move. `fieldPos`/`yardsOfY` (`lib/game/view.js`) already convert an absolute yard number to an SVG position through one fixed `anchorY`/`scaleY` pair; every player position, tackle-reach check, and pickup-radius test in `physics.js`/`rules.js`/`modes.js` goes through them and needs no change at all. Only the *camera* — which slice of that fixed coordinate space the SVG `viewBox` currently shows — becomes a function of `losYard` instead of a constant. Keeping those two things (a fixed physics frame, a movable camera) strictly separate is what keeps this a view-and-rules change instead of a physics rewrite.

**Tech Stack:** Plain ES modules, SVG, Node 20+ built-in test runner (`node --test`). No build step, no npm dependencies.

**Spec:** The request this plan implements, verbatim:

> using the existing 7 player engine, extend it to be more like a full game, Play should start at the 20 yard line, 80 yards from the goal, the game should work like real football, with the user having to get a first down to get a new set of downs. If they lose possession of the ball, they lose.

## Global Constraints

- No npm dependencies and no build step. `package.json` stays as-is.
- Everything under `lib/` stays pure: no `document`, no `window`, no `node:` imports, no `Date.now()`, no unseeded `Math.random()`. DOM code lives only under `app/`.
- Vendored files (`lib/field/*`, `app/vendor/svg.esm.js`) are never edited. The line-to-gain marker is drawn by `lib/game/render.js` as an extra shape composited alongside `renderField`'s output — not by teaching the vendored `field.js` a second kind of line.
- Every tunable number goes in `lib/game/constants.js` (gameplay tuning) or stays beside the geometry it describes in `lib/game/view.js` (field landmarks like the goal line) — matching where `GOAL_YARD`/`END_YARD` already live today.
- Tests use `node:test` + `node:assert/strict`, one file per module under `test/game/`. Run everything with `npm test`. The suite is **329/329** before this plan starts; it must be green at every commit.
- **Unlike a normal feature plan on this codebase, existing tests that assert the old semantics — a drive starting at `losYard === 0`, `GOAL_YARD === 10`, "the game always ends after down 4" — are expected to change.** That behavior is exactly what this plan replaces, so a test that pins it is a test of the thing being removed, not a regression guard. Every other existing test (physics, tackling, passing, rendering mechanics, AI) must stay green untouched; if one of those starts failing, that is a bug in the change, not a stale test.
- The computer opponent, passing/handoffs, playbook, and repositioning/formation-legality features all keep working unchanged — none of them reason about the absolute value of `losYard`, only about offsets from it (confirmed: `formation.js` and `defense.js` only ever call `fieldPos(0, state.losYard + offset)`).

## Design decisions (read before implementing)

1. **`losYard` changes meaning: from "yards past the old drive-start line" to "yards from the offense's own goal line," 0–100.** This is the one conceptual change everything else follows from. `GOAL_YARD` (the line the offense attacks) moves from 10 to 100; a new `OWN_GOAL_YARD = 0` names the other end; `END_YARD` (the back of the attacked end zone) moves from 20 to 110. The drive starts at the new constant `DRIVE_START_YARD = 20`.
2. **The coordinate system stays fixed; only the camera moves.** `fieldPos`/`yardsOfY` keep converting yards to SVG units through one unchanging `anchorY`/`scaleY`, derived once from a constant low bound (`FIELD_LOW_YARD`) the same way `ANCHOR_Y` is derived today — just from a different constant. `gameView(losYard)` is the only thing that becomes camera-aware: it computes a 40-yard window (`WINDOW_YARDS`) that follows the line of scrimmage, clamped so it never scrolls past either end of the true field. The window's height is fixed; only its position slides. This is what lets a drive run the full 80 yards without the SVG growing to hold the whole field at once, and it is why no physics file (`physics.js`, `modes.js`, tackle/pickup checks in `rules.js`) needs to change: they only ever see the fixed, global mapping.
3. **A first down is real: reaching or passing the line to gain resets the count.** `state.toGoYard` is the absolute yard the offense must reach for a fresh set of downs, seeded at `min(losYard + FIRST_DOWN_YARDS, GOAL_YARD)` on every new set. `nextDown` checks the spot against it before deciding whether the down counter resets to 1 (a first down) or increments (still working on this set). Inside the 10 the marker is clamped to the goal line itself — "goal to go" — which naturally reproduces the one case real football has no first down for.
4. **Losing the ball still just ends the game — that machinery is not new, it is being kept.** `nextDown` already treats a defensive recovery (`result: 'turnover-fumble'`, which already covers interceptions too, since a thrown ball and a fumble share the same loose-ball code) and a failed 4th down (`result: 'turnover-on-downs'`) as immediate `gameOver`s. The only change here is making "failed 4th down" a real football condition — failing to reach the *current* line to gain on 4th down, from wherever that set of downs started — instead of "always the 4th down from a fixed start." The messaging in `app/main.js` is tightened to say "you lose" explicitly for both cases (today only the touchdown message says "you win!"; the loss side says "Game over" without the mirroring "you lose").
5. **A penalty enforcement never grants a first down, real football's rule for an accepted foul.** `nextDown`'s `enforcing` branch already wipes whatever a play gained and marks it a loss of down; this plan keeps that and explicitly gates the first-down check on `!enforcing`, so an illegal-forward-pass touchdown or big gain can never accidentally convert a set of downs on the way to being erased.
6. **No safety rule, deliberately.** The spec asks for real downs and a real field length, not a full scoring system — there is still no scoreboard, no second offense, no points. If the offense gets pinned deep and sacked behind or near its own goal line, this plan does not invent a safety; it just keeps the ball spottable no closer than `MIN_SPOT_YARD` to the offense's own goal (8 yards — one more than the running back's 7-yard split in the formation, `state.js`'s `OFFENSE` array, so the backfield never has to line up behind the goal line). That number replaces today's `TOP_YARD + 8` clamp, which existed for the same reason (keeping the formation on the drawn field) but was expressed in the old, drive-relative coordinate system.
7. **The offense's own goal line is drawn like any other yard line, not as a second end zone.** `lib/field/field.js` (vendored, never edited) only knows how to hatch one end zone, keyed off its one `goalYard`. Since this plan adds no safety rule, there is nothing that specifically happens at the offense's own goal line, so it does not need one — it is just yard 0, labelled `G` like any other landmark, drawn only when the scrolling window happens to include it.
8. **The line-to-gain is drawn, not just reported in the HUD.** A solid line in its own colour (distinct from the dashed black line of scrimmage and the dashed green/red plan and pass arrows), positioned by `fieldPos`/`yardsOfY` the same as everything else, composited into the `game-field` group by `lib/game/render.js` after the vendored `renderField` output. It is omitted when `toGoYard` is at or past the drawn window (goal-to-go close enough that the goal line itself already marks it) or off the top/bottom of the current camera.
9. **`renderMessage`, `renderFieldButtons`, and `menuButtonMark` currently compute their vertical position from `gameView(0)`** — harmless today only because the camera never moved, so yard 0 in the old scheme and the true camera were the same window. Once the camera scrolls with `losYard`, those three have to be given the *current* `losYard` instead, or the message plate and the two on-field buttons will end up positioned inside whatever window `losYard === 0` happens to frame, which is no longer the window actually being drawn. This is called out explicitly because it is the one place a hardcoded `0` silently used to be correct and stops being so.

## File Structure

```
lib/game/
├── constants.js   # + DRIVE_START_YARD, FIRST_DOWN_YARDS, MIN_SPOT_YARD,
│                  #   WINDOW_YARDS, WINDOW_BEHIND_YARDS, FIELD_LOW_YARD
├── view.js        # gameView() becomes a scrolling window; GOAL_YARD 10->100,
│                  #   END_YARD 20->110; + OWN_GOAL_YARD; TOP_YARD removed
│                  #   (superseded by the per-view window); fieldPos/yardsOfY
│                  #   unchanged in code, just fed the new constants
├── state.js       # createGame starts at DRIVE_START_YARD; + state.toGoYard
├── rules.js       # nextDown: real first-down/loss-of-down logic, MIN_SPOT_YARD
│                  #   clamp replaces the old TOP_YARD-based one
├── render.js      # renderBoardShell/menuButtonMark/buttonColumnMidY/
│                  #   renderMessage/renderFieldButtons take the current
│                  #   losYard instead of assuming a fixed camera;
│                  #   + lineToGainMark; STYLE_GAME + `.ftg`
└── hud.js         # NEW: downDistanceText(state), spotText(yard)
test/game/
├── view.test.js, state.test.js, rules.test.js, turn.test.js,
│   integration.test.js, render.test.js, formation.test.js, defense.test.js
│                  # updated for the new coordinate scheme; new cases for
│                  #   first-down reset, mid-field turnover-on-downs, window
│                  #   scrolling/clamping
└── hud.test.js    # NEW
app/main.js         # HUD text via hud.js; drawMessage/rebuildBoard/
                     #   renderFieldButtons pass state.losYard/toGoYard;
                     #   win/lose wording; new-game/kickoff message
README.md           # "How to play" and "v1 interpretation decisions" updated
                     #   for the 80-yard field and real first downs
```

---

### Task 1: A fixed physics frame, a scrolling camera

**Files:**
- Modify: `lib/game/constants.js` (append the window/field constants)
- Modify: `lib/game/view.js`
- Test: `test/game/view.test.js`

**Interfaces:**
- Produces: `OWN_GOAL_YARD = 0`, `GOAL_YARD = 100`, `END_YARD = 110` (replacing 10/20); `gameView(losYard) -> view` where the returned view's `fieldTopY`/`bottomYard`/`goalYard`/`goalPosts`/`yardLines`/`windowTopY`/`height` describe a 40-yard camera centred behind `losYard`, clamped to `[FIELD_LOW_YARD, END_YARD]`; `fieldPos`/`yardsOfY` keep their existing signatures and behavior, just built on the new constants.
- Removes: the `TOP_YARD` export (no longer meaningful — there is no single fixed top of the drawn field any more, only the current window's).

- [ ] **Step 1: Add the new constants**

In `lib/game/constants.js`, append a `--- the full field ---` section:

```js
// --- the full field ---
// Real football: kickoff-return position, not literally a kickoff (this game
// has none) -- the offense's first set of downs starts 1st and 10 from its
// own 20, same as after a touchback.
export const DRIVE_START_YARD = 20;
// Real football: the yardage a set of downs must reach for a fresh one.
export const FIRST_DOWN_YARDS = 10;
// How close to the offense's own goal line a new set of downs may be spotted.
// One yard behind the running back's own 7-yard split in the drive-start
// formation (state.js's OFFENSE), so the backfield never has to line up
// behind the goal line. This game has no safety rule (see the plan's design
// decisions) -- this clamp exists to keep formations on the field, not to
// penalize being pinned deep.
export const MIN_SPOT_YARD = 8;
// The camera's fixed height, in yards: enough room behind the line of
// scrimmage for a sack, enough ahead to see the sticks and a turn's worth of
// running room. Only the window's POSITION scrolls with the line of
// scrimmage; its size never changes.
export const WINDOW_YARDS = 40;
export const WINDOW_BEHIND_YARDS = 15;
// How far behind the offense's own goal line the camera is allowed to
// scroll -- a little visual buffer, not a rule. There is no end zone drawn
// back there (design decision 7): the goal line at yard 0 is an ordinary
// labelled yard line like any other.
export const FIELD_LOW_YARD = -10;
```

- [ ] **Step 2: Rewrite the view as a scrolling window**

Replace `lib/game/view.js` in full:

```js
/**
 * The game's field, in one fixed coordinate space: yard 0 is the offense's
 * own goal line, the goal it attacks is GOAL_YARD, and END_YARD is the back
 * of that end zone. fieldPos/yardsOfY convert between this fixed space and
 * SVG units through one unchanging anchorY/scaleY pair -- every player
 * position and every physics/rules distance check goes through them, and
 * none of it needs to know or care where the camera currently is.
 *
 * gameView(losYard), by contrast, is the camera: a WINDOW_YARDS-tall crop of
 * that fixed space that follows the line of scrimmage down the field,
 * clamped so it never scrolls past either end. Two different jobs, on
 * purpose -- see the plan's design decision 2. Scale is uniform (scaleY ===
 * UNITS_PER_YARD_X) for the same reason it always was: the physics treats
 * players as circles, and a circle is only a circle if a yard is the same
 * number of units in both axes.
 */
import { UNITS_PER_YARD_X, x, y } from '../field/geometry.js';
import {
  FIELD_LOW_YARD, WINDOW_YARDS, WINDOW_BEHIND_YARDS,
} from './constants.js';

export const OWN_GOAL_YARD = 0;
export const GOAL_YARD = 100;
export const END_YARD = 110;

const MARGIN_TOP = 10;
const MARGIN_BOTTOM = 10;
// The SVG y of yard 0, fixed for the whole game. Derived from FIELD_LOW_YARD
// so that a camera scrolled all the way back (topYard === FIELD_LOW_YARD)
// still has MARGIN_TOP of clearance above the topmost drawn yard line --
// exactly the invariant the old, single-window ANCHOR_Y held for TOP_YARD.
const ANCHOR_Y = MARGIN_TOP + -FIELD_LOW_YARD * UNITS_PER_YARD_X;

/** Standard broadcast numbering: distance from the nearer goal line. */
function yardLabel(absYard) {
  const yd = Math.round(absYard);
  return String(yd <= 50 ? yd : 100 - yd);
}

/** Numbered lines every ten yards inside the window, goal lines excluded --
 *  those get their own 'G' label from renderField's own goalYard/scrimmage
 *  handling, not this list. */
function tenYardLines(topYard, bottomYard) {
  const lines = [];
  const first = Math.ceil(topYard / 10) * 10;
  for (let yard = first; yard <= bottomYard; yard += 10) {
    if (yard <= OWN_GOAL_YARD || yard >= GOAL_YARD) continue;
    lines.push({ yard, label: yardLabel(yard) });
  }
  return lines;
}

export function gameView(losYard) {
  const rawTop = losYard - WINDOW_BEHIND_YARDS;
  const topYard = Math.max(FIELD_LOW_YARD, Math.min(rawTop, END_YARD - WINDOW_YARDS));
  const rawBottom = topYard + WINDOW_YARDS;
  // Only draw an end zone/uprights/goal line when the camera actually
  // reaches that far -- otherwise renderField would draw a goal line and a
  // hatched end zone below the window it is supposed to be cropped to.
  const reachesGoal = rawBottom >= GOAL_YARD;
  const bottomYard = reachesGoal ? Math.min(rawBottom, END_YARD) : rawBottom;
  const fieldTopY = ANCHOR_Y + topYard * UNITS_PER_YARD_X;
  const fieldBottomY = ANCHOR_Y + bottomYard * UNITS_PER_YARD_X;
  return {
    scaleY: UNITS_PER_YARD_X,
    anchorY: ANCHOR_Y,
    fieldTopY,
    bottomYard,
    goalYard: reachesGoal ? GOAL_YARD : null,
    goalPosts: reachesGoal,
    sidelineLabel: null,
    // The SVG viewBox's min-y and height -- the actual on-screen crop.
    // fieldTopY/height above stay in field.js's own vocabulary (yards-driven
    // SVG y's); these two are what renderBoardShell writes into the viewBox
    // attribute so the crop scrolls with the window instead of always
    // starting at SVG y 0.
    windowTopY: fieldTopY - MARGIN_TOP,
    height: (fieldBottomY + MARGIN_BOTTOM) - (fieldTopY - MARGIN_TOP),
    scrimmage: { yard: losYard },
    yardLines: tenYardLines(topYard, bottomYard),
  };
}

/** Football coordinates (yards across from centre, yards downfield from the
 *  offense's own goal line) -> SVG units. Independent of any camera. */
export function fieldPos(acrossYards, downYards) {
  return { x: x(acrossYards), y: ANCHOR_Y + downYards * UNITS_PER_YARD_X };
}

/** SVG y -> yards downfield. The inverse of fieldPos's y. */
export function yardsOfY(svgY) {
  return (svgY - ANCHOR_Y) / UNITS_PER_YARD_X;
}
```

Note `fieldPos`/`yardsOfY` no longer route through a `gameView(0)` call — they use `ANCHOR_Y` directly, since it is a plain fixed constant now rather than something only correct when called with the drive-start yard. This is the fix design decision 9 calls out at its root; Task 4 fixes the three call sites in `render.js` that still assumed the old, always-window-0 shortcut.

- [ ] **Step 3: Update `test/game/view.test.js`**

The existing "one yard down equals one yard across," "scrimmage follows losYard," and `fieldPos`/`yardsOfY` invertibility tests all still hold — update only the fixed numbers they assert (`GOAL_YARD`/`END_YARD` are now 100/110, not 10/20; there is no more `TOP_YARD` import). Append new cases:

```js
test('the window is WINDOW_YARDS tall and follows the line of scrimmage', () => {
  const near = gameView(50);
  assert.equal(near.bottomYard - (near.fieldTopY - near.anchorY) / near.scaleY, WINDOW_YARDS);
  const far = gameView(80);
  assert.ok(far.fieldTopY > near.fieldTopY); // scrolled forward with the LOS
});

test('the window clamps at the offense\'s own goal and never dips below FIELD_LOW_YARD', () => {
  const view = gameView(20); // the drive-start spot
  const topYard = (view.fieldTopY - view.anchorY) / view.scaleY;
  assert.ok(topYard >= FIELD_LOW_YARD - 1e-9);
});

test('the end zone is only drawn once the window actually reaches the goal line', () => {
  assert.equal(gameView(20).goalYard, null);
  assert.equal(gameView(95).goalYard, GOAL_YARD);
});

test('yard lines never repeat the goal lines themselves', () => {
  const view = gameView(95);
  assert.ok(view.yardLines.every((l) => l.yard !== GOAL_YARD && l.yard !== OWN_GOAL_YARD));
});
```

- [ ] **Step 4: Run `npm test`.** Expect failures everywhere else that assumed `losYard === 0`/`GOAL_YARD === 10` — that is Tasks 2–4's job to fix, not this task's. Confirm only `view.test.js` is green and every other failure is one of those two assumptions (a quick `grep -rn "GOAL_YARD\|TOP_YARD\|losYard" test/` sanity-checks that).

---

### Task 2: The drive starts at the 20 and tracks the line to gain

**Files:**
- Modify: `lib/game/state.js`
- Test: `test/game/state.test.js`

**Interfaces:**
- Produces: `createGame()`'s returned state gains `toGoYard`, seeded from the new `losYard`; `state.losYard` now starts at `DRIVE_START_YARD` (20) instead of 0.

- [ ] **Step 1: Update `createGame`**

In `lib/game/state.js`, import `DRIVE_START_YARD` and `FIRST_DOWN_YARDS` from `./constants.js` and `GOAL_YARD` from `./view.js`. In `createGame`, change:

```js
down: 1,
losYard: 0,
```

to:

```js
down: 1,
losYard: DRIVE_START_YARD,
// The absolute yard this set of downs must reach for a fresh one. Reset by
// nextDown (rules.js) on every first down; clamped to the goal line itself
// inside the 10, which is what makes "goal to go" fall out for free rather
// than needing a special case.
toGoYard: Math.min(DRIVE_START_YARD + FIRST_DOWN_YARDS, GOAL_YARD),
```

and update `formationPlayers(0)` to `formationPlayers(DRIVE_START_YARD)` in the same function.

- [ ] **Step 2: Update `test/game/state.test.js`**

Update the "a new game" test's `losYard`/formation-position assertions for the new start yard, and add:

```js
test('a new game is 1st and 10 from the offense\'s own 20', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.down, 1);
  assert.equal(s.losYard, 20);
  assert.equal(s.toGoYard, 30);
});
```

- [ ] **Step 3: Run `npm test`.** `state.test.js` should be green; other files still fail on the old assumptions until their own tasks land.

---

### Task 3: Real downs — `nextDown` grants first downs and loses on a failed 4th

**Files:**
- Modify: `lib/game/rules.js`
- Test: `test/game/rules.test.js`

**Interfaces:**
- Produces: `nextDown(state)` — same signature, new behavior: resets to 1st-and-10 (a fresh `toGoYard`) whenever the spot reaches or passes the current `toGoYard`, and only now ends the game (`result: 'turnover-on-downs'`) when a 4th down *fails to reach it*, from wherever that set of downs actually started — not unconditionally after four downs total.

- [ ] **Step 1: Rewrite `nextDown`**

Replace the body of `nextDown` in `lib/game/rules.js`:

```js
import { yardsOfY, fieldPos, GOAL_YARD } from './view.js'; // TOP_YARD is gone
import { MIN_SPOT_YARD, FIRST_DOWN_YARDS, /* ...existing imports */ } from './constants.js';

/**
 * The between-downs bookkeeping: any flag the down earned, whether it earned
 * a fresh set of downs, and — the only way this game ends short of a score —
 * whether a failed 4th down just lost the offense the ball.
 *
 * A flag is enforced unless the defense would rather have the football (see
 * the file's existing comment above this function for the decline rule,
 * unchanged). Enforcement is always a loss of down and never grants a first
 * down, whatever yardage the wiped play gained — design decision 5.
 */
export function nextDown(state) {
  const enforcing = state.penalty && state.deadReason !== 'recovered';
  if (!enforcing) {
    if (state.deadReason === 'touchdown') {
      state.phase = 'gameOver';
      state.result = 'touchdown';
      return;
    }
    if (state.deadReason === 'recovered') {
      state.phase = 'gameOver';
      state.result = 'turnover-fumble';
      return;
    }
  }
  const raw =
    enforcing ? state.penalty.spot - PENALTY_YARDS
    : state.deadReason === 'incomplete' ? state.losYard
    : yardsOfY(ballPos(state).y);
  const spot = Math.max(MIN_SPOT_YARD, Math.min(GOAL_YARD - 0.5, raw));
  const gotFirstDown = !enforcing && spot >= state.toGoYard;
  if (!gotFirstDown && state.down >= 4) {
    state.phase = 'gameOver';
    state.result = 'turnover-on-downs';
    return;
  }
  state.down = gotFirstDown ? 1 : state.down + 1;
  state.losYard = spot;
  if (gotFirstDown) state.toGoYard = Math.min(spot + FIRST_DOWN_YARDS, GOAL_YARD);
  state.phase = 'planning';
  state.turnIndex = 0;
  state.players = formationPlayers(spot);
  state.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  state.deadReason = null;
  state.plannedPass = null;
  state.forwardPasses = 0;
  state.penalty = null;
  aimSnap(state);
}
```

Drop the now-unused `TOP_YARD` import.

- [ ] **Step 2: Update and extend `test/game/rules.test.js`**

Update every existing `nextDown`/spot test that hardcoded the old 10-yard goal-to-go field for the new absolute-yard numbers (a play at the old "yard 0" is now "yard 20," `GOAL_YARD - 0.5` is `99.5` not `9.5`, etc.). Append:

```js
test('reaching the line to gain resets the down and moves the sticks 10 yards on', () => {
  const s = createGame({ seed: 1 }); // 1st & 10 at the 20, toGoYard 30
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  fieldPos(0, 31); // spot the carrier past the sticks
  const carrier_ = getPlayer(s, 'o-qb');
  carrier_.pos = fieldPos(0, 31);
  nextDown(s);
  assert.equal(s.down, 1);
  assert.equal(s.losYard, 31);
  assert.equal(s.toGoYard, 41);
  assert.equal(s.phase, 'planning');
});

test('falling short on 4th down anywhere on the field is a loss, not just at the old fixed start', () => {
  const s = createGame({ seed: 1 });
  s.down = 4;
  s.losYard = 55;
  s.toGoYard = 65;
  const carrier_ = getPlayer(s, 'o-qb');
  carrier_.pos = fieldPos(0, 60); // short of the sticks
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  nextDown(s);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result, 'turnover-on-downs');
});

test('goal-to-go inside the 10 clamps the sticks to the goal line itself', () => {
  const s = createGame({ seed: 1 });
  s.losYard = 95;
  s.toGoYard = Math.min(95 + 10, GOAL_YARD);
  assert.equal(s.toGoYard, 100);
});

test('an enforced penalty never grants a first down even on a play that reached the sticks', () => {
  const s = createGame({ seed: 1 });
  s.toGoYard = 30;
  s.down = 2;
  s.losYard = 25;
  s.penalty = { foul: 'illegal-formation', spot: 25 };
  const carrier_ = getPlayer(s, 'o-qb');
  carrier_.pos = fieldPos(0, 35); // gained past the sticks, but the flag wipes it
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  nextDown(s);
  assert.equal(s.down, 3); // loss of down, not a first down
  assert.ok(s.losYard < 30); // spotted from behind the previous line, not at 35
});
```

Adjust exact field-setup boilerplate (how a carrier/ball position is staged) to match whatever helper pattern the existing tests in this file already use — the four cases above are the behaviors to cover, not a literal diff.

- [ ] **Step 3: Run `npm test`.** `rules.test.js` and `state.test.js` should be green now; `render.js`/`app/main.js`-dependent suites (Task 4) still fail.

---

### Task 4: The camera, the line-to-gain marker, and the UI elements that assumed a fixed window

**Files:**
- Modify: `lib/game/render.js`
- Test: `test/game/render.test.js`

**Interfaces:**
- Produces: `renderBoardShell(losYard, toGoYard) -> {viewBox, markup}` (was `renderBoardShell(losYard)`); `lineToGainMark(view, toGoYard) -> string`; `buttonColumnMidY(losYard)`, `renderMessage(text, losYard)`, `renderFieldButtons(state, opts)` all now take or derive the *current* `losYard` instead of implicitly assuming yard 0 is always what's on screen (design decision 9).

- [ ] **Step 1: Thread `losYard` through the three UI-placement functions**

In `lib/game/render.js`:

```js
function buttonColumnMidY(losYard) {
  const view = gameView(losYard);
  return (view.fieldTopY + yardToY(view, view.bottomYard)) / 2;
}
```

`menuButtonMark` gains a `losYard` parameter and passes it through to `buttonColumnMidY`. `renderBoardShell(losYard, toGoYard)` passes `losYard` to `menuButtonMark` and builds the viewBox from the view's new scrolling fields:

```js
export function renderBoardShell(losYard, toGoYard) {
  const view = gameView(losYard);
  const { svg, height } = renderField(view);
  return {
    viewBox: `0 ${num(view.windowTopY)} ${VIEWBOX_WIDTH} ${num(height)}`,
    markup:
      `<style>${STYLE}${STYLE_GAME}</style>${DEFS}${DEFS_GAME}` +
      `<g id="game-field">${svg}${lineToGainMark(view, toGoYard)}</g>` +
      `<g id="game-arrows"></g><g id="game-preview"></g>` +
      `<g id="game-players"></g><g id="game-overlay"></g>` +
      `<g id="game-menu">${menuButtonMark(losYard)}</g><g id="game-buttons"></g>` +
      `<g id="game-message"></g>`,
  };
}
```

`renderFieldButtons(state, {...})` calls `buttonColumnMidY(state.losYard)` instead of the parameterless call. `renderMessage(text, losYard)` calls `gameView(losYard)` instead of `gameView(0)`.

- [ ] **Step 2: Draw the line to gain**

Add a CSS class to `STYLE_GAME`:

```js
// The line to gain: a solid line distinct from both the dashed scrimmage
// line (black) and the dashed plan/pass arrows (green/red), since it is
// reporting a fact about the field, not an order. Gold reads as "the
// broadcast yellow line" without needing actual broadcast graphics.
'.ftg{stroke:#c9962c;stroke-width:1.5;fill:none}',
```

And the mark itself, near `lineZoneMark`:

```js
/**
 * The line to gain. Composited after renderField's own output rather than
 * taught to the vendored field.js — that file draws exactly one kind of
 * "rule line" (the dashed scrimmage line, via view.scrimmage) and is never
 * edited. Omitted when the sticks are at or past the goal line the window
 * already marks (goal-to-go), or off the top/bottom of the current camera.
 */
export function lineToGainMark(view, toGoYard) {
  if (toGoYard >= GOAL_YARD) return '';
  const topYard = (view.fieldTopY - view.anchorY) / view.scaleY;
  if (toGoYard < topYard || toGoYard > view.bottomYard) return '';
  const ly = yardToY(view, toGoYard);
  return `<line x1="${num(SIDELINE_LEFT)}" y1="${num(ly)}" x2="${num(SIDELINE_RIGHT)}" y2="${num(ly)}" class="ftg"/>`;
}
```

- [ ] **Step 3: Update `test/game/render.test.js`**

Update every call site of `renderBoardShell`/`renderMessage`/`renderFieldButtons` for the new signatures, and the fixed `GOAL_YARD`/`END_YARD` numbers baked into any existing assertions. Append:

```js
test('the line to gain is drawn at the sticks and omitted once they reach the goal', () => {
  const view = gameView(50);
  assert.match(lineToGainMark(view, 60), /class="ftg"/);
  assert.equal(lineToGainMark(view, GOAL_YARD), '');
});

test('renderBoardShell\'s viewBox scrolls with losYard instead of always starting at 0', () => {
  const near = renderBoardShell(20, 30).viewBox;
  const far = renderBoardShell(80, 90).viewBox;
  assert.notEqual(near, far);
});
```

- [ ] **Step 4: Run `npm test`.** `render.test.js` should be green. Anything in `formation.test.js`/`defense.test.js`/`integration.test.js`/`turn.test.js` still failing at this point is failing only because it calls `createGame`/`nextDown` and inherited the new absolute-yard numbers — sweep those in Task 7, not here, unless a failure traces back to this task's own render changes (check the stack before assuming).

---

### Task 5: `lib/game/hud.js` — down, distance, and spot as words

**Files:**
- Create: `lib/game/hud.js`
- Test: Create `test/game/hud.test.js`

**Interfaces:**
- Produces: `spotText(yard) -> string` (`"OWN 24"`, `"50"`, `"OPP 35"`); `downDistanceText(state) -> string` (`"1st & 10 at the OWN 20"`, `"3rd & 4 at the OPP 45"`, `"1st & Goal at the OPP 8"`).

- [ ] **Step 1: Write the failing tests**

`test/game/hud.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spotText, downDistanceText } from '../../lib/game/hud.js';
import { createGame } from '../../lib/game/state.js';

test('spotText names the side of the field', () => {
  assert.equal(spotText(20), 'OWN 20');
  assert.equal(spotText(50), '50');
  assert.equal(spotText(65), 'OPP 35');
});

test('a new game reads 1st & 10 at the OWN 20', () => {
  const s = createGame({ seed: 1 });
  assert.equal(downDistanceText(s), '1st & 10 at the OWN 20');
});

test('goal-to-go reads "Goal" instead of a yardage', () => {
  const s = createGame({ seed: 1 });
  s.losYard = 92;
  s.toGoYard = 100;
  s.down = 2;
  assert.equal(downDistanceText(s), '2nd & Goal at the OPP 8');
});
```

- [ ] **Step 2: Run tests to verify they fail** (`hud.js` does not exist yet).

- [ ] **Step 3: Implement `lib/game/hud.js`**

```js
/**
 * Turning state into the down/distance/spot line a broadcast graphic would
 * show. Pure and DOM-free like the rest of lib/game/ — app/main.js is the
 * only thing that ever writes this into the page.
 */
import { GOAL_YARD } from './view.js';

const ORDINALS = ['1st', '2nd', '3rd', '4th'];

export function spotText(yard) {
  const y = Math.round(yard);
  if (y === 50) return '50';
  return y < 50 ? `OWN ${y}` : `OPP ${100 - y}`;
}

export function downDistanceText(state) {
  const toGo = state.toGoYard >= GOAL_YARD
    ? 'Goal'
    : String(Math.max(0, Math.round(state.toGoYard - state.losYard)));
  return `${ORDINALS[state.down - 1]} & ${toGo} at the ${spotText(state.losYard)}`;
}
```

- [ ] **Step 4: Run `npm test`.** `hud.test.js` green.

---

### Task 6: Wire it into the page

**Files:**
- Modify: `app/main.js`

**Interfaces:** No new exports — this task only changes how `app/main.js` calls the functions Tasks 1–5 changed or added.

- [ ] **Step 1: Update the HUD line**

Import `downDistanceText` from `../lib/game/hud.js`. In `paint()`, replace:

```js
hud.textContent = `Down ${state.down} of 4 — ${state.phase}`;
```

with:

```js
hud.textContent = `${downDistanceText(state)} — ${state.phase}`;
```

- [ ] **Step 2: Pass the current spot to the functions Task 4 changed**

- `rebuildBoard()`: `renderBoardShell(state.losYard, state.toGoYard)`.
- `drawMessage()`: `renderMessage(messageText, state.losYard)`.
- `paint()`'s call to `renderFieldButtons` is unchanged in signature (it already takes `state`); no edit needed there beyond what Task 4 did inside `render.js`.

- [ ] **Step 3: Tighten the win/lose language**

In `goToNextDown()`:

```js
if (state.phase === 'gameOver') {
  say(state.result === 'touchdown' ? 'TOUCHDOWN — you win!'
    : state.result === 'turnover-on-downs' ? 'Turnover on downs. Game over — you lose.'
    : 'Turnover. Game over — you lose.');
}
```

(The middle branch's `'Fumble recovered by the defense.'` wording is dropped in favor of the generic `'Turnover.'` — `state.result === 'turnover-fumble'` already covers interceptions too, since a thrown ball and a fumble share the same loose-ball recovery code in `rules.js`'s `checkPickup`, so the old wording was already sometimes wrong. If a more precise "Fumble" vs. "Interception" distinction is wanted later, it needs a new `result` value or an event-derived flag threaded through `nextDown` — out of scope here.)

In `startNewGame()`, update the opening message:

```js
say('New game. 1st and 10 from your own 20 — 80 yards to the house.');
```

- [ ] **Step 4: Manual playtest**

Run `npm run serve`, open the page, and play at least one full possession by hand: confirm the camera visibly scrolls as the ball moves downfield, the gold line-to-gain marker tracks each new set of downs, the HUD reads correctly through a first down and into goal-to-go territory, a stopped 4th down away from the goal ends the game with the new "you lose" wording, and a touchdown from a normal drive (not just from goal-to-go) still says "you win!". Also confirm the two on-field buttons and the message plate stay visually anchored to the current window rather than drifting off to a stale one as the drive progresses — that is exactly the bug design decision 9 exists to prevent, so it is worth specifically watching for.

---

### Task 7: Sweep the rest of the suite, then README

**Files:**
- Modify: `test/game/formation.test.js`, `test/game/defense.test.js`, `test/game/turn.test.js`, `test/game/integration.test.js` (only as needed)
- Modify: `README.md`

- [ ] **Step 1: Run `npm test` and fix whatever is still red**

By this point every failure left should trace to one of two things: a hardcoded `losYard === 0`/small number that assumed the old drive-start line, or a hardcoded `GOAL_YARD`/`END_YARD` value from the old 10/20 field. Fix the numbers in place; do not change what behavior each test is actually checking (formation legality, AI alignment depths, turn-loop mechanics, integration flow) — those are unaffected by this plan and should still hold once the coordinates are updated. Confirm the full suite is green and the count is at or above the starting 329 (it should be higher — this plan adds tests in Tasks 1, 2, 3, 4, and 5).

- [ ] **Step 2: Update README.md**

In "How to play," replace:

> Each drive starts 1st and goal from the offense's own 10-yard line, and the offense has **4 downs** to score before the ball turns over.

with something describing the real structure — 1st and 10 from the 20, 4 downs to reach the line to gain for a fresh set, goal-to-go inside the 10, and the game ending the moment the offense loses the ball however that happens (turnover on downs included). Update the "When a play ends" and "New Game" bullets' language to match (they currently say "spot the ball, advance the down counter" and "starts a fresh drive from the 10" — both need the new start yard and the first-down behavior mentioned).

In "v1 interpretation decisions," add a bullet alongside the existing ones documenting this plan's scope call: the game is still a single drive with no scoreboard and no safety rule — see this plan's design decisions 4 and 6 for why, phrased for a README reader rather than an implementer (i.e., "losing the ball however it happens — a turnover on downs included — ends the game; there's no possession swap or running score, and no safety rule since there's no second team to award the two points to").

- [ ] **Step 3: Final check**

`npm test` green, `npm run serve` playtest from Task 6 Step 4 still holds, README reads consistently with the shipped behavior.
