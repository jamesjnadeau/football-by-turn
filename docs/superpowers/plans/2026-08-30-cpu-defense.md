# Computer Defense Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A computer opponent coaches the defense — every defender runs at the ball each turn and breaks down to tackle when he gets there — and the human never sees what the computer has planned.

**Architecture:** One new pure module, `lib/game/ai.js`, turns a game state into a list of `{id, dir, throttle}` plans by pointing each coached player at the ball (leading a moving carrier). `runTurn` is the only caller: it coaches at the very top of the turn and wipes the computer's plans at the very bottom, so the invariant "no computer plan exists while `phase === 'planning'`" holds by construction — which is what makes the plans unreadable, since `renderArrows` only ever draws plans that exist. `state.aiTeam` (`'defense'` or `null`) is the single switch; it defaults to `null` so every existing hot-seat test keeps its exact meaning, and `app/main.js` opts in.

**Tech Stack:** Plain ES modules, SVG, Node 20+ built-in test runner (`node --test`). No build step, no npm dependencies.

**Spec:** [README.md](../../../README.md) plus the request this plan implements, verbatim:

> Currently we can control both offense and defense. I'd like a computer opponent to control the defense, can you make a opponent that uses simple programming to try and move it's players towards the ball. Please don't show the defenses planned movements to the offense.

## Global Constraints

- No npm dependencies and no build step. `package.json` exists only for `"type": "module"` and scripts.
- Everything under `lib/` is pure: no `document`, no `window`, no `node:` imports, no `Date.now()`, no unseeded `Math.random()`. DOM code lives only under `app/`.
- Vendored files in `lib/field/` and `app/vendor/` are copied verbatim from upstream and never edited.
- All physics runs in SVG units. 1 yard = 3.75 units. `y` increases toward the goal the offense attacks, so the offense lines up at *smaller* `y` than the defense and a defender pursuing the ball at the snap runs in `-y`.
- Game state objects stay plain JSON-serializable data. Every function that uses randomness takes a `random` parameter — **the AI takes none: it is fully deterministic**, so a coached turn is as reproducible as a hand-planned one.
- Every tunable number goes in `lib/game/constants.js`, nowhere else.
- Tests use `node:test` + `node:assert/strict`, one file per module under `test/game/`. Run everything with `npm test`.
- **No existing test may be edited.** Every task below only appends tests. If an existing test starts failing, that is a bug in the change, not a stale test.

## Design decisions (read before implementing)

1. **`state.aiTeam`, defaulting to `null`.** The library's default stays hot-seat (human plans both teams) so the whole existing suite — which builds states with `createGame({ seed })` and drives `runTurn` against scripted dice — keeps working unchanged. `app/main.js` passes `ai: 'defense'`, so the *game as played in a browser* defaults to a computer opponent, which is what was asked for. Naming it `aiTeam` rather than `aiOn` means coaching the offense later is a value change, not a rename.
2. **The computer plans inside `runTurn`, never during planning.** This is the whole hiding mechanism. A plan that does not exist cannot be rendered, previewed, inspected in a screenshot, or read out of `state` between turns. The alternative — planning during the planning phase and filtering it out at render time — leaves the data sitting in state where one careless `renderArrows` change re-exposes it.
3. **The computer's plans are cleared at the end of every turn,** right next to the existing `p.charge = 0` reset. Without this, last turn's defensive arrows would be drawn during the next planning phase.
4. **`renderArrows` also filters the computer's team.** Belt and braces on decision 2. It costs one clause and makes the requirement legible in the file that would violate it.
5. **Pursuit leads the carrier.** Aiming at where the carrier *is* means every defender chases a step behind forever. Aiming at where he *will be* — his position plus his velocity over the time this defender needs to close the gap — is three lines and turns a conga line into an actual pursuit angle. The lead time is capped (`AI_LEAD_MAX_SECONDS`) so a breakaway run doesn't fling the safety off the field.
6. **Defenders break down into the `prepared` stance when close** (Task 4). Without it the computer never uses the game's own tackling verb, and the human's tuck mechanic is free value. The rule is one distance comparison, and `setMode` is called only on an actual *change* — calling it every turn would re-arm `charge` permanently and hand the computer an acceleration bonus the human can never have.
7. **Stances stay visible.** A defender's `mode` persists past the turn, so the human sees the stance arc of a defender who broke down last turn. That is a physical stance already visible on the field, and it is history, not intention — it says nothing about where the computer will run next. Only *plans* are hidden.
8. **Hot-seat stays reachable** via a `Defense: computer / Defense: you` toggle button (Task 5). The computer is the default; nothing that already worked is removed.
9. **The computer's players take no orders from the human.** `app/main.js`'s `hitTest` skips them, which kills drags, drag previews and long-presses in one place. Backed by `isControllable(state, id)` in `lib/game/state.js` so the rule itself is unit-tested even though the hit test is DOM code.

