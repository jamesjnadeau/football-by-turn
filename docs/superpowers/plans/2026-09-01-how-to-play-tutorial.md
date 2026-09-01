# "How to play" — the tutorial, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A four-lesson guided tutorial, reachable from the home screen under the game chooser, that teaches the snap, running, tucking, cut blocking, throwing, covering, breaking down, and repositioning — each lesson a real down on the real engine.

**Architecture:** A pure step machine and a data script under `lib/game/tutorial/`, a thin bridge in `app/tutorial.js`, and one `lesson` variable in `app/main.js` that gates presses and gestures. Each lesson deals its own `createGame` at the fifty with a fixed seed; the opposing side is driven by authored per-turn orders through a new `'scripted'` level in `ai.js`.

**Tech Stack:** Vanilla ES modules, no build step. SVG markup built as strings in `lib/game/`, so `node --test` covers it with no DOM. Tests are `node:test` + `node:assert/strict`. Run everything with `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-01-how-to-play-tutorial-design.md`

## Global Constraints

- **No build step.** Everything is a plain ES module loaded by the browser directly. Never add a bundler, a transpiler, or a dependency.
- **`lib/` is DOM-free.** Nothing under `lib/` may touch `document`, `window`, or `localStorage`. UI is built as markup strings and written into the page by `app/`. Browser storage lives in `app/*-store.js` only.
- **`lib/` never reaches into `app/`.** The dependency runs one way.
- **Tests live at `test/<mirror of source path>.test.js`** and run under `npm test` (`node --test`).
- **Ball on the 50 for every lesson.** `TUTORIAL_LOS_YARD = 50`.
- **Fixed seed per scenario.** Seeds: 1001, 2002, 3003, 4004 for scenarios 1–4 in order. If Task 6 shows a seed does not produce the authored beats, change the seed — never weaken a step.
- **A yard is 3.75 SVG units** (`UNITS_PER_YARD_X`). Football coordinates go through `fieldPos(across, yard)` from `lib/game/view.js`; never write a raw SVG coordinate.
- **Commit after every task**, with the subject style this repo uses: lowercase `feat:` / `test:` / `docs:` / `fix:` and a sentence, not a noun phrase.

## Known-broken starting state

At the time this plan was written, `lib/game/formation.js` had a stray `}` at
line 197 inside `setPersonnel`, making `return true;` an illegal return
statement. That is a module-level syntax error and 26 tests across 5 files fail
because of it. **Run `npm test` before Task 1.** If those 26 failures are still
present, remove the stray brace, confirm the suite is green, and commit that on
its own as `fix: the stray brace that broke every importer of formation.js`.
Do not start Task 1 against a red suite — you will not be able to tell your own
breakage from the pre-existing one.

## File structure

| File | Responsibility |
|---|---|
| `lib/game/tutorial/script.js` | The four scenarios as data: rosters, seeds, authored orders, ordered steps. |
| `lib/game/tutorial/machine.js` | Pure step machine: what is allowed, when a step lands, when a play went off script, what the card says. |
| `lib/game/tutorial/render.js` | The coach card and the highlight ring, as markup strings. |
| `app/tutorial.js` | The bridge: deals each scenario, holds the step index and attempt count, answers `main.js`. |
| `app/tutorial-store.js` | The "finished it" flag in `localStorage`. |
| `lib/game/state.js` | *(modify)* `createGame` gains `losYard` and `scriptedOrders`; roster size assertions go per-side. |
| `lib/game/rosters.js` | *(modify)* `DRILL_ROSTERS`, per-side sizes, `getRoster` consults both tables. |
| `lib/game/ai.js` | *(modify)* the `'scripted'` level. |
| `lib/game/render.js` | *(modify)* button-column anchors, an `allow` filter, an optional menu plate, the `game-tutorial` layer, the card's styles. |
| `lib/game/home.js` | *(modify)* the "How to play" button. |
| `app/home.js` | *(modify)* route that button into the tutorial. |
| `app/main.js` | *(modify)* the `lesson` gate. |
| `index.html` | *(modify)* one CSS rule for the quiet home button. |

---

### Task 1: A game can be dealt from any yard line, carrying scripted orders

**Files:**
- Modify: `lib/game/state.js` (the `createGame` signature and the state object)
- Test: `test/game/state.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createGame({ ..., losYard = DRIVE_START_YARD, scriptedOrders = null })`. `state.losYard` is the given yard, `state.toGoYard` is `Math.min(losYard + FIRST_DOWN_YARDS, GOAL_YARD)`, `state.players` are built at that yard, and `state.scriptedOrders` holds the array verbatim (or `null`).

- [ ] **Step 1: Write the failing tests**

Append to `test/game/state.test.js`. Check the file's existing imports first; add `fieldPos` from `../../lib/game/view.js` and `getPlayer` from `../../lib/game/state.js` only if they are not already imported.

```js
test('a game can be dealt from a named yard line, with the chains set from there', () => {
  const s = createGame({ seed: 1, losYard: 50 });
  assert.equal(s.losYard, 50);
  assert.equal(s.toGoYard, 60, 'ten to go from the fifty');
  assert.deepEqual(getPlayer(s, 'o-qb').pos, fieldPos(0, 46), 'four yards behind the line');
  assert.deepEqual(getPlayer(s, 'd-lb').pos, fieldPos(0, 54), 'four yards the other way');
});

test('the drive start is still what a game dealt with no yard line gets', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.losYard, 20);
  assert.equal(s.toGoYard, 30);
});

test('goal to go falls out of a line of scrimmage inside the ten', () => {
  assert.equal(createGame({ seed: 1, losYard: 95 }).toGoYard, 100);
});

test('scripted orders ride on the state as plain data, defaulting to none', () => {
  const orders = [[{ id: 'd-nt', cover: 'o-qb' }]];
  assert.deepEqual(createGame({ seed: 1, scriptedOrders: orders }).scriptedOrders, orders);
  assert.equal(createGame({ seed: 1 }).scriptedOrders, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/state.test.js`
Expected: FAIL — `s.losYard` is 20 rather than 50, and `s.scriptedOrders` is `undefined`.

- [ ] **Step 3: Widen `createGame`**

In `lib/game/state.js`, add the two options to the destructured parameter and use them in the state object. The three lines that currently read `DRIVE_START_YARD` become `losYard`.

```js
export function createGame({
  seed = 1, ai = null, aiLevel = 'pursuit', variant = DEFAULT_VARIANT,
  genomeOverrides = null, losYard = DRIVE_START_YARD, scriptedOrders = null,
} = {}) {
  const state = {
    seed,
    aiTeam: ai,
    variantId: getRoster(variant).id,
    aiLevel,
    down: 1,
    losYard,
    toGoYard: Math.min(losYard + FIRST_DOWN_YARDS, GOAL_YARD),
    phase: 'planning',
    turnIndex: 0,
    players: formationPlayers(losYard, variant),
```

Then, beside the existing `tendencyCounts` field, add:

```js
    // The other side's authored orders, by turn index, or null — what ai.js's
    // 'scripted' level plays. Plain serializable data handed in, exactly like
    // tendencyCounts and genomeOverrides, and for the same reason: nothing
    // under lib/ may reach out for it, so the caller brings it.
    scriptedOrders,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/game/state.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite — the yard line is load-bearing everywhere**

Run: `npm test`
Expected: the same pass/fail counts as your green baseline. `DRIVE_START_YARD` is now a default rather than a constant in the body, so any regression shows up here.

- [ ] **Step 6: Commit**

```bash
git add lib/game/state.js test/game/state.test.js && git commit -m "feat: a game can be dealt from any yard line, carrying scripted orders"
```

---

### Task 2: The drill rosters

**Files:**
- Modify: `lib/game/rosters.js`, `lib/game/state.js` (`formationPlayers`, `defensePlayers`)
- Test: `test/game/tutorial/rosters.test.js` (create)

**Interfaces:**
- Consumes: `createGame({ losYard })` from Task 1.
- Produces: `DRILL_ROSTERS` exported from `lib/game/rosters.js` with ids `'tutorial-2v2'` and `'tutorial-pass'`; `offenseSize(roster)` and `defenseSize(roster)` helpers; `getRoster` resolves a drill id. Drill player ids are `o-c`, `o-qb`, `o-rb`, `d-nt`, `d-lb`.

**Why a second table:** four tests in `test/game/rosters.test.js` iterate `Object.values(ROSTERS)` and assert things true of real football and false of a drill — equal sides, exactly `minOnLine` men on the line, an offense whose x positions average to the middle, a defense `alignDefense` would leave standing. Those tests guard the real game. Drills go in their own map so none of them has to be weakened.

- [ ] **Step 1: Write the failing tests**

Create `test/game/tutorial/rosters.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRILL_ROSTERS, ROSTERS, getRoster, minOnLine, offenseSize, defenseSize,
} from '../../../lib/game/rosters.js';
import { createGame, SNAPPER_ID, SNAP_TARGET_ID } from '../../../lib/game/state.js';
import { formationFoul, spotFault } from '../../../lib/game/formation.js';
import { fieldPos } from '../../../lib/game/view.js';
import { isPlayable } from '../../../lib/game/variants.js';

test('every drill fields what it claims, with unique ids and a snap to take', () => {
  for (const roster of Object.values(DRILL_ROSTERS)) {
    assert.equal(roster.offense.length, offenseSize(roster), `${roster.id} offense`);
    assert.equal(roster.defense.length, defenseSize(roster), `${roster.id} defense`);
    const ids = [...roster.offense, ...roster.defense].map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${roster.id} ids are unique`);
    for (const id of [SNAPPER_ID, SNAP_TARGET_ID]) {
      assert.ok(roster.offense.some((s) => s.id === id), `${roster.id} has ${id}`);
    }
  }
});

test('a drill has no formation rule, so a two-man line never draws a flag', () => {
  for (const id of Object.keys(DRILL_ROSTERS)) {
    const s = createGame({ seed: 1, variant: id, losYard: 50 });
    assert.equal(minOnLine(s), 0, `${id}: no line requirement`);
    assert.equal(formationFoul(s), null, `${id}: legal formation`);
    for (const p of s.players) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${id}: ${p.id} at a legal spot`);
    }
  }
});

test('the two-man drill stands four men on one vertical line at the fifty', () => {
  const s = createGame({ seed: 1, variant: 'tutorial-2v2', losYard: 50 });
  assert.equal(s.players.length, 4);
  const at = (id) => s.players.find((p) => p.id === id).pos;
  assert.deepEqual(at('o-c'), fieldPos(0, 49));
  assert.deepEqual(at('o-qb'), fieldPos(0, 46));
  assert.deepEqual(at('d-nt'), fieldPos(0, 51));
  assert.deepEqual(at('d-lb'), fieldPos(0, 54));
});

test('the passing drill adds a back off the line, three against two', () => {
  const s = createGame({ seed: 1, variant: 'tutorial-pass', losYard: 50 });
  assert.equal(s.players.filter((p) => p.team === 'offense').length, 3);
  assert.equal(s.players.filter((p) => p.team === 'defense').length, 2);
  const rb = s.players.find((p) => p.id === 'o-rb');
  assert.deepEqual(rb.pos, fieldPos(6, 45), 'offset, so a throw to him is not a lateral down the line');
});

test('a drill is not a game: the home screen can neither list nor start one', () => {
  for (const id of Object.keys(DRILL_ROSTERS)) {
    assert.equal(ROSTERS[id], undefined, `${id} is not a variant`);
    assert.equal(isPlayable(id), false, `${id} cannot be started off the home screen`);
    assert.equal(getRoster(id).id, id, '...but it can still be looked up');
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/tutorial/rosters.test.js`
Expected: FAIL — `DRILL_ROSTERS` is not exported.

- [ ] **Step 3: Add the drill tables and the per-side size helpers**

In `lib/game/rosters.js`, after the `ELEVEN_DEFENSE_DIME` table and before `OFFENSIVE_LINE_ROLES`:

```js
/**
 * The tutorial's drill formations. A handful of men on one vertical line, so a
 * beginner can see one thing happen at a time.
 *
 * They live here because this file is the only place a formation is written
 * down — but in a table of their own, not in ROSTERS, because they are not
 * football. The "every roster" tests hold real variants to claims a drill
 * cannot meet: equal sides, exactly minOnLine men on the line, an offense
 * balanced about the middle of the field, a defense alignDefense would leave
 * where it stands. Those tests guard the real game; a drill must not be the
 * reason any of them gets weakened.
 *
 * `minOnLine: 0` is not a loophole, it is the truth about a drill: there is no
 * formation rule to break, so formationFoul has nothing to say.
 */
const DRILL_OFFENSE = [
  { id: 'o-c', role: 'C', radius: RADIUS_LINE, across: 0, down: -1 },
  { id: 'o-qb', role: 'QB', radius: RADIUS_MID, across: 0, down: -4 },
];

const DRILL_DEFENSE = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: 0, down: 4 },
];

/**
 * The back stands OFF the line the other three share, six yards to the right.
 * Stacked behind the quarterback he would only ever be a lateral away, and a
 * throw straight backwards down the column is not the lesson.
 */
const DRILL_PASS_OFFENSE = [
  ...DRILL_OFFENSE,
  { id: 'o-rb', role: 'RB', radius: RADIUS_SKILL, across: 6, down: -5 },
];

export const DRILL_ROSTERS = {
  'tutorial-2v2': {
    id: 'tutorial-2v2',
    teamSize: 2,
    minOnLine: 0,
    offense: DRILL_OFFENSE,
    defense: DRILL_DEFENSE,
  },
  'tutorial-pass': {
    id: 'tutorial-pass',
    teamSize: 2,
    // The one asymmetric roster in the game: three against two. `teamSize`
    // still answers for the defense, and `offenseSize` overrides it for the
    // side that has the extra man.
    offenseSize: 3,
    minOnLine: 0,
    offense: DRILL_PASS_OFFENSE,
    defense: DRILL_DEFENSE,
  },
};

/** How many men a roster fields on each side. Every real variant fields the
 *  same number both ways and says so once, as `teamSize`; only a drill splits
 *  them. */
export function offenseSize(roster) {
  return roster.offenseSize ?? roster.teamSize;
}

export function defenseSize(roster) {
  return roster.defenseSize ?? roster.teamSize;
}
```

- [ ] **Step 4: Teach `getRoster` about the second table**

Replace the body of `getRoster` in `lib/game/rosters.js`:

```js
export function getRoster(id) {
  return ROSTERS[id] ?? DRILL_ROSTERS[id] ?? ROSTERS[DEFAULT_VARIANT];
}
```

Add a line to its docstring: `Drills are looked up here too, out of DRILL_ROSTERS — they are formations this file owns, they are just not games.`

- [ ] **Step 5: Assert per side rather than per team**

In `lib/game/state.js`, change the import from `./rosters.js` to add `offenseSize, defenseSize`, then replace the two length assertions.

In `defensePlayers`:

```js
export function defensePlayers(losYard, variantId = DEFAULT_VARIANT) {
  const roster = getRoster(variantId);
  if (roster.defense.length !== defenseSize(roster)) {
    throw new Error(`variant "${roster.id}" must field ${defenseSize(roster)} on defense`);
  }
  return roster.defense.map((s) => makePlayer(s, 'defense', losYard));
}
```

In `formationPlayers`:

```js
  if (roster.offense.length !== offenseSize(roster)) {
    throw new Error(`variant "${roster.id}" must field ${offenseSize(roster)} on offense`);
  }
```

- [ ] **Step 6: Run the new tests, then the whole suite**

Run: `node --test test/game/tutorial/rosters.test.js`
Expected: PASS.

Run: `npm test`
Expected: no new failures. In particular `test/game/rosters.test.js` must be untouched and green — if any of its "every roster" tests now fail, a drill has leaked into `ROSTERS`; put it back in `DRILL_ROSTERS`.

- [ ] **Step 7: Commit**

```bash
git add lib/game/rosters.js lib/game/state.js test/game/tutorial/rosters.test.js && git commit -m "feat: the tutorial's drill formations, in a table of their own"
```

---

### Task 3: The scripted brain

**Files:**
- Modify: `lib/game/ai.js`
- Test: `test/game/tutorial/scripted-ai.test.js` (create)

**Interfaces:**
- Consumes: `state.scriptedOrders` from Task 1; drill rosters from Task 2.
- Produces: `applyScriptedOrders(state)` exported from `lib/game/ai.js`, and `state.aiLevel === 'scripted'` handled by `coachAi`. An order is `{ id, aim?, cover?, mode? }` — `aim` a field point, `cover` an opponent's id, `mode` one of the `setMode` modes.

- [ ] **Step 1: Write the failing tests**

Create `test/game/tutorial/scripted-ai.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getPlayer } from '../../../lib/game/state.js';
import { coachAi, applyScriptedOrders } from '../../../lib/game/ai.js';
import { fieldPos } from '../../../lib/game/view.js';

