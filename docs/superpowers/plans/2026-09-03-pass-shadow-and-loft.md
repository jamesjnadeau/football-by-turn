# Pass shadow and loft — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a coach where a deep throw will be at the end of each turn it
hangs in the air, and let him trade speed for hang time on an already-aimed
throw without moving where it lands.

**Architecture:** Three pure-function layers grow a `loft` parameter
(`lib/game/lob.js`'s hang-time formula, `lib/game/pass.js`'s throw arithmetic,
`lib/game/state.js`'s `plannedPass`), one rendering layer draws what they
compute (`lib/game/render.js`), and the input layer (`app/input.js`,
`app/main.js`) grows a second kind of hit-test target — the committed arrow's
tip — so a coach can grab it again to drive that parameter.

**Tech Stack:** Vanilla JS (ES modules), `node --test` for `lib/game/*`, no
new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-03-pass-shadow-and-loft-design.md](../specs/2026-09-03-pass-shadow-and-loft-design.md)

## Global Constraints

- `loft` is always a number in `[0, 1]`. `0` is the default and the floor;
  `1` is the ceiling and matches every lob's hang time exactly as the game
  throws it today.
- `LOB_MIN_TIME_MULT = 1` (new constant) is the floor multiplier; `LOB_TIME_MULT`
  keeps its existing value of `2` and becomes the ceiling.
- `LOFT_DRAG_UNITS = 30` (new constant) is the pointer travel, in board units,
  that spans the whole `0`–`1` loft range on the loft-handle drag.
- None of the three new marks (flight path, shadow balls, loft handle) apply
  to a throw locked onto a receiver, or to a throw short of `LOB_LOCK_YARDS` —
  see spec decision 5.
- No change to `LOB_SCATTER_PER_YARD`/`scatterRadius` — loft is a timing
  parameter only, never an accuracy one.
- No new runtime dependencies. Tests use `node --test` and `node:assert/strict`,
  matching every existing test file in `test/game/`.

---

### Task 1: `lib/game/lob.js` — loft-aware hang time, and an exported dead-zone span

**Files:**
- Modify: `lib/game/constants.js:226-231`, `lib/game/lob.js:68-91`, `lib/game/lob.js:116-126`
- Test: `test/game/lob.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `lobSubsteps(distanceUnits, loft = 0) → number` (second parameter
  is new); `planLob(from, aim, random, loft = 0) → lob` (fourth parameter is
  new); `deadZoneSpan(totalDistanceUnits) → { start, end }` (new export).

- [ ] **Step 1: Write the failing tests**

In `test/game/lob.test.js`, add `LOB_MIN_TIME_MULT` to the existing constants
import (line 9-10) and `deadZoneSpan` to the existing `lob.js` import (line
3-7). Then **replace** the `'hang time is measured against the deepest throw
in the game'` test (current lines 58-63) with:

```js
test('hang time is measured against the deepest throw in the game, and loft stretches it', () => {
  const bombAt = (loft) => lobSubsteps(PASS_REACH_MAX, loft);
  const lockAt = (loft) => lobSubsteps(LOCK_UNITS, loft);
  assert.equal(bombAt(0), Math.round(LOB_MIN_TIME_MULT * SUBSTEPS_PER_TURN),
    'the fastest this throw can arrive, at no loft at all');
  assert.equal(bombAt(1), LOB_TIME_MULT * SUBSTEPS_PER_TURN, 'full loft: exactly how a lob has always hung');
  assert.equal(bombAt(1), 60, 'two whole turns, same as always');
  assert.equal(lockAt(1), 30, 'and the shortest lob for exactly one turn, same as always');
  const half = LOB_MIN_TIME_MULT + 0.5 * (LOB_TIME_MULT - LOB_MIN_TIME_MULT);
  assert.equal(bombAt(0.5), Math.round(half * SUBSTEPS_PER_TURN), 'loft interpolates between the two');
  assert.equal(lobSubsteps(0, 0), 1, 'never zero, at any loft');
  assert.equal(lobSubsteps(0, 1), 1);
  assert.equal(lobSubsteps(PASS_REACH_MAX), bombAt(0), 'no loft argument means no loft at all');
});
```

Then add a new test just after it:

```js
test('deadZoneSpan is the same lock-to-catch-window arithmetic a live lob already flies by', () => {
  const total = PASS_REACH_MAX;
  const span = deadZoneSpan(total);
  assert.equal(span.start, LOCK_UNITS);
  assert.equal(span.end, total - CATCH_UNITS);
  // Proven against a real lob's own lobCatchable, at the same boundaries.
  const lob = bomb();
  const catchableAt = (units) => { lob.elapsed = (units / total) * lob.substeps; return lobCatchable(lob); };
  assert.equal(catchableAt(span.start - 1), true);
  assert.equal(catchableAt(span.start + 1), false);
  assert.equal(catchableAt(span.end - 1), false);
  assert.equal(catchableAt(span.end + 1), true);
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
node --test test/game/lob.test.js
```

Expected: FAIL — `deadZoneSpan` is not exported, and `lobSubsteps`'s
single-argument results no longer match the new two-argument expectations.

- [ ] **Step 3: Implement**

In `lib/game/constants.js`, replace the `LOB_TIME_MULT` comment and constant
(current lines 226-231) with:

