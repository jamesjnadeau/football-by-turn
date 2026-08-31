# Learned Offense and Co-evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A trainable offense — learned formation, learned run/pass call,
learned run direction, learned routes and receiver targeting — selectable in
the real game as a computer-coached offense (`{ai: 'offense', level:
'learned'}`), plus true competitive co-evolution: both genomes retrained
population-against-population, replacing the Defense plan's scripted interim
opponent.

**Architecture:** Builds directly on the Defense plan's foundation
(`lib/game/learned/genome.js`, `tools/harness.js`, `tools/evolve.js`, the
`maybeApplyLearnedFormations` hook, the generalized `AI_MODES`). The offense
brain (`lib/game/learned/offense-policy.js`) is a mutating coach in the shape
of `offense.js`'s `autoplanOffense` — unlike the defense's pure-orders
pattern, an offense must plan throws (`setPass`) and stances (`setMode`), so
it writes state directly and `ai.js` just dispatches it. A one-field play
memory (`state.aiPlay`, plain serializable data) carries the snap's call
through the down. One small refactor first: `pursuitTarget` moves to its own
module and `offense.js`'s block helpers get exported, so
`ai.js → offense-policy → offense.js` never forms an import cycle.
Co-evolution (`tools/coevolve.js`) alternates offense and defense generations,
each side scored against the other's current champion plus a small hall of
fame (damps rock-paper-scissors cycling), and ships both genome modules.

**Tech Stack:** Plain ES modules, `node --test` (`npm test`), `mulberry32`
seeded RNG. No new dependencies, no build step.

**Spec:** `docs/superpowers/plans/2026-08-31-learned-ai-spec.md`.
**Prerequisite:** the Defense plan
(`docs/superpowers/plans/2026-08-31-learned-defense.md`) is fully executed —
this plan imports its modules by name.

## Global Constraints

- No npm dependencies and no build step, ever.
- Nothing under `lib/` may import `node:` modules; only `tools/` may.
- All randomness through passed-in seeded functions — no `Math.random()`, no
  `Date.now()` in `lib/` or any training path.
- No import cycles in `lib/` — this plan's Task 1 exists to keep that true.
- A learned offense formation must be LEGAL every down: at least
  `minOnLine` (5 for variant `'7'`) men within `ON_LINE_YARDS` of the line,
  snapper between the hashes — enforced by clamps, verified against
  `formationFoul`/`spotFault` in tests.
- The learned offense must never plan an illegal forward pass: one forward
  throw per down, from behind the line only.
- Genome formation offsets key to variant `'7'` ids; the brain itself reads
  the field and survives other variants.
- Shipped genome modules (`offense-genome.js`, and the retrained
  `defense-genome.js`) are generated `{meta, values}` ES modules, committed.

## File Structure

- Create: `lib/game/pursuit.js` — `pursuitTarget`, extracted from `ai.js`.
- Modify: `lib/game/ai.js` — re-export `pursuitTarget`; later the offense
  dispatch + `AI_MODES` entry.
- Modify: `lib/game/offense.js` — import `pursuitTarget` from `pursuit.js`;
  export `assignBlocks` and `applyBlocks`.
- Create: `lib/game/learned/offense-spec.js` — the offense parameter spec.
- Create: `lib/game/learned/offense-genome.js` — shipped genome (seed now,
  co-evolution-trained later).
- Modify: `lib/game/learned/formation.js` — offense spots applier +
  extended `maybeApplyLearnedFormations`.
- Create: `lib/game/learned/offense-policy.js` — call gate, run plan, pass
  plan, `coachLearnedOffense`.
- Modify: `lib/game/state.js` — `aiPlay: null` in `createGame`.
- Modify: `lib/game/rules.js` — `state.aiPlay = null` in `nextDown`.
- Modify: `tools/harness.js` — `learnedOffenseCoach`, `evaluateMatch`.
- Create: `tools/coevolve.js` — the co-evolution loop + `offenseFitness`.
- Create: `tools/train-coevolve.js` — CLI, writes both genome modules.
- Modify: `package.json` (`train:coevolve` script), `README.md`.

---

### Task 1: Break the cycle — extract `pursuit.js`, export the block helpers

**Files:**
- Create: `lib/game/pursuit.js`
- Modify: `lib/game/ai.js` (lines importing/defining `pursuitTarget`)
- Modify: `lib/game/offense.js` (its `ai.js` import; `assignBlocks`/`applyBlocks` exports)
- Test: `test/game/pursuit.test.js`

**Why:** `ai.js` is about to import `learned/offense-policy.js`, which needs
`offense.js`'s helpers (`daylightDirection`, `applyBlocks`, `readDefender`,
`playSideEdgeX`). Today `offense.js` imports `pursuitTarget` from `ai.js`,
which would close the loop `ai → offense-policy → offense → ai`. Moving
`pursuitTarget` into its own leaf module opens it: after this task
`offense.js` imports nothing from `ai.js`.

**Interfaces:**
- Produces: `lib/game/pursuit.js` exporting `pursuitTarget(state, player)`
  with exactly its current behavior; `ai.js` re-exports it (so `ai.test.js`
  and any other importer keeps working); `offense.js` exports `assignBlocks
  (blockers, defenders) -> Map<blockerId, defenderId>` and
  `applyBlocks(state, blockers)` (already written, just made public).

- [ ] **Step 1: Write the failing test**

Create `test/game/pursuit.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pursuitTarget } from '../../lib/game/pursuit.js';
import { pursuitTarget as reExported } from '../../lib/game/ai.js';
import { assignBlocks, applyBlocks } from '../../lib/game/offense.js';
import { createGame, getPlayer } from '../../lib/game/state.js';

test('pursuitTarget lives in pursuit.js and ai.js re-exports the same function', () => {
  assert.equal(pursuitTarget, reExported);
  const s = createGame({ seed: 1 });
  const target = pursuitTarget(s, getPlayer(s, 'd-s'));
  assert.ok(Number.isFinite(target.x) && Number.isFinite(target.y));
});

test('offense.js no longer leans on ai.js', () => {
  const src = readFileSync(new URL('../../lib/game/offense.js', import.meta.url), 'utf8');
  assert.ok(!src.includes("from './ai.js'"));
});

test('the block helpers are public: nearest pairs, then plans', () => {
  const s = createGame({ seed: 1 });
  const blockers = s.players.filter((p) => ['o-wr1', 'o-wr2'].includes(p.id));
  const defenders = s.players.filter((p) => p.team === 'defense');
  const map = assignBlocks(blockers, defenders);
  assert.equal(map.get('o-wr1'), 'd-cb1'); // each takes the corner across from him
  assert.equal(map.get('o-wr2'), 'd-cb2');
  applyBlocks(s, blockers);
  assert.ok(getPlayer(s, 'o-wr1').plan);
  assert.ok(getPlayer(s, 'o-wr2').plan);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/pursuit.test.js`
Expected: FAIL — cannot find module `lib/game/pursuit.js`.

- [ ] **Step 3: Refactor**

Create `lib/game/pursuit.js` (the function moves verbatim, comment and all):

```js
/**
 * Chasing the ball: the one aiming rule the pursuit brain, the smart brain's
 * loose-ball scramble and the offense's own autoplan all share. A leaf
 * module — it reads state.js and modes.js and nothing reads it back — so
 * both ai.js and offense.js may import it without forming a cycle.
 */
import { add, sub, len, scale } from './vec.js';
import { ballPos, carrier } from './state.js';
import { maxSpeed } from './modes.js';
import { AI_LEAD_MAX_SECONDS } from './constants.js';

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
  if (!car || car.id === player.id) return { ...bp };
  const t = Math.min(AI_LEAD_MAX_SECONDS, len(sub(bp, player.pos)) / maxSpeed(player));
  return add(bp, scale(car.vel, t));
}
```

In `lib/game/ai.js`: delete the `pursuitTarget` function and add

```js
// pursuitTarget moved to pursuit.js so offense-side modules can share it
// without importing this file; re-exported so every existing importer —
// tests included — still finds it here.
export { pursuitTarget } from './pursuit.js';
import { pursuitTarget } from './pursuit.js';
```

(keep the internal `defensePlans` call sites unchanged; drop `add`/`scale`
from the vec import if now unused).

In `lib/game/offense.js`: change

```js
import { pursuitTarget } from './ai.js';
```

to

```js
import { pursuitTarget } from './pursuit.js';
```

and add `export` to the two helpers:

```js
export function assignBlocks(blockers, defenders) {
```

