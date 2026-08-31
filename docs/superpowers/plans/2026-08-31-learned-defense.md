# Learned Defense Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A trainable, evolvable defense — learned starting positions, learned
man-coverage assignment weights, a new zone-coverage concept, and a learned
man-vs-zone scheme gate — selectable in the real game as a new AI level
(`aiLevel: 'learned'`), plus the shared training foundation (genome utilities,
episode harness, evolution loop) the Offense plan builds on.

**Architecture:** A policy is a flat `{key: number}` genome governed by a
static spec; `lib/game/learned/` holds the genome utilities, the defense spec,
the shipped genome (a generated JS module), the learned defense brain, and a
formation applier. The brain follows `defense.js`'s pure-orders contract:
`learnedOrders(state, team, genome)` returns `{id, aim, cover}` orders and
`ai.js` is the only writer (via a new shared `applyOrders`). Zone coverage is
its own generic module (`lib/game/zone.js`) parameterized by anchor points.
Training lives in `tools/` (Node-only, free to use `node:` modules): a
scenario/episode harness that plays both teams hot-seat, a generic (μ+λ)
evolution loop, and a CLI trainer that overwrites the shipped genome module.
The interim training opponent is the scripted `autoplanOffense`; the Offense
plan replaces it with true co-evolution.

**Tech Stack:** Plain ES modules, `node --test` (`npm test`), `mulberry32`
seeded RNG. No new dependencies, no build step.

**Spec:** `docs/superpowers/plans/2026-08-31-learned-ai-spec.md` — read it
before executing; every design decision below argues from it.

## Global Constraints

- No npm dependencies and no build step, ever.
- Nothing under `lib/` may import `node:` modules or touch the DOM — `lib/`
  ships to the browser as-is. Only `tools/` may use `node:fs` etc.
- All randomness flows through a passed-in `rand`/`random` function seeded by
  `mulberry32` — no `Math.random()`, no `Date.now()` in `lib/` or in any
  training path (determinism is what makes training and tests reproducible).
- Genome formation offsets are keyed to variant `'7'` ids; the learned brain
  itself must work on any variant (positions read off the field).
- The shipped genome module `lib/game/learned/defense-genome.js` is generated
  by the trainer and committed; it must always load as a plain ES module with
  a `{meta, values}` shape.
- New test files go in `test/game/` (for `lib/game/*`), `test/game/learned/`
  (for `lib/game/learned/*`), and `test/tools/` (for `tools/*`); `node --test`
  discovers them recursively.

## File Structure

- Create: `lib/game/learned/genome.js` — genome make/clamp/mutate/serialize
  (shared by both sides, and by the tools).
- Create: `lib/game/learned/defense-spec.js` — the defense parameter spec.
- Create: `lib/game/learned/defense-genome.js` — the shipped genome
  (hand-written seed now, trainer-generated later).
- Create: `lib/game/zone.js` — zone coverage orders from anchor points.
- Create: `lib/game/learned/defense-policy.js` — scheme gate, weighted
  coverage assignment, full order dispatch.
- Create: `lib/game/learned/formation.js` — learned-formation applier +
  the `maybeApplyLearnedFormations` game hook.
- Modify: `lib/game/ai.js` — `applyOrders` extraction, team params on
  `aiPlayers`/`applyAiModes`, `coachLearnedDefense`, `AI_MODES` entry,
  generalized `aiModeIndex`.
- Modify: `lib/game/state.js` (`createGame`) and `lib/game/rules.js`
  (`nextDown`) — one `maybeApplyLearnedFormations(state)` call each.
- Create: `tools/harness.js` — scenarios, one-play episodes, defense
  evaluation.
- Create: `tools/evolve.js` — generic elitist evolution loop.
- Create: `tools/train-defense.js` — fitness + CLI entry, writes the genome
  module. Plus an npm script `train:defense`.

---

### Task 1: Genome utilities

**Files:**
- Create: `lib/game/learned/genome.js`
- Test: `test/game/learned/genome.test.js`

**Interfaces:**
- Consumes: `mulberry32` from `lib/game/rng.js` (tests only — the module
  itself takes `rand` as an argument).
- Produces (later tasks rely on these exact signatures):
  - `makeGenome(spec) -> {key: number}` — every key at its `init`.
  - `clampGenome(spec, genome) -> {key: number}` — values clamped into
    `[min, max]`; missing/non-numeric keys fall back to `init`; result has
    exactly the spec's keys.
  - `gaussian(rand) -> number` — standard normal via Box–Muller.
  - `mutateGenome(spec, genome, rand, sigma) -> {key: number}` — each value
    perturbed by `gaussian(rand) * sigma * (max - min)`, then clamped.
  - `genomeModuleSource(exportName, values, meta) -> string` — the full text
    of a generated ES module exporting `{meta, values}`.
  - A "spec" is an array of `{key: string, min: number, max: number,
    init: number}`.

- [ ] **Step 1: Write the failing test**

Create `test/game/learned/genome.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGenome, clampGenome, mutateGenome, gaussian, genomeModuleSource,
} from '../../../lib/game/learned/genome.js';
import { mulberry32 } from '../../../lib/game/rng.js';

const SPEC = [
  { key: 'a', min: -1, max: 1, init: 0 },
  { key: 'b', min: 0, max: 10, init: 5 },
];

test('makeGenome starts every key at its init', () => {
  assert.deepEqual(makeGenome(SPEC), { a: 0, b: 5 });
});

test('clampGenome holds values inside [min,max] and fills missing keys', () => {
  assert.deepEqual(clampGenome(SPEC, { a: 7 }), { a: 1, b: 5 });
  assert.deepEqual(clampGenome(SPEC, { a: -3, b: -2 }), { a: -1, b: 0 });
  assert.deepEqual(clampGenome(SPEC, null), { a: 0, b: 5 });
  // Keys the spec has never heard of do not survive into the clamp.
  assert.deepEqual(clampGenome(SPEC, { a: 0.5, junk: 99 }), { a: 0.5, b: 5 });
});

test('gaussian is deterministic for a seed and roughly standard', () => {
  const r1 = mulberry32(3);
  const r2 = mulberry32(3);
  assert.equal(gaussian(r1), gaussian(r2));
  const rand = mulberry32(4);
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += gaussian(rand);
  assert.ok(Math.abs(sum / 2000) < 0.1);
});

test('mutateGenome is deterministic for a seed and stays in range', () => {
  const base = makeGenome(SPEC);
  const g1 = mutateGenome(SPEC, base, mulberry32(9), 0.1);
  const g2 = mutateGenome(SPEC, base, mulberry32(9), 0.1);
  assert.deepEqual(g1, g2);
  assert.notDeepEqual(g1, base);
  const wild = mutateGenome(SPEC, base, mulberry32(10), 5);
  for (const p of SPEC) {
    assert.ok(wild[p.key] >= p.min && wild[p.key] <= p.max);
  }
});

test('genomeModuleSource emits a loadable ES module literal', () => {
  const src = genomeModuleSource('X_GENOME', { a: 1.5 }, { variant: '7' });
  assert.match(src, /^\/\/ GENERATED/);
  assert.match(src, /export const X_GENOME = /);
  assert.ok(src.includes('"a": 1.5'));
  assert.ok(src.includes('"variant": "7"'));
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/genome.test.js`
Expected: FAIL — cannot find module `lib/game/learned/genome.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/learned/genome.js`:

```js
/**
 * Learned-AI genomes: a policy's every tunable number as one flat
 * {key: value} map, governed by a static SPEC — an array of
 * {key, min, max, init}. The spec is the single source of truth for which
 * parameters exist and what range each may take; everything here is pure and
 * takes its randomness as a passed-in `rand`, so training and tests are
 * reproducible from a seed.
 */

export function makeGenome(spec) {
  const g = {};
  for (const p of spec) g[p.key] = p.init;
  return g;
}

/**
 * Clamp into the spec's ranges — and into the spec's KEYS: values for
 * parameters the spec does not name are dropped, and parameters the genome
 * is missing come back at their init. A genome loaded from an older file
 * therefore always fits the code that is about to read it.
 */
export function clampGenome(spec, genome) {
  const g = {};
  for (const p of spec) {
    const v = genome && typeof genome[p.key] === 'number' ? genome[p.key] : p.init;
    g[p.key] = Math.max(p.min, Math.min(p.max, v));
  }
  return g;
}

/** Standard normal, Box–Muller. rand() can return 0 and log(0) is -Infinity,
 *  so the first draw is floored just off it. */
export function gaussian(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * One mutation: every parameter nudged by a Gaussian scaled to ITS OWN range
 * (sigma is a fraction of [min,max], not an absolute), then clamped. Scaling
 * per-range is what lets one sigma serve a genome whose parameters span
 * yards, weights and logits at once.
 */
export function mutateGenome(spec, genome, rand, sigma) {
  const g = {};
  for (const p of spec) {
    g[p.key] = genome[p.key] + gaussian(rand) * sigma * (p.max - p.min);
  }
  return clampGenome(spec, g);
}

/**
 * The full text of a generated genome module. The trainer writes this to
 * lib/game/learned/*-genome.js; the game imports it like any other module,
 * which is the whole trick to shipping a trained policy with no build step.
 */
export function genomeModuleSource(exportName, values, meta = {}) {
  const body = JSON.stringify({ meta, values }, null, 2);
  return `// GENERATED by the training tools in tools/ — retrain rather than editing by hand.\nexport const ${exportName} = ${body};\n`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/learned/genome.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test` — everything green.

```bash
git add lib/game/learned/genome.js test/game/learned/genome.test.js
git commit -m "feat: genome utilities for the learned AI"
```

---

### Task 2: The defense parameter spec and the seed genome

**Files:**
- Create: `lib/game/learned/defense-spec.js`
- Create: `lib/game/learned/defense-genome.js`
- Test: `test/game/learned/defense-spec.test.js`

