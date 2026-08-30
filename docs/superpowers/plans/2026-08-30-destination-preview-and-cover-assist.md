# Destination Preview and Cover Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the drag arrow with a filled circle showing exactly where a player will end up this turn, falling back to the old arrow when the drag asks for more ground than he can cover — and let a drag onto an opposing player issue a *cover* order, drawn as a dotted line plus a green halo under that opponent, which steers the blocker at him all turn and gives him a slight boost to blocking force and grab reach.

**Architecture:** One new pure module, `lib/game/predict.js`, replays `physics.js`'s `steer()` on a throwaway clone of a player for a whole turn with no collisions — so the previewed destination is the simulation's own arithmetic, not a second model of it. A second new module, `lib/game/cover.js`, owns the cover order end to end: picking the covered opponent, re-aiming the blocker's plan every sub-step, and the contact-radius bonus the block earns. Rendering stays a pure function of state — `plan.target` (a point, or null) is what tells the renderer to draw a circle instead of an arrow, so nothing is re-simulated at paint time.

**Tech Stack:** Plain ES modules, no build step. `node --test` for tests. SVG emitted as strings from `lib/game/render.js`; `app/main.js` writes those strings into layer groups via the vendored SVG.js wrapper.

**Spec:** the "Source spec" section immediately below, which is the feature request verbatim, plus the two design decisions recorded under it.

---

## Source spec

> current in this game, the user drags to set the force and direction that the
> controlled player will go. I'd like for that mechanic to still apply, but I'd
> like the UI to change to show where the user would actually go, use a infilled
> circle to represent where they would go. If the user selects a spot past the
> point at which the player can move to on this turn, use the old arrow instead
> of a the circle. If the user drags over the other teams player, make there be
> an AI that alters the players moves to try and block/cover the other player.
> Show this by having a the dotted line go to that player, and have a green
> infilled circle be displayed at a z height lower than the opposing player. The
> edge of this circle should just be visible from from under the player. When
> doing this, the player should get a slight boost to blocking force and grab
> reach.

Two forks were resolved with the user before this plan was written:

1. **The drag point IS the destination.** The release point is a target spot.
   The game solves the throttle that lands the player exactly there this turn
   and draws the filled circle there. A drag longer than he can cover in one
   turn pins the throttle to 1 and falls back to the old arrow. A longer drag is
   still more force, so the original mechanic survives.
2. **The cover AI interposes, then shadows.** When the covering player's own
   team has the ball, he aims for the point just on his carrier's side of the
   man he is covering — he gets his body in the way. With no carrier of his own
   he shadows the target's led position instead.

### A consequence to expect, not to fix

From a standing start every player covers exactly **7.75 SVG units** (2.07 yards)
in one half-second turn, whatever his size: `ACCEL * DT` is exactly 1 unit/s per
sub-step, so velocity ramps 1, 2, … 30 over `SUBSTEPS_PER_TURN` sub-steps and
`Σ(1..30) * DT = 465/60 = 7.75`. Nobody's `maxSpeed` (42.9 for a lineman, 60 for
a skill player) is reached inside a single turn from rest, which is why size does
not enter into it. So at the snap the circle can only be placed within about two
yards, and anything farther shows the arrow. Once a player is moving the reach
grows sharply — at 30 u/s he covers 22.75 units in a turn — so the circle becomes
the common case as the play develops. This is correct behaviour for half-second
turns. **Do not retune `ACCEL` or `SUBSTEPS_PER_TURN` to widen it.** If it plays
badly, that is a separate tuning task with its own plan.

---

## Global Constraints

- **No build step, no dependencies.** Plain ES modules loaded directly by
  `index.html`. Do not add a bundler, a test framework, or an npm dependency.
- **`lib/` must run under `node --test` with no DOM.** Everything the game paints
  is emitted as a *string* from `lib/game/render.js`; nothing in `lib/` may touch
  `document` or `window`.
- **`app/` is wiring only.** Every decision about what a gesture *means* and what
  the game *does* lives in `lib/game/`. `app/main.js` and `app/input.js` observe,
  dispatch, and paint.
- **All tunable numbers live in `lib/game/constants.js`**, each with a comment
  saying what it is and why it has that value. No magic numbers at call sites.
- **Prediction must not fork the physics.** `lib/game/predict.js` calls the
  exported `steer()` from `lib/game/physics.js`. Never copy the steering maths
  into a second place.
- Run the full suite with `npm test` (which is `node --test`) before every commit.
- Commit messages follow the repo's existing style: lowercase `feat:` / `fix:` /
  `docs:` prefix, then a present-tense sentence, e.g.
  `feat: the status message renders on a plate in the end zone`.

---

### Task 1: Predicting where a plan lands

The one piece of arithmetic everything else in this plan leans on: given a
player and a drag, where does he actually end up at the whistle?

**Files:**
- Modify: `lib/game/physics.js:20-35` (change `function steer` to `export function steer`)
- Create: `lib/game/predict.js`
- Modify: `lib/game/gesture.js:26-33` (add `travel` to the drag result)
- Test: `test/game/predict.test.js`
- Test: `test/game/gesture.test.js` (add one case)

**Interfaces:**
- Consumes: `steer(player, dt)` from `lib/game/physics.js`; `DT`,
  `SUBSTEPS_PER_TURN` from `lib/game/constants.js`; `norm`, `len`, `sub`, `dot`
  from `lib/game/vec.js`.
- Produces, from `lib/game/predict.js`:
  - `predictDestination(player, dir, throttle) -> {x, y}` — absolute board
    position at the end of one turn, ignoring all contact.
  - `travelAlong(player, dir, throttle) -> number` — signed distance covered
    along `dir` over one turn.
  - `maxTravelAlong(player, dir) -> number` — `travelAlong(player, dir, 1)`.
  - `throttleForDistance(player, dir, distance) -> number` in `[0, 1]`.
  - `planForDrag(player, travel) -> {dir: {x,y}, throttle: number, target: {x,y}|null}`
    — the whole drag-to-plan decision. `target` is null exactly when the drag
    asked for more ground than the player can cover.
- Produces, from `lib/game/gesture.js`: `classifyGesture` results of kind
  `'drag'` and `'passdrag'` now also carry `travel: {x, y}`, the raw drag vector.

- [ ] **Step 1: Write the failing test**