```js
// How much longer a lob hangs than an ordinary throw of the same length, at
// FULL LOFT — the ceiling a coach reaches by dragging the committed arrow's
// tip all the way out (see pass.js's loftFromDrag). The yardstick is the
// whole board: a full-power throw covers its 29.6 yards in about one turn at
// LOB_MIN_TIME_MULT, so a fully lofted one that long takes two, and one at
// the lock boundary takes exactly one. That is the price of the arc — and
// the reason the receivers get a planning phase to run under a deep ball.
export const LOB_TIME_MULT = 2;
// The floor: how long a lob hangs with no loft dragged in at all. Half of
// LOB_TIME_MULT, so the same full-power bomb that takes two turns at full
// loft covers the board in exactly one at none — the fastest arm in the game
// throws it, and a coach who never touches the loft handle gets that throw
// by default.
export const LOB_MIN_TIME_MULT = 1;
```

In `lib/game/lob.js`, add `LOB_MIN_TIME_MULT` to the constants import (line
30-32). Replace `lobSubsteps` (current lines 68-77) with:

```js
/**
 * How many sub-steps a lob this long hangs, measured against the deepest
 * throw in the game and the loft it was thrown with: `loft` 0 hangs it for
 * LOB_MIN_TIME_MULT turns' worth of its own share of the board, `loft` 1 for
 * LOB_TIME_MULT's, and anything between is a straight line across the two.
 * Never zero — a flight has to take some time, or the ball would teleport and
 * the zones would never be visited.
 */
export function lobSubsteps(distanceUnits, loft = 0) {
  const share = distanceUnits / PASS_REACH_MAX;
  const mult = LOB_MIN_TIME_MULT + loft * (LOB_TIME_MULT - LOB_MIN_TIME_MULT);
  return Math.max(1, Math.round(mult * SUBSTEPS_PER_TURN * share));
}
```

Replace `planLob` (current lines 79-91) with:

```js
/**
 * The flight plan for a throw from `from` aimed at `aim`. The scatter is rolled
 * HERE, once, at release — not per sub-step and not at paint time — so the ball
 * has a landing spot from the moment it leaves the hand and a seeded game
 * replays the same throw every time. `loft`, [0,1], is the coach's own choice
 * of hang time within that same throw's reach — see lobSubsteps.
 */
export function planLob(from, aim, random, loft = 0) {
  const radius = scatterRadius(dist(from, aim));
  const to = scatterPoint(aim, radius, random);
  return {
    from: { ...from }, to, aim: { ...aim }, radius, substeps: lobSubsteps(dist(from, to), loft), elapsed: 0,
  };
}
```

Replace the private `deadZone` function **and its doc comment** (current
lines 116-126) with:

```js
/**
 * The dead zone's two boundaries, as distances from the hand along a throw
 * this long. Exported so pass.js's flight-path preview can draw the same
 * stretch before a real lob object exists to ask deadZone() about it.
 */
export function deadZoneSpan(totalDistanceUnits) {
  return { start: LOCK_UNITS, end: totalDistanceUnits - CATCH_UNITS };
}

function deadZone(lob) {
  const total = dist(lob.from, lob.to);
  return { ...deadZoneSpan(total), total };
}
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
node --test test/game/lob.test.js
```

Expected: PASS, all tests including the ones untouched by this task (they
exercise `deadZone` indirectly through `lobCatchable`/`lobBallScale`, whose
output is unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/game/constants.js lib/game/lob.js test/game/lob.test.js
git commit -m "feat: a lob's hang time takes a loft, floor to ceiling"
```

---

### Task 2: `lib/game/pass.js` — the loft-from-drag and shadow-spot arithmetic

**Files:**
- Modify: `lib/game/constants.js` (new constant near `LOB_MIN_TIME_MULT`),
  `lib/game/pass.js:14-25`, `lib/game/pass.js` (new functions after
  `passLanding`), `lib/game/pass.js:237-239` (`releasePass`)
- Test: `test/game/pass.test.js`

**Interfaces:**
- Consumes: `lobSubsteps` (Task 1).
- Produces: `loftFromDrag(plannedPass, travel) → number` (new);
  `passShadowSpots(player, dir, power, loft = 0) → {x,y}[]` (new).

- [ ] **Step 1: Write the failing tests**

In `test/game/pass.test.js`, add `loftFromDrag, passShadowSpots` to the
existing `pass.js` import (line 3-7) and `LOFT_DRAG_UNITS` to the existing
`constants.js` import (line 11-14). Then add:

```js
test('loftFromDrag reads loft straight off this grab\'s own displacement', () => {
  const pp = { dir: { x: 0, y: 1 } };
  assert.equal(loftFromDrag(pp, { x: 0, y: 0 }), 0, 'no travel, no loft');
  assert.equal(loftFromDrag(pp, { x: 0, y: LOFT_DRAG_UNITS }), 1, 'the whole span, away from the passer');
  assert.ok(Math.abs(loftFromDrag(pp, { x: 0, y: LOFT_DRAG_UNITS / 2 }) - 0.5) < 1e-9, 'halfway is half');
  assert.equal(loftFromDrag(pp, { x: 0, y: LOFT_DRAG_UNITS * 3 }), 1, 'clamped at the top');
  assert.equal(loftFromDrag(pp, { x: 0, y: -5 }), 0, 'toward the passer floors at zero, never negative');
  assert.equal(loftFromDrag(pp, { x: LOFT_DRAG_UNITS, y: 0 }), 0, 'sideways travel is not loft');
});

test('passShadowSpots marks nothing for a throw short of the lock zone', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  assert.deepEqual(passShadowSpots(qb, { x: 0, y: 1 }, 0.4), []);
});

