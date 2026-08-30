# Lob Passing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the throw a second gear — a drag onto a receiver within 15 yards locks the pass onto him, and a drag past that range becomes a *lob*: the ball leaves on a scripted arc to a randomised spot inside a red landing circle, hangs long enough to cross the turn boundary, swells as it rises over everyone's heads, and can only be taken in the first 15 yards of its flight or the last 3.

**Architecture:** One new pure module, `lib/game/lob.js`, owns the arc end to end — the landing scatter, the hang time, where the ball is at any instant, which stretch of the flight is out of reach, and how big to draw it. A thrown ball gains one optional field, `ball.lob`, which is the flight plan; `physics.js` walks that plan instead of integrating velocity, and `rules.js` reads it to decide who may touch the ball and when an uncaught throw is finally dead. Throw arithmetic that both the renderer and the rulebook need — release speed, total reach, the power that lands the ball on a man this turn — moves into `pass.js` as pure functions, so the red circle on the board is drawn from the same numbers the ball flies by.

**Tech Stack:** Plain ES modules, no build step. `node --test` for tests. SVG emitted as strings from `lib/game/render.js`; `app/main.js` writes those strings into layer groups via the vendored SVG.js wrapper.

**Spec:** the "Source spec" section immediately below, which is the feature request verbatim, plus the four forks resolved with the user before this plan was written.

---

## Source spec

> I'd like the current pass to be able to lock on to a receiver up until 15
> yards(make this configurable). After that, don't allow lock on, and leave the
> arrow, but move a red circle towards where the ball will land. This enables
> lob shot throwing. So it won't be able to be intercepted for those first 15
> yards, but where it lands is not easily determined. The last 3
> yards(configurable) it can be caught as normal. but in between the 15 and 4
> yards space, it can't be caught. The red landing circle should be the size of
> the that configurable last 4 yards, and should get bigger the longer you
> throw. The ball will land randomly within that circle, but the trajectory.
> This throw should take longer to reach it's destination because the ball is
> travelling up. The ball should get bigger when it's in the don't catch zone,
> to signify it's closer to the sky/camera.

Four forks were resolved with the user before this plan was written:

1. **The zones are measured in FLIGHT DISTANCE from the passer's hand**, not in
   throw class. Out to `LOB_LOCK_YARDS` (15) of flight the ball is live and
   anybody may take it, exactly as today. From there to the last
   `LOB_CATCH_YARDS` (3) of the flight nobody may touch it — it is over their
   heads. The final 3 yards it is catchable again as normal. A throw that never
   reaches 15 yards never leaves zone one, so **handoffs and short passes are
   completely unchanged**.
2. **A lob may hang past the whistle.** A deep ball that is still in the air
   when the turn ends stays live into the next planning phase, so the coach gets
   a turn to run somebody under it. It is ruled when it lands, not when the
   whistle blows.
3. **The catch window is 3 yards**, not 4 — the spec said both. `LOB_CATCH_YARDS
   = 3`, and the landing circle's radius at the shortest lob is that same 3
   yards.
4. **Lock-on changes the gesture too.** A throw drag that ends on one of your own
   players within 15 yards aims the pass at *him* — direction and power both
   come from where he is standing, not from the drag — the way a run drag onto
   an opponent already becomes a cover order. Past 15 yards nothing snaps, and
   the red landing circle appears instead.

### The numbers this lands on

Everything below falls out of constants that already exist. A yard is
`UNITS_PER_YARD_X` = 3.75 SVG units in both axes (`view.js` pins `scaleY` to it).

| Quantity | Value | Where from |
| --- | --- | --- |
| Lock zone | 56.25 units | `LOB_LOCK_YARDS` (15) × 3.75 |
| Catch window | 11.25 units | `LOB_CATCH_YARDS` (3) × 3.75 |
| Longest throw in the game | 111.11 units = 29.6 yd | `PASS_SPEED_MAX / 3.6` |
| Shortest throw (a handoff) | 16.7 units = 4.4 yd | `PASS_SPEED_MIN / 3.6` |
| Drag power at which a throw becomes a lob | 0.419 | reach = 56.25 units |
| A throw's travel inside its own turn | 84.4% of its reach | `1 - BALL_FRICTION ** 30` |
| Hang time at the lock boundary | 30 sub-steps = 1 turn | `LOB_TIME_MULT` × reach / max reach |
| Hang time on the deepest bomb | 60 sub-steps = 2 turns | same |
| Landing circle at the shortest lob | 3 yd radius | `LOB_CATCH_YARDS` |
| Landing circle on the deepest bomb | 5.9 yd radius | 3 + 0.2 × 14.6 |

A consequence worth expecting: the **dead zone is empty** on any lob under 18
yards (15 + 3). Such a throw still arcs, still scatters, and still takes longer —
but it is never out of anybody's reach, and the ball is never drawn any bigger.
That is correct, and it is what makes the 15-to-18-yard band a soft edge rather
than a cliff.

### The lock zone against this field's depth — read this before playtesting

The board is short. The drive starts on the 10, so there are **10 yards from the
line of scrimmage to the goal line**, and the quarterback lines up 4 behind it.
A 15-yard lock zone is therefore wider than the field the offense is throwing
into, and two things follow that the coach will notice within a down or two:

- **Almost any in-bounds receiver can be locked onto.** The exception is a
  drive-start wide receiver, who stands 15.3 yards from the QB — a hair outside
  the zone, so at the snap the outside throws are lobs and everything inside is
  a lock-on. That edge is an accident of the formation, not a design.
- **A lob can only come down in or behind the end zone.** 15 yards downfield
  from a QB four yards deep is past the goal line at yard 10, and a full-power
  throw reaches 29.6 yards — twice the depth of the field in front of him. So
  "catch a lob" and "score" are the same event on this board.

**Build it at 15 as asked** — that is the spec, the number is one constant, and
the throw arithmetic underneath it does not care what the number is. Then play
a few downs. If lobs never land in play, the tuning knob is
`LOB_LOCK_YARDS ≈ 8` with `LOB_CATCH_YARDS ≈ 2`, which puts all three zones of
the flight inside the ten yards that actually exist. That is a one-line change
with nothing moved, which is the whole reason these are configurable.

---

## Global Constraints

- **No build step, no dependencies.** Plain ES modules loaded directly by
  `index.html`. Nothing in `lib/` may import from `app/`.
- **`lib/` is pure and DOM-free.** `node --test` runs it with no DOM; the
  renderer returns strings.
- **All randomness comes in through a `random` argument.** Nothing in `lib/` may
  call `Math.random`. A seeded game must replay identically, so the landing
  scatter is drawn from the turn's `random` and **only when a throw actually
  lobs** — a short throw must not perturb the stream.
- **Constants live in `lib/game/constants.js`**, one exported name each, with the
  comment that says why the number is what it is. Distances measured in yards
  are named `*_YARDS` and converted at the point of use with
  `UNITS_PER_YARD_X`, as `ON_LINE_YARDS` and the `ALIGN_*_YARDS` family already do.
- **The renderer is a pure function of state.** Nothing is simulated at paint
  time; the preview and the committed mark come from the same function in
  `render.js` so a drag never changes shape at the moment the finger comes up.
- Run the whole suite (`npm test`) at every "run the tests" step, not just the
  new file: several tasks change behaviour older tests assert on, and the plan
  says exactly which ones and how.

---

## File Structure

**New:**

- `lib/game/lob.js` — the arc, end to end. Pure functions over a flight plan
  (`{from, to, substeps, elapsed}`): the scatter, the hang time, the position at
  any instant, the out-of-reach stretch, the drawn ball size. Knows nothing
  about `state`, and imports nothing from `pass.js`, so there is no cycle.
- `test/game/lob.test.js` — its tests.

**Modified:**

- `lib/game/constants.js` — five lob constants and `PASS_REACH_MAX`.
- `lib/game/pass.js` — throw arithmetic as pure functions (`passSpeed`,
  `passReach`, `passTravel`, `powerForTravel`, `passOrigin`, `passAim`,
  `passLanding`), the lock-on pair (`receiverAt`, `lockOnPass`), and
  `releasePass` building a lob when the throw is long enough.
- `lib/game/state.js` — `setPass` gains a fourth argument, the locked-on
  receiver's id.
- `lib/game/physics.js` — flies a lob instead of rolling it.
- `lib/game/rules.js` — the catch gate, the landing ruling, the sideline gate.
- `lib/game/turn.js` — hands `random` to `releasePass`; frames carry the ball's
  drawn size.
- `lib/game/render.js` — the landing circle, the lock-on halo, a scalable ball.
- `app/main.js` — the gesture, the live preview, the animation's ball size, and
  the word for a ball still in the air.
- `README.md` — the throw bullet under "How to play".

---

## Task 1: Throw arithmetic as shared functions

Pure refactor plus new exports. **No behaviour changes in this task** — every
existing test must still pass untouched.

**Files:**
- Modify: `lib/game/constants.js` (add `PASS_REACH_MAX` under the passing section)
- Modify: `lib/game/pass.js`
- Test: `test/game/pass.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `PASS_REACH_MAX: number` (constants.js) — the longest throw, in units.
  - `passSpeed(power: number) -> number` — release speed in units/s.
  - `passReach(power: number) -> number` — total travel in units.
  - `passTravel(power: number, substeps: number) -> number` — travel after that
    many sub-steps, in units.
  - `powerForTravel(units: number, substeps = SUBSTEPS_PER_TURN) -> number` in
    `[0,1]`.
  - `passOrigin(player, dir) -> {x, y}` — where the ball leaves his hand.
  - `passAim(player, dir, power) -> {x, y}` — the spot the throw is aimed at.

- [x] **Step 1: Write the failing tests**

Add to the top of `test/game/pass.test.js`'s imports:

```js
import {
  isForward, passFoul, releasePass,
  passSpeed, passReach, passTravel, powerForTravel, passOrigin, passAim,
} from '../../lib/game/pass.js';
import {
  PASS_SPEED_MIN, PASS_SPEED_MAX, PASS_SPAWN_EPSILON, PASS_GRACE_SUBSTEPS,
  PICKUP_RADIUS_BONUS, PASS_REACH_MAX, DT, BALL_FRICTION, SUBSTEPS_PER_TURN,
} from '../../lib/game/constants.js';
```

and append these tests to the end of the file:

```js
test('a throw\'s speed and its total reach are one arithmetic, shared with the ball', () => {
  assert.ok(Math.abs(passSpeed(0) - PASS_SPEED_MIN) < 1e-9);
  assert.ok(Math.abs(passSpeed(1) - PASS_SPEED_MAX) < 1e-9);
  // The closed form of physics.js's per-sub-step decay, summed out.
  assert.ok(Math.abs(passReach(1) - (PASS_SPEED_MAX * DT) / (1 - BALL_FRICTION)) < 1e-9);
  assert.ok(Math.abs(passReach(1) - PASS_REACH_MAX) < 1e-9, 'the constant is that same number');
  assert.ok(passReach(1) > 111 && passReach(1) < 111.2, 'the longest throw: 111 units, 29.6 yards');
  assert.ok(passReach(0) > 16.6 && passReach(0) < 16.8, 'the shortest: 4.4 yards, a handoff');
});