**Interfaces:**
- Consumes: nothing (pure data).
- Produces:
  - `DEFENSE_SPEC` — the spec array (Task 1's shape) with keys:
    - `pos:{id}:across` / `pos:{id}:down` for each of the seven `'7'`-variant
      defenders (`d-nt d-dt1 d-dt2 d-cb1 d-cb2 d-lb d-s`) — starting spot in
      yards (`across` from field middle, `down` past the line of scrimmage).
    - `zone:{id}:across` / `zone:{id}:depth` for the four coverage bodies
      (`d-cb1 d-cb2 d-lb d-s`) — zone anchor offsets in yards.
    - `cov:dist`, `cov:depth`, `cov:width` — man-assignment cost weights.
    - `scheme:bias`, `scheme:down`, `scheme:toGo`, `scheme:spread` — the
      man/zone gate's logit weights.
  - `DEFENSE_VARIANT = '7'`.
  - `DEFENSE_GENOME` — `{meta, values}`, values = the spec's inits (the
    roster's own alignment, man-leaning scheme).

- [ ] **Step 1: Write the failing test**

Create `test/game/learned/defense-spec.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFENSE_SPEC, DEFENSE_VARIANT } from '../../../lib/game/learned/defense-spec.js';
import { DEFENSE_GENOME } from '../../../lib/game/learned/defense-genome.js';
import { makeGenome, clampGenome } from '../../../lib/game/learned/genome.js';

test('the spec covers formation, zones, coverage weights and the scheme gate', () => {
  const keys = new Set(DEFENSE_SPEC.map((p) => p.key));
  for (const id of ['d-nt', 'd-dt1', 'd-dt2', 'd-cb1', 'd-cb2', 'd-lb', 'd-s']) {
    assert.ok(keys.has(`pos:${id}:across`), `pos:${id}:across`);
    assert.ok(keys.has(`pos:${id}:down`), `pos:${id}:down`);
  }
  for (const id of ['d-cb1', 'd-cb2', 'd-lb', 'd-s']) {
    assert.ok(keys.has(`zone:${id}:across`), `zone:${id}:across`);
    assert.ok(keys.has(`zone:${id}:depth`), `zone:${id}:depth`);
  }
  for (const k of ['cov:dist', 'cov:depth', 'cov:width',
    'scheme:bias', 'scheme:down', 'scheme:toGo', 'scheme:spread']) {
    assert.ok(keys.has(k), k);
  }
  assert.equal(DEFENSE_SPEC.length, 29);
});

test('every spec entry is well-formed and its init is inside its range', () => {
  for (const p of DEFENSE_SPEC) {
    assert.equal(typeof p.key, 'string');
    assert.ok(p.min < p.max, p.key);
    assert.ok(p.init >= p.min && p.init <= p.max, p.key);
  }
});

test('formation depth can never reach back across the line', () => {
  for (const p of DEFENSE_SPEC) {
    if (p.key.startsWith('pos:') && p.key.endsWith(':down')) {
      assert.ok(p.min >= 0.5, p.key);
    }
  }
});

test('the spec inits reproduce the roster alignment', () => {
  const g = makeGenome(DEFENSE_SPEC);
  assert.equal(g['pos:d-nt:across'], 0);
  assert.equal(g['pos:d-nt:down'], 1);
  assert.equal(g['pos:d-cb2:across'], 15);
  assert.equal(g['pos:d-cb2:down'], 2);
  assert.equal(g['pos:d-s:down'], 8);
});

test('the shipped genome loads, matches the variant, and is already clamped', () => {
  assert.equal(DEFENSE_GENOME.meta.variant, DEFENSE_VARIANT);
  assert.deepEqual(clampGenome(DEFENSE_SPEC, DEFENSE_GENOME.values), DEFENSE_GENOME.values);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/defense-spec.test.js`
Expected: FAIL — cannot find module `defense-spec.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/learned/defense-spec.js`:

```js
/**
 * Every number the learned defense may tune, with its legal range and its
 * starting value. The formation inits are the '7' roster's own alignment
 * (rosters.js), so an untrained genome plays the defense the game already
 * fields; training is a walk away from a known-good posture, not from noise.
 *
 * Formation keys are per-id and therefore per-variant; the brain's weight
 * keys (cov:*, scheme:*, zone:*) are variant-agnostic in meaning even though
 * zone anchors are keyed by id too — an id the field doesn't hold simply
 * contributes nothing (see defense-policy.js and learned/formation.js).
 */

const F = [];

// Starting spots: across (yards from the field middle, negative left) and
// down (yards past the line of scrimmage — min 0.5 keeps every learnable spot
// on the defense's own side; formation.js's spotFault refuses the other side).
const SPOTS = [
  ['d-nt', 0, 1], ['d-dt1', -2.5, 1], ['d-dt2', 2.5, 1],
  ['d-cb1', -15, 2], ['d-cb2', 15, 2], ['d-lb', 0, 4], ['d-s', 0, 8],
];
for (const [id, across, down] of SPOTS) {
  F.push({ key: `pos:${id}:across`, min: -24, max: 24, init: across });
  F.push({ key: `pos:${id}:down`, min: 0.5, max: 12, init: down });
}

// Zone anchors for the four coverage bodies: where each man's zone lives,
// as an across/depth offset from the ball's line of scrimmage.
const ZONES = [
  ['d-cb1', -12, 4], ['d-cb2', 12, 4], ['d-lb', 0, 3], ['d-s', 0, 9],
];
for (const [id, across, depth] of ZONES) {
  F.push({ key: `zone:${id}:across`, min: -24, max: 24, init: across });
  F.push({ key: `zone:${id}:depth`, min: 1, max: 15, init: depth });
}

F.push(
  // Man-assignment cost weights: cost = dist·wDist + depth·wDepth + width·wWidth
  // (all in yards; see defense-policy.js). dist-only at init reproduces
  // defense.js's own nearest-pair greedy.
  { key: 'cov:dist', min: 0, max: 3, init: 1 },
  { key: 'cov:depth', min: -2, max: 2, init: 0 },
  { key: 'cov:width', min: -2, max: 2, init: 0 },
  // The man/zone gate's logit: zone when
  // bias + wDown·down + wToGo·toGo + wSpread·spread > 0.
  // Bias starts firmly negative: an untrained genome plays man, the coverage
  // the game already knows how to play.
  { key: 'scheme:bias', min: -4, max: 4, init: -2 },
  { key: 'scheme:down', min: -4, max: 4, init: 0 },
  { key: 'scheme:toGo', min: -4, max: 4, init: 0 },
  { key: 'scheme:spread', min: -4, max: 4, init: 0 },
);

export const DEFENSE_SPEC = F;
export const DEFENSE_VARIANT = '7';
```

Create `lib/game/learned/defense-genome.js` (hand-written seed; the trainer in
Task 10 overwrites it):

```js
// GENERATED by the training tools in tools/ — retrain rather than editing by hand.
// (This first version is a hand-written seed: the '7' roster's own alignment
// with a man-leaning scheme — exactly makeGenome(DEFENSE_SPEC).)
export const DEFENSE_GENOME = {
  "meta": {
    "variant": "7",
    "note": "hand-written seed: roster alignment, man-leaning scheme"
  },
  "values": {
    "pos:d-nt:across": 0, "pos:d-nt:down": 1,
    "pos:d-dt1:across": -2.5, "pos:d-dt1:down": 1,
    "pos:d-dt2:across": 2.5, "pos:d-dt2:down": 1,
    "pos:d-cb1:across": -15, "pos:d-cb1:down": 2,
    "pos:d-cb2:across": 15, "pos:d-cb2:down": 2,
    "pos:d-lb:across": 0, "pos:d-lb:down": 4,
    "pos:d-s:across": 0, "pos:d-s:down": 8,
    "zone:d-cb1:across": -12, "zone:d-cb1:depth": 4,
    "zone:d-cb2:across": 12, "zone:d-cb2:depth": 4,
    "zone:d-lb:across": 0, "zone:d-lb:depth": 3,
    "zone:d-s:across": 0, "zone:d-s:depth": 9,
    "cov:dist": 1, "cov:depth": 0, "cov:width": 0,
    "scheme:bias": -2, "scheme:down": 0, "scheme:toGo": 0, "scheme:spread": 0
  }
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/learned/defense-spec.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`.

```bash
git add lib/game/learned/defense-spec.js lib/game/learned/defense-genome.js test/game/learned/defense-spec.test.js
git commit -m "feat: the learned defense's parameter spec and seed genome"
```

---

### Task 3: Zone coverage

**Files:**
- Create: `lib/game/zone.js`
- Test: `test/game/zone.test.js`

**Interfaces:**
- Consumes: `fieldPos` (view.js); `carrier` (state.js); `maxSpeed` (modes.js);
  `interceptPoint`, `leverageAim`, `defendDir` (defense.js); `dist` (vec.js);
  `AI_THREAT_SPEED_RATIO` (constants.js).
- Produces:
  - `zoneAnchorPoint(state, team, across, depth) -> {x, y}` — a zone's home
    spot in SVG units (`across`/`depth` in yards off the LOS).
  - `zoneThreats(state, team) -> player[]` — every opposing non-carrier.
  - `zoneOrders(state, team, anchors) -> [{id, aim, cover: null}]` where
    `anchors` is `[{id, across, depth}]` — one order per anchor'd defender:
    the leveraged intercept of the deepest fast-enough threat whose nearest
    anchor is his, else his own anchor point. Never a `cover` order — a zone
    is a place, not a man.

**Zone semantics (the design in one paragraph):** each opposing non-carrier
belongs to the zone whose anchor point he is nearest (a Voronoi carve of the
field by anchor). A defender whose zone holds at least one threat he could
actually run with (the same `AI_THREAT_SPEED_RATIO` bar `assignCoverage`
uses) plays the deepest of them with the same leveraged-intercept math the
rest of the defense uses; an empty zone holds its anchor. Because membership
is recomputed from positions every time the orders are asked for (every turn,
via `ai.js`), a receiver who leaves a zone is passed off rather than chased —
which is the whole difference from man.

- [ ] **Step 1: Write the failing test**

Create `test/game/zone.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneAnchorPoint, zoneThreats, zoneOrders } from '../../lib/game/zone.js';
import { createGame, getPlayer } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';

/** The snap taken: ball in the quarterback's hands, nothing pending. */
function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

const ANCHORS = [
  { id: 'd-cb1', across: -12, depth: 4 },
  { id: 'd-s', across: 0, depth: 9 },
];

test('zoneAnchorPoint sits across/depth yards off the line, on the defended side', () => {
  const s = createGame({ seed: 1 });
  const p = zoneAnchorPoint(s, 'defense', -12, 4);
  assert.deepEqual(p, fieldPos(-12, s.losYard + 4));
});

test('zoneThreats is every opposing non-carrier', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const ids = zoneThreats(s, 'defense').map((p) => p.id).sort();
  assert.equal(ids.length, 6); // seven on offense, minus the carrier
  assert.ok(!ids.includes('o-qb'));
  assert.ok(ids.includes('o-wr1'));
});

test('an empty zone holds its anchor', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  // Sweep the whole offense far right: nobody is near cb1's left-side anchor.
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 2);
  }
  const order = zoneOrders(s, 'defense', ANCHORS).find((o) => o.id === 'd-cb1');
  assert.deepEqual(order.aim, zoneAnchorPoint(s, 'defense', -12, 4));
  assert.equal(order.cover, null);
});

test('a threat in the zone is played with leverage, not covered', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = fieldPos(-12, s.losYard + 3); // inside cb1's zone, past the line
  const order = zoneOrders(s, 'defense', ANCHORS).find((o) => o.id === 'd-cb1');
  assert.equal(order.cover, null);
  // Leverage: the aim stays on the goal side of the threat.
  assert.ok(order.aim.y >= wr.pos.y);
  // And it is no longer the bare anchor.
  assert.notDeepEqual(order.aim, zoneAnchorPoint(s, 'defense', -12, 4));
});

test('a threat belongs to the NEAREST anchor, not to every zone', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  // Park everyone far right except one deep-middle man: nearest to d-s's anchor.
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 2);
  }
  getPlayer(s, 'o-wr1').pos = fieldPos(0, s.losYard + 8);
  const orders = zoneOrders(s, 'defense', ANCHORS);
  const cb1 = orders.find((o) => o.id === 'd-cb1');
  const safety = orders.find((o) => o.id === 'd-s');
  assert.deepEqual(cb1.aim, zoneAnchorPoint(s, 'defense', -12, 4)); // his zone is empty
  assert.notDeepEqual(safety.aim, zoneAnchorPoint(s, 'defense', 0, 9)); // his is not
});

test('a lineman lumbering through a zone is not a threat worth leaving the anchor for', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 2);
  }
  getPlayer(s, 'o-lg').pos = fieldPos(-12, s.losYard + 3); // a guard, in cb1's zone
  const order = zoneOrders(s, 'defense', ANCHORS).find((o) => o.id === 'd-cb1');
  assert.deepEqual(order.aim, zoneAnchorPoint(s, 'defense', -12, 4));
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/zone.test.js`
Expected: FAIL — cannot find module `lib/game/zone.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/zone.js`:

```js
/**
 * Zone coverage: defend a place, not a man.
 *
 * A zone is an anchor point — across/depth yards off the line of scrimmage —
 * and the field is carved between the anchors by nearest-anchor: each
 * opposing non-carrier belongs to whichever zone's anchor he is closest to.
 * A defender whose zone holds a threat he could actually run with plays the
 * deepest of them, with the same leveraged-intercept math the man defense
 * uses; an empty zone holds its anchor.
 *
 * Membership is recomputed from positions every time the orders are asked
 * for, which is the whole difference from man coverage: a receiver who
 * crosses out of a zone is PASSED OFF to the next one rather than chased.
 * That is also why these are aim orders and never `cover` orders — a cover
 * order (cover.js) is a per-sub-step pursuit of one man, exactly what a
 * zone is not.
 *
 * Pure, like defense.js: reads state, returns orders, writes nothing.
 * ai.js's applyOrders is the writer.
 */
import { fieldPos } from './view.js';
import { carrier } from './state.js';
import { maxSpeed } from './modes.js';
import { interceptPoint, leverageAim, defendDir } from './defense.js';
import { dist } from './vec.js';
import { AI_THREAT_SPEED_RATIO } from './constants.js';

/** A zone's home spot: across yards from the middle, depth yards past the
 *  line on `team`'s own side. */
export function zoneAnchorPoint(state, team, across, depth) {
  return fieldPos(across, state.losYard + defendDir(team) * depth);
}

/** Who a zone might have to handle: every opposing non-carrier. The carrier
 *  is tackled, not zoned — the policy's own converge guards own him. */
export function zoneThreats(state, team) {
  const car = carrier(state);
  return state.players.filter((p) => p.team !== team && p.id !== car?.id);
}

/**
 * One order per anchor'd defender. `anchors` is [{id, across, depth}];
 * ids not on the field are skipped, so a genome tuned for one variant can be
 * asked about another without exploding.
 */
export function zoneOrders(state, team, anchors) {
  const spots = [];
  for (const a of anchors) {
    const d = state.players.find((p) => p.id === a.id);
    if (!d) continue;
    spots.push({ d, point: zoneAnchorPoint(state, team, a.across, a.depth) });
  }
  const byZone = new Map(spots.map((s) => [s.d.id, []]));
  for (const t of zoneThreats(state, team)) {
    let best = null;
    let bestD = Infinity;
    for (const s of spots) {
      const gap = dist(t.pos, s.point);
      if (gap < bestD) { best = s; bestD = gap; }
    }
    if (best) byZone.get(best.d.id).push(t);
  }
  const dir = defendDir(team);
  return spots.map(({ d, point }) => {
    const mine = byZone.get(d.id)
      .filter((t) => maxSpeed(t) >= maxSpeed(d) * AI_THREAT_SPEED_RATIO);
    if (!mine.length) return { id: d.id, aim: point, cover: null };
    const deepest = mine.reduce((a, b) => (b.pos.y * dir > a.pos.y * dir ? b : a));
    return { id: d.id, aim: leverageAim(d, interceptPoint(d, deepest), deepest), cover: null };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/zone.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`.

```bash
git add lib/game/zone.js test/game/zone.test.js
git commit -m "feat: zone coverage — defend a place, not a man"
```

---

### Task 4: The learned defense brain — scheme gate and weighted coverage

**Files:**
- Create: `lib/game/learned/defense-policy.js`
- Test: `test/game/learned/defense-policy.test.js`

**Interfaces:**
- Consumes: `carrier`, `ballPos` (state.js); `positionGroup`, `pastLine`,
  `losY`, `defendDir`, `rushLineman`, `flowLinebacker`, `deepMan`, `deepAim`,
  `interceptPoint`, `leverageAim` (defense.js); `maxSpeed` (modes.js);
  `zoneOrders` (zone.js); `dist` (vec.js); `AI_THREAT_SPEED_RATIO`
  (constants.js); `UNITS_PER_YARD_X`, `CENTRE_X`, `SIDELINE_LEFT`,
  `SIDELINE_RIGHT` (../field/geometry.js).
- Produces:
  - `schemeFeatures(state) -> {down, toGo, spread}` — each roughly in [0, 1].
  - `schemeChoice(state, genome) -> 'man' | 'zone'`.
  - `learnedCoverAssignments(state, team, genome) -> Map<defenderId,
    receiverId>` — weighted-cost greedy, with the same backer-fallback second
    pass `defense.js`'s `assignCoverage` runs.
  - `zoneAnchorsFromGenome(players, genome) -> [{id, across, depth}]`.
  - `learnedOrders(state, team, genome) -> [{id, aim, cover}]` — Task 5.
  - `genome` here and everywhere after means the flat **values** object
    (`DEFENSE_GENOME.values`), not the `{meta, values}` wrapper.

This task builds and tests the pure pieces; Task 5 adds `learnedOrders`.

- [ ] **Step 1: Write the failing test**

Create `test/game/learned/defense-policy.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schemeFeatures, schemeChoice, learnedCoverAssignments, zoneAnchorsFromGenome,
} from '../../../lib/game/learned/defense-policy.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { createGame, getPlayer } from '../../../lib/game/state.js';
import { coverAssignments } from '../../../lib/game/defense.js';
import { fieldPos } from '../../../lib/game/view.js';

function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

test('schemeFeatures normalizes down, distance and formation spread', () => {
  const s = createGame({ seed: 1 });
  const f = schemeFeatures(s);
  assert.equal(f.down, 0); // 1st down
  assert.equal(f.toGo, 1); // 10 to go
  assert.ok(f.spread > 0 && f.spread <= 1); // receivers split 30 yards
  s.down = 4;
  assert.equal(schemeFeatures(s).down, 1);
});

test('the scheme gate is a thresholded logit over those features', () => {
  const s = createGame({ seed: 1 });
  const man = { ...makeGenome(DEFENSE_SPEC) }; // bias -2, weights 0
  assert.equal(schemeChoice(s, man), 'man');
  const zone = { ...man, 'scheme:bias': 2 };
  assert.equal(schemeChoice(s, zone), 'zone');
  // A distance weight can flip the call between short and long yardage.
  const situational = { ...man, 'scheme:bias': -1, 'scheme:toGo': 4 };
  assert.equal(schemeChoice(s, situational), 'zone'); // 10 to go: toGo = 1
  s.toGoYard = s.losYard + 1; // now short yardage
  assert.equal(schemeChoice(s, situational), 'man');
});

test('with distance-only weights the learned assignment IS the rule-based one', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const g = makeGenome(DEFENSE_SPEC); // cov:dist 1, cov:depth 0, cov:width 0
  assert.deepEqual(
    learnedCoverAssignments(s, 'defense', g),
    coverAssignments(s, 'defense'),
  );
});

test('a depth weight re-prioritizes who the corner takes', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  // Left side of the field, mid-play: the back close but shallow, the
  // receiver a touch further but six yards downfield.
  getPlayer(s, 'o-rb').pos = fieldPos(-14, s.losYard - 1);
  getPlayer(s, 'o-wr1').pos = fieldPos(-15, s.losYard + 6);
  const g = makeGenome(DEFENSE_SPEC);
  const byDist = learnedCoverAssignments(s, 'defense', g);
  assert.equal(byDist.get('d-cb1'), 'o-rb'); // nearest pair wins
  const byDepth = { ...g, 'cov:depth': -2 }; // depth is a discount, not a cost
  assert.equal(learnedCoverAssignments(s, 'defense', byDepth).get('d-cb1'), 'o-wr1');
});

test('zone anchors come off the genome only for men actually on the field', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(DEFENSE_SPEC);
  const defense = s.players.filter((p) => p.team === 'defense');
  const anchors = zoneAnchorsFromGenome(defense, g);
  assert.deepEqual(
    anchors.map((a) => a.id).sort(),
    ['d-cb1', 'd-cb2', 'd-lb', 'd-s'],
  );
  const cb1 = anchors.find((a) => a.id === 'd-cb1');
  assert.equal(cb1.across, -12);
  assert.equal(cb1.depth, 4);
  // The offense has no zone keys: no anchors.
  const offense = s.players.filter((p) => p.team === 'offense');
  assert.deepEqual(zoneAnchorsFromGenome(offense, g), []);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/defense-policy.test.js`
Expected: FAIL — cannot find module `defense-policy.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/learned/defense-policy.js`:

```js
/**
 * The learned defense's brain. Same contract as defense.js: PURE — it reads
 * state (plus a genome) and returns {id, aim, cover} orders; ai.js is the
 * only writer. The structure is hand-written and the numbers are learned:
 *
 *   - a scheme gate (man vs zone) — a thresholded logit over the situation;
 *   - man assignments — the same greedy claim defense.js runs, but over a
 *     learned cost (distance, receiver depth, receiver width) instead of
 *     bare distance;
 *   - zone anchors — genome offsets handed to zone.js.
 *
 * What stays rule-based, on purpose (see the spec's design decision 7): the
 * front's rush/contain, the linebacker's mirror-and-fill, the free man's
 * deepAim, and the whole-defense convergence once the carrier is past the
 * line. The learned layer decides scheme, assignment and alignment; it does
 * not relearn how to run a pursuit angle.
 */
import { carrier, ballPos } from '../state.js';
import {
  positionGroup, pastLine, losY, defendDir, rushLineman, flowLinebacker,
  deepMan, deepAim, interceptPoint, leverageAim,
} from '../defense.js';
import { maxSpeed } from '../modes.js';
import { zoneOrders } from '../zone.js';
import { dist } from '../vec.js';
import { AI_THREAT_SPEED_RATIO } from '../constants.js';
import {
  UNITS_PER_YARD_X, CENTRE_X, SIDELINE_LEFT, SIDELINE_RIGHT,
} from '../../field/geometry.js';

/**
 * The situation, each part squashed to roughly [0,1]: which down it is, how
 * much of a fresh set of downs is still to gain, and how wide the offense is
 * standing. Coarse on purpose — a gate with three inputs can be learned from
 * a few thousand plays; one with thirty cannot.
 */
export function schemeFeatures(state) {
  const offense = state.players.filter((p) => p.team === 'offense');
  const xs = offense.map((p) => p.pos.x);
  const width = SIDELINE_RIGHT - SIDELINE_LEFT;
  return {
    down: (state.down - 1) / 3,
    toGo: Math.min(1, (state.toGoYard - state.losYard) / 10),
    spread: xs.length ? (Math.max(...xs) - Math.min(...xs)) / width : 0,
  };
}

export function schemeChoice(state, genome) {
  const f = schemeFeatures(state);
  const z = genome['scheme:bias']
    + genome['scheme:down'] * f.down
    + genome['scheme:toGo'] * f.toGo
    + genome['scheme:spread'] * f.spread;
  return z > 0 ? 'zone' : 'man';
}

/**
 * Who has whom, by learned preference. Structurally identical to
 * defense.js's assignCoverage — dedicated backs first, closest-COST pair
 * first, then one backer-fallback pass over genuine threats nobody claimed —
 * but the cost is a weighted sum in yards:
 *
 *   cost = wDist·(gap to him) + wDepth·(how deep he is) + wWidth·(how wide)
 *
 * With wDist=1 and the rest 0 the ordering is bare distance and this IS the
 * rule-based assignment (the test holds the two together). A negative wDepth
 * makes depth a discount: the deep man gets claimed first even from further
 * away, which is a preference no hand-written rule in defense.js can express.
 */
export function learnedCoverAssignments(state, team, genome) {
  const car = carrier(state);
  const free = deepMan(state, team);
  const takers = state.players.filter(
    (p) => p.team === team && positionGroup(p) === 'back' && p.id !== free?.id,
  );
  const them = state.players.filter((p) => p.team !== team && p.id !== car?.id);
  const dir = defendDir(team);
  const line = losY(state);

  const claim = (map, claimed, defenders, receivers) => {
    const pairs = [];
    for (const d of defenders) {
      for (const r of receivers) {
        if (maxSpeed(r) < maxSpeed(d) * AI_THREAT_SPEED_RATIO) continue;
        const depth = ((r.pos.y - line) * dir) / UNITS_PER_YARD_X;
        const width = Math.abs(r.pos.x - CENTRE_X) / UNITS_PER_YARD_X;
        const cost = genome['cov:dist'] * (dist(d.pos, r.pos) / UNITS_PER_YARD_X)
          + genome['cov:depth'] * depth
          + genome['cov:width'] * width;
        pairs.push({ d: d.id, r: r.id, cost });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost || a.d.localeCompare(b.d) || a.r.localeCompare(b.r));
    for (const { d, r } of pairs) {
      if (map.has(d) || claimed.has(r)) continue;
      map.set(d, r);
      claimed.add(r);
    }
    return new Set(pairs.map((p) => p.r));
  };

  const map = new Map();
  const claimed = new Set();
  const threats = claim(map, claimed, takers, them);
  const leftover = them.filter((r) => threats.has(r.id) && !claimed.has(r.id));
  if (leftover.length) {
    const backers = state.players.filter(
      (p) => p.team === team && positionGroup(p) === 'backer',
    );
    claim(map, claimed, backers, leftover);
  }
  return map;
}

/** The genome's zone anchors, for whichever of these players actually carry
 *  zone keys. Ids the genome has never met contribute nothing. */
export function zoneAnchorsFromGenome(players, genome) {
  return players
    .filter((p) => typeof genome[`zone:${p.id}:across`] === 'number')
    .map((p) => ({
      id: p.id,
      across: genome[`zone:${p.id}:across`],
      depth: genome[`zone:${p.id}:depth`],
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/learned/defense-policy.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/game/learned/defense-policy.js test/game/learned/defense-policy.test.js
git commit -m "feat: the learned defense's scheme gate and weighted coverage"
```

---

### Task 5: The learned defense brain — full order dispatch

**Files:**
- Modify: `lib/game/learned/defense-policy.js` (append `learnedOrders`)
- Test: `test/game/learned/defense-policy.test.js` (append tests)

**Interfaces:**
- Produces: `learnedOrders(state, team, genome) -> [{id, aim, cover}]` — the
  learned counterpart of `defense.js`'s `smartOrders`, consumed by `ai.js`
  (Task 6) and by the harness (Task 7). Guards mirror `smartOrder`: no ball →
  no orders; loose ball or own-team carrier → everyone at the ball; carrier
  past the line → everyone converges with leverage; otherwise line rushes,
  and the scheme gate decides whether the coverage bodies play learned man
  or genome-anchored zone.

- [ ] **Step 1: Write the failing test**

Append to `test/game/learned/defense-policy.test.js` (add `learnedOrders` to
the existing import from `defense-policy.js`, and `zoneAnchorPoint` from
`../../../lib/game/zone.js`):

```js
import { zoneAnchorPoint } from '../../../lib/game/zone.js';

test('a man-genome defense rushes its front and covers with its backs', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const g = makeGenome(DEFENSE_SPEC); // scheme:bias -2 => man
  const orders = learnedOrders(s, 'defense', g);
  const byId = new Map(orders.map((o) => [o.id, o]));
  for (const id of ['d-nt', 'd-dt1', 'd-dt2']) {
    assert.ok(byId.get(id).aim, `${id} rushes`);
    assert.equal(byId.get(id).cover, null);
  }
  const covering = orders.filter((o) => o.cover).length;
  assert.ok(covering >= 2, 'both corners have a man');
  // The free man (deepest back) plays help, not a man.
  assert.equal(byId.get('d-s').cover, null);
  assert.ok(byId.get('d-s').aim);
});

test('a zone-genome defense sends its coverage bodies to anchors, never to men', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const g = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': 4 }; // always zone
  const orders = learnedOrders(s, 'defense', g);
  const byId = new Map(orders.map((o) => [o.id, o]));
  for (const id of ['d-cb1', 'd-cb2', 'd-lb', 'd-s']) {
    assert.equal(byId.get(id).cover, null, `${id} zones, never covers`);
    assert.ok(byId.get(id).aim, `${id} has somewhere to be`);
  }
  // An empty zone's order is literally its anchor.
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 2);
  }
  const again = new Map(learnedOrders(s, 'defense', g).map((o) => [o.id, o]));
  assert.deepEqual(again.get('d-cb1').aim, zoneAnchorPoint(s, 'defense', -12, 4));
});

test('a loose ball turns every assignment into a footrace', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: null, pos: fieldPos(3, s.losYard + 2), vel: { x: 0, y: 0 } };
  s.plannedPass = null;
  const orders = learnedOrders(s, 'defense', makeGenome(DEFENSE_SPEC));
  assert.equal(orders.length, 7);
  for (const o of orders) {
    assert.equal(o.cover, null);
    assert.deepEqual(o.aim, fieldPos(3, s.losYard + 2));
  }
});

test('a carrier past the line ends the scheme: everyone converges', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  getPlayer(s, 'o-qb').pos = fieldPos(0, s.losYard + 3);
  const orders = learnedOrders(s, 'defense', makeGenome(DEFENSE_SPEC));
  assert.equal(orders.length, 7);
  for (const o of orders) {
    assert.equal(o.cover, null);
    assert.ok(o.aim, `${o.id} converges`);
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/defense-policy.test.js`
Expected: FAIL — `learnedOrders` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/game/learned/defense-policy.js`:

```js
/**
 * Every order for one team, one turn — the learned counterpart of
 * defense.js's smartOrders, and the same contract: pure, formation order,
 * ai.js writes. The guards at the top are smartOrder's own, verbatim in
 * spirit: assignments are what you play BEFORE the play breaks.
 */
export function learnedOrders(state, team, genome) {
  const bp = ballPos(state);
  if (!bp) return [];
  const mine = state.players.filter((p) => p.team === team);
  const car = carrier(state);
  if (!car || car.team === team) {
    return mine.map((p) => ({ id: p.id, aim: { ...bp }, cover: null }));
  }
  if (pastLine(state, team, car.pos)) {
    return mine.map((p) => ({
      id: p.id,
      aim: leverageAim(p, interceptPoint(p, car), car),
      cover: null,
    }));
  }

  const scheme = schemeChoice(state, genome);
  const zone = scheme === 'zone'
    ? zoneOrders(state, team, zoneAnchorsFromGenome(mine, genome))
    : [];
  const zoned = new Set(zone.map((o) => o.id));
  const man = scheme === 'man'
    ? learnedCoverAssignments(state, team, genome)
    : new Map();

  const orders = [];
  for (const p of mine) {
    if (positionGroup(p) === 'line') {
      orders.push({ id: p.id, ...rushLineman(state, p) });
      continue;
    }
    if (zoned.has(p.id)) continue; // his zone order is appended below
    const assigned = man.get(p.id);
    if (assigned) {
      orders.push({ id: p.id, aim: null, cover: assigned });
      continue;
    }
    if (positionGroup(p) === 'back') {
      orders.push({ id: p.id, aim: deepAim(state, p), cover: null });
      continue;
    }
    orders.push({ id: p.id, ...flowLinebacker(state, p) });
  }
  orders.push(...zone);
  return orders;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/learned/defense-policy.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`.

```bash
git add lib/game/learned/defense-policy.js test/game/learned/defense-policy.test.js
git commit -m "feat: learnedOrders — the learned defense's full dispatch"
```

---

### Task 6: Learned starting positions

**Files:**
- Create: `lib/game/learned/formation.js`
- Modify: `lib/game/state.js` (`createGame`)
- Modify: `lib/game/rules.js` (`nextDown`)
- Test: `test/game/learned/formation.test.js`

**Interfaces:**
- Consumes: `fieldPos` (view.js), `dist` (vec.js), `SIDELINE_LEFT`/
  `SIDELINE_RIGHT` (../field/geometry.js), `clampGenome` + `DEFENSE_SPEC` +
  `DEFENSE_GENOME`. Deliberately imports NOTHING from `state.js`,
  `defense.js` or `formation.js`, so `state.js` can import it without a
  cycle.
- Produces:
  - `learnedDefenseSpots(state, values) -> [{id, pos}]` — clamped, inbounds,
    non-overlapping spots for every defense player the genome names.
  - `applyLearnedDefenseFormation(state, values) -> boolean` — writes those
    spots (planning phase, turn 0 only), wiping each moved man's plan/cover.
  - `maybeApplyLearnedFormations(state)` — the game hook: applies the SHIPPED
    genome when `aiTeam === 'defense' && aiLevel === 'learned' && variantId
    === DEFENSE_VARIANT`. `createGame` and `nextDown` call it just before
    their `aimSnap` call. (The Offense plan extends this same function.)

- [ ] **Step 1: Write the failing test**

Create `test/game/learned/formation.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  learnedDefenseSpots, applyLearnedDefenseFormation, maybeApplyLearnedFormations,
} from '../../../lib/game/learned/formation.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { DEFENSE_GENOME } from '../../../lib/game/learned/defense-genome.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { createGame, getPlayer } from '../../../lib/game/state.js';
import { spotFault } from '../../../lib/game/formation.js';
import { fieldPos } from '../../../lib/game/view.js';
import { SIDELINE_RIGHT } from '../../../lib/field/geometry.js';
import { mulberry32 } from '../../../lib/game/rng.js';
import { mutateGenome } from '../../../lib/game/learned/genome.js';

test('a genome offset moves the man to that spot', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(DEFENSE_SPEC), 'pos:d-s:across': 5, 'pos:d-s:down': 10 };
  assert.equal(applyLearnedDefenseFormation(s, g), true);
  assert.deepEqual(getPlayer(s, 'd-s').pos, fieldPos(5, s.losYard + 10));
});