test('passShadowSpots walks the aim line, one spot per turn boundary it hangs for', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const dir = { x: 0, y: 1 };
  const one = passShadowSpots(qb, dir, 1, 0);
  assert.equal(one.length, 1, 'no loft: the bomb covers the board inside its own turn');
  assert.deepEqual(one[0], passAim(qb, dir, 1));
  const two = passShadowSpots(qb, dir, 1, 1);
  assert.equal(two.length, 2, 'full loft: the same throw now takes two turns');
  const origin = passOrigin(qb, dir);
  const aim = passAim(qb, dir, 1);
  assert.ok(Math.abs(two[0].y - (origin.y + (aim.y - origin.y) * 0.5)) < 1e-6, 'first turn: halfway there');
  assert.deepEqual(two[1], aim, 'second turn: landed, on the aim point exactly');
});

test('releasePass threads the planned loft into the lob it actually throws', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1, null, 1); // full loft
  releasePass(s, mulberry32(1));
  const total = dist(s.ball.lob.from, s.ball.lob.to);
  assert.equal(s.ball.lob.substeps, lobSubsteps(total, 1), 'the coach\'s loft survives to the real throw');
  assert.ok(lobSubsteps(total, 1) > lobSubsteps(total, 0), 'and it is genuinely longer than no loft would be');
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
node --test test/game/pass.test.js
```

Expected: FAIL — `loftFromDrag` and `passShadowSpots` are not exported yet,
and the fifth `setPass` argument does nothing.

- [ ] **Step 3: Implement**

In `lib/game/constants.js`, add just after `LOB_MIN_TIME_MULT`:

```js
// How much pointer travel, along the throw's own line, spans the loft handle's
// whole 0-to-1 range. Half of MAX_PASS_ARROW_UNITS — a smaller, second-thought
// gesture on top of the throw the coach already committed.
export const LOFT_DRAG_UNITS = 30;
```

In `lib/game/pass.js`, change the imports (current lines 14-18) to:

```js
import { add, scale, norm, sub, len, dist, dot } from './vec.js';
import { carrier, getPlayer } from './state.js';
import { yardsOfY } from './view.js';
import { passSpeed, passReach, passTravel, powerForTravel, spawnOffset } from './flight.js';
import {
  PASS_GRACE_SUBSTEPS, PICK_SLOP_UNITS, PICKUP_RADIUS_BONUS, SUBSTEPS_PER_TURN, LOFT_DRAG_UNITS,
} from './constants.js';
```

Change the `lob.js` import (current line 25) to:

```js
import { isLob, planLob, scatterRadius, LOCK_UNITS, lobSubsteps } from './lob.js';
```

After `passLanding` (which ends just before the `releasePass` docblock), add:

```js
/**
 * The loft a drag on the committed arrow's tip is asking for: how far past
 * the tip, ALONG THE THROW'S OWN LINE, the pointer has travelled since it
 * grabbed on. Away from the passer raises it toward 1 (more hang time, see
 * lob.js's lobSubsteps); back toward him lowers it toward 0, where it floors
 * — there is no equivalent of backOnPasser's "call the whole throw off" for
 * this smaller gesture. Read fresh from THIS grab's own displacement rather
 * than added to whatever loft was already set, so a short, deliberate re-drag
 * always means exactly what it visually shows.
 */
export function loftFromDrag(plannedPass, travel) {
  const signed = dot(norm(plannedPass.dir), travel);
  return Math.max(0, Math.min(1, signed / LOFT_DRAG_UNITS));
}

/**
 * Where this throw is projected to be at the end of this turn, and the next,
 * until it lands — one spot per turn boundary it is still in the air for.
 * Walked along the straight line from hand to aim point rather than the
 * scattered landing spot planLob eventually rolls: that roll is drawn only
 * once, when the ball actually leaves the hand, so a plan being previewed or
 * re-previewed on every loft drag must never touch state's random stream.
 * Empty for anything that does not lob at all — there is nothing pending to
 * mark on a throw that resolves inside the turn it is thrown.
 */
export function passShadowSpots(player, dir, power, loft = 0) {
  const reach = passReach(power);
  if (!isLob(reach)) return [];
  const origin = passOrigin(player, dir);
  const aim = passAim(player, dir, power);
  const total = lobSubsteps(reach, loft);
  const turns = Math.ceil(total / SUBSTEPS_PER_TURN);
  const spots = [];
  for (let n = 1; n <= turns; n++) {
    const t = Math.min(n * SUBSTEPS_PER_TURN, total) / total;
    spots.push({ x: origin.x + (aim.x - origin.x) * t, y: origin.y + (aim.y - origin.y) * t });
  }
  return spots;
}
```

In `releasePass` (current lines 237-239), change:

```js
    lob: !planned.target && isLob(reach)
      ? planLob(pos, add(pos, scale(dir, reach)), random)
      : null,