test('a throw only gets part of the way inside its own turn', () => {
  const whole = passReach(1);
  const turn = passTravel(1, SUBSTEPS_PER_TURN);
  assert.ok(turn < whole, 'the decay never quite arrives');
  assert.ok(Math.abs(turn / whole - 0.8437) < 1e-3, 'about 84% of it in half a second');
  assert.equal(passTravel(1, 0), 0, 'nothing has been thrown yet');
});

test('powerForTravel is the inverse: the power that gets the ball there this turn', () => {
  const units = passTravel(0.4, SUBSTEPS_PER_TURN);
  assert.ok(Math.abs(powerForTravel(units) - 0.4) < 1e-6);
  assert.equal(powerForTravel(0), 0, 'nothing to cover is the softest throw there is');
  assert.equal(powerForTravel(10000), 1, 'and no drag throws it further than full power');
});

test('a throw starts at the passer\'s leading edge and is aimed a reach beyond it', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const origin = passOrigin(qb, { x: 0, y: 2 }); // non-unit on purpose
  const edge = qb.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON;
  assert.ok(Math.abs(origin.y - (qb.pos.y + edge)) < 1e-9, 'his leading edge, not his centre');
  assert.ok(Math.abs(origin.x - qb.pos.x) < 1e-9);
  const aim = passAim(qb, { x: 0, y: 2 }, 1);
  assert.ok(Math.abs(aim.y - (origin.y + passReach(1))) < 1e-9, 'a full reach past the hand');
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `SyntaxError: The requested module '../../lib/game/pass.js' does not provide an export named 'passSpeed'`.

- [x] **Step 3: Add the constant**

In `lib/game/constants.js`, immediately after the `PASS_SPEED_MIN` block in the
`--- passing ---` section:

```js
// The longest throw in the game, in units: the closed form of the loose-ball
// decay at full power. It lives here rather than in pass.js because two modules
// need it — pass.js to size a throw, lob.js to measure a lob's hang time
// against the deepest one there is — and neither should have to import the
// other to get at it.
export const PASS_REACH_MAX = (PASS_SPEED_MAX * DT) / (1 - BALL_FRICTION);
```

- [x] **Step 4: Write the functions and use them in releasePass**

In `lib/game/pass.js`, widen the constants import (the `vec.js` import already
brings in everything these need):

```js
import {
  PASS_SPEED_MIN, PASS_SPEED_MAX, PASS_SPAWN_EPSILON, PASS_GRACE_SUBSTEPS,
  PICKUP_RADIUS_BONUS, BALL_FRICTION, DT, SUBSTEPS_PER_TURN,
} from './constants.js';
```

and add these above `releasePass`:

```js
/** How fast the ball leaves the hand at this drag power. */
export function passSpeed(power) {
  return PASS_SPEED_MIN + (PASS_SPEED_MAX - PASS_SPEED_MIN) * power;
}

/**
 * How far that throw travels in the end, in units.
 *
 * physics.js multiplies a loose ball's velocity by BALL_FRICTION every
 * sub-step, so the distance is a geometric series and this is its sum:
 * speed * DT / (1 - BALL_FRICTION). It is the ball's OWN arithmetic rather
 * than a second model of it, which is what lets the board draw a landing
 * circle the throw actually reaches.
 */
export function passReach(power) {
  return (passSpeed(power) * DT) / (1 - BALL_FRICTION);
}

/** The same series stopped early: how far it has gone after `substeps`. */
export function passTravel(power, substeps) {
  return passReach(power) * (1 - Math.pow(BALL_FRICTION, substeps));
}

/**
 * The inverse: the power that carries the ball `units` down the field inside
 * `substeps`. A lock-on throw is sized with this — the coach picks the man and
 * the passer picks the pace, so the ball has to ARRIVE, not merely head that
 * way. Saturates at both ends rather than failing, exactly as
 * predict.js's throttleForDistance does.
 */
export function powerForTravel(units, substeps = SUBSTEPS_PER_TURN) {
  const reach = units / (1 - Math.pow(BALL_FRICTION, substeps));
  const speed = (reach * (1 - BALL_FRICTION)) / DT;
  return Math.max(0, Math.min(1, (speed - PASS_SPEED_MIN) / (PASS_SPEED_MAX - PASS_SPEED_MIN)));
}

/**
 * Where the ball leaves the passer's hand: his leading edge, strictly outside
 * his own scoop range so he cannot re-take his own throw where he stands. The
 * direction is normalized here, so a non-unit `dir` cannot secretly move the
 * spawn point.
 */
export function passOrigin(player, dir) {
  const d = norm(dir);
  return add(player.pos, scale(d, player.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON));
}

/** The spot this throw is aimed at: a whole reach on from where it left the hand. */
export function passAim(player, dir, power) {
  const d = norm(dir);
  return add(passOrigin(player, d), scale(d, passReach(power)));
}
```

Then rewrite the two lines inside `releasePass` that compute the speed and the
offset so they go through the new functions — same numbers, one source:

```js
  const speed = passSpeed(planned.power);
  const pos = passOrigin(car, dir);
  state.ball = {
    carrierId: null,
    pos,
    vel: scale(dir, speed),
    loose: PASS_GRACE_SUBSTEPS,
    forward,
  };
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 320 existing + 4 new.

- [x] **Step 6: Commit**

```bash
git add lib/game/constants.js lib/game/pass.js test/game/pass.test.js && git commit -m "Pull the throw's distance arithmetic out of releasePass"
```

---

## Task 2: The arc — `lib/game/lob.js`

A pure module with no knowledge of `state`, so it is testable on hand-built
flight plans and cannot drag the rest of the game into a cycle.

**Files:**
- Modify: `lib/game/constants.js` (the five lob constants)
- Create: `lib/game/lob.js`
- Test: `test/game/lob.test.js`

**Interfaces:**
- Consumes: `PASS_REACH_MAX` (Task 1), `UNITS_PER_YARD_X`, `SUBSTEPS_PER_TURN`.
- Produces — a **flight plan** is `{from: {x,y}, to: {x,y}, substeps: number,
  elapsed: number}`, and:
  - `LOCK_UNITS: number`, `CATCH_UNITS: number`
  - `isLob(distanceUnits: number) -> boolean`
  - `scatterRadius(distanceUnits: number) -> number`
  - `scatterPoint(aim: {x,y}, radius: number, random: () => number) -> {x,y}`
  - `lobSubsteps(distanceUnits: number) -> number`
  - `planLob(from: {x,y}, aim: {x,y}, random) -> flight plan`
  - `lobProgress(lob) -> number` in `[0,1]`
  - `lobPoint(lob) -> {x,y}`
  - `lobLanded(lob) -> boolean`
  - `lobCatchable(lob) -> boolean`
  - `lobBallScale(lob) -> number`
  - `stepLob(lob) -> {x,y}`
  - `ballScale(ball) -> number` — 1 for any ball that is not lobbing.

- [x] **Step 1: Write the failing tests**

Create `test/game/lob.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCK_UNITS, CATCH_UNITS, isLob, scatterRadius, scatterPoint, lobSubsteps,
  planLob, lobProgress, lobPoint, lobLanded, lobCatchable, lobBallScale,
  stepLob, ballScale,
} from '../../lib/game/lob.js';
import {
  LOB_LOCK_YARDS, LOB_CATCH_YARDS, LOB_SCATTER_PER_YARD, LOB_TIME_MULT,
  LOB_BALL_SCALE, PASS_REACH_MAX, SUBSTEPS_PER_TURN,
} from '../../lib/game/constants.js';
import { UNITS_PER_YARD_X } from '../../lib/field/geometry.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { dist } from '../../lib/game/vec.js';

/** A full-power bomb straight downfield, for the zone tests to walk. */
const bomb = () => ({
  from: { x: 100, y: 0 },
  to: { x: 100, y: PASS_REACH_MAX },
  substeps: 60,
  elapsed: 0,
});

test('the zones are the spec\'s yardages, in the board\'s own units', () => {
  assert.ok(Math.abs(LOCK_UNITS - LOB_LOCK_YARDS * UNITS_PER_YARD_X) < 1e-9);
  assert.ok(Math.abs(CATCH_UNITS - LOB_CATCH_YARDS * UNITS_PER_YARD_X) < 1e-9);
});

test('a throw is a lob only once it reaches past the lock zone', () => {
  assert.equal(isLob(LOCK_UNITS - 0.001), false);
  assert.equal(isLob(LOCK_UNITS), false, 'the boundary itself is still an ordinary throw');
  assert.equal(isLob(LOCK_UNITS + 0.001), true);
});

test('the landing circle starts at a catch window and widens with the throw', () => {
  assert.ok(Math.abs(scatterRadius(LOCK_UNITS) - LOB_CATCH_YARDS * UNITS_PER_YARD_X) < 1e-9);
  const deep = scatterRadius(PASS_REACH_MAX);
  const overYards = (PASS_REACH_MAX - LOCK_UNITS) / UNITS_PER_YARD_X;
  const want = (LOB_CATCH_YARDS + LOB_SCATTER_PER_YARD * overYards) * UNITS_PER_YARD_X;
  assert.ok(Math.abs(deep - want) < 1e-9);
  assert.ok(deep > scatterRadius(LOCK_UNITS), 'the longer the throw, the bigger the guess');
});

test('the ball lands somewhere inside that circle, and nowhere else', () => {
  const aim = { x: 100, y: 50 };
  const random = mulberry32(9);
  for (let i = 0; i < 200; i++) {
    const p = scatterPoint(aim, 10, random);
    assert.ok(dist(p, aim) <= 10 + 1e-9, 'inside the circle');
  }
  // Uniform over the DISC, not over the radius: the sqrt is what stops every
  // throw clustering on the aim point.
  const middle = scatterPoint(aim, 10, () => 0.25);
  assert.ok(Math.abs(dist(middle, aim) - 5) < 1e-9, 'a quarter of the area is half the radius');
});

