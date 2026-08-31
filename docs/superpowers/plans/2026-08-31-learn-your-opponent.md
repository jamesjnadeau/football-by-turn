# Learn Your Opponent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The computer learns *you* — every play you call is recorded, a Node
trainer evolves a genome against a ghost that replays your recorded calls, and
the learned defense keeps running counts of your habits and shades its scheme,
its coverage and its zones toward them, inside fixed bounds, game after game.

**Architecture:** One shared, side-agnostic recording module
(`lib/game/coach-log.js`) turns a planning phase into a plain-data snapshot —
situation, spots, arrows, cover orders, stances, throw — and can put that
snapshot back on a board; `app/main.js` captures one every time Run Turn is
pressed and `app/coach-store.js` keeps them in localStorage the way
`app/playbook-store.js` keeps the playbook. The same snapshots feed two
consumers: a pure counting/reading layer (`lib/game/tendencies.js`) whose
smoothed profile shades the learned defense's existing policy functions
through an optional argument and constants-clamped biases, and a Node-only
ghost coach (`tools/ghost.js`) that a new trainer (`tools/train-vs-ghost.js`)
plugs into the existing harness as the opponent while it evolves the other
side's genome.

**Tech Stack:** Plain ES modules, `node --test` (`npm test`), `mulberry32`
seeded RNG, browser `localStorage` for persistence. No new dependencies, no
build step.

## Spec

The user's ask, quoted:

> is there a way I can have the AI learn to play against me and get better?

and the two approaches the user chose to combine into this one plan:

> **Approach 1 — Train against a ghost of you.** Record the human's
> play-calling during real games: each planning-phase snapshot (the human
> team's positions, plans/arrows, cover orders, planned pass, plus situation:
> down, toGo, losYard, turnIndex, variant, which side the human coached)
> captured at the moment Run Turn is pressed, persisted in localStorage,
> exportable as JSON. Then a Node-side "ghost coach" replays the recorded log:
> given a live state, it finds the recorded snapshot with the most similar
> situation (deterministic nearest-neighbor) and applies its plans. A new
> trainer CLI (`tools/train-vs-ghost.js`) plugs the ghost in as the opponent
> coach in the existing training harness and evolves the OPPOSING genome
> against thousands of simulated plays versus the ghost, writing the champion
> back into the shipped genome module exactly as the existing trainers do.

> **Approach 2 — In-game tendency tracking.** The learned defense keeps simple
> counts of what the human offense does — run vs pass by down/distance bucket,
> which side runs go to, which receiver forward passes target — persisted in
> localStorage across games, and biases its existing learned behavior with them
> in BOUNDED, clamped ways: shade the man/zone scheme gate, lean coverage costs
> toward the favorite receiver, shift toward the favorite run side. It adapts
> visibly within a game or two. Tendencies are computed by pure lib functions;
> the app only stores/loads counts.

Binding design decisions (the executor implements these, not alternatives):

1. **One shared recording layer.** A pure `lib/game/` module serializes a
   planning snapshot from state and can re-apply one, side-agnostically; both
   approaches read the same snapshots. Storage follows
   `app/playbook-store.js`: pure lib logic, dumb app storage, every
   `localStorage` access wrapped.
2. **Ghost and trainer live in `tools/`** (Node-only; free to use `node:`
   modules), reusing `tools/harness.js` (`playOnePlay`, `scenario`,
   `defenseCoach`, `learnedOffenseCoach`), `tools/evolve.js` (`evolve`), and
   the fitness functions in `tools/train-defense.js` (`defenseFitness`) and
   `tools/coevolve.js` (`offenseFitness`). The CLI takes
   `--log <path> --side <defense|offense>`: the side names which genome to
   TRAIN, and the ghost impersonates the human's recorded side (the opposite).
   Trainer scenarios sample situations present in the log as well as random
   ones. The CLI body is guarded like `train-defense.js`'s (importing the
   module runs nothing), with an npm script `train:vs-ghost`.
3. **Tendency tracking v1 applies only to the learned DEFENSE** (`aiLevel ===
   'learned'`, `aiTeam === 'defense'`) reading the human offense's history.
   The learned offense does not adapt in v1 — explicitly out of scope. Smart
   and pursuit levels, and Training Mode, are byte-for-byte unchanged when no
   tendency data exists, and unchanged *always* for non-learned levels.
4. **Bias must be bounded and pure.** Tendencies are computed from counts by
   pure functions with Laplace smoothing, so tiny samples barely move
   anything; the bias application clamps within fixed constants added to
   `lib/game/constants.js`. The learned defense policy functions gain an
   OPTIONAL tendencies argument defaulting to `null` — existing call sites
   (`tools/harness.js`, `test/game/learned/defense-policy.test.js`) and their
   behavior are unchanged when it is null.
5. **Export flow:** Coaches Menu buttons that copy the recorded log as JSON and
   clear it, built the way `app/main.js` already builds menu buttons.
   Recording happens in the Run Turn path, for the human-coached team only.
6. **All existing conventions hold** — see Global Constraints.

## Global Constraints

- No npm dependencies and no build step, ever.
- Nothing under `lib/` may import `node:` modules or touch the DOM — `lib/`
  ships to the browser as-is. Only `tools/` and `app/` may reach outside it,
  and only `tools/` may use `node:fs`.
- All randomness flows through a passed-in `rand`/`random` function seeded by
  `mulberry32` — no `Math.random()` and no `Date.now()` in `lib/` or in any
  training path. The ghost is a deterministic nearest-neighbor lookup, not a
  sampler, for exactly this reason.
- `app/` files get no unit tests (they touch the DOM). Everything with logic in
  it lives in `lib/` or `tools/` where `node --test` reaches it; the app-wiring
  task is verified by the browser walk spelled out in it.
- New test files mirror the source tree: `test/game/` for `lib/game/*`,
  `test/game/learned/` for `lib/game/learned/*`, `test/tools/` for `tools/*`.
  `node --test` discovers them recursively.
- No game test may depend on the shipped genomes' trained values. Every test
  that needs a genome builds one with `makeGenome(DEFENSE_SPEC)` and overrides
  the keys it cares about.
- Nothing here changes what any existing level does: `smart`, `pursuit`, the
  learned offense, and Training Mode all run the code they run today.

## File Structure

- Create: `lib/game/coach-log.js` — the planning snapshot: capture, re-apply,
  append, serialize, parse, sanitize.
- Create: `lib/game/tendencies.js` — counts of what the human offense does, the
  smoothed profile read off them, and the storage format.
- Modify: `lib/game/constants.js` — the tendency smoothing/bucket/clamp
  constants.
- Modify: `lib/game/learned/defense-policy.js` — optional `tendencies`
  argument on `schemeChoice`, `learnedCoverAssignments`,
  `zoneAnchorsFromGenome` and `learnedOrders`, plus the three clamped bias
  helpers.
- Modify: `lib/game/state.js` — one new `tendencyCounts: null` field on the
  state `createGame` builds.
- Modify: `lib/game/ai.js` — `coachLearnedDefense` hands the state's tendency
  profile to `learnedOrders`.
- Create: `app/coach-store.js` — localStorage for the coaching log and the
  tendency counts.
- Modify: `app/main.js` — record on Run Turn, load/save the two stores, the
  two menu buttons.
- Modify: `index.html` — the two menu buttons.
- Create: `tools/ghost.js` — load a log, situation distance, nearest snapshot,
  the ghost coach function.
- Create: `tools/train-vs-ghost.js` — ghost-seeded scenarios, evaluation,
  evolution, CLI that writes the trained genome module.
- Modify: `package.json` — the `train:vs-ghost` script.
- Modify: `README.md` — how to export a log and train against it.
- Tests: `test/game/coach-log.test.js`, `test/game/tendencies.test.js`,
  `test/game/learned/defense-tendencies.test.js`, `test/tools/ghost.test.js`,
  `test/tools/train-vs-ghost.test.js`.

---

### Task 1: The planning snapshot — recording and re-applying a coach's call

**Files:**
- Create: `lib/game/coach-log.js`
- Test: `test/game/coach-log.test.js`

**Interfaces:**
- Consumes: `xToYards` (`../field/geometry.js`); `fieldPos`, `yardsOfY`
  (`view.js`); `setPlan`, `clearPlan`, `setMode`, `setPass`, `clearPass`,
  `aimSnap` (`state.js`); `setCover`, `clearCover` (`cover.js`);
  `placeFormation`, `canReposition` (`formation.js`).
- Produces (later tasks use exactly these names):
  - `COACH_LOG_VERSION = 1`, `COACH_LOG_MAX = 400`.
  - `emptyCoachLog() -> []`.
  - `captureSnapshot(state, team) -> snapshot` where a snapshot is
    `{situation: {down, toGo, losYard, turnIndex, variant, side},
    spots: {id: {across, down}}, plans: {id: {dir, throttle}},
    covers: {id: opponentId}, stances: {id: {mode, facing}},
    pass: {from, dir, power, target} | null}`. `side` is `team`.
  - `applySnapshot(state, team, snapshot) -> {applied: string[], skipped:
    string[]}` — puts the snapshot's orders back on `team`.
  - `appendSnapshot(log, snapshot, max = COACH_LOG_MAX) -> snapshot[]`.
  - `serializeCoachLog(log) -> string`, `parseCoachLog(text) -> snapshot[]`,
    `sanitizeSnapshot(raw) -> snapshot | null`.

**Why it is shaped like `play.js`:** a snapshot is a saved play plus a
situation plus cover orders. It is not `capturePlay`, because a play is the
human's own team by definition and only ever the first turn of a down, while a
snapshot is side-agnostic (the ghost must be able to impersonate either side)
and taken on every turn (the ghost has to know what you do on turn three too).
The spot/stance/throw discipline is `play.js`'s, verbatim in spirit: spots in
yards off the line of scrimmage so a call made on the 25 replays on the 40,
`facing` saved with the stance because it is the axis the stance locked, and
the automatic snap never saved because it is not an order the coach gave.

- [ ] **Step 1: Write the failing test**