## File Structure

```
lib/game/
├── ai.js          # NEW: the pursuit brain — aiPlayers, pursuitTarget, defensePlans, coachAi, clearAiPlans, applyAiModes
├── constants.js   # + AI_LEAD_MAX_SECONDS, AI_BREAKDOWN_UNITS
├── state.js       # + createGame({ai}) → state.aiTeam; + isControllable()
├── turn.js        # coachAi at the top of the turn, clearAiPlans at the bottom; unplannedPlayers skips the computer's team
└── render.js      # renderArrows skips the computer's team
test/game/
└── ai.test.js     # NEW
app/main.js        # ai: 'defense', hitTest gate, toggle button, HUD label
index.html         # + <button id="ai">
README.md          # document the computer opponent
```

---

### Task 1: The opt-in switch

**Files:**
- Modify: `lib/game/state.js:60-72` (`createGame`), and append `isControllable`
- Test: `test/game/state.test.js` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `createGame({ seed?: number, ai?: 'defense' | null })` → state with `aiTeam: 'defense' | null` (default `null`). `isControllable(state, id: string) → boolean`.

- [ ] **Step 1: Write the failing test**

Append to `test/game/state.test.js`:

```js
test('the computer opponent is opt-in, and its players take no orders', () => {
  const hotSeat = createGame({ seed: 1 });
  assert.equal(hotSeat.aiTeam, null, 'the library default is still hot-seat');
  assert.equal(isControllable(hotSeat, 'd-lb'), true);

  const vsCpu = createGame({ seed: 1, ai: 'defense' });
  assert.equal(vsCpu.aiTeam, 'defense');
  assert.equal(isControllable(vsCpu, 'o-rb'), true, 'the human still coaches his own team');
  assert.equal(isControllable(vsCpu, 'd-lb'), false, 'the computer\'s players are off limits');
});
```

And add `isControllable` to that file's existing import from `../../lib/game/state.js` — the import list becomes:

```js
import {
  createGame, setPlan, clearAllPlans, setMode, placePlayer, getPlayer, ballPos, carrier,
  isControllable,
} from '../../lib/game/state.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `isControllable is not a function` (or a SyntaxError about the missing export).

- [ ] **Step 3: Write minimal implementation**

In `lib/game/state.js`, replace the `createGame` signature and add `aiTeam`:

```js
/**
 * `ai` names the team the computer coaches — 'defense', or null for hot-seat,
 * where the human plans both sides. Stored as `aiTeam`; every AI check in the
 * codebase reads that one field, so coaching the offense one day is a value
 * change, not a rename. The default is null so the library's own semantics —
 * and every test written against them — stay exactly as they were; app/main.js
 * is what opts the played game in.
 */