```js
export function applyBlocks(state, blockers) {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/game/pursuit.test.js test/game/ai.test.js test/game/offense.test.js`
Expected: PASS — behavior is unchanged everywhere.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`.

```bash
git add lib/game/pursuit.js lib/game/ai.js lib/game/offense.js test/game/pursuit.test.js
git commit -m "refactor: extract pursuit.js and publish the block helpers"
```

---

### Task 2: The offense parameter spec and the seed genome

**Files:**
- Create: `lib/game/learned/offense-spec.js`
- Create: `lib/game/learned/offense-genome.js`
- Test: `test/game/learned/offense-spec.test.js`

**Interfaces:**
- Produces:
  - `OFFENSE_SPEC` — spec array with keys:
    - `pos:{id}:across` / `pos:{id}:down` for the seven `'7'` offense ids.
      The five line players' `down` range is `[-1.8, -0.5]` — always inside
      `ON_LINE_YARDS`, so `minOnLine` can never be violated by training.
    - `call:bias`, `call:down`, `call:toGo`, `call:box` — run/pass logit.
    - `run:sideBias`, `run:read`, `run:lean` — direction preference, option
      read threshold (units), runner lean.
    - `throw:go`, `throw:hold`, `qb:drop` — throw threshold, hold turns,
      drop-back throttle.
    - `tgt:sep`, `tgt:depth`, `tgt:dist` — receiver scoring weights.
    - `route:{id}:deg0` / `route:{id}:degLate` for `o-wr1`, `o-wr2`, `o-rb`.
  - `OFFENSE_VARIANT = '7'`.
  - `OFFENSE_GENOME` — `{meta, values}` at the spec inits (the roster's own
    formation, run-leaning call).

- [ ] **Step 1: Write the failing test**

Create `test/game/learned/offense-spec.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OFFENSE_SPEC, OFFENSE_VARIANT } from '../../../lib/game/learned/offense-spec.js';
import { OFFENSE_GENOME } from '../../../lib/game/learned/offense-genome.js';
import { makeGenome, clampGenome } from '../../../lib/game/learned/genome.js';
import { ON_LINE_YARDS } from '../../../lib/game/constants.js';

test('the spec covers formation, the call gate, run, pass and routes', () => {
  const keys = new Set(OFFENSE_SPEC.map((p) => p.key));
  for (const id of ['o-c', 'o-lg', 'o-rg', 'o-wr1', 'o-wr2', 'o-qb', 'o-rb']) {
    assert.ok(keys.has(`pos:${id}:across`), `pos:${id}:across`);
    assert.ok(keys.has(`pos:${id}:down`), `pos:${id}:down`);
  }
  for (const k of ['call:bias', 'call:down', 'call:toGo', 'call:box',
    'run:sideBias', 'run:read', 'run:lean',
    'throw:go', 'throw:hold', 'qb:drop',
    'tgt:sep', 'tgt:depth', 'tgt:dist']) {
    assert.ok(keys.has(k), k);
  }
  for (const id of ['o-wr1', 'o-wr2', 'o-rb']) {
    assert.ok(keys.has(`route:${id}:deg0`), id);
    assert.ok(keys.has(`route:${id}:degLate`), id);
  }
  assert.equal(OFFENSE_SPEC.length, 33);
});

test('no training run can pull the line off the line, or anyone past it', () => {
  const byKey = new Map(OFFENSE_SPEC.map((p) => [p.key, p]));
  for (const id of ['o-c', 'o-lg', 'o-rg', 'o-wr1', 'o-wr2']) {
    const p = byKey.get(`pos:${id}:down`);
    assert.ok(p.min >= -ON_LINE_YARDS + 0.2, `${id} stays on the line`);
    assert.ok(p.max <= -0.5, `${id} stays behind the line`);
  }
  for (const id of ['o-qb', 'o-rb']) {
    assert.ok(byKey.get(`pos:${id}:down`).max <= -0.5, `${id} stays behind the line`);
  }
});

test('the spec inits reproduce the roster formation', () => {
  const g = makeGenome(OFFENSE_SPEC);
  assert.equal(g['pos:o-c:across'], 0);
  assert.equal(g['pos:o-c:down'], -1);
  assert.equal(g['pos:o-wr2:across'], 15);
  assert.equal(g['pos:o-qb:down'], -4);
  assert.equal(g['pos:o-rb:down'], -7);
});

test('the shipped genome loads, matches the variant, and is already clamped', () => {
  assert.equal(OFFENSE_GENOME.meta.variant, OFFENSE_VARIANT);
  assert.deepEqual(clampGenome(OFFENSE_SPEC, OFFENSE_GENOME.values), OFFENSE_GENOME.values);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/offense-spec.test.js`
Expected: FAIL — cannot find module `offense-spec.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/learned/offense-spec.js`:

```js
/**
 * Every number the learned offense may tune. Same conventions as
 * defense-spec.js: formation inits are the '7' roster itself, so an
 * untrained genome fields the game's own offense.
 *
 * The formation ranges are where legality lives (see the Global Constraints
 * of the plan that built this): the five line players' `down` can never
 * leave [-1.8, -0.5], which keeps them inside ON_LINE_YARDS (2) — so every
 * formation any training run can express passes formationFoul. Backfield
 * `down` tops out at -0.5: nobody may learn to line up offside.
 */

const F = [];

// The line five: on the line by construction.
const LINE = [
  ['o-c', 0], ['o-lg', -2.5], ['o-rg', 2.5], ['o-wr1', -15], ['o-wr2', 15],
];
for (const [id, across] of LINE) {
  F.push({ key: `pos:${id}:across`, min: -24, max: 24, init: across });
  F.push({ key: `pos:${id}:down`, min: -1.8, max: -0.5, init: -1 });
}
// The backfield.
F.push(
  { key: 'pos:o-qb:across', min: -24, max: 24, init: 0 },
  { key: 'pos:o-qb:down', min: -8, max: -2.5, init: -4 },
  { key: 'pos:o-rb:across', min: -24, max: 24, init: 0 },
  { key: 'pos:o-rb:down', min: -10, max: -4, init: -7 },
);

F.push(
  // Run/pass logit: pass when bias + wDown·down + wToGo·toGo + wBox·box > 0.
  // Bias starts firmly negative — an untrained genome runs the option, the
  // play the scripted autoplan already proved out.
  { key: 'call:bias', min: -4, max: 4, init: -2 },
  { key: 'call:down', min: -4, max: 4, init: 0 },
  { key: 'call:toGo', min: -4, max: 4, init: 1 },
  { key: 'call:box', min: -4, max: 4, init: 1 },
  // The run: which side, how wide the read is (OPTION_READ_UNITS as a
  // learnable, in units), how hard the runners lean off straight upfield.
  { key: 'run:sideBias', min: -2, max: 2, init: 0.5 },
  { key: 'run:read', min: 0, max: 12, init: 6 },
  { key: 'run:lean', min: 0.2, max: 2, init: 0.5 },
  // The pass: how open is open enough, how many turns the QB will wait,
  // and how hard he drops back at the snap.
  { key: 'throw:go', min: -20, max: 40, init: 8 },
  { key: 'throw:hold', min: 1, max: 4, init: 3 },
  { key: 'qb:drop', min: 0.2, max: 1, init: 0.6 },
  // Receiver scoring, all in yards: separation from the nearest defender,
  // progress downfield, and throw distance (a cost, so its range is <= 0).
  { key: 'tgt:sep', min: 0, max: 3, init: 1 },
  { key: 'tgt:depth', min: -2, max: 2, init: 0.5 },
  { key: 'tgt:dist', min: -2, max: 0, init: -0.3 },
);

// Routes: degrees off straight upfield (positive bends right), one angle for
// the release turn and one for every turn after.
for (const [id, deg0, degLate] of [
  ['o-wr1', -20, 0], ['o-wr2', 20, 0], ['o-rb', 0, 30],
]) {
  F.push({ key: `route:${id}:deg0`, min: -80, max: 80, init: deg0 });
  F.push({ key: `route:${id}:degLate`, min: -80, max: 80, init: degLate });
}

export const OFFENSE_SPEC = F;
export const OFFENSE_VARIANT = '7';
```

Create `lib/game/learned/offense-genome.js`:

```js
// GENERATED by the training tools in tools/ — retrain rather than editing by hand.
// (This first version is a hand-written seed: the '7' roster's own formation
// with a run-leaning call — exactly makeGenome(OFFENSE_SPEC).)
export const OFFENSE_GENOME = {
  "meta": {
    "variant": "7",
    "note": "hand-written seed: roster formation, run-leaning call"
  },
  "values": {
    "pos:o-c:across": 0, "pos:o-c:down": -1,
    "pos:o-lg:across": -2.5, "pos:o-lg:down": -1,
    "pos:o-rg:across": 2.5, "pos:o-rg:down": -1,
    "pos:o-wr1:across": -15, "pos:o-wr1:down": -1,
    "pos:o-wr2:across": 15, "pos:o-wr2:down": -1,
    "pos:o-qb:across": 0, "pos:o-qb:down": -4,
    "pos:o-rb:across": 0, "pos:o-rb:down": -7,
    "call:bias": -2, "call:down": 0, "call:toGo": 1, "call:box": 1,
    "run:sideBias": 0.5, "run:read": 6, "run:lean": 0.5,
    "throw:go": 8, "throw:hold": 3, "qb:drop": 0.6,
    "tgt:sep": 1, "tgt:depth": 0.5, "tgt:dist": -0.3,
    "route:o-wr1:deg0": -20, "route:o-wr1:degLate": 0,
    "route:o-wr2:deg0": 20, "route:o-wr2:degLate": 0,
    "route:o-rb:deg0": 0, "route:o-rb:degLate": 30
  }
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/learned/offense-spec.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`.

```bash
git add lib/game/learned/offense-spec.js lib/game/learned/offense-genome.js test/game/learned/offense-spec.test.js
git commit -m "feat: the learned offense's parameter spec and seed genome"
```

---

### Task 3: Learned offense starting positions

**Files:**
- Modify: `lib/game/learned/formation.js`
- Test: `test/game/learned/offense-formation.test.js`

**Interfaces:**
- Produces (appended to `learned/formation.js`):
  - `learnedOffenseSpots(state, values) -> [{id, pos}]` — clamped legal:
    inbounds, behind the line (the spec's own down ranges), snapper pinned
    between the hashes, bodies nudged apart.
  - `applyLearnedOffenseFormation(state, values) -> boolean` — planning
    phase, turn 0 only; wipes moved men's plans/covers.
  - `maybeApplyLearnedFormations(state)` extended: applies the shipped
    `OFFENSE_GENOME` when `aiTeam === 'offense' && aiLevel === 'learned' &&
    variantId === OFFENSE_VARIANT`. The call sites in `createGame`/`nextDown`
    already run BEFORE `aimSnap`, so the snap is aimed from the moved spots —
    and the auto snap carries `target: SNAP_TARGET_ID` anyway, so
    `releasePass` re-aims it at the whistle regardless.

- [ ] **Step 1: Write the failing test**

Create `test/game/learned/offense-formation.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  learnedOffenseSpots, applyLearnedOffenseFormation, maybeApplyLearnedFormations,
} from '../../../lib/game/learned/formation.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';
import { OFFENSE_GENOME } from '../../../lib/game/learned/offense-genome.js';
import { makeGenome, mutateGenome } from '../../../lib/game/learned/genome.js';
import { createGame, getPlayer } from '../../../lib/game/state.js';
import { spotFault, formationFoul } from '../../../lib/game/formation.js';
import { fieldPos } from '../../../lib/game/view.js';
import { hashCentresX } from '../../../lib/field/geometry.js';
import { mulberry32 } from '../../../lib/game/rng.js';

test('a genome offset moves the man to that spot', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(OFFENSE_SPEC), 'pos:o-rb:across': 8, 'pos:o-rb:down': -6 };
  assert.equal(applyLearnedOffenseFormation(s, g), true);
  assert.deepEqual(getPlayer(s, 'o-rb').pos, fieldPos(8, s.losYard - 6));
});

