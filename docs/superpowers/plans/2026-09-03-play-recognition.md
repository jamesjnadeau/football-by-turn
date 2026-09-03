# Play Recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the computer one object per down — the look it snapped against, a fallible run/pass read, and the call it committed to — and let the learned defense act on that read, including when the read is wrong.

**Architecture:** A new pure module `lib/game/read.js` owns `state.playRead`, built lazily at the top of turn 0 and advanced once per turn from `turn.js`, immediately above the existing `coachAi(state)`. The learned defense stops recomputing its scheme and its coverage assignments every turn and reads them off the percept instead; a committed read makes the second level trigger. Nine new `read:*` genome keys, all inert at their inits, so the shipped genome is unchanged until it is retrained.

**Tech Stack:** Plain ES modules, no build step. Tests are `node:test` + `node:assert/strict`, run with `npm test` (`node --test`). Training is `npm run train:defense`.

**Spec:** `docs/superpowers/specs/2026-09-03-play-recognition-design.md`

## Global Constraints

- **Nothing under `lib/` may read a browser API, the filesystem, or the network.** Data arrives on `state`, handed over by the app or a tool.
- **Nothing in the AI path may roll a die.** `lib/game/read.js` and every function it calls must be deterministic; the harness's reproducibility from a seed depends on it.
- **The read may never look at the opponent's orders** — not `p.plan`, not `p.cover`, not `p.mode`, not `state.plannedPass`. Positions, velocities and `state.ball` only. This is the rule the whole feature rests on: `advancePlay` runs while the human's drawn arrows are still on the board.
- **`advancePlay` must not gate on `state.aiTeam`.** The training harness runs hot-seat with `aiTeam === null` and coaches both sides itself; a percept that only existed when `aiTeam` was set would be absent for every play a genome is ever scored on.
- **Every new genome key inits to `0`, except `read:commit`, which inits at its maximum (`8`).** At those values the accumulator is identically zero, `committed` is never true, and the defense plays byte for byte the defense it plays today.
- **A state carrying no `playRead` must still work.** Old saves and hand-rolled test states carry no field; every reader falls back rather than throwing.
- **Commit messages:** lower-case `type: subject` in the repository's existing voice (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`). Look at `git log` before writing one.

---

### Task 1: Let an offense ghost cross personnel packages

`situationDistance` walls off snapshots recorded under a different variant string. That is right for seven-man against eleven-man football and wrong for `'7'` against `'7-nickel'`, which field the **identical `SEVEN_OFFENSE`** and differ only in the defensive package. Seventeen of `default-offense2.json`'s twenty downs are `'7-nickel'`, so without this the pass arm of Task 9's training distribution is three downs instead of twenty.

The relaxation applies to an **offense** ghost only. A defense ghost keeps the strict comparison, because there the personnel package is precisely what differs and `applySnapshot` would silently skip ids the package does not field.

**Files:**
- Modify: `lib/game/train/ghost.js:53-60` (`situationDistance`)
- Test: `test/tools/ghost.test.js`

**Interfaces:**
- Consumes: `baseVariantId(variantId)` from `lib/game/rosters.js` — already exists, maps `'7-nickel' → '7'`.
- Produces: `situationDistance(a, b)` unchanged in signature; `Infinity` now only when the *base* variants differ, or when the side is `'defense'` and the full variants differ.

- [ ] **Step 1: Write the failing tests**

Append to `test/tools/ghost.test.js`:

```js
test('an offense ghost matches across personnel packages', () => {
  const a = { down: 1, toGo: 10, losYard: 20, turnIndex: 0, variant: '7', side: 'offense' };
  const b = { ...a, variant: '7-nickel' };
  assert.ok(Number.isFinite(situationDistance(a, b)));
  // The package is not a difference it should pay for, either.
  assert.equal(situationDistance(a, b), situationDistance(a, { ...a }));
});

test('a defense ghost does not match across personnel packages', () => {
  const a = { down: 1, toGo: 10, losYard: 20, turnIndex: 0, variant: '7', side: 'defense' };
  const b = { ...a, variant: '7-nickel' };
  assert.equal(situationDistance(a, b), Infinity);
});

test('neither side matches across base variants', () => {
  for (const side of ['offense', 'defense']) {
    const a = { down: 1, toGo: 10, losYard: 20, turnIndex: 0, variant: '7', side };
    assert.equal(situationDistance(a, { ...a, variant: '11' }), Infinity);
    assert.equal(situationDistance(a, { ...a, variant: '11-nickel' }), Infinity);
  }
});
```

If `situationDistance` is not already imported at the top of that file, add it to the existing import from `../../tools/ghost.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/tools/ghost.test.js`
Expected: FAIL — the first test fails on `Infinity` not being finite.

- [ ] **Step 3: Write the implementation**

In `lib/game/train/ghost.js`, add `baseVariantId` to the imports:

```js
import { baseVariantId } from '../rosters.js';
```

Replace the body of `situationDistance` (keeping the rest of the function as it is):

```js
export function situationDistance(a, b) {
  // Seven-man football is not a nearer version of eleven-man football: the
  // ids in one call would half-apply to the other. That is what the base
  // variant compares, and it is all it should compare for an OFFENSE ghost —
  // '7', '7-nickel' and '7-dime' field the identical SEVEN_OFFENSE, and
  // differ only in the defensive package, so a call recorded against nickel
  // is the same call. A DEFENSE ghost keeps the strict comparison, because
  // there the package IS the difference: applySnapshot would quietly skip
  // every id the package on the field does not have a body for.
  if (baseVariantId(a.variant) !== baseVariantId(b.variant)) return Infinity;
  if (a.side === 'defense' && a.variant !== b.variant) return Infinity;
  return SITUATION_WEIGHTS.turnIndex * Math.abs(a.turnIndex - b.turnIndex)
    + SITUATION_WEIGHTS.down * Math.abs(a.down - b.down)
    + SITUATION_WEIGHTS.toGo * Math.abs(a.toGo - b.toGo)
    + SITUATION_WEIGHTS.losYard * Math.abs(a.losYard - b.losYard);
}
```

Also update the JSDoc above it, which currently says "Infinity across variants":

```js
/**
 * How unlike each other two situations are. Infinity across BASE variants,
 * because a call made with eleven men on the field is not a nearer version of
 * a seven-man call — it is a call for a different set of bodies, and the ids
 * in it would half-apply. A personnel package is not that: see the body.
 */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/tools/ghost.test.js`
Expected: PASS, and every pre-existing test in the file still passes.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS. Watch `test/tools/train-vs-ghost.test.js` in particular — it exercises the lookup end to end.

- [ ] **Step 6: Commit**

```bash
git add lib/game/train/ghost.js test/tools/ghost.test.js
git commit -m "fix: a call against nickel is the same call, to an offense ghost"
```

---

### Task 2: `lib/game/read.js` and the frozen look

The percept, its one call site, and its reset. The read it carries is a zero for now — Task 4 gives it cues. `state.aiPlay` is untouched here and moves in Task 3.