test('everything a training run can express lands legal on the board', () => {
  // Twenty heavy mutations of the seed: whatever training produces, the
  // LANDED formation must be one formation.js itself would allow — inbounds,
  // on the defense's side, nobody inside anybody. Checked after applying
  // (not spot-by-spot beforehand), because a candidate spot may legitimately
  // overlap a teammate's OLD spot when that teammate is about to move too.
  const rand = mulberry32(7);
  for (let i = 0; i < 20; i++) {
    const s = createGame({ seed: 1 });
    const g = mutateGenome(DEFENSE_SPEC, makeGenome(DEFENSE_SPEC), rand, 0.5);
    applyLearnedDefenseFormation(s, g);
    for (const p of s.players.filter((pl) => pl.team === 'defense')) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${p.id} mutation ${i}`);
    }
  }
});

test('an across value past the sideline is pulled inbounds', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(DEFENSE_SPEC), 'pos:d-cb2:across': 24 };
  applyLearnedDefenseFormation(s, g);
  const cb2 = getPlayer(s, 'd-cb2');
  assert.ok(cb2.pos.x + cb2.radius <= SIDELINE_RIGHT);
});

test('two men aimed at one spot are nudged apart, not stacked', () => {
  const s = createGame({ seed: 1 });
  const g = {
    ...makeGenome(DEFENSE_SPEC),
    'pos:d-lb:across': 0, 'pos:d-lb:down': 5,
    'pos:d-s:across': 0, 'pos:d-s:down': 5,
  };
  applyLearnedDefenseFormation(s, g);
  const lb = getPlayer(s, 'd-lb');
  const safety = getPlayer(s, 'd-s');
  const gap = Math.hypot(lb.pos.x - safety.pos.x, lb.pos.y - safety.pos.y);
  assert.ok(gap >= lb.radius + safety.radius);
});

test('it refuses once the down is running', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 1;
  assert.equal(applyLearnedDefenseFormation(s, makeGenome(DEFENSE_SPEC)), false);
});

test('createGame applies the shipped genome for a learned-level defense', () => {
  const saved = DEFENSE_GENOME.values['pos:d-s:down'];
  DEFENSE_GENOME.values['pos:d-s:down'] = 11;
  try {
    const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
    assert.deepEqual(getPlayer(s, 'd-s').pos, fieldPos(0, s.losYard + 11));
    // ...and not for the other brains, or for other teams' coaches.
    const smart = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
    assert.deepEqual(getPlayer(smart, 'd-s').pos, fieldPos(0, smart.losYard + 8));
  } finally {
    DEFENSE_GENOME.values['pos:d-s:down'] = saved;
  }
});

test('maybeApplyLearnedFormations leaves other variants alone', () => {
  const saved = DEFENSE_GENOME.values['pos:d-s:down'];
  DEFENSE_GENOME.values['pos:d-s:down'] = 11;
  try {
    const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned', variant: '11' });
    assert.deepEqual(getPlayer(s, 'd-s').pos, fieldPos(0, s.losYard + 8));
  } finally {
    DEFENSE_GENOME.values['pos:d-s:down'] = saved;
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/formation.test.js`
Expected: FAIL — cannot find module `learned/formation.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/learned/formation.js`:

```js
/**
 * Learned starting positions: where a genome says each defender stands at
 * the snap. The one mutating module in learned/ — it writes player.pos the
 * way formation.js's placeFormation does, during planning of turn 0 only.
 *
 * Deliberately imports NOTHING from state.js, defense.js or formation.js:
 * createGame (state.js) has to be able to call maybeApplyLearnedFormations,
 * so this module reaches no further than view/vec/geometry and the genome
 * files. The little legality machinery it needs — inbounds clamp, occupied-
 * spot nudge — is its own (same shape as formation.js's clearX, same
 * constants-by-value), and the tests hold every spot it produces against
 * formation.js's own spotFault so the two rulebooks cannot drift apart
 * silently.
 */
import { fieldPos } from '../view.js';
import { dist } from '../vec.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT } from '../../field/geometry.js';
import { clampGenome } from './genome.js';
import { DEFENSE_SPEC, DEFENSE_VARIANT } from './defense-spec.js';
import { DEFENSE_GENOME } from './defense-genome.js';

const NUDGE_UNITS = 1;
const NUDGE_STEPS = 200;
// Keep a deep-genome spot on the drawn field even when the line of scrimmage
// is deep in the red zone (END_YARD is 110; 108 leaves a body's clearance).
const MAX_YARD = 108;

function inbounds(x, radius) {
  return Math.max(SIDELINE_LEFT + radius, Math.min(SIDELINE_RIGHT - radius, x));
}

/** The nearest clear x to `want` at depth `y` — formation.js's clearX,
 *  re-kept here (see the module comment for why it cannot be imported). */
function clearX(placed, want, y, radius) {
  for (let k = 0; k <= NUDGE_STEPS; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const x = inbounds(want + sign * k * NUDGE_UNITS, radius);
      if (!placed.some((q) => dist(q.pos, { x, y }) < q.radius + radius)) return x;
    }
  }
  return inbounds(want, radius);
}

/**
 * The genome's spots for this defense, clamped legal: on the defense's own
 * side (the spec's own down >= 0.5 floor), on the drawn field, inside the
 * sidelines, clear of everyone already standing — the offense as it is, and
 * teammates as they are placed. Ids the genome does not name keep their
 * roster spot (they are simply absent from the result).
 */
export function learnedDefenseSpots(state, values) {
  const g = clampGenome(DEFENSE_SPEC, values);
  const placed = state.players
    .filter((p) => p.team !== 'defense')
    .map((p) => ({ radius: p.radius, pos: p.pos }));
  const spots = [];
  for (const p of state.players) {
    if (p.team !== 'defense') continue;
    const across = g[`pos:${p.id}:across`];
    if (typeof across !== 'number') continue;
    const down = Math.min(g[`pos:${p.id}:down`], MAX_YARD - state.losYard);
    const want = fieldPos(across, state.losYard + down);
    const x = clearX(placed, want.x, want.y, p.radius);
    const pos = { x, y: want.y };
    placed.push({ radius: p.radius, pos });
    spots.push({ id: p.id, pos });
  }
  return spots;
}

/**
 * Write the genome's formation onto the board. A formation is what you come
 * to the line with, so this is gated exactly as placePlayer is: planning
 * phase, turn 0, and never after. A moved man's plan and cover are wiped —
 * an order worked out from where he used to stand is a lie now, the same
 * rule placeFormation keeps.
 */
export function applyLearnedDefenseFormation(state, values) {
  if (state.phase !== 'planning' || state.turnIndex !== 0) return false;
  for (const { id, pos } of learnedDefenseSpots(state, values)) {
    const p = state.players.find((pl) => pl.id === id);
    p.pos = pos;
    p.plan = null;
    p.cover = null;
  }
  return true;
}

/**
 * The game hook createGame and nextDown call at the top of every down: if
 * the computer is coaching a learned-level team in the variant its genome
 * was trained for, its formation goes on the board — visibly, during
 * planning, exactly as the roster's own alignment does. The human gets to
 * see it and answer it; only the computer's IN-PLAY intentions are hidden
 * (ai.js's whole design), not where its men are standing.
 */
export function maybeApplyLearnedFormations(state) {
  if (state.aiTeam === 'defense' && state.aiLevel === 'learned'
    && state.variantId === DEFENSE_VARIANT) {
    applyLearnedDefenseFormation(state, DEFENSE_GENOME.values);
  }
}
```

Modify `lib/game/state.js` — add the import (with the other imports at the
top):

```js
import { maybeApplyLearnedFormations } from './learned/formation.js';
```

and in `createGame`, replace the two closing lines

```js
  aimSnap(state);
  return state;
```

with:

```js
  // A learned-level computer stands its own formation before the snap is
  // aimed, so the aim is taken from the spots everyone will actually occupy.
  maybeApplyLearnedFormations(state);
  aimSnap(state);
  return state;
```

Modify `lib/game/rules.js` — add the import:

```js
import { maybeApplyLearnedFormations } from './learned/formation.js';
```

and at the end of `nextDown`, replace

```js
  // Everyone is back in formation with the ball on the centre, so the down
  // comes up ready to snap, the same as the first one did.
  aimSnap(state);
```

with:

```js
  // Everyone is back in formation with the ball on the centre, so the down
  // comes up ready to snap, the same as the first one did. A learned-level
  // computer stands its own formation first, before the snap is aimed.
  maybeApplyLearnedFormations(state);
  aimSnap(state);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/learned/formation.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test` — in particular `state.test.js` and `rules.test.js` must
still pass untouched (the hook is a no-op for every existing aiLevel).

```bash
git add lib/game/learned/formation.js lib/game/state.js lib/game/rules.js test/game/learned/formation.test.js
git commit -m "feat: learned starting positions for the computer defense"
```

---

### Task 7: Wire the learned brain into ai.js and the mode cycle

**Files:**
- Modify: `lib/game/ai.js`
- Modify: `test/game/ai.test.js` (the mode-cycle test)
- Test: `test/game/ai-learned.test.js` (new)

**Interfaces:**
- Produces (all in `ai.js`):
  - `applyOrders(state, orders)` — the one writer of `{id, aim, cover}`
    orders (extracted from `coachSmartDefense`; the harness reuses it).
  - `aiPlayers(state, team = state.aiTeam)` and
    `applyAiModes(state, team = state.aiTeam)` — same behavior by default;
    an explicit team lets the hot-seat harness use them.
  - `coachLearnedDefense(state)` — applies `learnedOrders` with the shipped
    genome; dispatched by `coachAi` when `aiLevel === 'learned'`.
  - `AI_MODES` gains `{ai: 'defense', level: 'learned', ...}` at index 1;
    `aiModeIndex` generalized to find the entry by `(ai, level)` with
    hot-seat still the last entry.

- [ ] **Step 1: Write the failing tests**

Create `test/game/ai-learned.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coachAi, coachLearnedDefense, applyOrders, aiPlayers, applyAiModes, clearAiPlans,
} from '../../lib/game/ai.js';
import { createGame, getPlayer, setPlan } from '../../lib/game/state.js';
import { runTurn } from '../../lib/game/turn.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { fieldPos } from '../../lib/game/view.js';

function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

test('applyOrders writes plans and covers exactly as coachSmartDefense did', () => {
  const s = afterSnap(createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' }));
  applyOrders(s, [
    { id: 'd-nt', aim: fieldPos(0, s.losYard - 2), cover: null },
    { id: 'd-cb1', aim: null, cover: 'o-wr1' },
  ]);
  assert.ok(getPlayer(s, 'd-nt').plan);
  assert.equal(getPlayer(s, 'd-nt').cover, null);
  assert.equal(getPlayer(s, 'd-cb1').cover, 'o-wr1');
});

test('aiPlayers and applyAiModes take an explicit team for hot-seat harnesses', () => {
  const s = afterSnap(createGame({ seed: 1 })); // hot-seat: aiTeam null
  assert.equal(aiPlayers(s).length, 0);
  assert.equal(aiPlayers(s, 'defense').length, 7);
  // Park the nose tackle on the carrier: an explicit-team call breaks him down.
  getPlayer(s, 'd-nt').pos = fieldPos(0, s.losYard - 3);
  applyAiModes(s, 'defense');
  assert.equal(getPlayer(s, 'd-nt').mode, 'prepared');
});

test('coachAi dispatches the learned brain', () => {
  const s = afterSnap(createGame({ seed: 3, ai: 'defense', aiLevel: 'learned' }));
  coachAi(s);
  assert.ok(getPlayer(s, 'd-nt').plan, 'the front rushes');
  const covering = s.players.filter((p) => p.team === 'defense' && p.cover).length;
  assert.ok(covering >= 1, 'the seed genome plays man');
  clearAiPlans(s);
});

test('a learned-level game runs whole turns without incident', () => {
  const s = createGame({ seed: 7, ai: 'defense', aiLevel: 'learned' });
  const random = mulberry32(7);
  const before = new Map(
    s.players.filter((p) => p.team === 'defense').map((p) => [p.id, { ...p.pos }]),
  );
  // Give the offense something to do so the play is a play.
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  runTurn(s, random);
  assert.ok(['planning', 'playOver'].includes(s.phase));
  const moved = s.players.filter((p) => p.team === 'defense'
    && (p.pos.x !== before.get(p.id).x || p.pos.y !== before.get(p.id).y));
  assert.ok(moved.length > 0, 'the coached defense actually plays');
});
```

Then update the mode-cycle test in `test/game/ai.test.js`: replace the body
of the existing cycle test (the one that steps `nextAiMode` and asserts
labels — it currently expects `AI_MODES[0]` smart, then basic, then
hot-seat) with:

```js
test('the Defense button cycles smart -> learned -> basic -> hot-seat and back', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  assert.equal(aiModeIndex(s), 0);
  assert.equal(AI_MODES[0].label, 'Defense: computer (smart)');

  let next = nextAiMode(s);
  s.aiTeam = next.ai;
  s.aiLevel = next.level;
  assert.equal(AI_MODES[aiModeIndex(s)].label, 'Defense: computer (learned)');

  next = nextAiMode(s);
  s.aiTeam = next.ai;
  s.aiLevel = next.level;
  assert.equal(AI_MODES[aiModeIndex(s)].label, 'Defense: computer (basic)');

  next = nextAiMode(s);
  s.aiTeam = next.ai;
  s.aiLevel = next.level;
  assert.equal(AI_MODES[aiModeIndex(s)].label, 'Defense: you');

  // Hot-seat is hot-seat whatever level it is carrying.
  s.aiLevel = 'learned';
  assert.equal(AI_MODES[aiModeIndex(s)].label, 'Defense: you');

  next = nextAiMode(s);
  s.aiTeam = next.ai;
  s.aiLevel = next.level;
  assert.equal(AI_MODES[aiModeIndex(s)].label, 'Defense: computer (smart)');
});
```

(Keep the rest of `ai.test.js` untouched. If other assertions in that file
hard-code `AI_MODES.length` or entry indexes, update them to match the
four-entry cycle.)

- [ ] **Step 2: Run to make sure the new tests fail**

Run: `node --test test/game/ai-learned.test.js test/game/ai.test.js`
Expected: FAIL — `applyOrders`/`coachLearnedDefense` not exported; cycle test
finds no learned entry.

- [ ] **Step 3: Write the implementation**

Modify `lib/game/ai.js`:

Add the imports:

```js
import { learnedOrders } from './learned/defense-policy.js';
import { DEFENSE_GENOME } from './learned/defense-genome.js';
```

Give `aiPlayers` and `applyAiModes` their team parameter (same defaults, same
behavior for every existing caller):

```js
/** The players the computer coaches — nobody at all in hot-seat games.
 *  An explicit `team` lets a hot-seat training harness borrow the machinery. */
export function aiPlayers(state, team = state.aiTeam) {
  if (!team) return [];
  return state.players.filter((p) => p.team === team);
}
```

and in `applyAiModes`, change the signature and the two team reads:

```js
export function applyAiModes(state, team = state.aiTeam) {
  const car = carrier(state);
  const chasing = car !== null && car.team !== team;
  for (const p of aiPlayers(state, team)) {
    const close = chasing && len(sub(car.pos, p.pos)) <= AI_BREAKDOWN_UNITS;
    const want = close ? 'prepared' : 'normal';
    if (p.mode !== want) setMode(state, p.id, want);
  }
}
```

Extract `applyOrders` and rewrite `coachSmartDefense` over it, then add the
learned coach:

```js
/**
 * The one writer of {id, aim, cover} orders, whoever computed them. Cover
 * orders go through cover.js's setCover, so the computer's man coverage IS
 * the human's cover order; everything else becomes an ordinary full-throttle
 * plan pointed at the order's aim. clearCover runs on anyone not covering —
 * a stale assignment from last turn must not keep steering a man this turn.
 */
export function applyOrders(state, orders) {
  for (const { id, aim, cover } of orders) {
    if (cover) { setCover(state, id, cover); continue; }
    clearCover(state, id);
    if (!aim) continue;
    const to = sub(aim, getPlayer(state, id).pos);
    if (len(to) === 0) continue; // standing on the aim point: no direction to run
    setPlan(state, id, norm(to), 1);
  }
}

/** The assignment brain's orders, written into `state`. */
export function coachSmartDefense(state) {
  applyOrders(state, smartOrders(state, state.aiTeam));
}

/** The learned brain's orders — the shipped genome's, written into `state`. */
export function coachLearnedDefense(state) {
  applyOrders(state, learnedOrders(state, state.aiTeam, DEFENSE_GENOME.values));
}
```

Update `coachAi`:

```js
/** Everything the computer decides for one turn, written into `state`. */
export function coachAi(state) {
  if (!state.aiTeam) return;
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

Insert the learned entry into `AI_MODES` at index 1 (after smart, before
basic; hot-seat stays last):

```js
  {
    ai: 'defense',
    level: 'learned',
    label: 'Defense: computer (learned)',
    note: 'The computer plays its trained defense: a learned formation, learned man/zone scheme calls, and learned coverage matchups.',
  },
```

Generalize `aiModeIndex` (hot-seat first, then find by pair):

```js
/**
 * Which setting the state is in. Hot-seat is hot-seat whatever `aiLevel` it
 * is carrying, so that stepping out to hot-seat and back returns you to the
 * brain you were playing. Any (team, level) pair no entry names — an old
 * save, a test's hand-rolled state — reads as the first entry rather than
 * crashing the button.
 */
export function aiModeIndex(state) {
  if (!state.aiTeam) return AI_MODES.length - 1;
  const i = AI_MODES.findIndex(
    (m) => m.ai === state.aiTeam && m.level === state.aiLevel,
  );
  return i === -1 ? 0 : i;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/game/ai-learned.test.js test/game/ai.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test` — `turn.test.js` and `integration.test.js` exercise `coachAi`
and must stay green (no behavior change for smart/pursuit levels). The app
needs no change: `app/main.js` renders and cycles `AI_MODES` data-driven.

```bash
git add lib/game/ai.js test/game/ai.test.js test/game/ai-learned.test.js
git commit -m "feat: aiLevel 'learned' — the trained defense as a selectable mode"
```

---

### Task 8: The training harness

**Files:**
- Create: `tools/harness.js`
- Test: `test/tools/harness.test.js`

**Interfaces:**
- Consumes: `createGame`, `formationPlayers`, `aimSnap`, `ballPos`,
  `SNAPPER_ID` (state.js); `runTurn` (turn.js); `nextDown` is NOT used — a
  play is scored before the between-downs bookkeeping; `yardsOfY`,
  `GOAL_YARD` (view.js); `mulberry32` (rng.js); `applyOrders`, `applyAiModes`
  (ai.js); `learnedOrders` (learned/defense-policy.js);
  `applyLearnedDefenseFormation` (learned/formation.js); `autoplanOffense`
  (offense.js); `FIRST_DOWN_YARDS` (constants.js).
- Produces:
  - `MAX_TURNS_PER_PLAY = 24` — the stalemate guard.
  - `scenario(rand, variant = '7') -> state` — a fresh hot-seat down:
    random down 1–4, random spot (yards 15–80), random distance (1–10,
    goal-clamped).
  - `playOnePlay(state, offenseCoach, defenseCoach, random) ->
    {yards, deadReason, touchdown, turnover, events}` — coaches are
    `(state) => void`, called every planning phase.
  - `defenseCoach(values) -> (state) => void` — learned-formation at turn 0,
    breakdown modes, `learnedOrders` applied.
  - `scriptedOffenseCoach(state)` — the interim opponent: `autoplanOffense`.
  - `evaluateDefense(values, {plays, seed, offenseCoach}) ->
    {yardsPerPlay, touchdownRate, turnoverRate}` — deterministic for a seed.

- [ ] **Step 1: Write the failing test**

Create `test/tools/harness.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TURNS_PER_PLAY, scenario, playOnePlay, defenseCoach,
  scriptedOffenseCoach, evaluateDefense,
} from '../../tools/harness.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { makeGenome } from '../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';

test('scenario deals a plannable hot-seat down inside the field', () => {
  const rand = mulberry32(11);
  for (let i = 0; i < 10; i++) {
    const s = scenario(rand);
    assert.equal(s.phase, 'planning');
    assert.equal(s.turnIndex, 0);
    assert.equal(s.aiTeam, null);
    assert.ok(s.down >= 1 && s.down <= 4);
    assert.ok(s.losYard >= 15 && s.losYard <= 80);
    assert.ok(s.toGoYard > s.losYard && s.toGoYard <= 100);
    assert.ok(s.plannedPass, 'the snap is aimed');
  }
});

test('playOnePlay runs to a whistle (or the cap) and reports the yardage', () => {
  const genome = makeGenome(DEFENSE_SPEC);
  const s = scenario(mulberry32(2));
  const r = playOnePlay(s, scriptedOffenseCoach, defenseCoach(genome), mulberry32(3));
  assert.ok(Number.isFinite(r.yards));
  assert.ok(s.turnIndex <= MAX_TURNS_PER_PLAY);
  assert.ok(s.phase === 'playOver' || s.turnIndex === MAX_TURNS_PER_PLAY);
  assert.equal(typeof r.touchdown, 'boolean');
  assert.equal(typeof r.turnover, 'boolean');
  assert.ok(Array.isArray(r.events));
});

test('a play is deterministic for its seeds', () => {
  const genome = makeGenome(DEFENSE_SPEC);
  const run = () => {
    const s = scenario(mulberry32(4));
    return playOnePlay(s, scriptedOffenseCoach, defenseCoach(genome), mulberry32(5));
  };
  assert.deepEqual(run(), run());
});

test('evaluateDefense aggregates deterministically', () => {
  const g = makeGenome(DEFENSE_SPEC);
  const a = evaluateDefense(g, { plays: 3, seed: 5 });
  const b = evaluateDefense(g, { plays: 3, seed: 5 });
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.yardsPerPlay));
  assert.ok(a.touchdownRate >= 0 && a.touchdownRate <= 1);
  assert.ok(a.turnoverRate >= 0 && a.turnoverRate <= 1);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/tools/harness.test.js`
Expected: FAIL — cannot find module `tools/harness.js`.

- [ ] **Step 3: Write the implementation**

Create `tools/harness.js`:

```js
/**
 * The training harness: deal a random down, let two coach functions plan
 * both teams hot-seat, run the engine to the whistle, score the play.
 *
 * Everything is seeded (mulberry32) and nothing here rolls its own dice, so
 * a fitness evaluation is exactly reproducible — and two candidate genomes
 * evaluated with the same seed see the SAME downs and the same tackle rolls,
 * which is what makes their fitnesses comparable (common random numbers).
 *
 * Runs hot-seat (aiTeam null) on purpose: runTurn's own coachAi stays inert
 * and the harness is the only coach of either side, so training needs no
 * half-real game mode. Node-only; lib/ must never import from here.
 */
import {
  createGame, formationPlayers, aimSnap, ballPos, SNAPPER_ID,
} from '../lib/game/state.js';
import { runTurn } from '../lib/game/turn.js';
import { yardsOfY, GOAL_YARD } from '../lib/game/view.js';
import { mulberry32 } from '../lib/game/rng.js';
import { applyOrders, applyAiModes } from '../lib/game/ai.js';
import { learnedOrders } from '../lib/game/learned/defense-policy.js';
import { applyLearnedDefenseFormation } from '../lib/game/learned/formation.js';
import { autoplanOffense } from '../lib/game/offense.js';
import { FIRST_DOWN_YARDS } from '../lib/game/constants.js';

/** A play that has not died by now never will (both sides re-plan every
 *  turn); call it over and score the ball where it lies. */
export const MAX_TURNS_PER_PLAY = 24;

/**
 * A fresh down somewhere a real drive could be: random down, random spot
 * (never so deep that MIN_SPOT_YARD clamping kicks in, never inside the 20),
 * random distance. Randomizing the situation is what gives the scheme gate's
 * down/toGo features something to learn from.
 */
export function scenario(rand, variant = '7') {
  const state = createGame({ seed: 1 + Math.floor(rand() * 2 ** 30), variant });
  state.down = 1 + Math.floor(rand() * 4);
  state.losYard = 15 + Math.floor(rand() * 66); // 15..80
  state.toGoYard = Math.min(
    state.losYard + 1 + Math.floor(rand() * FIRST_DOWN_YARDS), GOAL_YARD,
  );
  state.players = formationPlayers(state.losYard, variant);
  state.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  state.plannedPass = null;
  aimSnap(state);
  return state;
}

/**
 * One play, start to whistle. The coaches are (state) => void and are called
 * every planning phase, offense first (the human plans first in spirit; the
 * defense answers). Yards are the ball's final yard against the opening line
 * of scrimmage — zero for an incompletion, exactly as nextDown spots it.
 */
export function playOnePlay(state, offenseCoach, defenseCoach, random) {
  const startLos = state.losYard;
  const events = [];
  for (let t = 0; t < MAX_TURNS_PER_PLAY && state.phase !== 'playOver'; t++) {
    offenseCoach(state);
    defenseCoach(state);
    events.push(...runTurn(state, random).events);
  }
  const bp = ballPos(state);
  const yards = state.deadReason === 'incomplete' || !bp
    ? 0
    : yardsOfY(bp.y) - startLos;
  return {
    yards,
    deadReason: state.deadReason,
    touchdown: state.deadReason === 'touchdown',
    turnover: state.deadReason === 'recovered',
    events,
  };
}

/**
 * The learned defense as a coach function: its genome's formation at the top
 * of the down, the breakdown stance near the carrier (the same modes coachAi
 * applies), and learnedOrders every turn.
 */
export function defenseCoach(values) {
  return (state) => {
    if (state.turnIndex === 0 && state.phase === 'planning') {
      applyLearnedDefenseFormation(state, values);
    }
    applyAiModes(state, 'defense');
    applyOrders(state, learnedOrders(state, 'defense', values));
  };
}

/**
 * The interim opponent: the scripted QB run option (offense.js). The Offense
 * plan replaces this with the co-evolving learned offense; until then it is
 * the strongest offense the codebase can field without a human.
 */
export function scriptedOffenseCoach(state) {
  autoplanOffense(state);
}

/** Mean per-play stats for one defense genome over `plays` seeded scenarios. */
export function evaluateDefense(values, { plays, seed, offenseCoach = scriptedOffenseCoach }) {
  const rand = mulberry32(seed);
  const coach = defenseCoach(values);
  let yards = 0;
  let touchdowns = 0;
  let turnovers = 0;
  for (let i = 0; i < plays; i++) {
    const state = scenario(rand);
    const result = playOnePlay(
      state, offenseCoach, coach, mulberry32(1 + Math.floor(rand() * 2 ** 30)),
    );
    yards += result.yards;
    if (result.touchdown) touchdowns += 1;
    if (result.turnover) turnovers += 1;
  }
  return {
    yardsPerPlay: yards / plays,
    touchdownRate: touchdowns / plays,
    turnoverRate: turnovers / plays,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/tools/harness.test.js`
Expected: PASS (4 tests). These tests simulate real plays, so allow a few
seconds.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`.

```bash
git add tools/harness.js test/tools/harness.test.js
git commit -m "feat: the self-play training harness"
```

---

### Task 9: The evolution loop

**Files:**
- Create: `tools/evolve.js`
- Test: `test/tools/evolve.test.js`

**Interfaces:**
- Consumes: `mulberry32` (rng.js); `clampGenome`, `mutateGenome`
  (learned/genome.js).
- Produces: `evolve({spec, fitness, seedGenome, popSize, generations, elite,
  sigma, seed, onGeneration}) -> {best, score, history}` where `fitness` is
  `(genome, generationIndex) => number` (bigger is better), `best` is the
  best genome ever scored, `score` its fitness, `history` the per-generation
  champion scores. `onGeneration(gen, scored)` is optional progress
  reporting; `scored` arrives sorted best-first. `generations` must be ≥ 1.

- [ ] **Step 1: Write the failing test**

Create `test/tools/evolve.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evolve } from '../../tools/evolve.js';

const SPEC = [{ key: 'a', min: 0, max: 1, init: 0 }];
const peakAt = (target) => (g) => -((g.a - target) ** 2);

test('evolve climbs a one-dimensional hill', () => {
  const { best, score, history } = evolve({
    spec: SPEC,
    fitness: peakAt(0.7),
    popSize: 12,
    generations: 25,
    elite: 3,
    sigma: 0.15,
    seed: 4,
  });
  assert.ok(Math.abs(best.a - 0.7) < 0.1, `got ${best.a}`);
  assert.ok(score > -0.01);
  assert.equal(history.length, 25);
  // Champions never get worse than the first generation's.
  assert.ok(history[history.length - 1] >= history[0]);
});

test('evolve is deterministic for a seed', () => {
  const opts = {
    spec: SPEC, fitness: peakAt(0.3), popSize: 8, generations: 5,
    elite: 2, sigma: 0.2, seed: 9,
  };
  assert.deepEqual(evolve(opts), evolve(opts));
});

test("a seed genome is generation zero's starting point", () => {
  const seen = [];
  evolve({
    spec: SPEC,
    seedGenome: { a: 0.9 },
    fitness: (g) => { seen.push(g.a); return 0; },
    popSize: 4, generations: 1, elite: 1, sigma: 0.01, seed: 2,
  });
  assert.equal(seen[0], 0.9); // the seed itself is candidate one
  for (const a of seen.slice(1)) assert.ok(Math.abs(a - 0.9) < 0.2);
});

test('onGeneration sees the scored population, best first', () => {
  let calls = 0;
  evolve({
    spec: SPEC,
    fitness: peakAt(0.5),
    popSize: 6, generations: 3, elite: 2, sigma: 0.2, seed: 1,
    onGeneration: (gen, scored) => {
      calls += 1;
      assert.equal(scored.length, 6);
      for (let i = 1; i < scored.length; i++) {
        assert.ok(scored[i - 1].score >= scored[i].score);
      }
    },
  });
  assert.equal(calls, 3);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/tools/evolve.test.js`
Expected: FAIL — cannot find module `tools/evolve.js`.

- [ ] **Step 3: Write the implementation**

Create `tools/evolve.js`:

```js
/**
 * A small elitist (mu+lambda) evolution loop over genome objects. Nothing in
 * it knows about football: it takes a spec, a fitness function and a seed,
 * and hill-climbs. Selection keeps the top `elite`, refill mutates random
 * elites, and the whole walk is deterministic from `seed`.
 *
 * Fitness receives (genome, generationIndex) so the caller can key common
 * random numbers to the generation: every candidate within one generation
 * should be scored on the same simulated downs, or selection is choosing
 * lucky schedules rather than good genomes.
 */
import { mulberry32 } from '../lib/game/rng.js';
import { clampGenome, mutateGenome } from '../lib/game/learned/genome.js';

export function evolve({
  spec, fitness, seedGenome = null,
  popSize = 16, generations = 20, elite = 4, sigma = 0.08, seed = 1,
  onGeneration = null,
}) {
  const rand = mulberry32(seed);
  const base = clampGenome(spec, seedGenome);
  let pop = [base];
  while (pop.length < popSize) pop.push(mutateGenome(spec, base, rand, sigma));

  let best = null;
  const history = [];
  for (let g = 0; g < generations; g++) {
    const scored = pop
      .map((genome) => ({ genome, score: fitness(genome, g) }))
      .sort((a, b) => b.score - a.score);
    if (!best || scored[0].score > best.score) best = scored[0];
    history.push(scored[0].score);
    if (onGeneration) onGeneration(g, scored);

    const parents = scored.slice(0, elite).map((s) => s.genome);
    pop = [...parents];
    while (pop.length < popSize) {
      const parent = parents[Math.floor(rand() * parents.length)];
      pop.push(mutateGenome(spec, parent, rand, sigma));
    }
  }
  return { best: best.genome, score: best.score, history };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/tools/evolve.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/evolve.js test/tools/evolve.test.js
git commit -m "feat: a seeded elitist evolution loop"
```

---

### Task 10: The defense trainer — CLI, first real training run, shipped genome

**Files:**
- Create: `tools/train-defense.js`
- Modify: `package.json` (npm script)
- Modify: `lib/game/learned/defense-genome.js` (overwritten by the trainer)
- Modify: `README.md` (a short "Training the learned AI" section)
- Test: `test/tools/train-defense.test.js`

**Interfaces:**
- Produces:
  - `defenseFitness(stats) -> number` — `-yardsPerPlay +
    TURNOVER_BONUS_YARDS·turnoverRate - TOUCHDOWN_PENALTY_YARDS·
    touchdownRate` with `TURNOVER_BONUS_YARDS = 8`,
    `TOUCHDOWN_PENALTY_YARDS = 10` (both exported; the Offense plan's
    co-evolution reuses `defenseFitness`).
  - `trainDefense({generations, popSize, plays, seed, sigma}) ->
    {best, score, history}` — evolve over `DEFENSE_SPEC` from the shipped
    genome, common-random-numbered per generation.
  - CLI: `node tools/train-defense.js --generations 30 --pop 16 --plays 24
    --seed 1 --sigma 0.08` — prints per-generation champions and overwrites
    `lib/game/learned/defense-genome.js`. The CLI body is guarded so
    importing the module runs nothing.

- [ ] **Step 1: Write the failing test**

Create `test/tools/train-defense.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defenseFitness, trainDefense, TURNOVER_BONUS_YARDS, TOUCHDOWN_PENALTY_YARDS,
} from '../../tools/train-defense.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';

test('defenseFitness prices yards against, turnovers for, touchdowns against', () => {
  const base = { yardsPerPlay: 3, turnoverRate: 0, touchdownRate: 0 };
  assert.ok(defenseFitness({ ...base, yardsPerPlay: 2 }) > defenseFitness(base));
  assert.ok(defenseFitness({ ...base, turnoverRate: 0.5 }) > defenseFitness(base));
  assert.ok(defenseFitness({ ...base, touchdownRate: 0.5 }) < defenseFitness(base));
  assert.equal(
    defenseFitness({ yardsPerPlay: 4, turnoverRate: 0.25, touchdownRate: 0.1 }),
    -4 + TURNOVER_BONUS_YARDS * 0.25 - TOUCHDOWN_PENALTY_YARDS * 0.1,
  );
});

test('trainDefense runs a tiny evolution end to end, deterministically', () => {
  const opts = { generations: 1, popSize: 3, plays: 2, seed: 9, sigma: 0.05 };
  const a = trainDefense(opts);
  const b = trainDefense(opts);
  assert.deepEqual(a.best, b.best);
  assert.equal(a.score, b.score);
  for (const p of DEFENSE_SPEC) {
    assert.equal(typeof a.best[p.key], 'number', p.key);
  }
});

test('importing the trainer runs no training and writes no files', () => {
  // The import at the top of this file already proved it: if the CLI body
  // ran on import, the suite would train for minutes and rewrite the genome.
  assert.ok(true);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/tools/train-defense.test.js`
Expected: FAIL — cannot find module `tools/train-defense.js`.

- [ ] **Step 3: Write the implementation**

Create `tools/train-defense.js`:

```js
/**
 * Train the defense genome against the scripted offense and write the result
 * into lib/game/learned/defense-genome.js, where the game imports it.
 *
 * Usage:
 *   node tools/train-defense.js --generations 30 --pop 16 --plays 24 --seed 1
 *
 * The opponent here is offense.js's scripted autoplan — a bootstrap, not the
 * end state. The Offense plan's tools/train-coevolve.js retrains this genome
 * against the LEARNED offense, population against population; keep using
 * that once it exists.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DEFENSE_SPEC } from '../lib/game/learned/defense-spec.js';
import { DEFENSE_GENOME } from '../lib/game/learned/defense-genome.js';
import { genomeModuleSource } from '../lib/game/learned/genome.js';
import { evolve } from './evolve.js';
import { evaluateDefense } from './harness.js';

// A turnover is worth about a possession's field position; a touchdown given
// up costs more than any one play's yardage. Both in "yards" so the three
// terms share a scale.
export const TURNOVER_BONUS_YARDS = 8;
export const TOUCHDOWN_PENALTY_YARDS = 10;

export function defenseFitness(stats) {
  return -stats.yardsPerPlay
    + TURNOVER_BONUS_YARDS * stats.turnoverRate
    - TOUCHDOWN_PENALTY_YARDS * stats.touchdownRate;
}

export function trainDefense({ generations, popSize, plays, seed, sigma }) {
  return evolve({
    spec: DEFENSE_SPEC,
    seedGenome: DEFENSE_GENOME.values,
    popSize,
    generations,
    sigma,
    seed,
    // Common random numbers: every candidate in generation g sees the same
    // downs and the same dice, so their scores actually compare.
    fitness: (genome, gen) =>
      defenseFitness(evaluateDefense(genome, { plays, seed: seed * 1000003 + gen })),
    onGeneration: (gen, scored) =>
      console.log(`gen ${gen}: champion ${scored[0].score.toFixed(3)}`),
  });
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

// CLI body — guarded so importing this module (tests, the co-evolution
// trainer) runs nothing and writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = {
    generations: arg('generations', 30),
    popSize: arg('pop', 16),
    plays: arg('plays', 24),
    seed: arg('seed', 1),
    sigma: arg('sigma', 0.08),
  };
  console.log('training defense vs the scripted offense:', opts);
  const { best, score } = trainDefense(opts);
  console.log(`champion fitness ${score.toFixed(3)} — writing defense-genome.js`);
  writeFileSync(
    new URL('../lib/game/learned/defense-genome.js', import.meta.url),
    genomeModuleSource('DEFENSE_GENOME', best, {
      variant: '7',
      trainedBy: 'tools/train-defense.js',
      opponent: 'scripted autoplanOffense',
      options: opts,
      fitness: score,
    }),
  );
}
```

Modify `package.json` — add to `scripts`:

```json
    "train:defense": "node tools/train-defense.js"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/tools/train-defense.test.js`
Expected: PASS (3 tests; the tiny training run takes a few seconds).

- [ ] **Step 5: Run the first real training and ship the genome**

Run:

```bash
node tools/train-defense.js --generations 25 --pop 14 --plays 20 --seed 1
```

Watch the per-generation champion fitness: it should be no worse than
generation 0's and typically improve by a yard or more per play. Then verify
the generated module is healthy:

Run: `npm test`
Expected: ALL PASS — in particular `defense-spec.test.js`'s "shipped genome is
already clamped" test now guards the *trained* file, and every game-side test
still passes with the new numbers (no game test may depend on the genome's
specific values — if one does, it was written wrong; fix the test to use an
explicit genome).

- [ ] **Step 6: Document how to train**

Add to `README.md`, after the "Running it" section:

```markdown
## Training the learned AI

The `Defense: computer (learned)` level plays a trained genome shipped in
`lib/game/learned/defense-genome.js`. To retrain it:

    npm run train:defense -- --generations 30 --pop 16 --plays 24 --seed 1

Training is a seeded evolutionary search over the genome's ~30 parameters
(starting spots, man/zone scheme gate, coverage weights), simulating whole
plays headlessly through the same engine the browser runs. It is fully
deterministic for a seed and writes its champion back into the genome module,
which is committed like any other source file.
```

- [ ] **Step 7: Commit**

```bash
git add tools/train-defense.js test/tools/train-defense.test.js package.json lib/game/learned/defense-genome.js README.md
git commit -m "feat: defense trainer CLI, first trained genome"
```

---

## Verification checklist (whole plan)

- `npm test` green from a clean checkout.
- `npm run serve`, open the game, cycle the Defense button: the
  `Defense: computer (learned)` mode appears between smart and basic, the
  learned formation is visibly on the board at the snap, and plays run
  normally (turn, whistle, next down) with no console errors.
- `npm run train:defense -- --generations 2 --pop 4 --plays 4 --seed 3`
  completes in well under a minute and rewrites
  `lib/game/learned/defense-genome.js` with a loadable module.