test('whatever training produces is legal: no fault, no formation flag', () => {
  // Applied first, THEN judged: a candidate spot may legitimately overlap a
  // teammate's OLD spot when that teammate is about to move too, so legality
  // is a fact about the landed formation, not about spots one at a time.
  const rand = mulberry32(13);
  for (let i = 0; i < 20; i++) {
    const s = createGame({ seed: 1 });
    const g = mutateGenome(OFFENSE_SPEC, makeGenome(OFFENSE_SPEC), rand, 0.5);
    applyLearnedOffenseFormation(s, g);
    for (const p of s.players.filter((pl) => pl.team === 'offense')) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${p.id} mutation ${i}`);
    }
    assert.equal(formationFoul(s), null, `mutation ${i} keeps 5 on the line`);
  }
});

test('the snapper is pinned between the hashes, wherever the genome sends him', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(OFFENSE_SPEC), 'pos:o-c:across': 24 };
  applyLearnedOffenseFormation(s, g);
  const [hashLeft, hashRight] = hashCentresX();
  const c = getPlayer(s, 'o-c');
  assert.ok(c.pos.x >= hashLeft && c.pos.x <= hashRight);
});

test('it refuses once the down is running', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 1;
  assert.equal(applyLearnedOffenseFormation(s, makeGenome(OFFENSE_SPEC)), false);
});

test('createGame applies the shipped genome for a learned-level computer offense', () => {
  const saved = OFFENSE_GENOME.values['pos:o-rb:down'];
  OFFENSE_GENOME.values['pos:o-rb:down'] = -9;
  try {
    const s = createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' });
    assert.deepEqual(getPlayer(s, 'o-rb').pos, fieldPos(0, s.losYard - 9));
    assert.ok(s.plannedPass, 'the snap is still aimed, after the move');
    // A learned DEFENSE game leaves the offense alone.
    const d = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
    assert.deepEqual(getPlayer(d, 'o-rb').pos, fieldPos(0, d.losYard - 7));
  } finally {
    OFFENSE_GENOME.values['pos:o-rb:down'] = saved;
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/offense-formation.test.js`
Expected: FAIL — `learnedOffenseSpots` is not exported.

- [ ] **Step 3: Write the implementation**

In `lib/game/learned/formation.js`, add to the imports:

```js
import { hashCentresX } from '../../field/geometry.js';
import { OFFENSE_SPEC, OFFENSE_VARIANT } from './offense-spec.js';
import { OFFENSE_GENOME } from './offense-genome.js';
```

Append:

```js
/**
 * The genome's spots for the offense. Legality is mostly the SPEC's doing —
 * the line five's `down` range keeps minOnLine satisfied, and no `down` may
 * reach past the line — so what is enforced here is what a range cannot
 * express: the snapper stands between the hashes (the ball is spotted
 * there; formation.js's spotFault refuses him anywhere else), everyone is
 * inside the sidelines, and nobody stands inside another body.
 */
export function learnedOffenseSpots(state, values) {
  const g = clampGenome(OFFENSE_SPEC, values);
  const [hashLeft, hashRight] = hashCentresX();
  const placed = state.players
    .filter((p) => p.team !== 'offense')
    .map((p) => ({ radius: p.radius, pos: p.pos }));
  const spots = [];
  for (const p of state.players) {
    if (p.team !== 'offense') continue;
    const across = g[`pos:${p.id}:across`];
    if (typeof across !== 'number') continue;
    const want = fieldPos(across, state.losYard + g[`pos:${p.id}:down`]);
    if (p.id === state.ball.carrierId) {
      want.x = Math.max(hashLeft, Math.min(hashRight, want.x));
    }
    const x = clearX(placed, want.x, want.y, p.radius);
    const pos = { x, y: want.y };
    placed.push({ radius: p.radius, pos });
    spots.push({ id: p.id, pos });
  }
  return spots;
}

/** The offense twin of applyLearnedDefenseFormation — same gate, same wipe. */
export function applyLearnedOffenseFormation(state, values) {
  if (state.phase !== 'planning' || state.turnIndex !== 0) return false;
  for (const { id, pos } of learnedOffenseSpots(state, values)) {
    const p = state.players.find((pl) => pl.id === id);
    p.pos = pos;
    p.plan = null;
    p.cover = null;
  }
  return true;
}
```

and extend `maybeApplyLearnedFormations` (replace the function body):

```js
export function maybeApplyLearnedFormations(state) {
  if (state.aiTeam === 'defense' && state.aiLevel === 'learned'
    && state.variantId === DEFENSE_VARIANT) {
    applyLearnedDefenseFormation(state, DEFENSE_GENOME.values);
  }
  if (state.aiTeam === 'offense' && state.aiLevel === 'learned'
    && state.variantId === OFFENSE_VARIANT) {
    applyLearnedOffenseFormation(state, OFFENSE_GENOME.values);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/learned/offense-formation.test.js test/game/learned/formation.test.js`
Expected: PASS — the defense-side tests too.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`.

```bash
git add lib/game/learned/formation.js test/game/learned/offense-formation.test.js
git commit -m "feat: learned starting positions for the computer offense"
```

---

### Task 4: The offense brain — play-call gate and run side

**Files:**
- Create: `lib/game/learned/offense-policy.js`
- Test: `test/game/learned/offense-policy.test.js`

**Interfaces:**
- Consumes: `ballPos` (state.js); `yardsOfY` (view.js); `UNITS_PER_YARD_X`
  (../field/geometry.js).
- Produces:
  - `boxDefenders(state) -> player[]` — defenders within 3 yards of the line
    and within 8 yards across of the ball.
  - `callFeatures(state) -> {down, toGo, box}` — each roughly in [0, 1].
  - `chooseCall(state, genome) -> 'run' | 'pass'`.
  - `chooseSide(state, genome) -> 1 | -1` — run away from the heavier side
    of the box, tilted by `run:sideBias`.
  - (Tasks 5–7 append the rest of the module.)

- [ ] **Step 1: Write the failing test**

Create `test/game/learned/offense-policy.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxDefenders, callFeatures, chooseCall, chooseSide,
} from '../../../lib/game/learned/offense-policy.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { createGame, getPlayer, ballPos } from '../../../lib/game/state.js';
import { fieldPos } from '../../../lib/game/view.js';

test('the box is the defenders crowding the line near the ball', () => {
  const s = createGame({ seed: 1 });
  // The '7' front: three linemen a yard off the ball, corners 15 wide,
  // backer 4 deep, safety 8 deep — the box is exactly the front three.
  assert.deepEqual(
    boxDefenders(s).map((p) => p.id).sort(),
    ['d-dt1', 'd-dt2', 'd-nt'],
  );
});

test('callFeatures normalizes the situation', () => {
  const s = createGame({ seed: 1 });
  const f = callFeatures(s);
  assert.equal(f.down, 0);
  assert.equal(f.toGo, 1);
  assert.equal(f.box, 3 / 7);
});

test('the call gate is a thresholded logit; the seed genome runs on 1st and 10', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(OFFENSE_SPEC); // bias -2, toGo 1, box 1
  assert.equal(chooseCall(s, g), 'run');
  assert.equal(chooseCall(s, { ...g, 'call:bias': 2 }), 'pass');
  // Stack the box and a box-weighted genome starts throwing.
  const stacked = { ...g, 'call:bias': -1.5, 'call:box': 4 };
  assert.equal(chooseCall(s, stacked), 'pass'); // -1.5 + 1 + 4·(3/7) > 0
});

test('the run goes away from the heavier side of the box', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(OFFENSE_SPEC);
  const ball = ballPos(s);
  // Shift the whole front left of the ball: run right.
  for (const id of ['d-nt', 'd-dt1', 'd-dt2']) {
    getPlayer(s, id).pos = fieldPos(-4, s.losYard + 1);
  }
  assert.equal(chooseSide(s, g), 1);
  // Shift it right: run left.
  for (const id of ['d-nt', 'd-dt1', 'd-dt2']) {
    getPlayer(s, id).pos = fieldPos(4, s.losYard + 1);
  }
  assert.equal(chooseSide(s, g), -1);
});
```

(The two shifted linemen landing on one spot is fine for this test — nobody
collides during planning reads.)

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/offense-policy.test.js`
Expected: FAIL — cannot find module `offense-policy.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/learned/offense-policy.js`:

```js
/**
 * The learned offense's brain. Unlike the defense's pure-orders pattern,
 * this is a MUTATING coach in the mold of offense.js's autoplanOffense —
 * an offense has to plan throws (setPass) and stances (setMode), which the
 * {id, aim, cover} order shape cannot carry. ai.js dispatches
 * coachLearnedOffense (Task 7's entry point) exactly where it dispatches the
 * defense brains, and runTurn's clearAiPlans/clearPass still wipe everything
 * at the whistle, so nothing the computer plans ever survives onto the
 * human's screen.
 *
 * Structure hand-written, numbers learned, same as the defense: a run/pass
 * logit over the situation, a generalized option read for the run (the
 * scripted autoplan's read with its threshold and leans made learnable),
 * genome routes and a scored throw decision for the pass, and offense.js's
 * own daylight/block helpers for every broken play.
 */
import { sub, len, norm, dist, add, scale } from '../vec.js';
import {
  setPlan, setMode, setPass, getPlayer, carrier, ballPos,
  SNAPPER_ID, SNAP_TARGET_ID,
} from '../state.js';
import { yardsOfY } from '../view.js';
import { UNITS_PER_YARD_X } from '../../field/geometry.js';
import { OFFENSIVE_LINE_ROLES } from '../rosters.js';
import { powerForTravel, spawnOffset } from '../flight.js';
import { LOCK_UNITS } from '../lob.js';
import {
  readDefender, playSideEdgeX, daylightDirection, applyBlocks,
} from '../offense.js';
import {
  OPTION_FAKE_FORWARD, OPTION_FAKE_THROTTLE, AI_BREAKDOWN_UNITS,
} from '../constants.js';

const BOX_DEPTH_YARDS = 3;
const BOX_HALF_WIDTH_YARDS = 8;

/** The defenders crowding the line near the ball — the men a run must beat. */
export function boxDefenders(state) {
  const ball = ballPos(state);
  if (!ball) return [];
  return state.players.filter((p) => p.team === 'defense'
    && Math.abs(yardsOfY(p.pos.y) - state.losYard) <= BOX_DEPTH_YARDS
    && Math.abs(p.pos.x - ball.x) <= BOX_HALF_WIDTH_YARDS * UNITS_PER_YARD_X);
}

/** The situation, squashed to roughly [0,1] — the call gate's whole world. */
export function callFeatures(state) {
  const defenders = state.players.filter((p) => p.team === 'defense').length;
  return {
    down: (state.down - 1) / 3,
    toGo: Math.min(1, (state.toGoYard - state.losYard) / 10),
    box: defenders ? boxDefenders(state).length / defenders : 0,
  };
}

export function chooseCall(state, genome) {
  const f = callFeatures(state);
  const z = genome['call:bias']
    + genome['call:down'] * f.down
    + genome['call:toGo'] * f.toGo
    + genome['call:box'] * f.box;
  return z > 0 ? 'pass' : 'run';
}

/**
 * Which way the run goes: away from the heavier half of the box, tilted by
 * the genome's own side preference. 1 is right, -1 is left.
 */
export function chooseSide(state, genome) {
  const ball = ballPos(state);
  const box = boxDefenders(state);
  const left = box.filter((p) => p.pos.x < ball.x).length;
  const right = box.length - left;
  const z = genome['run:sideBias'] + 0.5 * (left - right);
  return z >= 0 ? 1 : -1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/learned/offense-policy.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/game/learned/offense-policy.js test/game/learned/offense-policy.test.js
git commit -m "feat: the learned offense's call gate and run side"
```

---

### Task 5: The offense brain — the learned run

**Files:**
- Modify: `lib/game/learned/offense-policy.js`
- Test: `test/game/learned/offense-policy.test.js` (append)

**Interfaces:**
- Produces: `planLearnedRun(state, genome) -> {call: 'run', side, give} |
  null` — the scripted option snap with its knobs learned: side from
  `chooseSide`, give/keep read against `run:read`, runner lean from
  `run:lean`. Sets the same things `planOptionSnap` sets: a direct-snap
  `setPass` to the RB on a give, cut blocks and a lean for the line, plans
  for RB and QB, blocks for everyone else. Returns null (planning nothing)
  if the formation has no QB or RB.

- [ ] **Step 1: Write the failing test**

Append to `test/game/learned/offense-policy.test.js` (extend the policy
import with `planLearnedRun`):

```js
test('a wide read means give: direct snap to the back, boot fake by the QB', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(OFFENSE_SPEC), 'run:sideBias': 2 }; // force right
  // Park the play-side edge defender wide: contain, so the option gives.
  getPlayer(s, 'd-dt2').pos = fieldPos(6, s.losYard + 1);
  const play = planLearnedRun(s, g);
  assert.deepEqual(play, { call: 'run', side: 1, give: true });
  assert.equal(s.plannedPass.from, 'o-c');
  assert.equal(s.plannedPass.target, 'o-rb');
  assert.notEqual(s.plannedPass.auto, true); // the call replaced the auto snap
  for (const id of ['o-c', 'o-lg', 'o-rg']) {
    assert.equal(getPlayer(s, id).mode, 'cutBlock', id);
  }
  assert.ok(getPlayer(s, 'o-rb').plan.dir.y > 0, 'the back dives upfield');
  assert.ok(getPlayer(s, 'o-qb').plan.dir.x < 0, 'the QB boots away from the play');
});

test('a crashing read means keep: the QB carries it wide', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(OFFENSE_SPEC), 'run:sideBias': 2 };
  // The '7' front is tight (edge defender level with the guard): keep.
  const play = planLearnedRun(s, g);
  assert.deepEqual(play, { call: 'run', side: 1, give: false });
  assert.equal(s.plannedPass.auto, true, 'the ordinary snap to the QB stands');
  assert.ok(getPlayer(s, 'o-qb').plan.dir.x > 0, 'the keep bends play-side');
  assert.ok(getPlayer(s, 'o-qb').plan.dir.y > 0, 'and upfield');
  assert.equal(getPlayer(s, 'o-qb').plan.throttle, 1);
});

test("the read threshold is the genome's, not the constant", () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'd-dt2').pos = fieldPos(4, s.losYard + 1); // ~5.6 units outside the edge
  const wide = { ...makeGenome(OFFENSE_SPEC), 'run:sideBias': 2, 'run:read': 2 };
  assert.equal(planLearnedRun(s, wide).give, true); // 5.6 > 2: contain
  const s2 = createGame({ seed: 1 });
  getPlayer(s2, 'd-dt2').pos = fieldPos(4, s2.losYard + 1);
  const narrow = { ...makeGenome(OFFENSE_SPEC), 'run:sideBias': 2, 'run:read': 10 };
  assert.equal(planLearnedRun(s2, narrow).give, false); // 5.6 < 10: crash
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/offense-policy.test.js`
Expected: FAIL — `planLearnedRun` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/game/learned/offense-policy.js`:

```js
/**
 * The learned run: offense.js's option snap with its three judgment calls —
 * which side, how wide "contain" is, how hard the runners lean — read off
 * the genome instead of constants.js. Everything structural is the scripted
 * play's own: a contain read means a direct snap to the diving back with the
 * QB selling a boot; a crash read means the QB keeps it around the edge.
 */
export function planLearnedRun(state, genome) {
  const offense = state.players.filter((p) => p.team === 'offense');
  const qb = offense.find((p) => p.id === SNAP_TARGET_ID);
  const rb = offense.find((p) => p.role === 'RB');
  const line = offense.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role));
  if (!qb || !rb) return null;

  const side = chooseSide(state, genome);
  const reader = readDefender(state, side);
  const give = reader !== null
    && side * (reader.pos.x - playSideEdgeX(side, line)) > genome['run:read'];

  if (give) {
    const from = getPlayer(state, SNAPPER_ID);
    const gap = sub(rb.pos, from.pos);
    if (len(gap) > 0) {
      setPass(state, SNAPPER_ID, norm(gap),
        powerForTravel(Math.max(0, len(gap) - spawnOffset(from)), Infinity), rb.id);
    }
  }

  const lean = norm({ x: side * genome['run:lean'], y: 1 });
  for (const p of line) {
    setPlan(state, p.id, lean, 1);
    setMode(state, p.id, 'cutBlock');
  }
  setPlan(state, rb.id, lean, 1);
  setPlan(
    state, qb.id,
    give
      ? norm({ x: -side, y: OPTION_FAKE_FORWARD })
      : norm({ x: side * Math.max(1, genome['run:lean'] * 2), y: 1 }),
    give ? OPTION_FAKE_THROTTLE : 1,
  );
  applyBlocks(state, offense.filter(
    (p) => p.id !== qb.id && p.id !== rb.id && !OFFENSIVE_LINE_ROLES.has(p.role),
  ));
  return { call: 'run', side, give };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/learned/offense-policy.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/game/learned/offense-policy.js test/game/learned/offense-policy.test.js