**Files:**
- Create: `lib/game/read.js`
- Create: `test/game/read.test.js`
- Modify: `lib/game/turn.js` (imports, and the line above `coachAi(state)` at `:63`)
- Modify: `lib/game/state.js:162` (the `aiPlay: null` initializer's neighbourhood — add `playRead: null`)
- Modify: `lib/game/rules.js:272` (add `state.playRead = null` beside `state.aiPlay = null`)

**Interfaces:**
- Consumes: `onTheLine(state, player)` from `lib/game/formation.js`; `SIDELINE_LEFT`, `SIDELINE_RIGHT` from `lib/field/geometry.js`; `activeGenome(state, side)` from `lib/game/learned/active.js`.
- Produces:
  - `snapLook(state) → {spread: number, backs: number, qbDepth: number}` — all normalized; `qbDepth` is in **yards** and is the reference the cues measure against, not a gate input.
  - `readCues(state, look) → {qbDepth: number, lineFlow: number, ballAir: number}` — each held to `[-1,1]`, positive is a pass key.
  - `advanceRead(look, prev, cues, genome) → {pass: number, confidence: number, committed: boolean}`; `prev === null` means the snap.
  - `advancePlay(state, genome) → void` — builds `state.playRead` when it is null, advances its `read` otherwise.
  - `state.playRead = {look, read, call: {offense, defense}}`.

**Note on `look.qbDepth`:** the spec names two look features. This adds a third field which is **not** a gate feature — `schemeFeatures` still takes only `spread` and `backs` (Task 5). It exists because the quarterback already stands about six yards deep at the snap, so a cue measuring his absolute depth would read "pass" on every play including a run. The cue measures how much deeper he has got than he started, and this is the reference.

- [ ] **Step 1: Write the failing tests**

Create `test/game/read.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapLook, advanceRead, advancePlay } from '../../lib/game/read.js';
import { createGame } from '../../lib/game/state.js';
import { makeGenome } from '../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { fieldPos } from '../../lib/game/view.js';

const inert = () => makeGenome(DEFENSE_SPEC);

test('snapLook measures the offense it is handed', () => {
  const s = createGame({ seed: 1 });
  const look = snapLook(s);
  assert.ok(look.spread > 0 && look.spread <= 1);
  assert.ok(look.backs >= 0 && look.backs <= 1);
  // The quarterback lines up behind the line, so the reference is positive.
  assert.ok(look.qbDepth > 0);
});

test('advancePlay builds the percept on the turn it finds none', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.playRead, null);
  advancePlay(s, inert());
  assert.deepEqual(s.playRead.look, snapLook(s));
  assert.deepEqual(s.playRead.call, { offense: null, defense: null });
  assert.equal(s.playRead.read.pass, 0);
});

test('the look is frozen: scattering the offense does not move it', () => {
  const s = createGame({ seed: 1 });
  advancePlay(s, inert());
  const before = { ...s.playRead.look };
  // Sweep the whole offense to one sideline — a live measurement would jump.
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 6);
  }
  advancePlay(s, inert());
  assert.deepEqual(s.playRead.look, before);
});

test('an inert genome reads nothing and commits to nothing', () => {
  const s = createGame({ seed: 1 });
  const g = inert();
  advancePlay(s, g);
  for (let i = 0; i < 5; i++) advancePlay(s, g);
  assert.equal(s.playRead.read.pass, 0);
  assert.equal(s.playRead.read.confidence, 0);
  assert.equal(s.playRead.read.committed, false);
});

test('the percept is built hot-seat, with no aiTeam at all', () => {
  // Every play the training harness ever scores is this: aiTeam null, both
  // sides coached by the harness itself. A percept that needed an aiTeam
  // would be missing from all of them.
  const s = createGame({ seed: 1 });
  assert.equal(s.aiTeam, null);
  advancePlay(s, inert());
  assert.ok(s.playRead);
  advancePlay(s, inert());
  assert.ok(s.playRead.read);
});

test('advanceRead at the snap is the prior and the look, and nothing else', () => {
  const g = { ...inert(), 'read:prior': 0.5, 'read:spread': 2, 'read:backs': -1 };
  const look = { spread: 0.25, backs: 0.5, qbDepth: 6 };
  const r = advanceRead(look, null, null, g);
  assert.equal(r.pass, 0.5 + 2 * 0.25 + -1 * 0.5); // 0.5
  assert.equal(r.confidence, Math.tanh(0.5));
  assert.equal(r.committed, false); // read:commit inits at 8
});

test('confidence is bounded and committed follows read:commit', () => {
  const g = { ...inert(), 'read:prior': 4, 'read:commit': 1 };
  const r = advanceRead({ spread: 0, backs: 0, qbDepth: 6 }, null, null, g);
  assert.ok(r.confidence < 1);
  assert.equal(r.committed, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/read.test.js`
Expected: FAIL — `Cannot find module '../../lib/game/read.js'`.

- [ ] **Step 3: Write the module**

Create `lib/game/read.js`:

```js
/**
 * What the defense makes of the down it is in.
 *
 * The brains are called once a turn and, before this file, answered from
 * whatever was in front of them at that instant: the man/zone gate re-read a
 * spread that grows as men scatter, so a coverage call could flip in the
 * middle of a play, and the coverage assignment re-ran its greedy claim every
 * turn, so a defender could hand his man off between turn one and turn two.
 * Neither was a decision anybody made.
 *
 * This is the down as one object instead — the look it snapped against, a read
 * of what the play is, and the call it committed to — advanced once per turn
 * by turn.js and cleared by rules.js at every whistle.
 *
 * PURE and dice-free, like defense.js and zone.js beside it. The read is
 * fallible but it is not random: it is fooled because the evidence in front of
 * it genuinely says the wrong thing for a turn, which is both honest football
 * and the only version the training harness could reproduce from a seed.
 *
 * THE RULE THIS FILE RESTS ON: it may never look at the opponent's ORDERS —
 * not `plan`, not `cover`, not `mode`, not `state.plannedPass`. Positions,
 * velocities and the ball, and nothing else. advancePlay runs before coachAi,
 * so the board still holds the human's drawn arrows; a read that looked at
 * them would diagnose the play call off the arrows themselves, be perfect on
 * turn zero, and make play-action impossible by construction. A fake has to be
 * visible only as MOTION, one turn late.
 */
import { SNAP_TARGET_ID } from './state.js';
import { onTheLine } from './formation.js';
import { maxSpeed } from './modes.js';
import { yardsOfY } from './view.js';
import { OFFENSIVE_LINE_ROLES } from './rosters.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT } from '../field/geometry.js';
import { READ_DROP_YARDS } from './constants.js';

/** Held to [-1,1], so that one genome range serves every cue and no raw yard
 *  count can swamp the accumulator on its own. */
const clamp1 = (v) => Math.max(-1, Math.min(1, v));

/** How deep behind the line this man is, in yards. The offense advances in
 *  +y, so behind the line is a smaller y and therefore a positive depth. */
function depthYards(state, p) {
  return state.losYard - yardsOfY(p.pos.y);
}

/**
 * The picture the down started from, frozen at the top of turn 0.
 *
 * `spread` and `backs` are the two the scheme gate reads, and they are
 * deliberately the same two numbers formation.js's learnedPersonnel already
 * computes off a look — the same question, asked once and kept.
 *
 * `qbDepth` is NOT a gate feature. It is the reference the qbDepth cue
 * measures against: the quarterback already stands about six yards deep at
 * the snap, so a cue reading his absolute depth would call every play a pass.
 * What separates a drop from a run is how much deeper he gets than this.
 */
export function snapLook(state) {
  const them = state.players.filter((p) => p.team === 'offense');
  const xs = them.map((p) => p.pos.x);
  const qb = them.find((p) => p.id === SNAP_TARGET_ID);
  const width = SIDELINE_RIGHT - SIDELINE_LEFT;
  return {
    spread: xs.length ? (Math.max(...xs) - Math.min(...xs)) / width : 0,
    backs: them.length ? them.filter((p) => !onTheLine(state, p)).length / them.length : 0,
    qbDepth: qb ? depthYards(state, qb) : 0,
  };
}

/**
 * What the last turn's physics left on the field, as evidence. Positive is a
 * pass key in every one of them.
 *
 * qbDepth  — how much deeper than the snap the quarterback has got. A real
 *            drop goes backwards; the option's fake boots him FORWARD, which
 *            is why the give does not read as a pass.
 * lineFlow — the line's mean speed downfield, negated. Run blocking drives
 *            downfield, pass protection sets and holds.
 * ballAir  — nobody is carrying it. Usefully NOT conclusive: a direct snap to
 *            the back is a setPass too, so the give looks like a throw for
 *            exactly one turn. That is the mesh point, and it costs nothing.
 */
export function readCues(state, look) {
  const them = state.players.filter((p) => p.team === 'offense');
  const qb = them.find((p) => p.id === SNAP_TARGET_ID);
  const line = them.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role));
  const flow = line.length
    ? line.reduce((sum, p) => sum + p.vel.y / maxSpeed(p), 0) / line.length
    : 0;
  return {
    qbDepth: qb ? clamp1((depthYards(state, qb) - look.qbDepth) / READ_DROP_YARDS) : 0,
    lineFlow: clamp1(-flow),
    ballAir: state.ball.carrierId === null ? 1 : 0,
  };
}

/**
 * The belief, one turn on. Positive is pass.
 *
 * At the snap (`prev === null`) there are no cues, because nothing has moved:
 * the read is the genome's prior and the look, which is the order a defense
 * really does get its information in. After that each turn keeps
 * `read:inertia` of what it believed and adds what it has just seen — which is
 * where being fooled lives. At inertia 1 it never forgets and stays wrong for
 * turns; at 0 it is jumpy and commits to nothing.
 */
export function advanceRead(look, prev, cues, genome) {
  const z = prev === null
    ? genome['read:prior']
      + genome['read:spread'] * look.spread
      + genome['read:backs'] * look.backs
    : genome['read:inertia'] * prev.pass
      + genome['read:qbDepth'] * cues.qbDepth
      + genome['read:lineFlow'] * cues.lineFlow
      + genome['read:ballAir'] * cues.ballAir;
  return {
    pass: z,
    confidence: Math.tanh(Math.abs(z)),
    committed: Math.abs(z) > genome['read:commit'],
  };
}

/**
 * The down, one turn on. turn.js is the only caller, and calls it
 * UNCONDITIONALLY — never gated on state.aiTeam, because the training harness
 * runs hot-seat with no aiTeam at all and coaches both sides itself, so a
 * percept that needed one would be missing from every play a genome is scored
 * on.
 *
 * Built here rather than in rules.js's nextDown because nextDown ends before
 * the planning phase does: the coach then spends it dragging people around,
 * and a look frozen back there would be a picture nobody ever lined up in.
 */
export function advancePlay(state, genome) {
  if (!state.playRead) {
    const look = snapLook(state);
    state.playRead = {
      look,
      read: advanceRead(look, null, null, genome),
      call: { offense: null, defense: null },
    };
    return;
  }
  const { look, read } = state.playRead;
  state.playRead.read = advanceRead(look, read, readCues(state, look), genome);
}
```

- [ ] **Step 4: Add the normalization constant**

In `lib/game/constants.js`, beside the other AI constants, add:

```js
/**
 * The drop that counts as a full pass key, in yards — the scale read.js
 * divides the quarterback's added depth by, so that one genome range serves
 * that cue and the two beside it. Not a learned number: it is the unit the
 * learned weight is denominated in.
 */
export const READ_DROP_YARDS = 5;
```

- [ ] **Step 5: Add the state field**

In `lib/game/state.js`, immediately after the `aiPlay: null` line at `:162` and its comment block, add:

```js
    // The down as one object, or null before the first turn of it has begun:
    // {look, read, call} — see lib/game/read.js, which is the only writer.
    // Per-down like plannedPass, and cleared by nextDown for the same reason.
    playRead: null,
```

- [ ] **Step 6: Clear it on a new down**

In `lib/game/rules.js`, beside `state.aiPlay = null;` at `:272`, add:

```js
  state.playRead = null;
```

- [ ] **Step 7: Wire the one call site**

In `lib/game/turn.js`, add to the imports:

```js
import { advancePlay } from './read.js';
import { activeGenome } from './learned/active.js';
```

and immediately above `coachAi(state);` at `:63`, above its existing comment block, add:

```js
  // The down's percept first, so the brains below read a fresh one — and
  // BEFORE coachAi, which is what keeps the computer from reading its own
  // intentions as evidence: clearAiPlans wiped them at the last whistle and
  // nothing has written new ones yet. Unconditional: the training harness
  // runs hot-seat, with no aiTeam at all.
  advancePlay(state, activeGenome(state, 'defense'));
```

- [ ] **Step 8: Run the tests**

Run: `node --test test/game/read.test.js`
Expected: PASS.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS. Nothing reads `playRead` yet, so no behaviour has changed; if `test/game/turn.test.js` or `test/game/state.test.js` fails, it is because a test asserts on the exact shape of a state object — update the expectation, do not remove the field.

- [ ] **Step 10: Commit**

```bash
git add lib/game/read.js test/game/read.test.js lib/game/turn.js lib/game/state.js lib/game/rules.js lib/game/constants.js
git commit -m "feat: the down is an object, and it starts with the look"
```

---

### Task 3: Fold `state.aiPlay` into `call.offense`

A rename with no behavioural change, now that the container exists. Two notions of "the play" stop living side by side.

**Files:**
- Modify: `lib/game/learned/offense-policy.js:225` (comment), `:247` (the write), `:254` (the read)
- Modify: `lib/game/autoplan.js:61` (comment), `:71` (the read)
- Modify: `lib/game/state.js:162` (remove `aiPlay: null` and its comment)
- Modify: `lib/game/rules.js:272` (remove `state.aiPlay = null;`)
- Test: `test/game/learned/offense-policy.test.js`, `test/game/autoplan.test.js`

**Interfaces:**
- Consumes: `state.playRead.call` from Task 2.
- Produces: `state.playRead.call.offense` holds `{call: 'run'|'pass', side?: number, give?: boolean}` — the object `planLearnedRun` and `planLearnedPassSnap` already return. `state.aiPlay` no longer exists.

**Ordering note:** `coachLearnedOffense` runs inside `coachAi`, which `turn.js` calls *after* `advancePlay`, so `state.playRead` is always non-null by the time the offense writes its call. The training harness's coaches, however, run *before* `runTurn` (see `playOnePlay`), so they can see a null `playRead` on turn 0. Both writers below therefore go through one helper that tolerates it.

- [ ] **Step 1: Write the failing test**

Append to `test/game/learned/offense-policy.test.js`:

```js
test('the learned offense records its call on the down, not on a field of its own', () => {
  const s = createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' });
  advancePlay(s, makeGenome(DEFENSE_SPEC));
  coachLearnedOffense(s, OFFENSE_GENOME.values);
  assert.equal(s.aiPlay, undefined);
  assert.ok(['run', 'pass'].includes(s.playRead.call.offense.call));
});

test('the offense call survives into a later turn', () => {
  const s = createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' });
  advancePlay(s, makeGenome(DEFENSE_SPEC));
  coachLearnedOffense(s, OFFENSE_GENOME.values);
  const called = s.playRead.call.offense;
  s.turnIndex = 1;
  coachLearnedOffense(s, OFFENSE_GENOME.values);
  assert.deepEqual(s.playRead.call.offense, called);
});
```

Add whatever imports that file is missing: `advancePlay` from `../../../lib/game/read.js`, `makeGenome` from `../../../lib/game/learned/genome.js`, `DEFENSE_SPEC` from `../../../lib/game/learned/defense-spec.js`, `OFFENSE_GENOME` from `../../../lib/game/learned/offense-genome.js`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/learned/offense-policy.test.js`
Expected: FAIL — `s.aiPlay` is an object, not `undefined`.

- [ ] **Step 3: Add the accessor pair to `read.js`**

Append to `lib/game/read.js`:

```js
/**
 * The call one side committed to this down, and the way to set it.
 *
 * Tolerant of a missing percept on purpose: the training harness coaches both
 * sides BEFORE runTurn (see playOnePlay), so a coach can be the first thing to
 * touch a fresh down, ahead of advancePlay. Rather than make every caller
 * check, the setter builds the down the same way advancePlay would — the look
 * is the same look, because nothing has moved yet.
 */
export function calledPlay(state, side) {
  return state.playRead ? state.playRead.call[side] : null;
}

export function setCalledPlay(state, side, play) {
  if (!state.playRead) {
    const look = snapLook(state);
    state.playRead = {
      look,
      read: { pass: 0, confidence: 0, committed: false },
      call: { offense: null, defense: null },
    };
  }
  state.playRead.call[side] = play;
}
```

- [ ] **Step 4: Move the offense's write and read**

In `lib/game/learned/offense-policy.js`, add to the imports:

```js
import { calledPlay, setCalledPlay } from '../read.js';
```

Replace line `:247`'s statement:

```js
    setCalledPlay(state, 'offense', chooseCall(state, genome) === 'pass'
      ? planLearnedPassSnap(state, genome)
      : planLearnedRun(state, genome));
```

Replace line `:254`'s condition:

```js
  if (calledPlay(state, 'offense')?.call === 'pass' && qb && car.id === qb.id) {
```

Update the header comment at `:225`, replacing "state.aiPlay" with "the down's own call (read.js's setCalledPlay)".

- [ ] **Step 5: Move autoplan's read**

In `lib/game/autoplan.js`, add `calledPlay` to its imports from `./read.js`, replace `:71`:

```js
    const play = calledPlay(state, 'offense');
```

and update the comment at `:61`, replacing "state.aiPlay" with "the down's own call".

- [ ] **Step 6: Delete the old field**

In `lib/game/state.js`, delete the `aiPlay: null,` line at `:162` and the comment block above it that describes it. In `lib/game/rules.js`, delete `state.aiPlay = null;` at `:272`.

- [ ] **Step 7: Run the tests**

Run: `node --test test/game/learned/offense-policy.test.js test/game/autoplan.test.js`
Expected: PASS.

- [ ] **Step 8: Verify nothing still names the old field**

Run: `grep -rn "aiPlay" lib app tools test`
Expected: no output.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: the offense's call is part of the down, not a field beside it"
```

---

### Task 4: The nine genome keys, and cues that move the read

The keys, and the cue wiring that makes them mean something. Everything stays inert at init.

**Files:**
- Modify: `lib/game/learned/defense-spec.js` (append to the final `F.push(...)`)
- Test: `test/game/learned/defense-spec.test.js`, `test/game/read.test.js`

**Interfaces:**
- Consumes: `readCues(state)` and `advanceRead(...)` from Task 2.
- Produces: nine keys on `DEFENSE_SPEC` — `read:prior`, `read:spread`, `read:backs`, `read:inertia`, `read:qbDepth`, `read:lineFlow`, `read:ballAir`, `read:commit`, `read:trigger`.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/learned/defense-spec.test.js`:

```js
test('the read keys are inert at init', () => {
  const g = makeGenome(DEFENSE_SPEC);
  for (const key of ['read:prior', 'read:spread', 'read:backs', 'read:inertia',
    'read:qbDepth', 'read:lineFlow', 'read:ballAir', 'read:trigger']) {
    assert.equal(g[key], 0, `${key} must start at zero`);
  }
  // The commit bar starts at its own ceiling, so nothing ever crosses it.
  const commit = DEFENSE_SPEC.find((p) => p.key === 'read:commit');
  assert.equal(g['read:commit'], commit.max);
});
```

Append to `test/game/read.test.js`:

```js
test('a quarterback dropping back reads pass, and the option keep does not', () => {
  const g = { ...inert(), 'read:qbDepth': 1 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g);
  const qb = s.players.find((p) => p.id === 'o-qb');
  const started = qb.pos.y;

  // Five yards further from the line: a full drop.
  qb.pos = { x: qb.pos.x, y: started - 5 * (fieldPos(0, 1).y - fieldPos(0, 0).y) };
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass > 0, 'a drop is a pass key');

  // Reset the belief, then send him forward instead: the option's fake.
  s.playRead = null;
  advancePlay(s, g);
  qb.pos = { x: qb.pos.x, y: started + 2 * (fieldPos(0, 1).y - fieldPos(0, 0).y) };
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass < 0, 'running forward is a run key');
});

