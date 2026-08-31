# The Learned Defense Answers the Formation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the learned computer defense change its personnel package and slide its men to answer the offensive formation, every time the offense changes it.

**Architecture:** The genome's fixed spots become a *base look*; a new pull, learned per position group, moves each man from there toward the answer `alignDefense` would give the offense's current look, and a second learned decision subs stacked/nickel/dime before any of that. All of it lives in `lib/game/formation.js` beside `alignDefense` — `lib/game/learned/formation.js` cannot reach `defense.js` or `formation.js` without closing an import cycle through `state.js`, and re-keeping `positionGroup`/`onTheLine`/the pairing algorithm as private copies is how one rulebook becomes four. Every new genome parameter is inert at its init, so the shipped genome plays exactly the defense it plays today until Task 8 retrains it.

**Tech Stack:** Vanilla JS (ES modules, no build step), Node's built-in `node:test` runner (`npm test`), a static `index.html` served by `python3 serve.py` (`npm run serve`, registered as the `football-by-turn` launch config).

**Spec:** `docs/superpowers/specs/2026-08-31-adaptive-defense-formation-design.md` — read it before Task 1. The plan argues from it and the two travel together.

## Global Constraints

- **No build step.** Everything is a plain ES module the browser loads directly. Never add a bundler, a transpiler, or a dependency.
- **`lib/` must never import from `tools/`.** The dependency runs one way only; `tools/harness.js` says so in its own header.
- **Never close an import cycle.** `state.js` imports `learned/formation.js`, and `formation.js` imports `state.js`. Therefore `learned/formation.js` may import **nothing** from `state.js`, `defense.js` or `formation.js`, and `state.js` may import nothing from `formation.js`. `formation.js` importing `learned/formation.js` is fine and is what this plan relies on.
- **Comments explain *why*, not *what*.** Match the surrounding prose style — see the header of `lib/game/formation.js` or the `ORDER MATTERS` comment in `rosters.js` for the register. A comment that restates the code is worse than no comment.
- **Purity where the file claims it.** `formation.js`'s header says "Everything here is PURE — it reads `state` and returns facts or positions", with `placePlayer`/`placeFormation`/`setPersonnel` as the named writers. The two new pure functions (`learnedPersonnel`, `learnedLook`) must not mutate; the two new writers (`applyLearnedLook`, `answerOffense`) must be added to that header's list of exceptions.
- **Run `npm test` before every commit.** The whole suite, not just the new file. Several tasks below deliberately change assertions in existing tests; a task is not done until the entire suite is green.
- **Commit at the end of every task**, with a subject in the repo's voice (lowercase, present tense, a sentence about the football rather than about the code — see `git log`).

---

## Task 1: The seventeen new genome parameters

**Files:**
- Modify: `lib/game/learned/defense-spec.js`
- Test: `test/game/learned/defense-spec.test.js`

**Interfaces:**
- Produces: seventeen new `DEFENSE_SPEC` entries consumed by Tasks 3, 4 and 6 — `pos:d-lb2:across`/`down`, `pos:d-cb3:across`/`down`, `adapt:{line,backer,back,deep}:{width,depth}`, `sub:spread`, `sub:backs`, `sub:toGo`, `sub:nickel:bias`, `sub:dime:bias`.
- `DEFENSE_SPEC.length` goes from 29 to 46.

**Why this task is first and alone:** it changes nothing's behavior. `clampGenome` fills keys a genome file lacks from their spec `init`, so the shipped `defense-genome.js` keeps working and every new knob reads as zero (or as a floored bias) until later tasks consult it. Landing it on its own makes the later behavioral tasks small diffs.

- [ ] **Step 1: Update the failing tests**

Open `test/game/learned/defense-spec.test.js`. In the first test, change the final assertion:

```js
  assert.equal(DEFENSE_SPEC.length, 29);
```

to cover the new keys and the new count:

```js
  // The nickel/dime newcomers, so a sub package is as learnable as the base one.
  for (const id of ['d-lb2', 'd-cb3']) {
    assert.ok(keys.has(`pos:${id}:across`), `pos:${id}:across`);
    assert.ok(keys.has(`pos:${id}:down`), `pos:${id}:down`);
  }
  for (const group of ['line', 'backer', 'back', 'deep']) {
    assert.ok(keys.has(`adapt:${group}:width`), `adapt:${group}:width`);
    assert.ok(keys.has(`adapt:${group}:depth`), `adapt:${group}:depth`);
  }
  for (const k of ['sub:spread', 'sub:backs', 'sub:toGo',
    'sub:nickel:bias', 'sub:dime:bias']) {
    assert.ok(keys.has(k), k);
  }
  assert.equal(DEFENSE_SPEC.length, 46);
```

Then replace the whole last test in the file:

```js
test('the shipped genome loads, matches the variant, and is already clamped', () => {
  assert.equal(DEFENSE_GENOME.meta.variant, DEFENSE_VARIANT);
  assert.deepEqual(clampGenome(DEFENSE_SPEC, DEFENSE_GENOME.values), DEFENSE_GENOME.values);
});
```

with:

```js
test('the shipped genome loads, matches the variant, and is already clamped', () => {
  assert.equal(DEFENSE_GENOME.meta.variant, DEFENSE_VARIANT);
  const g = clampGenome(DEFENSE_SPEC, DEFENSE_GENOME.values);
  // Every number the file carries comes back untouched...
  for (const [k, v] of Object.entries(DEFENSE_GENOME.values)) assert.equal(g[k], v, k);
  // ...and a key added after that genome was trained comes back at its init,
  // which is the whole reason a genome trained before the defense could adapt
  // still plays the formation it was trained to play.
  for (const p of DEFENSE_SPEC) {
    if (!(p.key in DEFENSE_GENOME.values)) assert.equal(g[p.key], p.init, p.key);
  }
});
```

And append a new test asserting the inits are the inert ones:

```js
test('an untrained genome neither adapts nor subs', () => {
  const g = makeGenome(DEFENSE_SPEC);
  for (const group of ['line', 'backer', 'back', 'deep']) {
    assert.equal(g[`adapt:${group}:width`], 0);
    assert.equal(g[`adapt:${group}:depth`], 0);
  }
  // Both cuts sit at the floor with every weight at zero, so the axis reads
  // zero and neither threshold is crossed: stacked, always.
  assert.equal(g['sub:spread'], 0);
  assert.equal(g['sub:backs'], 0);
  assert.equal(g['sub:toGo'], 0);
  assert.equal(g['sub:nickel:bias'], -4);
  assert.equal(g['sub:dime:bias'], -4);
});

test('the sub-package newcomers start on their own roster spots', () => {
  const g = makeGenome(DEFENSE_SPEC);
  assert.equal(g['pos:d-lb2:across'], 3);
  assert.equal(g['pos:d-lb2:down'], 4);
  assert.equal(g['pos:d-cb3:across'], 2.5);
  assert.equal(g['pos:d-cb3:down'], 2);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
node --test test/game/learned/defense-spec.test.js
```