```

to:

```js
    lob: !planned.target && isLob(reach)
      ? planLob(pos, add(pos, scale(dir, reach)), random, planned.loft ?? 0)
      : null,
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
node --test test/game/pass.test.js
```

Expected: PASS, including every pre-existing test in the file (the two
self-referential `lobSubsteps(dist(...))` assertions at the old lines 232 and
72-of-lob.test.js call the function with the same implicit default on both
sides, so they stay green without modification).

- [ ] **Step 5: Commit**

```bash
git add lib/game/constants.js lib/game/pass.js test/game/pass.test.js
git commit -m "feat: a loft to drag for, and the spots it hangs a ball over"
```

---

### Task 3: `lib/game/state.js` — `setPass` carries the coach's loft

**Files:**
- Modify: `lib/game/state.js:339-357`
- Test: `test/game/state.test.js`, `test/game/play.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `setPass(state, id, dir, power, target = null, loft = 0) → boolean`
  (fifth parameter is new); `state.plannedPass.loft` (new field, always
  present on a throw set through `setPass`).

- [ ] **Step 1: Write the failing tests**

In `test/game/state.test.js`, update the three exact-shape assertions that a
new `loft` field would otherwise break. Change (current line 224):

```js
  assert.deepEqual(s.plannedPass, { from: 'o-c', dir: { x: 1, y: 0 }, power: 0.4, target: null });
```

to:

```js
  assert.deepEqual(s.plannedPass, { from: 'o-c', dir: { x: 1, y: 0 }, power: 0.4, target: null, loft: 0 });
```

Change (current lines 243 and 245):

```js
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 0, y: 1 }, power: 0.5, target: null });
  setPass(s, 'o-qb', { x: 1, y: 0 }, 0.9);
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 1, y: 0 }, power: 0.9, target: null });
```

to:

```js
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 0, y: 1 }, power: 0.5, target: null, loft: 0 });
  setPass(s, 'o-qb', { x: 1, y: 0 }, 0.9);
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 1, y: 0 }, power: 0.9, target: null, loft: 0 });
```

Then add a new test just after the lock-on test (current lines 258-266):

```js
test('a throw can be given loft, and a fresh one resets it to none', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1, null, 0.7);
  assert.equal(s.plannedPass.loft, 0.7);
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1); // a fresh drag, no loft argument
  assert.equal(s.plannedPass.loft, 0, 'a new throw starts at no loft, not wherever the old one was left');
});
```

In `test/game/play.test.js`, change (current line 195):

```js
  assert.deepEqual(fresh.plannedPass, { from: 'o-qb', dir: { x: 0, y: 1 }, power: 0.8, target: null });
```

to:

```js
  assert.deepEqual(fresh.plannedPass, { from: 'o-qb', dir: { x: 0, y: 1 }, power: 0.8, target: null, loft: 0 });
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
node --test test/game/state.test.js test/game/play.test.js
```

Expected: FAIL — the four updated `deepEqual`s find no `loft` key on
`plannedPass`, and the new test finds `undefined`.

- [ ] **Step 3: Implement**

In `lib/game/state.js`, replace `setPass` and its docblock (current lines
339-357) with:

```js
/**
 * Plan a throw for this turn. Only whoever is holding the ball may throw, so a
 * player who is not the carrier is refused — the caller names him, rather than
 * the function quietly substituting whoever happens to have the ball. Only one
 * throw is planned at a time: a second call replaces the first, exactly as a
 * second drag replaces a movement arrow. `power` is the drag's throttle in
 * [0,1]; pass.js's releasePass is what turns it into a speed.
 *
 * `target` is the id of the receiver this throw is locked onto, or null. It
 * changes nothing about how the ball flies — releasePass reads `dir` and
 * `power` like it always has — but it is what tells the board to draw the lock
 * instead of a bare arrow, and what tells releasePass this throw is aimed at a
 * man and must therefore stay in his reach rather than arcing over him.
 *
 * `loft` is a throw's hang time, [0,1], `0` by default — the fastest this
 * throw can arrive. Nothing here reads it; only lob.js's lobSubsteps does,
 * once the ball actually leaves the hand. A fresh call always resets it to
 * `0`, the same as any other field on a fresh throw: re-aiming a plan starts
 * its loft over too, not just its direction.
 */
export function setPass(state, id, dir, power, target = null, loft = 0) {
  if (state.ball.carrierId !== id) return false;
  state.plannedPass = { from: id, dir, power, target, loft };
  return true;
}
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
node --test test/game/state.test.js test/game/play.test.js
```

Expected: PASS, all tests in both files.

- [ ] **Step 5: Commit**

```bash
git add lib/game/state.js test/game/state.test.js test/game/play.test.js
git commit -m "feat: a planned throw carries its own loft, reset on every fresh drag"
```

---

### Task 4: `lib/game/render.js` — the flight path and the shadow balls

**Files:**
- Modify: `lib/game/render.js:14-16` (imports), `lib/game/render.js:39-123`
  (`STYLE_GAME`), `lib/game/render.js` (new functions after
  `passLandingMark`), `lib/game/render.js:621-635` (`renderPassArrow`)
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: `deadZoneSpan` (Task 1), `passOrigin`, `passAim`, `passShadowSpots`
  (Task 2), `state.plannedPass.loft` (Task 3).
- Produces: `passFlightMark(from, to) → string` (new); `passShadowMark(spots) → string`
  (new). `renderPassArrow` draws both, for an unlocked lob only.

- [ ] **Step 1: Write the failing tests**