test('a line driving downfield reads run', () => {
  const g = { ...inert(), 'read:lineFlow': 1 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g);
  for (const p of s.players) {
    if (p.team === 'offense') p.vel = { x: 0, y: 3 }; // downfield, hard
  }
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass < 0);
});

test('a loose ball reads pass, whoever let go of it', () => {
  const g = { ...inert(), 'read:ballAir': 1 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g);
  s.ball = { carrierId: null, pos: fieldPos(0, s.losYard), vel: { x: 0, y: 1 } };
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass > 0);
});

test('inertia is what play-action fools: run keys stick after they stop', () => {
  const g = { ...inert(), 'read:lineFlow': 2, 'read:inertia': 0.9, 'read:commit': 0.5 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g);
  // Turn 1: the line drives. Run keys, hard.
  for (const p of s.players) if (p.team === 'offense') p.vel = { x: 0, y: 3 };
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass < 0 && s.playRead.read.committed);
  // Turn 2: everything stops — the fake is over and it was a pass all along.
  for (const p of s.players) if (p.team === 'offense') p.vel = { x: 0, y: 0 };
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass < 0, 'he is still wrong, which is the point');
});

test('the read never looks at the orders', () => {
  const g = { ...inert(), 'read:qbDepth': 1, 'read:lineFlow': 1, 'read:ballAir': 1 };
  const drawn = createGame({ seed: 1 });
  const bare = createGame({ seed: 1 });
  // Draw a whole passing play on one of them and nothing on the other. No
  // physics has run, so the two boards are physically identical.
  const qb = drawn.players.find((p) => p.id === 'o-qb');
  setPlan(drawn, qb.id, { x: 0, y: -1 }, 1);
  for (const p of drawn.players) {
    if (p.team === 'offense' && p.id !== qb.id) setPlan(drawn, p.id, { x: 0, y: 1 }, 1);
  }
  advancePlay(drawn, g);
  advancePlay(bare, g);
  advancePlay(drawn, g);
  advancePlay(bare, g);
  assert.deepEqual(drawn.playRead.read, bare.playRead.read);
});
```

Add `setPlan` to that file's import from `../../lib/game/state.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/read.test.js test/game/learned/defense-spec.test.js`
Expected: FAIL — the genome has no `read:*` keys, so `advanceRead` reads `undefined` and `pass` comes out `NaN`.

- [ ] **Step 3: Add the keys**

In `lib/game/learned/defense-spec.js`, inside the final `F.push(` call, before its closing `);`, append:

```js
  // What the defense makes of the play it is looking at (lib/game/read.js).
  // The read is a signed accumulator in logit units, positive for pass:
  //
  //   z0 = prior + spread*look.spread + backs*look.backs
  //   zt = inertia*z(t-1) + qbDepth*cue + lineFlow*cue + ballAir*cue
  //
  // Every weight is zero at init and the commit bar starts at its own
  // ceiling, so an untrained genome reads nothing, commits to nothing, and
  // plays byte for byte the defense that shipped before any of this existed —
  // the same discipline the adapt:* pulls above keep, and for the same reason.
  { key: 'read:prior', min: -4, max: 4, init: 0 },
  { key: 'read:spread', min: -4, max: 4, init: 0 },
  { key: 'read:backs', min: -4, max: 4, init: 0 },
  // How much of last turn's belief carries into this one. This is the knob
  // play-action turns: at 1 he never forgets and stays wrong for turns.
  { key: 'read:inertia', min: 0, max: 1, init: 0 },
  { key: 'read:qbDepth', min: -4, max: 4, init: 0 },
  { key: 'read:lineFlow', min: -4, max: 4, init: 0 },
  { key: 'read:ballAir', min: -4, max: 4, init: 0 },
  // How sure he must be before he acts on it at all.
  { key: 'read:commit', min: 0, max: 8, init: 8 },
  // Yards the second level gives ground on a committed pass read, at full
  // confidence. The run half of the trigger needs no number: it drops
  // coverage or it does not.
  { key: 'read:trigger', min: 0, max: 10, init: 0 },
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/game/read.test.js test/game/learned/defense-spec.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS. `test/game/learned/genome.test.js` may assert a spec length — update the number, do not delete the assertion.