Create `test/game/predict.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  predictDestination, travelAlong, maxTravelAlong, throttleForDistance, planForDrag,
} from '../../lib/game/predict.js';
import { createGame, getPlayer, setPlan } from '../../lib/game/state.js';
import { stepPhysics } from '../../lib/game/physics.js';
import { DT, SUBSTEPS_PER_TURN, MAX_ARROW_UNITS } from '../../lib/game/constants.js';

const DOWN = { x: 0, y: 1 };

/** A game trimmed to one player, so nothing can collide with him. */
function solo(id) {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === id);
  return s;
}

test('from a standstill a turn is worth exactly 7.75 units, whatever the size', () => {
  // ACCEL * DT is exactly 1 u/s per sub-step and nobody's maxSpeed is reached
  // inside 30 of them, so velocity ramps 1..30 and the distance is
  // (1+2+...+30) * DT = 465/60. The same for a lineman as for a receiver.
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  const c = getPlayer(solo('o-c'), 'o-c');
  assert.ok(Math.abs(maxTravelAlong(rb, DOWN) - 7.75) < 1e-9, `rb ${maxTravelAlong(rb, DOWN)}`);
  assert.ok(Math.abs(maxTravelAlong(c, DOWN) - 7.75) < 1e-9, `c ${maxTravelAlong(c, DOWN)}`);
});

test('a lower throttle covers proportionally less ground', () => {
  // Quarter throttle targets 15 u/s: velocity ramps 1..15 then holds 15 for the
  // remaining 15 sub-steps. (120 + 225) / 60 = 5.75.
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  assert.ok(Math.abs(travelAlong(rb, DOWN, 0.25) - 5.75) < 1e-9);
});

test('a player already moving reaches much further', () => {
  const s = solo('o-rb');
  const rb = getPlayer(s, 'o-rb');
  rb.vel = { x: 0, y: 30 };
  // Velocity ramps 31..60 and caps there: (31+60)*30/2 / 60 = 22.75.
  assert.ok(Math.abs(maxTravelAlong(rb, DOWN) - 22.75) < 1e-9);
});

test('the predicted destination is where an uncontested turn actually puts him', () => {
  const s = solo('o-rb');
  const rb = getPlayer(s, 'o-rb');
  const predicted = predictDestination(rb, DOWN, 0.4);
  setPlan(s, 'o-rb', DOWN, 0.4);
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) stepPhysics(s, DT);
  assert.ok(Math.abs(rb.pos.x - predicted.x) < 1e-9, 'x');
  assert.ok(Math.abs(rb.pos.y - predicted.y) < 1e-9, 'y');
});

test('predicting does not move the player it predicts for', () => {
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  const pos = { ...rb.pos };
  const vel = { ...rb.vel };
  predictDestination(rb, DOWN, 1);
  assert.deepEqual(rb.pos, pos);
  assert.deepEqual(rb.vel, vel);
  assert.equal(rb.plan, null);
});

test('throttleForDistance inverts travelAlong', () => {
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  const t = throttleForDistance(rb, DOWN, 5.75);
  assert.ok(Math.abs(t - 0.25) < 1e-3, `got ${t}`);
  assert.ok(Math.abs(travelAlong(rb, DOWN, t) - 5.75) < 1e-3);
});

test('throttleForDistance saturates rather than throwing', () => {
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  assert.equal(throttleForDistance(rb, DOWN, 1000), 1);
  assert.equal(throttleForDistance(rb, DOWN, -50), 0);
});

test('a reachable drag becomes a target the player lands on', () => {
  const s = solo('o-rb');
  const rb = getPlayer(s, 'o-rb');
  const plan = planForDrag(rb, { x: 0, y: 5 });
  assert.ok(plan.target, 'reachable drags carry a target');
  assert.ok(plan.throttle < 1, 'and cost less than full throttle');
  assert.ok(Math.abs(plan.target.y - (rb.pos.y + 5)) < 1e-2, 'landing on the drag point');
  setPlan(s, 'o-rb', plan.dir, plan.throttle);
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) stepPhysics(s, DT);
  assert.ok(Math.abs(rb.pos.y - plan.target.y) < 1e-9, 'the circle did not lie');
});

test('a drag past his reach loses the target and pins the throttle', () => {
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  const plan = planForDrag(rb, { x: 0, y: MAX_ARROW_UNITS });
  assert.equal(plan.target, null, 'unreachable: the caller draws the old arrow');
  assert.equal(plan.throttle, 1);
  assert.deepEqual(plan.dir, DOWN);
});

test('a moving player cannot be asked to stop short of his own coast', () => {
  // Throttle 0 still leaves him coasting; a drag shorter than that coast is
  // honoured as "as slow as you can", not as an unreachable spot.
  const s = solo('o-rb');
  const rb = getPlayer(s, 'o-rb');
  rb.vel = { x: 0, y: 40 };
  const plan = planForDrag(rb, { x: 0, y: 1 });
  assert.equal(plan.throttle, 0);
  assert.ok(plan.target, 'still a destination, just further out than asked');
  assert.ok(plan.target.y > rb.pos.y + 1, 'the circle shows the truth');
});
```

Add to `test/game/gesture.test.js`:

```js
test('a drag reports the raw drag vector alongside direction and throttle', () => {
  const g = classifyGesture([
    { t: 0, x: 100, y: 100 },
    { t: 50, x: 100, y: 112 },
  ]);
  assert.equal(g.kind, 'drag');
  assert.deepEqual(g.travel, { x: 0, y: 12 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `test/game/predict.test.js` cannot resolve `../../lib/game/predict.js`, and the gesture case fails with `travel` undefined.

- [ ] **Step 3: Export `steer` from physics.js**

In `lib/game/physics.js`, change the declaration only — the body is untouched:

```js
/**
 * One player's steering and integration for one sub-step, with no reference to
 * anyone else on the field. Exported because lib/game/predict.js replays it on
 * a throwaway clone to work out where a plan lands: the destination circle the
 * player is shown has to be the simulation's own arithmetic, not a second copy
 * of it that can drift.
 */