export function createGame({ seed = 1, ai = null } = {}) {
  return {
    seed,
    aiTeam: ai,
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
```

And append to the same file:

```js
/** Whether the human may give this player orders. The computer's team is off limits. */
export function isControllable(state, id) {
  return getPlayer(state, id).team !== state.aiTeam;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the new test, and every pre-existing test unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/game/state.js test/game/state.test.js
git commit -m "feat: aiTeam switch and isControllable"
```

---

### Task 2: The pursuit brain

**Files:**
- Modify: `lib/game/constants.js` (append a section)
- Create: `lib/game/ai.js`
- Test: `test/game/ai.test.js` (create)

**Interfaces:**
- Consumes: `state.aiTeam` and `isControllable` semantics from Task 1; `ballPos`, `carrier`, `setPlan`, `clearPlan` from `state.js`; `maxSpeed` from `modes.js`; `add`, `sub`, `len`, `norm`, `scale` from `vec.js`.
- Produces:
  - `aiPlayers(state) → Player[]` — the coached players, `[]` when `aiTeam` is falsy.
  - `pursuitTarget(state, player) → {x, y} | null` — the point to run at.
  - `defensePlans(state) → Array<{ id: string, dir: {x, y}, throttle: number }>` — pure, writes nothing.
  - `coachAi(state) → void` — writes those plans into the state. Task 4 extends this.
  - `clearAiPlans(state) → void` — sets every coached player's `plan` to `null`.
  - `AI_LEAD_MAX_SECONDS` from `constants.js`.

- [ ] **Step 1: Write the failing test**

Create `test/game/ai.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiPlayers, pursuitTarget, defensePlans, coachAi, clearAiPlans,
} from '../../lib/game/ai.js';
import { createGame, getPlayer, setPlan } from '../../lib/game/state.js';
import { TEAM_SIZE, AI_LEAD_MAX_SECONDS } from '../../lib/game/constants.js';

test('with no computer opponent there is nothing to coach', () => {
  const s = createGame({ seed: 1 });
  assert.deepEqual(aiPlayers(s), []);
  assert.deepEqual(defensePlans(s), []);
});

test('the computer coaches exactly its own team', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const ids = aiPlayers(s).map((p) => p.id);
  assert.equal(ids.length, TEAM_SIZE);
  assert.ok(ids.every((id) => id.startsWith('d-')), 'defense only');
});

test('a standing carrier is chased where he stands', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.deepEqual(pursuitTarget(s, getPlayer(s, 'd-lb')), getPlayer(s, 'o-qb').pos);
});

test('a moving carrier is led, and a further-away pursuer aims further ahead', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  qb.vel = { x: 10, y: 0 };
  const near = pursuitTarget(s, getPlayer(s, 'd-nt')); // 5 yards off the ball
  const far = pursuitTarget(s, getPlayer(s, 'd-s'));   // 12 yards off it
  assert.ok(near.x > qb.pos.x, 'the aim point is ahead of the carrier');
  assert.ok(far.x > near.x, 'more ground to cover means more lead');
});

test('the lead is capped, so one breakaway cannot fling a pursuer off the field', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  qb.vel = { x: 40, y: 0 };
  const safety = getPlayer(s, 'd-s');
  safety.pos = { x: safety.pos.x, y: safety.pos.y + 1000 }; // absurdly far downfield
  const target = pursuitTarget(s, safety);
  assert.ok(
    Math.abs(target.x - qb.pos.x - 40 * AI_LEAD_MAX_SECONDS) < 1e-9,
    'lead time saturates at AI_LEAD_MAX_SECONDS',
  );
});

test('a loose ball is chased where it lies', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  s.ball = { carrierId: null, pos: { x: 135, y: 100 }, vel: { x: 0, y: 0 }, loose: 0 };
  assert.deepEqual(pursuitTarget(s, getPlayer(s, 'd-lb')), { x: 135, y: 100 });
});

test('every plan is a unit vector at the ball, full throttle', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const plans = defensePlans(s);
  assert.equal(plans.length, TEAM_SIZE);
  const qb = getPlayer(s, 'o-qb');
  for (const plan of plans) {
    const p = getPlayer(s, plan.id);
    assert.equal(plan.throttle, 1);
    assert.ok(Math.abs(Math.hypot(plan.dir.x, plan.dir.y) - 1) < 1e-9, `${plan.id}: unit direction`);
    // The QB stands upfield of every defender at the snap, so every pursuit
    // runs back toward him: -y.
    assert.ok(plan.dir.y < 0, `${plan.id} runs at the ball`);
    const to = { x: qb.pos.x - p.pos.x, y: qb.pos.y - p.pos.y };
    const l = Math.hypot(to.x, to.y);
    assert.ok(Math.abs(plan.dir.x - to.x / l) < 1e-9, `${plan.id}: x`);
    assert.ok(Math.abs(plan.dir.y - to.y / l) < 1e-9, `${plan.id}: y`);
  }
});