Create `test/game/coach-log.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COACH_LOG_MAX, emptyCoachLog, captureSnapshot, applySnapshot, appendSnapshot,
  serializeCoachLog, parseCoachLog, sanitizeSnapshot,
} from '../../lib/game/coach-log.js';
import {
  createGame, getPlayer, setPlan, setMode, setPass, formationPlayers, aimSnap,
  SNAPPER_ID,
} from '../../lib/game/state.js';
import { setCover } from '../../lib/game/cover.js';
import { placePlayer } from '../../lib/game/formation.js';
import { fieldPos, yardsOfY } from '../../lib/game/view.js';

/** The same down, spotted somewhere else — how the harness re-spots a game. */
function respot(state, losYard) {
  state.losYard = losYard;
  state.toGoYard = losYard + 10;
  state.players = formationPlayers(losYard, state.variantId);
  state.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  state.plannedPass = null;
  aimSnap(state);
  return state;
}

test('a snapshot carries the situation and only the coached team', () => {
  const s = createGame({ seed: 1 });
  s.down = 3;
  s.toGoYard = s.losYard + 7;
  const snap = captureSnapshot(s, 'offense');
  assert.deepEqual(snap.situation, {
    down: 3, toGo: 7, losYard: s.losYard, turnIndex: 0, variant: '7', side: 'offense',
  });
  for (const id of Object.keys(snap.spots)) assert.ok(id.startsWith('o-'), id);
  assert.equal(Object.keys(snap.spots).length, 7);
});

test("arrows, cover orders, stances and the coach's own throw are all recorded", () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  setMode(s, 'o-lg', 'holding');
  setPass(s, SNAPPER_ID, { x: 0, y: -1 }, 0.5, 'o-wr1');
  const off = captureSnapshot(s, 'offense');
  assert.deepEqual(off.plans['o-rb'], { dir: { x: 0, y: 1 }, throttle: 1 });
  assert.equal(off.stances['o-lg'].mode, 'holding');
  assert.ok(off.stances['o-lg'].facing);
  assert.deepEqual(off.pass, {
    from: SNAPPER_ID, dir: { x: 0, y: -1 }, power: 0.5, target: 'o-wr1',
  });

  setCover(s, 'd-cb1', 'o-wr1');
  const def = captureSnapshot(s, 'defense');
  assert.equal(def.covers['d-cb1'], 'o-wr1');
  // setCover writes a plan too; the snapshot records the ORDER, not its
  // opening aim, or re-applying it would put an arrow on instead of a man.
  assert.equal(def.plans['d-cb1'], undefined);
  assert.equal(def.pass, null); // the throw belongs to the other team
});

test("the automatic snap is not the coach's throw and is never recorded", () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.plannedPass.auto, true);
  assert.equal(captureSnapshot(s, 'offense').pass, null);
});

test('a snapshot replays onto the same down spotted somewhere else', () => {
  const a = createGame({ seed: 1 });
  placePlayer(a, 'o-wr1', fieldPos(-10, a.losYard - 1));
  setPlan(a, 'o-rb', { x: 0, y: 1 }, 1);
  setMode(a, 'o-lg', 'holding');
  const snap = captureSnapshot(a, 'offense');

  const b = respot(createGame({ seed: 2 }), 55);
  const { applied, skipped } = applySnapshot(b, 'offense', snap);
  assert.deepEqual(skipped, []);
  assert.ok(applied.includes('o-rb'));
  // Spots are yards off the line of scrimmage, so the picture is the picture.
  assert.deepEqual(getPlayer(b, 'o-wr1').pos, fieldPos(-10, 55 - 1));
  assert.deepEqual(getPlayer(b, 'o-rb').plan.dir, { x: 0, y: 1 });
  assert.equal(getPlayer(b, 'o-lg').mode, 'holding');
  // The snap goes back on by itself, exactly as applyPlay leaves it.
  assert.equal(b.plannedPass.auto, true);
});

test('a cover order replays as a cover order', () => {
  const a = createGame({ seed: 1 });
  setCover(a, 'd-cb1', 'o-wr1');
  const snap = captureSnapshot(a, 'defense');
  const b = createGame({ seed: 2 });
  applySnapshot(b, 'defense', snap);
  assert.equal(getPlayer(b, 'd-cb1').cover, 'o-wr1');
  assert.ok(getPlayer(b, 'd-cb1').plan, 'a covering man counts as planned');
});

test('replaying one side leaves the other side untouched', () => {
  const a = createGame({ seed: 1 });
  setPlan(a, 'o-rb', { x: 1, y: 0 }, 1);
  const snap = captureSnapshot(a, 'offense');
  const b = createGame({ seed: 2 });
  setPlan(b, 'd-lb', { x: 0, y: -1 }, 1);
  const before = { ...getPlayer(b, 'd-lb').pos };
  applySnapshot(b, 'offense', snap);
  assert.deepEqual(getPlayer(b, 'd-lb').plan.dir, { x: 0, y: -1 });
  assert.deepEqual(getPlayer(b, 'd-lb').pos, before);
});

test('mid-play the orders replay but nobody is re-seated', () => {
  const a = createGame({ seed: 1 });
  placePlayer(a, 'o-wr1', fieldPos(-10, a.losYard - 1));
  setPlan(a, 'o-rb', { x: 0, y: 1 }, 1);
  const snap = captureSnapshot(a, 'offense');

  const b = createGame({ seed: 2 });
  b.turnIndex = 2; // the play is running: a formation is not a thing any more
  const spot = { ...getPlayer(b, 'o-wr1').pos };
  applySnapshot(b, 'offense', snap);
  assert.deepEqual(getPlayer(b, 'o-wr1').pos, spot);
  assert.deepEqual(getPlayer(b, 'o-rb').plan.dir, { x: 0, y: 1 });
});

test('appendSnapshot keeps the newest COACH_LOG_MAX snapshots', () => {
  const s = createGame({ seed: 1 });
  let log = emptyCoachLog();
  for (let i = 0; i < COACH_LOG_MAX + 5; i++) {
    s.down = (i % 4) + 1;
    log = appendSnapshot(log, captureSnapshot(s, 'offense'));
  }
  assert.equal(log.length, COACH_LOG_MAX);
  assert.equal(log[log.length - 1].situation.down, ((COACH_LOG_MAX + 4) % 4) + 1);
});

test('a log survives the round trip through storage', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0.6, y: 0.8 }, 0.75);
  setCover(s, 'd-cb1', 'o-wr1');
  const log = [captureSnapshot(s, 'offense'), captureSnapshot(s, 'defense')];
  assert.deepEqual(parseCoachLog(serializeCoachLog(log)), log);
});

test('junk reads as an empty log, and one bad snapshot does not poison the rest', () => {
  assert.deepEqual(parseCoachLog(undefined), []);
  assert.deepEqual(parseCoachLog(''), []);
  assert.deepEqual(parseCoachLog('{not json'), []);
  assert.deepEqual(parseCoachLog(JSON.stringify({ v: 99, snapshots: [] })), []);

  const s = createGame({ seed: 1 });
  const good = captureSnapshot(s, 'offense');
  const text = JSON.stringify({ v: 1, snapshots: [good, { situation: null }, good] });
  assert.deepEqual(parseCoachLog(text), [good, good]);
});

test('sanitizeSnapshot refuses anything that would put a NaN on the field', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const good = captureSnapshot(s, 'offense');
  assert.deepEqual(sanitizeSnapshot(JSON.parse(JSON.stringify(good))), good);
  assert.equal(sanitizeSnapshot(null), null);
  assert.equal(sanitizeSnapshot({ ...good, situation: { ...good.situation, down: 'x' } }), null);
  assert.equal(sanitizeSnapshot({ ...good, situation: { ...good.situation, side: 'both' } }), null);
  assert.equal(sanitizeSnapshot({ ...good, plans: { 'o-rb': { dir: { x: NaN, y: 1 }, throttle: 1 } } }), null);
  assert.equal(sanitizeSnapshot({ ...good, covers: { 'd-cb1': 7 } }), null);
  assert.equal(sanitizeSnapshot({ ...good, stances: { 'o-lg': { mode: 'flying', facing: { x: 0, y: 1 } } } }), null);
  // A "__proto__" key can only ever ARRIVE through JSON.parse — writing one in
  // an object literal sets the prototype instead of adding the key — and
  // JSON.parse is exactly how storage hands one over.
  const sneaky = JSON.parse('{"__proto__":{"across":0,"down":0}}');
  assert.equal(sanitizeSnapshot({ ...good, spots: sneaky }), null);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/coach-log.test.js`
Expected: FAIL — cannot find module `lib/game/coach-log.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/coach-log.js`:

```js
/**
 * The coaching log: what the human actually called, turn by turn, as plain
 * serializable data.
 *
 * A snapshot is one planning phase seen from one team's side — where his men
 * were standing, the arrows and cover orders and stances he gave them, the
 * throw he set, and the SITUATION he gave them in. It is deliberately close to
 * play.js's saved play, and deliberately not the same thing:
 *
 *   - a play is the human's own team by definition; a snapshot names its team,
 *     because the thing that replays these (tools/ghost.js) has to be able to
 *     impersonate either side;
 *   - a play is only ever the first turn of a down; a snapshot is taken on
 *     every turn, because what you do on turn three is as much a habit as what
 *     you come to the line with;
 *   - a play has a name and a slot; a snapshot has a situation, which is the
 *     key everything downstream looks it up by.
 *
 * Pure, like playbook.js: this file knows what a snapshot IS, and
 * app/coach-store.js is the only thing that knows where one is kept.
 *
 * Spots are yards off the line of scrimmage and never SVG units, so a call
 * made on the 25 replays on the 40 as the same picture. `facing` is saved with
 * a stance because it is the axis the stance locked. The automatic snap is
 * never saved: it is how a down starts, not an order the coach gave.
 */
import { xToYards } from '../field/geometry.js';
import { fieldPos, yardsOfY } from './view.js';
import {
  setPlan, clearPlan, setMode, setPass, clearPass, aimSnap,
} from './state.js';
import { setCover, clearCover } from './cover.js';
import { placeFormation, canReposition } from './formation.js';

export const COACH_LOG_VERSION = 1;

/**
 * How many snapshots a log keeps. Four hundred is well over a hundred downs
 * of real coaching — enough for a ghost with a habit, small enough that the
 * JSON stays inside a browser's storage quota and a nearest-neighbor scan
 * stays instant.
 */
export const COACH_LOG_MAX = 400;

/** The stances a snapshot may carry — play.js's list, for the same reason:
 *  cutBlockDrive is never player-selected. */
const STANCES = ['tucked', 'prepared', 'holding', 'cutBlock'];

const vec = (v) => ({ x: v.x, y: v.y });

export function emptyCoachLog() {
  return [];
}

/**
 * One planning phase, from `team`'s side. Deep-copied on the way out: a
 * snapshot must not share a vector with the live state, or the next drag would
 * silently rewrite history.
 *
 * A covering man's ORDER is recorded and his plan is not. setCover writes both
 * — the plan is the order's opening aim — and recording the arrow as well
 * would replay as an arrow instead of as a man taken up.
 */
export function captureSnapshot(state, team) {
  const spots = {};
  const plans = {};
  const covers = {};
  const stances = {};
  for (const p of state.players) {
    if (p.team !== team) continue;
    spots[p.id] = {
      across: xToYards(p.pos.x),
      down: yardsOfY(p.pos.y) - state.losYard,
    };
    if (p.cover) covers[p.id] = p.cover;
    else if (p.plan) plans[p.id] = { dir: vec(p.plan.dir), throttle: p.plan.throttle };
    if (p.mode !== 'normal') stances[p.id] = { mode: p.mode, facing: vec(p.facing) };
  }
  const pp = state.plannedPass;
  const thrower = pp && !pp.auto ? state.players.find((p) => p.id === pp.from) : null;
  const mine = thrower && thrower.team === team ? pp : null;
  return {
    situation: {
      down: state.down,
      toGo: state.toGoYard - state.losYard,
      losYard: state.losYard,
      turnIndex: state.turnIndex,
      variant: state.variantId,
      side: team,
    },
    spots,
    plans,
    covers,
    stances,
    pass: mine
      ? { from: mine.from, dir: vec(mine.dir), power: mine.power, target: mine.target ?? null }
      : null,
  };
}

/**
 * Put a snapshot's orders back on `team`. Everything that team was holding is
 * wiped first — replaying a call replaces the huddle, it does not merge with
 * one — and whatever could not be given comes back in `skipped` (an id this
 * formation has no player for, a tuck by a man who is not carrying the ball
 * this time, a throw by a man who does not have the ball).
 *
 * The formation only goes on while a formation is still a thing: past the
 * first turn of a down everyone has scattered, and the spots in the snapshot
 * describe a picture that no longer exists. Arrows go on BEFORE stances,
 * because setMode freezes `facing` off the player's heading and the saved
 * facing is then written back over it — play.js's own ordering, for the same
 * reason.
 */
export function applySnapshot(state, team, snapshot) {
  const applied = [];
  const skipped = [];
  const mine = (id) => {
    const p = state.players.find((pl) => pl.id === id);
    return p && p.team === team ? p : null;
  };

  for (const p of state.players) {
    if (p.team !== team) continue;
    setMode(state, p.id, 'normal');
    clearPlan(state, p.id);
    clearCover(state, p.id);
  }
  clearPass(state);

  if (canReposition(state)) {
    const wanted = [];
    for (const [id, spot] of Object.entries(snapshot.spots)) {
      if (!mine(id)) { skipped.push(id); continue; }
      wanted.push({ id, pos: fieldPos(spot.across, state.losYard + spot.down) });
    }
    // Not counted as `applied`: standing where you were told to stand is not
    // an order given — play.js's placeFormation call keeps the same count.
    for (const id of placeFormation(state, wanted).skipped) skipped.push(id);
  }

  for (const [id, plan] of Object.entries(snapshot.plans)) {
    if (!mine(id)) { skipped.push(id); continue; }
    setPlan(state, id, vec(plan.dir), plan.throttle);
    applied.push(id);
  }
  for (const [id, targetId] of Object.entries(snapshot.covers)) {
    if (!mine(id) || !state.players.some((pl) => pl.id === targetId)) {
      skipped.push(id);
      continue;
    }
    if (setCover(state, id, targetId)) applied.push(id);
    else skipped.push(id);
  }
  for (const [id, stance] of Object.entries(snapshot.stances)) {
    const p = mine(id);
    if (!p) { skipped.push(id); continue; }
    // setMode refuses a stance that is no longer legal. That is a skip, not a
    // failure: the rest of the call still goes on.
    if (setMode(state, id, stance.mode)) p.facing = vec(stance.facing);
    else skipped.push(id);
  }
  if (snapshot.pass) {
    const { from, dir, power, target } = snapshot.pass;
    // A target this field has no player for is dropped rather than carried:
    // releasePass would go looking for him mid-flight.
    const lock = target && state.players.some((pl) => pl.id === target) ? target : null;
    if (mine(from) && setPass(state, from, vec(dir), power, lock)) applied.push(from);
    else skipped.push(from);
  }
  // A call with no throw of its own would otherwise leave the ball on the
  // centre with nobody told to move it. aimSnap leaves a real throw alone.
  aimSnap(state);
  return { applied, skipped };
}

/** The log with `snapshot` on the end, never longer than `max`. */
export function appendSnapshot(log, snapshot, max = COACH_LOG_MAX) {
  const next = [...log, snapshot];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function serializeCoachLog(log) {
  return JSON.stringify({ v: COACH_LOG_VERSION, snapshots: log });
}

/**
 * Storage back into a log. Anything unrecognisable — absent, not JSON, a
 * version this build does not know — reads as an empty log. A single bad
 * SNAPSHOT is dropped and the rest kept, which is where this parts company
 * with parsePlaybook: a play is a thing the coach would call and notice
 * missing a man from, while a log is a pile of observations and losing one of
 * four hundred is nothing.
 */
export function parseCoachLog(text) {
  if (typeof text !== 'string' || text === '') return [];
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!raw || typeof raw !== 'object') return [];
  if (raw.v !== COACH_LOG_VERSION || !Array.isArray(raw.snapshots)) return [];
  const out = [];
  for (const entry of raw.snapshots) {
    const snap = sanitizeSnapshot(entry);
    if (snap) out.push(snap);
  }
  return out.length > COACH_LOG_MAX ? out.slice(out.length - COACH_LOG_MAX) : out;
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function sanVec(v) {
  if (!v || typeof v !== 'object') return null;
  const x = finite(v.x);
  const y = finite(v.y);
  return x === null || y === null ? null : { x, y };
}

/** A throttle or a throw's power: a number, held to [0,1] like a drag is. */
function sanUnit(v) {
  const n = finite(v);
  return n === null ? null : Math.max(0, Math.min(1, n));
}

/** A plain {id: ...} map from storage, or null if it is not one. Assigning a
 *  "__proto__" key onto a literal would set the object's prototype rather than
 *  add a property, and nothing legitimate is named that. */
function entriesOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = Object.entries(raw);
  return out.some(([id]) => id === '__proto__') ? null : out;
}

function sanSituation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const down = finite(raw.down);
  const toGo = finite(raw.toGo);
  const losYard = finite(raw.losYard);
  const turnIndex = finite(raw.turnIndex);
  if (down === null || toGo === null || losYard === null || turnIndex === null) return null;
  if (typeof raw.variant !== 'string') return null;
  if (raw.side !== 'offense' && raw.side !== 'defense') return null;
  return { down, toGo, losYard, turnIndex, variant: raw.variant, side: raw.side };
}

/**
 * Whatever came back out of storage, as a snapshot — or null. Strict on
 * purpose, exactly as sanitizePlay is: these numbers go straight into the
 * physics, and one NaN in a direction vector puts a player at NaN,NaN for the
 * rest of the game. A snapshot with any bad entry is dropped whole.
 */
export function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const situation = sanSituation(raw.situation);
  if (!situation) return null;

  const spotEntries = entriesOf(raw.spots);
  if (!spotEntries) return null;
  const spots = {};
  for (const [id, spot] of spotEntries) {
    if (!spot || typeof spot !== 'object') return null;
    const across = finite(spot.across);
    const down = finite(spot.down);
    if (across === null || down === null) return null;
    spots[id] = { across, down };
  }

  const planEntries = entriesOf(raw.plans);
  if (!planEntries) return null;
  const plans = {};
  for (const [id, plan] of planEntries) {
    if (!plan || typeof plan !== 'object') return null;
    const dir = sanVec(plan.dir);
    const throttle = sanUnit(plan.throttle);
    if (!dir || throttle === null) return null;
    plans[id] = { dir, throttle };
  }

  const coverEntries = entriesOf(raw.covers);
  if (!coverEntries) return null;
  const covers = {};
  for (const [id, targetId] of coverEntries) {
    if (typeof targetId !== 'string') return null;
    covers[id] = targetId;
  }

  const stanceEntries = entriesOf(raw.stances);
  if (!stanceEntries) return null;
  const stances = {};
  for (const [id, stance] of stanceEntries) {
    if (!stance || typeof stance !== 'object') return null;
    const facing = sanVec(stance.facing);
    if (!facing || !STANCES.includes(stance.mode)) return null;
    stances[id] = { mode: stance.mode, facing };
  }

  let pass = null;
  if (raw.pass !== null && raw.pass !== undefined) {
    if (typeof raw.pass !== 'object' || typeof raw.pass.from !== 'string') return null;
    const dir = sanVec(raw.pass.dir);
    const power = sanUnit(raw.pass.power);
    if (!dir || power === null) return null;
    const target = raw.pass.target ?? null;
    if (target !== null && typeof target !== 'string') return null;
    pass = { from: raw.pass.from, dir, power, target };
  }

  return { situation, spots, plans, covers, stances, pass };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/coach-log.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test` — everything green (this task adds a module and imports
nothing new into any existing one).