export function steer(player, dt) {
```

- [ ] **Step 4: Add `travel` to the drag gesture**

In `lib/game/gesture.js`, inside `classifyGesture`, the drag branch becomes:

```js
  if (len(travel) >= DRAG_MIN_UNITS) {
    const armed = prevClickAt !== null && down.t - prevClickAt <= DOUBLE_TAP_MS;
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
```

- [ ] **Step 5: Write `lib/game/predict.js`**

```js
/**
 * Where a plan lands. The board now shows a player the spot he will actually
 * reach this turn rather than an arrow of abstract force, and that promise is
 * only keepable if the preview and the simulation are the same arithmetic — so
 * this module replays physics.js's own `steer` on a throwaway clone for a whole
 * turn. What it deliberately does NOT model is contact: it is one player alone
 * on the field. A blocker in his way is exactly the sort of thing the player is
 * supposed to be planning around, and a preview that quietly folded in a
 * collision that has not happened yet would be predicting his opponent's turn
 * as well as his own.
 */
import { steer } from './physics.js';
import { norm, len, sub, dot } from './vec.js';
import { DT, SUBSTEPS_PER_TURN } from './constants.js';

/** How many halvings the throttle solver takes: 2^-24 of the range, plenty. */
const SOLVE_STEPS = 24;

/** A private copy deep enough that steering it cannot touch the real player. */
function ghost(player, dir, throttle) {
  return {
    ...player,
    pos: { ...player.pos },
    vel: { ...player.vel },
    plan: { dir, throttle, target: null },
  };
}

/** Where one uncontested turn at this plan leaves him, in board coordinates. */
export function predictDestination(player, dir, throttle) {
  const g = ghost(player, dir, throttle);
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) steer(g, DT);
  return g.pos;
}

/**
 * How far he gets ALONG `dir` — a signed projection, not a distance. A player
 * with momentum across the arrow drifts sideways, and measuring the raw
 * displacement would credit that drift as progress toward where the user
 * pointed. It also keeps the quantity monotonic in throttle, which is what
 * lets throttleForDistance bisect it.
 */
export function travelAlong(player, dir, throttle) {
  return dot(sub(predictDestination(player, dir, throttle), player.pos), dir);
}

export function maxTravelAlong(player, dir) {
  return travelAlong(player, dir, 1);
}

/**
 * The throttle that covers `distance` along `dir` this turn, by bisection —
 * there is no closed form once clampToStance's ellipse is in play. Saturates at
 * both ends rather than failing: asking for more than he has gives 1, and
 * asking for less than he coasts (throttle 0 still leaves a moving player
 * drifting) gives 0.
 */
export function throttleForDistance(player, dir, distance) {
  if (distance >= maxTravelAlong(player, dir)) return 1;
  if (distance <= travelAlong(player, dir, 0)) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < SOLVE_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (travelAlong(player, dir, mid) < distance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A drag, read as a destination. `travel` is the raw drag vector from
 * gesture.js: its direction is where the player is being sent and its LENGTH is
 * how far, in board units, rather than an abstract throttle.
 *
 * `target` is the contract with the renderer. Non-null means "he lands here,
 * draw the circle"; null means the user pointed past what a half-second buys
 * and the old arrow is drawn instead, at full throttle — the honest reading of
 * a drag that asks for more ground than exists.
 *
 * The target is the PREDICTED spot, not the drag point. They agree to within
 * the solver's tolerance whenever the player has no sideways momentum, and when
 * he does the predicted spot is the true one — the circle never lies about
 * where he ends up.
 */
export function planForDrag(player, travel) {
  const d = len(travel);
  if (d === 0) return { dir: { x: 0, y: 0 }, throttle: 0, target: null };
  const dir = norm(travel);
  if (d > maxTravelAlong(player, dir)) return { dir, throttle: 1, target: null };
  const throttle = throttleForDistance(player, dir, d);
  return { dir, throttle, target: predictDestination(player, dir, throttle) };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 7: Commit**

```bash
git add lib/game/predict.js lib/game/physics.js lib/game/gesture.js test/game/predict.test.js test/game/gesture.test.js && git commit -m "feat: a plan can be asked where it will actually land"
```

---

### Task 2: The destination circle on the board

Teach the renderer to draw a filled circle when a plan knows where it lands, and
keep the arrow for the ones that do not. Nothing sets `target` yet, so the board
looks unchanged after this task — that is the point: it lands as a pure,
test-covered rendering change before any input is rewired.

**Files:**
- Modify: `lib/game/state.js:110-112` (`setPlan`)
- Modify: `lib/game/render.js` (`STYLE_GAME`; rename `renderArrows` → `renderPlans`; add `destinationMark`)
- Modify: `app/main.js:9-11, 65-67` (import and call the renamed function)
- Test: `test/game/render.test.js`
- Test: `test/game/state.test.js`

**Interfaces:**
- Consumes: nothing new from Task 1 — this task is deliberately independent of it.
- Produces:
  - `setPlan(state, id, dir, throttle, target = null)` — the plan object is now
    `{ dir, throttle, target }`.
  - `destinationMark(pos, radius) -> string` from `lib/game/render.js`.
  - `renderPlans(state) -> string` from `lib/game/render.js`, replacing the
    export named `renderArrows`. `arrowMark` keeps its name and signature.

- [ ] **Step 1: Write the failing test**

In `test/game/render.test.js`, change the import line from `renderArrows` to
`renderPlans, destinationMark`, replace the existing test named
`'arrows render only for planned players, scaled by throttle'` with the two
below, and add the third:

```js
test('a plan with no reachable target still renders as the old arrow', () => {
  const s = createGame({ seed: 1 });
  assert.equal(renderPlans(s), '');
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const svg = renderPlans(s);
  assert.equal((svg.match(/data-for="/g) || []).length, 1);
  assert.ok(svg.includes('class="plan-mv"'), 'the arrow, not a circle');
  assert.ok(!svg.includes('class="plan-dest"'));
  const rb = getPlayer(s, 'o-rb');
  assert.ok(svg.includes(`L ${num(rb.pos.x)} ${num(rb.pos.y + MAX_ARROW_UNITS)}`));
});

test('a plan that knows where it lands renders as a filled circle there', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  const target = { x: rb.pos.x, y: rb.pos.y + 6 };
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.7, target);
  const svg = renderPlans(s);
  assert.ok(svg.includes('class="plan-dest"'), 'the circle');
  assert.ok(!svg.includes('class="plan-mv"'), 'and no arrow');
  assert.ok(svg.includes(`cx="${num(target.x)}" cy="${num(target.y)}"`), 'at the landing spot');
  assert.ok(svg.includes(`r="${num(rb.radius)}"`), 'drawn at his own size');
});

test('the destination circle is a bare mark, so the preview and the plan match', () => {
  assert.equal(
    destinationMark({ x: 10, y: 20 }, 2.5),
    '<circle cx="10" cy="20" r="2.5" class="plan-dest"/>',
  );
});
```

In `test/game/state.test.js`, add:

```js
test('a plan carries its landing spot, and defaults to not having one', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  assert.equal(getPlayer(s, 'o-rb').plan.target, null);
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.5, { x: 1, y: 2 });
  assert.deepEqual(getPlayer(s, 'o-rb').plan.target, { x: 1, y: 2 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `renderPlans` and `destinationMark` are not exported from
`lib/game/render.js`, and `plan.target` is undefined rather than null.

- [ ] **Step 3: Carry the landing spot on the plan**

In `lib/game/state.js`, replace `setPlan`:

```js
/**
 * `target` is where this plan actually puts him at the whistle, or null when
 * the drag asked for more ground than a turn buys. It is computed by
 * lib/game/predict.js and stored rather than recomputed at paint time, so
 * render.js stays a pure function of the state and nothing is simulated twice.
 * Plans made by the computer (ai.js) and by tests pass nothing and get null,
 * which draws the old arrow.
 */
export function setPlan(state, id, dir, throttle, target = null) {
  getPlayer(state, id).plan = { dir, throttle, target };
}
```

- [ ] **Step 4: Draw the circle**

In `lib/game/render.js`, add to `STYLE_GAME`, immediately after the `.arh-g`
entry:

```js
  // The destination circle: where this player will actually be standing at the
  // whistle. Drawn at his own radius so it reads as his body moved there rather
  // than as a marker, and translucent so the yard lines under it stay legible.
  // It goes in the `game-arrows` layer, which is beneath `game-players`, so a
  // short plan tucks under the player instead of covering him up.
  '.plan-dest{fill:#1a7f37;fill-opacity:.35;stroke:#1a7f37;stroke-width:.6;pointer-events:none}',
```

Add, next to `arrowMark`:

```js
/**
 * The spot a plan lands on. Like arrowMark, this is a bare mark with no
 * wrapper: app/main.js writes it straight into the `game-preview` layer while
 * the drag is live, and renderPlans wraps the identical string once the drag is
 * committed — so what is dragged and what is kept are the same picture.
 */
export function destinationMark(pos, radius) {
  return `<circle cx="${num(pos.x)}" cy="${num(pos.y)}" r="${num(radius)}" class="plan-dest"/>`;
}
```

Replace `renderArrows` entirely:

```js
/**
 * The human's plans. A plan that knows where it lands is drawn as a circle on
 * that spot; one that does not — the user pointed further than half a second
 * buys — keeps the old arrow, which says direction and force without promising
 * a destination it cannot deliver.
 *
 * The team the computer coaches is skipped: turn.js already guarantees those
 * plans never exist during a planning phase, and this is the second lock on the
 * same door — the requirement is "don't show the defense's planned movements",
 * and this is the file that would show them.
 */
export function renderPlans(state) {
  return state.players
    .filter((p) => p.plan && p.team !== state.aiTeam)
    .map((p) => {
      const mark = p.plan.target
        ? destinationMark(p.plan.target, p.radius)
        : arrowMark(p.pos, {
          x: p.pos.x + p.plan.dir.x * p.plan.throttle * MAX_ARROW_UNITS,
          y: p.pos.y + p.plan.dir.y * p.plan.throttle * MAX_ARROW_UNITS,
        });
      return `<g class="plan-arrow" data-for="${p.id}">${mark}</g>`;
    })
    .join('');
}
```

- [ ] **Step 5: Point the app at the new name**

In `app/main.js`, change the render import from `renderArrows` to `renderPlans`,
and in `paint()`:

```js
  layer('game-arrows').clear().svg(
    state.phase === 'planning' ? renderPlans(state) + renderPassArrow(state) : '',
  );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. Then check nothing else still refers to the old name:

Run: `grep -rn "renderArrows" --include='*.js' .`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/game/state.js lib/game/render.js app/main.js test/game/render.test.js test/game/state.test.js && git commit -m "feat: a plan that knows where it lands is drawn as a circle"
```

---

### Task 3: Dragging to a spot on the field

Wire Tasks 1 and 2 together in the app, so a drag becomes a destination.

**Files:**
- Modify: `lib/game/constants.js` (add `PICK_SLOP_UNITS`)
- Modify: `app/main.js` (`hitTest`, `onGesture`, `onDragPreview`)
- Modify: `README.md` ("Drag a player" bullet)

**Interfaces:**
- Consumes: `planForDrag(player, travel)` from `lib/game/predict.js`;
  `destinationMark(pos, radius)` and `arrowMark(from, to)` from
  `lib/game/render.js`; `setPlan(state, id, dir, throttle, target)` from
  `lib/game/state.js`; `gesture.travel` from `lib/game/gesture.js`.
- Produces: `PICK_SLOP_UNITS` from `lib/game/constants.js` — Task 4's
  `opponentAt` picks with the same slop.

There is no DOM test harness in this repo (`test/` covers `lib/` only), so this
task is verified by hand against the running game. The logic it wires is already
covered by Task 1's tests.

- [ ] **Step 1: Name the pick slop**

In `lib/game/constants.js`, add under the `// --- planning arrows ---` heading:

```js
// How far outside his own circle a player can be grabbed by a pointer. The same
// slop picks the man you are ORDERING (app/main.js's hitTest) and the man you
// are dragging ONTO to cover him (cover.js's opponentAt) — a fat-finger margin
// should not depend on which end of the drag it is.
export const PICK_SLOP_UNITS = 2;
```

- [ ] **Step 2: Wire the drag to a destination**

In `app/main.js`, add to the render import: `destinationMark`. Add a new import:

```js
import { planForDrag } from '../lib/game/predict.js';
```

Add `PICK_SLOP_UNITS` to the constants import, and use it in `hitTest`:

```js
    if (d <= pl.radius + PICK_SLOP_UNITS && d < bestD) { best = pl.id; bestD = d; }
```

Add this helper above `onGesture`:

```js
/**
 * The mark for a run drag: the circle when the spot is reachable this turn, the
 * old arrow when it is not. The live preview and the committed plan both come
 * through here so a drag never changes shape at the moment it is released.
 */
function runMark(player, plan) {
  return plan.target
    ? destinationMark(plan.target, player.radius)
    : arrowMark(player.pos, {
      x: player.pos.x + plan.dir.x * plan.throttle * MAX_ARROW_UNITS,
      y: player.pos.y + plan.dir.y * plan.throttle * MAX_ARROW_UNITS,
    });
}
```

In `onGesture`, replace the two places a run plan is set. The `passdrag`
fallback (a tap-then-drag from someone who is not holding the ball):

```js
    if (setPass(state, playerId, gesture.dir, gesture.throttle)) {
      say(`${p.role} will throw.`);
    } else {
      const run = planForDrag(p, gesture.travel);
      setPlan(state, playerId, run.dir, run.throttle, run.target);
      say(`${p.role} doesn't have the ball — running instead.`);
    }
```

and the plain `drag` branch:

```js
  } else if (gesture.kind === 'drag') {
    const run = planForDrag(p, gesture.travel);
    setPlan(state, playerId, run.dir, run.throttle, run.target);
    pendingWarning = false;
    say('');
```

In `onDragPreview`, replace the `mark` expression:

```js
  const mark = throwing
    ? passArrowMark(p.pos, passArrowTip(p.pos, g.dir, g.throttle))
    : runMark(p, planForDrag(p, g.travel));
```

- [ ] **Step 3: Update the README's drag bullet**

In `README.md`, replace the `**Drag a player**` bullet with:

```markdown
- **Drag a player** to say where you want him at the end of the turn: a filled
  green circle appears on the spot he will actually be standing when the whistle
  blows, and a longer drag still means a harder run. Half a second does not buy
  much ground from a standing start — about two yards — so drag past what he can
  cover and the circle gives way to the old green arrow, which means "full speed
  that way, and you won't get all the way there this turn". Either mark stays
  visible until you change it or run the turn.
```

- [ ] **Step 4: Verify by hand**

Run: `npm run serve`, open `http://localhost:8080`.

Check each of these:
1. Drag the RB about half his own body-width downfield → a translucent green
   circle appears just ahead of him, *underneath* his black body where they
   overlap, and it does not move when you release.
2. Drag the RB right across the field → the circle gives way to the green dotted
   arrow at its usual full length.
3. Drag slowly from a short distance out to a long one → the mark flips from
   circle to arrow at the boundary and back again, with no flicker or leftover.
4. Press **Run Turn** on a circled plan and watch where the player stops: with
   nobody near him he lands on the circle.
5. Tap the QB, then drag → still the red dashed throw arrow, unchanged.
6. Long-press a player → still toggles his stance, unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/game/constants.js app/main.js README.md && git commit -m "feat: a drag names the spot the player will run to"
```

---

### Task 4: Cover orders and the blocking AI

The order itself: who is covering whom, and where the assist points him each
sub-step. No boosts and no rendering yet — those are Tasks 5 and 6.

**Files:**
- Modify: `lib/game/constants.js` (add the `// --- covering a man ---` block)
- Modify: `lib/game/state.js` (`makePlayer`, `setPlan`, `clearAllPlans`)
- Create: `lib/game/cover.js`
- Modify: `lib/game/turn.js` (call `updateCoverPlans` each sub-step)
- Test: `test/game/cover.test.js`

**Interfaces:**
- Consumes: `getPlayer`, `carrier` from `lib/game/state.js`; `maxSpeed` from
  `lib/game/modes.js`; `add`, `sub`, `scale`, `norm`, `len`, `dist` from
  `lib/game/vec.js`; `PICK_SLOP_UNITS` from Task 3.
- Produces, from `lib/game/cover.js`:
  - `opponentAt(state, point, team) -> string|null` — the id of the nearest
    player NOT on `team` within pick range of `point`.
  - `setCover(state, id, targetId) -> boolean` — false if the target is a
    teammate or the player himself; otherwise sets `player.cover = targetId` and
    an initial full-throttle plan at him.
  - `clearCover(state, id) -> void`
  - `coverAim(state, player) -> {x, y}` — the point the assist steers at.
  - `updateCoverPlans(state) -> void` — re-aims every covering player's plan.
- Produces on the state: every player gains a `cover` field, `null` or the id of
  the opponent he is covering.

- [ ] **Step 1: Write the failing test**

Create `test/game/cover.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  opponentAt, setCover, clearCover, coverAim, updateCoverPlans,
} from '../../lib/game/cover.js';
import { createGame, getPlayer, setPlan, clearAllPlans } from '../../lib/game/state.js';
import { runTurn } from '../../lib/game/turn.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { COVER_LEAD_MAX_SECONDS, PICK_SLOP_UNITS } from '../../lib/game/constants.js';
import { len, sub, dist } from '../../lib/game/vec.js';

test('every player starts covering nobody', () => {
  const s = createGame({ seed: 1 });
  assert.ok(s.players.every((p) => p.cover === null));
});

test('opponentAt finds only the other team, and only within pick range', () => {
  const s = createGame({ seed: 1 });
  const nt = getPlayer(s, 'd-nt');
  assert.equal(opponentAt(s, nt.pos, 'offense'), 'd-nt');
  assert.equal(opponentAt(s, nt.pos, 'defense'), null, 'his own team is not a target');
  const justOutside = { x: nt.pos.x + nt.radius + PICK_SLOP_UNITS + 0.1, y: nt.pos.y };
  assert.equal(opponentAt(s, justOutside, 'offense'), null);
});

test('covering an opponent records him and aims a full-throttle plan at him', () => {
  const s = createGame({ seed: 1 });
  assert.equal(setCover(s, 'o-c', 'd-nt'), true);
  const c = getPlayer(s, 'o-c');
  assert.equal(c.cover, 'd-nt');
  assert.equal(c.plan.throttle, 1);
  assert.equal(c.plan.target, null, 'a cover order has no landing spot to draw');
  assert.ok(c.plan.dir.y > 0, 'pointed at the man across from him');
});

test('you cannot cover your own team, and covering fails cleanly', () => {
  const s = createGame({ seed: 1 });
  assert.equal(setCover(s, 'o-c', 'o-lg'), false);
  assert.equal(getPlayer(s, 'o-c').cover, null);
});

test('a later drag replaces the cover order', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  setPlan(s, 'o-c', { x: 1, y: 0 }, 1);
  assert.equal(getPlayer(s, 'o-c').cover, null);
});

test('clearing plans clears cover orders too', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  clearAllPlans(s);
  assert.equal(getPlayer(s, 'o-c').cover, null);
  assert.equal(getPlayer(s, 'o-c').plan, null);
});

test('clearCover leaves the man standing where he was told to be', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  clearCover(s, 'o-c');
  assert.equal(getPlayer(s, 'o-c').cover, null);
});

test('with no carrier of his own the blocker shadows the target, led', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: null, pos: null, vel: null };
  setCover(s, 'o-c', 'd-nt');
  const nt = getPlayer(s, 'd-nt');
  nt.vel = { x: 20, y: 0 };
  const aim = coverAim(s, getPlayer(s, 'o-c'));
  assert.ok(aim.x > nt.pos.x, 'ahead of him, not at him');
  assert.ok(aim.x - nt.pos.x <= 20 * COVER_LEAD_MAX_SECONDS + 1e-9, 'the lead is capped');
});

test('with the ball on his own team the blocker interposes', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  const qb = getPlayer(s, 'o-qb'); // the carrier, behind the line
  const aim = coverAim(s, c);
  // The QB is upfield of the nose tackle in board coordinates (smaller y), so
  // getting between them means aiming short of the target.
  assert.ok(aim.y < nt.pos.y, 'on the carrier side of the man he is blocking');
  assert.ok(dist(aim, qb.pos) < dist(nt.pos, qb.pos), 'closer to the ball than the target is');
});

test('the assist re-aims the plan as the covered man moves', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  const before = { ...getPlayer(s, 'o-c').plan.dir };
  const nt = getPlayer(s, 'd-nt');
  nt.pos = { x: nt.pos.x + 40, y: nt.pos.y };
  updateCoverPlans(s);
  const after = getPlayer(s, 'o-c').plan.dir;
  assert.ok(after.x > before.x + 0.3, 'swung toward where he went');
  assert.ok(Math.abs(len(after) - 1) < 1e-9, 'still a unit direction');
});

test('a covering blocker chases a target he could never have been pointed at', () => {
  // The order is drawn once, at the top of the turn, but the aim is refreshed
  // every sub-step — so a target who cuts sideways is still followed.
  const s = createGame({ seed: 1, ai: null });
  s.players = s.players.filter((p) => ['o-c', 'd-nt', 'o-qb'].includes(p.id));
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  nt.pos = { x: c.pos.x, y: c.pos.y + 30 };
  setCover(s, 'o-c', 'd-nt');
  setPlan(s, 'd-nt', { x: 1, y: 0 }, 1);   // the target breaks hard to his right
  const startGap = dist(c.pos, nt.pos);
  runTurn(s, mulberry32(1));
  assert.ok(c.vel.x > 0, 'the blocker turned after him rather than running straight');
  assert.ok(dist(c.pos, nt.pos) < startGap, 'and closed the gap');
});

test('a player covering nobody is untouched by the assist', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.5, { x: 1, y: 2 });
  updateCoverPlans(s);
  assert.equal(getPlayer(s, 'o-rb').plan.throttle, 0.5);
  assert.deepEqual(getPlayer(s, 'o-rb').plan.target, { x: 1, y: 2 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `../../lib/game/cover.js` cannot be resolved.

- [ ] **Step 3: Add the cover constants**

Append to `lib/game/constants.js`:

```js
// --- covering a man ---
// How far ahead of a covered player his blocker aims, in seconds of that
// player's own velocity. Shorter than AI_LEAD_MAX_SECONDS because a blocker is
// working at arm's length, not running a pursuit angle across the field: lead
// him a whole second and the blocker steps past him on every cut.
export const COVER_LEAD_MAX_SECONDS = 0.5;
```

- [ ] **Step 4: Give every player a cover field**

In `lib/game/state.js`, add to the object `makePlayer` returns, after `facing`:

```js
    // The id of the opponent this player has been told to cover, or null. A
    // cover order and a movement arrow are alternatives, not layers: setPlan
    // clears this, and setCover writes the plan.
    cover: null,
```

In `setPlan`, clear it (the whole function, replacing Task 2's version):

```js
export function setPlan(state, id, dir, throttle, target = null) {
  const p = getPlayer(state, id);
  p.plan = { dir, throttle, target };
  p.cover = null; // a fresh arrow is a fresh order: he is not covering anyone now
}
```

In `clearAllPlans`:

```js
export function clearAllPlans(state) {
  for (const p of state.players) {
    p.plan = null;
    p.cover = null;
  }
  state.plannedPass = null;
}
```

- [ ] **Step 5: Write `lib/game/cover.js`**

```js
/**
 * Covering a man: the order you give by dragging one of your players onto one
 * of theirs.
 *
 * A cover order is not an arrow. An arrow is a direction fixed at the whistle;
 * a cover order is re-aimed every sub-step at wherever the covered man has got
 * to, which is what makes it possible to stay with someone who cuts. That is the
 * whole of the "AI" here — a blocker with an aim point that keeps moving.
 *
 * Where it aims depends on whether there is anything to protect. With the ball
 * on the blocker's own team he INTERPOSES: he aims for the point just on his
 * carrier's side of the man he is covering, which is what putting your body in
 * the way actually means. With no carrier of his own — a loose ball, or the
 * defense covering a receiver in a hot-seat game — he simply SHADOWS the target
 * where the target is going.
 */
import { add, sub, scale, norm, len, dist } from './vec.js';
import { getPlayer, carrier } from './state.js';
import { maxSpeed } from './modes.js';
import { COVER_LEAD_MAX_SECONDS, PICK_SLOP_UNITS } from './constants.js';

/**
 * The nearest player NOT on `team` within pick range of `point`, or null. The
 * same slop app/main.js's hitTest uses to pick the man being ordered, so the
 * two ends of a drag are equally forgiving.
 */
export function opponentAt(state, point, team) {
  let best = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.team === team) continue;
    const d = dist(p.pos, point);
    if (d <= p.radius + PICK_SLOP_UNITS && d < bestD) { best = p.id; bestD = d; }
  }
  return best;
}

/**
 * Take up a man. Refused for a teammate (and so, implicitly, for himself),
 * which is the caller's cue that this drag was an ordinary run.
 *
 * The plan written here is the starting aim; updateCoverPlans replaces its
 * direction every sub-step. Writing one at all matters for two reasons that
 * have nothing to do with physics: turn.js's unplannedPlayers counts a covering
 * player as planned, and render.js only looks at players who have a plan.
 * Throttle is 1 because the assist is steering — a cover order is a commitment
 * to go get him, and there is no "how hard" left for the drag to say.
 */
export function setCover(state, id, targetId) {
  const p = getPlayer(state, id);
  const t = getPlayer(state, targetId);
  if (t.team === p.team) return false;
  p.cover = targetId;
  const to = sub(t.pos, p.pos);
  p.plan = {
    dir: len(to) === 0 ? { x: 0, y: p.team === 'offense' ? 1 : -1 } : norm(to),
    throttle: 1,
    target: null,
  };
  return true;
}

export function clearCover(state, id) {
  getPlayer(state, id).cover = null;
}

/** Where the assist points this blocker right now. */
export function coverAim(state, player) {
  const t = getPlayer(state, player.cover);
  const lead = Math.min(
    COVER_LEAD_MAX_SECONDS,
    len(sub(t.pos, player.pos)) / maxSpeed(player),
  );
  const aim = add(t.pos, scale(t.vel, lead));

  // Interpose, but only for someone worth interposing for: the ball has to be
  // on this player's team and in someone else's hands. A carrier told to cover
  // a defender is doing something else entirely — running at him — and should
  // not aim behind his own back.
  const car = carrier(state);
  if (!car || car.team !== player.team || car.id === player.id) return aim;
  const toBall = sub(car.pos, aim);
  if (len(toBall) === 0) return aim;
  return add(aim, scale(norm(toBall), t.radius + player.radius));
}

/**
 * Re-aim every cover order. turn.js calls this before each physics sub-step,
 * which is what makes the order track a moving man instead of a remembered one.
 * Only the direction changes: the throttle stays at 1 and the plan never gains
 * a landing spot, because a cover order does not promise one.
 */
export function updateCoverPlans(state) {
  for (const p of state.players) {
    if (!p.cover) continue;
    const to = sub(coverAim(state, p), p.pos);
    if (len(to) === 0) continue; // standing on the aim point: no direction to run
    p.plan = { dir: norm(to), throttle: 1, target: null };
  }
}
```

- [ ] **Step 6: Re-aim the covers every sub-step**

In `lib/game/turn.js`, add the import:

```js
import { updateCoverPlans } from './cover.js';
```

and make it the first thing in the sub-step loop:

```js
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) {
    // Before the bodies move, not after: a cover order is an aim at where the
    // covered man is NOW, and re-aiming after the step would have every blocker
    // chasing a position one sub-step stale, all turn long.
    updateCoverPlans(state);
    stepPhysics(state, DT);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 8: Commit**

```bash
git add lib/game/cover.js lib/game/constants.js lib/game/state.js lib/game/turn.js test/game/cover.test.js && git commit -m "feat: a player can be told to cover a man, and keeps aiming at him"
```

---

### Task 5: What covering a man is worth

The spec's "slight boost to blocking force and grab reach". Force is effective
mass, which is what decides who gives ground in a collision. Grab reach is
contact distance — but only between the coverer and the man he covers, so
taking someone on does not turn a blocker into a wider obstacle for everybody.

**Files:**
- Modify: `lib/game/constants.js` (extend the `// --- covering a man ---` block)
- Modify: `lib/game/cover.js` (add `grabBonus`)
- Modify: `lib/game/modes.js:36-38` (`effectiveMass`)
- Modify: `lib/game/physics.js` (contact distance in `resolveCollisions`)
- Test: `test/game/cover.test.js`
- Test: `test/game/physics.test.js`

**Interfaces:**
- Consumes: `player.cover` from Task 4.
- Produces:
  - `grabBonus(a, b) -> number` from `lib/game/cover.js` — extra contact distance
    for a pair where one is covering the other, else 0.
  - `effectiveMass(player)` in `lib/game/modes.js` now folds in
    `COVER_MASS_MULT` when `player.cover` is set. Its signature is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `test/game/cover.test.js` (extend the existing imports with `grabBonus`
from `../../lib/game/cover.js`, `effectiveMass` from `../../lib/game/modes.js`,
and `COVER_MASS_MULT`, `COVER_GRAB_REACH`, `HOLD_MASS_MULT` from constants):

```js
test('covering a man makes him heavier to shove, slightly', () => {
  const s = createGame({ seed: 1 });
  const c = getPlayer(s, 'o-c');
  const plain = effectiveMass(c);
  setCover(s, 'o-c', 'd-nt');
  assert.ok(Math.abs(effectiveMass(c) - plain * COVER_MASS_MULT) < 1e-9);
  assert.ok(COVER_MASS_MULT < HOLD_MASS_MULT, 'a nudge, not the holding stance');
});

test('the boost is only worth having while the order stands', () => {
  const s = createGame({ seed: 1 });
  const c = getPlayer(s, 'o-c');
  const plain = effectiveMass(c);
  setCover(s, 'o-c', 'd-nt');
  clearCover(s, 'o-c');
  assert.equal(effectiveMass(c), plain);
});

test('grab reach is granted between the coverer and his man, and nobody else', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  const dt = getPlayer(s, 'd-dt1');
  const lg = getPlayer(s, 'o-lg');
  assert.equal(grabBonus(c, nt), COVER_GRAB_REACH);
  assert.equal(grabBonus(nt, c), COVER_GRAB_REACH, 'symmetric: order of the pair is irrelevant');
  assert.equal(grabBonus(c, dt), 0, 'not against the man he did not take');
  assert.equal(grabBonus(lg, nt), 0, 'and not for the man who gave no order');
});
```

Add to `test/game/physics.test.js` (extend the imports with `setCover` from
`../../lib/game/cover.js` and `COVER_GRAB_REACH` from constants):

```js
test('a blocker holds the man he covers off at arm\'s length', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => ['o-c', 'd-nt'].includes(p.id));
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  // Overlapping by a hair, both standing still, no plans: one step of
  // positional correction is all this is measuring.
  c.pos = { x: 135, y: 100 };
  nt.pos = { x: 135, y: 100 + c.radius + nt.radius - 0.5 };
  setCover(s, 'o-c', 'd-nt');
  c.plan = null;
  nt.plan = null;
  stepPhysics(s, DT);
  const gap = len({ x: nt.pos.x - c.pos.x, y: nt.pos.y - c.pos.y });
  assert.ok(
    Math.abs(gap - (c.radius + nt.radius + COVER_GRAB_REACH)) < 1e-6,
    `pushed out to the grab distance, got ${gap}`,
  );
});

test('two players with no cover order between them touch at their own radii', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => ['o-c', 'd-nt'].includes(p.id));
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  c.pos = { x: 135, y: 100 };
  nt.pos = { x: 135, y: 100 + c.radius + nt.radius - 0.5 };
  c.plan = null;
  nt.plan = null;
  stepPhysics(s, DT);
  const gap = len({ x: nt.pos.x - c.pos.x, y: nt.pos.y - c.pos.y });
  assert.ok(Math.abs(gap - (c.radius + nt.radius)) < 1e-6, `got ${gap}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `grabBonus` is not exported from `lib/game/cover.js`, and the
mass and gap assertions all report the un-boosted values.

- [ ] **Step 3: Add the boost constants**

Extend the `// --- covering a man ---` block in `lib/game/constants.js`:

```js
// The spec's "slight boost to blocking force". Effective mass is what decides
// who gives ground in a collision, so this is the whole of the force bonus.
// Deliberately far below HOLD_MASS_MULT's 4: the defend-position stance costs a
// player almost all his movement to earn that, and a cover order costs nothing.
export const COVER_MASS_MULT = 1.5;
// The spec's "slight boost to grab reach": extra contact distance between a
// blocker and the man he took, in units. 1.5 units is 0.4 yards — an arm, and
// half of what HOLD_REACH grants. It applies to that ONE pair, so taking a man
// on never turns a blocker into a wider obstacle for everyone else on the field.
export const COVER_GRAB_REACH = 1.5;
```

- [ ] **Step 4: Grant the reach**

Append to `lib/game/cover.js`:

```js
/**
 * The extra contact distance a cover order buys, for one pair of players.
 * Symmetric, because a collision has no near end and far end: either of them
 * covering the other is the same engagement, and physics.js resolves the pair
 * once whichever way round it happens to hold them.
 */
export function grabBonus(a, b) {
  return a.cover === b.id || b.cover === a.id ? COVER_GRAB_REACH : 0;
}
```

...and add `COVER_GRAB_REACH` to that file's constants import.

- [ ] **Step 5: Grant the force**

In `lib/game/modes.js`, replace `effectiveMass` (and add `COVER_MASS_MULT` to
the constants import):

```js
/**
 * How hard this player is to move. The defend-position stance is the big one;
 * a cover order adds a slighter multiplier on top of whatever else he is doing,
 * because taking a man on is a commitment even when it is not a stance.
 */
export function effectiveMass(player) {
  const stance = player.mode === 'holding' ? HOLD_MASS_MULT : 1;
  const covering = player.cover ? COVER_MASS_MULT : 1;
  return player.mass * stance * covering;
}
```

- [ ] **Step 6: Spend the reach in the collision pass**

In `lib/game/physics.js`, add the import:

```js
import { grabBonus } from './cover.js';
```

and in `resolveCollisions`, replace the overlap line:

```js
      // Contact distance, not just the two radii: a blocker who has taken this
      // man on engages him an arm's length further out, so he can get hands on
      // him before their bodies actually meet. The bonus is nil for every other
      // pair on the field.
      const overlap = a.radius + b.radius + grabBonus(a, b) - d;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 8: Commit**

```bash
git add lib/game/constants.js lib/game/cover.js lib/game/modes.js lib/game/physics.js test/game/cover.test.js test/game/physics.test.js && git commit -m "feat: covering a man buys a little blocking force and a little reach"
```

---

### Task 6: Drawing a cover order

The dotted line to the man being covered, and the green halo under him.

**Files:**
- Modify: `lib/game/constants.js` (add `COVER_HALO_UNITS`)
- Modify: `lib/game/render.js` (`STYLE_GAME`; add `coverHaloMark`, `coverMark`; branch in `renderPlans`)
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: `player.cover` (Task 4); `arrowMark(from, to)` and `renderPlans`
  (Task 2).
- Produces:
  - `coverHaloMark(target) -> string` — the green disc under the covered player.
  - `coverMark(player, target) -> string` — the halo plus the dotted line, in
    that order so the line draws over the halo.

- [ ] **Step 1: Write the failing test**

Add to `test/game/render.test.js` (extend the render import with `renderPlans`
— already there from Task 2 — plus `coverMark`, `coverHaloMark`; add
`setCover` from `../../lib/game/cover.js` and `COVER_HALO_UNITS` from constants):

```js
test('a cover order draws a halo under the covered man and a dotted line to him', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  const svg = renderPlans(s);
  const nt = getPlayer(s, 'd-nt');
  assert.ok(svg.includes('class="cover-halo"'), 'the halo');
  assert.ok(svg.includes('class="plan-mv"'), 'the same dotted green line as a plan arrow');
  assert.ok(!svg.includes('class="plan-dest"'), 'and no destination circle');
  assert.ok(svg.includes(`cx="${num(nt.pos.x)}" cy="${num(nt.pos.y)}"`), 'centred on him');
  assert.ok(svg.includes(`data-for="o-c"`), 'attributed to the blocker, not the target');
});

