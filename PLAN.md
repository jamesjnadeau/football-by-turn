# Football By Turn — Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-page, turn-based (WeGo) 2D football game rendered in SVG: the user positions players, draws direction/force arrows for everyone, then each half-second turn resolves simultaneously with circle physics — blocking, tackling, tucking, fumbles — until the offense scores from the 10 or runs out of its 4 downs.

**Architecture:** Vendor the pure SVG field renderer from `jamesjnadeau/vermont-football-officials` (`lib/field/`) unchanged, and give the game its own uniform-scale view so a yard is the same 3.75 SVG units in both axes (the diagram views deliberately squash lengthwise; isotropic circle physics can't tolerate that). All game logic — state, mode effects, physics, football rules, turn resolution, rendering-to-markup — lives in pure ES modules under `lib/game/` with no DOM and no `node:` imports, so the exact same files run under `node --test` and as `<script type="module">` in the browser. Only `app/` touches the DOM (pointer input, buttons, animation loop), and it does so through the vendored SVG.js library (`app/vendor/svg.esm.js`) rather than raw `document`/`SVGElement` calls — SVG.js gives that layer one consistent API for selecting elements, injecting the markup strings `lib/game/render.js` produces, transforming player groups each animation frame, and converting pointer events to SVG coordinates. No build step, no npm dependencies — SVG.js is vendored as a single verbatim file exactly like `lib/field/`, never `npm install`ed.

**Tech Stack:** Plain ES modules, SVG, Node 20+ built-in test runner (`node --test`), any static file server for manual testing (`python3 -m http.server`).

**Spec:** [README.md](../../../README.md) — the whole spec is its two paragraphs. This plan argues from it; executors read both.

## Global Constraints

- No npm dependencies and no build step. `package.json` exists only for `"type": "module"` and scripts. The one exception is SVG.js: vendored verbatim as `app/vendor/svg.esm.js` (never `npm install`ed, never edited — same treatment as `lib/field/`) and imported only from `app/`, the DOM-touching layer, so it never enters `lib/game/`'s pure, Node-testable modules.
- Everything under `lib/` is pure: no `document`, no `window`, no `node:` imports, no `Date.now()`, no unseeded `Math.random()` inside game logic (randomness comes in as a passed-in seeded generator). This is what makes the same file loadable by both `node --test` and the browser. DOM code lives only under `app/`.
- Vendored files in `lib/field/` are copied verbatim from `jamesjnadeau/vermont-football-officials` and never edited. Game-specific styling goes in `lib/game/render.js` (`STYLE_GAME`), never into the vendored `style.js`.
- All physics runs in SVG units. 1 yard = 3.75 units (`UNITS_PER_YARD_X` from the vendored `geometry.js`). Game coordinates: `x` across the field (sidelines at 35 and 235), `y` down the field, increasing toward the goal the offense attacks. Yard 0 = where the drive starts (the 10-yard line); the goal line is yard 10; the end line is yard 20.
- Game state objects are plain JSON-serializable data. Mutating helpers are fine (the game is small), but every function that uses randomness takes a `random` function parameter (`() => number in [0,1)`) so tests are deterministic via a seed.
- Spec rules that every task inherits: turn interval is 0.5 s; repositioning by click is allowed only before the first turn of a play; smaller players are faster and lighter; the ball is drawn as a small football; tucked runner vs. one prepared defender, all else equal, is exactly a 50/50 tackle.

## Design decisions (resolving spec ambiguities — read before implementing)

The README is two paragraphs; these are the interpretations this plan commits to. If the user disagrees with one, it changes a constant or one function, not the architecture.

1. **"User sets the direction for all players"** — v1 is a sandbox/hot-seat: one user plans *both* teams' arrows each turn. No AI.
2. **"Play is turn based, happening at half second intervals"** — WeGo model: each turn, the user plans, presses **Run Turn**, and the simulation advances exactly 0.5 s (30 physics sub-steps of 1/60 s, animated), then returns to planning. Velocities persist between turns (momentum carries).
3. **"They have 4 downs to score"** — goal-to-go from the 10. There are no first downs: touchdown within 4 downs wins, otherwise turnover on downs ends the game. Defensive fumble recovery also ends the game.
4. **Team size** — `TEAM_SIZE = 7` per side (constant; 22 arrows per turn would be miserable to plan, 14 is playable). Changing it means editing the two formation arrays only.
5. **No passing or snapping in v1** — the README describes running, blocking, tackling, tucking, fumbling; it never describes a pass or a snap mechanic. The ball starts in the QB's possession at the start of each play. The "less friction going downfield for a pass" line is implemented as friction that drops when relative sliding speed at a contact is high (a releasing receiver brushing past a defender), not as a pass mechanic.
6. **Tackle outcomes are probabilistic** but driven by a seeded RNG carried in state, so every play is reproducible in tests.
7. **Mode assignments** (long-press): *tuck* — ball carrier only; *prepare to tackle* — defense only; *defend position* ("holding") — offense only. A player leaves a mode by long-pressing again (toggle).
8. **"Reset"** of an arrow: drawing a new drag replaces a player's old arrow; a **Clear Arrows** button wipes all of them.

## File Structure

```
football-by-turn/
├── index.html                 # the page: <svg id="board">, HUD divs, buttons
├── package.json               # {"type":"module"}, test + serve scripts
├── app/
│   ├── vendor/
│   │   └── svg.esm.js         # VENDORED, verbatim, never edited (@svgdotjs/svg.js)
│   ├── main.js                # wiring: build board via SVG.js, own the state, buttons, animation
│   └── input.js               # pointerdown/move/up → gestures → state mutations, via SVG.js
├── lib/
│   ├── field/                 # VENDORED, verbatim, never edited
│   │   ├── geometry.js        # coordinate system, x()/y()/inverses, UNITS_PER_YARD_X
│   │   ├── field.js           # renderField(view) → turf, lines, end zone, posts
│   │   ├── style.js           # STYLE + DEFS (arrowhead marker #ar, ez hatch)
│   │   └── escape.js          # escapeText()
│   └── game/
│       ├── constants.js       # every tunable number, one place
│       ├── vec.js             # 2D vector math
│       ├── rng.js             # mulberry32 seeded generator
│       ├── view.js            # gameView(losYard): the uniform-scale crop; yard↔unit helpers
│       ├── state.js           # createGame, formations, plans, modes, ball helpers
│       ├── modes.js           # what each mode does to speed / reach / mass / fumble odds
│       ├── physics.js         # stepPhysics: steering, integration, collisions, friction
│       ├── rules.js           # tackles, fumbles, pickups, dead ball, downs, scoring
│       ├── turn.js            # runTurn: sub-step loop producing frames + events
│       ├── gesture.js         # pure pointer-log → click | drag | longpress classifier
│       └── render.js          # markup for players/ball/arrows/indicators, board shell, STYLE_GAME
└── test/
    └── game/
        ├── view.test.js
        ├── vec.test.js
        ├── rng.test.js
        ├── state.test.js
        ├── modes.test.js
        ├── physics.test.js
        ├── rules.test.js
        ├── turn.test.js
        ├── gesture.test.js
        └── render.test.js
```

Responsibilities are one-per-file. `render.js` builds strings (like the vendored `markers.js` does) so it stays testable under Node; `app/main.js` is the only code that injects that markup into the page, and it does so through the vendored SVG.js wrapper (`.svg()`/`.clear()`), never raw `innerHTML`.

---

### Task 1: Scaffold, vendored field renderer, uniform-scale game view

**Files:**
- Create: `package.json`
- Create: `lib/field/geometry.js`, `lib/field/field.js`, `lib/field/style.js`, `lib/field/escape.js` (vendored)
- Create: `lib/game/view.js`
- Create: `index.html`, `app/main.js` (minimal — just shows the field)
- Test: `test/game/view.test.js`

**Interfaces:**
- Consumes: vendored `geometry.js` exports `UNITS_PER_YARD_X` (3.75), `x(acrossYards)`, `y(view, downYards)`, `yToYards(view, svgY)`, `VIEWBOX_WIDTH` (270), `SIDELINE_LEFT` (35), `SIDELINE_RIGHT` (235); vendored `field.js` exports `renderField(view) → {svg, height}`; vendored `style.js` exports `STYLE`, `DEFS`.
- Produces: `gameView(losYard) → view object` (uniform scale), `fieldPos(acrossYards, downYards) → {x, y}` in SVG units, `yardsOfY(svgY) → number`, constants `GOAL_YARD = 10`, `END_YARD = 20`, `TOP_YARD = -20`. Every later task places and measures through these three functions.

- [ ] **Step 1: Scaffold the project**

Write `package.json`:

```json
{
  "name": "football-by-turn",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/game/",
    "serve": "python3 -m http.server 8080"
  }
}
```

- [ ] **Step 2: Vendor the field renderer and SVG.js**

```bash
mkdir -p lib/field
for f in geometry.js field.js style.js escape.js; do
  curl -fsSL "https://raw.githubusercontent.com/jamesjnadeau/vermont-football-officials/HEAD/lib/field/$f" -o "lib/field/$f"
done

mkdir -p app/vendor
curl -fsSL "https://cdn.jsdelivr.net/npm/@svgdotjs/svg.js@3.2.5/dist/svg.esm.js" -o "app/vendor/svg.esm.js"
```

Then open each of the five files and confirm they downloaded as JavaScript (not a 404 HTML page or an HTML error from the CDN): the four field files should each start with a `/**` comment block, and `app/vendor/svg.esm.js` should be a large (~150 KB) bundle beginning with a comment naming `svg.js`. Pin the version in the URL (`@3.2.5` above) rather than tracking `latest`, so a re-run of this step is reproducible; bump it deliberately if a newer release is wanted. Do **not** vendor `markers.js` or `views.js` from the field repo — the game draws its own variable-size marks (Task 9) and defines its own view (this task). `app/vendor/svg.esm.js` is only ever imported from `app/` — Task 12 is the first task that uses it; `lib/game/` never imports it, so `node --test` keeps running with no DOM.

- [ ] **Step 3: Write the failing tests for the game view**

`test/game/view.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNITS_PER_YARD_X, y, yToYards } from '../../lib/field/geometry.js';
import { gameView, fieldPos, yardsOfY, GOAL_YARD, END_YARD, TOP_YARD } from '../../lib/game/view.js';

test('the game view is uniform-scale: one yard down equals one yard across', () => {
  const view = gameView(0);
  assert.equal(view.scaleY, UNITS_PER_YARD_X);
});

test('the frame runs from 20 yards behind the start to the end line', () => {
  const view = gameView(0);
  assert.equal(view.goalYard, GOAL_YARD);
  assert.equal(view.bottomYard, END_YARD);
  // the top of the drawn field is TOP_YARD
  assert.ok(Math.abs(yToYards(view, view.fieldTopY) - TOP_YARD) < 1e-9);
});

test('the scrimmage line follows the losYard argument', () => {
  assert.equal(gameView(0).scrimmage.yard, 0);
  assert.equal(gameView(4.5).scrimmage.yard, 4.5);
});

test('fieldPos and yardsOfY invert each other and agree with geometry.js', () => {
  const view = gameView(0);
  const p = fieldPos(-10, 3);
  assert.equal(p.y, y(view, 3));
  assert.ok(Math.abs(yardsOfY(p.y) - 3) < 1e-9);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/game/view.js'`

- [ ] **Step 5: Implement `lib/game/view.js`**

```js
/**
 * The game's one view: a uniform-scale window from 20 yards behind the
 * drive's start to the back of the end zone. Unlike the diagram views this
 * copies its shape from, scaleY here MUST equal UNITS_PER_YARD_X — the
 * physics treats players as circles, and a circle is only a circle if a
 * yard is the same number of units in both axes.
 *
 * Yard 0 is where the drive starts (the 10-yard line). The goal line is
 * yard 10, the end line yard 20, and the frame reaches back to yard -20.
 */
import { UNITS_PER_YARD_X, x, y } from '../field/geometry.js';

export const TOP_YARD = -20;
export const GOAL_YARD = 10;
export const END_YARD = 20;

const MARGIN_TOP = 10;
const MARGIN_BOTTOM = 10;
const ANCHOR_Y = MARGIN_TOP + -TOP_YARD * UNITS_PER_YARD_X; // yard 0 in SVG y

export function gameView(losYard) {
  return {
    scaleY: UNITS_PER_YARD_X,
    anchorY: ANCHOR_Y,
    fieldTopY: MARGIN_TOP,
    bottomYard: END_YARD,
    goalYard: GOAL_YARD,
    goalPosts: true,
    height: ANCHOR_Y + END_YARD * UNITS_PER_YARD_X + MARGIN_BOTTOM,
    scrimmage: { yard: losYard, label: 'LOS' },
    yardLines: [
      { yard: -15, label: '25' },
      { yard: -10, label: '20' },
      { yard: -5, label: '15' },
      { yard: 0, label: '10' },
      { yard: 5, label: '5' },
    ],
  };
}

/** Football coordinates (yards across from centre, yards downfield) → SVG units. */
export function fieldPos(acrossYards, downYards) {
  return { x: x(acrossYards), y: y(gameView(0), downYards) };
}

/** SVG y → yards downfield. The inverse of fieldPos's y. */
export function yardsOfY(svgY) {
  return (svgY - ANCHOR_Y) / UNITS_PER_YARD_X;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (4 tests)

- [ ] **Step 7: Put the field on screen**

`index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Football By Turn</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; display: flex; gap: 1rem; }
    #board { flex: 1; max-height: 100vh; touch-action: none; }
    #panel { width: 16rem; padding: 1rem; }
    #message { min-height: 3rem; font-weight: bold; }
    button { display: block; width: 100%; margin: .25rem 0; padding: .5rem; }
  </style>