function drill(scriptedOrders) {
  return createGame({
    seed: 1, variant: 'tutorial-2v2', losYard: 50,
    ai: 'defense', aiLevel: 'scripted', scriptedOrders,
  });
}

test('the turn index picks the orders, and an aim becomes a full-throttle plan', () => {
  const s = drill([
    [{ id: 'd-nt', aim: fieldPos(0, 46) }],
    [{ id: 'd-nt', aim: fieldPos(-10, 46) }],
  ]);
  coachAi(s);
  assert.deepEqual(getPlayer(s, 'd-nt').plan.dir, { x: 0, y: -1 }, 'turn nought: straight upfield');
  assert.equal(getPlayer(s, 'd-nt').plan.throttle, 1);

  s.turnIndex = 1;
  coachAi(s);
  assert.ok(getPlayer(s, 'd-nt').plan.dir.x < 0, 'turn one: he has been sent left');
});

test('past the end of the script the last turn is played again', () => {
  const s = drill([[{ id: 'd-lb', cover: 'o-qb' }]]);
  s.turnIndex = 7;
  coachAi(s);
  assert.equal(getPlayer(s, 'd-lb').cover, 'o-qb', 'a blocker told to block keeps blocking');
});

test('a cover order is a cover order, not an arrow at where he was standing', () => {
  const s = drill([[{ id: 'd-lb', cover: 'o-qb' }]]);
  coachAi(s);
  assert.equal(getPlayer(s, 'd-lb').cover, 'o-qb');
});

test('an authored stance survives: the generic break-down rule never runs', () => {
  const s = drill([[{ id: 'd-nt', aim: fieldPos(0, 46), mode: 'prepared' }]]);
  coachAi(s);
  assert.equal(getPlayer(s, 'd-nt').mode, 'prepared');
  assert.ok(getPlayer(s, 'd-nt').facing, 'committing froze an axis');
});

test('a mode already set is not set again, so the charge bonus is not re-armed', () => {
  const s = drill([[{ id: 'd-nt', mode: 'prepared' }], [{ id: 'd-nt', mode: 'prepared' }]]);
  coachAi(s);
  getPlayer(s, 'd-nt').charge = 0; // the whistle clears it, as turn.js does
  s.turnIndex = 1;
  coachAi(s);
  assert.equal(getPlayer(s, 'd-nt').charge, 0, 'standing in the same stance earns nothing');
});

test('an empty script coaches nobody rather than throwing', () => {
  const s = drill([]);
  coachAi(s);
  assert.equal(getPlayer(s, 'd-nt').plan, null);
  applyScriptedOrders(createGame({ seed: 1, ai: 'defense', aiLevel: 'scripted' }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/tutorial/scripted-ai.test.js`
Expected: FAIL — `applyScriptedOrders` is not exported.

- [ ] **Step 3: Write `applyScriptedOrders`**

In `lib/game/ai.js`, immediately after `coachSmartDefense`:

```js
/**
 * The tutorial's opponent: orders written down in advance, one entry per turn.
 *
 * Authored rather than played by a brain because a lesson has to demonstrate
 * one specific thing — the centre blocks the nose tackle, the quarterback runs
 * left — and no genome can be relied on to do that twice running. Nothing here
 * is learned and nothing rolls dice.
 *
 * Past the end of the script the last turn's orders are played again.
 * clearAiPlans wipes this team at every whistle, so a script that simply ran
 * out would leave a blocker standing still in the middle of the down.
 *
 * Modes go on AFTER the aims: applyOrders writes plans through setPlan, which
 * clears a cover order, while setMode touches neither. Only an actual change is
 * set, the rule applyAiModes keeps for the same reason — re-committing to a
 * stance every turn would hand this team a permanent charge bonus.
 */
export function applyScriptedOrders(state) {
  const script = state.scriptedOrders;
  if (!script || script.length === 0) return;
  const orders = script[Math.min(state.turnIndex, script.length - 1)];
  applyOrders(state, orders);
  for (const { id, mode } of orders) {
    if (mode && getPlayer(state, id).mode !== mode) setMode(state, id, mode);
  }
}
```

- [ ] **Step 4: Branch on it in `coachAi`, before the generic mode rule**

In `lib/game/ai.js`, `coachAi` becomes:

```js
export function coachAi(state) {
  if (!state.aiTeam) return;
  // Before applyAiModes, exactly as the learned offense branches before it:
  // an authored stance is the script's business, and the generic break-down
  // rule would overwrite it every turn.
  if (state.aiLevel === 'scripted') {
    applyScriptedOrders(state);
    return;
  }
  if (state.aiTeam === 'offense' && state.aiLevel === 'learned') {
    coachLearnedOffense(state, activeGenome(state, 'offense'));
    return;
  }
  applyAiModes(state);
  if (state.aiLevel === 'learned' && state.aiTeam === 'defense') {
    coachLearnedDefense(state);
    return;
  }
  if (state.aiLevel === 'smart') {
    coachSmartDefense(state);
    return;
  }
  for (const { id, dir, throttle } of defensePlans(state)) setPlan(state, id, dir, throttle);
}
```

- [ ] **Step 5: Run the tests, then the whole suite**

Run: `node --test test/game/tutorial/scripted-ai.test.js`
Expected: PASS.

Run: `npm test`
Expected: no new failures. `coachAi` is on the hot path of every turn in the game and in the trainers.

- [ ] **Step 6: Commit**

```bash
git add lib/game/ai.js test/game/tutorial/scripted-ai.test.js && git commit -m "feat: a scripted brain, for an opponent that has to demonstrate something"
```

---

### Task 4: The script, as data

**Files:**
- Create: `lib/game/tutorial/script.js`
- Test: `test/game/tutorial/script.test.js` (create)

**Interfaces:**
- Consumes: drill roster ids from Task 2; `state.scriptedOrders` order shape from Task 3.
- Produces: `TUTORIAL_LOS_YARD` (the number 50) and `SCENARIOS` (an array of four) exported from `lib/game/tutorial/script.js`.

A **scenario** is:

```
{ id, title, variantId, seed, coach, scripted, buttons, orders, steps, outro }
```

`coach` is the side the human coaches (`'offense'` or `'defense'`); `scripted` is the other one, which becomes `state.aiTeam`. `buttons` is which board buttons the lesson fields, from `'reposition' | 'autoplan' | 'run'`. `orders` is the array Task 3 consumes.

A **step** is:

```
{ id, text, highlight, allow, nudge, needsLivePlay, demo, done }
```

- `highlight`: `{kind:'button', name}` | `{kind:'player', id}` | `null`
- `allow`: `{action:'run'|'reposition'|'any'}` or `{action:'gesture', playerIds:[...], kinds:[...]}`
- `demo`: an array of model answers, never read by the running game — see Task 6
- `done(state, ctx)`: `ctx` is `{ repositioning, startSpots }`

- [ ] **Step 1: Write the failing validity test**

Create `test/game/tutorial/script.test.js`. This test is the one that keeps the data honest, since the data is where the whole tutorial lives.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, TUTORIAL_LOS_YARD } from '../../../lib/game/tutorial/script.js';
import { getRoster } from '../../../lib/game/rosters.js';
import { createGame } from '../../../lib/game/state.js';

const GESTURES = ['drag', 'passdrag', 'doubletap', 'click'];
const VERBS = ['run', 'runout', 'reposition', 'menu', 'drag', 'cover', 'doubletap', 'pass', 'move', 'none'];
const BUTTONS = ['reposition', 'autoplan', 'run', 'menu'];

test('every lesson is played on the fifty, on a roster that exists', () => {
  assert.equal(TUTORIAL_LOS_YARD, 50);
  assert.equal(SCENARIOS.length, 4);
  for (const s of SCENARIOS) {
    assert.equal(getRoster(s.variantId).id, s.variantId, `${s.id}: real roster`);
    assert.ok(s.title && s.outro, `${s.id}: has a title and a sign-off`);
    assert.notEqual(s.coach, s.scripted, `${s.id}: the two sides are different sides`);
    for (const b of s.buttons) assert.ok(BUTTONS.includes(b), `${s.id}: button ${b}`);
  }
});

test('every authored order names a man the scripted side actually fields', () => {
  for (const s of SCENARIOS) {
    const roster = getRoster(s.variantId);
    const mine = new Set(roster[s.scripted].map((p) => p.id));
    const theirs = new Set(roster[s.coach].map((p) => p.id));
    assert.ok(s.orders.length > 0, `${s.id}: the other side has been told something`);
    for (const [turn, orders] of s.orders.entries()) {
      for (const o of orders) {
        assert.ok(mine.has(o.id), `${s.id} turn ${turn}: ${o.id} is on the scripted side`);
        if (o.cover) assert.ok(theirs.has(o.cover), `${s.id} turn ${turn}: covers a real opponent`);
        assert.ok(o.aim || o.cover || o.mode, `${s.id} turn ${turn}: ${o.id} was told something`);
      }
    }
  }
});

test('every step is answerable: a real man, a real verb, and words to nudge with', () => {
  for (const s of SCENARIOS) {
    const roster = getRoster(s.variantId);
    const coached = new Set(roster[s.coach].map((p) => p.id));
    const everyone = new Set([...roster.offense, ...roster.defense].map((p) => p.id));
    assert.ok(s.steps.length > 0, `${s.id}: has steps`);
    for (const step of s.steps) {
      const where = `${s.id}/${step.id}`;
      assert.equal(typeof step.text, 'string', `${where}: says something`);
      assert.equal(typeof step.done, 'function', `${where}: knows when it has landed`);
      assert.equal(typeof step.needsLivePlay, 'boolean', `${where}: says if it needs a live play`);
      assert.ok(Array.isArray(step.demo), `${where}: demo is a list`);
      for (const d of step.demo) assert.ok(VERBS.includes(d.verb), `${where}: verb ${d.verb}`);

      if (step.allow.action === 'gesture') {
        assert.ok(step.nudge, `${where}: a refused gesture has to say what was wanted`);
        for (const id of step.allow.playerIds) {
          assert.ok(coached.has(id), `${where}: ${id} is the coach's own man`);
        }
        for (const k of step.allow.kinds) assert.ok(GESTURES.includes(k), `${where}: kind ${k}`);
      } else {
        assert.ok(['run', 'reposition', 'menu', 'any'].includes(step.allow.action), `${where}: action`);
        if (step.allow.action !== 'any') assert.ok(step.nudge, `${where}: has a nudge`);
      }

      if (step.highlight?.kind === 'player') {
        assert.ok(everyone.has(step.highlight.id), `${where}: highlights a real man`);
      }
      if (step.highlight?.kind === 'button') {
        assert.ok(s.buttons.includes(step.highlight.name),
          `${where}: highlights a button this lesson actually fields`);
      }
    }
    assert.equal(s.steps.at(-1).needsLivePlay, false,
      `${s.id}: the closing beat outlives the whistle`);
  }
});

test('the tutorial ends by teaching the way out, and only at the very end', () => {
  const menuSteps = SCENARIOS.flatMap((s, i) =>
    s.steps.map((step, j) => ({ s, i, step, j })).filter((x) => x.step.allow.action === 'menu'));
  assert.equal(menuSteps.length, 1, 'exactly one lesson teaches the menu');
  const only = menuSteps[0];
  assert.equal(only.i, SCENARIOS.length - 1, 'and it is the last lesson');
  assert.equal(only.j, only.s.steps.length - 1, 'and its last step');
  assert.ok(only.s.buttons.includes('menu'), 'which therefore fields the clipboard');
  assert.deepEqual(only.step.highlight, { kind: 'button', name: 'menu' }, 'with the ring on it');
});