test('hang time is measured against the deepest throw in the game', () => {
  assert.equal(lobSubsteps(PASS_REACH_MAX), LOB_TIME_MULT * SUBSTEPS_PER_TURN);
  assert.equal(lobSubsteps(PASS_REACH_MAX), 60, 'the bomb hangs for two whole turns');
  assert.equal(lobSubsteps(LOCK_UNITS), 30, 'and the shortest lob for exactly one');
  assert.equal(lobSubsteps(0), 1, 'never zero: a flight has to take some time');
});

test('a planned lob starts at the hand, lands inside the circle, and knows how long it hangs', () => {
  const from = { x: 100, y: 0 };
  const aim = { x: 100, y: PASS_REACH_MAX };
  const lob = planLob(from, aim, mulberry32(3));
  assert.deepEqual(lob.from, from);
  assert.equal(lob.elapsed, 0);
  assert.ok(dist(lob.to, aim) <= scatterRadius(PASS_REACH_MAX) + 1e-9);
  assert.equal(lob.substeps, lobSubsteps(dist(lob.from, lob.to)));
  const same = planLob(from, aim, mulberry32(3));
  assert.deepEqual(same.to, lob.to, 'the same seed throws the same ball');
  const other = planLob(from, aim, mulberry32(4));
  assert.notDeepEqual(other.to, lob.to, 'a different one does not');
});

test('the ball walks its line at a constant pace and stops on the spot', () => {
  const lob = bomb();
  assert.deepEqual(lobPoint(lob), lob.from);
  assert.equal(lobProgress(lob), 0);
  assert.equal(lobLanded(lob), false);
  lob.elapsed = 30;
  assert.ok(Math.abs(lobPoint(lob).y - PASS_REACH_MAX / 2) < 1e-9, 'halfway at half the clock');
  lob.elapsed = 60;
  assert.deepEqual(lobPoint(lob), lob.to);
  assert.equal(lobLanded(lob), true);
  stepLob(lob);
  assert.deepEqual(lobPoint(lob), lob.to, 'a landed ball goes no further');
  assert.equal(lob.elapsed, 60);
});

test('stepLob advances the flight one sub-step', () => {
  const lob = bomb();
  const p = stepLob(lob);
  assert.equal(lob.elapsed, 1);
  assert.ok(Math.abs(p.y - PASS_REACH_MAX / 60) < 1e-9);
});

test('a lob is live for its first fifteen yards, dead over the middle, live again as it comes down', () => {
  const lob = bomb();
  const total = PASS_REACH_MAX;
  const at = (units) => { lob.elapsed = (units / total) * lob.substeps; return lobCatchable(lob); };
  assert.equal(at(0), true, 'out of the hand');
  assert.equal(at(LOCK_UNITS - 1), true, 'still inside the lock zone');
  assert.equal(at(LOCK_UNITS + 1), false, 'up over everyone');
  assert.equal(at(total - CATCH_UNITS - 1), false, 'still up there');
  assert.equal(at(total - CATCH_UNITS + 1), true, 'come down into the catch window');
  assert.equal(at(total), true, 'and on the ground');
});

test('a lob too short to have a dead zone is catchable the whole way', () => {
  // 17 yards: the lock zone (15) and the catch window (3) overlap, so the ball
  // never gets out of reach — and never gets drawn any bigger either.
  const total = 17 * UNITS_PER_YARD_X;
  const lob = { from: { x: 0, y: 0 }, to: { x: 0, y: total }, substeps: 30, elapsed: 0 };
  for (let i = 0; i <= 30; i++) {
    lob.elapsed = i;
    assert.equal(lobCatchable(lob), true, `sub-step ${i}`);
    assert.equal(lobBallScale(lob), 1, `sub-step ${i}`);
  }
});

test('the ball swells to its biggest at the top of the arc and comes back to size', () => {
  const lob = bomb();
  const total = PASS_REACH_MAX;
  lob.elapsed = 0;
  assert.equal(lobBallScale(lob), 1, 'normal size in the hand');
  lob.elapsed = lob.substeps;
  assert.equal(lobBallScale(lob), 1, 'and normal size on the ground');
  const mid = (LOCK_UNITS + (total - CATCH_UNITS)) / 2;
  lob.elapsed = (mid / total) * lob.substeps;
  assert.ok(Math.abs(lobBallScale(lob) - LOB_BALL_SCALE) < 1e-9, 'biggest at the apex');
  lob.elapsed = ((LOCK_UNITS + mid) / 2 / total) * lob.substeps;
  const rising = lobBallScale(lob);
  assert.ok(rising > 1 && rising < LOB_BALL_SCALE, 'and on the way up, in between');
});