</head>
<body>
  <svg id="board" xmlns="http://www.w3.org/2000/svg"></svg>
  <div id="panel">
    <h1>Football By Turn</h1>
    <div id="hud"></div>
    <div id="message"></div>
    <button id="run">Run Turn</button>
    <button id="clear">Clear Arrows</button>
    <button id="next" hidden>Next Down</button>
    <button id="new">New Game</button>
  </div>
  <script type="module" src="app/main.js"></script>
</body>
</html>
```

`app/main.js` (minimal for this task — Task 12 replaces it):

```js
import { SVG } from './vendor/svg.esm.js';
import { VIEWBOX_WIDTH } from '../lib/field/geometry.js';
import { renderField } from '../lib/field/field.js';
import { STYLE, DEFS } from '../lib/field/style.js';
import { gameView } from '../lib/game/view.js';

const board = SVG(document.getElementById('board'));
const view = gameView(0);
const { svg, height } = renderField(view);
board.attr('viewBox', `0 0 ${VIEWBOX_WIDTH} ${height}`);
board.svg(`<style>${STYLE}</style>${DEFS}<g id="game-field">${svg}</g>` +
  `<g id="game-arrows"></g><g id="game-players"></g><g id="game-overlay"></g>`);
```

Run: `npm run serve`, open http://localhost:8080. Expected: a vertical field with sidelines, yard lines labelled 25/20/15/10/5, an LOS line at yard 0, a hatched end zone, and goal posts at the bottom. No console errors.

- [ ] **Step 8: Commit**

```bash
git add package.json lib/field app/vendor/svg.esm.js lib/game/view.js test/game/view.test.js index.html app/main.js
git commit -m "feat: scaffold project, vendor field renderer and SVG.js, add uniform-scale game view"
```

---

### Task 2: Vector math and seeded RNG

**Files:**
- Create: `lib/game/vec.js`, `lib/game/rng.js`
- Test: `test/game/vec.test.js`, `test/game/rng.test.js`

**Interfaces:**
- Produces: `vec.js` exports `add(a,b)`, `sub(a,b)`, `scale(v,k)`, `dot(a,b)`, `len(v)`, `dist(a,b)`, `norm(v)` (returns `{x:0,y:0}` for the zero vector), `clampLen(v,max)`. All take/return `{x, y}` and never mutate their arguments. `rng.js` exports `mulberry32(seed) → () => number in [0,1)`.

- [ ] **Step 1: Write the failing tests**

`test/game/vec.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, sub, scale, dot, len, dist, norm, clampLen } from '../../lib/game/vec.js';

test('arithmetic', () => {
  assert.deepEqual(add({ x: 1, y: 2 }, { x: 3, y: 4 }), { x: 4, y: 6 });
  assert.deepEqual(sub({ x: 1, y: 2 }, { x: 3, y: 4 }), { x: -2, y: -2 });
  assert.deepEqual(scale({ x: 1, y: -2 }, 3), { x: 3, y: -6 });
  assert.equal(dot({ x: 1, y: 2 }, { x: 3, y: 4 }), 11);
});