Expected: failures on the key assertions and on `DEFENSE_SPEC.length` (29, not 46).

- [ ] **Step 3: Add the parameters to the spec**

Open `lib/game/learned/defense-spec.js`. Directly **after** the `SPOTS` loop (the one ending `F.push({ key: \`pos:${id}:down\`, ... })`) and **before** the `ZONES` block, insert:

```js
// Nickel brings on a second backer and dime a third corner — men the stacked
// seven never fields. Their inits are their own roster spots
// (rosters.js's SEVEN_DEFENSE_NICKEL and SEVEN_DEFENSE_DIME), so a sub package
// starts from the alignment the game already fields, exactly as the seven above
// do. Neither gets a zone anchor: a defender the genome has never met falls
// through to deepAim or flowLinebacker in defense-policy.js, which is a real
// answer rather than a gap.
const SUB_SPOTS = [
  ['d-lb2', 3, 4], ['d-cb3', 2.5, 2],
];
for (const [id, across, down] of SUB_SPOTS) {
  F.push({ key: `pos:${id}:across`, min: -24, max: 24, init: across });
  F.push({ key: `pos:${id}:down`, min: 0.5, max: 12, init: down });
}
```

Then, after the `ZONES` loop and before the closing `F.push(...)` block, insert:

```js
// How far each group walks from its genome spot toward the answer the
// rule-based alignment would give this offense: 0 stands still on the learned
// spot, 1 stands where alignDefense would put him. Zero at init, so a genome
// trained before any of this existed — the shipped one carries none of these
// keys at all — plays the fixed formation it was trained to play.
for (const group of ['line', 'backer', 'back', 'deep']) {
  F.push({ key: `adapt:${group}:width`, min: 0, max: 1, init: 0 });
  F.push({ key: `adapt:${group}:depth`, min: 0, max: 1, init: 0 });
}
```

Finally, inside the existing `F.push(` block, after the `scheme:*` entries and before the closing `);`, add:

```js
  // Substitution as ONE axis — how far this look drags bodies out of the box —
  // cut twice. Nickel and dime are two points on one line, not two unrelated
  // decisions, so they share the weights and differ only in where they cut.
  // Both cuts start at the floor: an untrained genome never subs.
  { key: 'sub:spread', min: -4, max: 4, init: 0 },
  { key: 'sub:backs', min: -4, max: 4, init: 0 },
  { key: 'sub:toGo', min: -4, max: 4, init: 0 },
  { key: 'sub:nickel:bias', min: -4, max: 4, init: -4 },
  { key: 'sub:dime:bias', min: -4, max: 4, init: -4 },
```

- [ ] **Step 4: Run the full suite**

```bash
npm test
```

Expected: all green. If `test/game/learned/genome.test.js` or any other file asserts a spec length, update it to 46 the same way.

- [ ] **Step 5: Commit**

```bash
git add lib/game/learned/defense-spec.js test/game/learned/defense-spec.test.js
git commit -m "feat: the defense's genome learns how far to answer a formation"
```

---

## Task 2: `defenseKeys` — the pairing both alignments share

**Files:**
- Modify: `lib/game/formation.js` (`alignDefense`, around lines 267–335)
- Test: `test/game/formation.test.js`

**Interfaces:**
- Produces: `defenseKeys(state, team = 'defense') -> { keys: Map<string, {group, mate}>, ball: {x,y}, middle: number }`, exported from `lib/game/formation.js`, consumed by Task 4's `learnedLook`.
  - `group` is one of `'line' | 'back' | 'deep' | 'backer' | 'other'`.
  - `mate` is the opponent **player object** this defender answers, or `null` for the groups that answer the formation as a whole.
  - `ball` and `middle` are in **field units**, not yards — `middle` is the mean x of the opposing team.

**This is a pure refactor.** `alignDefense` must produce byte-identical output afterwards. Its existing tests in `test/game/formation.test.js` and the `alignDefense` sweep in `test/game/rosters.test.js` are the proof; do not change a single existing assertion in either file. Task 4 needs this pairing so that a pull of 1 lands a man exactly where `alignDefense` puts him, rather than somewhere a second copy of the algorithm happens to agree on.

- [ ] **Step 1: Write the failing test**

Append to `test/game/formation.test.js`:

```js
test('defenseKeys pairs the front with the interior and the corners with the widest', () => {
  const s = createGame({ seed: 1 });
  const { keys, middle } = defenseKeys(s);
  // The nose is the first man of the front, so he answers the offensive
  // lineman standing closest to the ball — the centre.
  assert.equal(keys.get('d-nt').group, 'line');
  assert.equal(keys.get('d-nt').mate.id, 'o-c');
  // The corners are backs, and they take the widest men left uncovered.
  assert.equal(keys.get('d-cb1').group, 'back');
  assert.ok(keys.get('d-cb1').mate.id.startsWith('o-'));
  // The safety is the deepest back, so he is the free man and answers nobody
  // in particular — he answers the middle.
  assert.equal(keys.get('d-s').group, 'deep');
  assert.equal(keys.get('d-s').mate, null);
  assert.equal(keys.get('d-lb').group, 'backer');
  // Every defender is keyed, nobody twice.
  assert.equal(keys.size, s.players.filter((p) => p.team === 'defense').length);
  assert.equal(typeof middle, 'number');
});

test('a receiver split wide becomes the man his corner is keyed to', () => {
  const s = createGame({ seed: 1 });
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  const { keys } = defenseKeys(s);
  const keyed = [...keys.values()].filter((k) => k.group === 'back')
    .map((k) => k.mate?.id);
  assert.ok(keyed.includes('o-wr1'), `expected a corner keyed to o-wr1, got ${keyed}`);
});
```

Add `defenseKeys` to the `formation.js` import block at the top of that test file (it already imports `placePlayer` and `fieldPos`).

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/game/formation.test.js
```

Expected: `defenseKeys is not a function`.

- [ ] **Step 3: Extract `defenseKeys` and rewrite `alignDefense` on top of it**

In `lib/game/formation.js`, insert this **immediately above** `alignDefense`:

```js
/**
 * Who each defender answers, and where the formation's middle is.
 *
 * The pairing alone, with no positions in it: which opponent a man is lined up
 * over is one decision, and where that puts him is another. Splitting them is
 * what lets the learned look (learnedLook) walk part of the way toward the
 * rule-based answer instead of all of it — both are built on this, so a full
 * walk arrives exactly where alignDefense stands rather than somewhere a
 * second copy of the algorithm happens to agree on.
 *
 * `ball` and `middle` are in field units, the coordinates alignDefense aims
 * in; a caller working in yards converts them itself.
 */