```bash
git add lib/game/coach-log.js test/game/coach-log.test.js
git commit -m "feat: the coaching log — recording and replaying a planning snapshot"
```

---

### Task 2: Counting the human's tendencies

**Files:**
- Create: `lib/game/tendencies.js`
- Modify: `lib/game/constants.js`
- Test: `test/game/tendencies.test.js`

**Interfaces:**
- Consumes: `TENDENCY_PRIOR`, `TENDENCY_SHORT_YARDS`, `TENDENCY_MEDIUM_YARDS`,
  `TENDENCY_SIDE_DEADZONE` (constants.js) — added in this task, along with the
  three clamp constants Task 3 consumes.
- Produces:
  - `TENDENCY_VERSION = 1`.
  - `emptyTendencies() -> {v, calls: {}, sides: {left, middle, right},
    targets: {}, plays: 0}`.
  - `distanceBucket(toGo) -> 'short' | 'medium' | 'long'`.
  - `situationKey(down, toGo) -> string` (e.g. `'3:long'`).
  - `runSideOf(snapshot) -> 'left' | 'middle' | 'right'`.
  - `observationFromSnapshot(snapshot) -> {down, toGo, call, side, target}`
    where `call` is `'run' | 'pass'`, `side` is a run side or `null` on a pass,
    and `target` is a receiver id or `null`.
  - `observePlay(counts, observation) -> counts` — pure, returns a new object.
  - `readTendencies(counts, down, toGo) -> {passRate, runSide, favorite,
    samples}` — `passRate` in (0,1), `runSide` in (-1,1) with positive meaning
    the right side of the field, `favorite` `{id, edge}` or `null`, `samples`
    the plays counted in this down/distance bucket.
  - `tendenciesForState(state)` — the same profile for the state's own
    situation, or `null` when `state.tendencyCounts` is null. Task 3's
    `ai.js` calls this.
  - `serializeTendencies(counts) -> string`, `parseTendencies(text) -> counts`.

**Why smoothing, and why these three counts:** the defense has to answer the
coach in front of it after a game or two, which means acting on samples of
three and four — and acting on three plays is also how a defense gets broken
by the fourth. Laplace smoothing with a prior of four plays is the whole
answer: with no data every read is exactly neutral (`passRate` 0.5, `runSide`
0, no favorite), with three plays it has barely moved, and with twenty it is
most of the way to the truth. Three counts because three is what the learned
defense already has joints for — a scheme gate, a coverage cost, and zone
anchors — and a fourth count with nowhere to go is a fourth thing to keep
correct.

- [ ] **Step 1: Write the failing test**

Create `test/game/tendencies.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyTendencies, distanceBucket, situationKey, runSideOf,
  observationFromSnapshot, observePlay, readTendencies, tendenciesForState,
  serializeTendencies, parseTendencies,
} from '../../lib/game/tendencies.js';
import { captureSnapshot } from '../../lib/game/coach-log.js';
import { createGame, setPlan, setPass, SNAPPER_ID } from '../../lib/game/state.js';

/** `n` identical calls folded into a fresh set of counts. */
function counted(obs, n) {
  let counts = emptyTendencies();
  for (let i = 0; i < n; i++) counts = observePlay(counts, obs);
  return counts;
}

test('distance buckets are short, medium and long', () => {
  assert.equal(distanceBucket(1), 'short');
  assert.equal(distanceBucket(3), 'short');
  assert.equal(distanceBucket(4), 'medium');
  assert.equal(distanceBucket(7), 'medium');
  assert.equal(distanceBucket(8), 'long');
  assert.equal(distanceBucket(25), 'long');
  assert.equal(situationKey(3, 9), '3:long');
});

test('a snapshot with a throw in it is a pass, and it names the target', () => {
  const s = createGame({ seed: 1 });
  s.down = 3;
  s.toGoYard = s.losYard + 9;
  setPass(s, SNAPPER_ID, { x: 0, y: -1 }, 0.6, 'o-wr2');
  const obs = observationFromSnapshot(captureSnapshot(s, 'offense'));
  assert.deepEqual(obs, { down: 3, toGo: 9, call: 'pass', side: null, target: 'o-wr2' });
});

test('a snapshot with only arrows is a run, and the arrows say which way', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0.9, y: 0.44 }, 1);
  setPlan(s, 'o-rg', { x: 0.8, y: 0.6 }, 1);
  const obs = observationFromSnapshot(captureSnapshot(s, 'offense'));
  assert.equal(obs.call, 'run');
  assert.equal(obs.side, 'right');
  assert.equal(obs.target, null);

  const left = createGame({ seed: 1 });
  setPlan(left, 'o-rb', { x: -0.9, y: 0.44 }, 1);
  assert.equal(runSideOf(captureSnapshot(left, 'offense')), 'left');

  const up = createGame({ seed: 1 });
  setPlan(up, 'o-rb', { x: 0, y: 1 }, 1);
  assert.equal(runSideOf(captureSnapshot(up, 'offense')), 'middle');
});

test('observePlay is pure and files each count where it belongs', () => {
  const base = emptyTendencies();
  const after = observePlay(base, {
    down: 2, toGo: 8, call: 'run', side: 'right', target: null,
  });
  assert.deepEqual(base, emptyTendencies(), 'the old counts are untouched');
  assert.deepEqual(after.calls['2:long'], { run: 1, pass: 0 });
  assert.equal(after.sides.right, 1);
  assert.equal(after.plays, 1);

  const withPass = observePlay(after, {
    down: 2, toGo: 8, call: 'pass', side: null, target: 'o-wr1',
  });
  assert.deepEqual(withPass.calls['2:long'], { run: 1, pass: 1 });
  assert.equal(withPass.sides.right, 1, 'a pass is not a run to anywhere');
  assert.equal(withPass.targets['o-wr1'], 1);
  assert.equal(withPass.plays, 2);
});

test('with no data every read is exactly neutral', () => {
  const t = readTendencies(emptyTendencies(), 1, 10);
  assert.equal(t.passRate, 0.5);
  assert.equal(t.runSide, 0);
  assert.equal(t.favorite, null);
  assert.equal(t.samples, 0);
});

test('smoothing means three plays barely move, and twenty move a lot', () => {
  const pass = { down: 3, toGo: 10, call: 'pass', side: null, target: 'o-wr1' };
  const few = readTendencies(counted(pass, 3), 3, 10);
  const many = readTendencies(counted(pass, 20), 3, 10);
  assert.ok(few.passRate > 0.5 && few.passRate < 0.66, `few: ${few.passRate}`);
  assert.ok(many.passRate > 0.8, `many: ${many.passRate}`);
  assert.ok(many.passRate < 1);
  assert.equal(few.samples, 3);
});

test('the read is per down and distance, not one number for the whole game', () => {
  const counts = counted({ down: 3, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 20);
  assert.ok(readTendencies(counts, 3, 10).passRate > 0.8, 'third and long: he throws');
  assert.equal(readTendencies(counts, 1, 10).passRate, 0.5, 'first and ten: no idea');
});

test('the run-side read leans toward the side the runs went to', () => {
  const right = counted({ down: 1, toGo: 10, call: 'run', side: 'right', target: null }, 20);
  assert.ok(readTendencies(right, 1, 10).runSide > 0.5);
  const left = counted({ down: 1, toGo: 10, call: 'run', side: 'left', target: null }, 20);
  assert.ok(readTendencies(left, 1, 10).runSide < -0.5);
  const middle = counted({ down: 1, toGo: 10, call: 'run', side: 'middle', target: null }, 20);
  assert.equal(readTendencies(middle, 1, 10).runSide, 0);
  // Never past the ends, however lopsided the sample.
  const wild = counted({ down: 1, toGo: 10, call: 'run', side: 'right', target: null }, 500);
  assert.ok(readTendencies(wild, 1, 10).runSide < 1);
});

test('the favorite receiver is the most-targeted one, with a growing edge', () => {
  let counts = counted({ down: 1, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 10);
  counts = observePlay(counts, { down: 1, toGo: 10, call: 'pass', side: null, target: 'o-wr2' });
  const t = readTendencies(counts, 1, 10);
  assert.equal(t.favorite.id, 'o-wr1');
  assert.ok(t.favorite.edge > 0.5 && t.favorite.edge < 1);
  const thin = readTendencies(
    counted({ down: 1, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 1), 1, 10,
  );
  assert.ok(thin.favorite.edge < 0.25, `one throw is not a habit: ${thin.favorite.edge}`);
});

test("tendenciesForState reads the state's own down and distance", () => {
  const s = createGame({ seed: 1 });
  assert.equal(tendenciesForState(s), null, 'a game with no history has no read');
  s.down = 3;
  s.toGoYard = s.losYard + 10;
  s.tendencyCounts = counted(
    { down: 3, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 20,
  );
  assert.ok(tendenciesForState(s).passRate > 0.8);
});

test('counts survive the round trip, and junk reads as no history at all', () => {
  const counts = counted({ down: 2, toGo: 4, call: 'run', side: 'left', target: null }, 3);
  assert.deepEqual(parseTendencies(serializeTendencies(counts)), counts);
  assert.deepEqual(parseTendencies(''), emptyTendencies());
  assert.deepEqual(parseTendencies('{not json'), emptyTendencies());
  assert.deepEqual(parseTendencies(JSON.stringify({ v: 99 })), emptyTendencies());
  assert.deepEqual(
    parseTendencies(JSON.stringify({ v: 1, calls: { '1:long': { run: 'x', pass: 1 } }, sides: {}, targets: {}, plays: 1 })),
    emptyTendencies(),
    'a count that is not a count is not half-loaded',
  );
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/tendencies.test.js`
Expected: FAIL — cannot find module `lib/game/tendencies.js`.