test('lengths', () => {
  assert.equal(len({ x: 3, y: 4 }), 5);
  assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test('norm returns a unit vector, and zero for the zero vector', () => {
  assert.deepEqual(norm({ x: 0, y: -2 }), { x: 0, y: -1 });
  assert.deepEqual(norm({ x: 0, y: 0 }), { x: 0, y: 0 });
});

test('clampLen shortens long vectors and leaves short ones alone', () => {
  assert.deepEqual(clampLen({ x: 6, y: 8 }, 5), { x: 3, y: 4 });
  assert.deepEqual(clampLen({ x: 1, y: 0 }, 5), { x: 1, y: 0 });
});

test('nothing mutates its arguments', () => {
  const a = { x: 1, y: 2 };
  add(a, a); sub(a, a); scale(a, 2); norm(a); clampLen(a, 1);
  assert.deepEqual(a, { x: 1, y: 2 });
});
```

`test/game/rng.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../lib/game/rng.js';

test('same seed, same sequence', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});

test('values are in [0, 1) and different seeds diverge', () => {
  const r = mulberry32(1), s = mulberry32(2);
  const rs = Array.from({ length: 100 }, () => r());
  assert.ok(rs.every((v) => v >= 0 && v < 1));
  assert.notEqual(rs[0], s());
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/game/vec.js'` (and rng.js)

- [ ] **Step 3: Implement**

`lib/game/vec.js`:

```js
/** 2D vector math over plain {x, y} objects. Nothing here mutates an argument. */
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v, k) => ({ x: v.x * k, y: v.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const len = (v) => Math.hypot(v.x, v.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (v) => {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
};
export const clampLen = (v, max) => {
  const l = len(v);
  return l <= max ? v : scale(v, max / l);
};
```

`lib/game/rng.js`:

```js
/**
 * mulberry32 — a tiny seedable PRNG. The game carries its seed in state so
 * every play is reproducible: tests pass a known seed and assert exact
 * outcomes; the app seeds from the New Game click.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/vec.js lib/game/rng.js test/game/vec.test.js test/game/rng.test.js
git commit -m "feat: add vector math and seeded rng"
```

---

### Task 3: Constants, game state, and formations

**Files:**
- Create: `lib/game/constants.js`, `lib/game/state.js`
- Test: `test/game/state.test.js`

**Interfaces:**
- Consumes: `fieldPos(across, down)` from `view.js`; `SIDELINE_LEFT`, `SIDELINE_RIGHT` from `../field/geometry.js`.
- Produces:
  - `constants.js` — every named number below; later tasks import from here, never re-declare.
  - `state.js` exports:
    - `createGame({ seed = 1 } = {}) → state`
    - `formationPlayers(losYard) → player[]`
    - `setPlan(state, id, dir, throttle)` — `dir` a unit `{x,y}`, `throttle` in (0, 1]
    - `clearPlan(state, id)` / `clearAllPlans(state)`
    - `setMode(state, id, mode) → boolean` (false = illegal, no change)
    - `placePlayer(state, id, pos) → boolean` (false = illegal, no change)
    - `getPlayer(state, id) → player`
    - `ballPos(state) → {x, y}`
    - `carrier(state) → player | null`
  - Player shape: `{ id, team: 'offense'|'defense', role, radius, mass, pos: {x,y}, vel: {x,y}, plan: null | { dir: {x,y}, throttle }, mode: 'normal'|'tucked'|'prepared'|'holding', charge: 0|1, tackleCooldown: 0 }`
  - State shape: `{ seed, down: 1..4, losYard, phase: 'planning'|'running'|'playOver'|'gameOver', turnIndex, players: player[], ball: { carrierId: string|null, pos: {x,y}|null, vel: {x,y}|null }, deadReason: null|string, result: null|'touchdown'|'turnover-on-downs'|'turnover-fumble' }`

- [ ] **Step 1: Write `lib/game/constants.js`** (no test of its own — every later test exercises these numbers)

```js
/**
 * Every tunable number in the game. Units are SVG units (1 yard = 3.75) and
 * seconds unless stated. Task 13 is the sanctioned place to retune these;
 * mid-task "this feels wrong" edits go through a failing test first.
 */

// --- the turn ---
export const TURN_SECONDS = 0.5;          // spec: half-second intervals
export const DT = 1 / 60;                 // physics sub-step
export const SUBSTEPS_PER_TURN = Math.round(TURN_SECONDS / DT); // 30

// --- players ---
export const TEAM_SIZE = 7;
export const RADIUS_LINE = 3.5;           // linemen: big, slow
export const RADIUS_MID = 3;              // QB, LB
export const RADIUS_SKILL = 2.5;          // RB, WR, CB, S: small, fast
// maxSpeed = SPEED_FACTOR / radius → skill 28.8 u/s (~7.7 yd/s),
// mid 24 u/s, line 20.6 u/s. Smaller is faster (spec).
export const SPEED_FACTOR = 72;
export const ACCEL = 60;                  // units/s²: how fast a plan takes hold
export const IDLE_DAMPING = 0.96;         // per sub-step velocity decay with no plan

// --- planning arrows ---
export const MAX_ARROW_UNITS = 30;        // drag length that means full throttle

// --- contact friction (spec: hand-fighting slows players sliding past each other) ---
export const FRICTION_BLOCK = 0.4;        // engaged blocking
export const FRICTION_RELEASE = 0.15;     // brushing past at speed (receiver releasing)
export const FRICTION_HOLD = 0.6;         // against a defend-position player
export const RELEASE_SPEED = 20;          // rel. tangential speed above which contact counts as a release

// --- modes ---
export const TUCK_SPEED_MULT = 0.85;      // spec: tucked is a little slower
export const PREPARED_SPEED_MULT = 0.3;   // spec: breaking down slows you a lot
export const HOLD_SPEED_MULT = 0.15;      // spec: movement severely limited
export const PREPARED_REACH = 2.5;        // extra reach in units while prepared
export const HOLD_REACH = 3;              // extra reach while holding position
export const HOLD_MASS_MULT = 4;          // spec: resists momentum from chargers
export const CHARGE_MULT = 1.5;           // accel bonus the turn after tucking/preparing

// --- tackles ---
export const TACKLE_BASE = 1;
export const PREPARED_TACKLE_BONUS = 1;   // with TUCK_BREAK_BONUS makes tucked-vs-prepared 50/50
export const TUCK_BREAK_BONUS = 1;
export const NEARBY_RADIUS = 12;          // ~3.2 yd: teammates in on the tackle
export const NEARBY_BONUS = 0.5;          // per extra nearby defender
export const MOMENTUM_SCALE = 1 / 240;    // score per unit of (mass × speed)
export const TACKLE_COOLDOWN_SUBSTEPS = 15; // a broken tackle sidelines that defender briefly

// --- fumbles ---
export const FUMBLE_UNTUCKED = 0.25;
export const FUMBLE_TUCKED = 0.05;        // spec: tucking protects the ball
export const FUMBLE_BALL_SPEED = 15;      // loose-ball pop-out speed
export const BALL_FRICTION = 0.94;        // per sub-step loose-ball decay
```

- [ ] **Step 2: Write the failing tests**

`test/game/state.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, setPlan, clearAllPlans, setMode, placePlayer, getPlayer, ballPos, carrier,
} from '../../lib/game/state.js';
import { TEAM_SIZE } from '../../lib/game/constants.js';
import { fieldPos } from '../../lib/game/view.js';

test('a new game: 1st down at yard 0, planning, TEAM_SIZE a side, QB has the ball', () => {
  const s = createGame({ seed: 7 });
  assert.equal(s.down, 1);
  assert.equal(s.losYard, 0);
  assert.equal(s.phase, 'planning');
  assert.equal(s.turnIndex, 0);
  assert.equal(s.players.filter((p) => p.team === 'offense').length, TEAM_SIZE);
  assert.equal(s.players.filter((p) => p.team === 'defense').length, TEAM_SIZE);
  const qb = getPlayer(s, 'o-qb');
  assert.equal(s.ball.carrierId, 'o-qb');
  assert.deepEqual(ballPos(s), qb.pos);
  assert.equal(carrier(s).id, 'o-qb');
});

test('offense lines up behind the LOS, defense beyond it, nobody overlapping', () => {
  const s = createGame({ seed: 1 });
  const losY = fieldPos(0, 0).y;
  for (const p of s.players) {
    if (p.team === 'offense') assert.ok(p.pos.y < losY, `${p.id} behind LOS`);
    else assert.ok(p.pos.y > losY, `${p.id} beyond LOS`);
  }
  for (const a of s.players) for (const b of s.players) {
    if (a.id < b.id) {
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
      assert.ok(d >= a.radius + b.radius, `${a.id} and ${b.id} overlap`);
    }
  }
});

test('mass grows with radius squared', () => {
  const s = createGame({ seed: 1 });
  const line = s.players.find((p) => p.radius === 3.5);
  const skill = s.players.find((p) => p.radius === 2.5);
  assert.equal(line.mass, 3.5 * 3.5);
  assert.equal(skill.mass, 2.5 * 2.5);
});

test('plans can be set, replaced, and cleared', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.8);
  assert.deepEqual(getPlayer(s, 'o-rb').plan, { dir: { x: 0, y: 1 }, throttle: 0.8 });
  setPlan(s, 'o-rb', { x: 1, y: 0 }, 0.5);
  assert.deepEqual(getPlayer(s, 'o-rb').plan, { dir: { x: 1, y: 0 }, throttle: 0.5 });
  clearAllPlans(s);
  assert.ok(s.players.every((p) => p.plan === null));
});

test('mode legality: tuck = carrier only, prepared = defense only, holding = offense only', () => {
  const s = createGame({ seed: 1 });
  assert.equal(setMode(s, 'o-qb', 'tucked'), true);     // has the ball
  assert.equal(setMode(s, 'o-rb', 'tucked'), false);    // no ball
  assert.equal(setMode(s, 'd-lb', 'prepared'), true);
  assert.equal(setMode(s, 'o-c', 'prepared'), false);
  assert.equal(setMode(s, 'o-c', 'holding'), true);
  assert.equal(setMode(s, 'd-nt', 'holding'), false);
  // setting a mode arms the next-turn charge (spec: momentum after preparing)
  assert.equal(getPlayer(s, 'o-qb').charge, 1);
  // toggling back to normal clears it
  setMode(s, 'o-qb', 'normal');
  assert.equal(getPlayer(s, 'o-qb').mode, 'normal');
  assert.equal(getPlayer(s, 'o-qb').charge, 0);
});

test('repositioning: allowed only at turn 0 planning, and only on your own side of the LOS', () => {
  const s = createGame({ seed: 1 });
  const ok = placePlayer(s, 'o-wr1', fieldPos(-20, -2));
  assert.equal(ok, true);
  assert.deepEqual(getPlayer(s, 'o-wr1').pos, fieldPos(-20, -2));
  // offense may not set up past the LOS
  assert.equal(placePlayer(s, 'o-wr1', fieldPos(-20, 2)), false);
  // defense may not set up behind it
  assert.equal(placePlayer(s, 'd-cb1', fieldPos(-20, -2)), false);
  // once the play has run a turn, nobody repositions
  s.turnIndex = 1;
  assert.equal(placePlayer(s, 'o-wr1', fieldPos(-15, -2)), false);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/game/state.js'`

- [ ] **Step 4: Implement `lib/game/state.js`**

```js
/**
 * The game state: plain serializable data plus the mutating helpers the
 * planning phase uses. Nothing here steps time — that's turn.js — and
 * nothing here rolls dice.
 */
import { fieldPos } from './view.js';
import { RADIUS_LINE, RADIUS_MID, RADIUS_SKILL, TEAM_SIZE } from './constants.js';

/**
 * One drive-start formation per team, positions in yards relative to the
 * LOS (across from centre, downfield from the LOS). Exactly TEAM_SIZE
 * entries each; edit here (and only here) to change team size.
 */
const OFFENSE = [
  { id: 'o-c', role: 'C', radius: RADIUS_LINE, across: 0, down: -1 },
  { id: 'o-lg', role: 'LG', radius: RADIUS_LINE, across: -2.5, down: -1 },
  { id: 'o-rg', role: 'RG', radius: RADIUS_LINE, across: 2.5, down: -1 },
  { id: 'o-wr1', role: 'WR', radius: RADIUS_SKILL, across: -15, down: -1 },
  { id: 'o-wr2', role: 'WR', radius: RADIUS_SKILL, across: 15, down: -1 },
  { id: 'o-qb', role: 'QB', radius: RADIUS_MID, across: 0, down: -4 },
  { id: 'o-rb', role: 'RB', radius: RADIUS_SKILL, across: 0, down: -7 },
];

const DEFENSE = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-dt2', role: 'DT', radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: 0, down: 4 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];

function makePlayer(spec, team, losYard) {
  return {
    id: spec.id,
    team,
    role: spec.role,
    radius: spec.radius,
    mass: spec.radius * spec.radius,
    pos: fieldPos(spec.across, losYard + spec.down),
    vel: { x: 0, y: 0 },
    plan: null,
    mode: 'normal',
    charge: 0,
    tackleCooldown: 0,
  };
}

export function formationPlayers(losYard) {
  if (OFFENSE.length !== TEAM_SIZE || DEFENSE.length !== TEAM_SIZE) {
    throw new Error(`formations must have exactly TEAM_SIZE=${TEAM_SIZE} players`);
  }
  return [
    ...OFFENSE.map((s) => makePlayer(s, 'offense', losYard)),
    ...DEFENSE.map((s) => makePlayer(s, 'defense', losYard)),
  ];
}

export function createGame({ seed = 1 } = {}) {
  return {
    seed,
    down: 1,
    losYard: 0,
    phase: 'planning',
    turnIndex: 0,
    players: formationPlayers(0),
    ball: { carrierId: 'o-qb', pos: null, vel: null },
    deadReason: null,
    result: null,
  };
}

export function getPlayer(state, id) {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`unknown player "${id}"`);
  return p;
}

export function carrier(state) {
  return state.ball.carrierId === null ? null : getPlayer(state, state.ball.carrierId);
}

export function ballPos(state) {
  const c = carrier(state);
  return c ? c.pos : state.ball.pos;
}

export function setPlan(state, id, dir, throttle) {
  getPlayer(state, id).plan = { dir, throttle };
}

export function clearPlan(state, id) {
  getPlayer(state, id).plan = null;
}

export function clearAllPlans(state) {
  for (const p of state.players) p.plan = null;
}

/**
 * Mode legality is the spec's: tucking is something the runner does with the
 * ball; preparing to tackle is a defensive stance; defend-position is an
 * offensive one. Setting any non-normal mode arms `charge`, the next-turn
 * burst the spec grants for having set your feet.
 */
export function setMode(state, id, mode) {
  const p = getPlayer(state, id);
  const legal =
    mode === 'normal' ||
    (mode === 'tucked' && state.ball.carrierId === id) ||
    (mode === 'prepared' && p.team === 'defense') ||
    (mode === 'holding' && p.team === 'offense');
  if (!legal) return false;
  p.mode = mode;
  p.charge = mode === 'normal' ? 0 : 1;
  return true;
}

/** Click-to-move, legal only before the play's first turn and on your own side. */
export function placePlayer(state, id, pos) {
  if (state.phase !== 'planning' || state.turnIndex !== 0) return false;
  const p = getPlayer(state, id);
  const losY = fieldPos(0, state.losYard).y;
  const onOwnSide = p.team === 'offense' ? pos.y < losY : pos.y > losY;
  if (!onOwnSide) return false;
  p.pos = pos;
  return true;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. If the no-overlap test fails, adjust formation `across`/`down` values (they are yards; linemen at ±2.5 yards with radius 3.5 units = 0.93 yd are clear).

- [ ] **Step 6: Commit**

```bash
git add lib/game/constants.js lib/game/state.js test/game/state.test.js
git commit -m "feat: game state, formations, plans, modes, repositioning rules"
```

---

### Task 4: Mode effects

**Files:**
- Create: `lib/game/modes.js`
- Test: `test/game/modes.test.js`

**Interfaces:**
- Consumes: player objects from `state.js`; constants.
- Produces: `maxSpeed(player) → units/s`, `reach(player) → units`, `effectiveMass(player) → number`, `accelMult(player) → number`, `fumbleChance(player) → probability`. Physics (Task 5–6) and rules (Task 7) call these instead of reading `player.mode` themselves.

- [ ] **Step 1: Write the failing tests**

`test/game/modes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxSpeed, reach, effectiveMass, accelMult, fumbleChance } from '../../lib/game/modes.js';
import {
  SPEED_FACTOR, TUCK_SPEED_MULT, PREPARED_SPEED_MULT, HOLD_SPEED_MULT,
  PREPARED_REACH, HOLD_REACH, HOLD_MASS_MULT, CHARGE_MULT,
  FUMBLE_UNTUCKED, FUMBLE_TUCKED,
} from '../../lib/game/constants.js';

const p = (over) => ({ radius: 3, mass: 9, mode: 'normal', charge: 0, ...over });

test('smaller players are faster (spec)', () => {
  assert.ok(maxSpeed(p({ radius: 2.5 })) > maxSpeed(p({ radius: 3.5 })));
  assert.equal(maxSpeed(p()), SPEED_FACTOR / 3);
});

test('each mode caps speed as specified', () => {
  assert.equal(maxSpeed(p({ mode: 'tucked' })), (SPEED_FACTOR / 3) * TUCK_SPEED_MULT);
  assert.equal(maxSpeed(p({ mode: 'prepared' })), (SPEED_FACTOR / 3) * PREPARED_SPEED_MULT);
  assert.equal(maxSpeed(p({ mode: 'holding' })), (SPEED_FACTOR / 3) * HOLD_SPEED_MULT);
});

test('prepared and holding extend reach; normal reach is just the radius', () => {
  assert.equal(reach(p()), 3);
  assert.equal(reach(p({ mode: 'prepared' })), 3 + PREPARED_REACH);
  assert.equal(reach(p({ mode: 'holding' })), 3 + HOLD_REACH);
});

test('holding multiplies effective mass (resists charging defenders)', () => {
  assert.equal(effectiveMass(p()), 9);
  assert.equal(effectiveMass(p({ mode: 'holding' })), 9 * HOLD_MASS_MULT);
});

test('charge gives a one-turn accel burst', () => {
  assert.equal(accelMult(p()), 1);
  assert.equal(accelMult(p({ charge: 1 })), CHARGE_MULT);
});

test('tucking protects the ball', () => {
  assert.equal(fumbleChance(p()), FUMBLE_UNTUCKED);
  assert.equal(fumbleChance(p({ mode: 'tucked' })), FUMBLE_TUCKED);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/game/modes.js'`

- [ ] **Step 3: Implement `lib/game/modes.js`**

```js
/**
 * What a mode does to a player's numbers. The one place `player.mode` is
 * interpreted — physics and rules ask these functions, so a new mode (or a
 * retuned one) is a change here and in constants.js, nowhere else.
 */
import {
  SPEED_FACTOR, TUCK_SPEED_MULT, PREPARED_SPEED_MULT, HOLD_SPEED_MULT,
  PREPARED_REACH, HOLD_REACH, HOLD_MASS_MULT, CHARGE_MULT,
  FUMBLE_UNTUCKED, FUMBLE_TUCKED,
} from './constants.js';

const SPEED_MULT = { normal: 1, tucked: TUCK_SPEED_MULT, prepared: PREPARED_SPEED_MULT, holding: HOLD_SPEED_MULT };
const REACH_BONUS = { normal: 0, tucked: 0, prepared: PREPARED_REACH, holding: HOLD_REACH };

export function maxSpeed(player) {
  return (SPEED_FACTOR / player.radius) * SPEED_MULT[player.mode];
}

export function reach(player) {
  return player.radius + REACH_BONUS[player.mode];
}

export function effectiveMass(player) {
  return player.mass * (player.mode === 'holding' ? HOLD_MASS_MULT : 1);
}

export function accelMult(player) {
  return player.charge ? CHARGE_MULT : 1;
}

export function fumbleChance(player) {
  return player.mode === 'tucked' ? FUMBLE_TUCKED : FUMBLE_UNTUCKED;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/modes.js test/game/modes.test.js
git commit -m "feat: mode effects — speed, reach, mass, charge, fumble protection"
```

---

### Task 5: Physics — steering and integration

**Files:**
- Create: `lib/game/physics.js` (integration half; collisions come in Task 6)
- Test: `test/game/physics.test.js`

**Interfaces:**
- Consumes: `maxSpeed`, `accelMult` from `modes.js`; vec; constants; state shape.
- Produces: `stepPhysics(state, dt) → contacts[]` — one sub-step: every player steers toward `plan.dir × plan.throttle × maxSpeed` under an accel limit (× charge), planless players coast and damp, the loose ball rolls and slows, then collisions resolve (Task 6). `contacts` is `[{ a, b, point }]` player-pair overlaps this sub-step (empty until Task 6 fills it in). Task 8 relies on positions being plain `{x, y}` it can read yards off.

- [ ] **Step 1: Write the failing tests**

`test/game/physics.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepPhysics } from '../../lib/game/physics.js';
import { createGame, setPlan, getPlayer } from '../../lib/game/state.js';
import { maxSpeed } from '../../lib/game/modes.js';
import { DT, SUBSTEPS_PER_TURN } from '../../lib/game/constants.js';
import { len } from '../../lib/game/vec.js';

function run(state, substeps) {
  for (let i = 0; i < substeps; i++) stepPhysics(state, DT);
}

test('a planned player accelerates toward its arrow and tops out at maxSpeed', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const y0 = rb.pos.y;
  run(s, SUBSTEPS_PER_TURN * 4); // two seconds, plenty to saturate
  assert.ok(rb.pos.y > y0 + 10, 'moved downfield');
  assert.ok(len(rb.vel) <= maxSpeed(rb) + 1e-6, 'never exceeds max speed');
  assert.ok(len(rb.vel) > maxSpeed(rb) * 0.95, 'reached max speed');
});

test('half throttle targets half speed', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.5);
  run(s, SUBSTEPS_PER_TURN * 4);
  const v = len(rb.vel);
  assert.ok(Math.abs(v - maxSpeed(rb) * 0.5) < maxSpeed(rb) * 0.05, `got ${v}`);
});

test('a planless player with velocity coasts and slows', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  rb.vel = { x: 0, y: 20 };
  run(s, SUBSTEPS_PER_TURN);
  assert.ok(len(rb.vel) < 20, 'damped');
  assert.ok(rb.pos.y > getPlayer(createGame({ seed: 1 }), 'o-rb').pos.y, 'still drifted');
});

test('a charged player closes the gap to target speed faster than an uncharged one', () => {
  const a = createGame({ seed: 1 });
  const b = createGame({ seed: 1 });
  setPlan(a, 'o-rb', { x: 0, y: 1 }, 1);
  setPlan(b, 'o-rb', { x: 0, y: 1 }, 1);
  getPlayer(b, 'o-rb').charge = 1;
  run(a, 6);
  run(b, 6);
  assert.ok(len(getPlayer(b, 'o-rb').vel) > len(getPlayer(a, 'o-rb').vel));
});

test('a loose ball rolls and decays', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: null, pos: { x: 135, y: 100 }, vel: { x: 10, y: 0 } };
  run(s, SUBSTEPS_PER_TURN);
  assert.ok(s.ball.pos.x > 135, 'rolled');
  assert.ok(len(s.ball.vel) < 10, 'slowed');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/game/physics.js'`

- [ ] **Step 3: Implement the integration half of `lib/game/physics.js`**

```js
/**
 * One physics sub-step: steering toward each player's planned velocity,
 * integration, loose-ball roll, then pairwise collision resolution.
 *
 * The steering model: a plan is a target velocity (direction × throttle ×
 * the player's mode-capped max speed). Each sub-step the velocity moves
 * toward the target by at most ACCEL × accelMult × dt — so heavy modes cap
 * speed, and a charge (feet set last turn) closes the gap faster, which is
 * exactly the spec's "more forward momentum and power".
 */
import { add, sub, scale, len, norm, clampLen } from './vec.js';
import { maxSpeed, accelMult, effectiveMass } from './modes.js';
import { ACCEL, IDLE_DAMPING, BALL_FRICTION } from './constants.js';

function steer(player, dt) {
  if (player.plan) {
    const target = scale(player.plan.dir, player.plan.throttle * maxSpeed(player));
    const change = clampLen(sub(target, player.vel), ACCEL * accelMult(player) * dt);
    player.vel = add(player.vel, change);
    player.vel = clampLen(player.vel, maxSpeed(player));
  } else {
    player.vel = scale(player.vel, IDLE_DAMPING);
  }
  player.pos = add(player.pos, scale(player.vel, dt));
}

export function stepPhysics(state, dt) {
  for (const p of state.players) {
    steer(p, dt);
    if (p.tackleCooldown > 0) p.tackleCooldown -= 1;
  }
  if (state.ball.carrierId === null && state.ball.pos) {
    state.ball.pos = add(state.ball.pos, scale(state.ball.vel, dt));
    state.ball.vel = scale(state.ball.vel, BALL_FRICTION);
  }
  return resolveCollisions(state);
}

/** Task 6 replaces this stub with real circle collision + friction. */
function resolveCollisions(state) {
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/physics.js test/game/physics.test.js
git commit -m "feat: physics integration — steering, momentum, damping, loose ball"
```

---

### Task 6: Physics — collisions, blocking friction, pushing

**Files:**
- Modify: `lib/game/physics.js` (replace the `resolveCollisions` stub)
- Test: `test/game/physics.test.js` (append)

**Interfaces:**
- Consumes: `effectiveMass` from `modes.js`; friction constants.
- Produces: `resolveCollisions` fills the contract Task 5 declared: returns `contacts = [{ a, b, point }]` where `a`/`b` are the player objects and `point` the midpoint of contact. Collisions push overlapping circles apart weighted by inverse effective mass (a big or holding player barely moves; spec: pushing/blocking, and holding resists momentum) and apply a friction impulse along the tangent (spec: hands adding friction), with the coefficient dropping when the pair is sliding past fast (spec: releasing downfield for a pass) and rising against a holding player.

- [ ] **Step 1: Append the failing tests to `test/game/physics.test.js`**

```js
import { RELEASE_SPEED } from '../../lib/game/constants.js';

/**
 * Collision scenarios hand-place players, so trim the roster to just the
 * ones named — the full formation has players sitting exactly where these
 * scenarios want empty grass (d-lb lines up at (135, 100)).
 */
function pair(ids) {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => ids.includes(p.id));
  return s;
}

test('overlapping players are pushed apart, the heavier one moving less', () => {
  const s = pair(['d-nt', 'o-rb']);
  const nt = getPlayer(s, 'd-nt');   // radius 3.5
  const rb = getPlayer(s, 'o-rb');   // radius 2.5
  nt.pos = { x: 135, y: 100 };
  rb.pos = { x: 135, y: 104 };       // gap 4 < 3.5 + 2.5
  const ntY = nt.pos.y, rbY = rb.pos.y;
  const contacts = stepPhysics(s, DT);
  assert.ok(rb.pos.y - rbY > 0, 'light player pushed away');
  assert.ok(ntY - nt.pos.y > 0, 'heavy player pushed the other way');
  assert.ok(rb.pos.y - rbY > ntY - nt.pos.y, 'lighter one moved farther');
  assert.ok(contacts.some((c) => (c.a.id === 'd-nt' && c.b.id === 'o-rb') || (c.a.id === 'o-rb' && c.b.id === 'd-nt')));
});

test('a holding blocker barely budges when a charger slams in', () => {
  const withHold = pair(['o-c', 'd-nt']);
  const without = pair(['o-c', 'd-nt']);
  for (const s of [withHold, without]) {
    const c = getPlayer(s, 'o-c'), nt = getPlayer(s, 'd-nt');
    c.pos = { x: 135, y: 100 };
    nt.pos = { x: 135, y: 106 };
    nt.vel = { x: 0, y: -25 };       // charging into the blocker
  }
  getPlayer(withHold, 'o-c').mode = 'holding';
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) { stepPhysics(withHold, DT); stepPhysics(without, DT); }
  const heldDrift = 100 - getPlayer(withHold, 'o-c').pos.y;
  const normalDrift = 100 - getPlayer(without, 'o-c').pos.y;
  assert.ok(heldDrift < normalDrift / 2, `holding drift ${heldDrift} vs normal ${normalDrift}`);
});

test('contact friction slows a player sliding past another', () => {
  const s = pair(['o-wr1', 'd-cb1']);
  const wr = getPlayer(s, 'o-wr1'), cb = getPlayer(s, 'd-cb1');
  wr.pos = { x: 135, y: 100 };
  cb.pos = { x: 139.5, y: 100 };     // radii 2.5 + 2.5 = 5, so overlapping by 0.5
  wr.vel = { x: 0, y: 10 };          // sliding along the tangent
  const before = len(wr.vel);
  stepPhysics(s, DT);
  assert.ok(len(wr.vel) < before, 'tangential friction bled speed');
});

test('fast releases shed less speed than slow grinding (the pass-route exemption)', () => {
  const grind = pair(['o-wr1', 'd-cb1']);
  const release = pair(['o-wr1', 'd-cb1']);
  for (const [s, speed] of [[grind, RELEASE_SPEED * 0.5], [release, RELEASE_SPEED * 1.5]]) {
    const wr = getPlayer(s, 'o-wr1'), cb = getPlayer(s, 'd-cb1');
    wr.pos = { x: 135, y: 100 };
    cb.pos = { x: 139.5, y: 100 };
    wr.vel = { x: 0, y: speed };
    stepPhysics(s, DT);
  }
  const lostGrind = 1 - len(getPlayer(grind, 'o-wr1').vel) / (RELEASE_SPEED * 0.5);
  const lostRelease = 1 - len(getPlayer(release, 'o-wr1').vel) / (RELEASE_SPEED * 1.5);
  assert.ok(lostRelease < lostGrind, `release lost ${lostRelease}, grind lost ${lostGrind} (fractions)`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the four new tests fail (stub returns no contacts, applies no forces); Task 5's tests still pass.

- [ ] **Step 3: Replace the `resolveCollisions` stub in `lib/game/physics.js`**

Replace the stub function with:

```js
import { dot } from './vec.js'; // merge into the existing vec import at the top
import { FRICTION_BLOCK, FRICTION_RELEASE, FRICTION_HOLD, RELEASE_SPEED } from './constants.js'; // merge into the existing constants import

/**
 * Pairwise circle collision with positional correction and a friction
 * impulse. Restitution is zero — football players don't bounce. The
 * friction coefficient is contextual, which is where three spec lines live:
 * blocking hand-fighting (FRICTION_BLOCK), the lighter touch on a fast
 * release downfield (FRICTION_RELEASE above RELEASE_SPEED), and the extra
 * grab of a player holding position (FRICTION_HOLD).
 */
function frictionFor(a, b, tangentialSpeed) {
  if (a.mode === 'holding' || b.mode === 'holding') return FRICTION_HOLD;
  if (Math.abs(tangentialSpeed) > RELEASE_SPEED) return FRICTION_RELEASE;
  return FRICTION_BLOCK;
}

function resolveCollisions(state) {
  const contacts = [];
  const players = state.players;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const delta = sub(b.pos, a.pos);
      const d = len(delta);
      const overlap = a.radius + b.radius - d;
      if (overlap <= 0) continue;
      const n = d === 0 ? { x: 0, y: 1 } : scale(delta, 1 / d);
      const invA = 1 / effectiveMass(a);
      const invB = 1 / effectiveMass(b);
      const invSum = invA + invB;

      // Push out of overlap, split by inverse mass: the heavy (or holding) one holds ground.
      a.pos = add(a.pos, scale(n, -overlap * (invA / invSum)));
      b.pos = add(b.pos, scale(n, overlap * (invB / invSum)));

      const rv = sub(b.vel, a.vel);
      const vn = dot(rv, n);
      if (vn < 0) {
        // Normal impulse, restitution 0.
        const jn = -vn / invSum;
        a.vel = add(a.vel, scale(n, -jn * invA));
        b.vel = add(b.vel, scale(n, jn * invB));

        // Friction impulse along the tangent, clamped by the coefficient.
        const t = { x: -n.y, y: n.x };
        const vt = dot(rv, t);
        const mu = frictionFor(a, b, vt);
        const jtRaw = -vt / invSum;
        const jt = Math.max(-mu * jn, Math.min(mu * jn, jtRaw));
        a.vel = add(a.vel, scale(t, -jt * invA));
        b.vel = add(b.vel, scale(t, jt * invB));
      } else {
        // Not closing, but still in contact: rub friction directly on velocity
        // so a player sliding along another (route release, blocker riding a
        // rusher) is slowed even without a closing impulse to clamp against.
        const t = { x: -n.y, y: n.x };
        const vt = dot(rv, t);
        const mu = frictionFor(a, b, vt);
        const drag = vt * mu * 0.5;
        a.vel = add(a.vel, scale(t, drag * invA * effectiveMass(a) * (invA / invSum)));
        b.vel = add(b.vel, scale(t, -drag * invB * effectiveMass(b) * (invB / invSum)));
      }

      contacts.push({ a, b, point: add(a.pos, scale(n, a.radius)) });
    }
  }
  return contacts;
}
```

Note the sliding-contact branch: the impulse clamp `mu * jn` is zero when bodies aren't closing (`jn = 0`), so tangential rubbing needs its own term or the friction tests can't pass. If the exact drag expression above proves unstable in tests, simplify it to `a.vel = add(a.vel, scale(t, vt * mu * 0.5 * (invA / invSum)))` (and the mirrored line for `b`) — the tests assert direction and monotonicity, not exact values.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all physics tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add lib/game/physics.js test/game/physics.test.js
git commit -m "feat: circle collisions with contextual blocking friction and mass-weighted pushing"
```

---

### Task 7: Rules — tackles, fumbles, pickups

**Files:**
- Create: `lib/game/rules.js`
- Test: `test/game/rules.test.js`

**Interfaces:**
- Consumes: `reach`, `fumbleChance`, `effectiveMass` from `modes.js`; `carrier`, `getPlayer`, `ballPos` from `state.js`; constants; vec.
- Produces (Task 8 adds the dead-ball/downs half to this same file):
  - `tackleProbability(state, defender, car) → number in (0,1)` — pure, no rng.
  - `checkTackles(state, random) → events[]` — finds in-reach defender/carrier pairs, rolls; on success sets `state.deadReason = 'tackled'` (or fumbles: ball goes loose), on failure sets the defender's `tackleCooldown`. Events: `{ type: 'tackled', by } | { type: 'fumble', by } | { type: 'broken', by }`.
  - `checkPickup(state) → events[]` — a player touching a loose ball takes possession (`{ type: 'pickup', by, team }`); defensive recovery sets `state.deadReason = 'recovered'`.

- [ ] **Step 1: Write the failing tests**

`test/game/rules.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tackleProbability, checkTackles, checkPickup } from '../../lib/game/rules.js';
import { createGame, getPlayer, setMode } from '../../lib/game/state.js';
import { NEARBY_RADIUS } from '../../lib/game/constants.js';

/** A game trimmed to just the players a scenario names, carrier = QB. */
function scenario(ids) {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => ids.includes(p.id));
  return s;
}

test('spec: tucked runner vs one prepared defender, all else equal, is exactly 50/50', () => {
  const s = scenario(['o-qb', 'd-lb']); // same radius (3), both stationary
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 135, y: 105 };
  setMode(s, 'o-qb', 'tucked');
  setMode(s, 'd-lb', 'prepared');
  assert.equal(tackleProbability(s, lb, qb), 0.5);
});

test('a prepared defender tackles better than an unprepared one', () => {
  const s = scenario(['o-qb', 'd-lb']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 135, y: 105 };
  const before = tackleProbability(s, lb, qb);
  setMode(s, 'd-lb', 'prepared');
  assert.ok(tackleProbability(s, lb, qb) > before);
});

test('spec: more defenders in the immediate area make the tackle more likely', () => {
  const s = scenario(['o-qb', 'd-lb', 'd-s']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb'), sSaf = getPlayer(s, 'd-s');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 135, y: 105 };
  sSaf.pos = { x: 135, y: 300 }; // far away
  const alone = tackleProbability(s, lb, qb);
  sSaf.pos = { x: 135 + NEARBY_RADIUS - 1, y: 100 }; // in the area
  assert.ok(tackleProbability(s, lb, qb) > alone);
});

test('momentum matters: a fast-charging defender tackles better', () => {
  const s = scenario(['o-qb', 'd-lb']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 135, y: 105 };
  const still = tackleProbability(s, lb, qb);
  lb.vel = { x: 0, y: -20 };
  assert.ok(tackleProbability(s, lb, qb) > still);
});

test('checkTackles: reach matters — prepared defender attempts from farther out', () => {
  const s = scenario(['o-qb', 'd-lb']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 };
  lb.pos = { x: 135, y: 100 + 3 + 3 + 1.5 }; // 1.5 beyond touching: out of normal reach
  assert.deepEqual(checkTackles(s, () => 0), []);
  setMode(s, 'd-lb', 'prepared'); // reach +2.5 covers the gap
  const events = checkTackles(s, () => 0.99); // 0.99 > any p → tackle fails, but attempted
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'broken');
  assert.ok(lb.tackleCooldown > 0, 'broken tackle sets cooldown');
});

test('a successful roll downs the runner and ends the play', () => {
  const s = scenario(['o-qb', 'd-lb']);
  getPlayer(s, 'o-qb').pos = { x: 135, y: 100 };
  getPlayer(s, 'd-lb').pos = { x: 135, y: 105 };
  const events = checkTackles(s, () => 0); // 0 < p → success
  assert.equal(events[0].type, 'tackled');
  assert.equal(s.deadReason, 'tackled');
});

test('an untucked runner can fumble on the hit; the ball comes loose', () => {
  const s = scenario(['o-qb', 'd-lb']);
  getPlayer(s, 'o-qb').pos = { x: 135, y: 100 };
  getPlayer(s, 'd-lb').pos = { x: 135, y: 105 };
  // first roll (tackle) low → success; second roll (fumble) 0 → fumbles
  const rolls = [0, 0];
  const events = checkTackles(s, () => rolls.shift());
  assert.equal(events[0].type, 'fumble');
  assert.equal(s.ball.carrierId, null);
  assert.ok(s.ball.pos && s.ball.vel, 'ball is loose with a velocity');
  assert.equal(s.deadReason, null, 'a fumble keeps the play alive');
});

test('a tucked runner survives the same fumble roll', () => {
  const s = scenario(['o-qb', 'd-lb']);
  getPlayer(s, 'o-qb').pos = { x: 135, y: 100 };
  getPlayer(s, 'd-lb').pos = { x: 135, y: 105 };
  setMode(s, 'o-qb', 'tucked');
  const rolls = [0, 0.1]; // 0.1 > FUMBLE_TUCKED(0.05) but < FUMBLE_UNTUCKED(0.25)
  const events = checkTackles(s, () => rolls.shift());
  assert.equal(events[0].type, 'tackled');
});

test('pickups: offense recovering keeps the play alive, defense recovering kills it', () => {
  const off = scenario(['o-rb', 'd-s']);
  off.ball = { carrierId: null, pos: getPlayer(off, 'o-rb').pos, vel: { x: 0, y: 0 } };
  const e1 = checkPickup(off);
  assert.deepEqual(e1[0], { type: 'pickup', by: 'o-rb', team: 'offense' });
  assert.equal(off.ball.carrierId, 'o-rb');
  assert.equal(off.deadReason, null);

  const def = scenario(['o-rb', 'd-s']);
  def.ball = { carrierId: null, pos: getPlayer(def, 'd-s').pos, vel: { x: 0, y: 0 } };
  checkPickup(def);
  assert.equal(def.ball.carrierId, 'd-s');
  assert.equal(def.deadReason, 'recovered');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/game/rules.js'`

- [ ] **Step 3: Implement the tackle half of `lib/game/rules.js`**

```js
/**
 * Football rules: tackles, fumbles, pickups (this half), dead-ball, downs
 * and scoring (Task 8's half). Physics moves bodies; this file decides what
 * the contact means. All randomness comes in through `random`.
 */
import { sub, len, dist, scale, norm } from './vec.js';
import { reach, fumbleChance, effectiveMass } from './modes.js';
import { carrier, getPlayer, ballPos } from './state.js';
import {
  TACKLE_BASE, PREPARED_TACKLE_BONUS, TUCK_BREAK_BONUS,
  NEARBY_RADIUS, NEARBY_BONUS, MOMENTUM_SCALE,
  TACKLE_COOLDOWN_SUBSTEPS, FUMBLE_BALL_SPEED,
} from './constants.js';

/**
 * P(tackle succeeds) = tackleScore / (tackleScore + breakScore).
 *
 * The spec's balance point is engineered in, not tuned in: with both players
 * the same size and stationary, tucked-vs-prepared gives
 * (BASE + PREPARED_TACKLE_BONUS) vs (BASE + TUCK_BREAK_BONUS) = 2 vs 2 = 0.5
 * exactly. Momentum terms are symmetric (mass × speed on each side) so the
 * balance holds whenever "all other things" really are equal.
 */
export function tackleProbability(state, defender, car) {
  let tackle = TACKLE_BASE;
  if (defender.mode === 'prepared') tackle += PREPARED_TACKLE_BONUS;
  tackle += effectiveMass(defender) * len(defender.vel) * MOMENTUM_SCALE;
  const helpers = state.players.filter(
    (p) => p.team === 'defense' && p.id !== defender.id &&
      dist(p.pos, car.pos) <= NEARBY_RADIUS,
  ).length;
  tackle += helpers * NEARBY_BONUS;

  let breaks = TACKLE_BASE;
  if (car.mode === 'tucked') breaks += TUCK_BREAK_BONUS;
  breaks += effectiveMass(car) * len(car.vel) * MOMENTUM_SCALE;

  return tackle / (tackle + breaks);
}

function dropBall(state, car, random) {
  const angle = random() * 2 * Math.PI;
  state.ball = {
    carrierId: null,
    pos: { ...car.pos },
    vel: scale({ x: Math.cos(angle), y: Math.sin(angle) }, FUMBLE_BALL_SPEED),
  };
}

/**
 * One pass over defender/carrier pairs in tackle range. Called every physics
 * sub-step by turn.js, so cooldowns keep a broken tackle from re-rolling
 * thirty times in one contact.
 */
export function checkTackles(state, random) {
  const car = carrier(state);
  if (!car || state.deadReason) return [];
  const events = [];
  for (const d of state.players) {
    if (d.team !== 'defense' || d.tackleCooldown > 0) continue;
    if (dist(d.pos, car.pos) > reach(d) + car.radius) continue;
    if (random() < tackleProbability(state, d, car)) {
      if (random() < fumbleChance(car)) {
        dropBall(state, car, random);
        events.push({ type: 'fumble', by: d.id });
      } else {
        state.deadReason = 'tackled';
        events.push({ type: 'tackled', by: d.id });
      }
      return events; // one decisive event per sub-step is plenty
    }
    d.tackleCooldown = TACKLE_COOLDOWN_SUBSTEPS;
    events.push({ type: 'broken', by: d.id });
  }
  return events;
}

/** A loose ball is claimed by the first player touching it. */
export function checkPickup(state) {
  if (state.ball.carrierId !== null || !state.ball.pos || state.deadReason) return [];
  for (const p of state.players) {
    if (dist(p.pos, state.ball.pos) <= p.radius + 1) {
      state.ball = { carrierId: p.id, pos: null, vel: null };
      if (p.team === 'defense') state.deadReason = 'recovered';
      return [{ type: 'pickup', by: p.id, team: p.team }];
    }
  }
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/rules.js test/game/rules.test.js
git commit -m "feat: tackle resolution, fumbles, and loose-ball pickups"
```

---

### Task 8: Rules — dead ball, downs, scoring

**Files:**
- Modify: `lib/game/rules.js` (append)
- Test: `test/game/rules.test.js` (append)

**Interfaces:**
- Consumes: `yardsOfY`, `fieldPos`, `GOAL_YARD`, `TOP_YARD` from `view.js`; `SIDELINE_LEFT`, `SIDELINE_RIGHT` from `../field/geometry.js`; `formationPlayers` from `state.js`.
- Produces:
  - `checkDeadBall(state) → events[]` — touchdown (ball breaks the goal plane), out of bounds (carrier crosses a sideline). Sets `state.deadReason`.
  - `nextDown(state) → void` — called from the play-over screen: spots the ball, advances the down or ends the game. Sets `phase` to `'planning'` (new play, `turnIndex` 0, fresh formation at the new LOS, ball to QB) or `'gameOver'` with `state.result`.

- [ ] **Step 1: Append the failing tests to `test/game/rules.test.js`**

```js
import { checkDeadBall, nextDown } from '../../lib/game/rules.js';
import { fieldPos, GOAL_YARD } from '../../lib/game/view.js';
import { SIDELINE_LEFT } from '../../lib/field/geometry.js';
import { createGame as freshGame } from '../../lib/game/state.js';

test('touchdown: the ball crossing the goal plane ends everything', () => {
  const s = freshGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  qb.pos = { x: 135, y: fieldPos(0, GOAL_YARD).y + 1 };
  const events = checkDeadBall(s);
  assert.equal(events[0].type, 'touchdown');
  assert.equal(s.deadReason, 'touchdown');
  nextDown(s);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result, 'touchdown');
});

test('the carrier stepping out of bounds kills the play', () => {
  const s = freshGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  qb.pos = { x: SIDELINE_LEFT - 1, y: fieldPos(0, 2).y };
  const events = checkDeadBall(s);
  assert.equal(events[0].type, 'out-of-bounds');
  assert.equal(s.deadReason, 'out-of-bounds');
});

test('between downs: ball is spotted where it died, down advances, formation resets there', () => {
  const s = freshGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  qb.pos = { x: 150, y: fieldPos(0, 4).y };
  s.deadReason = 'tackled';
  s.turnIndex = 5;
  nextDown(s);
  assert.equal(s.down, 2);
  assert.equal(s.losYard, 4);
  assert.equal(s.phase, 'planning');
  assert.equal(s.turnIndex, 0);
  assert.equal(s.ball.carrierId, 'o-qb');
  assert.equal(s.deadReason, null);
  // the new formation is planted around the new LOS
  const c = getPlayer(s, 'o-c');
  assert.ok(Math.abs(c.pos.y - fieldPos(0, 3).y) < 1e-9, 'centre one yard behind the new LOS');
});

test('failing on 4th down is a turnover on downs', () => {
  const s = freshGame({ seed: 1 });
  s.down = 4;
  getPlayer(s, 'o-qb').pos = fieldPos(0, 2);
  s.deadReason = 'tackled';
  nextDown(s);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result, 'turnover-on-downs');
});

test('a defensive recovery ends the game as a turnover', () => {
  const s = freshGame({ seed: 1 });
  s.ball = { carrierId: 'd-s', pos: null, vel: null };
  s.deadReason = 'recovered';
  nextDown(s);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result, 'turnover-fumble');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `checkDeadBall`/`nextDown` are not exported

- [ ] **Step 3: Append to `lib/game/rules.js`**

```js
import { yardsOfY, fieldPos, GOAL_YARD, TOP_YARD } from './view.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT } from '../field/geometry.js';
import { formationPlayers } from './state.js';

/** Touchdown and out-of-bounds. Tackles and recoveries set deadReason themselves. */
export function checkDeadBall(state) {
  if (state.deadReason) return [];
  const car = carrier(state);
  const bp = ballPos(state);
  if (!bp) return [];
  // The plane is broken by the ball, drawn at the carrier's leading edge.
  const ballFrontY = car ? bp.y + car.radius : bp.y;
  if (car && car.team === 'offense' && yardsOfY(ballFrontY) >= GOAL_YARD) {
    state.deadReason = 'touchdown';
    return [{ type: 'touchdown' }];
  }
  if (car && (car.pos.x < SIDELINE_LEFT || car.pos.x > SIDELINE_RIGHT)) {
    state.deadReason = 'out-of-bounds';
    return [{ type: 'out-of-bounds' }];
  }
  return [];
}

/**
 * The between-downs bookkeeping. Spot = the ball's yard when the play died,
 * clamped so a deep sack can't push the formation out of frame.
 */
export function nextDown(state) {
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
  if (state.down >= 4) {
    state.phase = 'gameOver';
    state.result = 'turnover-on-downs';
    return;
  }
  const spot = Math.max(TOP_YARD + 8, Math.min(GOAL_YARD - 0.5, yardsOfY(ballPos(state).y)));
  state.down += 1;
  state.losYard = spot;
  state.phase = 'planning';
  state.turnIndex = 0;
  state.players = formationPlayers(spot);
  state.ball = { carrierId: 'o-qb', pos: null, vel: null };
  state.deadReason = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/rules.js test/game/rules.test.js
git commit -m "feat: dead-ball detection, down progression, scoring, game over"
```

---

### Task 9: Turn execution

**Files:**
- Create: `lib/game/turn.js`
- Test: `test/game/turn.test.js`

**Interfaces:**
- Consumes: `stepPhysics` (Task 5–6), `checkTackles`/`checkPickup`/`checkDeadBall` (Task 7–8), constants, state helpers.
- Produces: `runTurn(state, random) → { frames, events }`. Mutates `state` to the end-of-turn position. `frames` is one snapshot per sub-step for the animation: `{ players: [{ id, x, y }], ball: { x, y } | null }`. After the call, `state.phase` is `'planning'` (play continues — plans kept so unchanged arrows persist? No: plans persist by design, the user edits the ones they want) or `'playOver'`. `unplannedPlayers(state) → id[]` powers the spec's warning.

- [ ] **Step 1: Write the failing tests**

`test/game/turn.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, unplannedPlayers } from '../../lib/game/turn.js';
import { createGame, setPlan, getPlayer } from '../../lib/game/state.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { SUBSTEPS_PER_TURN, TEAM_SIZE } from '../../lib/game/constants.js';
import { fieldPos, GOAL_YARD } from '../../lib/game/view.js';

test('a turn produces one frame per sub-step and moves planned players', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const y0 = getPlayer(s, 'o-rb').pos.y;
  const { frames } = runTurn(s, mulberry32(1));
  assert.equal(frames.length, SUBSTEPS_PER_TURN);
  assert.ok(getPlayer(s, 'o-rb').pos.y > y0);
  assert.equal(s.phase, 'planning');
  assert.equal(s.turnIndex, 1);
});

test('velocity persists into the next turn (momentum carries)', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  runTurn(s, mulberry32(1));
  const v = getPlayer(s, 'o-rb').vel.y;
  assert.ok(v > 0, 'still moving after the turn ends');
});