export function defenseKeys(state, team = 'defense') {
  const them = state.players.filter((p) => p.team !== team);
  const mine = state.players.filter((p) => p.team === team);
  const ball = ballPos(state) ?? { x: CENTRE_X, y: losY(state) };
  const middle = them.length
    ? them.reduce((sum, p) => sum + p.pos.x, 0) / them.length
    : ball.x;

  // The offense's front, innermost first, and everyone else widest first:
  // between them, an ordering of every opponent by how central he is.
  const onLine = them.filter((p) => onTheLine(state, p))
    .sort((a, b) => Math.abs(a.pos.x - ball.x) - Math.abs(b.pos.x - ball.x)
      || a.id.localeCompare(b.id));
  const front = mine.filter((p) => positionGroup(p) === 'line');
  const covered = new Set(onLine.slice(0, front.length).map((p) => p.id));
  const wide = them.filter((p) => !covered.has(p.id))
    .sort((a, b) => Math.abs(b.pos.x - ball.x) - Math.abs(a.pos.x - ball.x)
      || a.id.localeCompare(b.id));

  const free = deepMan(state, team);
  const backs = mine.filter((p) => positionGroup(p) === 'back' && p.id !== free?.id);

  // Ordered so that pairing a defender with an opponent is a matter of taking
  // the next one off each list: the front takes the interior in order, the
  // corners take the widest in order.
  const keys = new Map();
  front.forEach((d, i) => keys.set(d.id, {
    group: 'line', mate: onLine[i] ?? onLine[onLine.length - 1] ?? null,
  }));
  backs.forEach((d, i) => keys.set(d.id, { group: 'back', mate: wide[i] ?? null }));
  if (free) keys.set(free.id, { group: 'deep', mate: null });
  for (const d of mine.filter((p) => positionGroup(p) === 'backer')) {
    keys.set(d.id, { group: 'backer', mate: null });
  }
  // A role no GROUPS entry names reads as a backer to positionGroup, so this
  // is unreachable with every roster the game ships — it is here so that one
  // that is not does something rather than nothing.
  for (const d of mine) if (!keys.has(d.id)) keys.set(d.id, { group: 'other', mate: null });
  return { keys, ball, middle };
}
```

Now replace the **body** of `alignDefense` — everything from `const them = ...` down to (but not including) the `// Placed in formation order` comment — with:

```js
  const them = state.players.filter((p) => p.team !== team);
  const mine = state.players.filter((p) => p.team === team);
  if (!them.length) return [];

  const { keys, ball, middle } = defenseKeys(state, team);

  const aim = new Map();
  for (const d of mine) {
    const { group, mate } = keys.get(d.id);
    if (group === 'line') {
      aim.set(d.id, {
        x: mate ? mate.pos.x : ball.x, y: offLine(state, team, ALIGN_LINE_YARDS),
      });
    } else if (group === 'back') {
      aim.set(d.id, {
        x: mate ? mate.pos.x : ball.x, y: offLine(state, team, ALIGN_CORNER_YARDS),
      });
    } else if (group === 'deep') {
      aim.set(d.id, { x: middle, y: offLine(state, team, ALIGN_DEEP_YARDS) });
    } else if (group === 'backer') {
      // Backers share the middle of the field rather than stacking on the ball
      // — the same lanes defense.js's flowLinebacker keeps during the play, so
      // what the coach lines up against is what he will be playing against.
      aim.set(d.id, {
        x: ball.x + backerLane(state, d), y: offLine(state, team, ALIGN_BACKER_YARDS),
      });
    } else {
      aim.set(d.id, { x: ball.x, y: offLine(state, team, ALIGN_BACKER_YARDS) });
    }
  }
```

Leave the placement loop below it exactly as it is. Trim `alignDefense`'s own doc comment where it now duplicates `defenseKeys`'s, but keep its list of what each group does — that list is the football and it belongs on the public function.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```

Expected: all green, including every pre-existing `alignDefense` test. **If any previously-passing assertion now fails, the refactor changed behavior — fix the refactor, never the assertion.**

- [ ] **Step 5: Commit**

```bash
git add lib/game/formation.js test/game/formation.test.js
git commit -m "refactor: who a defender answers is a fact of its own"
```

---

## Task 3: `learnedPersonnel` — the substitution decision

**Files:**
- Modify: `lib/game/formation.js`
- Test: `test/game/formation.test.js`

**Interfaces:**
- Consumes: the `sub:*` spec keys from Task 1.
- Produces: `learnedPersonnel(state, values) -> 'stacked' | 'nickel' | 'dime'`, pure, exported from `lib/game/formation.js`, consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/formation.test.js`:

```js
test('an untrained genome never subs, whatever the offense shows', () => {
  const g = makeGenome(DEFENSE_SPEC);
  const s = createGame({ seed: 1 });
  assert.equal(learnedPersonnel(s, g), 'stacked');
  // Empty the backfield and split it wide: still stacked, because both cuts
  // sit at the floor. This pair of assertions IS the compatibility guarantee.
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  placePlayer(s, 'o-wr2', fieldPos(24, s.losYard - 1));
  assert.equal(learnedPersonnel(s, g), 'stacked');
  s.down = 3;
  s.toGoYard = s.losYard + 10;
  assert.equal(learnedPersonnel(s, g), 'stacked');
});

test('a genome that hates spread subs to nickel, then to dime', () => {
  const s = createGame({ seed: 1 });
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  placePlayer(s, 'o-wr2', fieldPos(24, s.losYard - 1));
  const base = { ...makeGenome(DEFENSE_SPEC), 'sub:spread': 4 };
  // Spread is near 1 with the receivers on the numbers, so the axis reads
  // about 4: a cut at -3 is crossed, a cut at -4 is too, and one at 0 is not.
  assert.equal(learnedPersonnel(s, { ...base, 'sub:nickel:bias': 0, 'sub:dime:bias': 0 }), 'stacked');
  assert.equal(learnedPersonnel(s, { ...base, 'sub:nickel:bias': -3, 'sub:dime:bias': 0 }), 'nickel');
  assert.equal(learnedPersonnel(s, { ...base, 'sub:nickel:bias': -3, 'sub:dime:bias': -3 }), 'dime');
});

test('the empty backfield is a tell of its own, separate from width', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(DEFENSE_SPEC), 'sub:backs': 4, 'sub:nickel:bias': -1 };
  // Default seven-a-side: some men are off the line, but not enough to cross.
  const before = learnedPersonnel(s, g);
  // Put a back on the line and the fraction falls; pull one off and it rises.
  placePlayer(s, 'o-rb', fieldPos(-20, s.losYard - 6));
  placePlayer(s, 'o-wr1', fieldPos(-10, s.losYard - 5));
  assert.ok(['stacked', 'nickel'].includes(before));
  assert.equal(learnedPersonnel(s, g), 'nickel');
});
```