- [ ] **Step 3: Write the implementation**

Append to `lib/game/constants.js`:

```js
// --- learning the human's tendencies (lib/game/tendencies.js and the bias
//     lib/game/learned/defense-policy.js applies from it) ---
// The Laplace prior, in plays: how many imaginary neutral calls every count
// starts with. It is what makes a sample of three barely move the defense and
// a sample of twenty move it a lot, with no special case for "not enough data
// yet" anywhere — with nothing counted at all every read comes out exactly
// neutral, which is the same thing as no bias.
export const TENDENCY_PRIOR = 4;
// Where short yardage stops and long yardage starts, in yards to gain. Three
// buckets rather than ten, because a bucket is only useful once it has plays
// in it and a coach does not call thirty downs a night.
export const TENDENCY_SHORT_YARDS = 3;
export const TENDENCY_MEDIUM_YARDS = 7;
// How far off straight-upfield the average arrow of a called run has to lean
// before it counts as a run to one side rather than up the middle.
export const TENDENCY_SIDE_DEADZONE = 0.25;
// The three clamps on what a tendency may do. Every bias is bounded by one of
// these and by the smoothed read itself, so a habit shades the defense and can
// never replace it — the genome is still what plays.
// A logit shift against scheme:bias, whose own range is [-4, 4]: a read can
// move the man/zone call, but only from a gate that was already close.
export const TENDENCY_SCHEME_SHADE = 1;
// Yards of discount on the cost of covering the favorite receiver — about one
// body's worth of head start for the corner nearest him.
export const TENDENCY_COVER_DISCOUNT_YARDS = 3;
// Yards a zone anchor slides toward the side the runs have been going.
export const TENDENCY_ANCHOR_SHIFT_YARDS = 4;
```

Create `lib/game/tendencies.js`:

```js
/**
 * What the human offense keeps doing, and what to make of it.
 *
 * Three counts, because the learned defense has exactly three joints a habit
 * can be pushed into (see learned/defense-policy.js): run vs pass by down and
 * distance, which side the runs go to, and which receiver the throws are aimed
 * at. Everything here is PURE — counts in, counts or a reading out. The app
 * stores them and hands them back (app/coach-store.js); nothing in this file
 * knows what a browser is.
 *
 * Every read is Laplace-smoothed by TENDENCY_PRIOR imaginary neutral plays.
 * That is the whole of the small-sample discipline: with nothing counted the
 * reads come out exactly neutral (0.5, 0, no favorite), which downstream means
 * no bias at all and therefore a defense that plays precisely what its genome
 * says; with three plays they have barely moved; with twenty they have most of
 * the way moved. There is no "enough data yet" threshold anywhere, because a
 * threshold is a cliff and this is a ramp.
 */
import {
  TENDENCY_PRIOR, TENDENCY_SHORT_YARDS, TENDENCY_MEDIUM_YARDS,
  TENDENCY_SIDE_DEADZONE,
} from './constants.js';

export const TENDENCY_VERSION = 1;

export function emptyTendencies() {
  return {
    v: TENDENCY_VERSION,
    calls: {},
    sides: { left: 0, middle: 0, right: 0 },
    targets: {},
    plays: 0,
  };
}

export function distanceBucket(toGo) {
  if (toGo <= TENDENCY_SHORT_YARDS) return 'short';
  if (toGo <= TENDENCY_MEDIUM_YARDS) return 'medium';
  return 'long';
}

/** The bucket one call is filed under: the down, and how far it is. */
export function situationKey(down, toGo) {
  return `${down}:${distanceBucket(toGo)}`;
}

/**
 * Which way a called run flows: the average sideways lean of every arrow on
 * the snapshot. The blockers lean with the run, so averaging the whole call
 * reads the play rather than one man's first step — and a call with nothing
 * drawn on it reads as up the middle, which contributes to the denominator and
 * to no side.
 */
export function runSideOf(snapshot) {
  const plans = Object.values(snapshot.plans);
  if (!plans.length) return 'middle';
  const lean = plans.reduce((sum, p) => sum + p.dir.x, 0) / plans.length;
  if (lean > TENDENCY_SIDE_DEADZONE) return 'right';
  if (lean < -TENDENCY_SIDE_DEADZONE) return 'left';
  return 'middle';
}

/**
 * One coaching snapshot, read as one observation. A snapshot carrying a throw
 * is a pass (the automatic snap is never in a snapshot — see coach-log.js), and
 * anything else is a run.
 */
export function observationFromSnapshot(snapshot) {
  const pass = snapshot.pass !== null;
  return {
    down: snapshot.situation.down,
    toGo: snapshot.situation.toGo,
    call: pass ? 'pass' : 'run',
    side: pass ? null : runSideOf(snapshot),
    target: pass ? snapshot.pass.target : null,
  };
}

/** The counts with one more play in them. Pure: the old object is untouched. */
export function observePlay(counts, obs) {
  const key = situationKey(obs.down, obs.toGo);
  const bucket = counts.calls[key] ?? { run: 0, pass: 0 };
  const calls = {
    ...counts.calls,
    [key]: {
      run: bucket.run + (obs.call === 'run' ? 1 : 0),
      pass: bucket.pass + (obs.call === 'pass' ? 1 : 0),
    },
  };
  const sides = { ...counts.sides };
  if (obs.call === 'run' && obs.side) sides[obs.side] += 1;
  const targets = { ...counts.targets };
  if (obs.call === 'pass' && obs.target) {
    targets[obs.target] = (targets[obs.target] ?? 0) + 1;
  }
  return { v: TENDENCY_VERSION, calls, sides, targets, plays: counts.plays + 1 };
}

/**
 * What the counts say about this down and distance. Every number here is
 * smoothed and bounded:
 *
 *   passRate — in (0,1), exactly 0.5 with nothing counted in this bucket.
 *   runSide  — in (-1,1), positive toward the right sideline, exactly 0 with
 *              nothing counted or with every run up the middle.
 *   favorite — the most-targeted receiver and an `edge` in [0,1) that is his
 *              share of the throws discounted by the prior, so one throw at a
 *              man is a fact and not yet a habit. Null until somebody has been
 *              thrown at.
 *   samples  — the plays actually counted in this bucket, for anyone who wants
 *              to say out loud how much the defense thinks it knows.
 */
export function readTendencies(counts, down, toGo) {
  const bucket = counts.calls[situationKey(down, toGo)] ?? { run: 0, pass: 0 };
  const passRate = (bucket.pass + TENDENCY_PRIOR)
    / (bucket.run + bucket.pass + 2 * TENDENCY_PRIOR);

  const { left, middle, right } = counts.sides;
  const runSide = (right - left) / (left + middle + right + 2 * TENDENCY_PRIOR);

  const ids = Object.keys(counts.targets).sort();
  let favorite = null;
  if (ids.length) {
    let best = ids[0];
    for (const id of ids) if (counts.targets[id] > counts.targets[best]) best = id;
    const total = ids.reduce((sum, id) => sum + counts.targets[id], 0);
    favorite = { id: best, edge: counts.targets[best] / (total + TENDENCY_PRIOR) };
  }

  return { passRate, runSide, favorite, samples: bucket.run + bucket.pass };
}

/**
 * The reading for the situation the game is actually in, or null when this
 * game is carrying no history — which is how ai.js asks, and how "no data
 * means no bias" is enforced in one place rather than at every call site.
 */
export function tendenciesForState(state) {
  if (!state.tendencyCounts) return null;
  return readTendencies(state.tendencyCounts, state.down, state.toGoYard - state.losYard);
}

export function serializeTendencies(counts) {
  return JSON.stringify(counts);
}

const count = (v) => (
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
);

/**
 * Storage back into counts. Anything unrecognisable reads as no history at
 * all: a wrong count would quietly aim the defense at a receiver the coach has
 * never thrown to, which is worse than forgetting the whole season.
 */
export function parseTendencies(text) {
  if (typeof text !== 'string' || text === '') return emptyTendencies();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyTendencies();
  }
  if (!raw || typeof raw !== 'object' || raw.v !== TENDENCY_VERSION) return emptyTendencies();
  const plays = count(raw.plays);
  if (plays === null) return emptyTendencies();

  const out = emptyTendencies();
  if (!raw.calls || typeof raw.calls !== 'object' || Array.isArray(raw.calls)) {
    return emptyTendencies();
  }
  for (const [key, bucket] of Object.entries(raw.calls)) {
    if (key === '__proto__' || !bucket || typeof bucket !== 'object') return emptyTendencies();
    const run = count(bucket.run);
    const pass = count(bucket.pass);
    if (run === null || pass === null) return emptyTendencies();
    out.calls[key] = { run, pass };
  }
  if (!raw.sides || typeof raw.sides !== 'object') return emptyTendencies();
  for (const side of ['left', 'middle', 'right']) {
    const n = count(raw.sides[side]);
    if (n === null) return emptyTendencies();
    out.sides[side] = n;
  }
  if (!raw.targets || typeof raw.targets !== 'object' || Array.isArray(raw.targets)) {
    return emptyTendencies();
  }
  for (const [id, n] of Object.entries(raw.targets)) {
    const hits = count(n);
    if (id === '__proto__' || hits === null) return emptyTendencies();
    out.targets[id] = hits;
  }
  out.plays = plays;
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/tendencies.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test` — the constants additions are new exports and change nothing
that exists.

```bash
git add lib/game/tendencies.js lib/game/constants.js test/game/tendencies.test.js
git commit -m "feat: count and read the human offense's tendencies"
```

---

### Task 3: The learned defense answers a habit — bounded, optional bias

**Files:**
- Modify: `lib/game/learned/defense-policy.js`
- Modify: `lib/game/state.js` (one field)
- Modify: `lib/game/ai.js` (`coachLearnedDefense`)
- Test: `test/game/learned/defense-tendencies.test.js`

**Interfaces:**
- Consumes: `readTendencies`'s profile shape from Task 2 (`{passRate, runSide,
  favorite, samples}`), `tendenciesForState` (tendencies.js),
  `TENDENCY_SCHEME_SHADE`, `TENDENCY_COVER_DISCOUNT_YARDS`,
  `TENDENCY_ANCHOR_SHIFT_YARDS` (constants.js), `FIELD_WIDTH_YARDS`
  (`../../field/geometry.js`).
- Produces (in `defense-policy.js`):
  - `schemeShade(tendencies) -> number` — the gate's logit shift, in
    `[-TENDENCY_SCHEME_SHADE, TENDENCY_SCHEME_SHADE]`, 0 for null.
  - `favoriteDiscount(tendencies, receiverId) -> number` — yards off that
    receiver's coverage cost, in `[0, TENDENCY_COVER_DISCOUNT_YARDS]`, 0 for
    null.
  - `anchorShift(tendencies) -> number` — yards across, in
    `[-TENDENCY_ANCHOR_SHIFT_YARDS, TENDENCY_ANCHOR_SHIFT_YARDS]`, 0 for null.
  - `schemeChoice(state, genome, tendencies = null)`,
    `learnedCoverAssignments(state, team, genome, tendencies = null)`,
    `zoneAnchorsFromGenome(players, genome, tendencies = null)`,
    `learnedOrders(state, team, genome, tendencies = null)` — every existing
    3-argument (or 2-argument) call site keeps its exact behavior.
- Produces (elsewhere): `state.tendencyCounts` — a new plain-data field,
  `null` in every game the app has not handed counts to.

**Where each bias lands, and why there are exactly three:** the gate chooses
between man and zone, so the run/pass read belongs there — a coach who throws
on third and long gets more zone. Man coverage is a cost, so the favorite
receiver belongs there — he is claimed first, from further away, by up to a
body's worth of discount. A zone is a place, so the run-side read belongs
there — the anchors slide toward the side the runs go. That is one bias per
joint the learned defense actually has, each clamped by its own constant and
each multiplied by a smoothed read that is zero until there is something to
know. The learned OFFENSE gets none of this in v1 (design decision 3): it is
the human's *offense* being counted, and an offense has no use for its own
habits.

- [ ] **Step 1: Write the failing test**

Create `test/game/learned/defense-tendencies.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schemeShade, favoriteDiscount, anchorShift, schemeChoice,
  learnedCoverAssignments, zoneAnchorsFromGenome, learnedOrders,
} from '../../../lib/game/learned/defense-policy.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { emptyTendencies, observePlay, readTendencies } from '../../../lib/game/tendencies.js';
import { createGame, getPlayer, setPlan } from '../../../lib/game/state.js';
import { coachAi, clearAiPlans } from '../../../lib/game/ai.js';
import { fieldPos } from '../../../lib/game/view.js';
import {
  TENDENCY_SCHEME_SHADE, TENDENCY_COVER_DISCOUNT_YARDS, TENDENCY_ANCHOR_SHIFT_YARDS,
} from '../../../lib/game/constants.js';