test('a ball that is not lobbing is drawn at its ordinary size', () => {
  assert.equal(ballScale({ carrierId: null, pos: { x: 0, y: 0 }, lob: null }), 1);
  assert.equal(ballScale({ carrierId: 'o-qb', pos: null }), 1, 'and so is a carried one');
  const lob = bomb();
  lob.elapsed = 30;
  assert.ok(ballScale({ carrierId: null, pos: lobPoint(lob), lob }) > 1);
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/lob.test.js`
Expected: FAIL — `Cannot find module .../lib/game/lob.js`.

- [x] **Step 3: Add the constants**

Append to `lib/game/constants.js`, after the `--- passing ---` section:

```js
// --- lobs: the throw that goes UP ---
// How far a throw stays inside everybody's reach after it leaves the hand. Out
// to this many yards of FLIGHT the ball is an ordinary throw and anyone may
// take it; past it, on a throw long enough to arc, it is over their heads.
// It is also the lock-on range: a throw drag onto a man further away than this
// cannot be aimed at him, because the ball would be above him when it arrived.
export const LOB_LOCK_YARDS = 15;
// The window at the end of a lob's flight where the ball has come back down and
// can be caught — or picked off — as normal. It is also the RADIUS of the
// landing circle at the shortest lob: the ball comes down somewhere inside a
// catch window's worth of where it was aimed, which is the whole bargain of
// throwing one.
export const LOB_CATCH_YARDS = 3;
// How much wider that circle gets per yard of throw past LOB_LOCK_YARDS. At the
// longest throw in the game (29.6 yards) it puts the circle at
// 3 + 0.2 * 14.6 = 5.9 yards — twice the catch window, so a bomb is genuinely a
// guess, while a 16-yard lob is barely one.
export const LOB_SCATTER_PER_YARD = 0.2;
// How much longer a lob hangs than an ordinary throw of the same length. The
// yardstick is the whole board: a full-power throw covers its 29.6 yards in
// about one turn, so a lob that long takes two, and a lob at the lock boundary
// takes exactly one. That is the price of the arc — and the reason the
// receivers get a planning phase to run under a deep ball.
export const LOB_TIME_MULT = 2;
// How much bigger the ball is drawn at the top of its arc. There is no z axis
// on this board, so size is the only way to say "this one is over your head",
// and it is the same cue that says why nobody can catch it there.
export const LOB_BALL_SCALE = 2;
```

- [x] **Step 4: Write the module**

Create `lib/game/lob.js`:

```js
/**
 * The lob: the throw that goes up.
 *
 * An ordinary throw is a loose ball with a big initial speed — physics.js rolls
 * it and friction decides where it stops. A lob cannot work that way. Its whole
 * point is that the ball spends the middle of its flight ABOVE the players, and
 * a board with no z axis has to say that some other way: with a flight plan
 * fixed at release (where it comes down, and how long it hangs), a stretch of
 * that flight where nobody may touch it, and a ball drawn bigger while it is up
 * there.
 *
 * So a lob is FLOWN, not rolled. Everything here is pure arithmetic over one
 * plain object:
 *
 *   {from: {x,y}, to: {x,y}, substeps: number, elapsed: number}
 *
 * `from` is the passer's hand, `to` is the spot it will come down on (already
 * scattered — see planLob), `substeps` is the hang time and `elapsed` is the
 * clock. Nothing here reads `state`, and nothing here imports pass.js: the
 * throw's own arithmetic lives there, and one direction of dependency is all
 * this feature needs.
 */
import { UNITS_PER_YARD_X } from '../field/geometry.js';
import { dist } from './vec.js';
import {
  LOB_LOCK_YARDS, LOB_CATCH_YARDS, LOB_SCATTER_PER_YARD, LOB_TIME_MULT,
  LOB_BALL_SCALE, PASS_REACH_MAX, SUBSTEPS_PER_TURN,
} from './constants.js';

/** The two zone boundaries, in board units — the spec's yardages, converted once. */
export const LOCK_UNITS = LOB_LOCK_YARDS * UNITS_PER_YARD_X;
export const CATCH_UNITS = LOB_CATCH_YARDS * UNITS_PER_YARD_X;

/**
 * Whether a throw that reaches this far arcs at all. At or inside the lock zone
 * it does not: the ball never leaves anybody's reach, so there is nothing for
 * the arc to model and it stays the ordinary rolling throw it has always been.
 */
export function isLob(distanceUnits) {
  return distanceUnits > LOCK_UNITS;
}

/** The radius of the landing circle for a lob this long, in units. */
export function scatterRadius(distanceUnits) {
  const overYards = Math.max(0, (distanceUnits - LOCK_UNITS) / UNITS_PER_YARD_X);
  return (LOB_CATCH_YARDS + LOB_SCATTER_PER_YARD * overYards) * UNITS_PER_YARD_X;
}

/**
 * A uniformly random point inside the circle of `radius` about `aim`.
 *
 * The square root is not decoration: drawing the radius flat would put half
 * of every throw inside the middle quarter of the circle, and the coach would
 * learn to treat the aim point as the landing spot. Area-uniform is what makes
 * the circle mean what it is drawn to mean.
 */
export function scatterPoint(aim, radius, random) {
  const r = radius * Math.sqrt(random());
  const a = 2 * Math.PI * random();
  return { x: aim.x + r * Math.cos(a), y: aim.y + r * Math.sin(a) };
}

/**
 * How many sub-steps a lob this long hangs, measured against the deepest throw
 * in the game: that one takes LOB_TIME_MULT turns, and everything shorter takes
 * its share. Never zero — a flight has to take some time, or the ball would
 * teleport and the zones would never be visited.
 */
export function lobSubsteps(distanceUnits) {
  const share = distanceUnits / PASS_REACH_MAX;
  return Math.max(1, Math.round(LOB_TIME_MULT * SUBSTEPS_PER_TURN * share));
}

/**
 * The flight plan for a throw from `from` aimed at `aim`. The scatter is rolled
 * HERE, once, at release — not per sub-step and not at paint time — so the ball
 * has a landing spot from the moment it leaves the hand and a seeded game
 * replays the same throw every time.
 */
export function planLob(from, aim, random) {
  const to = scatterPoint(aim, scatterRadius(dist(from, aim)), random);
  return { from: { ...from }, to, substeps: lobSubsteps(dist(from, to)), elapsed: 0 };
}

/** How far along its flight the ball is: 0 in the hand, 1 on the ground. */
export function lobProgress(lob) {
  return lob.substeps === 0 ? 1 : Math.min(1, lob.elapsed / lob.substeps);
}

/**
 * Where the ball is right now. A straight line at a constant pace: the arc is
 * vertical, and this game has no vertical — the height is told by lobBallScale
 * and by the stretch where nobody can catch it, not by bending the path across
 * the ground.
 */
export function lobPoint(lob) {
  const t = lobProgress(lob);
  return {
    x: lob.from.x + (lob.to.x - lob.from.x) * t,
    y: lob.from.y + (lob.to.y - lob.from.y) * t,
  };
}

export function lobLanded(lob) {
  return lob.elapsed >= lob.substeps;
}

/**
 * The stretch of the flight where the ball is above everybody, as distances
 * from the hand: from the lock zone's edge to a catch window short of the
 * landing spot. On a lob under LOB_LOCK_YARDS + LOB_CATCH_YARDS the two ends
 * cross over (`end <= start`) and there is no such stretch at all — that throw
 * arcs and scatters, but it is never out of reach.
 */
function deadZone(lob) {
  const total = dist(lob.from, lob.to);
  return { start: LOCK_UNITS, end: total - CATCH_UNITS, total };
}

/** Whether the ball can be taken where it is now, by either team. */
export function lobCatchable(lob) {
  const { start, end, total } = deadZone(lob);
  if (end <= start) return true;
  const flown = lobProgress(lob) * total;
  return flown <= start || flown >= end;
}

/**
 * How big to draw the ball: its ordinary size on the way out and on the way in,
 * LOB_BALL_SCALE at the top of the arc, and a half-sine between — so it grows
 * exactly where it stops being catchable and is back to size exactly where it
 * can be caught again. One number tells the coach both things at once.
 */
export function lobBallScale(lob) {
  const { start, end, total } = deadZone(lob);
  if (end <= start) return 1;
  const flown = lobProgress(lob) * total;
  if (flown <= start || flown >= end) return 1;
  return 1 + (LOB_BALL_SCALE - 1) * Math.sin(Math.PI * ((flown - start) / (end - start)));
}

/** One sub-step of flight. Returns where the ball has got to. */
export function stepLob(lob) {
  if (lob.elapsed < lob.substeps) lob.elapsed += 1;
  return lobPoint(lob);
}

/**
 * How big to draw whatever ball this is. The one entry point for the renderer
 * and for turn.js's frames, so neither has to know whether a ball is lobbing.
 */
export function ballScale(ball) {
  return ball && ball.lob ? lobBallScale(ball.lob) : 1;
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the new `lob.test.js` and everything that was already green.

- [x] **Step 6: Commit**

```bash
git add lib/game/constants.js lib/game/lob.js test/game/lob.test.js && git commit -m "Add the lob's flight plan: scatter, hang time, zones and ball size"
```

---

## Task 3: A long throw leaves as a lob

The flight plan is built at release, from the turn's own `random`, and only for
a throw long enough to arc. `setPass` also gains the locked-on receiver's id
here, because `releasePass` is the thing that has to know a locked-on throw
never lobs.

**Files:**
- Modify: `lib/game/pass.js` (`releasePass`)
- Modify: `lib/game/state.js` (`setPass`)
- Modify: `lib/game/turn.js` (the one call site)
- Test: `test/game/pass.test.js`, `test/game/state.test.js`

**Interfaces:**
- Consumes: `passReach`, `passOrigin` (Task 1); `isLob`, `planLob` (Task 2).
- Produces:
  - `releasePass(state, random) -> events[]` — **the signature gains a required
    second argument.**
  - `setPass(state, id, dir, power, target = null) -> boolean`, and
    `state.plannedPass` becomes `{from, dir, power, target}`.
  - `state.ball` gains `lob: flightPlan | null` on any thrown ball.

- [x] **Step 1: Write the failing tests**

In `test/game/pass.test.js`, add to the imports:

```js
import { mulberry32 } from '../../lib/game/rng.js';
import { isLob, lobSubsteps, scatterRadius } from '../../lib/game/lob.js';
import { dist } from '../../lib/game/vec.js';
```

and append:

```js
test('a throw that reaches past the lock zone is flown, not rolled', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  releasePass(s, mulberry32(5));
  const lob = s.ball.lob;
  assert.ok(lob, 'full power arcs');
  assert.deepEqual(lob.from, s.ball.pos, 'it starts where the ball starts');
  assert.equal(lob.elapsed, 0);
  const aim = passAim(qb, { x: 0, y: 1 }, 1);
  assert.ok(dist(lob.to, aim) <= scatterRadius(passReach(1)) + 1e-9, 'lands inside the circle');
  assert.equal(lob.substeps, lobSubsteps(dist(lob.from, lob.to)));
  assert.ok(Math.abs(len(s.ball.vel) - PASS_SPEED_MAX) < 1e-9,
    'vel is still what it left the hand at — nothing integrates it while it flies');
});

test('a throw that stays inside the lock zone is the ordinary rolling ball it always was', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.4); // 14.5 yards: just short of a lob
  releasePass(s, mulberry32(5));
  assert.ok(!isLob(passReach(0.4)), 'the fixture is on the right side of the line');
  assert.equal(s.ball.lob, null);
});

test('a handoff never becomes a lob', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: -1 }, 0);
  releasePass(s, mulberry32(5));
  assert.equal(s.ball.lob, null);
});

test('a locked-on throw is never a lob, however hard it has to be thrown', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1, 'o-wr1');
  releasePass(s, mulberry32(5));
  assert.equal(s.ball.lob, null, 'a ball aimed at a man stays in reach of him');
});

test('the same seed throws the same lob, a different one does not', () => {
  const throwIt = (seed) => {
    const s = createGame({ seed: 1 });
    setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
    releasePass(s, mulberry32(seed));
    return s.ball.lob.to;
  };
  assert.deepEqual(throwIt(11), throwIt(11));
  assert.notDeepEqual(throwIt(11), throwIt(12));
});

test('a short throw draws no dice at all, so it cannot shift a seeded game', () => {
  const s = createGame({ seed: 1 });
  const random = mulberry32(2);
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.2);
  releasePass(s, random);
  assert.equal(random(), mulberry32(2)(), 'the stream is exactly where it was');
});
```

Update `test/game/state.test.js`'s two `deepEqual`s on `plannedPass` (around
lines 150-152) to carry the new field:

```js
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 0, y: 1 }, power: 0.5, target: null });
  setPass(s, 'o-qb', { x: 1, y: 0 }, 0.9);
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 1, y: 0 }, power: 0.9, target: null });
```

and add below that test:

```js
test('a throw can be locked onto a receiver, and the next one clears the lock', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5, 'o-wr1');
  assert.equal(s.plannedPass.target, 'o-wr1');
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5);
  assert.equal(s.plannedPass.target, null, 'a fresh drag is a fresh order');
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — the new pass tests throw `TypeError: random is not a function`
(or report `s.ball.lob` undefined), and the two `state.test.js` `deepEqual`s
fail on the missing `target`.

- [x] **Step 3: Give setPass the target**

In `lib/game/state.js`, replace `setPass` (keep the existing doc comment and add
the last paragraph):

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
 */
export function setPass(state, id, dir, power, target = null) {
  if (state.ball.carrierId !== id) return false;
  state.plannedPass = { from: id, dir, power, target };
  return true;
}
```

- [x] **Step 4: Build the lob in releasePass**

In `lib/game/pass.js`, add the import:

```js
import { isLob, planLob } from './lob.js';
```

Change the signature and the ball it builds:

```js
/**
 * Put the planned throw in the air, and report what happened: a `pass` event
 * always, plus a `flag` event when it drew one. Returns [] and changes nothing
 * when no throw is planned, or when the man who planned it is no longer the
 * one holding the ball — a fumble between planning and the whistle cancels it.
 *
 * `random` is the turn's own, and is drawn from ONLY when the throw actually
 * lobs: the landing scatter is the one roll of the dice in a throw, and a
 * handoff must not shift a seeded game's stream by taking one it doesn't need.
 */
export function releasePass(state, random) {
```

and replace the `state.ball = {...}` assignment with:

```js
  const speed = passSpeed(planned.power);
  const reach = passReach(planned.power);
  const pos = passOrigin(car, dir);
  state.ball = {
    carrierId: null,
    pos,
    vel: scale(dir, speed),
    loose: PASS_GRACE_SUBSTEPS,
    forward,
    // A throw long enough to arc is FLOWN rather than rolled: planLob fixes
    // where it comes down — somewhere inside the landing circle the coach was
    // shown — and how long it hangs, and physics.js walks it there. A throw
    // aimed at a man never arcs, whatever its power: the whole point of locking
    // on is that the ball stays in his reach, and a lob would go over his head.
    //
    // `vel` above is still what it left the hand at, which is true of a lob as
    // much as of a handoff and is what the arrow and the flag were drawn from.
    // It simply is not what moves the ball any more once `lob` is set.
    lob: !planned.target && isLob(reach)
      ? planLob(pos, add(pos, scale(dir, reach)), random)
      : null,
  };
```

- [x] **Step 5: Hand the turn's random to it**

In `lib/game/turn.js`, the one call site:

```js
  events.push(...releasePass(state, random));
```

- [x] **Step 6: Fix the existing releasePass calls in the tests**

Every bare `releasePass(s)` in `test/game/pass.test.js` becomes
`releasePass(s, mulberry32(1))`. There are eight of them, in the tests named:
"releasing a throw puts the ball in the air…", "a non-unit direction…", "an
illegal throw is allowed to happen…", "a backward throw touches neither…",
"power scales the throw…", "a fumble between planning and the whistle…",
"nothing planned, nothing thrown", and "only the first flag of a down is kept"
(three calls in that last one).

Run: `grep -n 'releasePass(s)' test/game/pass.test.js` to confirm none are left.

- [x] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all of it.

- [x] **Step 8: Commit**

```bash
git add lib/game/pass.js lib/game/state.js lib/game/turn.js test/game/pass.test.js test/game/state.test.js && git commit -m "Throw a lob when the pass reaches past the lock zone"
```

---

## Task 4: The ball flies its arc

**Files:**
- Modify: `lib/game/physics.js`
- Test: `test/game/physics.test.js`

**Interfaces:**
- Consumes: `stepLob` (Task 2), `ball.lob` (Task 3).
- Produces: nothing new — `stepPhysics` simply moves a lobbing ball differently.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/physics.test.js` (it already imports `stepPhysics`, `len`
and `createGame`; add `import { DT } from '../../lib/game/constants.js';` if the
file does not already have `DT`):

```js
test('a lob flies its scripted path and pays no attention to friction', () => {
  const s = createGame({ seed: 1 });
  const lob = { from: { x: 135, y: 70 }, to: { x: 135, y: 150 }, substeps: 40, elapsed: 0 };
  s.ball = { carrierId: null, pos: { ...lob.from }, vel: { x: 0, y: 400 }, loose: 0, forward: true, lob };
  stepPhysics(s, DT);
  assert.equal(lob.elapsed, 1, 'the flight clock ran');
  assert.ok(Math.abs(s.ball.pos.y - (70 + 80 / 40)) < 1e-9, 'one fortieth of the way');
  assert.ok(Math.abs(len(s.ball.vel) - 400) < 1e-9, 'its release speed is left alone');
});

test('a lob that has landed stays where it landed', () => {
  const s = createGame({ seed: 1 });
  const lob = { from: { x: 135, y: 70 }, to: { x: 135, y: 150 }, substeps: 2, elapsed: 0 };
  s.ball = { carrierId: null, pos: { ...lob.from }, vel: { x: 0, y: 400 }, loose: 0, forward: true, lob };
  for (let i = 0; i < 10; i++) stepPhysics(s, DT);
  assert.deepEqual(s.ball.pos, lob.to, 'it does not roll on past the spot');
});

test('an ordinary loose ball still rolls and decays', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: null, pos: { x: 135, y: 100 }, vel: { x: 10, y: 0 }, loose: 0, lob: null };
  stepPhysics(s, DT);
  assert.ok(s.ball.pos.x > 135, 'rolled');
  assert.ok(len(s.ball.vel) < 10, 'slowed');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/physics.test.js`
Expected: FAIL — the first test's `lob.elapsed` is still 0 and the ball has been
integrated from `vel` instead (`pos.y` ≈ 76.7, not 72).

- [ ] **Step 3: Fly it**

In `lib/game/physics.js`, add the import:

```js
import { stepLob } from './lob.js';
```

and replace the loose-ball block inside `stepPhysics`:

```js
  if (state.ball.carrierId === null && state.ball.pos) {
    if (state.ball.lob) {
      // A lob is flown, not rolled. Its whole path was fixed at release, so
      // this walks the clock rather than integrating anything — friction has
      // nothing to say about a ball that is in the air, and its `vel` is left
      // alone because it means "how hard it was thrown", not "where it is
      // going next".
      state.ball.pos = stepLob(state.ball.lob);
    } else {
      state.ball.pos = add(state.ball.pos, scale(state.ball.vel, dt));
      state.ball.vel = scale(state.ball.vel, BALL_FRICTION);
    }
    // The no-pickup grace window burns down with the ball's flight, so every
    // sub-step nobody may claim it is a sub-step it has actually travelled.
    if (state.ball.loose > 0) state.ball.loose -= 1;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/game/physics.js test/game/physics.test.js && git commit -m "Fly a lob along its plan instead of rolling it"
```

---

## Task 5: Who may touch it, and when it is dead

Three rule changes, all reading `ball.lob`: the catch gate, the ruling on a
landed lob, and the sideline.

**Files:**
- Modify: `lib/game/rules.js` (`checkPickup`, `checkIncomplete`, `checkDeadBall`)
- Test: `test/game/rules.test.js`

**Interfaces:**
- Consumes: `lobCatchable`, `lobLanded`, `lobPoint` (Task 2).
- Produces: no new exports; three changed behaviours.

- [ ] **Step 1: Write the failing tests**

In `test/game/rules.test.js`, add `checkIncomplete` to the existing
`rules.js` import, add `SIDELINE_RIGHT` to the existing `geometry.js` import,
and add one new line:

```js
import { checkIncomplete, tackleProbability, checkTackles, checkPickup, checkDeadBall, nextDown } from '../../lib/game/rules.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT } from '../../lib/field/geometry.js';
import { lobPoint } from '../../lib/game/lob.js';
```

and append:

```js
/**
 * A 21-yard lob straight downfield: long enough to have a dead zone (18+). It
 * flies down x = 100 rather than down the middle, which is a lane no player in
 * the drive-start formation is standing in — so the only man near the ball in
 * any of these tests is the one the test itself put there.
 */
function deepLob(state, elapsed, { forward = true } = {}) {
  const lob = { from: { x: 100, y: 70 }, to: { x: 100, y: 150 }, substeps: 40, elapsed };
  state.ball = {
    carrierId: null, pos: lobPoint(lob), vel: { x: 0, y: 0 }, loose: 0, forward, lob,
  };
  return lob;
}

test('a lob over everyone\'s heads cannot be taken, by either team', () => {
  const s = createGame({ seed: 1 });
  const lob = deepLob(s, 30); // 60 units flown: past the lock zone, short of the window
  getPlayer(s, 'd-s').pos = { ...s.ball.pos };
  assert.deepEqual(checkPickup(s), [], 'the safety is standing under it and cannot have it');
  getPlayer(s, 'o-wr1').pos = { ...s.ball.pos };
  assert.deepEqual(checkPickup(s), [], 'and neither can the receiver');
  assert.equal(lob.elapsed, 30, 'nothing about the flight was touched');
});

test('the same lob is caught as normal once it has come down', () => {
  const s = createGame({ seed: 1 });
  const lob = deepLob(s, 40); // landed
  getPlayer(s, 'o-wr1').pos = { ...s.ball.pos };
  const events = checkPickup(s);
  assert.deepEqual(events, [{ type: 'pickup', by: 'o-wr1', team: 'offense' }]);
  assert.equal(s.ball.carrierId, 'o-wr1');
  assert.equal(s.ball.lob, undefined, 'a caught ball is no longer a flight');
  assert.ok(lob);
});

test('a lob is live in the first fifteen yards of its flight, the same as any throw', () => {
  const s = createGame({ seed: 1 });
  deepLob(s, 20); // 40 units flown: inside the lock zone
  getPlayer(s, 'd-cb1').pos = { ...s.ball.pos };
  assert.equal(checkPickup(s)[0].by, 'd-cb1', 'a defender can still pick one off early');
});

test('a lob in the air is not incomplete, not even at the whistle', () => {
  const s = createGame({ seed: 1 });
  deepLob(s, 30);
  assert.deepEqual(checkIncomplete(s), []);
  assert.deepEqual(checkIncomplete(s, { endOfTurn: true }), [], 'it hangs into the next turn');
  assert.equal(s.deadReason, null);
});

test('a lob nobody caught is incomplete the moment it lands', () => {
  const s = createGame({ seed: 1 });
  deepLob(s, 40);
  assert.deepEqual(checkIncomplete(s), [{ type: 'incomplete' }]);
  assert.equal(s.deadReason, 'incomplete');
});

test('a backward lob on the ground is live, like any other lateral', () => {
  const s = createGame({ seed: 1 });
  deepLob(s, 40, { forward: false });
  assert.deepEqual(checkIncomplete(s, { endOfTurn: true }), []);
  assert.equal(s.deadReason, null);
});

test('the air over the sideline is not out of bounds', () => {
  const s = createGame({ seed: 1 });
  const lob = deepLob(s, 30);
  s.ball.pos = { x: SIDELINE_RIGHT + 20, y: lobPoint(lob).y };
  assert.deepEqual(checkDeadBall(s), [], 'a forward lob is ruled where it lands, not where it flies');
  // Backward, it is an ordinary loose ball and the sideline still applies.
  const b = createGame({ seed: 1 });
  const bl = deepLob(b, 30, { forward: false });
  b.ball.pos = { x: SIDELINE_RIGHT + 20, y: lobPoint(bl).y };
  assert.deepEqual(checkDeadBall(b), [{ type: 'out-of-bounds' }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/rules.test.js`
Expected: FAIL — the dead-zone pickup succeeds, `checkIncomplete` rules an
airborne lob incomplete at the whistle, and the sideline claims the forward one.

- [ ] **Step 3: Gate the catch**

In `lib/game/rules.js`, add the import:

```js
import { lobCatchable, lobLanded } from './lob.js';
```

and add one guard to `checkPickup`, right after the `loose` grace check:

```js
  // A lob spends the middle of its flight above everybody. Nobody may take it
  // there — not the receiver it was thrown to and not the defender standing
  // under it — until it comes back down inside the catch window at the end.
  if (state.ball.lob && !lobCatchable(state.ball.lob)) return [];
```

- [ ] **Step 4: Rule it where it lands**

Replace the body of `checkIncomplete` (keep the existing doc comment and append
the new paragraph):

```js
 * A LOB is ruled where it lands rather than when the whistle blows. Hanging
 * past the end of the turn is the whole point of throwing one — the coach gets
 * a planning phase to run somebody under it — so until it is down there is
 * nothing to rule, `endOfTurn` or not.
 */
export function checkIncomplete(state, { endOfTurn = false } = {}) {
  if (state.deadReason || state.ball.carrierId !== null || !state.ball.forward) return [];
  if (state.ball.lob) {
    if (!lobLanded(state.ball.lob)) return [];
  } else if (!endOfTurn && len(state.ball.vel) > PASS_DEAD_SPEED) return [];
  state.deadReason = 'incomplete';
  return [{ type: 'incomplete' }];
}
```

- [ ] **Step 5: Let it fly over the paint**

In `checkDeadBall`, replace the loose-ball sideline check:

```js
  // A forward lob is in the air, and the air over the sideline is not out of
  // bounds. It is ruled where it comes down, and a forward pass coming down is
  // an incompletion whichever side of the paint it lands on — checkIncomplete
  // has that ruling, and this check would otherwise beat it to the whistle.
  // A BACKWARD lob is a lateral: on the ground or over the paint, the ordinary
  // loose-ball rule is the right one.
  const airborne = state.ball.lob && state.ball.forward;
  if (!car && !airborne && (bp.x < SIDELINE_LEFT || bp.x > SIDELINE_RIGHT)) {
    state.deadReason = 'out-of-bounds';
    return [{ type: 'out-of-bounds' }];
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/game/rules.js test/game/rules.test.js && git commit -m "Rule the lob: uncatchable over the middle, decided where it lands"
```

---

## Task 6: The turn carries a hanging ball

The turn already runs `releasePass` with `random` (Task 3) and already leaves
`phase` at `planning` when nothing died. What is left is the frames: they have to
carry the ball's drawn size, or the animation cannot swell it.

**Files:**
- Modify: `lib/game/turn.js` (`snapshot`, and the comment above the end-of-turn
  ruling)
- Test: `test/game/turn.test.js`

**Interfaces:**
- Consumes: `ballScale` (Task 2).
- Produces: a frame's `looseBall` becomes `{x, y, scale}` — `app/main.js` reads
  `scale` in Task 9.

- [ ] **Step 1: Write the failing tests**

In `test/game/turn.test.js`, add imports:

```js
import { lobLanded, isLob } from '../../lib/game/lob.js';
import { passReach } from '../../lib/game/pass.js';
```

Change **three** existing tests, and add three:

1. In `'a forward pass nobody catches is incomplete in the turn it was thrown'`,
   change the throw to one that does not arc, and say so:

```js
test('an ordinary forward pass nobody catches is incomplete in the turn it was thrown', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb'); // nobody out there to catch it
  assert.ok(!isLob(passReach(0.4)), '0.4 is a flat throw, not a lob');
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.4);
  const { events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'incomplete'), 'ruled incomplete');
  assert.equal(s.deadReason, 'incomplete');
  assert.equal(s.phase, 'playOver');
  assert.equal(s.turnIndex, 1, 'decided in its own turn, never left live for another');
});
```

2. In `'a teammate downfield catches the throw'`, change
   `setPass(s, 'o-qb', { x: 0, y: 1 }, 1);` to
   `setPass(s, 'o-qb', { x: 0, y: 1 }, 0.4);` and add a line above it:

```js
  // A flat throw, not a lob: this test is about the catch, and a lob would put
  // the ball down somewhere inside a six-yard circle instead of on his chest.
```

3. Make the identical change in `'a defender in the throwing lane intercepts it — the play is over'`.

Two other full-power tests are **left exactly as they are** and must still pass:
`'a planned throw goes up at the snap of the turn'` only asserts that the ball
covered ground (a lob covers 55 units in its first turn), and `'a forward pass
nobody catches is incomplete: dead ball, play over'` already loops turns until
the play is over, which is now two or three of them instead of one.

Then append:

```js
test('a lob hangs past the whistle and is ruled where it lands', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb'); // nobody out there to catch it
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const random = mulberry32(1);
  runTurn(s, random);
  assert.equal(s.phase, 'planning', 'the turn ended with the ball still up');
  assert.equal(s.deadReason, null, 'nothing is ruled while it is in the air');
  assert.ok(s.ball.lob && !lobLanded(s.ball.lob), 'still flying');
  assert.equal(s.plannedPass, null, 'and the throw is not re-thrown next turn');
  let turns = 1;
  while (s.phase !== 'playOver' && turns < 8) { runTurn(s, random); turns += 1; }
  assert.equal(s.deadReason, 'incomplete');
  assert.ok(turns >= 2, `it took more than the turn it was thrown in (${turns})`);
});

test('a receiver who gets under a hanging lob catches it on the next turn', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'o-wr1');
  // Deep in his own end, and two thirds power: a lob that comes down SHORT of
  // the goal line, so the catch is a catch rather than a touchdown.
  getPlayer(s, 'o-qb').pos = fieldPos(0, -18);
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.67);
  const random = mulberry32(1);
  runTurn(s, random);
  assert.ok(s.ball.lob && !lobLanded(s.ball.lob), 'still in the air at the whistle');
  // The coach can see where it is coming down, so he puts his man on the spot.
  getPlayer(s, 'o-wr1').pos = { ...s.ball.lob.to };
  let turns = 1;
  while (s.phase === 'planning' && s.ball.carrierId === null && turns < 8) {
    runTurn(s, random);
    turns += 1;
  }
  assert.equal(s.ball.carrierId, 'o-wr1', 'he was standing where it came down');
  assert.equal(s.deadReason, null, 'a completion short of the goal keeps the down alive');
});

test('the frames carry the ball\'s drawn size, so the animation can swell it', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb'); // nobody out there to catch it
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const random = mulberry32(1);
  // Every frame of the whole flight, which is more than one turn's worth: a
  // bomb is barely half way there when the first whistle blows, so a single
  // turn's frames need never have reached the top of the arc.
  const scales = [];
  let turns = 0;
  while (s.phase === 'planning' && turns < 8) {
    const { frames } = runTurn(s, random);
    for (const f of frames) if (f.looseBall) scales.push(f.looseBall.scale);
    turns += 1;
  }
  assert.equal(scales[0], 1, 'ordinary size out of the hand');
  const biggest = Math.max(...scales);
  assert.ok(biggest > 1, `it swells as it climbs (${biggest.toFixed(2)})`);
  assert.equal(scales[scales.length - 1], 1, 'and is back to size where it came down');
});

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/turn.test.js`
Expected: FAIL — `frames[0].looseBall.scale` is `undefined`. (The two hanging-lob
tests should already pass from Tasks 3-5; if they do not, that is a defect in an
earlier task, not in this one.)

- [ ] **Step 3: Put the size in the frames**

In `lib/game/turn.js`, add the import:

```js
import { ballScale } from './lob.js';
```

and change `snapshot`:

```js
/**
 * `ball` is where the ball is this sub-step (the carrier's spot, or the loose
 * ball's). `looseBall` is non-null only while nobody is carrying it — that's
 * the flag app/main.js needs, because a carried ball is drawn inside the
 * carrier's group and rides along for free, while a loose one needs its own
 * animated node. It carries the ball's drawn SIZE as well as its position:
 * there is no z axis here, so a lob says how high it is by how big it is, and
 * the animation has to be told frame by frame.
 */
function snapshot(state) {
  const bp = ballPos(state);
  const loose = state.ball.carrierId === null ? state.ball.pos : null;
  return {
    players: state.players.map((p) => ({ id: p.id, x: p.pos.x, y: p.pos.y })),
    ball: bp ? { x: bp.x, y: bp.y } : null,
    looseBall: loose ? { x: loose.x, y: loose.y, scale: ballScale(state.ball) } : null,
  };
}
```

- [ ] **Step 4: Correct the comment that is now wrong**

In `runTurn`, the paragraph above the end-of-turn `checkIncomplete` claims every
forward pass is decided inside its own turn. Replace it with:

```js
  // An ordinary forward pass is decided inside the turn it was thrown: if
  // nobody has claimed it by the whistle, it is incomplete. Without this the
  // ball stays live through a whole planning phase — BALL_FRICTION only decays
  // a throw to PASS_DEAD_SPEED after ~57 sub-steps, so no flat throw a human
  // can draw settles inside its own turn — and a defender falling on it next
  // turn would turn an incompletion into a game-ending turnover.
  //
  // A LOB is the deliberate exception, and checkIncomplete is where it lives:
  // one that is still in the air at the whistle stays live into the next
  // planning phase, which is exactly what the coach threw it for.
  events.push(...checkIncomplete(state, { endOfTurn: true }));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/game/turn.js test/game/turn.test.js && git commit -m "Let a lob hang across the whistle, and size the ball in every frame"
```

---

## Task 7: Locking on

Three pure functions in `pass.js`: who the drag landed on, the throw that puts
the ball on him, and the landing circle a throw earns. `app/main.js` and
`render.js` both consume them in the two tasks that follow, so neither ends up
doing throw arithmetic of its own.

**Files:**
- Modify: `lib/game/pass.js`
- Test: `test/game/pass.test.js`

**Interfaces:**
- Consumes: `LOCK_UNITS`, `isLob`, `scatterRadius` (Task 2); `passReach`,
  `passAim`, `passOrigin`, `powerForTravel` (Task 1).
- Produces:
  - `receiverAt(state, point: {x,y}, passerId: string) -> string | null`
  - `lockOnPass(passer, receiver) -> {dir: {x,y}, power: number}`
  - `passLanding(player, dir, power) -> {pos: {x,y}, radius: number} | null`

- [ ] **Step 1: Write the failing tests**

Add to `test/game/pass.test.js`'s imports: `receiverAt`, `lockOnPass`,
`passLanding` from `pass.js`; `LOCK_UNITS`, `scatterRadius` from `lob.js`;
`SUBSTEPS_PER_TURN` from `constants.js` (already added in Task 1). Then append:

```js
test('a throw drag onto one of your own inside the lock zone picks him out', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x + 20, y: qb.pos.y + 20 }; // 28 units: comfortably inside
  assert.equal(receiverAt(s, { ...wr.pos }, 'o-qb'), 'o-wr1');
  assert.equal(receiverAt(s, { x: wr.pos.x + 30, y: wr.pos.y }, 'o-qb'), null, 'nobody there');
});

test('nothing locks on but your own men, and never the passer himself', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const cb = getPlayer(s, 'd-cb1');
  cb.pos = { x: qb.pos.x + 20, y: qb.pos.y + 20 };
  assert.equal(receiverAt(s, { ...cb.pos }, 'o-qb'), null, 'you cannot throw it to them');
  assert.equal(receiverAt(s, { ...qb.pos }, 'o-qb'), null, 'nor to yourself');
});

test('a man past the lock zone cannot be locked onto, however close the drag lands', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + LOCK_UNITS - 1 };
  assert.equal(receiverAt(s, { ...wr.pos }, 'o-qb'), 'o-wr1', 'a yard inside: fine');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + LOCK_UNITS + 1 };
  assert.equal(receiverAt(s, { ...wr.pos }, 'o-qb'), null, 'a yard outside: throw a lob instead');
});

test('a lock-on is aimed at the man and thrown hard enough to reach him this turn', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 40 };
  const { dir, power } = lockOnPass(qb, wr);
  assert.ok(Math.abs(dir.x) < 1e-9 && Math.abs(dir.y - 1) < 1e-9, 'straight at him');
  const gap = dist(passOrigin(qb, dir), wr.pos);
  assert.ok(Math.abs(passTravel(power, SUBSTEPS_PER_TURN) - gap) < 1e-6,
    'the ball is on him before the whistle, not 84% of the way');
});

test('a throw short of the lock zone has no landing circle; a lob has one that grows', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const dir = { x: 0, y: 1 };
  assert.equal(passLanding(qb, dir, 0.4), null, 'a flat throw lands where it is aimed');
  const land = passLanding(qb, dir, 1);
  assert.deepEqual(land.pos, passAim(qb, dir, 1));
  assert.ok(Math.abs(land.radius - scatterRadius(passReach(1))) < 1e-9);
  assert.ok(land.radius > passLanding(qb, dir, 0.6).radius, 'the longer the throw, the bigger the guess');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `does not provide an export named 'receiverAt'`.

- [ ] **Step 3: Write the three functions**

In `lib/game/pass.js`, extend three import lines that are already there:

```js
import { add, scale, norm, sub, len, dist } from './vec.js';
import { carrier, getPlayer } from './state.js';
import { isLob, planLob, scatterRadius, LOCK_UNITS } from './lob.js';
// ...and add PICK_SLOP_UNITS to the existing './constants.js' import.
```

and add below `passAim`:

```js
/**
 * The man a throw drag has landed on, or null.
 *
 * Three things have to be true: he is one of yours, he is not you, and he is
 * inside the lock zone. That last one is the rule the whole feature turns on —
 * past LOB_LOCK_YARDS the ball would be above him by the time it got there, so
 * there is nothing to lock onto and the drag means a lob instead.
 *
 * The pick slop is PICK_SLOP_UNITS, the same fat-finger margin app/main.js uses
 * to choose the man being ordered and cover.js uses to choose the man being
 * taken on: how forgiving a drag is should not depend on which verb it is.
 */
export function receiverAt(state, point, passerId) {
  const passer = getPlayer(state, passerId);
  let best = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.id === passerId || p.team !== passer.team) continue;
    if (dist(p.pos, passer.pos) > LOCK_UNITS) continue;
    const d = dist(p.pos, point);
    if (d <= p.radius + PICK_SLOP_UNITS && d < bestD) { best = p.id; bestD = d; }
  }
  return best;
}

/**
 * The throw that puts the ball on this man THIS TURN: aimed where he is
 * standing, and thrown exactly hard enough to arrive before the whistle rather
 * than at whatever force the drag happened to carry. That is what locking on
 * is — the coach picks the man, the passer picks the pace.
 *
 * Sizing it for one turn rather than for the throw's eventual reach is the
 * whole point: a throw sized to arrive "in the end" is only 84% of the way
 * there when the whistle blows, which for a man at the edge of the lock zone
 * is an incompletion at his feet.
 *
 * He is of course free to move between now and the whistle, and the ball is
 * not: a lock-on is an aim, not a guarantee.
 */
export function lockOnPass(passer, receiver) {
  const to = sub(receiver.pos, passer.pos);
  const dir = norm(to);
  const gap = Math.max(0, len(to) - (passer.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON));
  return { dir, power: powerForTravel(gap) };
}

/**
 * The landing circle this throw earns: where it is aimed and how big the guess
 * is — or null when the throw is short enough to go where it is pointed. One
 * function, so the live drag preview, the committed arrow and the ball's own
 * flight are all drawn from the same numbers.
 */
export function passLanding(player, dir, power) {
  const reach = passReach(power);
  if (!isLob(reach)) return null;
  return { pos: passAim(player, dir, power), radius: scatterRadius(reach) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/game/pass.js test/game/pass.test.js && git commit -m "Add lock-on: the receiver a throw drag lands on, and the throw that reaches him"
```

---

## Task 8: The board draws all three

The landing circle, the lock-on halo, and a ball that can be drawn bigger.

**Files:**
- Modify: `lib/game/render.js`
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: `passLanding` (Task 7), `ballScale`, `lobPoint` (Task 2).
- Produces:
  - `passLandingMark(pos: {x,y}, radius: number) -> string`
  - `passLockMark(passer, receiver) -> string`
  - `looseBallMark(pos, scale = 1) -> string` — **one new optional argument**
  - `renderPassArrow(state)` now draws the lock or the circle as well as the arrow.

- [ ] **Step 1: Write the failing tests**

Add two lines to `test/game/render.test.js`'s imports:

```js
import { passLanding } from '../../lib/game/pass.js';
import { lobPoint } from '../../lib/game/lob.js';
```

Then append:

```js
test('a lob draws a landing circle as well as its arrow', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const svg = renderPassArrow(s);
  assert.ok(svg.includes('class="pass"'), 'the arrow is still drawn');
  assert.ok(svg.includes('class="pass-land"'), 'and the landing circle with it');
  const land = passLanding(getPlayer(s, 'o-qb'), { x: 0, y: 1 }, 1);
  assert.ok(svg.includes(`r="${num(land.radius)}"`), 'as big as the guess is');
  assert.ok(svg.includes(`cy="${num(land.pos.y)}"`), 'centred where it is aimed');
});

test('a throw inside the lock zone draws no landing circle at all', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.4);
  assert.ok(!renderPassArrow(s).includes('pass-land'), 'a flat throw goes where it is pointed');
});

test('a locked-on throw draws a halo under the receiver and an arrow to his edge', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 30 };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5, 'o-wr1');
  const svg = renderPassArrow(s);
  assert.ok(svg.includes('class="pass-halo"'), 'the lock reads like a cover halo, in red');
  assert.ok(svg.includes(`r="${num(wr.radius + COVER_HALO_UNITS)}"`), 'and is sized like one');
  assert.ok(svg.includes('class="pass"'), 'with the throw arrow on top of it');
  assert.ok(svg.includes(`L ${num(qb.pos.x)} ${num(wr.pos.y - wr.radius)}`), 'stopping at his edge');
  assert.ok(!svg.includes('pass-land'), 'a locked throw never lobs, so there is no circle');
  assert.ok(svg.indexOf('pass-halo') < svg.indexOf('class="pass"'), 'halo first, line on top');
});