Add to the imports at the top of `test/game/formation.test.js`:

```js
import { makeGenome } from '../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
```

and add `learnedPersonnel` to the `formation.js` import block.

- [ ] **Step 2: Run them and watch them fail**

```bash
node --test test/game/formation.test.js
```

Expected: `learnedPersonnel is not a function`.

- [ ] **Step 3: Implement it**

Add to `lib/game/formation.js`'s imports:

```js
import { clampGenome } from './learned/genome.js';
import { DEFENSE_SPEC } from './learned/defense-spec.js';
```

Add the function below `setPersonnel`:

```js
/**
 * Which package this genome wants against the look the offense is showing.
 *
 * One axis — how far this formation drags bodies out of the box — cut twice.
 * Nickel and dime are two points on one line, so they share the weights and
 * differ only in where the line is cut; a genome cannot learn to play dime
 * against looks it would not also play nickel against, which is the right
 * constraint rather than a missing feature.
 *
 * `spread` and `toGo` are defense-policy.js's schemeFeatures, deliberately the
 * identical expressions: how wide they are is one fact about the offense, and
 * the scheme gate and the substitution must not disagree about it. `backs` is
 * the one thing width cannot see — a team can be narrow and still have every
 * skill man off the line.
 *
 * Pure. Task of the caller to actually sub anybody.
 */
export function learnedPersonnel(state, values) {
  const g = clampGenome(DEFENSE_SPEC, values);
  const them = state.players.filter((p) => p.team === 'offense');
  const xs = them.map((p) => p.pos.x);
  const width = SIDELINE_RIGHT - SIDELINE_LEFT;
  const spread = xs.length ? (Math.max(...xs) - Math.min(...xs)) / width : 0;
  const backs = them.length
    ? them.filter((p) => !onTheLine(state, p)).length / them.length
    : 0;
  const toGo = Math.min(1, (state.toGoYard - state.losYard) / 10);
  const z = g['sub:spread'] * spread + g['sub:backs'] * backs + g['sub:toGo'] * toGo;
  if (z + g['sub:dime:bias'] > 0) return 'dime';
  if (z + g['sub:nickel:bias'] > 0) return 'nickel';
  return 'stacked';
}
```

- [ ] **Step 4: Run the full suite**

```bash
npm test
```

Expected: all green. If the third test's `before` assertion is wrong for the shipped seven-a-side roster, read the actual fraction (`them.filter(p => !onTheLine(s, p)).length / them.length`) and adjust the bias in the test until it expresses the intent — *a rising fraction crosses the cut* — rather than loosening the assertion.

- [ ] **Step 5: Commit**

```bash
git add lib/game/formation.js test/game/formation.test.js
git commit -m "feat: the learned defense decides when to sub"
```

---

## Task 4: `learnedLook` — the base look, walked toward the answer

**Files:**
- Modify: `lib/game/formation.js`
- Modify: `lib/game/learned/formation.js` (export `MAX_YARD`)
- Test: `test/game/formation.test.js`

**Interfaces:**
- Consumes: `defenseKeys` (Task 2), the `adapt:*` and `pos:*` spec keys (Task 1), and `learnedDefenseSpots` from `lib/game/learned/formation.js`.
- Produces: `learnedLook(state, values, team = 'defense') -> [{ id, pos: {x, y} }]`, pure, exported from `lib/game/formation.js`, consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/formation.test.js`:

```js
test('at zero pull the learned look is the genome look, exactly', () => {
  // The other half of the compatibility guarantee: with no adapt weights, the
  // new path and the old one must not differ by so much as a rounding error.
  const s = createGame({ seed: 1 });
  const g = makeGenome(DEFENSE_SPEC);
  assert.deepEqual(learnedLook(s, g), learnedDefenseSpots(s, g));
});

test('at zero pull a trained genome is still the genome look, exactly', () => {
  const s = createGame({ seed: 1 });
  assert.deepEqual(
    learnedLook(s, DEFENSE_GENOME.values),
    learnedDefenseSpots(s, DEFENSE_GENOME.values),
  );
});

test('a full-width pull stands the front and the corners where alignDefense does', () => {
  const s = createGame({ seed: 1 });
  placePlayer(s, 'o-wr1', fieldPos(-22, s.losYard - 1));
  const g = { ...makeGenome(DEFENSE_SPEC) };
  for (const group of ['line', 'backer', 'back', 'deep']) {
    g[`adapt:${group}:width`] = 1;
    g[`adapt:${group}:depth`] = 1;
  }
  const learned = new Map(learnedLook(s, g).map((sp) => [sp.id, sp.pos]));
  const ruled = new Map(alignDefense(s).map((sp) => [sp.id, sp.pos]));
  // Within a nudge: both run the same clearX scan, but from spots that reached
  // it by different arithmetic, so a man can land one nudge unit apart.
  for (const id of ['d-nt', 'd-dt1', 'd-dt2', 'd-cb1', 'd-cb2', 'd-s']) {
    const gap = Math.hypot(
      learned.get(id).x - ruled.get(id).x, learned.get(id).y - ruled.get(id).y,
    );
    assert.ok(gap <= 1.5, `${id} stood ${gap.toFixed(2)} from the rule-based spot`);
  }
});

test('a receiver split wide drags his corner across', () => {
  // The thing this whole feature exists for.
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 1 };
  const before = new Map(learnedLook(s, g).map((sp) => [sp.id, sp.pos]));
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  const after = new Map(learnedLook(s, g).map((sp) => [sp.id, sp.pos]));
  const travelled = ['d-cb1', 'd-cb2'].some(
    (id) => Math.abs(after.get(id).x - before.get(id).x) > 5,
  );
  assert.ok(travelled, 'no corner moved with the receiver');
});

test('a flanker off the ball drags his corner deeper', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 1, 'adapt:back:depth': 1 };
  placePlayer(s, 'o-wr1', fieldPos(-22, s.losYard - 1));
  const shallow = new Map(learnedLook(s, g).map((sp) => [sp.id, sp.pos]));
  placePlayer(s, 'o-wr1', fieldPos(-22, s.losYard - 6));
  const deep = new Map(learnedLook(s, g).map((sp) => [sp.id, sp.pos]));
  const backedOff = ['d-cb1', 'd-cb2'].some(
    (id) => yardsOfY(deep.get(id).y) > yardsOfY(shallow.get(id).y),
  );
  assert.ok(backedOff, 'no corner gave ground to the flanker');
});