test('charge is consumed by the turn that uses it', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-qb').charge = 1;
  runTurn(s, mulberry32(1));
  assert.equal(getPlayer(s, 'o-qb').charge, 0);
});

test('a clean run to the end zone ends the turn early with a touchdown', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb'); // no defense in the way
  const qb = getPlayer(s, 'o-qb');
  qb.pos = fieldPos(0, GOAL_YARD - 0.5);
  qb.vel = { x: 0, y: 20 };
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  const { frames, events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'touchdown'));
  assert.equal(s.phase, 'playOver');
  assert.ok(frames.length < SUBSTEPS_PER_TURN, 'stopped at the whistle');
});

test('a full scripted play: everyone charges, somebody eventually gets tackled', () => {
  const s = createGame({ seed: 3 });
  for (const p of s.players) {
    setPlan(s, p.id, { x: 0, y: p.team === 'offense' ? 1 : -1 }, 1);
  }
  const random = mulberry32(3);
  let turns = 0;
  while (s.phase !== 'playOver' && turns < 40) {
    runTurn(s, random);
    turns += 1;
  }
  assert.equal(s.phase, 'playOver');
  assert.ok(s.deadReason, `play ended by ${s.deadReason}`);
});

test('unplannedPlayers lists everyone without an arrow (the warning feed)', () => {
  const s = createGame({ seed: 1 });
  assert.equal(unplannedPlayers(s).length, TEAM_SIZE * 2);
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const ids = unplannedPlayers(s);
  assert.equal(ids.length, TEAM_SIZE * 2 - 1);
  assert.ok(!ids.includes('o-rb'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/game/turn.js'`

- [ ] **Step 3: Implement `lib/game/turn.js`**

```js
/**
 * One half-second turn: SUBSTEPS_PER_TURN physics sub-steps, rules checked
 * after each, stopping at the whistle. Pure with respect to time and
 * randomness — the caller supplies `random`, and frames come back as data
 * for app/main.js to animate.
 */
import { stepPhysics } from './physics.js';
import { checkTackles, checkPickup, checkDeadBall } from './rules.js';
import { ballPos } from './state.js';
import { DT, SUBSTEPS_PER_TURN } from './constants.js';

function snapshot(state) {
  const bp = ballPos(state);
  return {
    players: state.players.map((p) => ({ id: p.id, x: p.pos.x, y: p.pos.y })),
    ball: bp ? { x: bp.x, y: bp.y } : null,
  };
}

export function unplannedPlayers(state) {
  return state.players.filter((p) => p.plan === null).map((p) => p.id);
}

export function runTurn(state, random) {
  state.phase = 'running';
  const frames = [];
  const events = [];
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) {
    stepPhysics(state, DT);
    events.push(...checkTackles(state, random));
    events.push(...checkPickup(state));
    events.push(...checkDeadBall(state));
    frames.push(snapshot(state));
    if (state.deadReason) break;
  }
  for (const p of state.players) p.charge = 0; // the burst lasts one turn (spec)
  state.turnIndex += 1;
  state.phase = state.deadReason ? 'playOver' : 'planning';
  return { frames, events };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. The scripted-play test may need a different seed if that seed happens to run 40 turns without a whistle — pick the first seed that ends the play and pin it.

- [ ] **Step 5: Commit**

```bash
git add lib/game/turn.js test/game/turn.test.js
git commit -m "feat: turn execution — sub-stepped simulation with frames and events"
```

---

### Task 10: Rendering game marks

**Files:**
- Create: `lib/game/render.js`
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: `renderField`, `STYLE`, `DEFS`, `VIEWBOX_WIDTH` (vendored); `gameView` from `view.js`; `reach` from `modes.js`; state helpers.
- Produces:
  - `renderBoardShell(losYard) → { viewBox, markup }` — style, defs, field layer, and empty `game-arrows` / `game-players` / `game-overlay` groups.
  - `renderPlayers(state) → markup` — per player, a `<g class="gp" data-id="...">` translated to its position (so animation moves the `transform`, never re-serialises the shape) holding: the circle (`class="gp-o"` offense filled, `"gp-d"` defense open), the role letter, the quarter-circle stance arc when `prepared` or `holding` (spec's visual signal), and the football when this player carries it — inside the circle when tucked, at the leading edge when not (spec).
  - `renderLooseBall(state) → markup` — the football at `state.ball.pos`, or `''`.
  - `renderArrows(state) → markup` — each planned player's arrow: a `class="mv"` path with the vendored `#ar` arrowhead, length ∝ throttle × `MAX_ARROW_UNITS`.
  - `STYLE_GAME` — the game's own `<style>` additions.
  - `facingAngle(player) → radians` — plan direction if set, else velocity, else downfield for offense / upfield for defense.

- [ ] **Step 1: Write the failing tests**

`test/game/render.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderBoardShell, renderPlayers, renderArrows, renderLooseBall, facingAngle, STYLE_GAME,
} from '../../lib/game/render.js';
import { createGame, setPlan, setMode, getPlayer } from '../../lib/game/state.js';
import { TEAM_SIZE, MAX_ARROW_UNITS } from '../../lib/game/constants.js';

test('the board shell has the field and three empty game layers', () => {
  const { viewBox, markup } = renderBoardShell(0);
  assert.match(viewBox, /^0 0 270 /);
  for (const id of ['game-field', 'game-arrows', 'game-players', 'game-overlay']) {
    assert.ok(markup.includes(`id="${id}"`), id);
  }
  assert.ok(markup.includes(STYLE_GAME));
});

test('every player renders as a positioned group with a team-classed circle of its own radius', () => {
  const s = createGame({ seed: 1 });
  const svg = renderPlayers(s);
  assert.equal((svg.match(/data-id="/g) || []).length, TEAM_SIZE * 2);
  assert.ok(svg.includes('data-id="o-rb"'));
  assert.ok(svg.includes('class="gp-o"'));
  assert.ok(svg.includes('class="gp-d"'));
  assert.ok(svg.includes('r="2.5"'), 'skill radius');
  assert.ok(svg.includes('r="3.5"'), 'line radius');
  assert.ok(/translate\(/.test(svg), 'groups are placed by transform');
});

test('the carrier shows the football; tucking moves it inside the circle', () => {
  const s = createGame({ seed: 1 });
  const untucked = renderPlayers(s);
  assert.equal((untucked.match(/class="fb"/g) || []).length, 1, 'exactly one ball');
  const qb = getPlayer(s, 'o-qb');
  // untucked: the ball sits at the leading edge, outside-ish
  assert.ok(untucked.includes(`data-id="o-qb"`));
  setMode(s, 'o-qb', 'tucked');
  const tucked = renderPlayers(s);
  // tucked: the ball ellipse is drawn at the group origin (inside the circle)
  assert.ok(tucked.includes('<ellipse cx="0" cy="0"'), 'tucked ball centred in the player');
});

test('prepared and holding players get the quarter-circle stance arc', () => {
  const s = createGame({ seed: 1 });
  assert.ok(!renderPlayers(s).includes('class="stance"'));
  setMode(s, 'd-lb', 'prepared');
  setMode(s, 'o-c', 'holding');
  const svg = renderPlayers(s);
  assert.equal((svg.match(/class="stance"/g) || []).length, 2);
});

test('arrows render only for planned players, scaled by throttle', () => {
  const s = createGame({ seed: 1 });
  assert.equal(renderArrows(s), '');
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const full = renderArrows(s);
  assert.ok(full.includes('marker-end="url(#ar)"'));
  const rb = getPlayer(s, 'o-rb');
  assert.ok(full.includes(`${rb.pos.y + MAX_ARROW_UNITS}`), 'full throttle = full length');
});

test('a loose ball renders on its own; a carried one does not', () => {
  const s = createGame({ seed: 1 });
  assert.equal(renderLooseBall(s), '');
  s.ball = { carrierId: null, pos: { x: 100, y: 100 }, vel: { x: 0, y: 0 } };
  assert.ok(renderLooseBall(s).includes('class="fb"'));
});

test('facing: plan first, then velocity, then a team default', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  assert.equal(facingAngle(rb), Math.PI / 2); // offense default: downfield (+y)
  rb.vel = { x: 1, y: 0 };
  assert.equal(facingAngle(rb), 0);
  setPlan(s, 'o-rb', { x: 0, y: -1 }, 1);
  assert.equal(facingAngle(rb), -Math.PI / 2);
  const lb = getPlayer(s, 'd-lb');
  assert.equal(facingAngle(lb), -Math.PI / 2); // defense default: upfield (-y)
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/game/render.js'`

- [ ] **Step 3: Implement `lib/game/render.js`**

```js
/**
 * Everything the game paints, as strings — same discipline as the vendored
 * renderer, so `node --test` can assert on markup without a DOM. app/main.js
 * writes these into the layer groups; per-frame animation only rewrites the
 * `transform` of each player group.
 */
import { VIEWBOX_WIDTH } from '../field/geometry.js';
import { renderField } from '../field/field.js';
import { STYLE, DEFS } from '../field/style.js';
import { num } from '../field/geometry.js';
import { gameView } from './view.js';
import { reach } from './modes.js';
import { MAX_ARROW_UNITS } from './constants.js';

export const STYLE_GAME = [
  '.gp-o{fill:#222;stroke:#000;stroke-width:.6}',
  '.gp-d{fill:#fff;stroke:#000;stroke-width:.8}',
  '.gp-role{font:3px sans-serif;text-anchor:middle;fill:#fff;pointer-events:none}',
  '.gp-d + .gp-role, .gp-role.on-d{fill:#000}',
  '.stance{fill:none;stroke:#000;stroke-width:.7;stroke-dasharray:1.5 1}',
  '.fb{fill:#7b4a12;stroke:#000;stroke-width:.4}',
  '.plan-arrow{opacity:.85}',
].join('');

export function renderBoardShell(losYard) {
  const view = gameView(losYard);
  const { svg, height } = renderField(view);
  return {
    viewBox: `0 0 ${VIEWBOX_WIDTH} ${height}`,
    markup:
      `<style>${STYLE}${STYLE_GAME}</style>${DEFS}` +
      `<g id="game-field">${svg}</g>` +
      `<g id="game-arrows"></g><g id="game-players"></g><g id="game-overlay"></g>`,
  };
}

export function facingAngle(player) {
  if (player.plan) return Math.atan2(player.plan.dir.y, player.plan.dir.x);
  if (player.vel.x !== 0 || player.vel.y !== 0) return Math.atan2(player.vel.y, player.vel.x);
  return player.team === 'offense' ? Math.PI / 2 : -Math.PI / 2;
}

/** A quarter-circle (±45° around facing) at stance reach — the spec's signal. */
function stanceArc(player) {
  const r = reach(player) + 1;
  const a0 = facingAngle(player) - Math.PI / 4;
  const a1 = facingAngle(player) + Math.PI / 4;
  const p0 = { x: r * Math.cos(a0), y: r * Math.sin(a0) };
  const p1 = { x: r * Math.cos(a1), y: r * Math.sin(a1) };
  return `<path class="stance" d="M ${num(p0.x)} ${num(p0.y)} A ${num(r)} ${num(r)} 0 0 1 ${num(p1.x)} ${num(p1.y)}"/>`;
}

/** The football, drawn about (cx, cy) in the player group's local space. */
function football(cx, cy, angle) {
  return `<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="1.6" ry="0.9" class="fb" transform="rotate(${num((angle * 180) / Math.PI)} ${num(cx)} ${num(cy)})"/>`;
}

function playerMark(player, isCarrier, tucked) {
  const cls = player.team === 'offense' ? 'gp-o' : 'gp-d';
  const parts = [`<circle cx="0" cy="0" r="${num(player.radius)}" class="${cls}"/>`];
  parts.push(`<text x="0" y="1" class="gp-role${player.team === 'defense' ? ' on-d' : ''}">${player.role}</text>`);
  if (player.mode === 'prepared' || player.mode === 'holding') parts.push(stanceArc(player));
  if (isCarrier) {
    const angle = facingAngle(player);
    if (tucked) parts.push(football(0, 0, angle));
    else parts.push(football(player.radius * Math.cos(angle), player.radius * Math.sin(angle), angle));
  }
  return (
    `<g class="gp" data-id="${player.id}" transform="translate(${num(player.pos.x)}, ${num(player.pos.y)})">` +
    parts.join('') +
    `</g>`
  );
}

export function renderPlayers(state) {
  return state.players
    .map((p) => playerMark(p, state.ball.carrierId === p.id, p.mode === 'tucked'))
    .join('');
}

export function renderLooseBall(state) {
  if (state.ball.carrierId !== null || !state.ball.pos) return '';
  return football(state.ball.pos.x, state.ball.pos.y, 0);
}

export function renderArrows(state) {
  return state.players
    .filter((p) => p.plan)
    .map((p) => {
      const tip = {
        x: p.pos.x + p.plan.dir.x * p.plan.throttle * MAX_ARROW_UNITS,
        y: p.pos.y + p.plan.dir.y * p.plan.throttle * MAX_ARROW_UNITS,
      };
      return `<g class="plan-arrow" data-for="${p.id}"><path d="M ${num(p.pos.x)} ${num(p.pos.y)} L ${num(tip.x)} ${num(tip.y)}" class="mv" marker-end="url(#ar)"/></g>`;
    })
    .join('');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. If the full-throttle arrow-length assertion trips on `num()` rounding, assert against `num(rb.pos.y + MAX_ARROW_UNITS)` instead — the point is length ∝ throttle.

- [ ] **Step 5: Commit**

```bash
git add lib/game/render.js test/game/render.test.js
git commit -m "feat: render players, ball, stance arcs, and planning arrows"
```

---

### Task 11: Gesture classification

**Files:**
- Create: `lib/game/gesture.js`
- Test: `test/game/gesture.test.js`

**Interfaces:**
- Consumes: vec.
- Produces: `classifyGesture(log) → { kind: 'click' } | { kind: 'longpress' } | { kind: 'drag', dir: {x,y}, throttle }` where `log` is `[{ t, x, y }, ...]` — first entry is pointer-down, last is pointer-up, times in ms, coordinates in SVG units. This keeps every timing/threshold decision testable; `app/input.js` (Task 12) just records the log and dispatches on the result. Constants exported for the app's live preview: `DRAG_MIN_UNITS = 4`, `LONGPRESS_MS = 500`.

- [ ] **Step 1: Write the failing tests**

`test/game/gesture.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGesture, DRAG_MIN_UNITS, LONGPRESS_MS } from '../../lib/game/gesture.js';
import { MAX_ARROW_UNITS } from '../../lib/game/constants.js';

test('a quick tap with no movement is a click', () => {
  const g = classifyGesture([{ t: 0, x: 10, y: 10 }, { t: 120, x: 10.5, y: 10 }]);
  assert.deepEqual(g, { kind: 'click' });
});

test('holding still past the threshold is a longpress', () => {
  const g = classifyGesture([{ t: 0, x: 10, y: 10 }, { t: LONGPRESS_MS + 50, x: 11, y: 10 }]);
  assert.deepEqual(g, { kind: 'longpress' });
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
    { t: LONGPRESS_MS * 2, x: 20, y: 0 },
  ]);
  assert.equal(g.kind, 'drag');
});

test('tiny drags below the threshold fall back to click', () => {
  const g = classifyGesture([{ t: 0, x: 0, y: 0 }, { t: 100, x: DRAG_MIN_UNITS - 1, y: 0 }]);
  assert.deepEqual(g, { kind: 'click' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/game/gesture.js'`

- [ ] **Step 3: Implement `lib/game/gesture.js`**

```js
/**
 * Pointer-log → intent. The spec's three verbs on a player are a click
 * (reposition, pre-snap only), a hold-and-drag (set direction and force),
 * and a long press (toggle a stance mode). Movement beats duration: a slow
 * deliberate drag must never register as a long press.
 */
import { sub, len, norm } from './vec.js';
import { MAX_ARROW_UNITS } from './constants.js';

export const DRAG_MIN_UNITS = 4;
export const LONGPRESS_MS = 500;

export function classifyGesture(log) {
  const down = log[0];
  const up = log[log.length - 1];
  const travel = sub(up, down);
  if (len(travel) >= DRAG_MIN_UNITS) {
    return {
      kind: 'drag',
      dir: norm(travel),
      throttle: Math.min(1, len(travel) / MAX_ARROW_UNITS),
    };
  }
  if (up.t - down.t >= LONGPRESS_MS) return { kind: 'longpress' };
  return { kind: 'click' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/gesture.js test/game/gesture.test.js
git commit -m "feat: pointer gesture classifier — click, drag with force, long press"
```

---

### Task 12: The app — input wiring, turn animation, HUD

This task is DOM code, so its verification is a manual browser checklist rather than `node --test`. Keep the files thin: any logic you're tempted to write here that doesn't need the DOM belongs in `lib/game/` with a test.

**Files:**
- Create: `app/input.js`
- Modify: `app/main.js` (replace the Task 1 placeholder entirely)
- Modify: `index.html` (no structural change expected; adjust only if a hook is missing)

**Interfaces:**
- Consumes: everything: `createGame`, `setPlan`, `setMode`, `placePlayer`, `clearAllPlans`, `getPlayer`, `carrier` (state); `runTurn`, `unplannedPlayers` (turn); `nextDown` (rules); `renderBoardShell`, `renderPlayers`, `renderArrows`, `renderLooseBall` (render); `classifyGesture` (gesture); `mulberry32` (rng); `TURN_SECONDS`, `SUBSTEPS_PER_TURN` (constants); `SVG` from the vendored `app/vendor/svg.esm.js`, used for every DOM read/write in this task — element selection, injecting the markup strings `render.js` produces, per-frame transforms, and pointer→SVG coordinate conversion.
- Produces: the playable page. `input.js` exports `attachInput(board, handlers)` where `board` is the SVG.js-wrapped root element (not a raw `SVGSVGElement`) and `handlers = { onGesture(playerId, gesture, svgPoint) }`; `main.js` owns all state and rendering, and never touches `document`/`querySelector`/`innerHTML` directly — always through the `board` wrapper.

SVG.js's exact method names below (`.point()`, `.svg()`, `.transform()`, `.on()`) match the 3.2.x API this plan pinned in Task 1; if the vendored version drifts, check `app/vendor/svg.esm.js`'s exports against [svgjs.dev/docs](https://svgjs.dev/docs/3.2/) before assuming a call is wrong.

- [ ] **Step 1: Implement `app/input.js`**

```js
/**
 * Pointer plumbing built on the vendored SVG.js wrapper: `board.point()`
 * converts a pointer event's screen coordinates into the board's local SVG
 * coordinates (replacing hand-rolled createSVGPoint/getScreenCTM math), and
 * `board.on()` wraps addEventListener. All decisions about what a gesture
 * MEANS live in lib/game/ — this file only observes and reports.
 */
import { classifyGesture, DRAG_MIN_UNITS } from '../lib/game/gesture.js';

export function attachInput(board, { hitTest, onGesture, onDragPreview }) {
  let log = null;
  let playerId = null;

  board.on('pointerdown', (e) => {
    const p = board.point(e.clientX, e.clientY);
    playerId = hitTest(p);
    if (!playerId) return;
    log = [{ t: e.timeStamp, ...p }];
    board.node.setPointerCapture(e.pointerId); // pointer capture has no SVG.js wrapper; use the raw node
    e.preventDefault();
  });

  board.on('pointermove', (e) => {
    if (!log) return;
    const p = board.point(e.clientX, e.clientY);
    log.push({ t: e.timeStamp, ...p });
    onDragPreview(playerId, log);
  });

  board.on('pointerup', (e) => {
    if (!log) return;
    const p = board.point(e.clientX, e.clientY);
    log.push({ t: e.timeStamp, ...p });
    onGesture(playerId, classifyGesture(log), p);
    log = null;
    playerId = null;
  });

  board.on('pointercancel', () => {
    log = null;
    playerId = null;
    onDragPreview(null, null);
  });
}
```

- [ ] **Step 2: Implement `app/main.js`** (full replacement of the Task 1 stub)

```js
import { SVG } from './vendor/svg.esm.js';
import {
  createGame, setPlan, setMode, placePlayer, getPlayer, clearAllPlans,
} from '../lib/game/state.js';
import { runTurn, unplannedPlayers } from '../lib/game/turn.js';
import { nextDown } from '../lib/game/rules.js';
import {
  renderBoardShell, renderPlayers, renderArrows, renderLooseBall,
} from '../lib/game/render.js';
import { classifyGesture } from '../lib/game/gesture.js';
import { mulberry32 } from '../lib/game/rng.js';
import { TURN_SECONDS, MAX_ARROW_UNITS } from '../lib/game/constants.js';
import { attachInput } from './input.js';

// SVG(el) adopts the existing <svg id="board"> node rather than creating a
// nested one — every read/write below goes through this wrapper.
const board = SVG(document.getElementById('board'));
const hud = document.getElementById('hud');
const message = document.getElementById('message');
const runBtn = document.getElementById('run');
const clearBtn = document.getElementById('clear');
const nextBtn = document.getElementById('next');
const newBtn = document.getElementById('new');

let state = createGame({ seed: (Math.random() * 2 ** 31) | 0 });
let random = mulberry32(state.seed);
let pendingWarning = false;

function layer(id) {
  return board.findOne(`#${id}`);
}

function rebuildBoard() {
  const { viewBox, markup } = renderBoardShell(state.losYard);
  board.attr('viewBox', viewBox);
  board.clear();
  board.svg(markup); // parses the markup string from render.js and inserts it as real SVG nodes
}

function paint() {
  layer('game-players').clear().svg(renderPlayers(state) + renderLooseBall(state));
  layer('game-arrows').clear().svg(state.phase === 'planning' ? renderArrows(state) : '');
  hud.textContent = `Down ${state.down} of 4 — ${state.phase}`;
  runBtn.disabled = state.phase !== 'planning';
  nextBtn.hidden = state.phase !== 'playOver';
}

function say(text) {
  message.textContent = text;
}

function hitTest(p) {
  let best = null;
  let bestD = Infinity;
  for (const pl of state.players) {
    const d = Math.hypot(pl.pos.x - p.x, pl.pos.y - p.y);
    if (d <= pl.radius + 2 && d < bestD) { best = pl.id; bestD = d; }
  }
  return best;
}

function onGesture(playerId, gesture, point) {
  layer('game-overlay').clear();
  if (state.phase !== 'planning') return;
  const p = getPlayer(state, playerId);
  if (gesture.kind === 'drag') {
    setPlan(state, playerId, gesture.dir, gesture.throttle);
    pendingWarning = false;
    say('');
  } else if (gesture.kind === 'longpress') {
    const target =
      p.mode !== 'normal' ? 'normal'
      : state.ball.carrierId === playerId ? 'tucked'
      : p.team === 'defense' ? 'prepared'
      : 'holding';
    if (!setMode(state, playerId, target)) say(`${p.role} can't do that.`);
    else say(target === 'normal' ? `${p.role} back to normal.` : `${p.role}: ${target}.`);
  } else if (gesture.kind === 'click') {
    if (!placePlayer(state, playerId, point)) {
      say(state.turnIndex === 0
        ? `${p.role} has to set up on their own side of the line.`
        : 'Repositioning is only allowed before the play starts.');
    }
  }
  paint();
}

function onDragPreview(playerId, log) {
  if (!playerId || !log || state.phase !== 'planning') {
    layer('game-overlay').clear();
    return;
  }
  const g = classifyGesture(log);
  if (g.kind !== 'drag') return;
  const p = getPlayer(state, playerId);
  const tipX = p.pos.x + g.dir.x * g.throttle * MAX_ARROW_UNITS;
  const tipY = p.pos.y + g.dir.y * g.throttle * MAX_ARROW_UNITS;
  layer('game-overlay').clear().svg(
    `<path d="M ${p.pos.x} ${p.pos.y} L ${tipX} ${tipY}" class="mv" marker-end="url(#ar)"/>`,
  );
}

function animate(frames, done) {
  const perFrame = (TURN_SECONDS * 1000) / frames.length;
  let i = 0;
  function tick() {
    const frame = frames[i];
    for (const fp of frame.players) {
      const g = layer('game-players').findOne(`[data-id="${fp.id}"]`);
      if (g) g.transform({ translate: [fp.x, fp.y] });
    }
    i += 1;
    if (i < frames.length) setTimeout(() => requestAnimationFrame(tick), perFrame);
    else done();
  }
  requestAnimationFrame(tick);
}

runBtn.addEventListener('click', () => {
  if (state.phase !== 'planning') return;
  const missing = unplannedPlayers(state);
  if (missing.length > 0 && !pendingWarning) {
    // Spec: warn when not every player has a direction. Second press runs anyway.
    pendingWarning = true;
    say(`${missing.length} player(s) have no direction set. Press Run Turn again to run anyway.`);
    return;
  }
  pendingWarning = false;
  say('');
  // runTurn mutates state to the end-of-turn position and returns the
  // per-sub-step frames; the player groups are still painted at their
  // pre-turn spots, so animating the frames walks them to where state says.
  const { frames, events } = runTurn(state, random);
  layer('game-arrows').clear();
  const finish = () => {
    paint();
    for (const e of events) {
      if (e.type === 'tackled') say('Tackled!');
      if (e.type === 'fumble') say('FUMBLE! The ball is loose!');
      if (e.type === 'touchdown') say('TOUCHDOWN!');
      if (e.type === 'out-of-bounds') say('Out of bounds.');
      if (e.type === 'pickup') say(`Recovered by ${e.team}.`);
    }
  };
  if (frames.length > 0) animate(frames, finish);
  else finish();
});

clearBtn.addEventListener('click', () => {
  if (state.phase !== 'planning') return;
  clearAllPlans(state);
  pendingWarning = false;
  paint();
});

nextBtn.addEventListener('click', () => {
  nextDown(state);
  if (state.phase === 'gameOver') {
    say(state.result === 'touchdown' ? 'TOUCHDOWN — you win!'
      : state.result === 'turnover-on-downs' ? 'Turnover on downs. Game over.'
      : 'Fumble recovered by the defense. Game over.');
  } else {
    say(`${['1st', '2nd', '3rd', '4th'][state.down - 1]} down.`);
    rebuildBoard();
  }
  paint();
});

newBtn.addEventListener('click', () => {
  state = createGame({ seed: (Math.random() * 2 ** 31) | 0 });
  random = mulberry32(state.seed);
  pendingWarning = false;
  say('New game. 1st and goal from the 10.');
  rebuildBoard();
  paint();
});

attachInput(board, { hitTest, onGesture, onDragPreview });
rebuildBoard();
paint();
```

The listing imports exactly what it calls. If a hook id in `index.html` turns out to be missing (Task 1 created them all), add it there rather than querying defensively here.

- [ ] **Step 3: Run the automated suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS (app files aren't under test, but the refactor-while-wiring step often touches lib/ — this catches it)

- [ ] **Step 4: Manual browser checklist**

Run: `npm run serve`, open http://localhost:8080, and verify each of these:

1. Fourteen players line up either side of the LOS at yard 0; the QB shows a small brown football at his leading edge.
2. Click an offensive player, then click empty ground — nothing (clicks on grass don't start gestures). Click-drag a WR a few yards left pre-snap: the player moves. Try to drop him past the LOS: refused with a message.
3. Hold and drag from the RB downfield: a live arrow preview follows the pointer; on release the arrow stays. Longer drags draw longer arrows (capped).
4. Press **Run Turn** with most players unplanned: a warning names the count; pressing again runs anyway. Planned players move for half a second, smoothly; unplanned ones drift/stay.
5. Momentum: give the RB a full arrow, run two turns, then clear arrows and run a third — he keeps sliding forward, slowing.
6. Long-press the QB (carrier): message says tucked; the football moves inside his circle; his top speed visibly drops next turn.
7. Long-press a defender: quarter-circle arc appears facing his direction of travel; he crawls while prepared.
8. Long-press an offensive lineman: arc appears; run a defender into him — the lineman barely budges.
9. Steer the carrier into a lone defender repeatedly: sometimes tackled (message, play over, **Next Down** appears), sometimes through. With two defenders converging, tackles land noticeably more often.
10. After a tackle, **Next Down** re-forms both teams at the new spot with the down counter advanced; after a 4th-down stop, the game-over message shows; **New Game** resets everything.
11. Get the carrier across the goal line: TOUCHDOWN message, game over.
12. No console errors through all of the above.

Fix what fails before committing; anything that needs game-logic changes gets a failing test in the right `test/game/*.test.js` first.

- [ ] **Step 5: Commit**

```bash
git add app/input.js app/main.js index.html
git commit -m "feat: playable app — planning input, turn animation, downs and scoring HUD"
```

---

### Task 13: Playtest tuning and README

**Files:**
- Modify: `lib/game/constants.js` (numbers only)
- Modify: `README.md`
- Test: existing suite must stay green

**Interfaces:**
- Consumes: the whole game.
- Produces: a tuned, documented v1.

- [ ] **Step 1: Play at least three full games** using the Task 12 checklist's scenarios as drills. Judge against the spec's feel claims, and adjust only `constants.js`:
  - A skill player should cross the 30-yard frame in roughly 4–5 turns at full throttle (spec: half-second turns should feel brisk, not teleporting). Tune `SPEED_FACTOR`.
  - Blocking should hold a rusher for 1–2 turns, not forever. Tune `FRICTION_BLOCK`.
  - A lone unprepared defender should be a coin-flip-or-worse against a moving runner; two defenders should usually bring him down. Tune `NEARBY_BONUS` / `MOMENTUM_SCALE`.
  - Fumbles should feel punishing-but-rare untucked, negligible tucked. Tune the two `FUMBLE_*` values.
  - **Do not** change `PREPARED_TACKLE_BONUS` or `TUCK_BREAK_BONUS` independently — their equality is what makes the spec's tucked-vs-prepared 50/50 hold, and `rules.test.js` will fail if broken.

- [ ] **Step 2: Run the suite after each tuning change**

Run: `npm test`
Expected: PASS every time. Any constant change that breaks a test means the test encoded the old number — update the test only if it asserted a raw value rather than a relationship, and prefer rewriting it as a relationship.

- [ ] **Step 3: Rewrite `README.md`** — keep the original two spec paragraphs under a "Design notes" heading, and add above them: what the game is, how to run it (`npm run serve`, open localhost:8080), how to play (click to place pre-snap, drag for direction/force, long-press for tuck / prepare / hold, Run Turn, 4 downs from the 10), and how to run the tests (`npm test`). Also state the v1 interpretation decisions (both teams user-controlled, no passing, `TEAM_SIZE` = 7).

- [ ] **Step 4: Commit**

```bash
git add lib/game/constants.js README.md
git commit -m "feat: playtest tuning pass and player-facing README"
```

---

## Self-Review

**Spec coverage** — every README claim mapped to a task:

| Spec line | Where |
| --- | --- |
| HTML/SVG game using the play-draw field | Task 1 (vendored renderer, board shell) |
| Click to move position, only at start of play | Task 3 `placePlayer` (turn 0 guard), Task 12 click handling |
| Hold a player and draw a direction; arrow shows direction and force | Task 11 drag gesture, Task 10 `renderArrows`, Task 12 preview |
| Can be reset | Task 12 Clear Arrows + drag-replaces-drag (Task 3 `setPlan`) |
| Size dictates weight; smaller is faster | Task 3 mass = r², Task 4 `maxSpeed` test |
| Possession shown by a small football | Task 10 `football()` mark |
| Starts on the 10; 4 downs to score | Task 1 view (yard 0 = the 10), Task 8 downs |
| Turn based, half-second intervals | Task 9 `runTurn` (TURN_SECONDS = 0.5), Task 12 animation |
| Warned if not all players have a direction | Task 9 `unplannedPlayers`, Task 12 warning flow |
| Blocking friction from hand-fighting | Task 6 friction impulse |
| Less friction going downfield (pass release) | Task 6 `RELEASE_SPEED` branch + test |
| Tackling by running into one another | Task 7 reach-based `checkTackles` |
| Tuck via long press: slower, fumble-protected, ball inside circle | Tasks 3/4 (mode + effects), Task 10 (ball inside), Task 11 (long press) |
| Untucked is the default stance | Task 3 (`mode: 'normal'`, ball at leading edge in Task 10) |
| Next turn after tucking: more momentum/power | Task 3 `charge`, Task 4 `accelMult`, Task 5 test, Task 9 consumes it |
| Defender "prepare to tackle": big slowdown, more tackle chance and reach | Task 4 (speed/reach), Task 7 (bonus) |
| Quarter-circle drawn in direction of travel | Task 10 `stanceArc` + `facingAngle` |
| Tucked vs prepared, all else equal = equal match | Task 7 exact-0.5 test, guarded in Task 13 |
| More defenders nearby → more successful tackle | Task 7 `NEARBY_BONUS` + test |
| Offense can push and block during movement | Task 6 mass-weighted push-out |
| Defend-position mode: hold, quarter circle, tiny movement, big reach, resists momentum | Tasks 3/4/6/10/11 |
| Fumbling exists (tuck protects against it) | Task 7 fumble roll, loose ball; Task 7 pickups |

**Placeholder scan** — no TBDs, no "add appropriate X"; every code step carries the full listing. Task 6's stability note gives the concrete alternative expression rather than "adjust as needed".

**Type consistency** — `runTurn(state, random) → {frames, events}` (Tasks 9, 12); `checkTackles(state, random)` (7, 9); player shape declared in Task 3 and used unchanged everywhere; `fieldPos/yardsOfY` (1) used in 3, 8; `gameView(losYard)` (1) used in 10; gesture result shape (11) consumed in 12; `renderBoardShell → {viewBox, markup}` (10) consumed in 12.
