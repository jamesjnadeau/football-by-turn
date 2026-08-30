# Assignment Defense (a third AI setting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing pursuit brain, and add a third setting to the Defense button — a computer that plays *assignment* football, built out of one generalized function per defensive position: lineman, linebacker, defensive back.

**Architecture:** One new pure module, `lib/game/defense.js`. It reads the state and returns *orders* — `{ aim, cover }` — and writes nothing, the same purity contract `defensePlans` already keeps in `ai.js`. Positions are derived from the field, not from role names: a lineman's contain side comes from where his own line actually is, the deep man is whoever is aligned deepest, and a "receiver" is anyone who can run with a defensive back. `ai.js` stays the only writer: it dispatches on a new `state.aiLevel` and turns orders into `setPlan`/`setCover` calls. Man coverage goes through `cover.js`, so the computer's secondary is steered by exactly the machinery a human cover order uses — re-aimed every sub-step, worth the same mass and grab reach.

**Tech Stack:** Plain ES modules, no build step. `node --test` for tests (`npm test`). SVG emitted as strings from `lib/game/render.js`; `app/main.js` writes them into layer groups via the vendored SVG.js wrapper.

**Spec:** the "Source spec" section immediately below — the feature request verbatim, plus the three design decisions resolved with the user before this plan was written.

## Global Constraints

- **No new dependencies, no build step.** Plain ES modules, imported by relative path with the `.js` extension.
- **`lib/game/defense.js` is pure.** It may read `state` and must not write to it. Every mutation goes through `state.js` / `cover.js` helpers called from `ai.js`.
- **No randomness in the AI.** A coached turn stays exactly as reproducible as a hand-planned one; every tie-break is deterministic (by id).
- **Tunable numbers live in `lib/game/constants.js`**, each with a comment saying what it is and where the value came from. No bare numbers in `defense.js`.
- **The computer's intentions never reach the screen.** No plan, and now no cover assignment either, may survive `runTurn` into a planning phase.
- **`createGame`'s library defaults do not change behaviour.** `aiLevel` defaults to `'pursuit'`, so every existing test's semantics are untouched; `app/main.js` is what opts the played game into `'smart'`.
- **Units are SVG units** (1 yard = 3.75) and seconds. Downfield — the direction the offense drives, and the direction the defense protects — is **+y**.

---

## Source spec

> I'd like to create a better AI computer defense. Please [keep] the current
> one, but have a 3rd option to choose from that plays smarter. Please study the
> field positions and create generalized functions for the 3 main defensive
> positions: lineman, linebacker, defensive back.

Three forks were resolved with the user before this plan was written:

1. **One button, three states.** The existing "Defense:" button cycles
   `computer (smart)` → `computer (basic)` → `you` → back round. A new game
   starts on **smart**.
2. **Assignment football.** Linemen rush and keep contain; the linebacker fills
   and flows with goal-side leverage; the defensive backs play man on the
   receivers with the deepest man free as help over the top. Once the carrier
   crosses the line — or the ball comes loose — assignments are off and
   everybody converges.
3. **The computer gets the same man-tracking the human gets.** AI defensive
   backs take a real `state.cover` assignment, re-aimed every sub-step by
   `cover.js`, with the same `COVER_MASS_MULT` and `COVER_GRAB_REACH`. In
   exchange, `clearAiPlans` must wipe cover as well as plans.

---

## Why the current brain is beatable (the thing this fixes)

`defensePlans` sends all seven defenders at a lead point on the ball. Three
failures follow, and each maps to one of the three position functions:

| Failure | Position function that fixes it |
|---|---|
| All three linemen converge on one point, so the QB steps around the pile and the edge is open. | `rushLineman` — contain: the outside rushers hold their side of the ball. |
| The linebacker blitzes into the backfield on every turn, so any handoff or cutback runs through where he used to be. | `flowLinebacker` — mirror at depth until the run declares, then fill. |
| Both corners abandon the receivers to chase the QB, so a throw is uncontested. | `coverBack` — man coverage, plus a deep man nobody gets behind. |

Plus one that is everyone's: aiming at a fixed one-second lead instead of
solving the actual **intercept** — the point on the carrier's path both men
reach at the same instant — and taking angles that let the carrier get
**goal-side** of a defender who was in front of him.

---

## File Structure

**Create:**

- `lib/game/defense.js` — assignment defense. Field geometry for the defensive
  half (`positionGroup`, `defendDir`, `losY`, `pastLine`, `groupMates`),
  pursuit geometry (`interceptPoint`, `leverageAim`), the three position
  functions (`rushLineman`, `flowLinebacker`, `coverBack`) and their helpers,
  and the dispatcher (`smartOrder`, `smartOrders`). Pure throughout.
- `test/game/defense.test.js` — its tests.

**Modify:**

- `lib/game/constants.js` — one new block, `--- the computer's assignment
  defense ---`, added to across Tasks 2-5.
- `lib/game/state.js` — `createGame` gains `aiLevel`, stored as `state.aiLevel`.
- `lib/game/ai.js` — `coachAi` dispatches on `state.aiLevel`; new
  `coachSmartDefense` writer; `clearAiPlans` also clears cover; `AI_MODES` /
  `aiModeIndex` / `nextAiMode` describe the button's three-way cycle.
- `test/game/ai.test.js`, `test/game/state.test.js` — tests for the above.
- `app/main.js` — the Defense button cycles three ways; new games start smart.
- `index.html` — the button's initial label.
- `README.md` — describes the three settings.

---

### Task 1: Defensive field geometry and position groups

The vocabulary every later task speaks. Nothing here knows what a defense
*does*; it knows where things are and which of the three positions a man plays.

**Files:**
- Create: `lib/game/defense.js`
- Test: `test/game/defense.test.js`

**Interfaces:**
- Consumes: `createGame`, `getPlayer` from `lib/game/state.js`; `fieldPos` from
  `lib/game/view.js`.
- Produces:
  - `positionGroup(player) -> 'line' | 'backer' | 'back'`
  - `defendDir(team) -> 1 | -1` — the +y/-y direction that team protects
  - `losY(state) -> number` — the line of scrimmage in SVG y
  - `pastLine(state, team, point) -> boolean`
  - `groupMates(state, player) -> player[]` — teammates in the same group,
    himself included, in `state.players` order

- [ ] **Step 1: Write the failing test**

Create `test/game/defense.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  positionGroup, defendDir, losY, pastLine, groupMates,
} from '../../lib/game/defense.js';
import { createGame, getPlayer } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';

test('every defensive role lands in one of the three position groups', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(positionGroup(getPlayer(s, 'd-nt')), 'line');
  assert.equal(positionGroup(getPlayer(s, 'd-dt1')), 'line');
  assert.equal(positionGroup(getPlayer(s, 'd-dt2')), 'line');
  assert.equal(positionGroup(getPlayer(s, 'd-lb')), 'backer');
  assert.equal(positionGroup(getPlayer(s, 'd-cb1')), 'back');
  assert.equal(positionGroup(getPlayer(s, 'd-cb2')), 'back');
  assert.equal(positionGroup(getPlayer(s, 'd-s')), 'back');
});

test('a role nobody has taught the defense is coached as a linebacker', () => {
  assert.equal(positionGroup({ role: 'ROVER' }), 'backer');
});

test('the defense protects the goal the offense drives at', () => {
  assert.equal(defendDir('defense'), 1);
  assert.equal(defendDir('offense'), -1);
});

test('the line of scrimmage is wherever the down was spotted', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(losY(s), fieldPos(0, 0).y);
  s.losYard = 4;
  assert.equal(losY(s), fieldPos(0, 4).y);
});

test('past the line is measured toward the goal that team is defending', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const backfield = getPlayer(s, 'o-qb').pos;
  const downfield = { x: 135, y: losY(s) + 1 };
  assert.equal(pastLine(s, 'defense', backfield), false, 'still in the backfield');
  assert.equal(pastLine(s, 'defense', downfield), true);
  assert.equal(pastLine(s, 'offense', downfield), false, 'the other way round');
});

test('group mates are the teammates who play the same position', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.deepEqual(
    groupMates(s, getPlayer(s, 'd-nt')).map((p) => p.id),
    ['d-nt', 'd-dt1', 'd-dt2'],
    'himself included, in formation order',
  );
  assert.deepEqual(groupMates(s, getPlayer(s, 'd-lb')).map((p) => p.id), ['d-lb']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/game/defense.test.js`