test('half a pull stands a man between the two looks', () => {
  const s = createGame({ seed: 1 });
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  const none = new Map(learnedLook(s, { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 0 })
    .map((sp) => [sp.id, sp.pos]));
  const half = new Map(learnedLook(s, { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 0.5 })
    .map((sp) => [sp.id, sp.pos]));
  const full = new Map(learnedLook(s, { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 1 })
    .map((sp) => [sp.id, sp.pos]));
  const between = ['d-cb1', 'd-cb2'].some((id) => {
    const lo = Math.min(none.get(id).x, full.get(id).x);
    const hi = Math.max(none.get(id).x, full.get(id).x);
    return half.get(id).x > lo + 0.5 && half.get(id).x < hi - 0.5;
  });
  assert.ok(between, 'half a pull landed on one end or the other');
});

test('everything a training run can express still lands legal', () => {
  // learned/formation.js keeps this sweep for the base look; the adapted look
  // needs its own, because the blend is a new way to arrive at a spot.
  const rand = mulberry32(11);
  for (let i = 0; i < 20; i++) {
    const s = createGame({ seed: 1 });
    const g = mutateGenome(DEFENSE_SPEC, makeGenome(DEFENSE_SPEC), rand, 0.5);
    for (const { id, pos } of learnedLook(s, g)) getPlayer(s, id).pos = pos;
    for (const p of s.players.filter((pl) => pl.team === 'defense')) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${p.id} mutation ${i}`);
    }
  }
});
```

Add to the imports of `test/game/formation.test.js`:

```js
import { learnedDefenseSpots } from '../../lib/game/learned/formation.js';
import { DEFENSE_GENOME } from '../../lib/game/learned/defense-genome.js';
import { mutateGenome } from '../../lib/game/learned/genome.js';
import { mulberry32 } from '../../lib/game/rng.js';
```

and add `learnedLook` to the `formation.js` import block. `spotFault`, `alignDefense`, `getPlayer`, `yardsOfY` and `fieldPos` are already imported there.

- [ ] **Step 2: Run them and watch them fail**

```bash
node --test test/game/formation.test.js
```

Expected: `learnedLook is not a function`.

- [ ] **Step 3: Export the depth cap from the learned module**

In `lib/game/learned/formation.js`, change:

```js
const MAX_YARD = 108;
```

to:

```js
export const MAX_YARD = 108;
```

(The comment above it already explains the number; leave it.)

- [ ] **Step 4: Implement `learnedLook`**

Add to `lib/game/formation.js`'s imports:

```js
import { learnedDefenseSpots, MAX_YARD } from './learned/formation.js';
```

and add `xToYards` to the existing `../field/geometry.js` import block.

Add, below `alignDefense`:

```js
/**
 * Where each group would stand if it answered this offense and nothing else —
 * alignDefense's own football, in yards rather than field units, so a learned
 * spot can be walked partway toward it.
 *
 * Two rows read differently from alignDefense on purpose. A back's depth is a
 * cushion off HIS OWN man rather than a fixed one, so a flanker off the ball
 * takes his corner back with him. And a backer's lane is measured from the
 * formation's middle rather than from the ball, so he keeps his spacing and
 * still leans to the strength — a strictly better answer than the rule-based
 * one, which is why the "a full pull equals alignDefense" test excludes him.
 */
function answerYards(state, defender, key, ball, middle) {
  const acrossOf = (p) => xToYards(p.pos.x);
  const { group, mate } = key;
  if (group === 'line') {
    return {
      across: mate ? acrossOf(mate) : xToYards(ball.x),
      down: ALIGN_LINE_YARDS,
    };
  }
  if (group === 'back') {
    return {
      across: mate ? acrossOf(mate) : xToYards(ball.x),
      down: ALIGN_CORNER_YARDS
        + (mate ? Math.max(0, state.losYard - yardsOfY(mate.pos.y)) : 0),
    };
  }
  if (group === 'deep') {
    return { across: xToYards(middle), down: ALIGN_DEEP_YARDS };
  }
  if (group === 'backer') {
    return {
      across: xToYards(middle + backerLane(state, defender)),
      down: ALIGN_BACKER_YARDS,
    };
  }
  return { across: xToYards(ball.x), down: ALIGN_BACKER_YARDS };
}

/**
 * The learned defense's pre-snap look: the genome's spots, walked toward the
 * answer this offense's formation deserves by however far the genome has
 * learned to walk.
 *
 * Every `adapt:*` at zero returns learnedDefenseSpots byte for byte — that is
 * the contract a genome trained before any of this existed relies on, and it
 * is asserted rather than assumed. An id the spec does not name has no learned
 * spot to walk from, so he takes the answer outright.
 *
 * Held in yards throughout and converted once, through fieldPos, because yards
 * are the units the genome itself is written in: the blend is arithmetic on
 * the genome's own numbers rather than on pixels.
 *
 * Pure: it returns spots and moves nobody.
 */
export function learnedLook(state, values, team = 'defense') {
  const g = clampGenome(DEFENSE_SPEC, values);
  const them = state.players.filter((p) => p.team !== team);
  if (!them.length) return learnedDefenseSpots(state, values);

  const { keys, ball, middle } = defenseKeys(state, team);
  const placed = them.map((p) => ({ radius: p.radius, pos: p.pos }));
  const spots = [];
  for (const d of state.players) {
    if (d.team !== team) continue;
    const key = keys.get(d.id);
    const answer = answerYards(state, d, key, ball, middle);
    const knob = key.group === 'other' ? 'backer' : key.group;
    const base = {
      across: g[`pos:${d.id}:across`], down: g[`pos:${d.id}:down`],
    };
    const named = typeof base.across === 'number';
    const walk = (from, to, pull) => (named ? from + (to - from) * pull : to);
    const across = walk(base.across, answer.across, g[`adapt:${knob}:width`]);
    // The same two clamps learnedDefenseSpots applies: never back across the
    // line (the spec's own floor, which spotFault enforces), never off the
    // drawn field deep in the red zone.
    const down = Math.max(0.5, Math.min(
      walk(base.down, answer.down, g[`adapt:${knob}:depth`]),
      MAX_YARD - state.losYard,
    ));
    const want = fieldPos(across, state.losYard + down);
    const x = clearX(placed, want.x, want.y, d.radius);
    const pos = { x, y: want.y };
    placed.push({ radius: d.radius, pos });
    spots.push({ id: d.id, pos });
  }
  return spots;
}
```

**A note for whoever implements this:** the "zero pull is exactly the genome look" test is the one that matters. If it fails by a rounding hair, the cause is almost certainly that `learnedDefenseSpots` computes `Math.min(down, MAX_YARD - losYard)` with no `Math.max(0.5, ...)` and no walk. With every pull at 0, `walk` returns `from` unchanged, so the arithmetic is identical — do not "fix" a mismatch by loosening the assertion to a tolerance.

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/game/formation.js lib/game/learned/formation.js test/game/formation.test.js
git commit -m "feat: the genome's look walks toward the formation it faces"
```

---

## Task 5: A genome for the seven-a-side game is a genome for its sub packages

**Files:**
- Modify: `lib/game/learned/formation.js` (`isLearnedDefense`)
- Test: `test/game/learned/formation.test.js`

**Interfaces:**
- Consumes: `baseVariantId` from `lib/game/rosters.js` (already exported).
- Produces: `isLearnedDefense(state)` now true for `'7'`, `'7-nickel'` and `'7-dime'`.

**Why:** `setPersonnel` writes `state.variantId = '7-nickel'`. Without this, the instant Task 6's `answerOffense` subs the defense, `isLearnedDefense` goes false and the learned formation switches off entirely — while `coachAi` carries on running the learned brain in play, because that check has no variant gate at all.

- [ ] **Step 1: Write the failing test**

Append to `test/game/learned/formation.test.js`:

```js
test('a genome trained for the seven-a-side game covers its sub packages too', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  assert.equal(isLearnedDefense(s), true);
  for (const id of ['7-nickel', '7-dime']) {
    s.variantId = id;
    assert.equal(isLearnedDefense(s), true, id);
  }
  // Eleven a side is a different game, not a different package.
  s.variantId = '11';
  assert.equal(isLearnedDefense(s), false);
});
```

Add `isLearnedDefense` to the `learned/formation.js` import block at the top of that file.

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/game/learned/formation.test.js
```

Expected: fails on `'7-nickel'`.

- [ ] **Step 3: Widen the gate**

In `lib/game/learned/formation.js`, add the import:

```js
import { baseVariantId } from '../rosters.js';
```

(`rosters.js` imports only `constants.js`, so this closes no cycle.)

Change `isLearnedDefense`'s last line from:

```js
    && state.variantId === DEFENSE_VARIANT;
```

to:

```js
    && baseVariantId(state.variantId) === DEFENSE_VARIANT;
```

and extend its doc comment with a sentence saying why: nickel and dime are packages within the seven-a-side game, not different games, so a genome trained for it is a genome for them — the distinction this gate exists to make is seven-a-side against eleven.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```

Expected: all green. The pre-existing test `realignLearnedDefense declines when the variant does not match the trained one` uses variant `'11'` and must still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/game/learned/formation.js test/game/learned/formation.test.js
git commit -m "feat: nickel and dime are packages, not different games"
```

---

## Task 6: `applyLearnedLook` and `answerOffense` — the writers

**Files:**
- Modify: `lib/game/formation.js`
- Modify: `lib/game/learned/formation.js` (delete `realignLearnedDefense`)
- Test: `test/game/formation.test.js`
- Test: `test/game/learned/formation.test.js` (remove the three `realignLearnedDefense` tests)

**Interfaces:**
- Consumes: `learnedPersonnel` (Task 3), `learnedLook` (Task 4), `isLearnedDefense` (Task 5), `setPersonnel` and `canReposition` (existing).
- Produces, both from `lib/game/formation.js` and both consumed by Task 7:
  - `applyLearnedLook(state, values) -> boolean` — subs, then writes the spots. Ungated except for `canReposition`.
  - `answerOffense(state, values) -> boolean` — `applyLearnedLook` behind the `isLearnedDefense` gate.

**Why two functions and not one:** the training harness runs **hot-seat on purpose** (`aiTeam` is null, so `runTurn`'s own `coachAi` stays inert and the harness is the only coach of either side). `isLearnedDefense` requires `aiTeam === 'defense'`, so a single gated function would decline every time the trainer called it and the new parameters would never be exercised. `answerOffense` is the game's door; `applyLearnedLook` is the trainer's.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/formation.test.js`:

```js
test('answerOffense subs the package and stands the men, for a learned defense only', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  const g = { ...makeGenome(DEFENSE_SPEC), 'sub:spread': 4, 'sub:nickel:bias': -3 };
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  placePlayer(s, 'o-wr2', fieldPos(24, s.losYard - 1));
  assert.equal(answerOffense(s, g), true);
  assert.equal(personnelId(s.variantId), 'nickel');
  assert.ok(s.players.some((p) => p.id === 'd-lb2'), 'the extra backer never came on');
  assert.equal(s.players.filter((p) => p.team === 'defense').length, teamSize(s.variantId));
});

test('answerOffense declines and touches nobody when the computer is not on defense', () => {
  for (const opts of [
    { seed: 1 },
    { seed: 1, ai: 'defense', aiLevel: 'smart' },
    { seed: 1, ai: 'offense', aiLevel: 'learned' },
  ]) {
    const s = createGame(opts);
    const before = s.players.map((p) => ({ id: p.id, ...p.pos }));
    const variant = s.variantId;
    assert.equal(answerOffense(s, makeGenome(DEFENSE_SPEC)), false);
    assert.equal(s.variantId, variant);
    assert.deepEqual(s.players.map((p) => ({ id: p.id, ...p.pos })), before);
  }
});

test('answerOffense declines once the ball is live', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.turnIndex = 1;
  assert.equal(answerOffense(s, makeGenome(DEFENSE_SPEC)), false);
});

test('a man answerOffense moves loses the orders he was given standing elsewhere', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  const g = { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 1 };
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  setPlan(s, 'd-cb1', { x: 0, y: 1 }, 1);
  answerOffense(s, g);
  assert.equal(getPlayer(s, 'd-cb1').plan, null);
  assert.equal(getPlayer(s, 'd-cb1').cover, null);
});

test('every spot answerOffense writes is one the rulebook would allow', () => {
  const rand = mulberry32(13);
  for (let i = 0; i < 20; i++) {
    const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
    const g = mutateGenome(DEFENSE_SPEC, makeGenome(DEFENSE_SPEC), rand, 0.5);
    answerOffense(s, g);
    for (const p of s.players.filter((pl) => pl.team === 'defense')) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${p.id} mutation ${i}`);
    }
  }
});