test('a lesson deals the men its steps talk about', () => {
  for (const s of SCENARIOS) {
    const state = createGame({
      seed: s.seed, variant: s.variantId, losYard: TUTORIAL_LOS_YARD,
      ai: s.scripted, aiLevel: 'scripted', scriptedOrders: s.orders,
    });
    assert.equal(state.losYard, 50, `${s.id}: on the fifty`);
    assert.equal(state.aiTeam, s.scripted, `${s.id}: the computer has the other side`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/tutorial/script.test.js`
Expected: FAIL — `lib/game/tutorial/script.js` does not exist.

- [ ] **Step 3: Write the script**

Create `lib/game/tutorial/script.js`:

```js
/**
 * The tutorial, as data. Four lessons, each a single down on the fifty with a
 * handful of men on the field.
 *
 * Nothing here decides anything: machine.js reads it, app/tutorial.js plays it,
 * and the game underneath is the ordinary game. What lives here is what a
 * coach is told, which man he is allowed to touch while he is being told it,
 * and how the lesson knows the beat has landed.
 *
 * `demo` is the model answer for each step, and the running game never reads
 * it. It exists so the integration test can perform a step's intended action
 * without knowing what the step meant, which is what makes "the seed still
 * produces the authored beats" a thing a test can assert at all.
 */
import { fieldPos } from '../view.js';
import { getPlayer } from '../state.js';

export const TUTORIAL_LOS_YARD = 50;

/** A field point in the drill's own terms: yards across, yards from the line. */
function spot(across, down) {
  return fieldPos(across, TUTORIAL_LOS_YARD + down);
}

/** The whistle has gone, however it went. */
function playOver(state) {
  return state.phase === 'playOver' || state.phase === 'gameOver';
}

/** The closing beat every lesson ends on: run it out and see what happens. */
function whistleStep(text) {
  return {
    id: 'whistle',
    text,
    highlight: { kind: 'button', name: 'run' },
    allow: { action: 'run' },
    nudge: 'Press the fast-forward button to keep the play going.',
    needsLivePlay: false,
    // `runout`, not `run`: this beat ends when the whistle goes, and one
    // half-second turn is very unlikely to be the one that does it.
    demo: [{ verb: 'runout' }],
    done: (state) => playOver(state),
  };
}

/** A fast-forward beat: press run, and the turn count says it happened. */
function runStep(id, text, turnsSoFar) {
  return {
    id,
    text,
    highlight: { kind: 'button', name: 'run' },
    allow: { action: 'run' },
    nudge: 'Press the fast-forward button — that is what runs the half-second.',
    needsLivePlay: true,
    demo: [{ verb: 'run' }],
    done: (state) => state.turnIndex > turnsSoFar,
  };
}

const SNAP_AND_RUN = {
  id: 'snap-and-run',
  title: 'The snap, and running with it',
  variantId: 'tutorial-2v2',
  seed: 1001,
  coach: 'offense',
  scripted: 'defense',
  buttons: ['run'],
  // A real rush, but only one man chasing: the nose tackle takes the
  // quarterback and the backer fills behind him, so the taught beats have room
  // to land before anybody gets home.
  orders: [
    [{ id: 'd-nt', aim: spot(0, -4) }, { id: 'd-lb', aim: spot(0, 1) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', aim: spot(0, 0) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', aim: spot(-4, -2) }],
  ],
  steps: [
    {
      id: 'snap',
      text: 'Every play starts with the snap. The dashed arrow from your centre '
        + 'to the quarterback is already drawn — it is the one order you never '
        + 'have to give. You could aim it at somebody else, but not today. '
        + 'Press the fast-forward button to run the first half-second.',
      highlight: { kind: 'button', name: 'run' },
      allow: { action: 'run' },
      nudge: 'Press the fast-forward button to snap it.',
      needsLivePlay: true,
      demo: [{ verb: 'run' }],
      done: (state) => state.turnIndex > 0,
    },
    {
      id: 'run-the-qb',
      text: 'He has it. Drag out from the quarterback to send him running. '
        + 'The drag says two things at once: which way, and how hard — a long '
        + 'arrow is a sprint, a short one a jog. The filled circle is where he '
        + 'actually gets to by the whistle.',
      highlight: { kind: 'player', id: 'o-qb' },
      allow: { action: 'gesture', playerIds: ['o-qb'], kinds: ['drag'] },
      nudge: 'Drag out from the quarterback — he is the one with the ball.',
      needsLivePlay: true,
      demo: [{ verb: 'drag', id: 'o-qb', to: spot(-9, -3) }],
      done: (state) => getPlayer(state, 'o-qb').plan !== null,
    },
    runStep('run-it-1', 'Now run it. Half a second at a time is the whole game.', 1),
    {
      id: 'tuck',
      text: 'Double-tap the quarterback — two quick taps — and he tucks the ball '
        + 'away. Tucked he is a shade slower and much harder to strip, and he is '
        + 'locked onto the line he was already running: full pace along it, a '
        + 'shuffle across it.',
      highlight: { kind: 'player', id: 'o-qb' },
      allow: { action: 'gesture', playerIds: ['o-qb'], kinds: ['doubletap'] },
      nudge: 'Two quick taps on the quarterback, in the same place.',
      needsLivePlay: true,
      demo: [{ verb: 'doubletap', id: 'o-qb', mode: 'tucked' }],
      done: (state) => getPlayer(state, 'o-qb').mode === 'tucked',
    },
    runStep('run-it-2', 'Run it again and see what the tuck bought you.', 2),
    whistleStep('Keep running it out. Arrows carry from turn to turn, so he '
      + 'keeps going until you tell him otherwise — or until they get him.'),
  ],
  outro: 'That is the whole loop: draw, run, draw again. Next, the two things '
    + 'that make a play out of it — a block and a throw.',
};

const BLOCK_AND_THROW = {
  id: 'block-and-throw',
  title: 'Blocking, and throwing it',
  variantId: 'tutorial-pass',
  seed: 2002,
  coach: 'offense',
  scripted: 'defense',
  buttons: ['run'],
  orders: [
    [{ id: 'd-nt', aim: spot(0, -4) }, { id: 'd-lb', aim: spot(0, 1) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', aim: spot(3, -2) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', cover: 'o-rb' }],
  ],
  steps: [
    {
      id: 'cut-block',
      text: 'You have a back now. Start with the centre: double-tap him for a '
        + 'cut block. Only a lineman can throw one and only on the first turn '
        + 'of a play — it is a call made at the line. The shove itself waits '
        + 'for the snap, so you can finish the huddle first.',
      highlight: { kind: 'player', id: 'o-c' },
      allow: { action: 'gesture', playerIds: ['o-c'], kinds: ['doubletap'] },
      nudge: 'Two quick taps on the centre — the man over the ball.',
      needsLivePlay: true,
      demo: [{ verb: 'doubletap', id: 'o-c', mode: 'cutBlock' }],
      done: (state) => getPlayer(state, 'o-c').mode === 'cutBlock',
    },
    {
      id: 'routes',
      text: 'Now send the quarterback and the back wherever you like — but keep '
        + 'the quarterback behind the line, because next turn he is throwing, '
        + 'and a forward pass from past the line is a flag.',
      highlight: { kind: 'player', id: 'o-rb' },
      allow: { action: 'gesture', playerIds: ['o-qb', 'o-rb'], kinds: ['drag'] },
      nudge: 'Drag out from the quarterback and from the back — both of them.',
      needsLivePlay: true,
      demo: [
        { verb: 'drag', id: 'o-qb', to: spot(-3, -6) },
        { verb: 'drag', id: 'o-rb', to: spot(13, -3) },
      ],
      done: (state) =>
        getPlayer(state, 'o-qb').plan !== null && getPlayer(state, 'o-rb').plan !== null,
    },
    runStep('run-it-1', 'Run it, and watch the centre go.', 0),
    {
      id: 'throw',
      text: 'Now the throw: double-tap the quarterback and, without letting go, '
        + 'drag onto the back. Dropping it on one of your own locks the ball '
        + 'onto him — the throw is aimed where he will be, not where he is.',
      highlight: { kind: 'player', id: 'o-rb' },
      allow: { action: 'gesture', playerIds: ['o-qb'], kinds: ['passdrag', 'doubletap'] },
      nudge: 'Two quick taps on the quarterback, then drag onto the back.',
      needsLivePlay: true,
      demo: [{ verb: 'pass', from: 'o-qb', target: 'o-rb' }],
      done: (state) =>
        state.plannedPass?.from === 'o-qb' && state.plannedPass?.target === 'o-rb',
    },
    runStep('run-it-2', 'Let it go.', 1),
    whistleStep('Run it out. A forward pass is decided inside the turn it was '
      + 'thrown: caught, picked, or incomplete by the whistle.'),
  ],
  outro: 'A block, a route and a throw. Now the other side of the ball.',
};

const PLAYING_DEFENSE = {
  id: 'playing-defense',
  title: 'Playing defense',
  variantId: 'tutorial-2v2',
  seed: 3003,
  coach: 'defense',
  scripted: 'offense',
  buttons: ['run'],
  // The centre takes the nose tackle and the quarterback runs left, harder and
  // wider each turn. The lesson is entirely about the backer.
  orders: [
    [{ id: 'o-c', cover: 'd-nt' }, { id: 'o-qb', aim: spot(-7, -4) }],
    [{ id: 'o-c', cover: 'd-nt' }, { id: 'o-qb', aim: spot(-15, -2) }],
    [{ id: 'o-c', cover: 'd-nt' }, { id: 'o-qb', aim: spot(-22, 2) }],
  ],
  steps: [
    {
      id: 'cover',
      text: 'Your turn to stop it. The centre is going to take your nose tackle, '
        + 'and the quarterback is going left. Drag out from your linebacker and '
        + 'drop it on the quarterback: that is a cover order, not an arrow. It '
        + 'is re-aimed at wherever he has got to, every fraction of a second, '
        + 'which is how you stay with a man who cuts.',
      highlight: { kind: 'player', id: 'd-lb' },
      allow: { action: 'gesture', playerIds: ['d-lb'], kinds: ['drag'] },
      nudge: 'Drag from your linebacker onto the quarterback.',
      needsLivePlay: true,
      demo: [{ verb: 'cover', id: 'd-lb', target: 'o-qb' }],
      done: (state) => getPlayer(state, 'd-lb').cover === 'o-qb',
    },
    runStep('run-it-1', 'Run it and watch him track.', 0),
    {
      id: 'break-down',
      text: 'He is on him. Double-tap your linebacker to break down — feet set, '
        + 'arms out. He reaches further and hits harder inside the wedge he is '
        + 'facing, and from here he can only shuffle sideways. It is the trade '
        + 'the computer makes for itself when it gets this close.',
      highlight: { kind: 'player', id: 'd-lb' },
      allow: { action: 'gesture', playerIds: ['d-lb'], kinds: ['doubletap'] },
      nudge: 'Two quick taps on your linebacker.',
      needsLivePlay: true,
      demo: [{ verb: 'doubletap', id: 'd-lb', mode: 'prepared' }],
      done: (state) => getPlayer(state, 'd-lb').mode === 'prepared',
    },
    whistleStep('Now go and get him.'),
  ],
  outro: 'Cover a man, close him down, set your feet. One thing left: where '
    + 'everybody stands before any of it starts.',
};

const WHERE_THEY_STAND = {
  id: 'where-they-stand',
  title: 'Where they stand',
  variantId: 'tutorial-2v2',
  seed: 4004,
  coach: 'offense',
  scripted: 'defense',
  // 'menu' is not a quick-press plate — renderFieldButtons never draws it, and
  // menuButtonMark does. It is named here so the clipboard counts as a control
  // this lesson fields, which is what lets the last step put a ring on it.
  buttons: ['reposition', 'run', 'menu'],
  orders: [
    [{ id: 'd-nt', aim: spot(0, -4) }, { id: 'd-lb', aim: spot(0, 1) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', aim: spot(0, 0) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', cover: 'o-qb' }],
  ],
  steps: [
    {
      id: 'reposition-on',
      text: 'A play starts before the snap. Press the shuffle button to move '
        + 'your men around instead of ordering them about.',
      highlight: { kind: 'button', name: 'reposition' },
      allow: { action: 'reposition' },
      nudge: 'Press the shuffle button — the one above fast-forward.',
      needsLivePlay: true,
      demo: [{ verb: 'reposition' }],
      done: (state, ctx) => ctx.repositioning === true,
    },
    {
      id: 'move-him',
      text: 'Now drag your quarterback somewhere else. In this mode a drag moves '
        + 'the man rather than giving him an order, and the snap re-aims itself '
        + 'from wherever the two of them end up.',
      highlight: { kind: 'player', id: 'o-qb' },
      allow: { action: 'gesture', playerIds: ['o-qb'], kinds: ['drag', 'passdrag'] },
      nudge: 'Drag the quarterback to a new spot.',
      needsLivePlay: true,
      demo: [{ verb: 'move', id: 'o-qb', to: spot(-5, -5) }],
      done: (state, ctx) => {
        const p = getPlayer(state, 'o-qb');
        const was = ctx.startSpots['o-qb'];
        return p.pos.x !== was.x || p.pos.y !== was.y;
      },
    },
    {
      id: 'reposition-off',
      text: 'Press it again to go back to drawing arrows.',
      highlight: { kind: 'button', name: 'reposition' },
      allow: { action: 'reposition' },
      nudge: 'Press the shuffle button again.',
      needsLivePlay: true,
      demo: [{ verb: 'reposition' }],
      done: (state, ctx) => ctx.repositioning === false,
    },
    {
      id: 'coach-it',
      text: 'That is everything. Coach this one however you like — draw what you '
        + 'want, run it out, and see where it ends up.',
      highlight: null,
      allow: { action: 'any' },
      nudge: null,
      needsLivePlay: false,
      demo: [{ verb: 'drag', id: 'o-qb', to: spot(-8, -1) }, { verb: 'runout' }],
      done: (state) => playOver(state),
    },
    {
      id: 'the-menu',
      text: 'You are ready to coach. One last thing: the clipboard opens the '
        + 'Coaches Menu, and everything that is not on the board lives behind '
        + 'it — your playbook, your personnel, the velocity lines, and the way '
        + 'home. Press it, then press Back to Home.',
      highlight: { kind: 'button', name: 'menu' },
      allow: { action: 'menu' },
      nudge: 'Press the clipboard on the right to open the Coaches Menu.',
      needsLivePlay: false,
      demo: [{ verb: 'menu' }],
      // Read off the dialog itself rather than off a flag somebody has to
      // remember to set: the menu being open IS the thing this step is waiting
      // for, and <dialog>.open already knows.
      done: (state, ctx) => ctx.menuOpen === true,
    },
  ],
  // Never shown: opening the menu advances past the last step of the last
  // lesson, which is what ends the tutorial. It is written down anyway so that
  // cardFor has something to say if a lesson is ever reordered.
  outro: 'You are ready to coach. Pick a game and go.',
};

export const SCENARIOS = [SNAP_AND_RUN, BLOCK_AND_THROW, PLAYING_DEFENSE, WHERE_THEY_STAND];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/tutorial/script.test.js`
Expected: PASS. If the "every step is answerable" test fails on a `playerIds` entry, you have named a man on the wrong side — remember scenario 3's coach is the *defense*.

- [ ] **Step 5: Commit**

```bash
git add lib/game/tutorial/script.js test/game/tutorial/script.test.js && git commit -m "feat: the four lessons, written down as data"
```

---

### Task 5: The step machine

**Files:**
- Create: `lib/game/tutorial/machine.js`
- Test: `test/game/tutorial/machine.test.js` (create)

**Interfaces:**
- Consumes: `SCENARIOS` from Task 4.
- Produces, all exported from `lib/game/tutorial/machine.js`:
  - `stepAt(scenario, index)` → step object or `null`
  - `allows(scenario, index, action)` → `null` to proceed, or the nudge string
  - `advance(scenario, index, state, ctx)` → the new index (may jump more than one)
  - `offScript(scenario, index, state)` → boolean
  - `cardFor(scenario, index, opts)` → `{ title, progress, text, highlight, control, footer }`
  - `showsMenu(scenario, index)` → boolean; whether the 📋 plate should be on the board right now

An **action** is `{kind:'run'}`, `{kind:'reposition'}`, `{kind:'menu'}`, or `{kind:'gesture', playerId, gestureKind}`.

- [ ] **Step 1: Write the failing tests**

Create `test/game/tutorial/machine.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stepAt, allows, advance, offScript, cardFor, showsMenu,
} from '../../../lib/game/tutorial/machine.js';

// A scenario of this test's own, so the assertions describe the machine rather
// than whatever the real script happens to say this week.
const SCENARIO = {
  id: 'fake', title: 'A lesson', outro: 'Well done.',
  steps: [
    {
      id: 'one', text: 'Press it.', highlight: { kind: 'button', name: 'run' },
      allow: { action: 'run' }, nudge: 'Press run.', needsLivePlay: true,
      demo: [{ verb: 'run' }], done: (s) => s.turnIndex > 0,
    },
    {
      id: 'two', text: 'Drag him.', highlight: { kind: 'player', id: 'o-qb' },
      allow: { action: 'gesture', playerIds: ['o-qb'], kinds: ['drag'] },
      nudge: 'Drag the quarterback.', needsLivePlay: true,
      demo: [], done: (s) => s.dragged === true,
    },
    {
      id: 'three', text: 'Run it out.', highlight: null,
      allow: { action: 'any' }, nudge: null, needsLivePlay: false,
      demo: [], done: (s) => s.phase === 'playOver',
    },
  ],
};

test('the clipboard is on the board only for the step that asks for it', () => {
  const withMenu = {
    ...SCENARIO,
    steps: [...SCENARIO.steps, {
      id: 'four', text: 'Open the menu.', highlight: { kind: 'button', name: 'menu' },
      allow: { action: 'menu' }, nudge: 'Press the clipboard.', needsLivePlay: false,
      demo: [], done: (s, ctx) => ctx.menuOpen === true,
    }],
  };
  assert.equal(showsMenu(withMenu, 0), false);
  assert.equal(showsMenu(withMenu, 3), true);
  assert.equal(showsMenu(withMenu, 4), false, 'past the last step there is no lesson left');
});

test('a menu press is refused everywhere except the step that teaches it', () => {
  assert.equal(allows(SCENARIO, 0, { kind: 'menu' }), 'Press run.');
  const menuStep = {
    ...SCENARIO,
    steps: [{
      id: 'only', text: 'Open it.', highlight: { kind: 'button', name: 'menu' },
      allow: { action: 'menu' }, nudge: 'Press the clipboard.', needsLivePlay: false,
      demo: [], done: (s, ctx) => ctx.menuOpen === true,
    }],
  };
  assert.equal(allows(menuStep, 0, { kind: 'menu' }), null);
  assert.equal(allows(menuStep, 0, { kind: 'run' }), 'Press the clipboard.');
});

test('a step allows exactly the action it asked for and refuses the rest', () => {
  assert.equal(allows(SCENARIO, 0, { kind: 'run' }), null);
  assert.equal(allows(SCENARIO, 0, { kind: 'reposition' }), 'Press run.');
  assert.equal(allows(SCENARIO, 0, { kind: 'menu' }), 'Press run.');
});

test('a gesture is judged on the man and the verb, both', () => {
  const ok = { kind: 'gesture', playerId: 'o-qb', gestureKind: 'drag' };
  assert.equal(allows(SCENARIO, 1, ok), null);
  assert.equal(
    allows(SCENARIO, 1, { kind: 'gesture', playerId: 'o-c', gestureKind: 'drag' }),
    'Drag the quarterback.', 'the wrong man');
  assert.equal(
    allows(SCENARIO, 1, { kind: 'gesture', playerId: 'o-qb', gestureKind: 'doubletap' }),
    'Drag the quarterback.', 'the wrong verb');
});

test('a single tap is never refused: it is how the double tap is armed', () => {
  // input.js records the arming tap before onGesture is ever called, and a lone
  // tap does nothing in the real game either — so nudging one would only
  // scold a coach halfway through a legal double tap.
  assert.equal(allows(SCENARIO, 0, { kind: 'gesture', playerId: 'o-qb', gestureKind: 'click' }), null);
  assert.equal(allows(SCENARIO, 1, { kind: 'gesture', playerId: 'o-c', gestureKind: 'click' }), null);
});

test("an 'any' step lets a coach do whatever he likes", () => {
  assert.equal(allows(SCENARIO, 2, { kind: 'run' }), null);
  assert.equal(allows(SCENARIO, 2, { kind: 'gesture', playerId: 'o-c', gestureKind: 'drag' }), null);
});

test('past the last step nothing is gated — that card is the sign-off', () => {
  assert.equal(stepAt(SCENARIO, 3), null);
  assert.equal(allows(SCENARIO, 3, { kind: 'reposition' }), null);
});

test('advancing walks past every step that has already landed, not just one', () => {
  const ctx = {};
  assert.equal(advance(SCENARIO, 0, { turnIndex: 0, phase: 'planning' }, ctx), 0);
  assert.equal(advance(SCENARIO, 0, { turnIndex: 1, phase: 'planning' }, ctx), 1);
  // One press satisfied the run step AND ended the play: the machine must not
  // strand the coach on a step whose condition is already true.
  assert.equal(
    advance(SCENARIO, 0, { turnIndex: 1, dragged: true, phase: 'playOver' }, ctx), 3);
});

test('a play that dies while a step still needs it is off script', () => {
  assert.equal(offScript(SCENARIO, 0, { phase: 'planning', penalty: null }), false);
  assert.equal(offScript(SCENARIO, 0, { phase: 'playOver', penalty: null }), true);
  assert.equal(offScript(SCENARIO, 2, { phase: 'playOver', penalty: null }), false,
    'the closing beat is meant to outlive the whistle');
  assert.equal(offScript(SCENARIO, 3, { phase: 'playOver', penalty: null }), false,
    'so is the sign-off');
});

test('a flag is off script whatever the phase says', () => {
  assert.equal(
    offScript(SCENARIO, 2, { phase: 'planning', penalty: { foul: 'second-forward-pass' } }),
    true);
});

test('the card counts the steps and carries the highlight through', () => {
  const c = cardFor(SCENARIO, 1, { attempt: 1, isLastScenario: false });
  assert.equal(c.title, 'A lesson');
  assert.equal(c.progress, 'Step 2 of 3');
  assert.equal(c.text, 'Drag him.');
  assert.deepEqual(c.highlight, { kind: 'player', id: 'o-qb' });
  assert.equal(c.control, 'Skip lesson');
  assert.equal(c.footer, null);
});

test('a second attempt is told, on the card, where the door is', () => {
  assert.match(cardFor(SCENARIO, 0, { attempt: 2 }).footer, /skip/i);
});

test('the sign-off card says the outro and offers the way on', () => {
  const c = cardFor(SCENARIO, 3, { attempt: 1, isLastScenario: false });
  assert.equal(c.text, 'Well done.');
  assert.equal(c.highlight, null);
  assert.equal(c.control, 'Next lesson');
  assert.equal(cardFor(SCENARIO, 3, { isLastScenario: true }).control, 'Finish');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/tutorial/machine.test.js`
Expected: FAIL — `lib/game/tutorial/machine.js` does not exist.

- [ ] **Step 3: Write the machine**

Create `lib/game/tutorial/machine.js`:

```js
/**
 * The tutorial's step machine. Pure: it reads a scenario and a game state and
 * says what may happen, what has happened, and what the card should say. It
 * mutates nothing and knows nothing about the browser.
 *
 * Strictness is drawn deliberately: strict on WHICH MAN and WHICH VERB, and
 * guiding on where the arrow lands. Refusing a cover drag that missed the
 * quarterback by two units would read as a broken game rather than as a lesson,
 * so a drag on the right man that achieves nothing is allowed — it simply does
 * not land the step, and the card asks again.
 */

/** The step at this index, or null — past the last step is the sign-off card. */
export function stepAt(scenario, index) {
  return scenario.steps[index] ?? null;
}

/**
 * Null to go ahead, or the words to say instead. The caller must not have
 * applied anything before asking: a refusal has to leave the board exactly as
 * the coach found it, or "that did not happen" becomes a lie.
 */
export function allows(scenario, index, action) {
  const step = stepAt(scenario, index);
  if (step === null) return null; // the sign-off gates nothing
  // A lone tap does nothing in the real game, and app/input.js records it as
  // the arming half of a double tap before this is ever consulted. Refusing one
  // would scold a coach halfway through a gesture the step actually wants.
  if (action.kind === 'gesture' && action.gestureKind === 'click') return null;
  const want = step.allow;
  if (want.action === 'any') return null;
  if (want.action !== action.kind) return step.nudge;
  if (want.action !== 'gesture') return null;
  if (!want.playerIds.includes(action.playerId)) return step.nudge;
  if (!want.kinds.includes(action.gestureKind)) return step.nudge;
  return null;
}

/**
 * The index after everything that has already landed. A loop rather than a
 * single check because one press can satisfy two beats at once — the turn that
 * finishes a run step can also be the turn that ends the play — and a coach
 * left sitting on a step whose condition is already true has no way forward.
 */
export function advance(scenario, index, state, ctx) {
  let i = index;
  while (i < scenario.steps.length && scenario.steps[i].done(state, ctx)) i += 1;
  return i;
}

/**
 * Whether the Coaches Menu should be on the board right now. True only for a
 * step that asks to be pressed — which is the last step of the last lesson, and
 * nothing else.
 *
 * Derived from the step rather than kept as a flag beside it so that the plate
 * drawn and the press accepted cannot disagree: one condition decides both.
 */
export function showsMenu(scenario, index) {
  return stepAt(scenario, index)?.allow.action === 'menu';
}

/**
 * Whether this down stopped being the one the script was written for. Asked
 * AFTER advancing, so the closing beat is reached before the whistle it is
 * meant to outlive gets called a failure.
 */
export function offScript(scenario, index, state) {
  if (state.penalty) return true;
  const step = stepAt(scenario, index);
  if (step === null || !step.needsLivePlay) return false;
  return state.phase === 'playOver' || state.phase === 'gameOver';
}

/**
 * What the coach card says. `attempt` counts from 1; from the second onwards
 * the footer names the skip, so a coach who keeps losing the down is always
 * shown the door rather than having to find it.
 */
export function cardFor(scenario, index, { attempt = 1, isLastScenario = false } = {}) {
  const step = stepAt(scenario, index);
  if (step === null) {
    return {
      title: scenario.title,
      progress: 'Lesson done',
      text: scenario.outro,
      highlight: null,
      control: isLastScenario ? 'Finish' : 'Next lesson',
      footer: null,
    };
  }
  return {
    title: scenario.title,
    progress: `Step ${index + 1} of ${scenario.steps.length}`,
    text: step.text,
    highlight: step.highlight ?? null,
    control: 'Skip lesson',
    footer: attempt > 1 ? 'Stuck? Skip lesson moves you on.' : null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/game/tutorial/machine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/game/tutorial/machine.js test/game/tutorial/machine.test.js && git commit -m "feat: the step machine that gates a lesson"
```

---

### Task 6: The seed holds the script

This is the task that decides whether the tutorial works. It drives every
scenario through the real engine, performing each step's `demo`, and proves the
authored beats actually land at the chosen seeds. **Expect to tune Task 4's
`orders`, `demo` targets and `seed` values here.** That is the job, not a
setback.

**Files:**
- Test: `test/game/tutorial/integration.test.js` (create)
- Modify (tuning only): `lib/game/tutorial/script.js`

**Interfaces:**
- Consumes: `SCENARIOS`, `TUTORIAL_LOS_YARD` (Task 4); `advance`, `offScript`, `stepAt` (Task 5); `createGame` (Task 1); drill rosters (Task 2); the `'scripted'` level (Task 3).
- Produces: no source interface. It produces confidence, and it is the regression net for every future physics or tuning change.

- [ ] **Step 1: Write the driver and the test**

Create `test/game/tutorial/integration.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, TUTORIAL_LOS_YARD } from '../../../lib/game/tutorial/script.js';
import { advance, offScript, stepAt } from '../../../lib/game/tutorial/machine.js';
import { createGame, getPlayer, setPlan, setMode, setPass } from '../../../lib/game/state.js';
import { runTurn } from '../../../lib/game/turn.js';
import { setCover } from '../../../lib/game/cover.js';
import { placePlayer } from '../../../lib/game/formation.js';
import { planForDrag } from '../../../lib/game/predict.js';
import { lockOnPass } from '../../../lib/game/pass.js';
import { mulberry32 } from '../../../lib/game/rng.js';
import { sub } from '../../../lib/game/vec.js';

/** Deal a scenario exactly as app/tutorial.js will. */
function deal(scenario) {
  const state = createGame({
    seed: scenario.seed,
    variant: scenario.variantId,
    losYard: TUTORIAL_LOS_YARD,
    ai: scenario.scripted,
    aiLevel: 'scripted',
    scriptedOrders: scenario.orders,
  });
  const startSpots = {};
  for (const p of state.players) startSpots[p.id] = { x: p.pos.x, y: p.pos.y };
  return {
    state,
    random: mulberry32(scenario.seed),
    ctx: { repositioning: false, menuOpen: false, startSpots },
  };
}

/**
 * Perform one model answer. This is the coach's hands: every verb here is the
 * same call app/main.js makes when a real gesture commits, so a demo that works
 * is a gesture that works.
 */
function perform(run, verb) {
  const { state, ctx } = run;
  if (verb.verb === 'run') { runTurn(state, run.random); return; }
  if (verb.verb === 'runout') {
    // To the whistle, however many turns that takes. The capped loop is a
    // backstop: a play that will not die is a bug in the scenario, and it
    // should fail as an assertion rather than hang the suite.
    for (let i = 0; i < 30 && state.phase === 'planning'; i += 1) runTurn(state, run.random);
    assert.notEqual(state.phase, 'planning', 'the play never ended');
    return;
  }
  if (verb.verb === 'reposition') { ctx.repositioning = !ctx.repositioning; return; }
  // In the browser this is <dialog>.open going true; here it is the same fact,
  // written down by the only hands the test has.
  if (verb.verb === 'menu') { ctx.menuOpen = true; return; }
  if (verb.verb === 'none') return;
  if (verb.verb === 'drag') {
    const p = getPlayer(state, verb.id);
    const plan = planForDrag(p, sub(verb.to, p.pos));
    setPlan(state, verb.id, plan.dir, plan.throttle, plan.target, plan.short);
    return;
  }
  if (verb.verb === 'cover') {
    assert.ok(setCover(state, verb.id, verb.target), `${verb.id} could not cover ${verb.target}`);
    return;
  }
  if (verb.verb === 'doubletap') {
    assert.ok(setMode(state, verb.id, verb.mode), `${verb.id} was refused ${verb.mode}`);
    return;
  }
  if (verb.verb === 'pass') {
    const from = getPlayer(state, verb.from);
    const aim = lockOnPass(from, getPlayer(state, verb.target));
    assert.ok(setPass(state, verb.from, aim.dir, aim.power, verb.target),
      `${verb.from} could not throw`);
    return;
  }
  if (verb.verb === 'move') {
    assert.ok(placePlayer(state, verb.id, verb.to), `${verb.id} could not be moved there`);
    return;
  }
  throw new Error(`unknown demo verb "${verb.verb}"`);
}

for (const scenario of SCENARIOS) {
  test(`${scenario.id}: the seed still produces the beats the script teaches`, () => {
    const run = deal(scenario);
    let index = 0;
    // A generous ceiling: every scenario is a handful of steps, and a runaway
    // loop should fail as a loop rather than hang the suite.
    for (let guard = 0; guard < 40 && index < scenario.steps.length; guard += 1) {
      const step = stepAt(scenario, index);
      for (const verb of step.demo) perform(run, verb);
      const next = advance(scenario, index, run.state, run.ctx);
      assert.notEqual(next, index,
        `${scenario.id}/${step.id}: the model answer did not land the step`);
      index = next;
      assert.equal(offScript(scenario, index, run.state), false,
        `${scenario.id}: went off script after ${step.id}`
        + ` (phase ${run.state.phase}, penalty ${JSON.stringify(run.state.penalty)})`);
    }
    assert.equal(index, scenario.steps.length, `${scenario.id}: every step landed`);
  });
}

test('no lesson can draw an illegal-formation flag, whatever the coach does', () => {
  for (const scenario of SCENARIOS) {
    const { state, random } = deal(scenario);
    runTurn(state, random);
    assert.notEqual(state.penalty?.foul, 'illegal-formation', scenario.id);
  }
});
```

- [ ] **Step 2: Run it and read the failures**

Run: `node --test test/game/tutorial/integration.test.js`
Expected: FAIL, probably in more than one scenario. The two failures you will see and what each means:

- *"the model answer did not land the step"* — the demo did what it was told and the step's `done` still says no. Usually the demo target and the `done` predicate disagree; fix the demo, not the predicate.
- *"went off script after \<step\>"* — the play died (or drew a flag) while a later step still needed it live. The message prints the phase and the penalty.

- [ ] **Step 3: Tune, in this order**

Change only `lib/game/tutorial/script.js`, and only these three things, in this order of preference:

1. **The authored `orders`.** An early tackle means the scripted rush is too quick. Send the chaser at a fixed `aim` for another turn before giving him a `cover`, or aim him a yard or two wide of the ball. A `cover` order chases; an `aim` does not.
2. **The `demo` targets.** A quarterback who runs into his own rusher, or who crosses the line before the throw step, is a demo pointed the wrong way. Scenario 2's `o-qb` demo must keep him behind yard 50 or the throw is an illegal-forward-pass flag.
3. **The `seed`.** Only after the first two. A seed changes the tackle and fumble rolls and nothing else; it cannot fix a script that asks for something impossible.

Never change a `done` predicate to make a test pass — that is the step's definition of the lesson landing.

Re-run after every change:

Run: `node --test test/game/tutorial/integration.test.js`

- [ ] **Step 4: Confirm the whole suite is still green**

Run: `npm test`
Expected: no new failures.

- [ ] **Step 5: Commit**

```bash
git add lib/game/tutorial/script.js test/game/tutorial/integration.test.js && git commit -m "test: the seeds hold, and every lesson's beats actually land"
```

---

### Task 7: The button column, asked where its plates are

**Files:**
- Modify: `lib/game/render.js`
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `fieldButtonAnchor(name, losYard, cameraYard)` → `{x, y, r}` or `null`, for `name` in `'reposition' | 'autoplan' | 'run'`
  - `renderFieldButtons(state, { repositioning, animating, cameraYard, allow })` — `allow` is an array of names, or `null`/absent for all of them (unchanged behaviour)
  - `renderBoardShell(losYard, toGoYard, cameraYard, { menu = true })` — `menu: false` omits the Coaches Menu plate; the shell always gains a `game-tutorial` layer on top

- [ ] **Step 1: Write the failing tests**

Append to `test/game/render.test.js` (add `fieldButtonAnchor` to the existing import from `../../lib/game/render.js`):

```js
test('the column can be asked where each of its plates sits', () => {
  const run = fieldButtonAnchor('run', 20);
  const shuffle = fieldButtonAnchor('reposition', 20);
  const gift = fieldButtonAnchor('autoplan', 20);
  assert.equal(run.x, shuffle.x, 'one column');
  assert.equal(run.x, gift.x);
  assert.ok(shuffle.y < gift.y, 'shuffle above the gift');
  assert.ok(gift.y < run.y, 'gift above fast-forward');
  assert.ok(run.r > 0);
  assert.equal(fieldButtonAnchor('nonesuch', 20), null);
});

test('the clipboard is the middle of the column, and still draws where it always did', () => {
  const menuAnchor = fieldButtonAnchor('menu', 20);
  assert.ok(fieldButtonAnchor('reposition', 20).y < menuAnchor.y);
  assert.ok(menuAnchor.y < fieldButtonAnchor('run', 20).y);
  assert.ok(menuButtonMark(20, 20).includes(`y="${num(menuAnchor.y - menuAnchor.r)}"`),
    'the ring a lesson pins to it lands on the plate a paint draws');
});

test('naming the menu in allow does not conjure a second clipboard', () => {
  const s = createGame({ seed: 1, ai: null });
  const m = renderFieldButtons(s, {
    repositioning: false, animating: false, cameraYard: 20, allow: ['run', 'menu'],
  });
  assert.ok(m.includes('data-run-button'));
  assert.equal((m.match(/data-menu-button/g) ?? []).length, 0,
    'menuButtonMark owns that plate, and only it draws one');
});

test('an anchor lands on the plate the same paint actually draws', () => {
  const s = createGame({ seed: 1, ai: null });
  const markup = renderFieldButtons(s, { repositioning: false, animating: false, cameraYard: 20 });
  const anchor = fieldButtonAnchor('run', s.losYard, 20);
  // fieldButtonMark centres the plate on cy, so its y attribute is cy - size/2.
  assert.ok(markup.includes(`y="${num(anchor.y - anchor.r)}"`),
    'the ring and the plate are worked out from one number, not two');
});

test('a lesson fields only the buttons it names', () => {
  const s = createGame({ seed: 1, ai: null });
  const opts = { repositioning: false, animating: false, cameraYard: 20 };
  const all = renderFieldButtons(s, opts);
  assert.ok(all.includes('data-run-button'));
  assert.ok(all.includes('data-autoplan-button'));

  const only = renderFieldButtons(s, { ...opts, allow: ['run'] });
  assert.ok(only.includes('data-run-button'));
  assert.ok(!only.includes('data-autoplan-button'), 'no gift button in a lesson');
  assert.ok(!only.includes('data-reposition-button'));
});

test('the board can be built without a Coaches Menu, and always has a lesson layer', () => {
  const withMenu = renderBoardShell(20, 30, 20);
  assert.ok(withMenu.markup.includes('data-menu-button'));
  assert.ok(withMenu.markup.includes('id="game-tutorial"'));

  const without = renderBoardShell(20, 30, 20, { menu: false });
  assert.ok(!without.markup.includes('data-menu-button'), 'no way into the menu during a lesson');
  assert.ok(without.markup.includes('id="game-tutorial"'));
});
```

`num` is already imported in `test/game/render.test.js` from `../../lib/field/geometry.js`; the same rounding is what `fieldButtonMark` writes, which is why the assertion can compare strings at all.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/render.test.js`
Expected: FAIL — `fieldButtonAnchor` is not exported.

- [ ] **Step 3: Give the column one table and one geometry**

In `lib/game/render.js`, add the table and the anchor **above `menuButtonMark`** — which now reads them too — then rewrite `renderFieldButtons` to use both:

```js
/**
 * The column, as a table. `slot` is the plate's distance from the middle in
 * FIELD_BTN_PITCH steps — the menu holds slot 0, which is why it is not here.
 *
 * Written down once so that the plate a paint draws and the ring the tutorial
 * pins to it are worked out from the same number. Two copies of this geometry
 * would drift the first time the column was retuned, and the highlight would
 * quietly start pointing at nothing.
 */
const FIELD_BUTTONS = {
  // The menu holds the middle, and is the one entry renderFieldButtons does not
  // draw: menuButtonMark owns that plate. It is in the table so that both of
  // them — and anything pinning a ring to one — read this column's geometry
  // from a single place.
  menu: { attr: 'data-menu-button', icon: '\u{1F4CB}', slot: 0 },
  reposition: { attr: 'data-reposition-button', icon: '\u{1F500}', slot: -1 },
  autoplan: { attr: 'data-autoplan-button', icon: '\u{1F381}', slot: 1 },
  run: { attr: 'data-run-button', icon: '\u{23E9}', slot: 2 },
};

/** Where a named plate sits, and how big it is. Null for a name there is no
 *  button for — a caller asking about a stranger gets nothing to draw. */
export function fieldButtonAnchor(name, losYard, cameraYard = losYard) {
  const b = FIELD_BUTTONS[name];
  if (!b) return null;
  return {
    x: FIELD_BTN_X,
    y: buttonColumnMidY(losYard, cameraYard) + b.slot * FIELD_BTN_PITCH,
    r: FIELD_BTN_SIZE / 2,
  };
}

export function renderFieldButtons(
  state, { repositioning = false, animating = false, cameraYard, allow = null } = {},
) {
  const los = state.losYard;
  const cam = cameraYard ?? los;
  // `allow` is what a tutorial lesson uses to field only the controls it is
  // teaching. A normal drive passes nothing and gets the column it always had.
  // The menu is deliberately not one of the three below: it is drawn by
  // menuButtonMark, so naming 'menu' in `allow` says a lesson fields a
  // clipboard without asking this function to draw a second one.
  const fielded = (name) => allow === null || allow.includes(name);
  const parts = [];
  if (fielded('reposition') && canReposition(state) && !animating) {
    parts.push(fieldButtonMark({
      attr: FIELD_BUTTONS.reposition.attr,
      icon: FIELD_BUTTONS.reposition.icon,
      label: repositioning ? 'Reposition players: on' : 'Reposition players: off',
      cy: fieldButtonAnchor('reposition', los, cam).y,
      on: repositioning,
      pressed: repositioning,
    }));
  }
  if (fielded('autoplan') && state.aiTeam !== 'offense') {
    parts.push(fieldButtonMark({
      attr: FIELD_BUTTONS.autoplan.attr,
      icon: FIELD_BUTTONS.autoplan.icon,
      label: 'Autoplan offense',
      cy: fieldButtonAnchor('autoplan', los, cam).y,
      off: animating || state.phase !== 'planning',
    }));
  }
  if (fielded('run')) {
    parts.push(fieldButtonMark({
      attr: FIELD_BUTTONS.run.attr,
      icon: FIELD_BUTTONS.run.icon,
      label: 'Run the turn',
      cy: fieldButtonAnchor('run', los, cam).y,
      off: animating || state.phase !== 'planning',
    }));
  }
  return parts.join('');
}
```

Then replace the body of the existing `menuButtonMark`, so the plate it draws
and the anchor a lesson rings are worked out from one number rather than two:

```js
export function menuButtonMark(losYard, cameraYard = losYard) {
  return fieldButtonMark({
    attr: FIELD_BUTTONS.menu.attr,
    icon: FIELD_BUTTONS.menu.icon,
    label: 'Open the Coaches Menu',
    cy: fieldButtonAnchor('menu', losYard, cameraYard).y,
  });
}
```

`buttonColumnMidY` is still what `fieldButtonAnchor` calls for slot 0, so this
draws the plate in exactly the place it has always been drawn — the existing
`menuButtonMark` tests must stay green untouched.

- [ ] **Step 4: Add the lesson layer and the optional menu**

In `lib/game/render.js`, change `renderBoardShell`:

```js
export function renderBoardShell(losYard, toGoYard, cameraYard = losYard, { menu = true } = {}) {
  const view = gameView(losYard, cameraYard);
  const { svg, height } = renderField(view);
  return {
    viewBox: `0 ${num(view.windowTopY)} ${VIEWBOX_WIDTH} ${num(height)}`,
    markup:
      `<style>${STYLE}${STYLE_GAME}</style>${DEFS}${DEFS_GAME}` +
      `<g id="game-field">${svg}${lineToGainMark(view, toGoYard)}</g>` +
      `<g id="game-arrows"></g><g id="game-preview"></g>` +
      `<g id="game-players"></g><g id="game-overlay"></g>` +
      `<g id="game-menu">${menu ? menuButtonMark(losYard, cameraYard) : ''}</g>` +
      `<g id="game-buttons"></g>` +
      `<g id="game-message"></g>` +
      // Last, so it is above everything: a lesson's card and its ring have to
      // be readable over the men they are talking about.
      `<g id="game-tutorial"></g>`,
  };
}
```

- [ ] **Step 5: Run the render tests, then the whole suite**

Run: `node --test test/game/render.test.js`
Expected: PASS, including every pre-existing button test — `renderFieldButtons` with no `allow` must be byte-identical to what it produced before.

Run: `npm test`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add lib/game/render.js test/game/render.test.js && git commit -m "feat: the button column knows where its own plates are"
```

---

### Task 8: The coach card and the highlight

**Files:**
- Create: `lib/game/tutorial/render.js`
- Modify: `lib/game/render.js` (`STYLE_GAME` only)
- Test: `test/game/tutorial/render.test.js` (create)

**Interfaces:**
- Consumes: the card shape from `cardFor` (Task 5).
- Produces:
  - `coachCardMark(card, losYard, cameraYard)` → markup, with the control carrying `data-tutorial-next`
  - `highlightMark(anchor)` → markup for `{x, y, r}`, or `''` for `null`

- [ ] **Step 1: Add the styles**

In `lib/game/render.js`, inside the `STYLE_GAME` array, just before the closing `].join('')`:

```js
  // The tutorial's coach card, pinned to the bottom of the window. Dark, so it
  // reads as somebody talking to you rather than as another field marking, and
  // so the referee's white plate at the top of the window stays the referee's.
  '.tut-plate{fill:#0b3d20;fill-opacity:.95;stroke:#1a7f37;stroke-width:.6;pointer-events:none}',
  '.tut-title{font:bold 3.4px system-ui,sans-serif;fill:#8fd6a8;text-anchor:middle;pointer-events:none}',
  '.tut-text{font:4px system-ui,sans-serif;fill:#fff;text-anchor:middle;pointer-events:none}',
  '.tut-foot{font:3px system-ui,sans-serif;fill:#8fd6a8;text-anchor:middle;pointer-events:none}',
  '.tut-next{fill:#fff;fill-opacity:.14;stroke:#8fd6a8;stroke-width:.5;pointer-events:all;cursor:pointer}',
  '.tut-next-label{font:3.2px system-ui,sans-serif;fill:#fff;text-anchor:middle;dominant-baseline:central;pointer-events:none}',
  // The ring around whatever must be pressed next. Gold, because green is
  // already the colour of an order and white is the referee's.
  '.tut-ring{fill:none;stroke:#ffd23f;stroke-width:1;pointer-events:none;animation:tut-pulse 1.3s ease-in-out infinite}',
  '@keyframes tut-pulse{0%,100%{opacity:1;stroke-width:1}50%{opacity:.45;stroke-width:1.8}}',
```

- [ ] **Step 2: Write the failing tests**

Create `test/game/tutorial/render.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { coachCardMark, highlightMark } from '../../../lib/game/tutorial/render.js';
import { STYLE_GAME } from '../../../lib/game/render.js';
import { gameView } from '../../../lib/game/view.js';

const CARD = {
  title: 'The snap, and running with it',
  progress: 'Step 1 of 6',
  text: 'Every play starts with the snap. Press the fast-forward button.',
  highlight: null,
  control: 'Skip lesson',
  footer: null,
};

test('the card says all of it: the lesson, the count, the words and the way out', () => {
  const m = coachCardMark(CARD, 50, 50);
  assert.ok(m.includes('The snap, and running with it'));
  assert.ok(m.includes('Step 1 of 6'));
  assert.ok(m.includes('Skip lesson'));
  assert.ok(m.includes('data-tutorial-next'), 'the control is pressable');
});

test('the words wrap rather than run off the sideline', () => {
  const long = { ...CARD, text: 'x'.repeat(20) + ' ' + 'y'.repeat(20) + ' ' + 'z'.repeat(20) };
  const m = coachCardMark(long, 50, 50);
  assert.ok((m.match(/<tspan/g) ?? []).length >= 3, 'three long words, at least three lines');
});

test('the card sits at the bottom of the window that is actually on screen', () => {
  const view = gameView(50, 50);
  const m = coachCardMark(CARD, 50, 50);
  const plateY = Number(/class="tut-plate"[^>]*\by="([-\d.]+)"/.exec(m)[1]);
  assert.ok(plateY > view.windowTopY + view.height / 2, 'below the middle');
  assert.ok(plateY < view.windowTopY + view.height, 'and inside the crop');
});

test('a footer is drawn only when there is one to draw', () => {
  assert.ok(!coachCardMark(CARD, 50, 50).includes('tut-foot'));
  assert.ok(coachCardMark({ ...CARD, footer: 'Stuck? Skip lesson moves you on.' }, 50, 50)
    .includes('Stuck? Skip lesson moves you on.'));
});

test('the card escapes what it is given, like every other plate on this board', () => {
  const m = coachCardMark({ ...CARD, text: 'press <b>run</b> & go' }, 50, 50);
  assert.ok(!m.includes('<b>'));
  assert.ok(m.includes('&amp;'));
});

test('the ring is drawn round the anchor, and nothing is drawn for nothing', () => {
  const m = highlightMark({ x: 100, y: 200, r: 5 });
  assert.ok(m.includes('class="tut-ring"'));
  assert.ok(m.includes('cx="100"'));
  assert.ok(m.includes('cy="200"'));
  assert.equal(highlightMark(null), '');
});

test('the ring pulses, so it reads as a thing to press', () => {
  assert.ok(STYLE_GAME.includes('@keyframes tut-pulse'));
  assert.ok(STYLE_GAME.includes('.tut-ring{'));
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/game/tutorial/render.test.js`
Expected: FAIL — `lib/game/tutorial/render.js` does not exist.

- [ ] **Step 4: Write the card**

Create `lib/game/tutorial/render.js`:

```js
/**
 * The tutorial's own two marks: the coach card, and the ring round whatever
 * must be pressed next.
 *
 * Built as markup strings like everything else drawn on this board, so a test
 * can hold every word of a lesson without a DOM. app/main.js writes the result
 * into the `game-tutorial` layer, which sits above everything else in the
 * shell — a card that a player could stand in front of would be no use.
 *
 * The card is pinned to the BOTTOM of the window on purpose: the referee's
 * plate (render.js's renderMessage) holds the top, and "Tackled!" and "what to
 * do next" are two different voices that should not fight for one spot.
 */
import { escapeText } from '../../field/escape.js';
import { gameView } from '../view.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT, CENTRE_X, num } from '../../field/geometry.js';
import { wrapWords } from '../render.js';

/** Wider than the referee's plate: a lesson is a paragraph, not a shout. */
const CARD_MAX_CHARS = 44;
const CARD_LINE_HEIGHT = 5;
const CARD_CHAR_WIDTH = 2.35;
const CARD_PAD_X = 6;
const CARD_PAD_Y = 3.5;
const CARD_TITLE_HEIGHT = 4.5;
const CARD_FOOT_HEIGHT = 4;
const CARD_BTN_W = 26;
const CARD_BTN_H = 6;
const CARD_MARGIN_BOTTOM = 3;

/**
 * The card. Sized to its own words rather than to a fixed box, and clamped to
 * the sidelines the way the referee's plate is — an essay overflows rather
 * than being silently truncated, which is the renderer's problem to notice
 * and not the coach's to guess at.
 */
export function coachCardMark(card, losYard, cameraYard = losYard) {
  const view = gameView(losYard, cameraYard);
  const lines = wrapWords(card.text, CARD_MAX_CHARS);
  const bodyHeight = lines.length * CARD_LINE_HEIGHT;
  const footHeight = card.footer ? CARD_FOOT_HEIGHT : 0;
  const plateH = CARD_PAD_Y * 2 + CARD_TITLE_HEIGHT + bodyHeight + footHeight + CARD_BTN_H + 2;
  const widest = Math.max(CARD_MAX_CHARS * 0.7, ...lines.map((l) => l.length));
  const plateW = Math.min(
    widest * CARD_CHAR_WIDTH + CARD_PAD_X * 2,
    SIDELINE_RIGHT - SIDELINE_LEFT,
  );
  const plateX = CENTRE_X - plateW / 2;
  const plateY = view.windowTopY + view.height - CARD_MARGIN_BOTTOM - plateH;

  let y = plateY + CARD_PAD_Y + CARD_TITLE_HEIGHT * 0.75;
  const title =
    `<text class="tut-title" x="${num(CENTRE_X)}" y="${num(y)}">`
    + `${escapeText(card.title)} · ${escapeText(card.progress)}</text>`;

  y += CARD_TITLE_HEIGHT * 0.5;
  const body =
    `<text class="tut-text">${lines.map((l, i) =>
      `<tspan x="${num(CENTRE_X)}" y="${num(y + (i + 1) * CARD_LINE_HEIGHT)}">${escapeText(l)}</tspan>`
    ).join('')}</text>`;

  y += bodyHeight + CARD_LINE_HEIGHT;
  const foot = card.footer
    ? `<text class="tut-foot" x="${num(CENTRE_X)}" y="${num(y)}">${escapeText(card.footer)}</text>`
    : '';
  if (card.footer) y += CARD_FOOT_HEIGHT;

  // The one control a lesson has. `data-tutorial-next` rather than a skip name
  // because it is the same press either way: on a step it skips the lesson, on
  // the sign-off it moves to the next one, and app/main.js should not have to
  // know which card it is looking at.
  const btnX = CENTRE_X - CARD_BTN_W / 2;
  const control =
    `<g><rect data-tutorial-next="1" class="tut-next" tabindex="0" role="button"`
    + ` aria-label="${escapeText(card.control)}"`
    + ` x="${num(btnX)}" y="${num(y)}" width="${num(CARD_BTN_W)}" height="${num(CARD_BTN_H)}" rx="1"/>`
    + `<text class="tut-next-label" x="${num(CENTRE_X)}" y="${num(y + CARD_BTN_H / 2)}">`
    + `${escapeText(card.control)}</text></g>`;

  return (
    `<rect class="tut-plate" x="${num(plateX)}" y="${num(plateY)}"`
    + ` width="${num(plateW)}" height="${num(plateH)}" rx="2"/>`
    + title + body + foot + control
  );
}

/** The ring round whatever is to be pressed next, or nothing at all. */
export function highlightMark(anchor) {
  if (!anchor) return '';
  return `<circle class="tut-ring" cx="${num(anchor.x)}" cy="${num(anchor.y)}"`
    + ` r="${num(anchor.r + 2)}"/>`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/game/tutorial/render.test.js`
Expected: PASS. If the "sits at the bottom" test fails, the plate is taller than you sized it — check that `plateH` accounts for the footer and the button.

Run: `npm test`
Expected: no new failures; `STYLE_GAME` gained rules but changed none.

- [ ] **Step 6: Commit**

```bash
git add lib/game/tutorial/render.js lib/game/render.js test/game/tutorial/render.test.js && git commit -m "feat: the coach card, and the ring round what to press next"
```

---

### Task 9: The bridge, and remembering it was done

**Files:**
- Create: `app/tutorial.js`, `app/tutorial-store.js`
- Test: `test/app/tutorial.test.js` (create — `test/app/` is a new directory: no `app/` module is under test today, and this one is testable precisely because it takes nothing from the DOM)

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces `createLesson()` from `app/tutorial.js`, returning an object with:
  - `deal()` → `{ state, random }` — a fresh game for the current scenario; also resets the step index and captures start spots
  - `allows(action)` → `null` or a nudge string
  - `saw(state, { repositioning, menuOpen })` → `{ replay: boolean, finished: boolean }` — advances the step, and reports whether the scenario must be re-dealt or the tutorial is over
  - `showsMenu()` → boolean; whether the 📋 plate belongs on the board right now
  - `card()` → the card object, from `cardFor`
  - `highlight()` → `{kind, ...}` or `null`, the current step's
  - `buttons()` → the current scenario's `buttons` array
  - `next()` → `{ finished: boolean }` — the card's control; moves to the next scenario or ends
  - `attempt()` → the attempt number, for the card

`app/tutorial-store.js` produces `loadTutorialDone()` → boolean and `saveTutorialDone()`.

**Why the bridge is testable at all:** it touches `localStorage` only through the store module, and takes nothing from the DOM. `test/app/tutorial.test.js` imports `app/tutorial.js` directly under Node.

- [ ] **Step 1: Write the failing tests**

Create `test/app/tutorial.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLesson } from '../../app/tutorial.js';
import { SCENARIOS } from '../../lib/game/tutorial/script.js';
import { runTurn } from '../../lib/game/turn.js';

test('a lesson deals its first scenario at the fifty, computer on the other side', () => {
  const lesson = createLesson();
  const { state } = lesson.deal();
  assert.equal(state.losYard, 50);
  assert.equal(state.aiTeam, SCENARIOS[0].scripted);
  assert.equal(state.aiLevel, 'scripted');
  assert.equal(lesson.attempt(), 1);
  assert.deepEqual(lesson.buttons(), SCENARIOS[0].buttons);
});

test('the same seed deals the same down twice', () => {
  const a = createLesson().deal().state;
  const b = createLesson().deal().state;
  assert.equal(a.seed, b.seed);
  assert.deepEqual(a.players.map((p) => p.pos), b.players.map((p) => p.pos));
});

test('the gate refuses what the first step did not ask for', () => {
  const lesson = createLesson();
  lesson.deal();
  assert.equal(lesson.allows({ kind: 'run' }), null);
  assert.ok(lesson.allows({ kind: 'reposition' }), 'a nudge, not silence');
});

test('a step that lands moves the card on', () => {
  const lesson = createLesson();
  const { state, random } = lesson.deal();
  const before = lesson.card().progress;
  runTurn(state, random);
  lesson.saw(state, { repositioning: false });
  assert.notEqual(lesson.card().progress, before);
});

test('a play that dies early is replayed, with the attempt counted', () => {
  const lesson = createLesson();
  const { state } = lesson.deal();
  state.phase = 'playOver';
  state.deadReason = 'tackled';
  const result = lesson.saw(state, { repositioning: false });
  assert.equal(result.replay, true);
  const again = lesson.deal();
  assert.equal(lesson.attempt(), 2);
  assert.equal(again.state.phase, 'planning', 'a fresh down, from the top');
  assert.match(lesson.card(again.state).footer, /skip/i, 'and the door is pointed at');
});

test('the clipboard stays off the board while there is still football to teach', () => {
  const lesson = createLesson();
  lesson.deal();
  assert.equal(lesson.showsMenu(), false);
});

test('walking off the end of the last lesson is what finishes the tutorial', () => {
  const lesson = createLesson();
  for (let i = 1; i < SCENARIOS.length; i += 1) lesson.next(); // on to the last lesson
  const { state } = lesson.deal();
  const steps = SCENARIOS.at(-1).steps;
  assert.equal(steps.at(-1).allow.action, 'menu', 'the last beat is the menu');

  // Satisfy the football steps by fiat — Task 6 already holds that they are
  // reachable; this test is about what happens at the end of them.
  let guard = 0;
  while (lesson.showsMenu() === false && guard < steps.length + 2) {
    lesson.saw(state, { repositioning: guard % 2 === 0, menuOpen: false });
    state.phase = 'playOver';
    guard += 1;
  }
  assert.equal(lesson.showsMenu(), true, 'the clipboard is offered at the end');
  assert.equal(lesson.saw(state, { menuOpen: false }).finished, false, 'not until it is pressed');
  assert.equal(lesson.saw(state, { menuOpen: true }).finished, true);
});

test('the control walks the lessons, and the last one finishes the tutorial', () => {
  const lesson = createLesson();
  lesson.deal();
  for (let i = 1; i < SCENARIOS.length; i += 1) {
    assert.equal(lesson.next().finished, false);
    lesson.deal();
    assert.equal(lesson.attempt(), 1, 'a new lesson starts on its first attempt');
  }
  assert.equal(lesson.next().finished, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/app/tutorial.test.js`
Expected: FAIL — `app/tutorial.js` does not exist.

- [ ] **Step 3: Write the store**

Create `app/tutorial-store.js`:

```js
/**
 * Whether this coach has been through the tutorial. Kept in the browser like
 * the playbook, the coaching log and the trained genomes are, and for the same
 * reason: it is a fact about the person, not about the drive.
 *
 * A browser may refuse storage outright (private mode, a blocked origin), and a
 * coach who cannot be remembered should still be able to play — so every access
 * fails soft, and a refusal reads as "not done yet".
 */
const KEY = 'football-by-turn:tutorial-done';

export function loadTutorialDone() {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function saveTutorialDone() {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // Nothing to do and nothing worth saying: the tutorial still ran.
  }
}
```

- [ ] **Step 4: Write the bridge**

Create `app/tutorial.js`:

```js
/**
 * The bridge between the tutorial's pure parts and the game app/main.js runs.
 *
 * It owns exactly three things: which lesson is on, which step of it, and how
 * many attempts this lesson has taken. Everything else is asked of
 * lib/game/tutorial/, and the game state itself belongs to main.js — deal()
 * hands one over rather than keeping it, so there is only ever one `state` in
 * the app and no chance of the board painting a different down from the one the
 * lesson is judging.
 */
import { SCENARIOS, TUTORIAL_LOS_YARD } from '../lib/game/tutorial/script.js';
import {
  allows as machineAllows, advance, offScript, cardFor, stepAt,
  showsMenu as machineShowsMenu,
} from '../lib/game/tutorial/machine.js';
import { createGame } from '../lib/game/state.js';
import { mulberry32 } from '../lib/game/rng.js';
import { saveTutorialDone } from './tutorial-store.js';

export function createLesson() {
  let scenarioIndex = 0;
  let stepIndex = 0;
  let attempts = 1;
  // Where everybody stood before the coach touched anything. Scenario 4's
  // "move him" step is the only thing that reads it, and it has to be captured
  // at the deal — by the time the drag lands, the old spot is gone.
  let startSpots = {};

  const scenario = () => SCENARIOS[scenarioIndex];
  const isLast = () => scenarioIndex === SCENARIOS.length - 1;
  const ctx = (repositioning, menuOpen) => ({ repositioning, menuOpen, startSpots });

  return {
    scenario,
    attempt: () => attempts,
    buttons: () => scenario().buttons,
    highlight: () => stepAt(scenario(), stepIndex)?.highlight ?? null,
    showsMenu: () => machineShowsMenu(scenario(), stepIndex),

    /** A fresh down for the lesson as it stands. The seed is the scenario's, so
     *  a replay deals the identical down and only the coaching differs. */
    deal() {
      const s = scenario();
      stepIndex = 0;
      const state = createGame({
        seed: s.seed,
        variant: s.variantId,
        losYard: TUTORIAL_LOS_YARD,
        ai: s.scripted,
        aiLevel: 'scripted',
        scriptedOrders: s.orders,
      });
      startSpots = {};
      for (const p of state.players) startSpots[p.id] = { x: p.pos.x, y: p.pos.y };
      return { state, random: mulberry32(s.seed) };
    },

    allows(action) {
      return machineAllows(scenario(), stepIndex, action);
    },

    /**
     * What just happened. Advances past every beat that has landed, then asks
     * whether the down is still the one the script was written for — in that
     * order, so the closing beat is reached before the whistle it is meant to
     * outlive can be called a failure.
     */
    saw(state, { repositioning = false, menuOpen = false } = {}) {
      stepIndex = advance(scenario(), stepIndex, state, ctx(repositioning, menuOpen));
      if (offScript(scenario(), stepIndex, state)) {
        attempts += 1;
        return { replay: true, finished: false };
      }
      // Walking past the last step of the last lesson IS the end of the
      // tutorial. There is no sign-off card to press, because the press that
      // got here was opening the menu — and the menu is the way out. Ending
      // now rather than on the way home is what makes that menu the real one:
      // a lesson still running would offer New Game against a two-man drill.
      if (isLast() && stepIndex >= scenario().steps.length) {
        saveTutorialDone();
        return { replay: false, finished: true };
      }
      return { replay: false, finished: false };
    },

    card() {
      return cardFor(scenario(), stepIndex, { attempt: attempts, isLastScenario: isLast() });
    },

    /** The card's one control: on to the next lesson, or out of the tutorial. */
    next() {
      if (isLast()) {
        saveTutorialDone();
        return { finished: true };
      }
      scenarioIndex += 1;
      stepIndex = 0;
      attempts = 1;
      return { finished: false };
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/app/tutorial.test.js`
Expected: PASS. `app/tutorial-store.js` is imported by the bridge but only called from `next()`; under Node there is no `window`, which is exactly why the store's `try` exists — the "control walks the lessons" test exercises that path.

Run: `npm test`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add app/tutorial.js app/tutorial-store.js test/app/tutorial.test.js && git commit -m "feat: the bridge that deals a lesson and judges it"
```

---

### Task 10: The home screen's third button

**Files:**
- Modify: `lib/game/home.js`, `app/home.js`, `index.html`
- Test: `test/game/home.test.js`

**Interfaces:**
- Consumes: `loadTutorialDone` (Task 9).
- Produces: `homeMarkup(variants, { tutorialDone })` renders a `data-tutorial` button below the variant list; `app/home.js` routes it into `main.js`'s `startTutorial`.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/home.test.js`:

```js
test('the how-to-play button sits below the games, and is pressable', () => {
  const m = homeMarkup();
  assert.ok(m.includes('data-tutorial'));
  assert.ok(m.includes('How to play'));
  assert.ok(m.indexOf('data-variant="11"') < m.indexOf('data-tutorial'),
    'under the game chooser, as the last thing on the screen');
});

test('a coach who has been through it is told so, rather than nagged', () => {
  const fresh = homeMarkup(undefined, { tutorialDone: false });
  const done = homeMarkup(undefined, { tutorialDone: true });
  assert.notEqual(fresh, done);
  assert.match(done, /again/i, 'it is an invitation, not a badge');
});

test('the tutorial is not a variant: it cannot be listed or started as one', () => {
  assert.ok(!homeMarkup().includes('data-variant="tutorial"'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/home.test.js`
Expected: FAIL — no `data-tutorial` in the markup.

- [ ] **Step 3: Add the button**

In `lib/game/home.js`, replace `homeMarkup`:

```js
/**
 * The tutorial's own button. Not a variant: it deals its own drills rather
 * than one of the games in VARIANTS, so it is written in beneath the list
 * instead of being an entry in it. Quieter than the two green choices, because
 * it is the thing you do once, not the thing you came for.
 */
function tutorialMarkup(tutorialDone) {
  const note = tutorialDone
    ? 'You have been through these. Run them again any time.'
    : 'Four short lessons: the snap, running, blocking, throwing and covering.';
  return '<button class="home-choice home-choice-quiet" type="button" data-tutorial>'
    + '<span class="home-choice-label">How to play</span>'
    + `<span class="home-choice-note">${escapeText(note)}</span>`
    + '</button>';
}

export function homeMarkup(variants = VARIANTS, { tutorialDone = false } = {}) {
  return '<h1>Football By Turn</h1>'
    + '<p class="home-blurb">Draw where your players run, half a second at a time.'
    + ' Pick a game.</p>'
    + `<div class="home-choices">${variants.map(choiceMarkup).join('')}`
    + `${tutorialMarkup(tutorialDone)}</div>`;
}
```

`test/game/home.test.js` already counts buttons with `/class="home-choice"/g`
and asserts one per variant. That regex needs the closing quote immediately
after, so `class="home-choice home-choice-quiet"` deliberately does not match it
and the existing test stays green. **Do not reorder those two class names** —
writing `class="home-choice-quiet home-choice"` would not help either, but
writing the tutorial button as a bare `class="home-choice"` would break that
count and would be the wrong fix.

- [ ] **Step 4: Style the quiet button**

In `index.html`, after the `.home-choice:disabled` rule:

```css
    /* The tutorial is an offer, not the thing you came for: outlined rather
       than filled, so it reads as secondary without reading as unavailable
       the way the disabled rule above does. */
    .home-choice-quiet {
      background: #fff; color: #1a7f37; border-color: #1a7f37;
    }
```

- [ ] **Step 5: Route the press**

In `app/home.js`, import the store and handle the button:

```js
import { homeMarkup, sideMarkup } from '../lib/game/home.js';
import { isPlayable, getVariant } from '../lib/game/variants.js';
import { loadTutorialDone } from './tutorial-store.js';
```

```js
function showChoices() {
  pickedVariant = null;
  home.innerHTML = homeMarkup(undefined, { tutorialDone: loadTutorialDone() });
}
```

```js
async function startTutorial() {
  show(home, false);
  show(board, true);
  game ??= await import('./main.js');
  game.startTutorial({ onExit: showHome });
}
```

and, first in the click handler — before the back button, so a press on it can
never be mistaken for anything else:

```js
home.addEventListener('click', (e) => {
  if (e.target.closest?.('[data-tutorial]')) {
    startTutorial();
    return;
  }
  if (e.target.closest?.('[data-home-back]')) {
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/game/home.test.js`
Expected: PASS.

Run: `npm test`
Expected: no new failures. `app/home.js` is not under test — it will be exercised in Task 11.

- [ ] **Step 7: Commit**

```bash
git add lib/game/home.js app/home.js index.html test/game/home.test.js && git commit -m "feat: How to play, under the game chooser"
```

---

### Task 11: The gate in main.js

The last task, and the only one with no unit test of its own — `app/main.js`
holds DOM references at module scope and cannot be imported under Node. Every
rule it applies has already been tested in Tasks 5, 8 and 9; what is left here
is wiring, verified in the browser.

**Files:**
- Modify: `app/main.js`
- Verify: the browser, via `npm run serve`

**Interfaces:**
- Consumes: `createLesson()` (Task 9), `fieldButtonAnchor` / `renderFieldButtons({allow})` / `renderBoardShell(..., {menu})` (Task 7), `coachCardMark` / `highlightMark` (Task 8).
- Produces: `export function startTutorial({ onExit })`, called by `app/home.js`.

- [ ] **Step 1: Import what the lesson needs and hold it**

At the top of `app/main.js`, add to the existing `render.js` import: `fieldButtonAnchor`. Then add two new imports:

```js
import { createLesson } from './tutorial.js';
import { coachCardMark, highlightMark } from '../lib/game/tutorial/render.js';
```

Beside `let repositioning = false;`, add:

```js
// The lesson being taught, or null in an ordinary drive. Everything the
// tutorial changes about the game is asked of this one object, so a normal
// game is exactly the game it always was: `lesson` is null and every check
// below falls straight through.
let lesson = null;
```

- [ ] **Step 2: Paint the card**

In `aimCamera`, replace the menu line and add the tutorial layer. The menu
plate is repainted every frame, so writing nothing into it is what removes it
during a lesson:

```js
function aimCamera(cam) {
  board.attr('viewBox', cameraViewBox(state.losYard, cam));
  // The clipboard is hidden for the whole tutorial except its last beat, which
  // teaches it — and leaving through it is how the tutorial ends.
  layer('game-menu').clear().svg(
    !lesson || lesson.showsMenu() ? menuButtonMark(state.losYard, cam) : '',
  );
  layer('game-buttons').clear().svg(
    renderFieldButtons(state, {
      repositioning, animating, cameraYard: cam, allow: lesson ? lesson.buttons() : null,
    }),
  );
  layer('game-message').clear().svg(renderMessage(messageText, state.losYard, cam));
  layer('game-tutorial').clear().svg(lessonMark(cam));
}

/**
 * The lesson's card and the ring round whatever it wants pressed. Repainted
 * with the camera rather than once at the snap, for the same reason the button
 * column is: a play that scrolls downfield would otherwise slide the card off
 * the bottom of the window and snap it back at the whistle.
 */
function lessonMark(cam) {
  if (!lesson) return '';
  const card = lesson.card();
  return coachCardMark(card, state.losYard, cam) + highlightMark(anchorFor(card.highlight, cam));
}

/** Where the ring goes: a plate in the button column, or a man on the field. */
function anchorFor(highlight, cam) {
  if (!highlight) return null;
  if (highlight.kind === 'button') return fieldButtonAnchor(highlight.name, state.losYard, cam);
  const p = state.players.find((pl) => pl.id === highlight.id);
  return p ? { x: p.pos.x, y: p.pos.y, r: p.radius } : null;
}
```

- [ ] **Step 3: Build the board without a menu during a lesson**

In `rebuildBoard`:

```js
function rebuildBoard() {
  const cam = cameraYard();
  // aimCamera repaints this plate on every frame, so the shell only has to
  // agree with it — but it has to agree, or the clipboard flashes on for one
  // paint at the start of every lesson.
  const { viewBox, markup } = renderBoardShell(state.losYard, state.toGoYard, cam, {
    menu: !lesson || lesson.showsMenu(),
  });
  board.attr('viewBox', viewBox);
  board.clear();
  board.svg(markup);
}
```

- [ ] **Step 4: Gate the four ways in**

Add the gate helper next to `say`:

```js
/**
 * Whether the lesson permits this, and the nudge if it does not. A refusal is
 * said and the action dropped BEFORE anything is applied — a half-committed
 * order taken back afterwards would be a worse lie than the refusal.
 */
function refused(action) {
  if (!lesson) return false;
  const nudge = lesson.allows(action);
  if (nudge === null) return false;
  say(nudge);
  paint();
  return true;
}

/**
 * Tell the lesson what just happened: re-deal the down if it went off script,
 * and end the tutorial if that was the last beat of the last lesson.
 *
 * `menu.open` is read off the dialog rather than tracked in a flag of our own —
 * the menu being open IS what the closing step waits for, and <dialog> already
 * knows.
 */
function lessonSaw() {
  if (!lesson) return;
  const seen = lesson.saw(state, { repositioning, menuOpen: menu.open });
  if (seen.replay) {
    say('Not quite — let us run that one again.');
    dealLesson();
    return;
  }
  if (seen.finished) {
    finishLesson();
    return;
  }
  paint();
}

/**
 * The tutorial is over. The lesson is dropped BEFORE the menu is left open in
 * front of the coach, because every button in there is about to mean what it
 * says — and `variantId` still naming a two-man drill would make New Game deal
 * one as if it were football. The board he leaves behind is the drill's last
 * down, which is what he is looking at anyway; the next startGame rebuilds it.
 */
function finishLesson() {
  lesson = null;
  variantId = DEFAULT_VARIANT;
  sideId = 'training';
  say('');
  rebuildBoard();
  paint();
}

/**
 * A press on the clipboard. In a lesson this is the closing step: the menu goes
 * up, and lessonSaw sees it open and ends the tutorial — in that order, so what
 * the coach is looking at when the card disappears is the real menu.
 */
function pressMenu() {
  if (refused({ kind: 'menu' })) return;
  openMenu();
  lessonSaw();
}
```

Then, at the top of each entry point:

In `onGesture`, immediately after the `state.phase !== 'planning'` guard:

```js
  if (refused({ kind: 'gesture', playerId, gestureKind: gesture.kind })) return;
```

In `pressRun`, immediately after the `animating || state.phase !== 'planning'` guard:

```js
  if (refused({ kind: 'run' })) return;
```

In `toggleReposition`, immediately after the `animating || !canReposition(state)` guard:

```js
  if (refused({ kind: 'reposition' })) return;
```

In `pressBoardButton`, make the menu unreachable and route the card's control:

```js
function pressBoardButton(target) {
  if (!target.closest) return false;
  if (target.closest('[data-tutorial-next]')) nextLesson();
  // Openable in an ordinary drive, and on the one lesson step that asks for it
  // — where opening it is what ends the tutorial. Everywhere else in a lesson
  // there is no plate to press anyway; this is the second lock on that door.
  else if (target.closest('[data-menu-button]')) pressMenu();
  else if (target.closest('[data-reposition-button]')) toggleReposition();
  else if (target.closest('[data-run-button]')) pressRun();
  else if (target.closest('[data-autoplan-button]')) pressAutoplanOffense();
  else return false;
  return true;
}
```

- [ ] **Step 5: Tell the lesson about a committed gesture and a finished turn**

`onGesture` has **two** exits that commit something, and both must report.
The reposition branch returns early — and it is the very branch lesson four's
"move him" step goes through, so missing it would strand that step forever.

Its `if (repositioning) { ... paint(); return; }` block becomes:

```js
  if (repositioning) {
    if (gesture.kind === 'drag' || gesture.kind === 'passdrag') reposition(playerId, point);
    paint();
    lessonSaw();
    return;
  }
```

and the final `paint();` at the end of the function becomes:

```js
  paint();
  lessonSaw();
```

In `pressRun`'s `finish` callback, after the block that schedules the auto-advance, add:

```js
    // The lesson judges the down AFTER everything the whistle had to say, so
    // its card is the last word on the board rather than something the
    // referee's plate overwrites a moment later.
    lessonSaw();
```

In `toggleReposition`, after its `paint();`:

```js
  lessonSaw();
```

- [ ] **Step 6: Keep the lesson out of the coaching log and off the alignment**

A tutorial down is not football this coach played, and its authored defense
must stand where the script put it. Two early returns:

In `recordPlanning`, as its first line:

```js
  // A lesson is not a down this coach called: it is a script, and teaching the
  // ghost to play it would poison the log with somebody else's football.
  if (lesson) return;
```

In `realignDefense`, as its first line:

```js
  // A lesson's men stand where the script stood them. Answering the coach's
  // new look would break the vertical line the fourth lesson is built on.
  if (lesson) return;
```

In `scheduleAutoAdvance`'s caller inside `finish` — the block that calls
`scheduleAutoAdvance(...)` on every dead ball — wrap the condition so a lesson
never advances the down or restarts the game underneath itself:

```js
    if (!lesson && state.phase === 'playOver') {
```

- [ ] **Step 7: Deal the lessons, and leave when they are done**

Beside `startGame`, add:

`DEFAULT_VARIANT` is already imported from `rosters.js` at the top of this file.

```js
/** Deal the lesson's current scenario onto the board. */
function dealLesson() {
  cancelAutoAdvance();
  stopRepositioning();
  const dealt = lesson.deal();
  state = dealt.state;
  random = dealt.random;
  pendingWarning = false;
  messageText = '';
  rebuildBoard();
  paint();
}

/** The coach card's one control: on to the next lesson, or out of the tutorial. */
function nextLesson() {
  if (!lesson || animating) return;
  if (lesson.next().finished) {
    // The escape hatch, not the taught path: a coach who skips his way out of
    // the last lesson never sees the clipboard, so he is sent home directly.
    finishLesson();
    goHome();
    return;
  }
  dealLesson();
}

/**
 * Start the tutorial. app/home.js calls this when a coach presses How to play,
 * and it is the twin of startGame: same module, same listeners, a different
 * kind of down. The input plumbing is attached once here too, because a coach
 * may reach the tutorial before he has ever started a game.
 */
export function startTutorial({ onExit = () => {} } = {}) {
  exitToHome = onExit;
  if (!inputAttached) {
    attachInput(board, { hitTest, onGesture, onDragPreview });
    inputAttached = true;
  }
  lesson = createLesson();
  dealLesson();
}
```

And in `goHome`, drop the lesson so a later `startGame` is an ordinary drive:

```js
function goHome() {
  cancelAutoAdvance();
  stopRepositioning();
  lesson = null;
  exitToHome();
}
```

Finally, in `startGame`, add `lesson = null;` as its first line, for the same
reason.

- [ ] **Step 8: Run the suite**

Run: `npm test`
Expected: no new failures. Nothing here is under test, but `app/main.js` is
imported by nothing else, so a syntax error would still show up as a browser
failure in the next step rather than here — read your diff before serving.

- [ ] **Step 9: Verify in the browser**

Run: `npm run serve`, open `http://localhost:8080`, and walk all four lessons.
Check each of these:

1. "How to play" is under the two game buttons, outlined rather than filled.
2. Pressing it goes straight into lesson one — no side chooser.
3. There is no 📋 plate on the board, and no way to open the Coaches Menu.
4. Lesson one shows only the ⏩ button, with a pulsing gold ring on it.
5. Dragging the centre on step one is refused with a nudge and draws no arrow.
6. Tapping the quarterback once is silently accepted; two taps tuck him.
7. Lesson four shows 🔀 and ⏩ — and **no** 📋 — with the ring on 🔀 first.
8. Dragging the quarterback in reposition mode does **not** slide the nose
   tackle and linebacker off their vertical line.
9. Getting tackled early re-deals the same down and the card's footer names the
   skip.
10. On the last beat of lesson four the 📋 plate appears with the ring on it,
    and the card says to press it and then Back to Home. Pressing ⏩ or dragging
    a man there is refused with the nudge.
11. Pressing 📋 opens the real, complete Coaches Menu, the coach card is gone,
    and `Back to Home` leaves. The home screen's note now says you have been
    through them.
12. Do it again and, instead of Back to Home, press `Close`: you are back on the
    board with no card, the 📋 still there, and nothing stuck.
13. Open the menu at the end and press `New Game`: you get a real seven-player
    drive, not a two-man drill.
14. "Skip lesson" mid-tutorial moves on; skipping out of lesson four returns to
    the home screen without ever showing the clipboard.
15. Start an ordinary 7-player game afterwards: the 📋 plate is back, all three
    board buttons are back, and no coach card is drawn.

- [ ] **Step 10: Commit**

```bash
git add app/main.js && git commit -m "feat: the gate that turns a drive into a lesson"
```

---

### Task 12: A lesson that cannot end re-deals

Added during execution, from a Task 6 review finding. See the ledger's
`Task 6: Ruling`.

**The gap.** Every scenario's closing beat carries `needsLivePlay: false` — it
must, because that step's whole job is to wait for the whistle, and treating
"still planning" as off script would fail the very step it is trying to let
finish. But `offScript` only fires on a penalty or on `playOver`/`gameOver`, so
a down that never ends is invisible to it. A fumble nobody recovers leaves
`phase` at `'planning'` forever: `done` never fires, `offScript` never fires,
and the lesson silently stalls with no message saying why.

This is reachable by a real coach, not only by the tuned demo — dragging or
double-tapping a turn earlier than the model answer shifts the RNG stream, the
same class of variation that made seed 3003 differ from 3005 during Task 6.
`Skip lesson` is always on the card, so nobody is trapped; but a beginner's
tutorial that stops responding without explanation is exactly the confusion
this feature exists to prevent.

**Files:**
- Modify: `lib/game/tutorial/machine.js` (`offScript`)
- Modify: `lib/game/tutorial/script.js` (one comment)
- Test: `test/game/tutorial/machine.test.js`

**Interfaces:**
- Consumes: `offScript(scenario, index, state)` (Task 5), unchanged signature.
- Produces: `MAX_LESSON_TURNS`, exported from `lib/game/tutorial/machine.js`.
  `offScript` returns true past that many turns whatever the phase.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/tutorial/machine.test.js`. Add `MAX_LESSON_TURNS` to the
existing import from `../../../lib/game/tutorial/machine.js`.

```js
test('a down that will not end is off script, even though nothing has gone wrong yet', () => {
  const live = { phase: 'planning', penalty: null, turnIndex: MAX_LESSON_TURNS };
  assert.equal(offScript(SCENARIO, 2, live), false, 'at the cap it is still a live play');
  assert.equal(
    offScript(SCENARIO, 2, { ...live, turnIndex: MAX_LESSON_TURNS + 1 }), true,
    'past it, the lesson re-deals rather than waiting for a whistle that is not coming');
});

test('the turn cap catches the closing beat too, which no other check can', () => {
  // The closing beat carries needsLivePlay:false, so the playOver check can
  // never fire on it. Before the cap, a fumble nobody recovered stalled here
  // forever: done waits for a whistle, offScript waits for the same whistle.
  assert.equal(stepAt(SCENARIO, 2).needsLivePlay, false, 'the step this test is about');
  assert.equal(
    offScript(SCENARIO, 2, { phase: 'planning', penalty: null, turnIndex: MAX_LESSON_TURNS + 1 }),
    true);
});

test('the cap leaves every authored beat room to land', () => {
  // The integration test's own runout backstop uses 30 turns; the cap must sit
  // above anything a lesson legitimately asks for, or a slow scenario would
  // re-deal itself forever.
  assert.ok(MAX_LESSON_TURNS >= 30, 'above the longest run a lesson can ask for');
});

test('the sign-off card is never off script, however long the down ran', () => {
  assert.equal(
    offScript(SCENARIO, 3, { phase: 'planning', penalty: null, turnIndex: 999 }), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/tutorial/machine.test.js`
Expected: FAIL — `MAX_LESSON_TURNS` is not exported, and `offScript` has no
turn cap.

- [ ] **Step 3: Add the cap**

In `lib/game/tutorial/machine.js`, above `offScript`:

```js
/**
 * How many turns a lesson may run before it is treated as never going to end.
 *
 * A play ends by tackle, fumble recovery, out-of-bounds, incompletion or
 * touchdown, and by nothing else — there is no turn limit in the game. That is
 * right for football and wrong for a lesson: a fumble nobody recovers leaves a
 * live ball on the grass and a down that stays in `planning` for as long as
 * anyone keeps pressing. The closing beat cannot notice, because it carries
 * `needsLivePlay: false` — it is the step waiting for the whistle, so it cannot
 * also treat "no whistle yet" as a failure.
 *
 * Well above anything an authored beat asks for (the integration test's own
 * run-out backstop stops at 30), so this only ever catches a down that has
 * genuinely stopped going anywhere.
 */
export const MAX_LESSON_TURNS = 40;
```

Then extend `offScript`. The cap is judged before the step's own opinion,
because a down this long is not the script's whatever step is showing — but
the sign-off card (`step === null`) must stay exempt, since the tutorial is
over by then and the turn count is simply whatever the last lesson left behind:

```js
export function offScript(scenario, index, state) {
  if (state.penalty) return true;
  const step = stepAt(scenario, index);
  if (step === null) return false; // the sign-off gates nothing, however long the down ran
  // The only check that can catch a play which simply never ends. The phase
  // test below cannot: a hung down never leaves `planning`, and the closing
  // beat opts out of the phase test anyway by carrying needsLivePlay: false.
  if (state.turnIndex > MAX_LESSON_TURNS) return true;
  if (!step.needsLivePlay) return false;
  return state.phase === 'playOver' || state.phase === 'gameOver';
}
```

- [ ] **Step 4: Record the seed history where the next tuner will find it**

In `lib/game/tutorial/script.js`, on `PLAYING_DEFENSE`, immediately above its
`seed` line:

```js
  // 3005, not 3003: at 3003 the quarterback fumbles on turn two and neither
  // man recovers, so the ball sits live on the grass and the down never ends.
  // That hang is what MAX_LESSON_TURNS now catches; the seed is what stops the
  // scripted path walking into it in the first place.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/game/tutorial/machine.test.js`
Expected: PASS.

Run: `npm test`
Expected: no new failures. In particular the integration test must stay green —
none of its scenarios runs anywhere near 40 turns.

- [ ] **Step 6: Commit**

```bash
git add lib/game/tutorial/machine.js lib/game/tutorial/script.js test/game/tutorial/machine.test.js && git commit -m "fix: a lesson that cannot end re-deals instead of stalling"
```

---

## Self-review notes

**Spec coverage.** Every decision in the spec has a task: strict gating (5, 11),
the SVG card and ring (7, 8, 11), fixed seeds and replay (4, 6, 9), authored
opponents (3, 4), the menu — suppressed throughout and then taught as
the way out (4, 5, 7, 9, 11) — drill rosters in their own table (2), and no
realignment during a lesson (11 step 6). The three exits chosen during
brainstorming — finish to home, an always-available skip, a remembered
completion — are Tasks 9, 5 and 10, with the finish now running through the
Coaches Menu rather than through a button on the card. The two added lessons — throttle and the
defender's stance — are steps `run-the-qb` and `break-down` in Task 4.

**Two things deliberately left out**, matching the spec's "Not doing": snapping
to somebody other than the quarterback is stated in lesson one's first card but
never made a step, and there is no beat about the down-and-distance line.

**The riskiest task is 6.** Everything before it is mechanical; everything after
it is UI. If the seeds turn out not to hold, the fix is in the authored orders
and the demo targets, in that order, and never in a `done` predicate.