function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

/** `n` identical calls, read back for this down and distance. */
function profile(obs, n, down, toGo) {
  let counts = emptyTendencies();
  for (let i = 0; i < n; i++) counts = observePlay(counts, obs);
  return readTendencies(counts, down, toGo);
}

test('with no history the learned defense plays exactly what it played before', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const g = makeGenome(DEFENSE_SPEC);
  const plain = learnedOrders(s, 'defense', g);
  assert.deepEqual(learnedOrders(s, 'defense', g, null), plain);
  // An empty history is not "a little bit of a read": it is no read at all.
  const blank = readTendencies(emptyTendencies(), s.down, s.toGoYard - s.losYard);
  assert.deepEqual(learnedOrders(s, 'defense', g, blank), plain);
  assert.equal(schemeShade(null), 0);
  assert.equal(schemeShade(blank), 0);
  assert.equal(anchorShift(blank), 0);
  assert.equal(favoriteDiscount(blank, 'o-wr1'), 0);
});

test('the scheme shade is bounded, signed, and zero without a read', () => {
  const passer = profile({ down: 3, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 40, 3, 10);
  const runner = profile({ down: 3, toGo: 10, call: 'run', side: 'middle', target: null }, 40, 3, 10);
  assert.ok(schemeShade(passer) > 0, 'a thrower earns zone');
  assert.ok(schemeShade(runner) < 0, 'a runner earns man');
  for (const t of [passer, runner]) {
    assert.ok(Math.abs(schemeShade(t)) <= TENDENCY_SCHEME_SHADE);
  }
});

test('a passing habit can tip a gate that was already close', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  s.down = 3;
  s.toGoYard = s.losYard + 10;
  const g = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': -0.5 };
  assert.equal(schemeChoice(s, g), 'man');
  const passer = profile({ down: 3, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 20, 3, 10);
  assert.equal(schemeChoice(s, g, passer), 'zone');
  // ...and cannot tip one that was not close: the clamp is the promise.
  const committed = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': -2 };
  assert.equal(schemeChoice(s, committed, passer), 'man');
});

test('the favorite receiver is claimed first, from further away', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  // The back close but shallow, the receiver a touch further but downfield —
  // by bare distance the corner takes the back.
  getPlayer(s, 'o-rb').pos = fieldPos(-14, s.losYard - 1);
  getPlayer(s, 'o-wr1').pos = fieldPos(-15, s.losYard + 6);
  const g = makeGenome(DEFENSE_SPEC);
  assert.equal(learnedCoverAssignments(s, 'defense', g).get('d-cb1'), 'o-rb');

  const favors = profile({ down: 1, toGo: 10, call: 'pass', side: null, target: 'o-wr1' }, 10, 1, 10);
  assert.equal(learnedCoverAssignments(s, 'defense', g, favors).get('d-cb1'), 'o-wr1');
  assert.ok(favoriteDiscount(favors, 'o-wr1') > 0);
  assert.ok(favoriteDiscount(favors, 'o-rb') === 0, 'nobody else gets the discount');
  assert.ok(favoriteDiscount(favors, 'o-wr1') <= TENDENCY_COVER_DISCOUNT_YARDS);
});

test('zone anchors slide toward the side the runs have been going', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(DEFENSE_SPEC);
  const defense = s.players.filter((p) => p.team === 'defense');
  const plain = zoneAnchorsFromGenome(defense, g);
  const right = profile({ down: 1, toGo: 10, call: 'run', side: 'right', target: null }, 40, 1, 10);
  const shifted = zoneAnchorsFromGenome(defense, g, right);
  const shift = anchorShift(right);
  assert.ok(shift > 0);
  assert.ok(shift <= TENDENCY_ANCHOR_SHIFT_YARDS);
  for (const a of shifted) {
    const was = plain.find((p) => p.id === a.id);
    assert.ok(a.across > was.across, `${a.id} slid right`);
    assert.equal(a.depth, was.depth, 'depth is not a side');
  }
  // A shifted anchor is still on the field.
  const wide = { ...g, 'zone:d-cb2:across': 24 };
  const edge = zoneAnchorsFromGenome(defense, wide, right).find((a) => a.id === 'd-cb2');
  assert.ok(edge.across <= 160 / 6, `${edge.across} is inside the sideline`);
});

test("coachAi hands the learned defense the game's own history", () => {
  const s = afterSnap(createGame({ seed: 3, ai: 'defense', aiLevel: 'learned' }));
  assert.equal(s.tendencyCounts, null, 'a fresh game carries no history');
  let counts = emptyTendencies();
  for (let i = 0; i < 20; i++) {
    counts = observePlay(counts, {
      down: s.down, toGo: s.toGoYard - s.losYard, call: 'pass', side: null, target: 'o-wr1',
    });
  }
  s.tendencyCounts = counts;
  coachAi(s);
  const planned = s.players.filter((p) => p.team === 'defense' && (p.plan || p.cover));
  assert.ok(planned.length > 0, 'the defense still plays football');
  clearAiPlans(s);
});

test('history changes nothing at all for the levels that never learned', () => {
  const orders = (counts) => {
    const s = afterSnap(createGame({ seed: 5, ai: 'defense', aiLevel: 'smart' }));
    s.tendencyCounts = counts;
    setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
    coachAi(s);
    return s.players
      .filter((p) => p.team === 'defense')
      .map((p) => ({ id: p.id, plan: p.plan, cover: p.cover }));
  };
  let counts = emptyTendencies();
  for (let i = 0; i < 30; i++) {
    counts = observePlay(counts, { down: 1, toGo: 10, call: 'pass', side: null, target: 'o-wr1' });
  }
  assert.deepEqual(orders(counts), orders(null));
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/defense-tendencies.test.js`
Expected: FAIL — `schemeShade` / `favoriteDiscount` / `anchorShift` are not
exported from `defense-policy.js`.

- [ ] **Step 3: Write the implementation**

Modify `lib/game/learned/defense-policy.js`.

Extend the constants import:

```js
import {
  AI_THREAT_SPEED_RATIO, TENDENCY_SCHEME_SHADE, TENDENCY_COVER_DISCOUNT_YARDS,
  TENDENCY_ANCHOR_SHIFT_YARDS,
} from '../constants.js';
```

Extend the geometry import:

```js
import {
  UNITS_PER_YARD_X, CENTRE_X, SIDELINE_LEFT, SIDELINE_RIGHT, FIELD_WIDTH_YARDS,
} from '../../field/geometry.js';
```

Add the three bias helpers just above `schemeChoice`:

```js
/**
 * The bias layer: what this defense makes of the coach it is facing.
 *
 * `tendencies` is lib/game/tendencies.js's reading — {passRate, runSide,
 * favorite, samples} — or null, which is what every existing caller passes by
 * omission and what the training harness always passes. Each of these returns
 * exactly zero for null AND for a reading taken from no history, so "no data"
 * and "no bias" are the same state rather than two states that have to agree.
 *
 * Every one is clamped by its own constant. The genome is what plays; a habit
 * only leans on it.
 */
const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v));

/** The man/zone gate's tendency lean: a coach who throws earns zone. */
export function schemeShade(tendencies) {
  if (!tendencies) return 0;
  return clamp((tendencies.passRate - 0.5) * 2 * TENDENCY_SCHEME_SHADE, TENDENCY_SCHEME_SHADE);
}

/** Yards off the cost of covering the man this coach keeps throwing to — so
 *  he is claimed first, and from further away than bare distance would. */
export function favoriteDiscount(tendencies, receiverId) {
  const fav = tendencies?.favorite;
  if (!fav || fav.id !== receiverId) return 0;
  return Math.max(0, Math.min(TENDENCY_COVER_DISCOUNT_YARDS,
    fav.edge * TENDENCY_COVER_DISCOUNT_YARDS));
}