- [ ] **Step 6: Commit**

```bash
git add lib/game/learned/defense-spec.js test/game/learned/defense-spec.test.js test/game/read.test.js
git commit -m "feat: nine numbers for what the defense makes of a play"
```

---

### Task 5: The scheme is called once, off the look

**Files:**
- Modify: `lib/game/learned/defense-policy.js` (`schemeFeatures`, `schemeChoice`, `learnedOrders`)
- Modify: `lib/game/autoplan.js` (`defenseNote`'s `schemeChoice` call)
- Test: `test/game/learned/defense-policy.test.js`, `test/game/ai-learned.test.js`

**Interfaces:**
- Consumes: `state.playRead.look` from Task 2; `snapLook(state)` for the fallback.
- Produces: `schemeFeatures(state, look)` — **signature changed**, takes the frozen look as its second argument. `schemeChoice(state, genome, tendencies, look)` — fourth argument, defaulting to `snapLook(state)`. `state.playRead.call.defense = {scheme: 'man'|'zone', cover: Map}` — `cover` is filled in Task 6.

- [ ] **Step 1: Write the failing test**

Append to `test/game/learned/defense-policy.test.js`:

```js
test('the scheme is called once and does not flip when men scatter', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  // A gate that answers purely to spread: wide reads zone, tight reads man.
  const g = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': -2, 'scheme:spread': 8 };
  advancePlay(s, g);
  learnedOrders(s, 'defense', g);
  const called = s.playRead.call.defense.scheme;

  // Now sweep the offense to both sidelines — a live gate would flip to zone.
  const half = s.players.filter((p) => p.team === 'offense');
  half.forEach((p, i) => { p.pos = fieldPos(i % 2 ? 26 : -26, s.losYard - 1); });
  advancePlay(s, g);
  learnedOrders(s, 'defense', g);
  assert.equal(s.playRead.call.defense.scheme, called);
});
```

Add `advancePlay` (from `../../../lib/game/read.js`) and `fieldPos` (from `../../../lib/game/view.js`) to that file's imports if missing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/learned/defense-policy.test.js`
Expected: FAIL — `s.playRead.call.defense` is `null`.

- [ ] **Step 3: Change the two pure functions**

In `lib/game/learned/defense-policy.js`, add to the imports:

```js
import { snapLook } from '../read.js';
```

Replace `schemeFeatures` and `schemeChoice`:

```js
/**
 * The situation, each part squashed to roughly [0,1]: which down it is, how
 * much of a fresh set of downs is still to gain, and how wide the offense was
 * standing WHEN IT SNAPPED.
 *
 * `look` is read.js's frozen picture, and taking spread from there rather than
 * measuring it live is what stops the man/zone call flipping in the middle of
 * a play: men scatter, so a live width grows all down long, and a gate reading
 * it would answer a different question every turn. A scheme is a pre-snap
 * call. Coarse on purpose — a gate with three inputs can be learned from a few
 * thousand plays; one with thirty cannot.
 */
export function schemeFeatures(state, look) {
  return {
    down: (state.down - 1) / 3,
    toGo: Math.min(1, (state.toGoYard - state.losYard) / 10),
    spread: look.spread,
  };
}

export function schemeChoice(state, genome, tendencies = null, look = snapLook(state)) {
  const f = schemeFeatures(state, look);
  const z = genome['scheme:bias']
    + genome['scheme:down'] * f.down
    + genome['scheme:toGo'] * f.toGo
    + genome['scheme:spread'] * f.spread
    + schemeShade(tendencies);
  return z > 0 ? 'zone' : 'man';
}
```

Delete the now-unused `SIDELINE_LEFT`/`SIDELINE_RIGHT` imports **only if** nothing else in the file uses them — check with `grep -n "SIDELINE" lib/game/learned/defense-policy.js` before removing.

- [ ] **Step 4: Have `learnedOrders` commit the scheme**

In `lib/game/learned/defense-policy.js`, add above `learnedOrders`:

```js
/**
 * The down's percept, or a stand-in built from the field.
 *
 * A state that never went through runTurn — an old save, a hand-rolled test
 * object, a caller that reaches for learnedOrders directly — carries no
 * playRead. Rather than refuse to play, this hands back a look measured now
 * and a read that believes nothing, which is exactly the defense this file
 * played before any of it existed.
 */
function percept(state) {
  return state.playRead ?? {
    look: snapLook(state),
    read: { pass: 0, confidence: 0, committed: false },
    call: { offense: null, defense: null },
  };
}

/**
 * The scheme this down is being played in, called ONCE. The first turn that
 * asks decides it and writes it down; every turn after reads it back. A
 * defense does not switch from man to zone in the middle of a play, and
 * before this it could, because the gate was re-run against a picture that
 * had moved.
 */
function committedScheme(state, genome, tendencies) {
  const p = percept(state);
  if (!p.call.defense) {
    p.call.defense = { scheme: schemeChoice(state, genome, tendencies, p.look), cover: null };
  }
  return p.call.defense.scheme;
}
```

Then in `learnedOrders`, replace:

```js
  const scheme = schemeChoice(state, genome, tendencies);
```

with:

```js
  const scheme = committedScheme(state, genome, tendencies);
```

- [ ] **Step 5: Fix autoplan's reporter**

In `lib/game/autoplan.js`'s `defenseNote`, replace `schemeChoice(state, genome, null)` with:

```js
  return schemeChoice(state, genome, null, state.playRead?.look) === 'zone'
```

Note `schemeChoice`'s fourth parameter defaults when passed `undefined`, so a state with no percept still reports correctly.

- [ ] **Step 6: Run the tests**

Run: `node --test test/game/learned/defense-policy.test.js test/game/ai-learned.test.js test/game/autoplan.test.js`
Expected: PASS. `test/game/ai-learned.test.js` has six references to these functions; any that call `schemeFeatures(state)` need a second argument — pass `snapLook(state)`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: the coverage call is made at the snap and it is kept"
```

---

### Task 6: Assignments are made once and held

**Files:**
- Modify: `lib/game/learned/defense-policy.js` (`learnedOrders`)
- Test: `test/game/learned/defense-policy.test.js`

**Interfaces:**
- Consumes: `percept(state)` and `committedScheme(...)` from Task 5.
- Produces: `state.playRead.call.defense.cover` — a `Map` of defender id to receiver id, built once by `learnedCoverAssignments` and reused every turn after.

- [ ] **Step 1: Write the failing test**

Append to `test/game/learned/defense-policy.test.js`:

```js
test('a defender keeps the man he took, even when somebody nearer appears', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': -4 }; // firmly man
  advancePlay(s, g);
  const first = learnedOrders(s, 'defense', g);
  const covers = (orders) => Object.fromEntries(
    orders.filter((o) => o.cover).map((o) => [o.id, o.cover]),
  );
  const before = covers(first);
  assert.ok(Object.keys(before).length > 0, 'somebody must be covering somebody');

  // Swap the receivers' positions: a greedy re-claim would re-pair them.
  const wr1 = s.players.find((p) => p.id === 'o-wr1');
  const wr2 = s.players.find((p) => p.id === 'o-wr2');
  const held = wr1.pos;
  wr1.pos = wr2.pos;
  wr2.pos = held;

  advancePlay(s, g);
  assert.deepEqual(covers(learnedOrders(s, 'defense', g)), before);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/learned/defense-policy.test.js`
Expected: FAIL — the assignments re-pair when the receivers swap.

- [ ] **Step 3: Write the implementation**

In `lib/game/learned/defense-policy.js`, add beside `committedScheme`:

```js
/**
 * Who has whom this down, decided ONCE. The greedy claim runs on the first
 * turn that asks and the map is kept; before this it re-ran every turn, so a
 * defender could hand his man to somebody else between turn one and turn two
 * without anyone deciding he should.
 *
 * No re-assignment logic is needed and none is here. If the man being covered
 * ends up with the ball, learnedOrders' own guards take the whole defense over
 * before this is ever consulted.
 */
function committedCover(state, team, genome, tendencies) {
  const p = percept(state);
  if (!p.call.defense.cover) {
    p.call.defense.cover = learnedCoverAssignments(state, team, genome, tendencies);
  }
  return p.call.defense.cover;
}
```

In `learnedOrders`, replace:

```js
  const man = scheme === 'man'
    ? learnedCoverAssignments(state, team, genome, tendencies)
    : new Map();
```

with:

```js
  const man = scheme === 'man'
    ? committedCover(state, team, genome, tendencies)
    : new Map();
```

`committedScheme` runs first and always writes `call.defense`, so `committedCover` can rely on it being there.

- [ ] **Step 4: Run the tests**

Run: `node --test test/game/learned/defense-policy.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/game/learned/defense-policy.js test/game/learned/defense-policy.test.js
git commit -m "feat: a man taken at the snap is the man you have all down"
```

---

### Task 7: The trigger

Where the read finally bites. Committed to run, the second level drops coverage and goes to the ball; committed to pass, it gives ground.

**Files:**
- Modify: `lib/game/learned/defense-policy.js` (`learnedOrders`)
- Test: `test/game/learned/defense-policy.test.js`

**Interfaces:**
- Consumes: `percept(state).read` from Task 5. `leverageAim`, `interceptPoint`, `deepMan`, `positionGroup`, `defendDir` and `UNITS_PER_YARD_X` are all already imported by `defense-policy.js`; `getPlayer` is not, and Step 3 adds it.
- Produces: no new exported names. `learnedOrders`' returned orders change shape for triggered defenders only: a `{cover}` order becomes an `{aim}` order on a run read.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/learned/defense-policy.test.js`:

```js
test('a committed run read pulls the second level off its men', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': -4 };
  advancePlay(s, g);
  const covering = learnedOrders(s, 'defense', g).filter((o) => o.cover).length;
  assert.ok(covering > 0);

  // Force the belief to a committed RUN (negative is run).
  s.playRead.read = { pass: -5, confidence: Math.tanh(5), committed: true };
  const after = learnedOrders(s, 'defense', g);
  assert.equal(after.filter((o) => o.cover).length, 0, 'they have all left their men');
  for (const o of after) assert.ok(o.aim, 'and every one of them has somewhere to be');
});

test('a committed pass read gives ground, by read:trigger yards', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': 4, 'read:trigger': 6 };
  advancePlay(s, g);
  const flat = new Map(learnedOrders(s, 'defense', g).map((o) => [o.id, o.aim]));

  s.playRead.read = { pass: 5, confidence: 1, committed: true };
  const deep = new Map(learnedOrders(s, 'defense', g).map((o) => [o.id, o.aim]));

  // At least one non-lineman's aim moved further from the line of scrimmage.
  const moved = [...deep].filter(([id, aim]) => {
    const p = getPlayer(s, id);
    return aim && flat.get(id) && positionGroup(p) !== 'line'
      && aim.y > flat.get(id).y; // the defense defends toward +y
  });
  assert.ok(moved.length > 0);
});

test('the rushing line is never triggered', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...makeGenome(DEFENSE_SPEC), 'read:trigger': 6 };
  advancePlay(s, g);
  const before = new Map(learnedOrders(s, 'defense', g).map((o) => [o.id, o.aim]));
  s.playRead.read = { pass: 5, confidence: 1, committed: true };
  for (const o of learnedOrders(s, 'defense', g)) {
    if (positionGroup(getPlayer(s, o.id)) === 'line') {
      assert.deepEqual(o.aim, before.get(o.id));
    }
  }
});
```

Add `getPlayer` (from `../../../lib/game/state.js`) and `positionGroup` (from `../../../lib/game/defense.js`) to that file's imports if missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/learned/defense-policy.test.js`
Expected: FAIL — the orders are identical whatever the read says.

- [ ] **Step 3: Write the implementation**

In `lib/game/learned/defense-policy.js`, the import block at `:18-32` already
brings in `positionGroup`, `defendDir`, `deepMan`, `interceptPoint`,
`leverageAim` and `UNITS_PER_YARD_X`. The one thing it lacks is `getPlayer`, so
widen its first import:

```js
import { carrier, ballPos, getPlayer } from '../state.js';
```

Add above `learnedOrders`:

```js
/**
 * Whether this man is one the read moves. The front is not: it rushes
 * whatever the play is, and the spec's decision 7 keeps that rule-based. The
 * deep free man is not either: being deep is his job on every snap.
 */
function triggerable(state, team, p) {
  if (positionGroup(p) === 'line') return false;
  return p.id !== deepMan(state, team)?.id;
}

/**
 * The read, applied to one man's order.
 *
 * A committed RUN read takes him off his man entirely and points him at the
 * carrier on the same angle guard three already uses. This is the whole
 * mechanic: he leaves his receiver, and on play-action the throw goes exactly
 * where he was standing. There is no magnitude to learn — read:commit decides
 * how sure he has to be, and that is the only question worth asking.
 *
 * A committed PASS read gives ground instead: read:trigger yards of it at full
 * confidence, along the way this team defends. A cover order is left alone —
 * he is already doing the thing the read is telling him to do.
 */
function applyTrigger(state, team, p, order, read, genome) {
  if (!read.committed || !triggerable(state, team, p)) return order;
  const car = carrier(state);
  if (read.pass < 0) {
    if (!car || car.team === team) return order;
    return { id: p.id, aim: leverageAim(p, interceptPoint(p, car), car), cover: null };
  }
  if (!order.aim) return order;
  const dir = defendDir(team);
  const give = genome['read:trigger'] * read.confidence * UNITS_PER_YARD_X;
  return { ...order, aim: { x: order.aim.x, y: order.aim.y + dir * give } };
}
```

In `learnedOrders`, keep the per-player loop exactly as it is but pass every order it pushes through the trigger. The simplest change that does not restructure the loop is to apply it once at the end, immediately before the `return`:

```js
  orders.push(...zone);
  const { read } = percept(state);
  return orders.map((o) => applyTrigger(state, team, getPlayer(state, o.id), o, read, genome));
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/game/learned/defense-policy.test.js`
Expected: PASS.

- [ ] **Step 5: Confirm an inert genome is still today's defense**

Append to `test/game/read.test.js`:

```js
test('an inert genome triggers nothing, ever', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = inert();
  advancePlay(s, g);
  const withPercept = learnedOrders(s, 'defense', g);
  // The same state with no percept at all: the fallback path.
  const bare = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  bare.ball = { carrierId: 'o-qb', pos: null, vel: null };
  bare.plannedPass = null;
  assert.deepEqual(withPercept, learnedOrders(bare, 'defense', g));
});
```

Add `learnedOrders` to that file's imports.

Run: `node --test test/game/read.test.js`
Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/game/learned/defense-policy.js test/game/learned/defense-policy.test.js test/game/read.test.js
git commit -m "feat: a defense sure enough of the run leaves its men and comes"
```

---

### Task 8: The board says what the defense thinks

A defense that can be fooled is only worth having if the coach can see it was fooled.

**Files:**
- Modify: `lib/game/autoplan.js` (`defenseNote`)
- Test: `test/game/autoplan.test.js`

**Interfaces:**
- Consumes: `state.playRead.read` from Task 2.
- Produces: no new names; `defenseNote`'s returned sentence gains a clause.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/autoplan.test.js`:

```js
test('the note says nothing about a read the defense has not committed to', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  advancePlay(s, makeGenome(DEFENSE_SPEC));
  const note = autoplanLearnedDefense(s);
  assert.ok(!note.includes('read'), note);
});

test('the note says which way a committed read went', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  advancePlay(s, makeGenome(DEFENSE_SPEC));

  s.playRead.read = { pass: -5, confidence: 1, committed: true };
  assert.match(autoplanLearnedDefense(s), /read run/i);

  s.playRead.read = { pass: 5, confidence: 1, committed: true };
  assert.match(autoplanLearnedDefense(s), /read pass/i);
});
```

The entry point is `autoplanLearnedDefense(state)`, exported from
`lib/game/autoplan.js:138`. Add it, plus `advancePlay`, `makeGenome` and
`DEFENSE_SPEC`, to that test file's imports if they are missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/autoplan.test.js`
Expected: FAIL — the note has no read clause.

- [ ] **Step 3: Write the implementation**

In `lib/game/autoplan.js`'s `defenseNote`, replace the final `return` with:

```js
  const scheme = schemeChoice(state, genome, null, state.playRead?.look) === 'zone'
    ? 'Learned defense: zone. The front rushes, everybody else drops to his spot.'
    : 'Learned defense: man. The front rushes, the backs take their men, the free man plays over the top.';
  // An uncommitted read is not a call and is not reported: a defense that has
  // not made its mind up has nothing to tell the coach across the table.
  const read = state.playRead?.read;
  if (!read?.committed) return scheme;
  return read.pass < 0
    ? `${scheme} They read run -- the backers are coming downhill.`
    : `${scheme} They read pass -- the second level is giving ground.`;
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/game/autoplan.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/game/autoplan.js test/game/autoplan.test.js
git commit -m "feat: the board says what the defense thinks it is looking at"
```

---

### Task 9: The training distribution

`train:defense` scores against `scriptedOffenseCoach`, which is a quarterback run option that never throws a forward pass. Read weights exercised only by runs score as noise and evolve to garbage — mechanically the `adapt:*` failure the README already documents. This gives the defense all three things to look at.

The run arm and the pass arm are **recorded human football** from the two committed logs. The play-action arm stays synthetic because neither log contains a fake, and `read:inertia` has nothing to learn without one.

**Files:**
- Modify: `lib/game/train/harness.js` (add the scripts and the deal; `evaluateDefense`'s default)
- Create: nothing
- Modify: `tools/train-defense.js:22` (imports), `:29-42` (`trainDefense`), `:60` (the log line), `:68` (the genome's `opponent` metadata)
- Test: `test/tools/harness.test.js`

**Interfaces:**
- Consumes: `ghostCoach(log, team)` from `lib/game/train/ghost.js`; `planLearnedRun`/`planLearnedPassSnap`/`planThrow` from `lib/game/learned/offense-policy.js`; `loadGhostLog(path)` from `tools/ghost.js`.
- Produces:
  - `playActionCoach(state)` — a `(state) => void` coach: run keys on turn 0, a throw on turn 2.
  - `dealtOffenseCoach({runLog, passLog, rand})` → `(state) => void` — picks one of the three arms per down and remembers the choice for that down.
  - `evaluateDefense(values, {plays, seed, offenseCoach})` — unchanged signature; the default is now the three-way deal when logs are supplied, and `scriptedOffenseCoach` when they are not.

**Note on scope:** this task changes `lib/game/train/harness.js` and `tools/train-defense.js` only. `autoplanOffense` is the human's one-press button and is **not** touched.

- [ ] **Step 1: Write the failing tests**

Append to `test/tools/harness.test.js`:

```js
test('the play-action script sells a run and then throws', () => {
  const s = scenario(mulberry32(7));
  playActionCoach(s);
  // Turn 0: the line drives downfield — run keys, and no throw of its own.
  const line = s.players.filter((p) => p.team === 'offense' && ['C','LG','RG','LT','RT'].includes(p.role));
  assert.ok(line.every((p) => p.plan && p.plan.dir.y > 0), 'the line is driving');
  assert.ok(!s.plannedPass || s.plannedPass.auto, 'nothing thrown at the snap');

  // Turn 2: the throw goes up.
  s.turnIndex = 2;
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  playActionCoach(s);
  assert.ok(s.plannedPass && !s.plannedPass.auto, 'the fake is over and it is a pass');
});

test('the three-way deal is reproducible and uses all three arms', () => {
  const runLog = loadGhostLog('coaching-logs/default-offense.json');
  const passLog = loadGhostLog('coaching-logs/default-offense2.json');
  const arms = (seed) => {
    const coach = dealtOffenseCoach({ runLog, passLog, rand: mulberry32(seed) });
    const seen = [];
    for (let i = 0; i < 30; i++) {
      const s = scenario(mulberry32(100 + i));
      coach(s);
      seen.push(s.dealtArm);
    }
    return seen;
  };
  const first = arms(1);
  assert.deepEqual(first, arms(1), 'same seed, same downs');
  assert.equal(new Set(first).size, 3, 'all three arms get dealt');
});

test('an arm is chosen once per down, not once per turn', () => {
  const runLog = loadGhostLog('coaching-logs/default-offense.json');
  const passLog = loadGhostLog('coaching-logs/default-offense2.json');
  const coach = dealtOffenseCoach({ runLog, passLog, rand: mulberry32(3) });
  const s = scenario(mulberry32(11));
  coach(s);
  const arm = s.dealtArm;
  for (let t = 1; t < 4; t++) { s.turnIndex = t; coach(s); }
  assert.equal(s.dealtArm, arm);
});
```

Add imports for `playActionCoach`, `dealtOffenseCoach`, `scenario` and `mulberry32` from the harness, and `loadGhostLog` from `../../tools/ghost.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/tools/harness.test.js`
Expected: FAIL — neither `playActionCoach` nor `dealtOffenseCoach` is exported.

- [ ] **Step 3: Write the play-action script**

In `lib/game/train/harness.js`, add to the imports from `../learned/offense-policy.js`:

```js
import {
  coachLearnedOffense, planLearnedRun, planLearnedPassSnap, planThrow,
} from '../learned/offense-policy.js';
```

and add the script:

```js
/**
 * The one thing neither recorded log has: a play that sells a run and throws.
 *
 * Written rather than replayed because a fake is exactly what a human coach
 * does not happen to have recorded, and read:inertia — the weight that decides
 * how long a defense stays wrong after it has been fooled — has nothing to
 * learn without one. Turn 0 is planLearnedRun's own picture, so the run keys
 * are the real ones: the line drives, the back leans, the quarterback carries
 * out a fake. Turn 2 is the throw.
 *
 * The genome is a constant rather than a learned one on purpose. This is a
 * fixed opponent, the way scriptedOffenseCoach is; a play-action that evolved
 * would move the target the defense is being scored against.
 */
const PLAY_ACTION_GENOME = {
  'run:sideBias': 0, 'run:read': 0, 'run:lean': 0.4,
  'qb:drop': 0.6, 'throw:go': -Infinity, 'throw:hold': 2,
  'tgt:sep': 1, 'tgt:depth': 1, 'tgt:dist': -0.5,
};

export function playActionCoach(state) {
  if (state.turnIndex === 0) {
    planLearnedRun(state, PLAY_ACTION_GENOME);
    return;
  }
  const qb = state.players.find((p) => p.id === SNAP_TARGET_ID);
  const car = carrier(state);
  if (!qb || !car || car.id !== qb.id) return; // the fake got the ball: let it run
  planLearnedPassSnap(state, PLAY_ACTION_GENOME);
  if (state.turnIndex >= 2) planThrow(state, PLAY_ACTION_GENOME, qb);
}
```

Confirm `SNAP_TARGET_ID` and `carrier` are already imported from `../state.js` at the top of the harness; add them if not.

- [ ] **Step 4: Write the deal**

Add below it:

```js
/**
 * One offense that is three, dealt per down.
 *
 * The run arm and the pass arm are recorded human football (see
 * coaching-logs/default-*.json): twenty-seven real downs are better than
 * anything this file would make up, and the pitches in the run log are real
 * examples of the ball being in the air on a running play, which is exactly
 * the ambiguity read:ballAir has to price. The third arm is written, because
 * no coach recorded a fake.
 *
 * The arm is chosen once per DOWN and kept on the state, not re-rolled every
 * turn: a play that changed its mind at turn two would teach the read that
 * evidence means nothing.
 */
export function dealtOffenseCoach({ runLog, passLog, rand }) {
  const arms = [
    { name: 'run', coach: ghostCoach(runLog, 'offense') },
    { name: 'pass', coach: ghostCoach(passLog, 'offense') },
    { name: 'play-action', coach: playActionCoach },
  ];
  return (state) => {
    if (state.turnIndex === 0 && !state.dealtArm) {
      state.dealtArm = arms[Math.floor(rand() * arms.length)].name;
    }
    const arm = arms.find((a) => a.name === state.dealtArm) ?? arms[0];
    arm.coach(state);
  };
}
```

Add `ghostCoach` to the harness's imports from `./ghost.js`.

- [ ] **Step 5: Hand the logs to the trainer**

`tools/train-defense.js:29` defines `trainDefense`, whose `fitness` callback at
`:38-39` calls `evaluateDefense` without an `offenseCoach` and so takes the
scripted default. Widen the imports:

```js
import { evaluateDefense, dealtOffenseCoach } from '../lib/game/train/harness.js';
import { mulberry32 } from '../lib/game/rng.js';
import { loadGhostLog } from './ghost.js';
```

Add the corpus above `trainDefense`:

```js
/**
 * The recorded football this genome is scored against. Committed to the
 * repository (see coaching-logs/ and .gitignore) so that a genome trained here
 * can be rebuilt from a clean checkout rather than from a log only one
 * contributor happens to have.
 */
const RUN_LOG = new URL('../coaching-logs/default-offense.json', import.meta.url);
const PASS_LOG = new URL('../coaching-logs/default-offense2.json', import.meta.url);
```

and replace the `fitness` callback so each generation deals its own downs from
the generation's own seed — the common-random-numbers discipline the existing
comment describes, extended to which offense each down is:

```js
    fitness: (genome, gen) => {
      const seedForGen = seed * 1000003 + gen;
      return defenseFitness(evaluateDefense(genome, {
        plays,
        seed: seedForGen,
        offenseCoach: dealtOffenseCoach({
          runLog: loadGhostLog(RUN_LOG),
          passLog: loadGhostLog(PASS_LOG),
          rand: mulberry32(seedForGen),
        }),
      }));
    },
```

Finally update the CLI's log line at `:60` and the genome metadata's `opponent`
field at `:68`, both of which currently say the opponent is the scripted
offense:

```js
  console.log('training defense vs recorded runs, recorded passes and a fake:', opts);
```

```js
      opponent: 'dealt: default-offense.json, default-offense2.json, play-action',
```

Note `loadGhostLog` takes a path or a URL — `readFileSync` accepts both — and is
called once per candidate per generation, which is cheap against the thousands
of simulated downs beside it. Keep `evaluateDefense`'s own default in
`harness.js` as `scriptedOffenseCoach`, so library callers and every existing
test are unchanged.

- [ ] **Step 6: Run the tests**

Run: `node --test test/tools/harness.test.js`
Expected: PASS.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Smoke-test a short training run**

Run: `npm run train:defense -- --generations 2 --pop 4 --plays 6 --seed 1`
Expected: it completes and prints per-generation fitness. It **will** rewrite `lib/game/learned/defense-genome.js` — that is fine, Task 10 regenerates it properly. If the run throws, the deal is misconfigured; fix before committing.

- [ ] **Step 9: Discard the smoke-test genome and commit**

```bash
git checkout lib/game/learned/defense-genome.js
git add lib/game/train/harness.js tools/train-defense.js test/tools/harness.test.js
git commit -m "feat: the defense trains against runs, passes and a fake"
```

---

### Task 10: Retrain, and say so in the README

Without this the feature is invisible: every `read:*` weight is still at its inert init.

**Files:**
- Modify: `lib/game/learned/defense-genome.js` (generated — do not hand-edit)
- Modify: `README.md` (the "Training the learned AI" section)

**Interfaces:**
- Consumes: everything above.
- Produces: a genome whose `read:*` values are no longer all zero.

- [ ] **Step 1: Retrain**

Run: `npm run train:defense -- --generations 30 --pop 16 --plays 24 --seed 1`
Expected: completes and writes `lib/game/learned/defense-genome.js`.

- [ ] **Step 2: Confirm the read actually learned something**

Run:

```bash
node -e "
import('./lib/game/learned/defense-genome.js').then(m=>{
  const v=m.DEFENSE_GENOME.values;
  const keys=Object.keys(v).filter(k=>k.startsWith('read:'));
  for (const k of keys) console.log(k, v[k]);
  const moved=keys.filter(k=>k!=='read:commit'&&Math.abs(v[k])>1e-6);
  console.log('weights off zero:', moved.length, 'of', keys.length-1);
});
"
```

Expected: several weights clearly off zero, and `read:commit` below its `8` ceiling. **If every weight is still ~0, stop and report it** — that means the read is contributing nothing to fitness, and the training distribution or the trigger needs revisiting rather than the result being committed.

- [ ] **Step 3: Run the whole suite against the new genome**

Run: `npm test`
Expected: PASS. The equality tests in Task 7 use a hand-built inert genome, not the shipped one, so they are unaffected by retraining.

- [ ] **Step 4: Update the README**

In `README.md`'s training section, after the `train:defense` paragraph, add:

```markdown
`train:defense` no longer scores against the scripted run option alone. It
deals one of three offenses per down: a recorded human run
(`coaching-logs/default-offense.json`), a recorded human pass
(`coaching-logs/default-offense2.json`), and a written play-action fake. The
first two are real coaching, exported from the Coaches Menu and committed so
that a genome trained this way can be rebuilt from a clean checkout; the third
is written because no recorded down sells one play and throws another, and the
defense's `read:inertia` — how long it stays wrong once it has been fooled —
has nothing to learn without a fake.

A log named `coaching-logs/default-*.json` is part of that corpus and is
committed; every other export the Coaches Menu drops in that folder is
ignored, and stays yours.
```

- [ ] **Step 5: Commit**

```bash
git add lib/game/learned/defense-genome.js README.md
git commit -m "feat: a defense that has learned what a play looks like"
```

- [ ] **Step 6: Play it**

Run: `npm run serve`, open `http://localhost:8080`, pick **offense** on the home screen, and run a few downs. Draw a play-action: cut-block the line forward, leave the quarterback holding, and throw on turn two. Watch the board's defense note — it should say the defense read run, and the second level should be out of position when the throw goes up.

This is a judgement check, not an assertion: if the defense never commits to anything across a dozen downs, `read:commit` has trained to its ceiling and the feature is inert in practice. Report that rather than closing the plan.

---

## Notes for the executor

**Read the spec.** `docs/superpowers/specs/2026-09-03-play-recognition-design.md` argues for every decision here, including the ones that look arbitrary (why the look is frozen at the top of turn 0 and not in `nextDown`; why the read may not read orders; why `train:defense`'s old offense could not teach this).

**A known bias you will notice and must not fix here.** The tendency layer records every drop-back pass as a run, because it classifies at `turnIndex === 0` and a drop-back pass has no throw yet at turn 0. So `favoriteDiscount` never fires and `schemeShade` leans on a `passRate` biased toward run. It is a pre-existing defect with its own task, and `tendencies.js` is out of scope for this plan.

**Two logs, two shapes.** `default-offense.json` is 7 downs of runs. `default-offense2.json` is 20 downs that drop back and throw, 17 of them recorded against a nickel defense — which is why Task 1 comes first.