Expected: FAIL — `Cannot find module '.../lib/game/defense.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/game/defense.js`:

```js
/**
 * Assignment defense: the computer's second brain (`state.aiLevel === 'smart'`).
 *
 * Where ai.js's pursuit brain sends everyone at the ball, this one gives each
 * defender a job derived from where he is standing. Three functions do the
 * work, one per position — rushLineman, flowLinebacker, coverBack — and
 * smartOrder picks between them.
 *
 * Everything here is PURE: it reads `state` and returns orders. ai.js is the
 * only thing that writes them, which is what keeps the computer's plans out of
 * the state (and so off the screen) until the turn actually runs.
 *
 * Positions are read off the FIELD, not off role names. The contain side of a
 * lineman comes from where his own line is standing; the deep man is whoever is
 * aligned deepest; a "receiver" is anyone who can run with a defensive back.
 * A four-man front, an unbalanced one, or a role this file has never heard of
 * all still get coached.
 */
import { fieldPos } from './view.js';

/**
 * Role → position. Written as a table rather than as a test on the role string
 * so adding an end or a nickel back is one line here. Anything unlisted is
 * coached as a linebacker: the generalist's job — flow to the ball with
 * leverage — is the least wrong thing to do with a player you cannot place.
 */
const GROUPS = {
  NT: 'line', DT: 'line', DE: 'line',
  LB: 'backer', MLB: 'backer', OLB: 'backer',
  CB: 'back', S: 'back', FS: 'back', SS: 'back',
};

export function positionGroup(player) {
  return GROUPS[player.role] ?? 'backer';
}

/**
 * Which way along y this team's goal lies — the direction it is defending, and
 * so the direction "goal side" and "deep" mean for every function below. The
 * offense drives at +y (view.js: the goal line is yard 10, the backfield is
 * negative), so the defense protects +y and the offense protects -y.
 */
export function defendDir(team) {
  return team === 'offense' ? -1 : 1;
}

/** The line of scrimmage in SVG y. */
export function losY(state) {
  return fieldPos(0, state.losYard).y;
}

/** Whether `point` has got past the line, from `team`'s point of view. */
export function pastLine(state, team, point) {
  const dir = defendDir(team);
  return dir > 0 ? point.y > losY(state) : point.y < losY(state);
}

/**
 * The teammates playing the same position as `player`, himself included, in
 * `state.players` order. Contain assignments are shared out among these, so
 * this is what makes "the left edge rusher" a fact about the front rather than
 * a fact about an id.
 */
export function groupMates(state, player) {
  const group = positionGroup(player);
  return state.players.filter(
    (p) => p.team === player.team && positionGroup(p) === group,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/game/defense.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, nothing else disturbed.

- [ ] **Step 6: Commit**

```bash
git add lib/game/defense.js test/game/defense.test.js
git commit -m "feat: defensive position groups and the geometry they are read from"
```

---

### Task 2: Pursuit angles — intercept and leverage

The two pieces of geometry all three positions share. `interceptPoint` replaces
the fixed one-second lead with the point both men actually reach at the same
instant; `leverageAim` is the rule that a defender who is in front of the
carrier stays in front of him.

**Files:**
- Modify: `lib/game/constants.js` (append a new block at the end)
- Modify: `lib/game/defense.js`
- Test: `test/game/defense.test.js`

**Interfaces:**
- Consumes: `positionGroup`, `defendDir` (Task 1); `maxSpeed` from
  `lib/game/modes.js`; `add`, `sub`, `scale`, `dot`, `len`, `dist` from
  `lib/game/vec.js`.
- Produces:
  - `interceptPoint(pursuer, target) -> {x, y}`
  - `leverageAim(defender, aim, target) -> {x, y}`
  - constants `AI_INTERCEPT_MAX_SECONDS`, `AI_ATTACK_UNITS`,
    `AI_LEVERAGE_CUSHION`

- [ ] **Step 1: Write the failing test**

Append to `test/game/defense.test.js`, and extend the import from
`../../lib/game/defense.js` with `interceptPoint, leverageAim`:

```js
test('a standing man is intercepted where he stands', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.deepEqual(
    interceptPoint(getPlayer(s, 'd-lb'), getPlayer(s, 'o-qb')),
    getPlayer(s, 'o-qb').pos,
  );
});

test('a moving man is intercepted where the two of them arrive together', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const cb = getPlayer(s, 'd-cb1');
  const qb = getPlayer(s, 'o-qb');
  cb.pos = { x: 135, y: 100 };          // a skill player: 60 units/s
  qb.pos = { x: 135, y: 130 };          // 30 units away, running away at 30
  qb.vel = { x: 0, y: 30 };
  // One second: the carrier reaches y 160 and so does the corner. Solved, not
  // guessed — the old brain would have aimed at a flat one-second lead here
  // and been right only by coincidence.
  assert.deepEqual(interceptPoint(cb, qb), { x: 135, y: 160 });
});

test('a man who cannot be caught is chased on a capped lead instead', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const cb = getPlayer(s, 'd-cb1');
  const qb = getPlayer(s, 'o-qb');
  cb.pos = { x: 135, y: 100 };
  qb.pos = { x: 135, y: 130 };
  qb.vel = { x: 0, y: 200 };            // faster than anybody, straight away
  // No solution exists, so he falls back to the time it takes to cover the gap
  // he can see: 30 / 60 = half a second of the runner's velocity.
  assert.deepEqual(interceptPoint(cb, qb), { x: 135, y: 230 });
});

test('leverage holds an aim point on the goal side of the man', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const lb = getPlayer(s, 'd-lb');      // (135, 100)
  const qb = getPlayer(s, 'o-qb');      // (135, 70) — 30 units away
  assert.deepEqual(
    leverageAim(lb, { x: 140, y: 70 }, qb), { x: 140, y: 74 },
    'aiming level with him would let him run straight past',
  );
  assert.deepEqual(
    leverageAim(lb, { x: 140, y: 90 }, qb), { x: 140, y: 90 },
    'an aim already goal-side of him is left alone',
  );
});