In `test/game/render.test.js`, add `passAim` to the existing `pass.js` import
(current line 20). Then add, after the `'a lock on a man who is no longer on
the field falls back to the plain arrow'` test (current lines 638-644):

```js
test('a lob previews a flight path, with the dead zone drawn apart from the two catchable ends', () => {
  const s = coachHasBall(createGame({ seed: 1 }));
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const svg = renderPassArrow(s);
  assert.ok(svg.includes('class="pass-flight"'), 'the line from hand to aim point');
  assert.ok(svg.includes('class="pass-flight pass-flight-dead"'), 'the stretch nobody can touch');
});

test('a throw inside the lock zone previews no flight path and no shadow balls', () => {
  const s = coachHasBall(createGame({ seed: 1 }));
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.4);
  const svg = renderPassArrow(s);
  assert.ok(!svg.includes('pass-flight'), 'nothing pending to preview on a throw that resolves this turn');
  assert.ok(!svg.includes('pass-shadow'));
});

test('a locked-on throw previews no flight path and no shadow balls either', () => {
  const s = coachHasBall(createGame({ seed: 1 }));
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 30 };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5, 'o-wr1');
  const svg = renderPassArrow(s);
  assert.ok(!svg.includes('pass-flight'), 'a throw aimed at a man never arcs, so there is nothing to preview');
  assert.ok(!svg.includes('pass-shadow'));
});

test('a lob previews one shadow ball when it lands inside its own turn', () => {
  const s = coachHasBall(createGame({ seed: 1 }));
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1); // full power, no loft: one turn, per Task 1
  const svg = renderPassArrow(s);
  const count = (svg.match(/class="pass-shadow"/g) || []).length;
  assert.equal(count, 1, 'no loft dragged in, so the bomb still lands inside one turn');
});

test('a fully lofted bomb previews two shadow balls, one per turn it hangs', () => {
  const s = coachHasBall(createGame({ seed: 1 }));
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1, null, 1); // full power, full loft
  const svg = renderPassArrow(s);
  const count = (svg.match(/class="pass-shadow"/g) || []).length;
  assert.equal(count, 2, 'full loft on the longest throw matches the old two-turn hang time');
  const qb = getPlayer(s, 'o-qb');
  const aim = passAim(qb, { x: 0, y: 1 }, 1);
  assert.ok(svg.includes(`translate(${num(aim.x)}, ${num(aim.y)})`), 'the last shadow sits on the aim point');
});
```

Then add, after the `'the lob\'s two marks are styled in the game stylesheet'`
test (current lines 678-681):

```js
test('the flight path and the shadow ball are styled in the game stylesheet', () => {
  const { markup } = renderBoardShell(20, 30);
  assert.ok(markup.includes('.pass-flight{'));
  assert.ok(markup.includes('.pass-flight-dead{'));
  assert.ok(markup.includes('.pass-shadow'));
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
node --test test/game/render.test.js
```

Expected: FAIL — `passFlightMark`/`passShadowMark` do not exist yet and
`renderPassArrow` draws none of the new classes.

- [ ] **Step 3: Implement**

Change the top-of-file imports (current lines 14-16) to:

```js
import { sub, len, dist } from './vec.js';
import { ballScale, deadZoneSpan } from './lob.js';
import { passLanding, passOrigin, passAim, passShadowSpots } from './pass.js';
```

In `STYLE_GAME` (the array literal, current lines 39-123), add just after the
`.pass-halo` rule (current line 100):

```js
  // The flight path: the line the throw's own reach draws from hand to aim,
  // so a deep lob is not just an arrow capped well short of it and a distant
  // circle with nothing drawn in between. The dead-zone stretch — nobody can
  // touch this ball there — carries a second class over the first, fading it
  // further and tightening the dash, so the two catchable ends at either side
  // stay readable as the ordinary throw they still are.
  '.pass-flight{fill:none;stroke:#b3261e;stroke-width:.5;stroke-dasharray:1 1;opacity:.6;pointer-events:none}',
  '.pass-flight-dead{stroke-dasharray:.5 1.8;opacity:.4}',
  // The shadow ball: where this throw is aimed to be at some turn's end,
  // while it is still only a plan. Black, so it is never mistaken for the
  // ball itself — the real one is brown — and translucent, since it is a
  // projection and not yet a fact about the board.
  '.pass-shadow .fb{fill:#000;fill-opacity:.4;stroke:none}',
```