/** Yards a zone anchor slides toward the side the runs have been going. */
export function anchorShift(tendencies) {
  if (!tendencies) return 0;
  return clamp(tendencies.runSide * TENDENCY_ANCHOR_SHIFT_YARDS, TENDENCY_ANCHOR_SHIFT_YARDS);
}
```

Replace `schemeChoice` with:

```js
export function schemeChoice(state, genome, tendencies = null) {
  const f = schemeFeatures(state);
  const z = genome['scheme:bias']
    + genome['scheme:down'] * f.down
    + genome['scheme:toGo'] * f.toGo
    + genome['scheme:spread'] * f.spread
    + schemeShade(tendencies);
  return z > 0 ? 'zone' : 'man';
}
```

In `learnedCoverAssignments`, change the signature and the cost line — the
whole function, with the two changed lines marked, reads:

```js
export function learnedCoverAssignments(state, team, genome, tendencies = null) {
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
          + genome['cov:width'] * width
          // The man this coach keeps throwing to is cheaper to take, in yards.
          - favoriteDiscount(tendencies, r.id);
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
```

Replace `zoneAnchorsFromGenome` with:

```js
/** The genome's zone anchors, for whichever of these players actually carry
 *  zone keys, slid toward the side this coach's runs have been going. Ids the
 *  genome has never met contribute nothing; the slide never carries an anchor
 *  past the sideline, since a zone nobody can stand in is not a zone. */
export function zoneAnchorsFromGenome(players, genome, tendencies = null) {
  const shift = anchorShift(tendencies);
  const halfField = FIELD_WIDTH_YARDS / 2;
  return players
    .filter((p) => typeof genome[`zone:${p.id}:across`] === 'number')
    .map((p) => ({
      id: p.id,
      across: Math.max(-halfField, Math.min(halfField, genome[`zone:${p.id}:across`] + shift)),
      depth: genome[`zone:${p.id}:depth`],
    }));
}
```

In `learnedOrders`, change the signature and thread the argument through the
three calls that now take it:

```js
export function learnedOrders(state, team, genome, tendencies = null) {
```

```js
  const scheme = schemeChoice(state, genome, tendencies);
  const zone = scheme === 'zone'
    ? zoneOrders(state, team, zoneAnchorsFromGenome(mine, genome, tendencies))
    : [];
  const zoned = new Set(zone.map((o) => o.id));
  const man = scheme === 'man'
    ? learnedCoverAssignments(state, team, genome, tendencies)
    : new Map();
```

(The rest of `learnedOrders` — the ball/past-the-line guards and the dispatch
loop — is unchanged.)

Modify `lib/game/state.js` — in `createGame`'s state literal, immediately
after the `aiPlay: null,` field and its comment, add:

```js
    // What this coach keeps doing, as counts (lib/game/tendencies.js), or
    // null. Plain serializable data like everything else here; the app is
    // what loads it out of storage and hands it over, because the counts
    // outlive the game the way the playbook does. Only the learned DEFENSE
    // reads it — see ai.js's coachLearnedDefense.
    tendencyCounts: null,
```

Modify `lib/game/ai.js` — add the import:

```js
import { tendenciesForState } from './tendencies.js';
```

and replace `coachLearnedDefense`:

```js
/**
 * The learned brain's orders — the shipped genome's, shaded by whatever this
 * game knows about the coach across the table, written into `state`. A game
 * carrying no counts reads as no tendencies at all, which is byte-for-byte the
 * defense this function played before it could learn anything.
 */
export function coachLearnedDefense(state) {
  applyOrders(state, learnedOrders(
    state, state.aiTeam, DEFENSE_GENOME.values, tendenciesForState(state),
  ));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/game/learned/defense-tendencies.test.js test/game/learned/defense-policy.test.js test/game/ai-learned.test.js`
Expected: PASS — the new file's 7 tests, and every existing
`defense-policy`/`ai-learned` test untouched (they call the same functions
with the same arguments they always did).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test` — `state.test.js`, `turn.test.js`, `integration.test.js` and
`test/tools/*` must all stay green: the new state field is inert data and the
harness still calls `learnedOrders` with three arguments.

```bash
git add lib/game/learned/defense-policy.js lib/game/state.js lib/game/ai.js test/game/learned/defense-tendencies.test.js
git commit -m "feat: the learned defense shades its scheme, coverage and zones toward your habits"
```

---

### Task 4: Wire recording, learning and export through the app

**Files:**
- Create: `app/coach-store.js`
- Modify: `app/main.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `captureSnapshot`, `appendSnapshot`, `emptyCoachLog`,
  `serializeCoachLog`, `parseCoachLog` (coach-log.js);
  `observationFromSnapshot`, `observePlay`, `emptyTendencies`,
  `serializeTendencies`, `parseTendencies` (tendencies.js); `humanSide`
  (hud.js).
- Produces (in `app/coach-store.js`):
  - `loadCoachLog() -> snapshot[]`, `saveCoachLog(log) -> boolean`,
    `clearCoachLog() -> boolean`.
  - `loadTendencies() -> counts`, `saveTendencies(counts) -> boolean`,
    `clearTendencies() -> boolean`.

No unit tests — these files touch the DOM and `localStorage`, which
`node --test` does not have. That is why Tasks 1–3 hold every rule these files
merely plumb together. Verification is Step 4's browser walk.

- [ ] **Step 1: Write `app/coach-store.js`**

Create `app/coach-store.js`:

```js
/**
 * Where what the computer has learned about you lives between sessions: the
 * coaching log (every planning snapshot you have run a turn from) and the
 * tendency counts read off them.
 *
 * The same bargain app/playbook-store.js keeps, for the same reasons: the
 * FORMAT is pure and tested under node --test (lib/game/coach-log.js,
 * lib/game/tendencies.js) and only the plumbing is here, and every call is
 * wrapped because localStorage does not merely return null when the browser
 * has blocked site data — the property access itself throws. A coach whose
 * browser will not remember him should still get to play football against a
 * defense that has simply forgotten everything.
 */
import { parseCoachLog, serializeCoachLog } from '../lib/game/coach-log.js';
import { emptyTendencies, parseTendencies, serializeTendencies } from '../lib/game/tendencies.js';

const LOG_KEY = 'football-by-turn:coach-log';
const TENDENCY_KEY = 'football-by-turn:tendencies';

export function loadCoachLog() {
  try {
    return parseCoachLog(localStorage.getItem(LOG_KEY));
  } catch {
    return [];
  }
}

/** False when the browser refused to keep it — the caller says so out loud. */
export function saveCoachLog(log) {
  try {
    localStorage.setItem(LOG_KEY, serializeCoachLog(log));
    return true;
  } catch {
    return false;
  }
}

export function clearCoachLog() {
  try {
    localStorage.removeItem(LOG_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadTendencies() {
  try {
    return parseTendencies(localStorage.getItem(TENDENCY_KEY));
  } catch {
    return emptyTendencies();
  }
}

export function saveTendencies(counts) {
  try {
    localStorage.setItem(TENDENCY_KEY, serializeTendencies(counts));
    return true;
  } catch {
    return false;
  }
}

export function clearTendencies() {
  try {
    localStorage.removeItem(TENDENCY_KEY);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Add the two menu buttons to `index.html`**

In `index.html`, inside `.menu-body`, insert these three lines immediately
BEFORE the existing `<button id="close-menu">Close</button>` (i.e. after the
Plays section, whatever that section currently holds — Close is the last
control in the menu and is the stable anchor):

```html
      <h2>Coaching log</h2>
      <button id="copy-log">Copy coaching log</button>
      <button id="clear-log">Forget my tendencies</button>
```

They need no CSS: `.menu-body button` and `.menu-body h2` already style them.

- [ ] **Step 3: Wire `app/main.js`**

Extend the `hud.js` import:

```js
import { downDistanceText, gameOverMessage, kickoffMessage, humanSide } from '../lib/game/hud.js';
```

Add three imports at the top, next to the other `app/` and `lib/game/`
imports:

```js
import {
  captureSnapshot, appendSnapshot, emptyCoachLog, serializeCoachLog,
} from '../lib/game/coach-log.js';
import {
  observationFromSnapshot, observePlay, emptyTendencies,
} from '../lib/game/tendencies.js';
import {
  loadCoachLog, saveCoachLog, clearCoachLog,
  loadTendencies, saveTendencies, clearTendencies,
} from './coach-store.js';
```

Add the two button handles next to the existing ones (after the
`const newBtn = ...` / `const homeBtn = ...` lines):

```js
const copyLogBtn = document.getElementById('copy-log');
const clearLogBtn = document.getElementById('clear-log');
```

Next to the other module-level holders that outlive New Game (the playbook,
`showVelocity`, `repositioning`), add:

```js
// What the computer has learned about this coach. Not game state, for the
// same reason the playbook is not: New Game replaces `state` wholesale, and
// a habit is something you carry between drives, not something a fresh down
// forgets. The log is the raw record (exportable, and what tools/ghost.js
// replays); the counts are what the learned defense actually reads.
let coachLog = loadCoachLog();
let tendencies = loadTendencies();
```

In `paint()`, next to the other button labels (after the `debugBtn` lines),
add:

```js
  copyLogBtn.textContent = `Copy coaching log (${coachLog.length})`;
  copyLogBtn.disabled = animating || coachLog.length === 0;
  clearLogBtn.disabled = animating || (coachLog.length === 0 && tendencies.plays === 0);
```

In `startNewGame()`, immediately after the `state = createGame({...});`
statement, add:

```js
  // The new drive inherits what the old ones taught the computer.
  state.tendencyCounts = tendencies;
```

Add the recorder just above `pressRun` (before its doc comment):

```js
/**
 * Write down what the coach just called. Runs at the moment Run Turn is
 * pressed, which is the only moment the whole huddle is on the board at once:
 * every arrow drawn, every man moved, the throw set — and, on a turn the
 * computer coaches, none of ITS intentions, because those are written inside
 * runTurn and wiped at the whistle.
 *
 * Only the human's own side is recorded, and only when there IS one: in
 * hot-seat both teams are his, and a log that could not say whose call a
 * snapshot was would teach the ghost to play both sides at once.
 *
 * The tendency counts take the first turn of a down only — that is the play
 * call; turns two and three are what happened to it. They are counted only
 * when the human is the OFFENSE, because it is an offense's habits the
 * learned defense knows what to do with (design decision 3).
 */
function recordPlanning() {
  const team = humanSide(state);
  if (!team) return;
  const snap = captureSnapshot(state, team);
  coachLog = appendSnapshot(coachLog, snap);
  saveCoachLog(coachLog);
  if (team === 'offense' && snap.situation.turnIndex === 0) {
    tendencies = observePlay(tendencies, observationFromSnapshot(snap));
    saveTendencies(tendencies);
    state.tendencyCounts = tendencies;
  }
}
```

In `pressRun`, insert the call immediately after the `say('');` line and
before the `runTurn` call:

```js
  pendingWarning = false;
  stopRepositioning();
  say('');
  // Recorded before the turn runs, while the huddle is still on the board.
  recordPlanning();
  // runTurn mutates state to the end-of-turn position and returns the
  // per-sub-step frames; the player groups are still painted at their
  // pre-turn spots, so animating the frames walks them to where state says.
  const { frames, events } = runTurn(state, random);
```

In `pressRun`'s animation lock (the block that sets `runBtn.disabled = true`
and friends), add the two new buttons:

```js
    copyLogBtn.disabled = true;
    clearLogBtn.disabled = true;
```

Add the two handlers next to the other menu-button listeners (after the
`debugBtn` listener):

```js
/**
 * Hand the coaching log over as JSON — the file tools/train-vs-ghost.js
 * trains against. The clipboard is asked first and a prompt is the fallback,
 * because a browser may refuse clipboard access outright and a log the coach
 * cannot get at is a log that never leaves the browser.
 */
copyLogBtn.addEventListener('click', async () => {
  closeMenu();
  if (animating || coachLog.length === 0) return;
  const text = serializeCoachLog(coachLog);
  try {
    await navigator.clipboard.writeText(text);
    say(`Copied ${coachLog.length} planning snapshot(s). Save them as JSON and train against them.`);
  } catch {
    window.prompt('Copy this coaching log:', text);
    say('The browser refused the clipboard — the log is in the prompt instead.');
  }
});

/** Forget everything: the raw log and the counts read off it. Both, always —
 *  a coach who asks to be forgotten does not mean half of him. */
clearLogBtn.addEventListener('click', () => {
  closeMenu();
  if (animating) return;
  coachLog = emptyCoachLog();
  tendencies = emptyTendencies();
  clearCoachLog();
  clearTendencies();
  state.tendencyCounts = tendencies;
  say('Forgotten. The computer starts reading you from scratch.');
  paint();
});
```

- [ ] **Step 4: Verify in the browser**

Run `npm test` first — all green. Nothing in this task can break a lib test,
so a failure here means a `lib/` file was edited by mistake.

Then `npm run serve`, open http://localhost:8080 and walk it:

1. **7 Player → Play Offense.** Open the Coaches Menu: it now has a
   **Coaching log** heading with **Copy coaching log (0)** (greyed out) and
   **Forget my tendencies** below the play slots.
2. Draw an arrow on the running back to the RIGHT, press **Run Turn**, let the
   turn play. Reopen the menu: the copy button now reads **Copy coaching log
   (1)** and is live.
3. Play out the down and a few more, calling runs to the right every time.
   The count climbs by one per turn run (not per down).
4. Press **Copy coaching log** — the message says how many snapshots were
   copied (or, if the browser refuses the clipboard, a prompt appears with the
   JSON in it). Paste it into a file, e.g. `~/coach-log.json`; keep it for
   Task 6. It must be one JSON object with `"v": 1` and a `"snapshots"` array.
5. Reload the page and start another **Play Offense** game: the copy button
   still reads the count it had — the log survived the reload.
6. On a fresh down, tap a receiver, drag from him to arm a throw, and run the
   turn a few times over several downs on third and long. The defense should
   visibly start dropping into zone on third and long rather than matching up
   man-to-man, and the corner nearest your favorite receiver should be taking
   HIM rather than the nearest body.
7. **Forget my tendencies** → the message says so, the copy button greys back
   out at (0), and a reload keeps it at (0).
8. Back to Home → **7 Player → Training Mode**: the mode button reads
   `Defense: computer (smart)` and plays exactly as it always did; the log
   still records (the count climbs), because recording is not learning.
9. Back to Home → **7 Player → Play Defense**: the count still climbs — the
   log is side-agnostic and records your DEFENSE calls now — but nothing about
   the computer's offense changes, which is v1's scope.
10. No console errors anywhere in the walk.

(If verifying in an embedded preview pane rather than a real browser, turn
animations crawl — `requestAnimationFrame` barely fires there. Counts, labels,
messages and the copy flow are all still checkable.)

- [ ] **Step 5: Commit**

```bash
git add app/coach-store.js app/main.js index.html
git commit -m "feat: record every call, learn your tendencies, export the log"
```

---

### Task 5: The ghost — replaying a recorded coach

**Files:**
- Create: `tools/ghost.js`
- Test: `test/tools/ghost.test.js`

**Interfaces:**
- Consumes: `readFileSync` (`node:fs`); `parseCoachLog`, `applySnapshot`
  (`../lib/game/coach-log.js`).
- Produces:
  - `SITUATION_WEIGHTS = {down, toGo, losYard, turnIndex}` — the nearest-
    neighbor metric's weights.
  - `loadGhostLog(path) -> snapshot[]`.
  - `liveSituation(state, team) -> {down, toGo, losYard, turnIndex, variant,
    side}` — the same shape `captureSnapshot` records.
  - `situationDistance(a, b) -> number` — `Infinity` across variants.
  - `nearestSnapshot(log, situation) -> snapshot | null`.
  - `ghostCoach(log, team) -> (state) => void` — a coach function of exactly
    the shape `playOnePlay` takes.
  - `logSituations(log, side) -> situation[]` — the first-turn situations the
    log actually holds for that side, for the trainer's scenarios.

**Why nearest-neighbor and not a model:** the log is a few hundred snapshots of
one human, which is far too little to fit anything and exactly enough to look
things up in. A deterministic nearest-neighbor also keeps the whole training
path reproducible from a seed, which is the project's rule about randomness
turned into a design decision: the ghost adds no dice at all.

- [ ] **Step 1: Write the failing test**

Create `test/tools/ghost.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SITUATION_WEIGHTS, loadGhostLog, liveSituation, situationDistance,
  nearestSnapshot, ghostCoach, logSituations,
} from '../../tools/ghost.js';
import { captureSnapshot, serializeCoachLog } from '../../lib/game/coach-log.js';
import {
  createGame, getPlayer, setPlan, formationPlayers, aimSnap, SNAPPER_ID,
} from '../../lib/game/state.js';

/** A down dealt at a given spot and distance, with one arrow on it. */
function recorded({ down, toGo, losYard, dir, team = 'offense', id = 'o-rb' }) {
  const s = createGame({ seed: 1 });
  s.down = down;
  s.losYard = losYard;
  s.toGoYard = losYard + toGo;
  s.players = formationPlayers(losYard, s.variantId);
  s.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  s.plannedPass = null;
  aimSnap(s);
  setPlan(s, id, dir, 1);
  return captureSnapshot(s, team);
}

const LOG = [
  recorded({ down: 1, toGo: 10, losYard: 20, dir: { x: 1, y: 0 } }),
  recorded({ down: 3, toGo: 2, losYard: 50, dir: { x: 0, y: 1 } }),
  recorded({ down: 3, toGo: 2, losYard: 50, dir: { x: 0, y: 1 }, team: 'defense', id: 'd-lb' }),
];

test('a situation is nearer itself than anything else', () => {
  const here = LOG[0].situation;
  assert.equal(situationDistance(here, here), 0);
  assert.ok(situationDistance(here, LOG[1].situation) > 0);
  for (const k of ['down', 'toGo', 'losYard', 'turnIndex']) {
    assert.ok(SITUATION_WEIGHTS[k] > 0, k);
  }
});

test('a different game is not a nearer situation, it is no situation at all', () => {
  const a = LOG[0].situation;
  assert.equal(situationDistance(a, { ...a, variant: '11' }), Infinity);
  assert.equal(nearestSnapshot(LOG, { ...a, variant: '11' }), null);
});

test('nearestSnapshot picks the closest down on the right side of the ball', () => {
  const near3rdShort = {
    down: 3, toGo: 3, losYard: 48, turnIndex: 0, variant: '7', side: 'offense',
  };
  assert.equal(nearestSnapshot(LOG, near3rdShort), LOG[1]);
  // The same situation from the other side of the ball finds the other entry.
  assert.equal(nearestSnapshot(LOG, { ...near3rdShort, side: 'defense' }), LOG[2]);
  const near1st = {
    down: 1, toGo: 9, losYard: 25, turnIndex: 0, variant: '7', side: 'offense',
  };
  assert.equal(nearestSnapshot(LOG, near1st), LOG[0]);
});

test('the ghost puts the recorded call on the board', () => {
  const s = createGame({ seed: 9 });
  s.down = 3;
  s.toGoYard = s.losYard + 2;
  assert.equal(getPlayer(s, 'o-rb').plan, null);
  ghostCoach(LOG, 'offense')(s);
  assert.deepEqual(getPlayer(s, 'o-rb').plan.dir, { x: 0, y: 1 });
  assert.equal(getPlayer(s, 'd-lb').plan, null, 'the defense is not his to coach');
});

test('the ghost is deterministic and coaches every turn', () => {
  const run = () => {
    const s = createGame({ seed: 9 });
    const ghost = ghostCoach(LOG, 'offense');
    ghost(s);
    const first = { ...getPlayer(s, 'o-rb').plan.dir };
    s.turnIndex = 2;
    ghost(s);
    return [first, { ...getPlayer(s, 'o-rb').plan.dir }];
  };
  assert.deepEqual(run(), run());
});

test('a ghost with nothing recorded for his side simply does nothing', () => {
  const s = createGame({ seed: 9 });
  ghostCoach([], 'offense')(s);
  assert.equal(getPlayer(s, 'o-rb').plan, null);
  assert.equal(liveSituation(s, 'offense').side, 'offense');
});

test('logSituations lists the first-turn situations for one side', () => {
  const off = logSituations(LOG, 'offense');
  assert.equal(off.length, 2);
  assert.deepEqual(off.map((x) => x.down).sort(), [1, 3]);
  assert.equal(logSituations(LOG, 'defense').length, 1);
});

test('loadGhostLog reads a log off disk', () => {
  const path = join(tmpdir(), `fbt-ghost-${process.pid}.json`);
  try {
    writeFileSync(path, serializeCoachLog(LOG));
    assert.deepEqual(loadGhostLog(path), LOG);
  } finally {
    rmSync(path, { force: true });
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/tools/ghost.test.js`
Expected: FAIL — cannot find module `tools/ghost.js`.

- [ ] **Step 3: Write the implementation**

Create `tools/ghost.js`:

```js
/**
 * A ghost of the coach: the recorded log (lib/game/coach-log.js) played back
 * as an opponent.
 *
 * Given a live state it finds the recorded snapshot whose SITUATION is nearest
 * — same game, same side of the ball, closest down, distance, spot and turn —
 * and puts that call on the board. Nearest-neighbor rather than a fitted model
 * because a few hundred snapshots of one human is far too little to fit
 * anything and exactly enough to look things up in; and deterministic rather
 * than sampled because the whole point of the training path is that a seed
 * reproduces it exactly. The ghost rolls no dice at all.
 *
 * Node-only (it reads files); lib/ must never import from here.
 */
import { readFileSync } from 'node:fs';
import { parseCoachLog, applySnapshot } from '../lib/game/coach-log.js';

/**
 * What "a similar situation" means, in weights.
 *
 * turnIndex is heaviest because it is the difference between a call and a
 * scramble: turn zero is a play the coach drew up from a formation, and turn
 * three is what he did about it once it broke — replaying one as the other is
 * the one mistake that would make the ghost a stranger. down comes next (third
 * down is a different game from first), then distance, then field position,
 * which matters least: a coach's third-and-two is his third-and-two whether he
 * is on his own 30 or the other 40.
 */
export const SITUATION_WEIGHTS = {
  turnIndex: 4,
  down: 3,
  toGo: 1,
  losYard: 0.15,
};

/** A log as exported by the game's Coaches Menu, read off disk. */
export function loadGhostLog(path) {
  return parseCoachLog(readFileSync(path, 'utf8'));
}

/** The situation a live state is in, in captureSnapshot's own shape. */
export function liveSituation(state, team) {
  return {
    down: state.down,
    toGo: state.toGoYard - state.losYard,
    losYard: state.losYard,
    turnIndex: state.turnIndex,
    variant: state.variantId,
    side: team,
  };
}

/**
 * How unlike each other two situations are. Infinity across variants, because
 * a call made with eleven men on the field is not a nearer version of a
 * seven-man call — it is a call for a different set of bodies, and the ids in
 * it would half-apply.
 */
export function situationDistance(a, b) {
  if (a.variant !== b.variant) return Infinity;
  return SITUATION_WEIGHTS.turnIndex * Math.abs(a.turnIndex - b.turnIndex)
    + SITUATION_WEIGHTS.down * Math.abs(a.down - b.down)
    + SITUATION_WEIGHTS.toGo * Math.abs(a.toGo - b.toGo)
    + SITUATION_WEIGHTS.losYard * Math.abs(a.losYard - b.losYard);
}

/**
 * The recorded call nearest this situation, or null when the log holds nothing
 * for this side of the ball in this game. Ties go to the OLDEST matching
 * snapshot (strictly-nearer wins), which is what makes the lookup reproducible
 * for a given log rather than dependent on how it was ordered.
 */
export function nearestSnapshot(log, situation) {
  let best = null;
  let bestD = Infinity;
  for (const snap of log) {
    if (snap.situation.side !== situation.side) continue;
    const d = situationDistance(snap.situation, situation);
    if (!Number.isFinite(d) || d >= bestD) continue;
    best = snap;
    bestD = d;
  }
  return best;
}

/**
 * The ghost as a coach function — the same `(state) => void` shape
 * tools/harness.js's playOnePlay takes for either side, so it drops straight
 * into the training loop where a scripted or learned coach would go.
 *
 * A situation the log has nothing for leaves the board alone rather than
 * guessing: the trainer refuses to start against an empty ghost (see
 * train-vs-ghost.js), so a silent turn here means one odd down and not a whole
 * training run against a statue.
 */
export function ghostCoach(log, team) {
  return (state) => {
    const snap = nearestSnapshot(log, liveSituation(state, team));
    if (!snap) return;
    applySnapshot(state, team, snap);
  };
}

/**
 * The situations this log actually holds for one side, at the top of a down —
 * the down-and-distances the human really played, which is what the trainer
 * deals its scenarios from so the genome is judged on the football this coach
 * actually calls rather than on a uniform sample of the field.
 */
export function logSituations(log, side) {
  return log
    .filter((s) => s.situation.side === side && s.situation.turnIndex === 0)
    .map((s) => s.situation);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/tools/ghost.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`.

```bash
git add tools/ghost.js test/tools/ghost.test.js
git commit -m "feat: a ghost coach that replays a recorded human"
```

---

### Task 6: Train against the ghost — CLI, npm script, README

**Files:**
- Create: `tools/train-vs-ghost.js`
- Modify: `package.json`
- Modify: `README.md`
- Test: `test/tools/train-vs-ghost.test.js`

**Interfaces:**
- Consumes: `writeFileSync` (`node:fs`), `pathToFileURL` (`node:url`);
  `formationPlayers`, `aimSnap`, `SNAPPER_ID` (state.js); `GOAL_YARD`
  (view.js); `mulberry32` (rng.js); `DEFENSE_SPEC`, `DEFENSE_GENOME`,
  `OFFENSE_SPEC`, `OFFENSE_GENOME`, `genomeModuleSource` (learned/);
  `evolve` (evolve.js); `scenario`, `playOnePlay`, `defenseCoach`,
  `learnedOffenseCoach` (harness.js); `defenseFitness` (train-defense.js);
  `offenseFitness` (coevolve.js); `ghostCoach`, `logSituations`,
  `loadGhostLog` (ghost.js).
- Produces:
  - `GHOST_SITUATION_SHARE = 0.5` — how often a scenario is dealt from the
    log's own situations rather than at random.
  - `ghostScenario(rand, situations, variant = '7') -> state`.
  - `evaluateVsGhost(values, {log, side, plays, seed}) -> {yardsPerPlay,
    touchdownRate, turnoverRate}` — `side` names the trained side.
  - `trainVsGhost({log, side, generations, popSize, plays, seed, sigma}) ->
    {best, score, history}`.
  - CLI: `node tools/train-vs-ghost.js --log <path> [--side defense|offense]
    [--generations N] [--pop N] [--plays N] [--seed N] [--sigma F]`, guarded so
    importing the module runs nothing and writes nothing.
  - npm script `train:vs-ghost`.

- [ ] **Step 1: Write the failing test**

Create `test/tools/train-vs-ghost.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GHOST_SITUATION_SHARE, ghostScenario, evaluateVsGhost, trainVsGhost,
} from '../../tools/train-vs-ghost.js';
import { logSituations } from '../../tools/ghost.js';
import { captureSnapshot } from '../../lib/game/coach-log.js';
import {
  createGame, setPlan, formationPlayers, aimSnap, SNAPPER_ID,
} from '../../lib/game/state.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../lib/game/learned/offense-spec.js';

/** A down at a given spot, with an arrow on every man of one side. */
function recorded({ down, toGo, losYard, turnIndex, team, dir }) {
  const s = createGame({ seed: 1 });
  s.down = down;
  s.losYard = losYard;
  s.toGoYard = losYard + toGo;
  s.players = formationPlayers(losYard, s.variantId);
  s.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  s.plannedPass = null;
  aimSnap(s);
  for (const p of s.players) if (p.team === team) setPlan(s, p.id, dir, 1);
  s.turnIndex = turnIndex;
  return captureSnapshot(s, team);
}

// A log shaped like a real one: a call at the top of a down AND what the coach
// did about it on the next turn, for both sides of the ball. The mid-play
// entries matter — a ghost with nothing recorded past turn zero stands still
// once the play is running, and a defense that stands still turns every down
// into a twenty-four-turn stalemate rather than a play.
const LOG = [
  recorded({ down: 1, toGo: 10, losYard: 30, turnIndex: 0, team: 'offense', dir: { x: 0.6, y: 0.8 } }),
  recorded({ down: 1, toGo: 10, losYard: 30, turnIndex: 1, team: 'offense', dir: { x: 0.3, y: 0.95 } }),
  recorded({ down: 3, toGo: 2, losYard: 62, turnIndex: 0, team: 'offense', dir: { x: 0, y: 1 } }),
  recorded({ down: 2, toGo: 6, losYard: 44, turnIndex: 0, team: 'defense', dir: { x: 0, y: -1 } }),
  recorded({ down: 2, toGo: 6, losYard: 44, turnIndex: 1, team: 'defense', dir: { x: 0, y: -1 } }),
];

test("scenarios are dealt from the log's own down-and-distances as well as at random", () => {
  const situations = logSituations(LOG, 'offense');
  assert.equal(situations.length, 2);
  const rand = mulberry32(4);
  const spots = new Set();
  for (let i = 0; i < 40; i++) spots.add(ghostScenario(rand, situations).losYard);
  assert.ok(spots.has(30) || spots.has(62), 'a recorded spot came up');
  assert.ok(spots.size > 3, 'and so did spots that were never recorded');
  assert.ok(GHOST_SITUATION_SHARE > 0 && GHOST_SITUATION_SHARE < 1);
});

test('every scenario is a plannable down inside the field', () => {
  const rand = mulberry32(6);
  for (let i = 0; i < 15; i++) {
    const s = ghostScenario(rand, logSituations(LOG, 'offense'));
    assert.equal(s.phase, 'planning');
    assert.equal(s.turnIndex, 0);
    assert.equal(s.aiTeam, null);
    assert.ok(s.down >= 1 && s.down <= 4);
    assert.ok(s.losYard >= 15 && s.losYard <= 80);
    assert.ok(s.toGoYard > s.losYard && s.toGoYard <= 100);
    assert.ok(s.plannedPass, 'the snap is aimed');
  }
});

test('evaluating a genome against the ghost is deterministic for a seed', () => {
  const opts = { log: LOG, side: 'defense', plays: 3, seed: 11 };
  const a = evaluateVsGhost({ ...DEFENSE_SPEC.reduce((g, p) => ({ ...g, [p.key]: p.init }), {}) }, opts);
  const b = evaluateVsGhost({ ...DEFENSE_SPEC.reduce((g, p) => ({ ...g, [p.key]: p.init }), {}) }, opts);
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.yardsPerPlay));
  assert.ok(a.touchdownRate >= 0 && a.touchdownRate <= 1);
  assert.ok(a.turnoverRate >= 0 && a.turnoverRate <= 1);
});

test('training the defense against an offense ghost produces a whole genome', () => {
  const opts = {
    log: LOG, side: 'defense', generations: 1, popSize: 3, plays: 2, seed: 3, sigma: 0.05,
  };
  const a = trainVsGhost(opts);
  const b = trainVsGhost(opts);
  assert.equal(a.score, b.score);
  assert.deepEqual(a.best, b.best);
  for (const p of DEFENSE_SPEC) assert.equal(typeof a.best[p.key], 'number', p.key);
});

test('training the offense against a defense ghost produces a whole genome', () => {
  const { best } = trainVsGhost({
    log: LOG, side: 'offense', generations: 1, popSize: 2, plays: 2, seed: 3, sigma: 0.05,
  });
  for (const p of OFFENSE_SPEC) assert.equal(typeof best[p.key], 'number', p.key);
});

test('importing the trainer runs no training and writes no files', () => {
  // The import at the top of this file already proved it: if the CLI body ran
  // on import, the suite would train for minutes and rewrite a genome module.
  assert.ok(true);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/tools/train-vs-ghost.test.js`
Expected: FAIL — cannot find module `tools/train-vs-ghost.js`.

- [ ] **Step 3: Write the implementation**

Create `tools/train-vs-ghost.js`:

```js
/**
 * Train a genome against a GHOST OF YOU — the log the game's Coaches Menu
 * exports, replayed by tools/ghost.js as the opponent coach.
 *
 * Usage:
 *   node tools/train-vs-ghost.js --log coach-log.json --side defense \
 *     --generations 20 --pop 12 --plays 16 --seed 1
 *
 * `--side` names the genome to TRAIN; the ghost always plays the other one,
 * which is the side the human was recorded coaching. Training the defense
 * against a ghost of your offense is the normal use, and it writes
 * lib/game/learned/defense-genome.js exactly as tools/train-defense.js does;
 * training the offense against a ghost of your defense writes
 * offense-genome.js the same way.
 *
 * Everything else is the existing machinery: harness.js plays the downs,
 * evolve.js hill-climbs, and the fitness functions are the ones the other two
 * trainers already use, so a genome trained here is comparable to one trained
 * against the scripted offense or in co-evolution. The only new thing is who
 * is standing across the ball.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { formationPlayers, aimSnap, SNAPPER_ID } from '../lib/game/state.js';
import { GOAL_YARD } from '../lib/game/view.js';
import { mulberry32 } from '../lib/game/rng.js';
import { DEFENSE_SPEC } from '../lib/game/learned/defense-spec.js';
import { DEFENSE_GENOME } from '../lib/game/learned/defense-genome.js';
import { OFFENSE_SPEC } from '../lib/game/learned/offense-spec.js';
import { OFFENSE_GENOME } from '../lib/game/learned/offense-genome.js';
import { genomeModuleSource } from '../lib/game/learned/genome.js';
import { evolve } from './evolve.js';
import {
  scenario, playOnePlay, defenseCoach, learnedOffenseCoach,
} from './harness.js';
import { defenseFitness } from './train-defense.js';
import { offenseFitness } from './coevolve.js';
import { ghostCoach, logSituations, loadGhostLog } from './ghost.js';

/**
 * How often a training down is dealt from a situation the log actually holds
 * rather than from the harness's uniform sample of the field. Half and half on
 * purpose: all-recorded would overfit the genome to the handful of spots one
 * human happened to play from, and all-random would spend most of its downs in
 * situations the ghost has nothing near and therefore plays badly in.
 */
export const GHOST_SITUATION_SHARE = 0.5;

/**
 * A training down: the harness's own random scenario, or — half the time — the
 * same thing re-spotted to a down and distance the human really played. Every
 * value is clamped back into the harness's own legal range, because a log can
 * carry a goal-line snap or a fourth-and-thirty and the scenario contract is
 * what the rest of the harness relies on.
 */
export function ghostScenario(rand, situations, variant = '7') {
  const state = scenario(rand, variant);
  if (!situations.length || rand() >= GHOST_SITUATION_SHARE) return state;
  const pick = situations[Math.floor(rand() * situations.length)];
  state.down = Math.max(1, Math.min(4, Math.round(pick.down)));
  state.losYard = Math.max(15, Math.min(80, Math.round(pick.losYard)));
  state.toGoYard = Math.min(
    state.losYard + Math.max(1, Math.round(pick.toGo)), GOAL_YARD,
  );
  state.players = formationPlayers(state.losYard, variant);
  state.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  state.plannedPass = null;
  aimSnap(state);
  return state;
}

/**
 * Mean per-play stats for one genome over `plays` seeded downs against the
 * ghost. Same aggregation as harness.js's evaluateDefense — one stats object,
 * read negatively by the defense's fitness and positively by the offense's.
 */
export function evaluateVsGhost(values, { log, side, plays, seed }) {
  const ghostSide = side === 'defense' ? 'offense' : 'defense';
  const situations = logSituations(log, ghostSide);
  const ghost = ghostCoach(log, ghostSide);
  const offense = side === 'defense' ? ghost : learnedOffenseCoach(values);
  const defense = side === 'defense' ? defenseCoach(values) : ghost;

  const rand = mulberry32(seed);
  let yards = 0;
  let touchdowns = 0;
  let turnovers = 0;
  for (let i = 0; i < plays; i++) {
    const state = ghostScenario(rand, situations);
    const result = playOnePlay(
      state, offense, defense, mulberry32(1 + Math.floor(rand() * 2 ** 30)),
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

export function trainVsGhost({ log, side, generations, popSize, plays, seed, sigma }) {
  const spec = side === 'defense' ? DEFENSE_SPEC : OFFENSE_SPEC;
  const seedGenome = side === 'defense' ? DEFENSE_GENOME.values : OFFENSE_GENOME.values;
  const fitness = side === 'defense' ? defenseFitness : offenseFitness;
  return evolve({
    spec,
    seedGenome,
    popSize,
    generations,
    sigma,
    seed,
    // Common random numbers: every candidate in generation g sees the same
    // downs and the same dice — and the same ghost, which rolls none.
    fitness: (genome, gen) => fitness(
      evaluateVsGhost(genome, { log, side, plays, seed: seed * 1000003 + gen }),
    ),
    onGeneration: (gen, scored) =>
      console.log(`gen ${gen}: champion ${scored[0].score.toFixed(3)}`),
  });
}

function numArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

function strArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

// CLI body — guarded so importing this module (the tests) runs nothing and
// writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logPath = strArg('log', null);
  const side = strArg('side', 'defense');
  if (!logPath) {
    console.error('usage: node tools/train-vs-ghost.js --log <path> [--side defense|offense]');
    process.exit(1);
  }
  if (side !== 'defense' && side !== 'offense') {
    console.error(`--side must be "defense" or "offense", not "${side}"`);
    process.exit(1);
  }
  const log = loadGhostLog(logPath);
  const ghostSide = side === 'defense' ? 'offense' : 'defense';
  // A ghost with nothing to imitate stands still for every down, and a genome
  // trained against a statue is worse than the one it started from. Refuse
  // loudly rather than spend twenty minutes producing that.
  const usable = log.filter(
    (s) => s.situation.side === ghostSide && s.situation.variant === '7',
  );
  if (usable.length === 0) {
    console.error(`${logPath} holds no '7' ${ghostSide} snapshots — the ghost would have nobody to imitate.`);
    process.exit(1);
  }
  // A log of nothing but play calls leaves the ghost standing still the moment
  // a down starts running, and a side that stands still turns most plays into
  // stalemates scored at the turn cap rather than into football. A log exported
  // from real drives always has mid-play snapshots; say so when one does not,
  // rather than quietly training on nonsense.
  if (!usable.some((s) => s.situation.turnIndex > 0)) {
    console.warn('warning: no mid-play snapshots in this log — the ghost will stand still once a play is running.');
  }
  const opts = {
    generations: numArg('generations', 20),
    popSize: numArg('pop', 12),
    plays: numArg('plays', 16),
    seed: numArg('seed', 1),
    sigma: numArg('sigma', 0.08),
  };
  console.log(
    `training ${side} against a ghost of ${usable.length} recorded ${ghostSide} snapshots:`,
    opts,
  );
  const { best, score } = trainVsGhost({ log, side, ...opts });
  const file = side === 'defense' ? 'defense-genome.js' : 'offense-genome.js';
  const exportName = side === 'defense' ? 'DEFENSE_GENOME' : 'OFFENSE_GENOME';
  console.log(`champion fitness ${score.toFixed(3)} — writing ${file}`);
  writeFileSync(
    new URL(`../lib/game/learned/${file}`, import.meta.url),
    genomeModuleSource(exportName, best, {
      variant: '7',
      trainedBy: 'tools/train-vs-ghost.js',
      opponent: `ghost of ${logPath} (${usable.length} ${ghostSide} snapshots)`,
      options: opts,
      fitness: score,
    }),
  );
}
```

Modify `package.json` — add to `scripts`, after `"train:coevolve"`:

```json
    "train:vs-ghost": "node tools/train-vs-ghost.js"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/tools/train-vs-ghost.test.js`
Expected: PASS (6 tests). These simulate real plays, so allow a few seconds.

- [ ] **Step 5: Prove the CLI end to end**

Export a log from the browser (Task 4's walk, step 4) and save it as
`coach-log.json` in the repo root — or, if you would rather not play a drive
by hand first, write one from a Node one-liner. Then run a tiny training:

```bash
node tools/train-vs-ghost.js --log coach-log.json --side defense \
  --generations 2 --pop 4 --plays 4 --seed 3
```

Expected: it prints how many recorded snapshots the ghost has, two
`gen N: champion ...` lines, and rewrites
`lib/game/learned/defense-genome.js`. Then:

Run: `npm test`
Expected: ALL PASS — in particular `defense-spec.test.js`'s "the shipped genome
loads, matches the variant, and is already clamped" test now guards the file
the ghost trainer wrote, and no game test depends on its numbers.

Then check the failure path:

```bash
node tools/train-vs-ghost.js --side defense
```

Expected: the usage line and exit status 1, with nothing written.

Finally, restore the genome unless you actually mean to ship the one you just
trained on four downs:

```bash
git checkout lib/game/learned/defense-genome.js
```

- [ ] **Step 6: Document it**

In `README.md`, in the existing "Training the learned AI" section, after the
`npm run train:defense` paragraph, add:

```markdown
To train the defense against a ghost of **you** — the coach the game has
actually been recording:

    npm run train:vs-ghost -- --log coach-log.json --side defense

Every time you press **Run Turn**, the game writes down the call you just
made — where your men were standing, every arrow, every cover order, the
throw — and keeps it in the browser. **Copy coaching log** in the Coaches
Menu hands the whole record over as JSON; save it as a file and point the
trainer at it. The trainer replays your recorded calls as the opponent
(nearest recorded situation to the live one, deterministically) and evolves
the genome against thousands of simulated downs of *your* football, dealing
half its scenarios from the down-and-distances you actually played. Pass
`--side offense` to train the computer's offense against a ghost of your
defense instead. **Forget my tendencies** in the same menu clears the record.
```

- [ ] **Step 7: Commit**

```bash
git add tools/train-vs-ghost.js test/tools/train-vs-ghost.test.js package.json README.md
git commit -m "feat: train a genome against a ghost of your own coaching"
```

---

## Verification checklist (whole plan)

- `npm test` green from a clean checkout.
- `test/game/learned/defense-tendencies.test.js`'s first test passes: with no
  history, `learnedOrders` returns byte-for-byte what it returned before this
  plan — and its last test passes: history changes nothing whatsoever for the
  smart level, which is what Training Mode plays.
- Every existing call site still works untouched: `tools/harness.js` calls
  `learnedOrders(state, team, values)` with three arguments, and
  `test/game/learned/defense-policy.test.js` is not edited by this plan at all.
- The browser walk in Task 4, Step 4 passes end to end: the log count climbs
  on every Run Turn, survives a reload, copies out as `{"v":1,"snapshots":[…]}`,
  and clears; the learned defense visibly leans toward zone on the down and
  distance you keep throwing on, and toward the receiver you keep throwing to.
- `npm run train:vs-ghost -- --log coach-log.json --side defense --generations 2
  --pop 4 --plays 4 --seed 3` completes in well under a minute and rewrites
  `lib/game/learned/defense-genome.js` with a loadable module; running it twice
  with the same seed and log produces the same champion.
- `node tools/train-vs-ghost.js --side defense` (no `--log`) exits 1 with a
  usage line and writes nothing; a log with no snapshots for the ghost's side
  is refused by name rather than trained against.
- Nothing under `lib/` imports `node:` anything or touches the DOM:
  `grep -rn "node:" lib/` and `grep -rn "localStorage\|document\." lib/` both
  come back empty.
- Out of scope and left that way: the learned OFFENSE does not read tendencies
  in v1, and no level other than `learned` defense reads them at all.