test('applyLearnedLook works hot-seat, which is how the trainer runs', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.aiTeam, null);
  assert.equal(applyLearnedLook(s, makeGenome(DEFENSE_SPEC)), true);
});
```

Add `answerOffense`, `applyLearnedLook` to the `formation.js` import block; add `personnelId, teamSize` to the `rosters.js` import block (`teamSize` is already imported); and add `setPlan` to the `state.js` import block (already imported in this file).

Now **delete** these three tests from `test/game/learned/formation.test.js` — their subject is being deleted, and their behavior is covered by the two `answerOffense` decline tests above:

- `realignLearnedDefense puts a dragged-away defender back on his genome spot`
- `realignLearnedDefense declines and touches nobody when aiLevel is not learned`
- `realignLearnedDefense declines when the variant does not match the trained one`

and remove `realignLearnedDefense` from that file's import block.

Then append to `test/game/formation.test.js` the replacement for the first of those, which guarded a real bug and must keep being guarded:

```js
test('answerOffense puts a dragged-away defender back where the look wants him', () => {
  // The bug this guards: app/main.js's realignDefense used to run the
  // rule-based alignDefense after any offense change, stomping a learned
  // defense's formation. Simulate that stomp by hand and confirm the answer
  // puts him back.
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  const g = makeGenome(DEFENSE_SPEC);
  answerOffense(s, g);
  const spot = { ...getPlayer(s, 'd-s').pos };
  getPlayer(s, 'd-s').pos = { x: spot.x + 30, y: spot.y + 5 };
  assert.equal(answerOffense(s, g), true);
  assert.deepEqual(getPlayer(s, 'd-s').pos, spot);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
node --test test/game/formation.test.js
```

Expected: `answerOffense is not a function`.

- [ ] **Step 3: Implement both writers**

Add to `lib/game/formation.js`'s imports: `isLearnedDefense` alongside the existing `learnedDefenseSpots, MAX_YARD` from `./learned/formation.js`, and `getPlayer` (already imported from `./state.js`).

Add below `learnedLook`:

```js
/**
 * Put the learned look on the board: the package first, because the spots
 * that follow have to be spots for the men actually on the field, then every
 * defender's spot. A moved man's plan and cover are wiped — an order worked
 * out from where he used to stand is a lie now, the rule placeFormation keeps.
 *
 * Ungated except for canReposition, which is the rule that a formation is what
 * you come to the line with. The training harness comes in through this door:
 * it runs hot-seat on purpose, so the gate answerOffense keeps would turn it
 * away and the genome's adapt weights would never be exercised.
 */
export function applyLearnedLook(state, values) {
  if (!canReposition(state)) return false;
  setPersonnel(state, learnedPersonnel(state, values));
  for (const { id, pos } of learnedLook(state, values)) {
    const p = getPlayer(state, id);
    p.pos = pos;
    p.plan = null;
    p.cover = null;
  }
  return true;
}

/**
 * The game's door onto the same thing: the computer's answer to the look the
 * offense is showing, written whenever the offense changes it.
 *
 * Returns false and touches nothing unless a learned computer is coaching the
 * defense, so every caller keeps the rule-based alignDefense it already falls
 * back to — and a human coaching his own defense is never aligned over.
 */
export function answerOffense(state, values) {
  if (!isLearnedDefense(state)) return false;
  return applyLearnedLook(state, values);
}
```

Then **delete** `realignLearnedDefense` from `lib/game/learned/formation.js` entirely, comment and all. Its responsibility now belongs to `answerOffense`.

Finally, update `formation.js`'s module header. It currently says everything in the file is pure with `placePlayer`/`placeFormation`/`setPersonnel` as the writers; add `applyLearnedLook` and `answerOffense` to that list.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```

Expected: all green. `app/main.js` still imports `realignLearnedDefense` at this point and the browser page would be broken — Task 7 fixes that, and no test loads `app/main.js`. Do not leave the tree in this state: run Task 7 immediately after.

- [ ] **Step 5: Commit**

```bash
git add lib/game/formation.js lib/game/learned/formation.js test/game/formation.test.js test/game/learned/formation.test.js
git commit -m "feat: the computer answers the formation it is shown"
```

---

## Task 7: Wiring — the board, the next down, and the trainer

**Files:**
- Modify: `app/main.js` (imports around lines 1–50, `realignDefense` at 321, `personnelBtn.disabled` at 201)
- Modify: `lib/game/rules.js` (imports, and `nextDown` around line 270)
- Modify: `tools/harness.js` (imports, and `defenseCoach` around line 84)
- Test: `test/game/rules.test.js`

**Interfaces:**
- Consumes: `answerOffense` and `applyLearnedLook` (Task 6), `DEFENSE_GENOME`.

- [ ] **Step 1: Write the failing test**

Append to `test/game/rules.test.js`:

```js
test('a learned defense comes to the new down already answering the formation', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  const saved = { ...DEFENSE_GENOME.values };
  // Borrow the shipped genome for one down: a corner who walks all the way to
  // the answer, so the effect is visible rather than a fraction of a yard.
  DEFENSE_GENOME.values['adapt:back:width'] = 1;
  try {
    s.losYard = 40;
    nextDown(s, 45);
    const cb = getPlayer(s, 'd-cb1');
    const wr = s.players.filter((p) => p.team === 'offense')
      .reduce((a, b) => (Math.abs(b.pos.x - cb.pos.x) < Math.abs(a.pos.x - cb.pos.x) ? b : a));
    assert.ok(Math.abs(cb.pos.x - wr.pos.x) < 6,
      'the corner did not come to the line over anybody');
  } finally {
    DEFENSE_GENOME.values = saved;
  }
});
```

Add to that file's imports whichever of `createGame`, `getPlayer`, `nextDown` are missing, plus:

```js
import { DEFENSE_GENOME } from '../../lib/game/learned/defense-genome.js';
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/game/rules.test.js
```

Expected: the corner is on his genome spot, not over a receiver.

- [ ] **Step 3: Wire `rules.js`**

In `lib/game/rules.js`, add:

```js
import { answerOffense } from './formation.js';
import { DEFENSE_GENOME } from './learned/defense-genome.js';
```

(`formation.js` does not import `rules.js`, so this closes no cycle.)

In `nextDown`, after the existing `maybeApplyLearnedFormations(state);` and **before** `aimSnap(state);`, add:

```js
  // ...and then answers the look it is standing in front of. The defense's
  // spots are written twice on a new down; both writes are pure and the second
  // wins, which is cheaper than teaching maybeApplyLearnedFormations about a
  // module state.js cannot import.
  answerOffense(state, DEFENSE_GENOME.values);
```

- [ ] **Step 4: Wire `app/main.js`**

Replace the import line:

```js
import { realignLearnedDefense } from '../lib/game/learned/formation.js';
```

with:

```js
import { DEFENSE_GENOME } from '../lib/game/learned/defense-genome.js';
```

Add `answerOffense` to the `../lib/game/formation.js` import block.

Replace `realignDefense` (line 321) with:

```js
function realignDefense() {
  if (state.aiTeam !== 'defense') return;
  if (answerOffense(state, DEFENSE_GENOME.values)) return;
  for (const { id, pos } of alignDefense(state)) getPlayer(state, id).pos = pos;
}
```

and update its doc comment: a learned defense no longer "holds its ground" — it subs its package and slides its men by however far its genome has learned to, and the rule-based alignment is what every other brain still gets.

Then change the Personnel button's disabled rule (line 201) from:

```js
  personnelBtn.disabled = animating || !canReposition(state);
```

to:

```js
  // Not the human's to press when the computer is coaching the defense: it
  // picks its own package now, and the two would fight on every press.
  personnelBtn.disabled = animating || !canReposition(state) || state.aiTeam === 'defense';
```

- [ ] **Step 5: Wire `tools/harness.js`**

Change the import:

```js
import { applyLearnedDefenseFormation, applyLearnedOffenseFormation } from '../lib/game/learned/formation.js';
```

to:

```js
import { applyLearnedOffenseFormation } from '../lib/game/learned/formation.js';
import { applyLearnedLook } from '../lib/game/formation.js';
```

and in `defenseCoach`, change:

```js
      applyLearnedDefenseFormation(state, values);
```

to:

```js
      applyLearnedLook(state, values);
```

Update `defenseCoach`'s doc comment: the formation it stands is now the candidate's package and its answer to the offense's look, which is what makes the `adapt:*` and `sub:*` weights something evolution can score. Note in the comment that the harness runs before the offense has— no: note that the loop already runs `offenseCoach` first, so the offense's formation is on the board when the defense reads it, and that this ordering is what makes adaptation trainable at all.

- [ ] **Step 6: Run the full suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 7: Verify a training run still starts**

```bash
timeout 120 npm run train:defense -- --generations 1 --pop 4 --plays 4 --seed 1
```

Expected: it runs and prints a fitness without throwing. (It will overwrite `lib/game/learned/defense-genome.js` — **`git checkout lib/game/learned/defense-genome.js` afterwards.** Task 8 is where a real retrain is committed.)

- [ ] **Step 8: Verify it in the browser**

Start the preview with the `football-by-turn` launch config, choose **offense** on the home screen, turn Reposition on, drag a receiver to the sideline, and confirm the defense answers. With the shipped genome every `adapt:*` is 0, so **the correct result at this step is that the men do not move** — what you are verifying is that nothing throws, the board still paints, and the Personnel button is greyed out. Check the browser console for errors.

- [ ] **Step 9: Commit**

```bash
git add app/main.js lib/game/rules.js tools/harness.js test/game/rules.test.js
git commit -m "feat: every look the offense shows gets an answer"
```

---

## Task 8: Retrain, so the defense actually moves

**Files:**
- Modify: `lib/game/learned/defense-genome.js` (generated)
- Modify: `lib/game/learned/offense-genome.js` (generated — co-evolution writes both)

**Interfaces:** none. This task ships numbers, not code.

**Why it is in this plan rather than after it:** every parameter Task 1 added is inert at its init, so up to here the game plays byte for byte the defense it played before. The feature is not visible — and not proven — until a training run has had the chance to use the new knobs.

- [ ] **Step 1: Run the co-evolution**

```bash
npm run train:coevolve -- --generations 20 --pop 12 --plays 12 --seed 1
```

This is the run the README documents as the normal way, and it rewrites **both** genome files. It takes a while; run it in the background and let it finish rather than cutting it short.

- [ ] **Step 2: Read the result honestly**

```bash
node -e "const {DEFENSE_GENOME:g}=await import('./lib/game/learned/defense-genome.js'); console.log(g.meta.fitness); for(const k of Object.keys(g.values)) if(k.startsWith('adapt:')||k.startsWith('sub:')) console.log(k, g.values[k].toFixed(3));"
```

Compare the fitness against the value in the previous genome's `meta.fitness` (`git show HEAD:lib/game/learned/defense-genome.js | head -20`).

Three outcomes, all of them reportable rather than hideable:

- **The adapt weights moved off zero and fitness improved.** The feature works; say so with both numbers.
- **The weights moved and fitness did not improve.** Report it. Twenty generations on a genome that grew by 17 parameters may simply not be enough; a longer run is the next thing to try, not a code change.
- **The weights stayed at or near zero.** That is a real result: it says adaptation does not pay against this co-evolving offense at this budget. Report it plainly. Do not hand-edit the genome to force movement — the file says `retrain rather than editing by hand` at the top and it means it.

- [ ] **Step 3: Confirm the suite still passes with the new genome**

```bash
npm test
```

Expected: all green. In particular `the shipped genome loads, matches the variant, and is already clamped` (Task 1) must pass — the regenerated file now carries every key, so its second loop simply finds nothing to check.

- [ ] **Step 4: Look at it in the browser**

Start the preview with the `football-by-turn` launch config, choose **offense**, turn Reposition on, and drag a receiver wide. If the adapt weights moved off zero, a defender should move with him. Screenshot it.

- [ ] **Step 5: Commit**

```bash
git add lib/game/learned/defense-genome.js lib/game/learned/offense-genome.js
git commit -m "feat: retrain both genomes against a defense that can answer"
```

---

## Self-Review

**Spec coverage.** Motivation → Tasks 6 and 7. "Why the parameters start at zero" → Task 1, asserted in Tasks 3 and 4. "Where the code goes" → Tasks 2, 3, 4, 6, all in `formation.js`. "The one gap this leaves" (`createGame` unadapted) → deliberately not closed; no task, by design. "New public surface" → Tasks 3, 4, 6 — **the spec named three exports and this plan produces four**: `applyLearnedLook` was split out of `answerOffense` because the training harness runs hot-seat and the `isLearnedDefense` gate would turn it away, which the spec's own Wiring section requires but did not name. That is a refinement, and Task 6 documents it. "The base look, and the answer" (the table) → Task 4's `answerYards`. "The pull" → Tasks 1 and 4. "Legality" → the sweeps in Tasks 4 and 6. "Substitution" → Tasks 1 and 3. "The newcomers" → Task 1's `SUB_SPOTS`, with the no-zone-anchor question answered in its comment. "`isLearnedDefense` has to widen" → Task 5. "Wiring" → Task 7. "The Personnel button" → Task 7 Step 4. "Testing" → every listed test has a home. "Retraining" → Task 8.

**Placeholders.** None: every code step carries the actual code, every test step the actual assertions, every command the actual flags.

**Type consistency.** `defenseKeys` returns `{ keys, ball, middle }` in Task 2 and is destructured as exactly that in Tasks 2 and 4. `key.group` takes the five values `'line' | 'back' | 'deep' | 'backer' | 'other'` in Task 2 and Task 4's `answerYards` handles all five, mapping `'other'` onto the backer knobs. `learnedLook(state, values, team)` and `learnedPersonnel(state, values)` are called with those signatures in Task 6. `applyLearnedLook(state, values)` and `answerOffense(state, values)` are called with those signatures in Task 7. `MAX_YARD` is exported in Task 4 Step 3 before Task 4 Step 4 imports it.