test('the halo is a little wider than the man it sits under', () => {
  const s = createGame({ seed: 1 });
  const nt = getPlayer(s, 'd-nt');
  const halo = coverHaloMark(nt);
  assert.ok(halo.includes(`r="${num(nt.radius + COVER_HALO_UNITS)}"`));
  assert.ok(COVER_HALO_UNITS > 0 && COVER_HALO_UNITS < nt.radius, 'a rim, not a target ring');
});

test('the cover line stops at the covered man\'s edge, not his centre', () => {
  const s = createGame({ seed: 1 });
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  c.pos = { x: 135, y: 100 };
  nt.pos = { x: 135, y: 130 };
  const mark = coverMark(c, nt);
  assert.ok(mark.includes(`L ${num(135)} ${num(130 - nt.radius)}`), mark);
});

test('the halo is drawn before the line, so the line reads on top of it', () => {
  const s = createGame({ seed: 1 });
  const mark = coverMark(getPlayer(s, 'o-c'), getPlayer(s, 'd-nt'));
  assert.ok(mark.indexOf('cover-halo') < mark.indexOf('plan-mv'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `coverMark` and `coverHaloMark` are not exported from
`lib/game/render.js`.

- [ ] **Step 3: Add the halo width constant**

Extend the `// --- covering a man ---` block in `lib/game/constants.js`:

```js
// How far the cover halo sticks out past the covered player's own circle. It is
// drawn in the layer BENEATH the players, so this rim is the only part of it
// anyone ever sees — the spec asks for exactly that: an edge just visible from
// under the man. Keep it well under a skill player's radius (2.5) or it stops
// reading as a shadow and starts reading as a target ring.
export const COVER_HALO_UNITS = 1.2;
```

- [ ] **Step 4: Draw it**

In `lib/game/render.js`, add the imports:

```js
import { sub, len } from './vec.js';
```

and add `COVER_HALO_UNITS` to the constants import.

Add to `STYLE_GAME`, immediately after the `.plan-dest` entry:

```js
  // The cover halo: a green disc under the man a blocker has taken on. It lives
  // in the `game-arrows` layer, which renderBoardShell puts BENEATH
  // `game-players`, so the player's own body covers all of it but the rim — the
  // spec's "edge just visible from under the player". More opaque than
  // .plan-dest precisely because so little of it shows.
  '.cover-halo{fill:#1a7f37;fill-opacity:.55;stroke:#1a7f37;stroke-width:.5;pointer-events:none}',
```

Add, next to `destinationMark`:

```js
/** The disc under a covered player. Only its rim is ever visible; see the style. */
export function coverHaloMark(target) {
  return (
    `<circle cx="${num(target.pos.x)}" cy="${num(target.pos.y)}"` +
    ` r="${num(target.radius + COVER_HALO_UNITS)}" class="cover-halo"/>`
  );
}

/**
 * A cover order: the halo under the covered man, and the ordinary green dotted
 * plan line running to him. The line is the SAME mark a movement arrow uses —
 * this is still a plan, and drawing it in a second visual language would say it
 * was something else. It stops at the target's edge rather than his centre so
 * the arrowhead lands on him instead of inside him.
 *
 * Halo first: the line has to read on top of it.
 */
export function coverMark(player, target) {
  const to = sub(target.pos, player.pos);
  const l = len(to);
  const reach = Math.max(0, l - target.radius);
  const tip = l === 0
    ? { ...target.pos }
    : { x: player.pos.x + (to.x / l) * reach, y: player.pos.y + (to.y / l) * reach };
  return coverHaloMark(target) + arrowMark(player.pos, tip);
}
```

Extend `renderPlans`'s `mark` expression:

```js
      const mark = p.cover
        ? coverMark(p, getPlayer(state, p.cover))
        : p.plan.target
          ? destinationMark(p.plan.target, p.radius)
          : arrowMark(p.pos, {
            x: p.pos.x + p.plan.dir.x * p.plan.throttle * MAX_ARROW_UNITS,
            y: p.pos.y + p.plan.dir.y * p.plan.throttle * MAX_ARROW_UNITS,
          });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 6: Commit**

```bash
git add lib/game/constants.js lib/game/render.js test/game/render.test.js && git commit -m "feat: a cover order draws a line to the man and a halo under him"
```

---

### Task 7: Giving a cover order in the app

Wire the drag-onto-an-opponent gesture, live preview included.

**Files:**
- Modify: `app/main.js` (imports, `onGesture`, `onDragPreview`)
- Modify: `README.md` (a new bullet after the drag bullet)

**Interfaces:**
- Consumes: `opponentAt(state, point, team)` and `setCover(state, id, targetId)`
  from `lib/game/cover.js`; `coverMark(player, target)` from
  `lib/game/render.js`; `planForDrag` and `runMark` from Task 3.

Verified by hand, like Task 3 — the logic is covered by Tasks 4-6.

- [ ] **Step 1: Wire the gesture**

In `app/main.js`, add:

```js
import { opponentAt, setCover } from '../lib/game/cover.js';
```

and add `coverMark` to the render import.

Add this helper next to `runMark`:

```js
/**
 * What a run drag should draw, given where the pointer is. Dragging onto one of
 * their players is a cover order; anything else is a destination or an arrow.
 * The live preview and the committed plan both ask this, so the picture never
 * changes shape at the moment the finger comes up.
 */
function runOrCoverMark(player, travel, point) {
  const opp = opponentAt(state, point, player.team);
  return opp
    ? coverMark(player, getPlayer(state, opp))
    : runMark(player, planForDrag(player, travel));
}
```

In `onGesture`, the `drag` branch becomes:

```js
  } else if (gesture.kind === 'drag') {
    const opp = opponentAt(state, point, p.team);
    if (opp && setCover(state, playerId, opp)) {
      say(`${p.role} will cover ${getPlayer(state, opp).role}.`);
    } else {
      const run = planForDrag(p, gesture.travel);
      setPlan(state, playerId, run.dir, run.throttle, run.target);
      say('');
    }
    pendingWarning = false;
```

Leave the `passdrag` fallback from Task 3 alone: a tap-then-drag is a throw
gesture, and a throw that cannot happen falls back to a run, not to a block.

In `onDragPreview`, replace the `mark` expression again:

```js
  const mark = throwing
    ? passArrowMark(p.pos, passArrowTip(p.pos, g.dir, g.throttle))
    : runOrCoverMark(p, g.travel, log[log.length - 1]);
```

- [ ] **Step 2: Update the README**

Insert immediately after the `**Drag a player**` bullet added in Task 3:

```markdown
- **Drag a player onto one of theirs** to put him on that man. The circle gives
  way to a dotted line running to the man he has taken, and a green disc appears
  under that man with just its rim showing. From then on he does not run at a
  fixed spot — he re-aims at his man every moment of the turn, and while your
  team has the ball he works to get his body *between* that man and your ball
  carrier rather than merely chasing him. Taking a man on costs nothing and is
  worth a little: slightly more force to hold ground in contact, and an arm's
  length of extra reach — against that man alone. Drag him anywhere else to call
  it off.
```

- [ ] **Step 3: Verify by hand**

Run: `npm run serve`, open `http://localhost:8080`.

Check each of these:
1. Drag the C onto the NT across from him → the dotted green line runs to the
   NT and stops at his edge, and a thin green rim shows around the NT's white
   body. The rim is *behind* him: none of the disc covers his circle or his
   `NT` label.
2. Drag partway toward the NT and stop short → the destination circle. Continue
   the drag onto him → it flips to line-and-halo. Drag off him again → back to
   the circle or the arrow. No leftover marks.
3. Release on the NT → the message reads `C will cover NT.` and the line and
   halo stay on the board.
4. Press **Run Turn** → the C moves toward the NT and finishes between the NT
   and the QB, and the two of them separate slightly further than two touching
   circles would.
5. Move the NT (press **Defense: you** first) somewhere the C was not pointed,
   set a cover order, and run the turn → the C turns after him mid-turn rather
   than running his original line.
6. Drag the C somewhere empty → the cover order is gone, replaced by a circle
   or an arrow.
7. **Clear Arrows** wipes cover orders along with everything else.
8. Drag the C onto one of your own players → an ordinary run drag; no line, no
   halo.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS (nothing under `lib/` changed, but the suite must stay green
before the commit).

- [ ] **Step 5: Commit**

```bash
git add app/main.js README.md && git commit -m "feat: dragging onto an opposing player puts your man on him"
```

---

### Task 8: Bring the README's own account of the game up to date

Tasks 3 and 7 changed the two "How to play" bullets they own. Two *other*
passages in the README now describe a game that no longer exists.

**Files:**
- Modify: `README.md` (the "One thing this version doesn't do" paragraph, and the
  `**Run Turn**` bullet)

- [ ] **Step 1: Fix the two stale passages**

In `README.md`, the `**Run Turn**` bullet currently says "everyone moves along
their arrow at once". Replace that clause so it covers cover orders:

```markdown
- Press **Run Turn** to play out half a second of simulated movement — everyone
  moves along their arrow (or toward the man they were put on) at once, with
  blocking friction as players come together, and a chance of a tackle whenever
  a defender gets within reach of the ball carrier. If any player doesn't have
  an arrow set yet, you'll get a warning naming how many; press **Run Turn**
  again to run the turn anyway.
```

Then, in the paragraph beginning "One thing this version *doesn't* do", replace
its final sentence — "Every formation starts at its default positions — you set
direction and stance from there, but you can't drag a player to a new starting
spot pre-snap." — with:

```markdown
Every formation starts at its default positions — you set destinations, cover
orders and stances from there, but you can't drag a player to a new starting
spot pre-snap.
```

- [ ] **Step 2: Check nothing else is stale**

Run: `grep -n "arrow" README.md`
Expected: every remaining hit is about the throw arrow, the fallback run arrow
for an out-of-reach drag, or **Clear Arrows** — none of them claims a drag's only
outcome is an arrow. Fix any that do.

- [ ] **Step 3: Commit**

```bash
git add README.md && git commit -m "docs: the README describes destinations and cover orders"
```

---

## Notes for the executor

- **`test/game/turn.test.js` and `test/game/integration.test.js` are the canary.**
  Task 4 puts `updateCoverPlans` inside the sub-step loop. It is a no-op for
  every player with `cover === null`, so both files should stay green untouched.
  If either goes red, the assist is reaching players it has no business
  reaching — fix `cover.js`, not the test.
- **Do not clear cover orders at the end of a turn.** Human movement plans
  already persist across turns in this game (`runTurn` clears only the
  computer's plans and the planned throw), and a cover order is a movement plan.
  `nextDown` rebuilds `state.players` from the formation, which drops them at
  the right moment for free.
- **The computer never issues cover orders.** `ai.js` is untouched by this plan.
  Its defenders pursue the ball; adding cover to its repertoire is a separate
  feature with its own plan.