test('a lock on a man who is no longer on the field falls back to the plain arrow', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5, 'o-nobody');
  const svg = renderPassArrow(s);
  assert.ok(svg.includes('class="pass"'));
  assert.ok(!svg.includes('pass-halo'));
});

test('the loose ball is drawn bigger while it is over everyone\'s heads', () => {
  const s = createGame({ seed: 1 });
  const lob = { from: { x: 135, y: 70 }, to: { x: 135, y: 150 }, substeps: 40, elapsed: 30 };
  s.ball = { carrierId: null, pos: lobPoint(lob), vel: { x: 0, y: 0 }, loose: 0, forward: true, lob };
  const svg = renderLooseBall(s);
  assert.ok(svg.includes('data-loose-ball="1"'));
  assert.match(svg, /scale\(/, 'swollen at the top of the arc');
  lob.elapsed = 40;
  s.ball.pos = lobPoint(lob);
  assert.ok(!renderLooseBall(s).includes('scale('), 'and its ordinary size on the ground');
});

test('the lob\'s two marks are styled in the game stylesheet', () => {
  const { markup } = renderBoardShell(0);
  assert.ok(markup.includes('.pass-land{'), 'the landing circle has a style rule');
  assert.ok(markup.includes('.pass-halo{'), 'and so does the lock halo');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/render.test.js`
Expected: FAIL — `does not provide an export named 'passLandingMark'`.

- [ ] **Step 3: Add the two styles**

In `lib/game/render.js`, in `STYLE_GAME` immediately after the `.arh-r` rule:

```js
  // The landing circle: where a lob is aimed, and how big a guess that is.
  // Dashed and barely filled on purpose — the ball comes down SOMEWHERE in
  // here, and a solid disc would claim to know more than the game does. It
  // goes in the `game-arrows` layer, under the players, so a circle drawn over
  // a crowd does not hide the crowd.
  '.pass-land{fill:#b3261e;fill-opacity:.1;stroke:#b3261e;stroke-width:.6;stroke-dasharray:2 2;pointer-events:none}',
  // The lock-on halo: the same shadow a cover order puts under a man, in the
  // throw's own red. "I am throwing to him" and "I am covering him" are the
  // same shape of order — the colour is what keeps them apart.
  '.pass-halo{fill:#b3261e;fill-opacity:.55;stroke:#b3261e;stroke-width:.5;pointer-events:none}',
```

- [ ] **Step 4: Make the ball scalable**

Replace `looseBallMark` and `renderLooseBall`:

```js
/**
 * The football on its own, wrapped in a positioned group so a caller can move
 * it per animation frame with a `transform` — exactly like a player group.
 * `renderLooseBall` (the static, between-turns case) and app/main.js's
 * per-frame animation both go through here, so the ball is one piece of
 * markup with one shape.
 *
 * `scale` is how high it is: this board has no z axis, so a lob at the top of
 * its arc says so by being drawn bigger. The transform is left off entirely at
 * ordinary size, so the common case is exactly the markup it always was.
 */
export function looseBallMark(pos, scale = 1) {
  const size = scale === 1 ? '' : ` scale(${num(scale)})`;
  return (
    `<g class="loose" data-loose-ball="1" transform="translate(${num(pos.x)}, ${num(pos.y)})${size}">` +
    football(0, 0, 0) +
    `</g>`
  );
}

export function renderLooseBall(state) {
  if (state.ball.carrierId !== null || !state.ball.pos) return '';
  return looseBallMark(state.ball.pos, ballScale(state.ball));
}
```

with the import `import { ballScale } from './lob.js';` at the top.

- [ ] **Step 5: Add the two marks and rework the throw arrow**

Below `passArrowTip`, replacing `renderPassArrow`:

```js
/**
 * Where a lob is coming down, and how big the guess is. A bare mark with no
 * wrapper, like arrowMark and destinationMark: app/main.js writes it straight
 * into the `game-preview` layer while the drag is live, and renderPassArrow
 * wraps the identical string once it is committed.
 */
export function passLandingMark(pos, radius) {
  return `<circle cx="${num(pos.x)}" cy="${num(pos.y)}" r="${num(radius)}" class="pass-land"/>`;
}

/**
 * A throw locked onto a man: the halo under him and the throw arrow running to
 * his edge rather than to his centre, so the arrowhead lands on him instead of
 * inside him. The same two-part picture coverMark draws, in the throw's red —
 * halo first, because the line has to read on top of it.
 */
export function passLockMark(passer, receiver) {
  const to = sub(receiver.pos, passer.pos);
  const l = len(to);
  const reach = Math.max(0, l - receiver.radius);
  const tip = l === 0
    ? { ...receiver.pos }
    : { x: passer.pos.x + (to.x / l) * reach, y: passer.pos.y + (to.y / l) * reach };
  return (
    `<circle cx="${num(receiver.pos.x)}" cy="${num(receiver.pos.y)}"` +
    ` r="${num(receiver.radius + COVER_HALO_UNITS)}" class="pass-halo"/>` +
    passArrowMark(passer.pos, tip)
  );
}

/**
 * The planned throw, in one of its three shapes: locked onto a man, arcing to a
 * landing circle, or the plain arrow it has always been. Nothing is drawn once
 * the planner no longer has the ball; the throw will not happen either
 * (releasePass cancels it), so drawing it would be a lie.
 *
 * A lock on a man who is no longer on the field falls back to the arrow rather
 * than drawing nothing: a play loaded onto a different formation is the case,
 * and the throw itself still goes exactly where `dir` and `power` say.
 */
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
    mark = (land ? passLandingMark(land.pos, land.radius) : '')
      + passArrowMark(from.pos, passArrowTip(from.pos, planned.dir, planned.power));
  }
  return `<g class="plan-arrow" data-pass="${planned.from}">${mark}</g>`;
}
```

and add `import { passLanding } from './pass.js';` at the top of `render.js`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/game/render.js test/game/render.test.js && git commit -m "Draw the landing circle, the lock-on halo, and a ball that swells"
```

---

## Task 9: The app, and the words for it

The library has the whole feature by now; this is what puts it under the
coach's finger. `app/main.js` has no test harness in this project (there is no
DOM in `node --test`), so this task is verified by hand, in the browser, against
the checklist in Step 6 — do not skip it, and do not claim the task is done
without having watched a lob land.