git commit -m "feat: the learned run — the option with learned knobs"
```

---

### Task 6: The offense brain — routes, receiver scoring, the throw

**Files:**
- Modify: `lib/game/learned/offense-policy.js`
- Test: `test/game/learned/offense-policy.test.js` (append)

**Interfaces:**
- Produces:
  - `eligibleReceivers(state) -> player[]` — offense minus the QB, the
    snapper, and every offensive lineman (the men `checkPickup` would let
    catch a forward pass).
  - `routeDir(genome, id, phase) -> {x, y}` — `phase` is `'deg0'` or
    `'degLate'`; ids without a route key run straight upfield.
  - `planLearnedPassSnap(state, genome) -> {call: 'pass'} | null` — routes
    for the receivers, a drop for the QB (`qb:drop` throttle), pass
    protection from the line; the auto snap to the QB stands.
  - `receiverScore(state, genome, qb, r) -> number` — separation + depth −
    distance, in yards, genome-weighted.
  - `planThrow(state, genome, qb) -> boolean` — throws to the best receiver
    when his score clears `throw:go` (or the hold clock `throw:hold` runs
    out); locked pass inside `LOCK_UNITS`, unlocked lob beyond it; refuses
    when a forward pass is already spent or the QB is past the line.

- [ ] **Step 1: Write the failing test**

Append to `test/game/learned/offense-policy.test.js` (extend the policy
import with `eligibleReceivers, routeDir, planLearnedPassSnap, receiverScore,
planThrow`):

```js
test('eligible receivers are the skill men, never the line or the passer', () => {
  const s = createGame({ seed: 1 });
  assert.deepEqual(
    eligibleReceivers(s).map((p) => p.id).sort(),
    ['o-rb', 'o-wr1', 'o-wr2'],
  );
});

test('routeDir turns degrees into unit directions, upfield by default', () => {
  const g = makeGenome(OFFENSE_SPEC);
  const right = routeDir({ ...g, 'route:o-wr2:deg0': 90 }, 'o-wr2', 'deg0');
  assert.ok(Math.abs(right.x - 1) < 1e-9 && Math.abs(right.y) < 1e-9);
  assert.deepEqual(routeDir(g, 'o-te', 'deg0'), { x: 0, y: 1 }); // no key: upfield
  const wr1 = routeDir(g, 'o-wr1', 'deg0'); // init -20°: bends left, still upfield
  assert.ok(wr1.x < 0 && wr1.y > 0);
});

test('a pass snap sends routes, a drop, and protection', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(OFFENSE_SPEC);
  const play = planLearnedPassSnap(s, g);
  assert.deepEqual(play, { call: 'pass' });
  for (const id of ['o-wr1', 'o-wr2', 'o-rb']) {
    assert.ok(getPlayer(s, id).plan, `${id} runs a route`);
  }
  const qb = getPlayer(s, 'o-qb');
  assert.ok(qb.plan.dir.y < 0, 'the QB drops back');
  assert.equal(qb.plan.throttle, g['qb:drop']);
  assert.ok(getPlayer(s, 'o-c').plan, 'the line protects');
  assert.equal(s.plannedPass.auto, true, 'the ordinary snap stands');
});

test('receiverScore prices separation up, depth up, distance down', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = makeGenome(OFFENSE_SPEC); // sep 1, depth 0.5, dist -0.3
  const qb = getPlayer(s, 'o-qb');
  const wr2 = getPlayer(s, 'o-wr2');
  wr2.pos = fieldPos(10, s.losYard + 4);
  getPlayer(s, 'd-cb2').pos = fieldPos(10, s.losYard + 10); // 6 yards of separation
  const base = receiverScore(s, g, qb, wr2);
  getPlayer(s, 'd-cb2').pos = fieldPos(10, s.losYard + 5); // now 1 yard
  assert.ok(receiverScore(s, g, qb, wr2) < base);
});

test('planThrow locks on inside the lock zone and lobs beyond it', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...makeGenome(OFFENSE_SPEC), 'throw:go': -20 }; // anything is open enough
  const qb = getPlayer(s, 'o-qb');
  // wr2 close and wide open: a locked throw.
  getPlayer(s, 'o-wr2').pos = fieldPos(10, s.losYard + 3);
  getPlayer(s, 'o-wr1').pos = fieldPos(-2, s.losYard - 1);
  getPlayer(s, 'o-rb').pos = fieldPos(2, s.losYard - 5);
  getPlayer(s, 'd-cb2').pos = fieldPos(22, s.losYard + 12);
  assert.equal(planThrow(s, g, qb), true);
  assert.equal(s.plannedPass.target, 'o-wr2');

  // The same receiver far downfield: an unlocked lob.
  const s2 = createGame({ seed: 1 });
  s2.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s2.plannedPass = null;
  const qb2 = getPlayer(s2, 'o-qb');
  getPlayer(s2, 'o-wr2').pos = fieldPos(10, s2.losYard + 14);
  getPlayer(s2, 'o-wr1').pos = fieldPos(-2, s2.losYard - 1);
  getPlayer(s2, 'o-rb').pos = fieldPos(2, s2.losYard - 5);
  getPlayer(s2, 'd-cb2').pos = fieldPos(22, s2.losYard + 20);
  assert.equal(planThrow(s2, g, qb2), true);
  assert.equal(s2.plannedPass.target, null);
  assert.ok(s2.plannedPass.dir.y > 0, 'thrown downfield');
});

test('planThrow never plans an illegal forward pass', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...makeGenome(OFFENSE_SPEC), 'throw:go': -20 };
  const qb = getPlayer(s, 'o-qb');
  s.forwardPasses = 1; // one is already spent
  assert.equal(planThrow(s, g, qb), false);
  s.forwardPasses = 0;
  qb.pos = fieldPos(0, s.losYard + 2); // past the line
  assert.equal(planThrow(s, g, qb), false);
});

test('the hold clock forces the throw', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...makeGenome(OFFENSE_SPEC), 'throw:go': 40, 'throw:hold': 2 }; // nobody is ever open
  const qb = getPlayer(s, 'o-qb');
  s.turnIndex = 1;
  assert.equal(planThrow(s, g, qb), false); // still holding
  s.turnIndex = 2;
  assert.equal(planThrow(s, g, qb), true); // clock's up: best available
  assert.ok(s.plannedPass);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/offense-policy.test.js`
Expected: FAIL — the new exports are missing.

- [ ] **Step 3: Write the implementation**

Append to `lib/game/learned/offense-policy.js`:

```js
/** Who a forward pass may be thrown to: the skill men. Offensive linemen
 *  are ineligible (checkPickup lets a forward pass sail through them), so
 *  they are never worth targeting. */
export function eligibleReceivers(state) {
  return state.players.filter((p) => p.team === 'offense'
    && p.id !== SNAP_TARGET_ID && p.id !== SNAPPER_ID
    && !OFFENSIVE_LINE_ROLES.has(p.role));
}

/** A route angle off straight-upfield (positive bends right), as a unit
 *  direction. A man the genome has no route for runs straight upfield. */
export function routeDir(genome, id, phase) {
  const deg = genome[`route:${id}:${phase}`];
  if (typeof deg !== 'number') return { x: 0, y: 1 };
  const rad = (deg * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad) };
}

/**
 * The pass snap: receivers release on their genome routes, the QB drops
 * straight back at his genome throttle, the line pass-protects (the same
 * nearest-pair blocks the scripted autoplan throws). The ordinary auto snap
 * to the QB is left standing — the throw itself is a later turn's decision
 * (planThrow), once the routes have had time to come open.
 */
export function planLearnedPassSnap(state, genome) {
  const offense = state.players.filter((p) => p.team === 'offense');
  const qb = offense.find((p) => p.id === SNAP_TARGET_ID);
  if (!qb) return null;
  for (const r of eligibleReceivers(state)) {
    setPlan(state, r.id, routeDir(genome, r.id, 'deg0'), 1);
  }
  setPlan(state, qb.id, { x: 0, y: -1 }, genome['qb:drop']);
  applyBlocks(state, offense.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role)));
  return { call: 'pass' };
}

/** How good this throw looks, in yards: separation from the nearest
 *  defender, plus progress downfield, minus how far the ball must travel. */
export function receiverScore(state, genome, qb, r) {
  const defenders = state.players.filter((p) => p.team === 'defense');
  const sep = defenders.length
    ? Math.min(...defenders.map((d) => dist(d.pos, r.pos))) / UNITS_PER_YARD_X
    : 99;
  const depth = yardsOfY(r.pos.y) - state.losYard;
  const range = dist(qb.pos, r.pos) / UNITS_PER_YARD_X;
  return genome['tgt:sep'] * sep
    + genome['tgt:depth'] * depth
    + genome['tgt:dist'] * range;
}

/**
 * Throw, or keep holding. The best-scoring receiver gets the ball when he
 * clears the genome's bar — or when the hold clock runs out and the best
 * available has to do. Inside the lock zone the throw is locked on
 * (releasePass re-solves the meeting itself, so dir/power here are just the
 * fallback); beyond it a locked ball would have to fly flat forever, so the
 * throw goes up as an unlocked lob at the receiver's lead.
 *
 * The two refusals are the two flags pass.js would throw: never a second
 * forward pass, never one from past the line. An offense that cannot throw
 * legally scrambles instead (coachLearnedOffense's job).
 */