test('leverage is off once he is close enough to go and get him', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const lb = getPlayer(s, 'd-lb');
  const qb = getPlayer(s, 'o-qb');
  lb.pos = { x: 135, y: 80 };           // 10 units off him
  assert.deepEqual(leverageAim(lb, { x: 140, y: 70 }, qb), { x: 140, y: 70 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/game/defense.test.js`
Expected: FAIL — `interceptPoint is not a function` (the named import is
undefined).

- [ ] **Step 3: Add the constants**

Append to `lib/game/constants.js`:

```js
// --- the computer's assignment defense (aiLevel: 'smart') ---
// The pursuit brain aims at a lead point; the assignment brain solves the
// actual intercept — the spot on the carrier's path that both men reach at the
// same instant. When there is no such spot (the carrier is faster and running
// away) it falls back to a lead, and this caps both. Longer than
// AI_LEAD_MAX_SECONDS because a solved intercept stays meaningful much further
// out than a guessed lead does.
export const AI_INTERCEPT_MAX_SECONDS = 2;
// Inside this many units of the carrier a defender stops managing leverage and
// contain and simply attacks the man. Deliberately a shade wider than
// AI_BREAKDOWN_UNITS (11), so he gives up the angle a moment before he breaks
// down into the stance: the two decisions are the same decision.
export const AI_ATTACK_UNITS = 12;
// How far on the goal side of the carrier a pursuing defender holds his aim
// point while he is still managing leverage. About a yard — enough that the
// carrier cannot simply run through the spot the defender was aiming at.
export const AI_LEVERAGE_CUSHION = 4;
```

- [ ] **Step 4: Write the implementation**

Add to `lib/game/defense.js` — extend the imports and append the functions:

```js
import { add, sub, scale, dot, len, dist } from './vec.js';
import { maxSpeed } from './modes.js';
import {
  AI_INTERCEPT_MAX_SECONDS, AI_ATTACK_UNITS, AI_LEVERAGE_CUSHION,
} from './constants.js';
```

```js
/**
 * Where `pursuer` should run to meet `target`: the point on the target's
 * current path that both of them reach at the same instant.
 *
 * Solve |d + v.t| = s.t for the earliest positive t, where d is the offset to
 * the target, v his velocity and s the pursuer's top speed. Squaring gives
 * (|v|^2 - s^2).t^2 + 2(d.v).t + |d|^2 = 0, an ordinary quadratic. The linear
 * case (a target running at exactly the pursuer's speed) is solved separately,
 * because dividing by a zero leading coefficient is not a rounding error.
 *
 * A target who is faster and running away has no solution at all: no root is
 * positive, and there is no angle that catches him. Then — and only then — this
 * degrades to the pursuit brain's answer, a lead over the time it takes to
 * cover the gap as it stands, which is the best available "close the distance"
 * heading. Either way the lead time is capped, so one breakaway cannot fling a
 * defender off the field.
 */
export function interceptPoint(pursuer, target) {
  const s = maxSpeed(pursuer);
  const d = sub(target.pos, pursuer.pos);
  const v = target.vel;
  const a = dot(v, v) - s * s;
  const b = 2 * dot(d, v);
  const c = dot(d, d);

  let t = null;
  if (Math.abs(a) < 1e-9) {
    if (b < 0) t = -c / b; // b >= 0 means he is not closing: no meeting point
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const roots = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((r) => r > 0);
      if (roots.length) t = Math.min(...roots);
    }
  }
  if (t === null) t = len(d) / s;
  return add(target.pos, scale(v, Math.min(t, AI_INTERCEPT_MAX_SECONDS)));
}

/**
 * Hold an aim point on the goal side of the man being chased.
 *
 * A pursuit angle that runs level with the carrier is an angle he runs straight
 * through: by the time the defender arrives the carrier is a body-width past
 * the spot. So while a defender is still closing, his aim is pushed at least
 * AI_LEVERAGE_CUSHION toward the goal he is defending — he takes the angle
 * that arrives in front.
 *
 * Inside AI_ATTACK_UNITS this stops: at contact range, keeping a cushion means
 * never making the tackle. Leverage is how you get there, not what you do when
 * you arrive.
 *
 * Only the goal-ward component is touched. Across the field the aim is
 * whatever the caller worked out, which is what lets rushLineman layer contain
 * on top of this without the two fighting each other.
 */
export function leverageAim(defender, aim, target) {
  if (dist(defender.pos, target.pos) <= AI_ATTACK_UNITS) return aim;
  const dir = defendDir(defender.team);
  const floor = target.pos.y + dir * AI_LEVERAGE_CUSHION;
  return { x: aim.x, y: dir > 0 ? Math.max(aim.y, floor) : Math.min(aim.y, floor) };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- test/game/defense.test.js`
Expected: PASS, 11 tests.

Then: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/game/constants.js lib/game/defense.js test/game/defense.test.js
git commit -m "feat: solved pursuit angles and goal-side leverage"
```

---

### Task 3: The lineman — rush with contain

The first of the three position functions. A lineman rushes the ball like
everyone else, but the ones on the edges of the front never give up their side
of it, so the pile cannot be run around.

**Files:**
- Modify: `lib/game/constants.js`
- Modify: `lib/game/defense.js`
- Test: `test/game/defense.test.js`

**Interfaces:**
- Consumes: `groupMates`, `interceptPoint`, `leverageAim`, `AI_ATTACK_UNITS`;
  `carrier` from `lib/game/state.js`.
- Produces:
  - `containSide(state, player) -> -1 | 0 | 1`
  - `rushLineman(state, player) -> { aim: {x,y}, cover: null }`
  - constant `AI_CONTAIN_UNITS`
- The `{ aim, cover }` shape is the **order** every position function returns
  and Task 6 consumes: exactly one of the two is set, the other is `null`.

- [ ] **Step 1: Write the failing test**

Append to `test/game/defense.test.js`, extending the import with
`containSide, rushLineman`:

```js
test('the front works out its own edges from where it is standing', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(containSide(s, getPlayer(s, 'd-dt1')), -1, 'left edge');
  assert.equal(containSide(s, getPlayer(s, 'd-nt')), 0, 'straight down the middle');
  assert.equal(containSide(s, getPlayer(s, 'd-dt2')), 1, 'right edge');
});

test('a lone lineman contains nothing — he just goes', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  s.players = s.players.filter((p) => p.id !== 'd-dt1' && p.id !== 'd-dt2');
  assert.equal(containSide(s, getPlayer(s, 'd-nt')), 0);
});

test('an edge rusher keeps his side of the ball', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  // QB (135, 70) standing still; the right tackle is at (144.375, 88.75), well
  // outside attack range, so both leverage and contain are live.
  assert.deepEqual(rushLineman(s, getPlayer(s, 'd-dt2')),
    { aim: { x: 141, y: 74 }, cover: null }, 'stays 6 units to the right of him');
  assert.deepEqual(rushLineman(s, getPlayer(s, 'd-dt1')),
    { aim: { x: 129, y: 74 }, cover: null }, 'and 6 to the left');
  assert.deepEqual(rushLineman(s, getPlayer(s, 'd-nt')),
    { aim: { x: 135, y: 74 }, cover: null }, 'the middle man goes straight at him');
});

test('contain is given up at contact range — then he attacks the man', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const dt = getPlayer(s, 'd-dt2');
  dt.pos = { x: 140, y: 76 };   // ~7.8 units off the QB, inside AI_ATTACK_UNITS
  assert.deepEqual(rushLineman(s, dt), { aim: { x: 135, y: 70 }, cover: null });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/game/defense.test.js`
Expected: FAIL — `containSide is not a function`.

- [ ] **Step 3: Add the constant**

Append to the assignment-defense block in `lib/game/constants.js`:

```js
// How far outside the ball a containing rusher keeps himself: 6 units, about a
// yard and a half. Enough that a carrier who wants that edge has to run round
// him rather than through the gap he left, and not so wide that the front
// stops being a front.
export const AI_CONTAIN_UNITS = 6;
```

- [ ] **Step 4: Write the implementation**

Add to `lib/game/defense.js` — extend the imports with `carrier` from
`./state.js` and `AI_CONTAIN_UNITS` from `./constants.js`, then append:

```js
/**
 * Which edge of the front this lineman is responsible for: -1 for the left,
 * +1 for the right, 0 for whoever is nearest the middle of it.
 *
 * Derived from where his own line is actually standing, not from a role name,
 * so a four-man front, an unbalanced one, or a line that has drifted during the
 * play still yields exactly one containing rusher on each edge and one man free
 * up the middle. The middle man is whoever is closest to the midpoint of the
 * front's own span, with ties going to the earlier man in formation order —
 * deterministic, because nothing the computer decides may depend on iteration
 * luck.
 */
export function containSide(state, player) {
  const line = groupMates(state, player);
  const xs = line.map((p) => p.pos.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const middle = line.reduce((a, b) =>
    Math.abs(b.pos.x - mid) < Math.abs(a.pos.x - mid) ? b : a);
  if (middle.id === player.id) return 0;
  return player.pos.x < mid ? -1 : 1;
}

/**
 * A lineman rushes the ball — and the edge rushers never let it outside them.
 *
 * The old brain sent all three linemen at one point, which is why a carrier who
 * simply stepped around the pile was gone. Here each edge rusher's aim is held
 * at least AI_CONTAIN_UNITS to his own side of the carrier, so the pocket has
 * walls: the middle is the free rusher's, and both edges cost the carrier a
 * change of direction.
 *
 * Contain, like leverage, is for the approach. Inside AI_ATTACK_UNITS he takes
 * the shortest line to the man and hits him.
 *
 * Requires an opposing carrier — smartOrder is what guarantees one.
 */
export function rushLineman(state, player) {
  const car = carrier(state);
  const aim = leverageAim(player, interceptPoint(player, car), car);
  if (dist(player.pos, car.pos) <= AI_ATTACK_UNITS) return { aim, cover: null };
  const side = containSide(state, player);
  if (side === 0) return { aim, cover: null };
  const edge = car.pos.x + side * AI_CONTAIN_UNITS;
  const x = side < 0 ? Math.min(aim.x, edge) : Math.max(aim.x, edge);
  return { aim: { x, y: aim.y }, cover: null };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- test/game/defense.test.js`
Expected: PASS, 15 tests.

Then: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/game/constants.js lib/game/defense.js test/game/defense.test.js
git commit -m "feat: linemen rush their edge instead of all converging on the ball"
```

---

### Task 4: The linebacker — mirror, then fill

The second position function. A linebacker who blitzes on every turn is a
linebacker who is out of the play on every handoff. This one holds his depth and
matches the ball across the field until the run declares.

**Files:**
- Modify: `lib/game/constants.js`
- Modify: `lib/game/defense.js`
- Test: `test/game/defense.test.js`

**Interfaces:**
- Consumes: `losY`, `defendDir`, `interceptPoint`, `leverageAim`, `carrier`.
- Produces:
  - `flowLinebacker(state, player) -> { aim: {x,y}, cover: null }`
  - constants `AI_BACKER_DEPTH_UNITS`, `AI_BACKER_TRIGGER_UNITS`

- [ ] **Step 1: Write the failing test**

Append to `test/game/defense.test.js`, extending the import with
`flowLinebacker`:

```js
test('a linebacker holds his depth and mirrors the ball across the field', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  // The QB is 4 yards deep — nowhere near the line — so the backer does not
  // chase him into the backfield. He sits 8 units on his own side of the line
  // and matches him across it. losY is 85, so his depth is 93.
  assert.deepEqual(flowLinebacker(s, getPlayer(s, 'd-lb')),
    { aim: { x: 135, y: 93 }, cover: null });

  getPlayer(s, 'o-qb').pos = { x: 110, y: 70 }; // rolling out to his left
  assert.deepEqual(flowLinebacker(s, getPlayer(s, 'd-lb')),
    { aim: { x: 110, y: 93 }, cover: null }, 'slides with him, same depth');
});

test('a linebacker fills once the carrier threatens the line', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  getPlayer(s, 'o-qb').pos = { x: 135, y: 80 }; // 5 units behind the line
  assert.deepEqual(flowLinebacker(s, getPlayer(s, 'd-lb')),
    { aim: { x: 135, y: 84 }, cover: null }, 'downhill, a cushion goal-side');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/game/defense.test.js`
Expected: FAIL — `flowLinebacker is not a function`.

- [ ] **Step 3: Add the constants**

Append to the assignment-defense block in `lib/game/constants.js`:

```js
// Where a linebacker waits while the run has yet to declare: this many units on
// his own side of the line of scrimmage. About two yards — a run fit, close
// enough to arrive at the hole and deep enough that he is not blocked by the
// front he is standing behind.
export const AI_BACKER_DEPTH_UNITS = 8;
// And when he stops waiting: the carrier coming within this many units of the
// line. About two yards, so a quarterback still setting up 4 yards deep does
// not pull him out of the middle of the field, but a back coming downhill does.
export const AI_BACKER_TRIGGER_UNITS = 8;
```

- [ ] **Step 4: Write the implementation**

Add to `lib/game/defense.js`, extending the constants import with
`AI_BACKER_DEPTH_UNITS, AI_BACKER_TRIGGER_UNITS`:

```js
/**
 * A linebacker reads before he runs.
 *
 * The pursuit brain sends him at the ball wherever it is, which on any handoff
 * or cutback means he has vacated the middle of the field before the run has
 * even started. Instead, while the carrier is still deep in the backfield, he
 * MIRRORS: he holds AI_BACKER_DEPTH_UNITS on his own side of the line and
 * matches the ball across the field, so whichever way the run declares he is
 * already square to it and downhill of nobody.
 *
 * The lateral half of the mirror is the leveraged intercept's x, so he leads
 * the ball across rather than trailing it — a mirror that is one turn late is
 * not a mirror.
 *
 * Once the carrier is inside AI_BACKER_TRIGGER_UNITS of the line he FILLS:
 * straight to the pursuit angle, cushion and all. (A carrier who is already
 * past the line never reaches this function at all — smartOrder converges the
 * whole defense before dispatching.)
 *
 * Requires an opposing carrier — smartOrder is what guarantees one.
 */
export function flowLinebacker(state, player) {
  const car = carrier(state);
  const aim = leverageAim(player, interceptPoint(player, car), car);
  const dir = defendDir(player.team);
  const gap = (car.pos.y - losY(state)) * dir; // negative while he is behind it
  if (gap >= -AI_BACKER_TRIGGER_UNITS) return { aim, cover: null };
  return { aim: { x: aim.x, y: losY(state) + dir * AI_BACKER_DEPTH_UNITS }, cover: null };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- test/game/defense.test.js`
Expected: PASS, 17 tests.

Then: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/game/constants.js lib/game/defense.js test/game/defense.test.js
git commit -m "feat: the linebacker mirrors the ball at depth and fills when the run declares"
```

---

### Task 5: The defensive back — man coverage with help over the top

The third position function, and the one that uses the human's own machinery:
an AI corner takes a real `state.cover` assignment, which `cover.js` re-aims
every sub-step.

**Files:**
- Modify: `lib/game/constants.js`
- Modify: `lib/game/defense.js`
- Test: `test/game/defense.test.js`

**Interfaces:**
- Consumes: `groupMates`, `defendDir`, `positionGroup`; `carrier`, `ballPos`
  from `lib/game/state.js`; `maxSpeed` from `lib/game/modes.js`.
- Produces:
  - `deepestThreat(state, team) -> player | null`
  - `deepMan(state, team) -> player | null`
  - `deepAim(state, player) -> {x, y}`
  - `coverAssignments(state, team) -> Map<defenderId, receiverId>`
  - `coverBack(state, player) -> { aim: {x,y}, cover: null } | { aim: null, cover: id }`
  - constants `AI_DEEP_CUSHION_UNITS`, `AI_THREAT_SPEED_RATIO`

- [ ] **Step 1: Write the failing test**

Append to `test/game/defense.test.js`, extending the import with
`deepestThreat, deepMan, deepAim, coverAssignments, coverBack`, and adding
`import { RADIUS_LINE } from '../../lib/game/constants.js';` at the top of the
file:

```js
test('the deep man is whoever lines up deepest, not whoever is called safety', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(deepMan(s, 'defense').id, 'd-s');
  getPlayer(s, 'd-cb2').pos = { x: 191.25, y: 200 }; // now HE is the last man back
  assert.equal(deepMan(s, 'defense').id, 'd-cb2');
});

test('the deepest threat is the opponent nearest the goal being defended', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(deepestThreat(s, 'defense').id, 'o-c', 'ties go to formation order');
  getPlayer(s, 'o-wr2').pos = { x: 191.25, y: 100 };
  assert.equal(deepestThreat(s, 'defense').id, 'o-wr2');
});

test('the deep man plays behind the deepest threat and the ball, splitting them', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  // Deepest opponent is the line at y 81.25; the ball is the QB at y 70.
  assert.deepEqual(deepAim(s, getPlayer(s, 'd-s')), { x: 135, y: 101.25 });

  getPlayer(s, 'o-wr2').pos = { x: 191.25, y: 100 }; // a receiver gets behind him
  assert.deepEqual(deepAim(s, getPlayer(s, 'd-s')), { x: 163.125, y: 120 },
    'he goes and gets on top of him');
});

test('the corners take the receivers; the deep man takes nobody', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const map = coverAssignments(s, 'defense');
  assert.equal(map.get('d-cb1'), 'o-wr1');
  assert.equal(map.get('d-cb2'), 'o-wr2');
  assert.equal(map.has('d-s'), false, 'the last man back is free');
  assert.equal(map.size, 2);
});

test('a defensive back does not cover a man who cannot run with him', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  for (const id of ['o-wr1', 'o-wr2', 'o-rb']) getPlayer(s, id).radius = RADIUS_LINE;
  assert.equal(coverAssignments(s, 'defense').size, 0, 'nobody left worth covering');
  const order = coverBack(s, getPlayer(s, 'd-cb1'));
  assert.equal(order.cover, null);
  assert.deepEqual(order.aim, deepAim(s, getPlayer(s, 'd-cb1')),
    'an unassigned back plays help instead');
});

test('coverBack hands out a man to cover and a spot to the free man', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.deepEqual(coverBack(s, getPlayer(s, 'd-cb1')), { aim: null, cover: 'o-wr1' });
  assert.deepEqual(coverBack(s, getPlayer(s, 'd-s')),
    { aim: { x: 135, y: 101.25 }, cover: null });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/game/defense.test.js`
Expected: FAIL — `deepMan is not a function`.

- [ ] **Step 3: Add the constants**

Append to the assignment-defense block in `lib/game/constants.js`:

```js
// How far on the goal side of the deepest threat the free defensive back
// plays. 20 units is about five and a third yards — on a field whose whole
// depth from the line to the goal is ten yards, that is as "deep" as deep
// gets. Not re-derived against a longer field; a playtest number.
export const AI_DEEP_CUSHION_UNITS = 20;
// Who counts as a receiver worth covering: an opponent who can run at least
// this fraction of the covering back's own top speed. It is the one honest
// generalization of "receiver" available — the game has no eligibility rule,
// but a lineman still cannot run with a corner. At 0.9 a corner (60 units/s)
// covers anyone above 54, which is every skill player and no lineman.
export const AI_THREAT_SPEED_RATIO = 0.9;
```

- [ ] **Step 4: Write the implementation**

Add to `lib/game/defense.js`, extending the imports with `ballPos` from
`./state.js` and `AI_DEEP_CUSHION_UNITS, AI_THREAT_SPEED_RATIO` from
`./constants.js`:

```js
/** How deep along the defended direction a point is. Bigger is nearer the goal. */
function depth(team, point) {
  return point.y * defendDir(team);
}

/**
 * The opponent who has got nearest the goal this team is defending — the man
 * the free defender has to stay on top of. Ties go to the earlier man in
 * formation order, which matters only at the snap, when a whole offensive line
 * is level.
 */
export function deepestThreat(state, team) {
  const them = state.players.filter((p) => p.team !== team);
  if (!them.length) return null;
  return them.reduce((a, b) => (depth(team, b.pos) > depth(team, a.pos) ? b : a));
}

/**
 * The last man back: whichever defensive back is aligned deepest. Read off the
 * field rather than off the role name, so a corner who has dropped behind the
 * safety inherits the job — and a secondary of any size still leaves exactly
 * one man free.
 */
export function deepMan(state, team) {
  const backs = state.players.filter(
    (p) => p.team === team && positionGroup(p) === 'back',
  );
  if (!backs.length) return null;
  return backs.reduce((a, b) => (depth(team, b.pos) > depth(team, a.pos) ? b : a));
}

/**
 * Where the free defender plays: on top of both the deepest receiver and the
 * ball, splitting the difference between them across the field.
 *
 * His whole job is that nothing gets behind him, so his depth is a cushion past
 * whichever of the two is deeper — never an average, which would let a receiver
 * running past him drag him only halfway.
 */
export function deepAim(state, player) {
  const dir = defendDir(player.team);
  const threat = deepestThreat(state, player.team);
  const bp = ballPos(state);
  const anchor = threat ? threat.pos : bp;
  const back = dir > 0 ? Math.max(anchor.y, bp.y) : Math.min(anchor.y, bp.y);
  return { x: (anchor.x + bp.x) / 2, y: back + dir * AI_DEEP_CUSHION_UNITS };
}

/**
 * Who has whom. Every defensive back except the free man takes one opposing
 * receiver, closest pair first.
 *
 * Pairs are sorted by distance and claimed greedily, which is what stops both
 * corners chasing the same man and stops either of them crossing the formation
 * to take one. Ties break on ids, so the assignment is a function of the
 * position of the players and nothing else — no iteration luck, no dice.
 *
 * A "receiver" is anyone the covering back cannot comfortably outrun (see
 * AI_THREAT_SPEED_RATIO). The carrier is never covered — he is tackled, which
 * is somebody else's assignment.
 */
export function coverAssignments(state, team) {
  const car = carrier(state);
  const free = deepMan(state, team);
  const takers = state.players.filter(
    (p) => p.team === team && positionGroup(p) === 'back' && p.id !== free?.id,
  );
  const them = state.players.filter((p) => p.team !== team && p.id !== car?.id);

  const pairs = [];
  for (const d of takers) {
    for (const r of them) {
      if (maxSpeed(r) < maxSpeed(d) * AI_THREAT_SPEED_RATIO) continue;
      pairs.push({ d: d.id, r: r.id, gap: dist(d.pos, r.pos) });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || a.d.localeCompare(b.d) || a.r.localeCompare(b.r));

  const map = new Map();
  const claimed = new Set();
  for (const { d, r } of pairs) {
    if (map.has(d) || claimed.has(r)) continue;
    map.set(d, r);
    claimed.add(r);
  }
  return map;
}

/**
 * A defensive back covers his man, or plays help if he has not got one.
 *
 * The cover order is the real thing — the same `state.cover` a human issues by
 * dragging one of his players onto one of yours — so cover.js re-aims it every
 * sub-step and it is worth the same mass and grab reach. A receiver who cuts
 * mid-turn is therefore covered, not left behind, which the pursuit brain's
 * once-a-turn arrow could never manage.
 *
 * The free man, and anyone with nobody worth covering, plays deepAim instead.
 */
export function coverBack(state, player) {
  const assigned = coverAssignments(state, player.team).get(player.id);
  if (assigned) return { aim: null, cover: assigned };
  return { aim: deepAim(state, player), cover: null };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- test/game/defense.test.js`
Expected: PASS, 23 tests.

Then: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/game/constants.js lib/game/defense.js test/game/defense.test.js
git commit -m "feat: the secondary plays man coverage with a free man over the top"
```

---

### Task 6: The dispatcher — assignments, and when they stop

The three position functions are for the moment before the play breaks.
`smartOrder` is what decides that moment is over.

**Files:**
- Modify: `lib/game/defense.js`
- Test: `test/game/defense.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1-5; `ballPos`, `carrier` from
  `lib/game/state.js`.
- Produces:
  - `smartOrder(state, player) -> { aim, cover }`
  - `smartOrders(state, team) -> Array<{ id, aim, cover }>` — pure, in
    `state.players` order, skipping anyone with nothing to do

- [ ] **Step 1: Write the failing test**

Append to `test/game/defense.test.js`, extending the import with
`smartOrder, smartOrders`:

```js
test('a loose ball is a footrace — nobody keeps an assignment', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  s.ball = { carrierId: null, pos: { x: 135, y: 100 }, vel: { x: 0, y: 0 }, loose: 0 };
  for (const id of ['d-nt', 'd-lb', 'd-cb1', 'd-s']) {
    assert.deepEqual(smartOrder(s, getPlayer(s, id)),
      { aim: { x: 135, y: 100 }, cover: null }, id);
  }
});

test('once the carrier is past the line everybody converges on him', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  getPlayer(s, 'o-qb').pos = { x: 135, y: 95 }; // 10 units past the line
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-dt2')),
    { aim: { x: 135, y: 95 }, cover: null }, 'no contain: he is inside attack range');
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-cb1')),
    { aim: { x: 135, y: 99 }, cover: null }, 'the corner leaves his man to make the tackle');
});

test('behind the line, each position does its own job', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-dt2')), rushLineman(s, getPlayer(s, 'd-dt2')));
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-lb')), flowLinebacker(s, getPlayer(s, 'd-lb')));
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-cb1')), coverBack(s, getPlayer(s, 'd-cb1')));
});

test('smartOrders covers the whole team and writes nothing into the state', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const orders = smartOrders(s, 'defense');
  assert.deepEqual(orders.map((o) => o.id),
    ['d-nt', 'd-dt1', 'd-dt2', 'd-cb1', 'd-cb2', 'd-lb', 'd-s']);
  assert.equal(orders.find((o) => o.id === 'd-cb1').cover, 'o-wr1');
  assert.ok(s.players.every((p) => p.plan === null && p.cover === null),
    'pure: nothing was written');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/game/defense.test.js`
Expected: FAIL — `smartOrder is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `lib/game/defense.js`:

```js
/** An order that means "nothing to do": the caller leaves him as he is. */
const NO_ORDER = { aim: null, cover: null };

/**
 * One player's job this turn.
 *
 * Assignments are what you play BEFORE the play breaks. Three things end them,
 * and they are checked in this order:
 *
 *   1. No ball to defend at all — nothing to do.
 *   2. A loose ball is a footrace: everybody sprints at it, exactly as the
 *      pursuit brain does, because possession beats every assignment there is.
 *   3. The carrier is past the line, or on this player's own team: assignments
 *      are over and the whole defense converges on the ball with leverage.
 *      Nobody stays in coverage while a man runs at the goal line.
 *
 * Only when none of those hold does he play his position.
 */
export function smartOrder(state, player) {
  const bp = ballPos(state);
  if (!bp) return NO_ORDER;
  const car = carrier(state);
  if (!car) return { aim: { ...bp }, cover: null };
  if (car.team === player.team) return { aim: { ...bp }, cover: null };
  if (pastLine(state, player.team, car.pos)) {
    return { aim: leverageAim(player, interceptPoint(player, car), car), cover: null };
  }
  switch (positionGroup(player)) {
    case 'line': return rushLineman(state, player);
    case 'back': return coverBack(state, player);
    default: return flowLinebacker(state, player);
  }
}

/**
 * Every order for one team, in formation order. Pure — nothing in `state`
 * moves, which is what lets ai.js decide when (and whether) to apply them, the
 * same contract defensePlans keeps.
 */
export function smartOrders(state, team) {
  return state.players
    .filter((p) => p.team === team)
    .map((p) => ({ id: p.id, ...smartOrder(state, p) }))
    .filter((o) => o.aim !== null || o.cover !== null);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- test/game/defense.test.js`
Expected: PASS, 27 tests.

Then: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/game/defense.js test/game/defense.test.js
git commit -m "feat: assignments end when the ball comes loose or crosses the line"
```

---

### Task 7: Wire it in as a second AI level

`ai.js` becomes a dispatcher over two brains. The new state field is
`aiLevel`, defaulting to `'pursuit'` so nothing in the library changes
behaviour on its own.

**Files:**
- Modify: `lib/game/state.js:createGame`
- Modify: `lib/game/ai.js`
- Test: `test/game/state.test.js`, `test/game/ai.test.js`

**Interfaces:**
- Consumes: `smartOrders` from `lib/game/defense.js`; `setCover`, `clearCover`
  from `lib/game/cover.js`.
- Produces:
  - `state.aiLevel: 'pursuit' | 'smart'`
  - `createGame({ seed, ai, aiLevel })`
  - `coachSmartDefense(state)` in `ai.js`
  - `clearAiPlans` now clears cover as well as the plan

- [ ] **Step 1: Write the failing tests**

Append to `test/game/state.test.js`:

```js
test('the AI level defaults to the pursuit brain and can be asked for smart', () => {
  assert.equal(createGame({ seed: 1 }).aiLevel, 'pursuit');
  assert.equal(createGame({ seed: 1, ai: 'defense' }).aiLevel, 'pursuit');
  assert.equal(createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' }).aiLevel, 'smart');
});
```

Append to `test/game/ai.test.js`, extending the import from
`../../lib/game/ai.js` with `coachSmartDefense`:

```js
test('the smart brain puts the corners on the receivers, arrows and all', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  coachAi(s);
  const cb = getPlayer(s, 'd-cb1');
  assert.equal(cb.cover, 'o-wr1');
  assert.ok(cb.plan !== null, 'a cover order is still a plan');
  assert.ok(s.players.filter((p) => p.team === 'defense').every((p) => p.plan !== null),
    'everybody got a job');
});

test('the smart brain sends the linebacker to his depth, not at the quarterback', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  coachAi(s);
  // He is at (135, 100) and his mirror spot is (135, 93): straight up the
  // field toward the line, and no lateral drift.
  assert.deepEqual(getPlayer(s, 'd-lb').plan.dir, { x: 0, y: -1 });
});

test('the pursuit brain is untouched and hands out no coverage', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  coachAi(s);
  assert.ok(s.players.every((p) => p.cover === null), 'the old brain covers nobody');
  assert.deepEqual(
    s.players.filter((p) => p.team === 'defense').map((p) => p.plan.dir),
    defensePlans(s).map((pl) => pl.dir),
  );
});

test('the computer\'s coverage does not outlive the turn either', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  coachSmartDefense(s);
  assert.ok(s.players.some((p) => p.cover !== null), 'somebody was covering');
  clearAiPlans(s);
  assert.ok(s.players.filter((p) => p.team === 'defense')
    .every((p) => p.plan === null && p.cover === null));
});

test('a whole smart turn runs, and leaves nothing of the computer behind', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  runTurn(s, mulberry32(1));
  assert.ok(s.players.filter((p) => p.team === 'defense')
    .every((p) => p.plan === null && p.cover === null),
  'no plan and no halo for the human to read');
});
```

Add to that file's imports:

```js
import { runTurn } from '../../lib/game/turn.js';
import { mulberry32 } from '../../lib/game/rng.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/game/ai.test.js test/game/state.test.js`
Expected: FAIL — `coachSmartDefense is not a function`, and the `aiLevel`
assertions read `undefined`.

- [ ] **Step 3: Add `aiLevel` to the state**

In `lib/game/state.js`, replace `createGame`'s signature line and add the field.
Change:

```js
export function createGame({ seed = 1, ai = null } = {}) {
  return {
    seed,
    aiTeam: ai,
```

to:

```js
export function createGame({ seed = 1, ai = null, aiLevel = 'pursuit' } = {}) {
  return {
    seed,
    aiTeam: ai,
    // Which brain coaches `aiTeam`: 'pursuit' (ai.js — everyone at the ball)
    // or 'smart' (defense.js — assignment football). The default is the older
    // one so the library's semantics, and every test written against them,
    // stay exactly as they were; app/main.js is what opts the played game into
    // 'smart'.
    aiLevel,
```

Extend the doc comment above `createGame` with a sentence naming `aiLevel`:

```js
 * `aiLevel` names which brain coaches that team — see the field's own comment.
```

- [ ] **Step 4: Dispatch, and clear coverage**

In `lib/game/ai.js`, add the imports:

```js
import { smartOrders } from './defense.js';
import { setCover, clearCover } from './cover.js';
```

Replace `coachAi` and `clearAiPlans` with:

```js
/**
 * The assignment brain's orders, written into `state`.
 *
 * Cover orders go through cover.js's setCover, so the computer's man coverage
 * IS the human's cover order: re-aimed at the covered man every sub-step, and
 * worth the same COVER_MASS_MULT and COVER_GRAB_REACH. Everything else becomes
 * an ordinary full-throttle plan pointed at the order's aim.
 *
 * clearCover runs on anyone not covering, because setPlan clears cover but the
 * two `continue` guards below do not reach it — a stale assignment from last
 * turn must not keep steering a man this turn.
 */
export function coachSmartDefense(state) {
  for (const { id, aim, cover } of smartOrders(state, state.aiTeam)) {
    if (cover) { setCover(state, id, cover); continue; }
    clearCover(state, id);
    if (!aim) continue;
    const to = sub(aim, getPlayer(state, id).pos);
    if (len(to) === 0) continue; // standing on the aim point: no direction to run
    setPlan(state, id, norm(to), 1);
  }
}

/** Everything the computer decides for one turn, written into `state`. */
export function coachAi(state) {
  if (!state.aiTeam) return;
  applyAiModes(state);
  if (state.aiLevel === 'smart') {
    coachSmartDefense(state);
    return;
  }
  for (const { id, dir, throttle } of defensePlans(state)) setPlan(state, id, dir, throttle);
}

/**
 * Wipe the computer's arrows — and its coverage. runTurn calls this at the end
 * of every turn, so that no plan of the computer's survives into a planning
 * phase where renderArrows would happily draw it for the human to read, and no
 * assignment survives into a turn where the computer has been switched off, or
 * has read the field again and would rather cover somebody else.
 */
export function clearAiPlans(state) {
  for (const p of aiPlayers(state)) {
    clearPlan(state, p.id);
    clearCover(state, p.id);
  }
}
```

Extend `ai.js`'s existing imports to cover what `coachSmartDefense` uses:

```js
import { ballPos, carrier, setPlan, setMode, clearPlan, getPlayer } from './state.js';
```

(`sub`, `len`, `norm` are already imported from `./vec.js`; `add` and `scale`
stay for `pursuitTarget`.)

Update the module's header comment — its first paragraph now describes only one
of two brains:

```js
/**
 * The computer opponent. Two brains, picked by `state.aiLevel`:
 *
 *   'pursuit' — this file. Every player it coaches runs at the ball, at where
 *     the carrier is going rather than where he is.
 *   'smart'   — lib/game/defense.js. Assignment football: the line rushes with
 *     contain, the linebacker mirrors and fills, the secondary plays man with a
 *     free man over the top. This file is still the only writer.
 *
 * Nothing in here rolls dice, so a coached turn is as reproducible as a
 * hand-planned one.
 *
 * turn.js is the only caller. It coaches at the top of the turn and calls
 * clearAiPlans at the bottom, which is the whole trick to keeping the
 * computer's intentions off the human's screen: no plan and no cover order of
 * the computer's ever exists while `phase === 'planning'`, so there is never
 * anything to draw.
 */
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- test/game/ai.test.js test/game/state.test.js`
Expected: PASS.

Then: `npm test`
Expected: PASS — the whole suite, including `integration.test.js`.

- [ ] **Step 6: Commit**

```bash
git add lib/game/state.js lib/game/ai.js test/game/ai.test.js test/game/state.test.js
git commit -m "feat: aiLevel picks between the pursuit brain and assignment defense"
```

---

### Task 8: The third setting on the Defense button

**Files:**
- Modify: `lib/game/ai.js` (the cycle, as pure data)
- Modify: `app/main.js:34,39,74-89,423-435,466`
- Modify: `index.html`
- Modify: `README.md`
- Test: `test/game/ai.test.js`

**Interfaces:**
- Produces:
  - `AI_MODES` — the three settings, in cycle order, each
    `{ ai, level, label, note }`
  - `aiModeIndex(state) -> number`
  - `nextAiMode(state) -> AI_MODES[number]`

- [ ] **Step 1: Write the failing test**

Append to `test/game/ai.test.js`, extending the import with
`AI_MODES, aiModeIndex, nextAiMode`:

```js
test('the Defense button cycles smart, basic, hot-seat, and back', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  assert.equal(aiModeIndex(s), 0);
  assert.equal(AI_MODES[0].label, 'Defense: computer (smart)');

  let next = nextAiMode(s);
  assert.deepEqual([next.ai, next.level], ['defense', 'pursuit']);
  s.aiTeam = next.ai; s.aiLevel = next.level;
  assert.equal(AI_MODES[aiModeIndex(s)].label, 'Defense: computer (basic)');

  next = nextAiMode(s);
  assert.equal(next.ai, null);
  s.aiTeam = next.ai; s.aiLevel = next.level;
  assert.equal(AI_MODES[aiModeIndex(s)].label, 'Defense: you');

  next = nextAiMode(s);
  assert.deepEqual([next.ai, next.level], ['defense', 'smart'], 'round it goes');
});

test('hot-seat reads as hot-seat whatever level it is carrying', () => {
  const s = createGame({ seed: 1 });
  assert.equal(AI_MODES[aiModeIndex(s)].label, 'Defense: you');
  s.aiLevel = 'smart';
  assert.equal(AI_MODES[aiModeIndex(s)].label, 'Defense: you');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/game/ai.test.js`
Expected: FAIL — `aiModeIndex is not a function`.

- [ ] **Step 3: Add the cycle to `ai.js`**

Append to `lib/game/ai.js`:

```js
/**
 * The three settings the Defense button steps through, in cycle order, with
 * the words the board says about each. Kept here rather than in app/main.js so
 * the cycle is testable and there is exactly one place that knows a level named
 * 'smart' exists.
 *
 * Smart is first because that is what a new game starts on: the better defense
 * is the default opponent, and the pursuit brain is the one you drop to.
 */
export const AI_MODES = [
  {
    ai: 'defense',
    level: 'smart',
    label: 'Defense: computer (smart)',
    note: 'The computer plays assignment defense: the line rushes with contain, the linebacker fills, the secondary plays man with help over the top.',
  },
  {
    ai: 'defense',
    level: 'pursuit',
    label: 'Defense: computer (basic)',
    note: 'The computer sends every defender straight at the ball.',
  },
  {
    ai: null,
    level: 'smart',
    label: 'Defense: you',
    note: 'Hot-seat: you coach both teams.',
  },
];

/**
 * Which setting the state is in. Hot-seat is hot-seat whatever `aiLevel` it is
 * carrying, so that stepping out to hot-seat and back returns you to the brain
 * you were playing.
 */
export function aiModeIndex(state) {
  if (!state.aiTeam) return AI_MODES.length - 1;
  return state.aiLevel === 'smart' ? 0 : 1;
}

/** The setting one press of the Defense button moves to. */
export function nextAiMode(state) {
  return AI_MODES[(aiModeIndex(state) + 1) % AI_MODES.length];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/game/ai.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the button**

In `app/main.js`:

Change the import on line 5 to:

```js
import { clearAiPlans, AI_MODES, aiModeIndex, nextAiMode } from '../lib/game/ai.js';
```

Change line 39 to:

```js
let state = createGame({ seed: (Math.random() * 2 ** 31) | 0, ai: 'defense', aiLevel: 'smart' });
```

In `paint()`, replace:

```js
  aiBtn.textContent = state.aiTeam ? 'Defense: computer' : 'Defense: you';
```

with:

```js
  aiBtn.textContent = AI_MODES[aiModeIndex(state)].label;
```

Replace the body of the `aiBtn` click handler:

```js
aiBtn.addEventListener('click', () => {
  closeMenu();
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
});
```

Change the `newBtn` handler's `createGame` call to:

```js
  state = createGame({ seed: (Math.random() * 2 ** 31) | 0, ai: 'defense', aiLevel: 'smart' });
```

- [ ] **Step 6: Fix the button's initial label**

In `index.html`, change:

```html
      <button id="ai">Defense: computer</button>
```

to:

```html
      <button id="ai">Defense: computer (smart)</button>
```

- [ ] **Step 7: Update the README**

In `README.md`, replace the paragraph beginning "**The computer coaches the
defense.**" (lines 28-35) with:

```markdown
**The computer coaches the defense.** You draw arrows for your seven offensive
players; each turn the computer plans the defense and runs it. You never see
what it has planned: no defensive arrows and no coverage marks are ever drawn,
because the computer does not decide until you press **Run Turn**. The
**Defense:** button in the Coaches Menu cycles between three settings.

- **Defense: computer (smart)** — the default. Assignment football. The
  defensive line rushes the ball but the outside rushers keep contain, so the
  pocket has walls and a carrier who wants the edge has to run around somebody.
  The linebacker does not chase into the backfield: he holds his depth a couple
  of yards off the line and mirrors the ball across the field until the run
  declares, then fills. The cornerbacks take the receivers man-to-man — the same
  cover order you give by dragging, re-aimed at their man every fraction of a
  second — and the safety plays free behind everything, so nobody gets over the
  top. All of that is off the moment the ball comes loose or the carrier crosses
  the line: then it is eleven players converging on one, each on the angle that
  arrives in front of him rather than behind.
- **Defense: computer (basic)** — the original brain. Every defender runs
  straight at the ball, leading the carrier rather than chasing where he just
  was. Easier to beat: get one man moving sideways and the whole defense follows
  him.
- **Defense: you** — hot-seat. You coach both teams.

Either computer breaks a defender down into the tackling stance once he is
within range to make the hit.
```

- [ ] **Step 8: Verify**

Run: `npm test`
Expected: PASS, the whole suite.

Then serve and play a down against each setting:

```bash
npm run serve
```

Open `http://localhost:8080/`, and check by eye:

1. The menu button reads **Defense: computer (smart)** on a fresh game.
2. Run a turn with nobody moving. The corners should slide out to the receivers
   rather than at the QB; the linebacker should come up to about two yards off
   the line and stop; the two outside linemen should split around the QB rather
   than stacking on him.
3. No green arrow, dotted line, or halo ever appears on a defender or on one of
   your receivers during a planning phase.
4. Press the button: it reads **Defense: computer (basic)**, and a turn now
   sends all seven straight at the ball. Press again: **Defense: you**, and you
   can drag defenders. Press again: back to smart.
5. Take a handoff wide. The edge rusher on that side should be outside you, and
   the linebacker should be there when you cut back.

- [ ] **Step 9: Commit**

```bash
git add lib/game/ai.js app/main.js index.html README.md test/game/ai.test.js
git commit -m "feat: the Defense button offers a third, smarter computer"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Keep the current AI | Task 7 — `aiLevel: 'pursuit'` is the library default and the dispatcher's fallthrough; `defensePlans` is untouched and its tests still assert on it |
| A third option to choose from | Task 8 — `AI_MODES`, the three-way cycle, the button |
| That third option plays smarter | Tasks 2-6 — solved intercepts, leverage, contain, mirror-and-fill, man coverage, help over the top |
| Study the field positions | Task 1 — `positionGroup` from roles, and every later helper (`containSide`, `deepMan`, `deepestThreat`, the threat-speed test) derived from where players actually are |
| Generalized function: lineman | Task 3 — `rushLineman` |
| Generalized function: linebacker | Task 4 — `flowLinebacker` |
| Generalized function: defensive back | Task 5 — `coverBack` |
| Decision 1: one button, three states, smart by default | Task 8 |
| Decision 2: assignment football | Tasks 3-6 |
| Decision 3: the AI gets real cover orders, and `clearAiPlans` wipes them | Tasks 5 and 7 |

**Type consistency** — the order shape `{ aim, cover }` is introduced in Task 3
and used identically in Tasks 4, 5 and 6; `smartOrders` adds `id` to it and
Task 7 destructures exactly `{ id, aim, cover }`. `defendDir` returns a number
in every call site. `coverAssignments` returns a `Map` keyed by defender id, and
both `coverBack` (`.get`) and the tests (`.get`/`.has`/`.size`) use it as one.

**Known follow-ups, deliberately out of scope**

- `applyAiModes` is shared by both brains unchanged. A smarter rule — do not
  break down while you are trailing the carrier, because a locked axis behind
  the play is a wasted defender — is a separate change to a separate function
  with its own tests.
- `AI_DEEP_CUSHION_UNITS`, `AI_BACKER_DEPTH_UNITS` and `AI_CONTAIN_UNITS` are
  reasoned, not playtested. Retuning them is a constants change; the tests in
  Tasks 3-5 assert exact coordinates, so a retune means updating those numbers,
  which is the point — a tuning change should be visible in the diff.
- The assignment brain assumes it coaches the defensive side. `smartOrder`
  handles a teammate carrier by running at the ball, so coaching the offense
  degrades gracefully rather than crashing, but it is not football.