**Files:**
- Modify: `app/main.js`
- Modify: `README.md` (the throw bullet under "How to play", around line 116)

**Interfaces:**
- Consumes: `receiverAt`, `lockOnPass`, `passLanding` (Task 7);
  `passLandingMark`, `passLockMark` (Task 8); `lobLanded` (Task 2); the frames'
  `looseBall.scale` (Task 6).
- Produces: nothing other modules read.

- [ ] **Step 1: Extend the imports**

In `app/main.js`:

```js
import {
  renderBoardShell, renderPlayers, renderPlans, renderPassArrow, renderLooseBall, looseBallMark,
  planMark, coverMark, passArrowMark, passArrowTip, renderMessage, destinationMark,
  lineZoneMark, renderFieldButtons, passLandingMark, passLockMark,
} from '../lib/game/render.js';
import { receiverAt, lockOnPass, passLanding } from '../lib/game/pass.js';
import { lobLanded } from '../lib/game/lob.js';
```

- [ ] **Step 2: Teach the drag to throw all three ways**

Add this beside `runOrCoverMark`:

```js
/**
 * What a throw drag should draw, given where the pointer is: the lock-on mark
 * when it has landed on one of your own inside the lock zone, otherwise the
 * arrow — plus the landing circle when the throw is long enough to arc. The
 * live preview and the committed throw draw from the same marks, so the
 * picture never changes shape at the moment the finger comes up.
 */
function throwMark(player, g, point) {
  const lock = receiverAt(state, point, player.id);
  if (lock) return passLockMark(player, getPlayer(state, lock));
  const land = passLanding(player, g.dir, g.throttle);
  return (land ? passLandingMark(land.pos, land.radius) : '')
    + passArrowMark(player.pos, passArrowTip(player.pos, g.dir, g.throttle));
}
```