After `passLandingMark` (current lines 556-564, ending just before
`liveLobMark`'s docblock), add:

```js
/**
 * The straight line a throw's own reach draws from the passer's hand to
 * where it is aimed — the connection an arrow capped at MAX_PASS_ARROW_UNITS
 * and a landing circle far downfield never draw on their own. The stretch
 * nobody can touch (lob.js's deadZoneSpan) is drawn apart from the two
 * catchable stretches at either end, in its own class layered over the first.
 */
export function passFlightMark(from, to) {
  const total = dist(from, to);
  const { start, end } = deadZoneSpan(total);
  const at = (d) => ({
    x: from.x + ((to.x - from.x) * d) / total,
    y: from.y + ((to.y - from.y) * d) / total,
  });
  const line = (a, b, cls) => `<path d="M ${num(a.x)} ${num(a.y)} L ${num(b.x)} ${num(b.y)}" class="${cls}"/>`;
  if (end <= start) return line(from, to, 'pass-flight');
  const a = at(start);
  const b = at(end);
  return line(from, a, 'pass-flight') + line(a, b, 'pass-flight pass-flight-dead') + line(b, to, 'pass-flight');
}

/**
 * One black ball for each turn boundary a planned lob is still projected to
 * be in the air, ending on the aim point itself — the same football() shape
 * the real ball draws, so the projection reads as a ball and not an icon.
 */
export function passShadowMark(spots) {
  return spots.map((s) => (
    `<g class="pass-shadow" transform="translate(${num(s.x)}, ${num(s.y)})">${football(0, 0, 0)}</g>`
  )).join('');
}
```

Replace `renderPassArrow` (current lines 621-635) with:

```js
export function renderPassArrow(state) {
  const planned = state.plannedPass;
  if (!planned || state.ball.carrierId !== planned.from) return '';
  const from = getPlayer(state, planned.from);
  const locked = planned.target ? state.players.find((p) => p.id === planned.target) : null;
  let mark;
  if (locked) {
    mark = passLockMark(from, locked);
  } else {
    const land = passLanding(from, planned.dir, planned.power);
    mark = land
      ? passLandingMark(land.pos, land.radius)
        + passFlightMark(passOrigin(from, planned.dir), passAim(from, planned.dir, planned.power))
        + passShadowMark(passShadowSpots(from, planned.dir, planned.power, planned.loft ?? 0))
      : '';
    mark += passArrowMark(from.pos, passArrowTip(from.pos, planned.dir, planned.power));
  }
  return `<g class="plan-arrow" data-pass="${planned.from}">${mark}</g>`;
}
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
node --test test/game/render.test.js
```

Expected: PASS, all tests in the file — including the exact-string snap test
(current line 586), which is untouched because a locked throw never reaches
the new `land`-gated branch.

- [ ] **Step 5: Commit**

```bash
git add lib/game/render.js test/game/render.test.js
git commit -m "feat: a planned lob draws its own flight path and shadow balls"
```

---

### Task 5: `app/input.js` — the hit test grows a second kind of target

**Files:**
- Modify: `app/input.js` (whole file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `attachInput(board, { hitTest, onGesture, onDragPreview,
  onLoftDragPreview, onLoftDrag })` — `hitTest` may now return `{ loft:
  passerId }` in addition to a player id string or `null`; the two new
  callbacks fire only for that shape.

There is no test file for `app/input.js` today — it is DOM-driven plumbing,
verified by hand along with the rest of `app/`, same as every other file in
that directory. This task is implementation only; Task 6 covers manual
verification for the whole feature end to end.

- [ ] **Step 1: Implement**

Replace the whole of `app/input.js` with:

```js
/**
 * Pointer plumbing built on the vendored SVG.js wrapper: `board.point()`
 * converts a pointer event's screen coordinates into the board's local SVG
 * coordinates (replacing hand-rolled createSVGPoint/getScreenCTM math), and
 * `board.on()` wraps addEventListener. All decisions about what a gesture
 * MEANS live in lib/game/ — this file only observes and reports.
 *
 * `hitTest` returns one of three things: a player id, `null`, or `{ loft:
 * passerId }` — the one target in the game that is not a player, the
 * committed throw arrow's own tip. That third shape skips classifyGesture
 * entirely: a loft adjustment is not a run, a throw, or a stance toggle, it
 * has no direction or throttle of its own to classify, only how far the
 * pointer has travelled since it grabbed on. It is reported through its own
 * pair of callbacks, onLoftDragPreview/onLoftDrag, rather than being forced
 * through onDragPreview/onGesture's player-shaped contract.
 */
import { classifyGesture } from '../lib/game/gesture.js';

export function attachInput(board, {
  hitTest, onGesture, onDragPreview, onLoftDragPreview, onLoftDrag,
}) {
  let log = null;
  let target = null; // a player id (string), or { loft: passerId }
  // When each player was last tapped. A tap arms the NEXT gesture on that same
  // player: released in place it is a double tap (his special move), dragged
  // away it is a throw. Anything else disarms him, so a tap from ten seconds
  // ago can never turn a run into a throw. classifyGesture owns the timing
  // rule; this map only remembers the tap. The loft handle never touches it —
  // it has no double-tap concept of its own.
  const lastTapAt = new Map();

  board.on('pointerdown', (e) => {
    const p = board.point(e.clientX, e.clientY);
    target = hitTest(p);
    if (!target) return;
    log = [{ t: e.timeStamp, ...p }];
    board.node.setPointerCapture(e.pointerId); // pointer capture has no SVG.js wrapper; use the raw node
    e.preventDefault();
  });

  board.on('pointermove', (e) => {
    if (!log) return;
    const p = board.point(e.clientX, e.clientY);
    log.push({ t: e.timeStamp, ...p });
    if (typeof target === 'object') { onLoftDragPreview(target.loft, log); return; }
    onDragPreview(target, log, lastTapAt.get(target) ?? null);
  });

  board.on('pointerup', (e) => {
    if (!log) return;
    const p = board.point(e.clientX, e.clientY);
    log.push({ t: e.timeStamp, ...p });
    if (typeof target === 'object') {
      onLoftDrag(target.loft, log);
      log = null;
      target = null;
      return;
    }
    const gesture = classifyGesture(log, lastTapAt.get(target) ?? null);
    if (gesture.kind === 'click') lastTapAt.set(target, log[log.length - 1].t);
    else lastTapAt.delete(target);
    onGesture(target, gesture, p);
    log = null;
    target = null;
  });

  board.on('pointercancel', () => {
    if (typeof target === 'string') lastTapAt.delete(target);
    log = null;
    target = null;
    onDragPreview(null, null, null);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/input.js
git commit -m "feat: the hit test names the loft handle, not just a player"
```

---

### Task 6: `app/main.js` — the loft handle, wired to the board

**Files:**
- Modify: `app/main.js` (imports; `hitTest`, current lines 375-387; `paint`,
  current lines 220-243; both `attachInput` call sites, current lines 1473
  and 1486)

**Interfaces:**
- Consumes: `passReach`, `loftFromDrag` (Task 2, from `pass.js`); `isLob`
  (Task 1, from `lob.js`); `state.plannedPass.loft` (Task 3);
  `onLoftDragPreview`/`onLoftDrag` contract (Task 5, from `app/input.js`).
- Produces: nothing consumed elsewhere — this is the top of the call graph.

No automated tests: `app/main.js` is DOM-driven and untested today, same as
the rest of `app/`. Step 3 below is a manual verification checklist covering
this task and Tasks 4-5 together, since none of the three can be exercised
end to end on their own.

- [ ] **Step 1: Implement**

Add `sub` to a new import from `vec.js` (there is no existing import from
that module in this file):

```js
import { sub } from '../lib/game/vec.js';
```

Change the `pass.js` import (current line 22) to:

```js
import {
  receiverAt, lockOnPass, passLanding, backOnPasser, passReach, loftFromDrag,
} from '../lib/game/pass.js';
```

Change the `lob.js` import (current line 23) to:

```js
import { lobLanded, isLob } from '../lib/game/lob.js';
```

Replace `hitTest` (current lines 375-387) with:

```js
/**
 * Where the loft handle is: the same short, cosmetically-capped tip the
 * arrow itself draws to (passArrowTip in render.js) — not the real landing
 * spot, which the flight path and landing circle already mark (spec decision
 * 2). Checked only when no player answers hitTest first, and only for a
 * throw that is still live, unlocked, still the passer's own, and long
 * enough to lob at all — the same four gates renderPassArrow's own new marks
 * check before drawing anything.
 */
function loftHandleHit(p) {
  const pp = state.plannedPass;
  if (repositioning || state.phase !== 'planning') return null;
  if (!pp || pp.target || state.ball.carrierId !== pp.from) return null;
  if (!isControllable(state, pp.from)) return null;
  if (!isLob(passReach(pp.power))) return null;
  const passer = getPlayer(state, pp.from);
  const tip = passArrowTip(passer.pos, pp.dir, pp.power);
  return Math.hypot(tip.x - p.x, tip.y - p.y) <= PICK_SLOP_UNITS ? { loft: pp.from } : null;
}

function hitTest(p) {
  let best = null;
  let bestD = Infinity;
  for (const pl of state.players) {
    // The computer's players take no orders. Gating here covers all three ways
    // in — drag, drag preview, and double tap — because every one of them
    // starts from a hit test that returns a player id.
    if (!isControllable(state, pl.id)) continue;
    const d = Math.hypot(pl.pos.x - p.x, pl.pos.y - p.y);
    if (d <= pl.radius + PICK_SLOP_UNITS && d < bestD) { best = pl.id; bestD = d; }
  }
  return best || loftHandleHit(p);
}
```

Replace `paint` (current lines 220-243) so the arrows layer is its own
function, callable on its own from a live loft drag without repainting
players and the HUD on every pointer move:

```js
function paintArrows() {
  // The band goes in `game-arrows`, beneath the players, so a man standing in
  // it still reads as a man rather than as a man behind glass. While
  // repositioning there are no arrows to draw anyway — that is the mode.
  layer('game-arrows').clear().svg(
    // The landing circle outlives the plan that drew it — state.plannedPass is
    // gone by the end of the very turn a lob is thrown, but the throw itself
    // can still be hanging turns later, and the coach still needs to see
    // where it might come down. Drawn in every mode below, since a lob in the
    // air is a fact about the board, not an order still being given.
    liveLobMark(state) + (
      // Repositioning draws no ORDERS — that is the mode, and moving a man drops
      // his anyway. The snap is not one of his orders though, and it is aimed
      // between the two men most likely to be moved, so it stays on the board:
      // it is the one arrow that answers "what did that just do?".
      repositioning ? lineZoneMark(state) + (state.plannedPass?.auto ? renderPassArrow(state) : '')
      : state.phase === 'planning' ? renderPlans(state) + renderPassArrow(state)
      : ''
    ),
  );
}

function paint() {
  layer('game-players').clear().svg(renderPlayers(state, { showVelocity }) + renderLooseBall(state));
  paintArrows();
  hud.textContent = `${downDistanceText(state)} — ${state.phase}`;
  paintControls();
  debugBtn.textContent = `Velocity: ${showVelocity ? 'on' : 'off'}`;
  debugBtn.disabled = animating;
  copyLogBtn.textContent = `Copy coaching log (${coachLog.length})`;
  copyLogBtn.disabled = animating || coachLog.length === 0;
  clearLogBtn.disabled = animating || (coachLog.length === 0 && tendencies.plays === 0);
  trainBtn.disabled = animating || trainer !== null || coachLog.length === 0;
  copyGenomeBtn.textContent = trainedSide
```

(The lines from `debugBtn.textContent` onward, and everything through the end
of the original `paint` function, are unchanged — only the block that used to
build the `game-arrows` layer inline has moved into `paintArrows`, and `paint`
now calls it.)

Add, just before `onDragPreview` (current line 569):

```js
/**
 * Grabbing the committed arrow's tip again, pre-snap: not a new throw, only
 * how long this one takes to arrive. dir/power/target — the destination —
 * never change here; only state.plannedPass.loft does, so the shadow balls
 * and the dead zone move but the landing circle never does. There is nothing
 * to roll back on release the way a cancelled run or throw drag has, so the
 * live preview and the committed value are the same write.
 */
function onLoftDragPreview(passerId, log) {
  if (animating || state.phase !== 'planning') return;
  const pp = state.plannedPass;
  if (!pp || pp.from !== passerId) return;
  pp.loft = loftFromDrag(pp, sub(log[log.length - 1], log[0]));
  paintArrows();
}

function onLoftDrag(passerId, log) {
  onLoftDragPreview(passerId, log);
  lessonSaw();
}
```

Change both `attachInput` call sites (current lines 1473 and 1486) from:

```js
    attachInput(board, { hitTest, onGesture, onDragPreview });
```

to:

```js
    attachInput(board, { hitTest, onGesture, onDragPreview, onLoftDragPreview, onLoftDrag });
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: PASS across the whole suite — this task touches no file any
existing test imports, but a full run is the cheapest way to catch anything
Tasks 1-4 missed before moving to manual verification.

- [ ] **Step 3: Verify by hand, in the browser**

Start the app (`npm run serve` or the project's usual dev entry point) and
start a game. With the quarterback holding the ball:

1. Double-tap-and-drag him a full-power throw straight downfield (past 15
   yards). Confirm the arrow, the landing circle, a dashed flight-path line
   between them (with a visibly fainter dashed stretch in the middle), and
   exactly one black shadow ball sitting on the landing circle's centre.
2. Grab the arrow's short tip again (not the player) and drag it further
   away from the passer. Confirm the shadow ball's position updates live; as
   the drag approaches the far end of its range, confirm a second shadow ball
   appears partway down the flight path.
3. Drag the same tip back toward the passer. Confirm the second shadow ball
   disappears again, the remaining one moves back toward the landing circle,
   and dragging further does not reverse the throw's own direction or move
   the landing circle itself.
4. Confirm the landing circle and the arrow's own head never move during
   steps 2-3 — only the shadow ball(s) and the dead-zone stretch's extent.
5. Draw a short throw (under 15 yards). Confirm no flight path, no shadow
   ball, and no landing circle; confirm dragging near the short arrow's tip
   does not trigger a loft adjustment (it should either do nothing or, if it
   happens to land on a player, start an ordinary run/cover drag on him).
6. Drag the throw directly onto a teammate to lock onto him. Confirm none of
   the three new marks appear, and that the lock-on halo and arrow still
   look exactly as they did before this change.
7. Run the turn. Confirm the actual thrown ball's hang time matches whatever
   the shadow balls last showed (count the turns it takes to resolve).
8. Move a teammate to stand directly on top of the committed arrow's tip
   (drag him there in reposition mode, then draw the deep throw again once
   back in planning). Grab that same spot: confirm it starts a run/cover drag
   on the player, not a loft adjustment — `hitTest`'s player loop must win
   before `loftHandleHit` is ever consulted.
9. Resize to `mobile` width and repeat steps 1-3. Confirm the loft handle is
   still reachable and does not conflict with a nearby player's own hit
   target.
10. Read the browser console throughout for errors.

- [ ] **Step 4: Commit**

```bash
git add app/main.js
git commit -m "feat: grab a committed lob's arrow again to give it loft"
```

---

## Notes for the implementer

- **Task order matters and is not arbitrary.** Each task's tests import
  functions the previous task exports; running them out of order will fail
  on missing imports, not just on assertions.
- **Do not touch `lib/game/gesture.js`.** The loft drag deliberately never
  reaches `classifyGesture` — see the doc comment added to `app/input.js` in
  Task 5. If a loft adjustment seems to need something from there, that is a
  sign the design has drifted from the spec, not a missing import.
- **Do not touch `lib/game/play.js`.** A saved/loaded play already drops a
  throw's `target` (only `from`/`dir`/`power` survive — see
  `capturePlay`/`applyPlay`), and this plan does not change that: a replayed
  play's throw comes back at `loft = 0`, the same default any throw gets,
  consistent with how a lock-on is already dropped on save. Extending play
  capture to remember loft is a separate feature, not this one.
- **The four `plannedPass` shape assertions fixed in Task 3 are exhaustive** —
  confirmed by grepping every `assert.deepEqual(...plannedPass...)` in
  `test/`; every other exact-shape assertion in the suite is for the
  automatic snap (`aimSnap`), which this plan does not touch and does not
  carry a `loft` field.
- **The default balance change is intentional and already approved**: every
  lob thrown with no loft dragged in — human or computer-controlled — now
  hangs for half as long as it did before this plan (Task 1). This is not a
  bug to work around in a later task.