test('defensePlans is pure — it writes nothing into the state', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  defensePlans(s);
  assert.ok(s.players.every((p) => p.plan === null));
});

test('coachAi writes the plans; clearAiPlans wipes them and leaves the human\'s alone', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.5);

  coachAi(s);
  assert.ok(s.players.filter((p) => p.team === 'defense').every((p) => p.plan !== null));

  clearAiPlans(s);
  assert.ok(s.players.filter((p) => p.team === 'defense').every((p) => p.plan === null));
  assert.deepEqual(getPlayer(s, 'o-rb').plan, { dir: { x: 0, y: 1 }, throttle: 0.5 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module .../lib/game/ai.js`.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/game/constants.js`:

```js
// --- the computer opponent ---
// A pursuing player aims at the carrier's position plus his velocity over the
// time that pursuer needs to close the gap. That time is capped here, so a
// breakaway run leads the deep safety a sane distance instead of sending him
// into the parking lot.
export const AI_LEAD_MAX_SECONDS = 1;
```

Create `lib/game/ai.js`:

```js
/**
 * The computer opponent: a pursuit brain simple enough to read in one sitting.
 * Every player it coaches runs at the ball — at where the carrier is going,
 * not where he is — and nothing in here rolls dice, so a coached turn is as
 * reproducible as a hand-planned one.
 *
 * turn.js is the only caller. It coaches at the top of the turn and calls
 * clearAiPlans at the bottom, which is the whole trick to keeping the
 * computer's intentions off the human's screen: no plan of the computer's ever
 * exists while `phase === 'planning'`, so there is never anything to draw.
 */
import { add, sub, len, norm, scale } from './vec.js';
import { ballPos, carrier, setPlan, clearPlan } from './state.js';
import { maxSpeed } from './modes.js';
import { AI_LEAD_MAX_SECONDS } from './constants.js';

/** The players the computer coaches — nobody at all in hot-seat games. */
export function aiPlayers(state) {
  if (!state.aiTeam) return [];
  return state.players.filter((p) => p.team === state.aiTeam);
}

/**
 * Where `player` should run. A loose ball is chased where it lies; a carrier is
 * LED — his position plus his current velocity over the time this player needs
 * to cover the gap at his own top speed, capped at AI_LEAD_MAX_SECONDS.
 * Aiming at where the carrier stands right now would leave every pursuer
 * trailing him by exactly one turn, forever.
 */
export function pursuitTarget(state, player) {
  const bp = ballPos(state);
  if (!bp) return null;
  const car = carrier(state);
  if (!car || car.id === player.id) return bp;
  const t = Math.min(AI_LEAD_MAX_SECONDS, len(sub(bp, player.pos)) / maxSpeed(player));
  return add(bp, scale(car.vel, t));
}

/**
 * One full-throttle plan per coached player. Pure: nothing in `state` moves,
 * which is what lets the turn decide when (and whether) to apply them.
 */
export function defensePlans(state) {
  const plans = [];
  for (const p of aiPlayers(state)) {
    const target = pursuitTarget(state, p);
    if (target === null) continue;
    const to = sub(target, p.pos);
    if (len(to) === 0) continue; // standing on the ball: no direction to run
    plans.push({ id: p.id, dir: norm(to), throttle: 1 });
  }
  return plans;
}

/** Everything the computer decides for one turn, written into `state`. */
export function coachAi(state) {
  for (const { id, dir, throttle } of defensePlans(state)) setPlan(state, id, dir, throttle);
}

/**
 * Wipe the computer's arrows. runTurn calls this at the end of every turn, so
 * that no plan of the computer's survives into a planning phase where
 * renderArrows would happily draw it for the human to read.
 */
export function clearAiPlans(state) {
  for (const p of aiPlayers(state)) clearPlan(state, p.id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all nine new `ai.test.js` tests, and the whole pre-existing suite.

- [ ] **Step 5: Commit**

```bash
git add lib/game/ai.js lib/game/constants.js test/game/ai.test.js
git commit -m "feat: pursuit brain for the computer opponent"
```

---

### Task 3: Coach the turn, and keep the plans hidden

**Files:**
- Modify: `lib/game/turn.js:29-31` (`unplannedPlayers`) and `lib/game/turn.js:33-55` (`runTurn`)
- Modify: `lib/game/render.js:101-112` (`renderArrows`)
- Test: `test/game/turn.test.js` (append), `test/game/render.test.js` (append)

**Interfaces:**
- Consumes: `coachAi(state)` and `clearAiPlans(state)` from Task 2; `state.aiTeam` from Task 1.
- Produces: `runTurn(state, random)` coaches the computer's team itself — callers pass plans only for the human's team. `unplannedPlayers(state)` returns only players the human is responsible for. `renderArrows(state)` never emits a `data-for` group for a coached player.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/turn.test.js` (its existing imports already cover everything used here):

```js
test('the computer coaches the defense during the turn — and its arrows never survive it', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  runTurn(s, mulberry32(1));
  const defense = s.players.filter((p) => p.team === 'defense');
  assert.ok(
    defense.every((p) => p.plan === null),
    'nothing of the computer\'s is readable once we are back in planning',
  );
  assert.ok(
    defense.some((p) => p.vel.x !== 0 || p.vel.y !== 0),
    'but the defense did move, so it really was coached',
  );
});

test('the computer runs its players at the ball', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'd-lb'); // no traffic in between
  const y0 = getPlayer(s, 'd-lb').pos.y;
  runTurn(s, mulberry32(1));
  // The QB stands upfield of the LB, so closing on him means moving in -y.
  assert.ok(getPlayer(s, 'd-lb').pos.y < y0, 'the LB closed on the QB');
});

test('the unplanned warning counts only the players the human is coaching', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const ids = unplannedPlayers(s);
  assert.equal(ids.length, TEAM_SIZE, 'the offense, and nobody else');
  assert.ok(ids.every((id) => id.startsWith('o-')));
});
```

Append to `test/game/render.test.js` (its existing imports already cover everything used here):

```js
test('the computer\'s arrows are never drawn', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  setPlan(s, 'd-lb', { x: 0, y: -1 }, 1); // as if one had leaked into a planning phase
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const svg = renderArrows(s);
  assert.ok(!svg.includes('data-for="d-lb"'), 'the defense keeps its plans to itself');
  assert.ok(svg.includes('data-for="o-rb"'), 'the human still sees his own');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — three failures. The defense never moves (no plans applied), `unplannedPlayers` returns `TEAM_SIZE * 2` ids, and `renderArrows` emits `data-for="d-lb"`.

- [ ] **Step 3: Write the implementation**

In `lib/game/turn.js`, add the import beneath the existing ones:

```js
import { coachAi, clearAiPlans } from './ai.js';
```

Replace `unplannedPlayers`:

```js
/**
 * Who still needs an arrow — the human's warning feed, so it skips the team the
 * computer coaches. Those players are planned inside runTurn, after this has
 * had its say.
 */
export function unplannedPlayers(state) {
  return state.players
    .filter((p) => p.plan === null && p.team !== state.aiTeam)
    .map((p) => p.id);
}
```

Replace `runTurn`:

```js
export function runTurn(state, random) {
  state.phase = 'running';
  // The computer plans here and nowhere else. Doing it at the top of the turn
  // rather than during the planning phase is what hides its intentions: while
  // the human is drawing arrows there is simply no plan of the computer's in
  // the state for anything to render.
  coachAi(state);
  const frames = [];
  const events = [];
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) {
    stepPhysics(state, DT);
    // Dead-ball first: if the carrier's leading edge broke the goal plane (or
    // he stepped out) during this sub-step, that already physically happened,
    // so it must be locked in before a tackle roll in the same sub-step can
    // claim him. checkDeadBall's own `if (state.deadReason) return []` guard
    // still keeps a tackle from an EARLIER sub-step standing — the loop breaks
    // on deadReason, so it never gets a second look anyway.
    events.push(...checkDeadBall(state));
    events.push(...checkTackles(state, random));
    events.push(...checkPickup(state));
    frames.push(snapshot(state));
    if (state.deadReason) break;
  }
  for (const p of state.players) p.charge = 0; // the burst lasts one turn (spec)
  clearAiPlans(state); // ...and the computer's arrows do not outlive the turn either
  state.turnIndex += 1;
  state.phase = state.deadReason ? 'playOver' : 'planning';
  return { frames, events };
}
```

In `lib/game/render.js`, replace `renderArrows`'s filter line and its doc:

```js
/**
 * The human's plans, drawn as arrows. The team the computer coaches is skipped:
 * turn.js already guarantees those plans never exist during a planning phase,
 * and this is the second lock on the same door — the requirement is "don't show
 * the defense's planned movements", and this is the file that would show them.
 */
export function renderArrows(state) {
  return state.players
    .filter((p) => p.plan && p.team !== state.aiTeam)
```

Leave the rest of `renderArrows`'s body exactly as it is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the four new tests plus every pre-existing one. In particular `turn.test.js`'s `unplannedPlayers lists everyone without an arrow` must still pass: it builds a hot-seat game, where `p.team !== undefined` is true for everyone.

- [ ] **Step 5: Commit**

```bash
git add lib/game/turn.js lib/game/render.js test/game/turn.test.js test/game/render.test.js
git commit -m "feat: the turn coaches the computer's team, and hides its plans"
```

---

### Task 4: Break down to tackle

**Files:**
- Modify: `lib/game/constants.js` (extend the computer-opponent section)
- Modify: `lib/game/ai.js` (add `applyAiModes`, call it from `coachAi`)
- Test: `test/game/ai.test.js` (append)

**Interfaces:**
- Consumes: `aiPlayers`, `carrier` and `setMode` (from `state.js`, already imported by `state.js` consumers — `ai.js` must add it to its own import).
- Produces: `applyAiModes(state) → void`, and `coachAi` now sets stances before plans. `AI_BREAKDOWN_UNITS` from `constants.js`.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/ai.test.js`, and extend its imports to:

```js
import {
  aiPlayers, pursuitTarget, defensePlans, coachAi, clearAiPlans, applyAiModes,
} from '../../lib/game/ai.js';
import { createGame, getPlayer, setPlan } from '../../lib/game/state.js';
import { TEAM_SIZE, AI_LEAD_MAX_SECONDS, AI_BREAKDOWN_UNITS } from '../../lib/game/constants.js';
```

Then the tests:

```js
test('a defender breaks down only once he is close enough to make the hit', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  const near = getPlayer(s, 'd-lb');
  const far = getPlayer(s, 'd-s');
  near.pos = { x: qb.pos.x, y: qb.pos.y + AI_BREAKDOWN_UNITS - 1 };
  far.pos = { x: qb.pos.x, y: qb.pos.y + AI_BREAKDOWN_UNITS + 1 };
  applyAiModes(s);
  assert.equal(near.mode, 'prepared');
  assert.equal(far.mode, 'normal');
});

test('a defender who gets left behind stands back up', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  const lb = getPlayer(s, 'd-lb');
  lb.pos = { x: qb.pos.x, y: qb.pos.y + 1 };
  applyAiModes(s);
  assert.equal(lb.mode, 'prepared');
  lb.pos = { x: qb.pos.x, y: qb.pos.y + AI_BREAKDOWN_UNITS + 5 };
  applyAiModes(s);
  assert.equal(lb.mode, 'normal', 'no point breaking down with nobody to hit');
});

test('holding the stance does not re-arm the charge every turn', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  const lb = getPlayer(s, 'd-lb');
  lb.pos = { x: qb.pos.x, y: qb.pos.y + 1 };
  applyAiModes(s);
  assert.equal(lb.charge, 1, 'setting the stance arms the burst, once');
  lb.charge = 0;   // what runTurn does at the end of every turn
  applyAiModes(s); // still close, still prepared — nothing changed
  assert.equal(lb.charge, 0, 'no free burst for standing in the stance he is already in');
});

test('nobody breaks down for a loose ball — everyone sprints at it', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const lb = getPlayer(s, 'd-lb');
  s.ball = { carrierId: null, pos: { ...lb.pos }, vel: { x: 0, y: 0 }, loose: 0 };
  applyAiModes(s);
  assert.ok(aiPlayers(s).every((p) => p.mode === 'normal'));
});

test('coachAi sets the stance as well as the arrow', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  const lb = getPlayer(s, 'd-lb');
  lb.pos = { x: qb.pos.x, y: qb.pos.y + 1 };
  coachAi(s);
  assert.equal(lb.mode, 'prepared');
  assert.ok(lb.plan !== null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `applyAiModes is not a function` (or a SyntaxError about the missing export).

- [ ] **Step 3: Write the implementation**

Append to the computer-opponent section of `lib/game/constants.js`:

```js
// Inside this many units of the carrier a coached defender breaks down into the
// prepared stance — gets low, squares up (spec) — instead of sprinting past.
// It has to be short: prepared caps him at PREPARED_SPEED_MULT of top speed, so
// he covers about 9 units in a turn. Any wider and he breaks down early and the
// runner simply jogs around him.
export const AI_BREAKDOWN_UNITS = 11; // ~3 yards
```

In `lib/game/ai.js`, extend the two affected imports:

```js
import { ballPos, carrier, setPlan, setMode, clearPlan } from './state.js';
import { AI_LEAD_MAX_SECONDS, AI_BREAKDOWN_UNITS } from './constants.js';
```

Add `applyAiModes` above `coachAi`:

```js
/**
 * Break down once you are close enough to make the hit. The prepared stance
 * trades most of a defender's speed for reach and tackling power, so it only
 * pays inside AI_BREAKDOWN_UNITS of the carrier — and only when there IS an
 * opposing carrier: a loose ball is a footrace, and everyone runs it at full
 * speed.
 *
 * setMode runs only on an actual change. Calling it every turn while already
 * prepared would re-arm `charge` on every single turn, handing the computer a
 * permanent acceleration bonus that no human player can have.
 */
export function applyAiModes(state) {
  const car = carrier(state);
  const chasing = car !== null && car.team !== state.aiTeam;
  for (const p of aiPlayers(state)) {
    const close = chasing && len(sub(car.pos, p.pos)) <= AI_BREAKDOWN_UNITS;
    const want = close ? 'prepared' : 'normal';
    if (p.mode !== want) setMode(state, p.id, want);
  }
}
```

And replace `coachAi` so stances are set before plans — the stance caps `maxSpeed`, which `pursuitTarget` reads to work out how far ahead to aim:

```js
/** Everything the computer decides for one turn, written into `state`. */
export function coachAi(state) {
  applyAiModes(state);
  for (const { id, dir, throttle } of defensePlans(state)) setPlan(state, id, dir, throttle);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the five new tests and everything before them.

- [ ] **Step 5: Commit**

```bash
git add lib/game/ai.js lib/game/constants.js test/game/ai.test.js
git commit -m "feat: coached defenders break down to tackle when close"
```

---

### Task 5: Wire it into the page

**Files:**
- Modify: `index.html:22-26` (button list)
- Modify: `app/main.js` — imports, both `createGame` calls, `hitTest`, `paint`, plus a new button handler
- Modify: `README.md` — "How to play"

**Interfaces:**
- Consumes: `createGame({ ai })` and `isControllable` (Task 1), `clearAiPlans` (Task 2).
- Produces: no new module exports — this is the DOM layer.

- [ ] **Step 1: Add the toggle button to the page**

In `index.html`, replace the button block:

```html
    <button id="run">Run Turn</button>
    <button id="clear">Clear Arrows</button>
    <button id="ai">Defense: computer</button>
    <button id="next" hidden>Next Down</button>
    <button id="new">New Game</button>
```

- [ ] **Step 2: Opt the played game in, and lock the human out of the computer's players**

In `app/main.js`, extend the two imports:

```js
import {
  createGame, setPlan, setMode, getPlayer, clearAllPlans, isControllable,
} from '../lib/game/state.js';
import { clearAiPlans } from '../lib/game/ai.js';
```

Add the button handle beside the others:

```js
const aiBtn = document.getElementById('ai');
```

Change both `createGame` calls — the initial one and the one in the New Game handler — to opt in:

```js
let state = createGame({ seed: (Math.random() * 2 ** 31) | 0, ai: 'defense' });
```

```js
  state = createGame({ seed: (Math.random() * 2 ** 31) | 0, ai: 'defense' });
```

Replace `hitTest`:

```js
function hitTest(p) {
  let best = null;
  let bestD = Infinity;
  for (const pl of state.players) {
    // The computer's players take no orders. Gating here covers all three ways
    // in — drag, drag preview, and long-press — because every one of them
    // starts from a hit test that returns a player id.
    if (!isControllable(state, pl.id)) continue;
    const d = Math.hypot(pl.pos.x - p.x, pl.pos.y - p.y);
    if (d <= pl.radius + 2 && d < bestD) { best = pl.id; bestD = d; }
  }
  return best;
}
```

- [ ] **Step 3: Show who is coaching, and let the user switch**

In `paint()`, add the two `aiBtn` lines beside the other button state:

```js
  hud.textContent = `Down ${state.down} of 4 — ${state.phase}`;
  aiBtn.textContent = state.aiTeam ? 'Defense: computer' : 'Defense: you';
  aiBtn.disabled = animating || state.phase !== 'planning';
  runBtn.disabled = animating || state.phase !== 'planning';
```

And add the handler next to the `clearBtn` one:

```js
aiBtn.addEventListener('click', () => {
  if (animating || state.phase !== 'planning') return;
  state.aiTeam = state.aiTeam === null ? 'defense' : null;
  // Handing the defense back to the computer drops whatever arrows the human
  // had already drawn for it — they are not his to give any more.
  if (state.aiTeam) clearAiPlans(state);
  pendingWarning = false;
  say(state.aiTeam
    ? 'The computer coaches the defense.'
    : 'Hot-seat: you coach both teams.');
  paint();
});
```

- [ ] **Step 4: Verify — automated, then in the browser**

Run: `npm test`
Expected: PASS, the whole suite. (`app/` has no automated coverage; the checks below are the verification for this task.)

Run: `npm run serve`, open <http://localhost:8080>, and confirm each of these:

1. The panel reads **Defense: computer**, and the unplanned warning names **7** players, not 14.
2. Dragging on a defender does nothing at all — no arrow, no preview arrow while dragging, no stance arc from a long-press.
3. Drag arrows for the offense, press **Run Turn**: the defenders converge on the ball carrier during the animation.
4. Back in planning, **no arrow is drawn on any defender** — before the turn or after it.
5. Let the carrier get close to a defender and run a turn: that defender shows the quarter-circle stance arc, and the tackle usually comes.
6. Click **Defense: computer** — it flips to **Defense: you**, defenders become draggable again, and the warning goes back to naming 14 players. Click again to hand it back.
7. **New Game** returns to a computer-coached defense.

- [ ] **Step 5: Document it**

In `README.md`, insert this immediately after the "Each drive starts 1st and goal…" paragraph in **How to play**, and delete the sentence "You control both teams — every player on the field, offense and defense, needs an arrow before you run a turn." from that paragraph:

```markdown
**The computer coaches the defense.** You draw arrows for your seven offensive
players; each turn the computer sends every defender at the ball — leading the
carrier rather than chasing where he just was — and breaks a defender down into
the tackling stance once he is within range to make the hit. You never see what
it has planned: no defensive arrows are drawn, ever, because the computer does
not decide until you press **Run Turn**. Press **Defense: computer** to take the
defense back and play hot-seat, coaching both teams yourself; press it again to
hand the defense back over.
```

- [ ] **Step 6: Commit**

```bash
git add index.html app/main.js README.md
git commit -m "feat: play against a computer defense by default"
```

---

## Final verification

- [ ] `npm test` — the entire suite green, with no pre-existing test edited (`git log -p` on this branch should show `test/game/state.test.js`, `turn.test.js` and `render.test.js` gaining tests and one import line each, and nothing else).
- [ ] `git grep -n "aiTeam"` — every read of the switch goes through `state.aiTeam`, and there is no second flag.
- [ ] Browser check 4 above is the requirement's acceptance test: at no point in a played game is an arrow drawn on a defender.