Replace the `passdrag` branch of `onGesture`:

```js
  if (gesture.kind === 'passdrag') {
    // Tap-then-drag is a throw only from the man with the ball. From anyone
    // else it is an ordinary run arrow — which is what the drag preview showed
    // him, so committing anything less would break that promise.
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
  } else if (gesture.kind === 'drag') {
```

- [ ] **Step 3: Preview it the same way**

In `onDragPreview`, replace the two lines that build `mark`:

```js
  // A throw only previews as a throw from the man actually holding the ball;
  // from anyone else a tap-then-drag is an ordinary run. Both marks come from
  // render.js, so the arrow being dragged and the arrow committed are the same
  // picture either way.
  const throwing = g.kind === 'passdrag' && state.ball.carrierId === playerId;
  const mark = throwing
    ? throwMark(p, g, log[log.length - 1])
    : runOrCoverMark(p, g.travel, log[log.length - 1]);
  layer('game-preview').clear().svg(mark);
```

- [ ] **Step 4: Swell the ball as it flies**

In `animate`'s `tick`, replace the ball transform:

```js
    if (ballNode && frame.ball) {
      // Size as well as position: a lob is over everyone's heads in the middle
      // of its flight, and on a board with no z axis that is said by drawing it
      // bigger. A ball that is not lobbing reports a scale of 1 every frame.
      const size = frame.looseBall ? frame.looseBall.scale : 1;
      ballNode.setAttribute('transform', `translate(${frame.ball.x}, ${frame.ball.y}) scale(${size})`);
    }
```