export function planThrow(state, genome, qb) {
  if (state.forwardPasses > 0) return false;
  if (yardsOfY(qb.pos.y) > state.losYard) return false;
  const receivers = eligibleReceivers(state);
  if (!receivers.length) return false;
  const scored = receivers
    .map((r) => ({ r, score: receiverScore(state, genome, qb, r) }))
    .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
  const best = scored[0];
  const mustThrow = state.turnIndex >= Math.round(genome['throw:hold']);
  if (best.score <= genome['throw:go'] && !mustThrow) return false;
  const gap = sub(best.r.pos, qb.pos);
  if (len(gap) === 0) return false;
  if (len(gap) <= LOCK_UNITS) {
    setPass(state, qb.id, norm(gap), 0.5, best.r.id);
    return true;
  }
  const lead = add(best.r.pos, scale(best.r.vel, 0.5));
  const to = sub(lead, qb.pos);
  if (len(to) === 0) return false;
  setPass(state, qb.id, norm(to),
    powerForTravel(Math.max(0, len(to) - spawnOffset(qb)), Infinity), null);
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/learned/offense-policy.test.js`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/game/learned/offense-policy.js test/game/learned/offense-policy.test.js
git commit -m "feat: learned routes, receiver scoring and the throw decision"
```

---

### Task 7: The offense brain — the whole-down coach and the play memory

**Files:**
- Modify: `lib/game/learned/offense-policy.js`
- Modify: `lib/game/state.js` (`createGame`: `aiPlay: null`)
- Modify: `lib/game/rules.js` (`nextDown`: reset `aiPlay`)
- Test: `test/game/learned/offense-policy.test.js` (append)

**Interfaces:**
- Produces:
  - `tuckIfPressured(state, car)` — tucks the carrier when a defender is
    within `AI_BREAKDOWN_UNITS`.
  - `coachLearnedOffense(state, genome)` — the per-turn entry point: turn 0
    decides the call (`state.aiPlay = planLearned…`), later turns run the
    play — a passing QB reads and throws (or scrambles when he legally
    can't), any other carrier finds daylight behind blocks, a loose ball is
    chased by everyone. Works with `aiTeam` null (the harness) and
    `aiTeam === 'offense'` (the game) alike — it never reads `aiTeam`.
  - `state.aiPlay` — `null` between downs; `{call, side?, give?}` during
    one. Plain serializable data, initialized in `createGame`, reset in
    `nextDown`.

- [ ] **Step 1: Write the failing test**

Append to `test/game/learned/offense-policy.test.js` (extend the policy
import with `coachLearnedOffense, tuckIfPressured`; add
`import { runTurn } from '../../../lib/game/turn.js';`,
`import { nextDown } from '../../../lib/game/rules.js';` and
`import { mulberry32 } from '../../../lib/game/rng.js';`):

```js
test('state carries an aiPlay slot, born null and reset every down', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.aiPlay, null);
  s.aiPlay = { call: 'run', side: 1, give: false };
  s.deadReason = 'tackled';
  s.phase = 'playOver';
  nextDown(s);
  assert.equal(s.aiPlay, null);
});

test('turn 0 decides the call and remembers it', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(OFFENSE_SPEC), 'call:bias': 4 }; // always pass
  coachLearnedOffense(s, g);
  assert.deepEqual(s.aiPlay, { call: 'pass' });
  assert.ok(getPlayer(s, 'o-wr1').plan, 'routes are on');

  const s2 = createGame({ seed: 1 });
  const g2 = { ...makeGenome(OFFENSE_SPEC), 'call:bias': -4 }; // always run
  coachLearnedOffense(s2, g2);
  assert.equal(s2.aiPlay.call, 'run');
});

test('a run play coaches the carrier to daylight, tucked under pressure', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 2;
  s.aiPlay = { call: 'run', side: 1, give: false };
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const qb = getPlayer(s, 'o-qb');
  getPlayer(s, 'd-nt').pos = fieldPos(0, s.losYard - 2); // in his face
  coachLearnedOffense(s, makeGenome(OFFENSE_SPEC));
  assert.ok(qb.plan, 'the carrier has somewhere to go');
  assert.equal(qb.mode, 'tucked');
  assert.ok(getPlayer(s, 'o-wr1').plan, 'everyone else blocks');
});

test('a loose ball sends the whole offense after it', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 3;
  s.aiPlay = { call: 'run', side: 1, give: true };
  s.ball = { carrierId: null, pos: fieldPos(2, s.losYard - 2), vel: { x: 0, y: 0 }, loose: 0 };
  s.plannedPass = null;
  coachLearnedOffense(s, makeGenome(OFFENSE_SPEC));
  for (const p of s.players.filter((pl) => pl.team === 'offense')) {
    assert.ok(p.plan, `${p.id} chases`);
  }
});

test('a full learned-offense down runs turn by turn without incident', () => {
  const s = createGame({ seed: 21 });
  const g = makeGenome(OFFENSE_SPEC);
  const random = mulberry32(21);
  for (let t = 0; t < 12 && s.phase !== 'playOver'; t++) {
    coachLearnedOffense(s, g);
    runTurn(s, random);
  }
  // Whatever the play became, the engine stayed coherent.
  assert.ok(['playOver', 'planning'].includes(s.phase));
  assert.equal(typeof s.turnIndex, 'number');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/offense-policy.test.js`
Expected: FAIL — `coachLearnedOffense` is not exported; `aiPlay` is
undefined, not null.

- [ ] **Step 3: Write the implementation**

In `lib/game/state.js`, add to the `createGame` state literal (right after
`plannedPass: null,`):

```js
    // The computer offense's play memory: the call it made at the snap
    // ({call, side?, give?}), so turn three still knows what turn zero
    // decided. Plain serializable data; per-down, like plannedPass — see
    // learned/offense-policy.js. null whenever no learned offense is playing.
    aiPlay: null,
```

In `lib/game/rules.js`, add to `nextDown`'s reset block (next to
`state.plannedPass = null;`):

```js
  state.aiPlay = null;
```

Append to `lib/game/learned/offense-policy.js`:

```js
/** Tuck when contact is near: the ball is worth more than the step. */
export function tuckIfPressured(state, car) {
  const near = state.players.some((p) => p.team === 'defense'
    && dist(p.pos, car.pos) <= AI_BREAKDOWN_UNITS);
  if (near && car.mode !== 'tucked') setMode(state, car.id, 'tucked');
}

/**
 * The whole-down coach — ai.js dispatches this every turn for a learned
 * computer offense, and the training harness calls it directly (it never
 * reads aiTeam, so hot-seat training and the real game share one brain).
 *
 * Turn 0 is the huddle: the call gate picks the play and state.aiPlay
 * remembers it. Every turn after runs it: a passing QB re-releases his
 * receivers, protects, and throws when someone clears the bar (or scrambles
 * once he legally can't throw and the hold clock is spent); any other
 * carrier finds daylight behind blocks; a loose ball is everyone's problem.
 */
export function coachLearnedOffense(state, genome) {
  const offense = state.players.filter((p) => p.team === 'offense');
  const car = carrier(state);
  if (!car) {
    const bp = ballPos(state);
    if (!bp) return;
    for (const p of offense) {
      const to = sub(bp, p.pos);
      if (len(to) === 0) continue;
      setPlan(state, p.id, norm(to), 1);
    }
    return;
  }
  if (car.team !== 'offense') return; // the defense has it: that play is already ruled

  if (state.turnIndex === 0) {
    state.aiPlay = chooseCall(state, genome) === 'pass'
      ? planLearnedPassSnap(state, genome)
      : planLearnedRun(state, genome);
    return;
  }

  const qb = offense.find((p) => p.id === SNAP_TARGET_ID);
  if (state.aiPlay?.call === 'pass' && qb && car.id === qb.id) {
    for (const r of eligibleReceivers(state)) {
      setPlan(state, r.id, routeDir(genome, r.id, 'degLate'), 1);
    }
    applyBlocks(state, offense.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role)));
    if (!planThrow(state, genome, qb)) {
      if (state.turnIndex > Math.round(genome['throw:hold'])) {
        // He cannot (or will not) throw and the clock is spent: scramble.
        setPlan(state, qb.id, daylightDirection(state, qb), 1);
        tuckIfPressured(state, qb);
      } else {
        setPlan(state, qb.id, { x: 0, y: -1 }, 0.2); // keep the pocket drifting
      }
    }
    return;
  }

  // A runner — whichever call, whoever ended up with the ball.
  setPlan(state, car.id, daylightDirection(state, car), 1);
  tuckIfPressured(state, car);
  applyBlocks(state, offense.filter((p) => p.id !== car.id));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/learned/offense-policy.test.js`
Expected: PASS (19 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test` — `state.test.js`/`rules.test.js` must not object to the new
`aiPlay` field (it is additive; if a test asserts the exact state shape,
update it to include `aiPlay: null`).

```bash
git add lib/game/learned/offense-policy.js lib/game/state.js lib/game/rules.js test/game/learned/offense-policy.test.js
git commit -m "feat: coachLearnedOffense — the whole-down learned offense"
```

---

### Task 8: Wire the learned offense into ai.js and the mode cycle

**Files:**
- Modify: `lib/game/ai.js`
- Modify: `test/game/ai.test.js` (the mode-cycle test, again)
- Test: `test/game/ai-learned.test.js` (append)

**Interfaces:**
- Produces: `coachAi` dispatches `coachLearnedOffense(state,
  OFFENSE_GENOME.values)` when `aiTeam === 'offense' && aiLevel ===
  'learned'` (before `applyAiModes`, which is defense-shaped); `AI_MODES`
  gains `{ai: 'offense', level: 'learned', ...}` immediately before the
  hot-seat entry, which stays last. Final cycle: smart defense → learned
  defense → basic defense → learned offense → hot-seat.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/ai-learned.test.js` (add `nextDown` to a
`rules.js` import and extend the existing imports as needed):

```js
import { nextDown } from '../../lib/game/rules.js';

test('coachAi dispatches the learned offense', () => {
  const s = createGame({ seed: 9, ai: 'offense', aiLevel: 'learned' });
  coachAi(s);
  assert.ok(s.aiPlay, 'the snap call is made');
  assert.ok(['run', 'pass'].includes(s.aiPlay.call));
  const planned = s.players.filter((p) => p.team === 'offense' && p.plan).length;
  assert.ok(planned >= 3, 'the offense is coached');
});

test('a learned computer offense plays whole downs against an idle defense', () => {
  const s = createGame({ seed: 11, ai: 'offense', aiLevel: 'learned' });
  const random = mulberry32(11);
  let guard = 0;
  while (s.phase !== 'gameOver' && guard++ < 300) {
    if (s.phase === 'playOver') { nextDown(s); continue; }
    runTurn(s, random);
  }
  assert.equal(s.phase, 'gameOver');
  assert.ok(
    ['touchdown', 'turnover-on-downs', 'turnover-fumble'].includes(s.result),
    s.result,
  );
});
```

Update the mode-cycle test in `test/game/ai.test.js` once more — replace the
Task 7 (Defense plan) version with:

```js
test('the mode button cycles all four computer settings and hot-seat', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  const labels = [];
  for (let i = 0; i < AI_MODES.length; i++) {
    labels.push(AI_MODES[aiModeIndex(s)].label);
    const next = nextAiMode(s);
    s.aiTeam = next.ai;
    s.aiLevel = next.level;
  }
  assert.deepEqual(labels, [
    'Defense: computer (smart)',
    'Defense: computer (learned)',
    'Defense: computer (basic)',
    'Offense: computer (learned)',
    'Defense: you',
  ]);
  // The cycle closes.
  assert.equal(AI_MODES[aiModeIndex(s)].label, 'Defense: computer (smart)');
  // Hot-seat is hot-seat whatever level it is carrying.
  s.aiTeam = null;
  s.aiLevel = 'learned';
  assert.equal(AI_MODES[aiModeIndex(s)].label, 'Defense: you');
});
```

- [ ] **Step 2: Run to make sure the new tests fail**

Run: `node --test test/game/ai-learned.test.js test/game/ai.test.js`
Expected: FAIL — no offense dispatch, no offense entry.

- [ ] **Step 3: Write the implementation**

In `lib/game/ai.js`, add the imports:

```js
import { coachLearnedOffense } from './learned/offense-policy.js';
import { OFFENSE_GENOME } from './learned/offense-genome.js';
```

In `coachAi`, add the offense branch first (before `applyAiModes`, which
sets defensive stances):

```js
export function coachAi(state) {
  if (!state.aiTeam) return;
  if (state.aiTeam === 'offense' && state.aiLevel === 'learned') {
    coachLearnedOffense(state, OFFENSE_GENOME.values);
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

Insert into `AI_MODES`, immediately before the hot-seat entry:

```js
  {
    ai: 'offense',
    level: 'learned',
    label: 'Offense: computer (learned)',
    note: 'You coach the defense; the computer runs its trained offense — learned formation, run/pass calls, routes and reads.',
  },
```

(`aiModeIndex` already finds entries by `(ai, level)` and keeps hot-seat
last — no change needed.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/game/ai-learned.test.js test/game/ai.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`. Then eyeball it in the browser (`npm run serve`): cycle the
mode button to `Offense: computer (learned)`, confirm the offense lines up,
snaps, and plays turns while you coach the defense, with no console errors.

```bash
git add lib/game/ai.js test/game/ai.test.js test/game/ai-learned.test.js
git commit -m "feat: the learned offense as a selectable computer opponent"
```

---

### Task 9: Harness support — learned offense coach and head-to-head evaluation

**Files:**
- Modify: `tools/harness.js`
- Test: `test/tools/harness.test.js` (append)

**Interfaces:**
- Produces:
  - `learnedOffenseCoach(values) -> (state) => void` — learned offense
    formation at turn 0, then `coachLearnedOffense` every turn.
  - `evaluateMatch(offValues, defValues, {plays, seed}) ->
    {yardsPerPlay, touchdownRate, turnoverRate}` — a thin wrapper:
    `evaluateDefense(defValues, {plays, seed, offenseCoach:
    learnedOffenseCoach(offValues)})`. One stats object serves both sides'
    fitness (the offense reads it positively, the defense negatively).

- [ ] **Step 1: Write the failing test**

Append to `test/tools/harness.test.js` (extend the harness import with
`learnedOffenseCoach, evaluateMatch`; add
`import { OFFENSE_SPEC } from '../../lib/game/learned/offense-spec.js';`):

```js
test('evaluateMatch pits two learned genomes deterministically', () => {
  const off = makeGenome(OFFENSE_SPEC);
  const def = makeGenome(DEFENSE_SPEC);
  const a = evaluateMatch(off, def, { plays: 3, seed: 6 });
  const b = evaluateMatch(off, def, { plays: 3, seed: 6 });
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.yardsPerPlay));
});

test('learnedOffenseCoach stands its formation and coaches the play', () => {
  const off = makeGenome(OFFENSE_SPEC);
  const s = scenario(mulberry32(8));
  learnedOffenseCoach(off)(s);
  assert.ok(s.aiPlay, 'a call was made at the snap');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/tools/harness.test.js`
Expected: FAIL — the new exports are missing.

- [ ] **Step 3: Write the implementation**

In `tools/harness.js`, add the imports:

```js
import { coachLearnedOffense } from '../lib/game/learned/offense-policy.js';
import { applyLearnedOffenseFormation } from '../lib/game/learned/formation.js';
```

Append:

```js
/**
 * The learned offense as a coach function: its genome's formation at the
 * top of the down (the auto snap re-aims itself — it is locked on the QB,
 * and releasePass re-solves a locked throw at the whistle), then the
 * whole-down brain every turn.
 */
export function learnedOffenseCoach(values) {
  return (state) => {
    if (state.turnIndex === 0 && state.phase === 'planning') {
      applyLearnedOffenseFormation(state, values);
    }
    coachLearnedOffense(state, values);
  };
}

/** Learned offense vs learned defense: one stats object, read positively by
 *  the offense's fitness and negatively by the defense's. */
export function evaluateMatch(offValues, defValues, { plays, seed }) {
  return evaluateDefense(defValues, {
    plays, seed, offenseCoach: learnedOffenseCoach(offValues),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/tools/harness.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/harness.js test/tools/harness.test.js
git commit -m "feat: head-to-head evaluation of the two learned genomes"
```

---

### Task 10: Co-evolution — the trainer, the training run, the shipped genomes

**Files:**
- Create: `tools/coevolve.js`
- Create: `tools/train-coevolve.js`
- Modify: `package.json` (`train:coevolve` script)
- Modify: `lib/game/learned/offense-genome.js` and
  `lib/game/learned/defense-genome.js` (overwritten by the trainer)
- Modify: `README.md`
- Test: `test/tools/coevolve.test.js`

**Interfaces:**
- Produces:
  - `offenseFitness(stats) -> number` — `yardsPerPlay +
    TD_BONUS_YARDS·touchdownRate - TURNOVER_PENALTY_YARDS·turnoverRate`,
    with `TD_BONUS_YARDS = 10`, `TURNOVER_PENALTY_YARDS = 8` (exported).
  - `coevolve({offSeed, defSeed, popSize, generations, elite, sigma, plays,
    hof, seed, onGeneration}) -> {offense, defense, history}` — alternating
    generations: score every offense candidate against the defense champion
    plus up to `hof` hall-of-fame champions (mean fitness, common seeds),
    select and refill; then the mirror step for the defense against the
    just-crowned offense. Champions enter the hall every generation.
    `history` is `[{gen, offense, defense}]` champion scores.
  - CLI `tools/train-coevolve.js`: seeds from the shipped genomes, runs
    `coevolve`, writes BOTH genome modules with meta. Guarded like
    `train-defense.js` so imports run nothing.

- [ ] **Step 1: Write the failing test**

Create `test/tools/coevolve.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coevolve, offenseFitness, TD_BONUS_YARDS, TURNOVER_PENALTY_YARDS,
} from '../../tools/coevolve.js';
import { OFFENSE_SPEC } from '../../lib/game/learned/offense-spec.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { makeGenome } from '../../lib/game/learned/genome.js';

test('offenseFitness prices yards for, touchdowns for, turnovers against', () => {
  const base = { yardsPerPlay: 3, turnoverRate: 0, touchdownRate: 0 };
  assert.ok(offenseFitness({ ...base, yardsPerPlay: 5 }) > offenseFitness(base));
  assert.ok(offenseFitness({ ...base, touchdownRate: 0.5 }) > offenseFitness(base));
  assert.ok(offenseFitness({ ...base, turnoverRate: 0.5 }) < offenseFitness(base));
  assert.equal(
    offenseFitness({ yardsPerPlay: 4, turnoverRate: 0.25, touchdownRate: 0.1 }),
    4 + TD_BONUS_YARDS * 0.1 - TURNOVER_PENALTY_YARDS * 0.25,
  );
});

test('a tiny co-evolution runs end to end, deterministically', () => {
  const opts = {
    offSeed: makeGenome(OFFENSE_SPEC),
    defSeed: makeGenome(DEFENSE_SPEC),
    popSize: 3, generations: 2, elite: 1, sigma: 0.05,
    plays: 2, hof: 1, seed: 5,
  };
  const a = coevolve(opts);
  const b = coevolve(opts);
  assert.deepEqual(a, b);
  for (const p of OFFENSE_SPEC) assert.equal(typeof a.offense[p.key], 'number', p.key);
  for (const p of DEFENSE_SPEC) assert.equal(typeof a.defense[p.key], 'number', p.key);
  assert.equal(a.history.length, 2);
  assert.equal(typeof a.history[0].offense, 'number');
  assert.equal(typeof a.history[0].defense, 'number');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/tools/coevolve.test.js`
Expected: FAIL — cannot find module `tools/coevolve.js`.

- [ ] **Step 3: Write the implementation**

Create `tools/coevolve.js`:

```js
/**
 * Competitive co-evolution: two populations, alternating generations, each
 * side scored by playing the other's champion — plus a small HALL OF FAME
 * of past champions, because pure champion-vs-champion co-evolution chases
 * its own tail (beat today's opponent, forget yesterday's). Scoring against
 * a few generations of history keeps improvements real.
 *
 * This is the training the spec actually asks for; train-defense.js's
 * scripted-opponent run was the bootstrap that made the first defense
 * genome worth playing against.
 */
import { mulberry32 } from '../lib/game/rng.js';
import { clampGenome, mutateGenome } from '../lib/game/learned/genome.js';
import { OFFENSE_SPEC } from '../lib/game/learned/offense-spec.js';
import { DEFENSE_SPEC } from '../lib/game/learned/defense-spec.js';
import { evaluateMatch } from './harness.js';
import { defenseFitness } from './train-defense.js';

export const TD_BONUS_YARDS = 10;
export const TURNOVER_PENALTY_YARDS = 8;

export function offenseFitness(stats) {
  return stats.yardsPerPlay
    + TD_BONUS_YARDS * stats.touchdownRate
    - TURNOVER_PENALTY_YARDS * stats.turnoverRate;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function coevolve({
  offSeed, defSeed,
  popSize = 12, generations = 20, elite = 3, sigma = 0.06,
  plays = 12, hof = 2, seed = 1, onGeneration = null,
}) {
  const rand = mulberry32(seed);
  const mut = (spec, g) => mutateGenome(spec, g, rand, sigma);
  const fill = (spec, parents) => {
    const pop = [...parents];
    while (pop.length < popSize) {
      pop.push(mut(spec, parents[Math.floor(rand() * parents.length)]));
    }
    return pop;
  };

  let bestOff = clampGenome(OFFENSE_SPEC, offSeed);
  let bestDef = clampGenome(DEFENSE_SPEC, defSeed);
  let popOff = fill(OFFENSE_SPEC, [bestOff]);
  let popDef = fill(DEFENSE_SPEC, [bestDef]);
  const hallOff = [];
  const hallDef = [];
  const history = [];

  const step = (pop, spec, score) => {
    const scored = pop
      .map((genome) => ({ genome, score: score(genome) }))
      .sort((a, b) => b.score - a.score);
    return { champion: scored[0], next: fill(spec, scored.slice(0, elite).map((s) => s.genome)) };
  };

  for (let g = 0; g < generations; g++) {
    const genSeed = seed * 1000003 + g;

    // Offense generation: every candidate against the defense champion and
    // the recent hall, on common seeds.
    const defOpp = [bestDef, ...hallDef.slice(-hof)];
    const offStep = step(popOff, OFFENSE_SPEC, (genome) => mean(
      defOpp.map((d, i) => offenseFitness(
        evaluateMatch(genome, d, { plays, seed: genSeed * 31 + i }),
      )),
    ));
    bestOff = offStep.champion.genome;
    popOff = offStep.next;

    // Defense generation, against the offense that just improved.
    const offOpp = [bestOff, ...hallOff.slice(-hof)];
    const defStep = step(popDef, DEFENSE_SPEC, (genome) => mean(
      offOpp.map((o, i) => defenseFitness(
        evaluateMatch(o, genome, { plays, seed: genSeed * 37 + i }),
      )),
    ));
    bestDef = defStep.champion.genome;
    popDef = defStep.next;

    hallOff.push(bestOff);
    hallDef.push(bestDef);
    history.push({ gen: g, offense: offStep.champion.score, defense: defStep.champion.score });
    if (onGeneration) onGeneration(g, history[history.length - 1]);
  }
  return { offense: bestOff, defense: bestDef, history };
}
```

Create `tools/train-coevolve.js`:

```js
/**
 * Retrain BOTH learned genomes against each other and ship the champions.
 *
 * Usage:
 *   node tools/train-coevolve.js --generations 20 --pop 12 --plays 12 --seed 1
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { OFFENSE_GENOME } from '../lib/game/learned/offense-genome.js';
import { DEFENSE_GENOME } from '../lib/game/learned/defense-genome.js';
import { genomeModuleSource } from '../lib/game/learned/genome.js';
import { coevolve } from './coevolve.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = {
    generations: arg('generations', 20),
    popSize: arg('pop', 12),
    plays: arg('plays', 12),
    elite: arg('elite', 3),
    sigma: arg('sigma', 0.06),
    hof: arg('hof', 2),
    seed: arg('seed', 1),
  };
  console.log('co-evolving offense and defense:', opts);
  const { offense, defense, history } = coevolve({
    offSeed: OFFENSE_GENOME.values,
    defSeed: DEFENSE_GENOME.values,
    ...opts,
    onGeneration: (g, h) =>
      console.log(`gen ${g}: offense ${h.offense.toFixed(3)}, defense ${h.defense.toFixed(3)}`),
  });
  const last = history[history.length - 1];
  const meta = (side, fitness) => ({
    variant: '7',
    trainedBy: 'tools/train-coevolve.js',
    opponent: 'co-evolved learned ' + side,
    options: opts,
    fitness,
  });
  writeFileSync(
    new URL('../lib/game/learned/offense-genome.js', import.meta.url),
    genomeModuleSource('OFFENSE_GENOME', offense, meta('defense', last.offense)),
  );
  writeFileSync(
    new URL('../lib/game/learned/defense-genome.js', import.meta.url),
    genomeModuleSource('DEFENSE_GENOME', defense, meta('offense', last.defense)),
  );
  console.log('wrote offense-genome.js and defense-genome.js');
}
```

Modify `package.json` — add to `scripts`:

```json
    "train:coevolve": "node tools/train-coevolve.js"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/tools/coevolve.test.js`
Expected: PASS (2 tests; the tiny run takes a few seconds).

- [ ] **Step 5: The real training run — ship both genomes**

Run:

```bash
node tools/train-coevolve.js --generations 15 --pop 10 --plays 12 --seed 1
```

(This simulates on the order of 10–15k plays; expect minutes, not hours.
Watch the two champion-fitness columns push against each other — the offense
line should NOT run away unopposed, and vice versa; that tension is the
point.) Then:

Run: `npm test`
Expected: ALL PASS with the trained genome modules in place — no test may
depend on specific genome values (any that does gets an explicit genome).

- [ ] **Step 6: Document, verify in the browser, commit**

Update the `README.md` training section (added by the Defense plan) to its
final form — replace its body with:

```markdown
The two learned levels — `Defense: computer (learned)` and
`Offense: computer (learned)` — play trained genomes shipped in
`lib/game/learned/defense-genome.js` and `offense-genome.js`. To retrain
them against each other (competitive co-evolution, the normal way):

    npm run train:coevolve -- --generations 20 --pop 12 --plays 12 --seed 1

To retrain just the defense against the scripted offense (the bootstrap the
first genome came from):

    npm run train:defense -- --generations 30 --pop 16 --plays 24 --seed 1

Training is a seeded evolutionary search over each side's ~30 parameters
(starting spots, play-calling, coverage scheme and matchups, routes and
reads), simulating whole plays headlessly through the same engine the
browser runs. It is fully deterministic for a seed and writes the champions
back into the genome modules, which are committed like any other source.
```

Browser check (`npm run serve`): play a few downs against the learned
defense, then a few coaching the defense against the learned offense —
formations visibly non-default (training moved somebody), plays resolve, no
console errors.

```bash
git add tools/coevolve.js tools/train-coevolve.js test/tools/coevolve.test.js package.json lib/game/learned/offense-genome.js lib/game/learned/defense-genome.js README.md
git commit -m "feat: competitive co-evolution — both genomes trained against each other"
```

---

## Verification checklist (whole plan)

- `npm test` green from a clean checkout.
- The mode button cycles five settings; both learned modes play full games.
- `npm run train:coevolve -- --generations 2 --pop 4 --plays 4 --seed 3`
  completes quickly and rewrites both genome modules as loadable ES modules.
- No import cycles in `lib/`: `offense.js` does not import `ai.js`
  (`test/game/pursuit.test.js` pins this).