- [ ] **Step 5: Say when the ball is still up**

In `pressRun`'s `finish`, immediately after the `for (const e of events)` loop:

```js
    // A ball still in the air when the whistle goes is the newest fact on the
    // board, so it gets the last word over whatever the events said. The
    // coach's next job is to get somebody under it.
    if (state.phase === 'planning' && state.ball.lob && !lobLanded(state.ball.lob)) {
      say('The ball is in the air — get someone under it.');
    }
```

- [ ] **Step 6: Verify it by hand**

Run:

```bash
npm run serve
```

and open `http://localhost:8080`. Work through all seven, and fix anything that
does not match before moving on:

1. **The circle appears and grows.** Tap the QB, then press and drag straight
   downfield. Short drags show the red arrow alone. Once the drag passes about
   40% of full power a dashed red circle appears beyond the arrow's tip and gets
   bigger — and further out — the longer you drag.
2. **It commits.** Release. The message reads "QB will lob it deep." and the
   circle stays on the board with the arrow.
3. **It hangs.** Press Run the Turn. The ball flies, visibly swells over the
   middle of its flight, and the turn ends with the ball still in the air:
   "The ball is in the air — get someone under it."
4. **It cannot be caught up there.** Drag a receiver so his destination circle
   sits under the ball's current position and run the turn — he does not get it.
   Now drag him onto the landing circle instead and run turns until the ball
   comes down: he catches it (or a defender does, or it falls incomplete). At
   full power the circle sits in or behind the end zone — see the note above on
   the lock zone against this field's depth — so that catch is a touchdown.
   That is the game working, not a bug.
5. **Lock-on.** Tap the QB and drag onto the RB behind him. A red halo appears
   under the RB and the arrow stops at his edge; the message names him. Run the
   turn — the ball goes to him rather than past him.
6. **Lock-on has a range.** Try the same drag onto a wide receiver at the snap.
   He is 15.3 yards from the QB — just outside the lock zone — so nothing snaps
   and you get the lob circle instead. This is expected, not a bug.
7. **Nothing else moved.** A short backward drag is still a handoff; a run drag
   onto a defender is still a cover order (green halo, not red); Clear Arrows
   still clears the throw.

- [ ] **Step 7: Update the README**

Replace the "**Tap the ball carrier, then drag** to throw" bullet's first
sentence and add the two sub-bullets, leaving the rest of the bullet (the
one-forward-pass rule, the flag, incompletions) exactly as it is:

```markdown
- **Tap the ball carrier, then drag** to throw. The dashed red arrow shows where
  the ball is going and how hard — a short backward drag is a handoff to the man
  beside you, a long forward one is a bomb.
  - **Drop the drag on one of your own within 15 yards** and the throw locks
    onto him: it goes where he is standing, thrown exactly hard enough to arrive
    this turn. He gets a red halo, the way a covered man gets a green one. He is
    free to move between now and the whistle, though — a lock-on is an aim, not
    a guarantee.
  - **Drag further than that** and you are throwing a **lob**. Nothing locks on;
    a red circle shows where the ball is coming down instead, and it grows the
    longer the throw — the ball lands *somewhere* inside it, not on the middle.
    A lob goes up as well as out, so it takes about twice as long to arrive and
    is usually still in the air when the turn ends: you get a whole planning
    phase to run somebody under it. While it is over everyone's heads it is
    drawn bigger and **nobody can catch it** — not your receiver, not the
    defense. It is live for the first 15 yards of its flight, and again for the
    last 3 as it comes down.
```

- [ ] **Step 8: Run the tests one last time and commit**

Run: `npm test`
Expected: PASS.

```bash
git add app/main.js README.md && git commit -m "Throw lobs and lock onto receivers from the board"
```

---

## What this plan deliberately leaves alone

- **`lib/game/play.js` is untouched.** A saved play already stores a throw as
  `{from, dir, power}`, and `setPass`'s new fourth argument defaults to null, so
  a locked-on throw is saved as the equivalent unlocked one. That is the right
  answer rather than a shortcut: the receiver is standing somewhere else on the
  down the play is called on, so a remembered lock would aim at a ghost.
- **The computer is untouched.** `ai.js` already chases a loose ball where it
  lies, so its defenders will run under a hanging lob on their own — and a
  defender standing under it while it is in the dead zone simply cannot take it,
  which is exactly the tension the feature is for.
- **The ordinary throw is untouched.** Friction roll, `PASS_DEAD_SPEED`,
  end-of-turn incompletion, handoffs, laterals: all exactly as they were. The
  only throws that behave differently are ones that reach past 15 yards.
- **One deliberate exception to the flight-distance rule:** a locked-on throw is
  never a lob, even when the power needed to reach the man puts its reach a
  little past 15 yards (a man at the very edge of the zone needs about 16.3
  yards of reach to be hit inside one turn). A lock-on is a flat throw at a man
  and stays live the whole way. Without the exception, locking onto someone at
  the edge of the zone would arc the ball over his head, which is the one thing
  it must not do.
- **No retuning.** `PASS_SPEED_MIN`/`MAX`, `MAX_PASS_ARROW_UNITS` and
  `BALL_FRICTION` keep their values. If the lob's hang time or scatter plays
  badly, that is `LOB_TIME_MULT` and `LOB_SCATTER_PER_YARD` in a separate tuning
  pass, not a change to the throw underneath it.
