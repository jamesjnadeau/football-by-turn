# Passing and Handoffs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ball carrier can throw — one forward pass per down from behind the line of scrimmage, unlimited backward throws and handoffs — planned by double-tapping him and dragging, with illegal throws allowed to happen and flagged after the whistle.

**Architecture:** A throw is the loose-ball machinery the game already has for fumbles, released with a much larger initial velocity: the ball leaves the passer's hands as `state.ball` with `carrierId: null`, flies under the existing `stepPhysics` decay, and is claimed by the existing `checkPickup`. That one decision makes catches, drops, handoffs and interceptions the same code path — an interception is just `checkPickup` awarding the ball to a defender, which already ends the play. The pass *rules* (what counts as forward, when a forward throw draws a flag, and the act of releasing) live in one new pure module, `lib/game/pass.js`; the flag it records is enforced by `nextDown` after the down ends, never during it.

**Tech Stack:** Plain ES modules, SVG, Node 20+ built-in test runner (`node --test`). No build step, no npm dependencies.

**Spec:** [README.md](../../../README.md) plus the request this plan implements, verbatim:

> to allow legal passing and handoffs. You are allowed one foward pass behind the line of scrimmage, and you can throw or hand the ball backwards as much as you want. To enter this mode, you double tap then drag on the ball carrier. If the user tries to throw illegally, allow them to, but call the penalty after the down is over.

## Global Constraints

- No npm dependencies and no build step. `package.json` exists only for `"type": "module"` and scripts.
- Everything under `lib/` is pure: no `document`, no `window`, no `node:` imports, no `Date.now()`, no unseeded `Math.random()`. DOM code lives only under `app/`. **Nothing in this feature uses randomness at all** — a throw is deterministic, so a passing play is as reproducible in tests as a running one.
- Vendored files in `lib/field/` and `app/vendor/` are copied verbatim from upstream and never edited.
- All physics runs in SVG units. 1 yard = 3.75 units. `y` increases toward the goal the offense attacks, so **forward is `+y`** and the offense lines up at *smaller* `y` than the defense.
- Game state objects stay plain JSON-serializable data.
- Every tunable number goes in `lib/game/constants.js`, nowhere else.
- Tests use `node:test` + `node:assert/strict`, one file per module under `test/game/`. Run everything with `npm test`. The suite is at **91/91** before this plan starts; it must be green at every commit.
- **No existing test may be edited.** Every task below only appends tests and, where stated, extends an existing import line. If an existing test starts failing, that is a bug in the change, not a stale test.
- The computer opponent added in the previous branch must keep working untouched: `runTurn` calls `coachAi(state)` at the top and `clearAiPlans(state)` at the bottom, and no plan of the computer's may exist while `phase === 'planning'`.

## Design decisions (read before implementing)

1. **A throw is a loose ball, not a new object.** `releasePass` writes the same `{carrierId: null, pos, vel, loose}` shape a fumble writes, plus one extra field, `forward`. Everything downstream — the per-sub-step roll, `checkPickup`, the animation in `app/main.js` that gives a loose ball its own moving node — already works, unchanged. A separate "ball in flight" type would duplicate all of it.
2. **A handoff is a short backward throw.** The spec names handoffs and backward throws in the same breath and gives them the same rule (unlimited). They get one mechanic, not two: drag short and backward for a handoff, long and forward for a bomb.
3. **Forward is judged at release, by the direction drawn** (`dir.y > 0`), not by where the ball ends up. It is what the player intended and what he can see on screen before he commits. A flat sideways throw (`dir.y === 0`) is a lateral, i.e. **not** forward — which matches real football and keeps the legality test a single comparison.
4. **"Behind the line of scrimmage" is judged on the passer's centre.** The ball is drawn at his leading edge, but the edge moves with his facing and would make the rule depend on which way he happens to be looking. At the snap the QB is 4 yards back and every lineman 1 yard back, so the centre rule never surprises anyone.
5. **An illegal throw is never blocked.** The spec is explicit. `releasePass` throws the ball exactly as asked, records a flag on `state.penalty`, and returns a `flag` event. Nothing about the play changes until the whistle.
6. **The flag is enforced by `nextDown`, and the defense declines it when it has the ball.** Enforcement wipes whatever the illegal play produced — a touchdown included — and spots the ball `PENALTY_YARDS` behind the *previous* line of scrimmage, with the down counting (real football's "loss of down", which in a game with no first downs is just the ordinary increment). The one exception is the case where declining is obviously right: if the play ended in a defensive recovery (an interception, or a fumble the defense fell on), the defense keeps the football and the flag is declined. That is the whole decline rule — no menu, no prompt.
7. **An uncaught forward pass is incomplete; an uncaught backward pass is live.** This is the one real difference between the two throws, and it is football's own rule. There is no z axis here, so "the ball hit the ground" is modelled as the throw having decayed to `PASS_DEAD_SPEED`. An incomplete pass kills the play, costs the down, and gains nothing. A lateral that nobody catches stays live, which is exactly what the existing loose-ball code already does with it — so that half needs no code at all, only a test proving it.
8. **A second forward pass is illegal even if the first one was.** `releasePass` increments `state.forwardPasses` whatever the verdict, so a down cannot launder two illegal throws into one flag.
9. **A throw is planned for one turn, like an arrow.** `state.plannedPass` is cleared at the end of every `runTurn`, next to the existing `clearAiPlans`. If the carrier changes between planning and the whistle (he fumbled), the throw is silently cancelled — the man who planned it no longer has the ball.
10. **A fast throw can step over a catcher, and that is accepted.** `checkPickup` tests distance once per sub-step, so a ball moving faster than a player's scoop diameter can pass him between two samples. At `PASS_SPEED_MAX` the ball's first sub-step is 6.7 units against a skill player's 3.5-unit scoop range, so an early-flight catcher can be missed; by the time the throw has decayed to the range a receiver actually runs to, the step is ~5 units and the catch lands. This is why `PASS_SPEED_MAX` is 400 and not higher, and it is a deliberate trade: a swept-volume pickup test would fix it and would mean rewriting a rule the fumble path shares. The arithmetic behind Task 3's two catch tests (a receiver 40 units downfield is sampled at 38.96 on sub-step 6, comfortably inside 3.5) is the check that this is tuned, not lucky. If throws start feeling uncatchable in playtesting, lower `PASS_SPEED_MAX` before touching `checkPickup`.
11. **The gesture stays pure.** `classifyGesture` gains an optional second argument, `prevClickAt`: the timestamp this same player was last tapped. A drag beginning within `DOUBLE_TAP_MS` of that tap is a `passdrag`. The per-player bookkeeping of "when was he last tapped" lives in `app/input.js`, which is where pointer state belongs; the decision stays in `lib/` where it can be tested.

## File Structure

```
lib/game/
├── pass.js        # NEW: isForward, passFoul, releasePass — the throw and its rules
├── constants.js   # + PASS_SPEED_MIN/MAX, PASS_SPAWN_EPSILON, PASS_GRACE_SUBSTEPS,
│                  #   PASS_DEAD_SPEED, PENALTY_YARDS, MAX_PASS_ARROW_UNITS
├── state.js       # + state.plannedPass / forwardPasses / penalty; setPass, clearPass
├── turn.js        # releasePass at the snap of the turn; checkIncomplete per sub-step;
│                  #   clearPass at the end
├── rules.js       # + checkIncomplete; nextDown enforces the flag
├── gesture.js     # + 'passdrag' kind, DOUBLE_TAP_MS
└── render.js      # + renderPassArrow
test/game/
└── pass.test.js   # NEW
app/input.js       # per-player last-tap bookkeeping, passed into classifyGesture
app/main.js        # passdrag → setPass; pass arrow; the post-whistle flag message
README.md          # document throwing
```

---

### Task 1: Where a planned throw lives

**Files:**
- Modify: `lib/game/state.js` — `createGame`'s returned object, `clearAllPlans`, and two new exports
- Test: `test/game/state.test.js` (append)

**Interfaces:**
- Consumes: `carrier(state)`, already exported from `lib/game/state.js`.
- Produces: `state.plannedPass: { from: string, dir: {x,y}, power: number } | null` (initially `null`), `state.forwardPasses: number` (initially `0`), `state.penalty: { foul: string, spot: number } | null` (initially `null`); `setPass(state, dir, power) -> boolean`; `clearPass(state) -> void`.

- [ ] **Step 1: Write the failing tests**

Extend `test/game/state.test.js`'s existing import from `../../lib/game/state.js` to:

```js
import {
  createGame, setPlan, clearAllPlans, setMode, placePlayer, getPlayer, ballPos, carrier,
  isControllable, setPass, clearPass,
} from '../../lib/game/state.js';
```

Then append:

```js
test('a new game has no throw planned, no forward pass thrown, and no flag', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.plannedPass, null);
  assert.equal(s.forwardPasses, 0);
  assert.equal(s.penalty, null);
});

test('only the ball carrier can plan a throw, and a second throw replaces the first', () => {
  const s = createGame({ seed: 1 });
  assert.equal(setPass(s, { x: 0, y: 1 }, 0.5), true);
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 0, y: 1 }, power: 0.5 });
  setPass(s, { x: 1, y: 0 }, 0.9);
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 1, y: 0 }, power: 0.9 });
  clearPass(s);
  assert.equal(s.plannedPass, null);
  // Nobody is carrying the ball, so there is nothing to throw.
  s.ball = { carrierId: null, pos: { x: 100, y: 100 }, vel: { x: 0, y: 0 } };
  assert.equal(setPass(s, { x: 0, y: 1 }, 0.5), false);
  assert.equal(s.plannedPass, null);
});

test('Clear Arrows drops the planned throw along with the run arrows', () => {
  const s = createGame({ seed: 1 });
  setPass(s, { x: 0, y: 1 }, 0.5);
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  clearAllPlans(s);
  assert.equal(s.plannedPass, null);
  assert.ok(s.players.every((p) => p.plan === null));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `setPass is not a function` (or a SyntaxError about the missing export).

- [ ] **Step 3: Write the implementation**

In `lib/game/state.js`, add three fields to the object `createGame` returns, immediately after `ball`:

```js
    ball: { carrierId: 'o-qb', pos: null, vel: null },
    // A throw planned for this turn, the down's forward-pass tally, and the
    // flag it may have earned. All three are per-down: nextDown resets them.
    plannedPass: null,
    forwardPasses: 0,
    penalty: null,
    deadReason: null,
```

Replace `clearAllPlans` so the Clear Arrows button drops the throw too:

```js
export function clearAllPlans(state) {
  for (const p of state.players) p.plan = null;
  state.plannedPass = null;
}
```

And append these two functions:

```js
/**
 * Plan a throw for this turn. Only whoever is holding the ball may throw, and
 * only one throw is planned at a time — a second call replaces the first,
 * exactly as a second drag replaces a movement arrow. `power` is the drag's
 * throttle in [0,1]; pass.js's releasePass is what turns it into a speed.
 */
export function setPass(state, dir, power) {
  const car = carrier(state);
  if (!car) return false;
  state.plannedPass = { from: car.id, dir, power };
  return true;
}

export function clearPass(state) {
  state.plannedPass = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the three new tests and all 91 pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add lib/game/state.js test/game/state.test.js
git commit -m "feat: state for a planned throw, the down's pass tally, and its flag"
```

---

### Task 2: The throw and its rules

**Files:**
- Modify: `lib/game/constants.js` (append a section)
- Create: `lib/game/pass.js`
- Test: `test/game/pass.test.js` (create)

**Interfaces:**
- Consumes: `state.plannedPass`, `state.forwardPasses`, `state.penalty`, `setPass` from Task 1; `carrier` from `state.js`; `yardsOfY` from `view.js`; `add`, `scale` from `vec.js`; the existing `PICKUP_RADIUS_BONUS` from `constants.js`.
- Produces:
  - `isForward(dir) -> boolean`
  - `passFoul(state, passer, dir) -> 'second-forward-pass' | 'illegal-forward-pass' | null`
  - `releasePass(state) -> Array<{type: 'pass', by: string, forward: boolean} | {type: 'flag', foul: string}>`
  - Constants `PASS_SPEED_MIN`, `PASS_SPEED_MAX`, `PASS_SPAWN_EPSILON`, `PASS_GRACE_SUBSTEPS`.
  - The ball shape a throw produces: `{ carrierId: null, pos, vel, loose: PASS_GRACE_SUBSTEPS, forward: boolean }`.

- [ ] **Step 1: Write the failing tests**

Create `test/game/pass.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isForward, passFoul, releasePass } from '../../lib/game/pass.js';
import { createGame, getPlayer, setPass } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';
import { len } from '../../lib/game/vec.js';
import {
  PASS_SPEED_MIN, PASS_SPEED_MAX, PASS_SPAWN_EPSILON, PASS_GRACE_SUBSTEPS,
  PICKUP_RADIUS_BONUS,
} from '../../lib/game/constants.js';

test('forward means toward the goal the offense attacks; a flat lateral is not', () => {
  assert.equal(isForward({ x: 0, y: 1 }), true);
  assert.equal(isForward({ x: 1, y: 0.001 }), true);
  assert.equal(isForward({ x: 0, y: -1 }), false);
  assert.equal(isForward({ x: 1, y: 0 }), false);
});

test('backward throws are always legal, however many have gone before', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  s.forwardPasses = 5;
  assert.equal(passFoul(s, qb, { x: 0, y: -1 }), null);
  assert.equal(passFoul(s, qb, { x: 1, y: 0 }), null);
});

test('the first forward pass from behind the line is legal; a second is not', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  assert.equal(passFoul(s, qb, { x: 0, y: 1 }), null);
  s.forwardPasses = 1;
  assert.equal(passFoul(s, qb, { x: 0, y: 1 }), 'second-forward-pass');
});

test('a forward pass from beyond the line of scrimmage is illegal', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  qb.pos = fieldPos(0, s.losYard + 2); // he crossed the line before throwing
  assert.equal(passFoul(s, qb, { x: 0, y: 1 }), 'illegal-forward-pass');
  assert.equal(passFoul(s, qb, { x: 0, y: -1 }), null, 'he may still throw backwards');
});

test('releasing a throw puts the ball in the air, clear of the passer\'s own reach', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const from = { ...qb.pos };
  setPass(s, { x: 0, y: 1 }, 1);
  const events = releasePass(s);
  assert.equal(s.ball.carrierId, null);
  assert.equal(s.ball.forward, true);
  assert.equal(s.ball.loose, PASS_GRACE_SUBSTEPS);
  assert.ok(Math.abs(len(s.ball.vel) - PASS_SPEED_MAX) < 1e-9, 'full power');
  const off = Math.hypot(s.ball.pos.x - from.x, s.ball.pos.y - from.y);
  assert.ok(off > qb.radius + PICKUP_RADIUS_BONUS, 'outside his own scoop range');
  assert.ok(Math.abs(off - (qb.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON)) < 1e-9);
  assert.deepEqual(events, [{ type: 'pass', by: 'o-qb', forward: true }]);
  assert.equal(s.forwardPasses, 1);
  assert.equal(s.penalty, null);
});

test('an illegal throw is allowed to happen, and flagged', () => {
  const s = createGame({ seed: 1 });
  s.forwardPasses = 1; // he already threw one this down
  setPass(s, { x: 0, y: 1 }, 0.5);
  const events = releasePass(s);
  assert.equal(s.ball.carrierId, null, 'the throw still happens');
  assert.deepEqual(s.penalty, { foul: 'second-forward-pass', spot: s.losYard });
  assert.deepEqual(events[1], { type: 'flag', foul: 'second-forward-pass' });
  assert.equal(s.forwardPasses, 2, 'an illegal forward pass still counts as one');
});

test('a backward throw touches neither the forward tally nor the flag', () => {
  const s = createGame({ seed: 1 });
  setPass(s, { x: 0, y: -1 }, 0.3);
  releasePass(s);
  assert.equal(s.forwardPasses, 0);
  assert.equal(s.penalty, null);
  assert.equal(s.ball.forward, false);
});

test('power scales the throw from the shortest handoff to the longest bomb', () => {
  const s = createGame({ seed: 1 });
  setPass(s, { x: 0, y: -1 }, 0);
  releasePass(s);
  assert.ok(Math.abs(len(s.ball.vel) - PASS_SPEED_MIN) < 1e-9, 'zero power is still a handoff');
});

test('a fumble between planning and the whistle cancels the throw', () => {
  const s = createGame({ seed: 1 });
  setPass(s, { x: 0, y: 1 }, 1);
  s.ball = { carrierId: 'o-rb', pos: null, vel: null }; // somebody else has it now
  assert.deepEqual(releasePass(s), []);
  assert.equal(s.ball.carrierId, 'o-rb', 'the ball stays where it is');
  assert.equal(s.forwardPasses, 0);
});

test('nothing planned, nothing thrown', () => {
  const s = createGame({ seed: 1 });
  assert.deepEqual(releasePass(s), []);
  assert.equal(s.ball.carrierId, 'o-qb');
});

test('only the first flag of a down is kept', () => {
  const s = createGame({ seed: 1 });
  setPass(s, { x: 0, y: 1 }, 1);
  releasePass(s);                       // legal: the down's one forward pass
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  setPass(s, { x: 0, y: 1 }, 1);
  releasePass(s);                       // illegal: second forward pass
  const first = { ...s.penalty };
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  setPass(s, { x: 0, y: 1 }, 1);
  releasePass(s);                       // illegal again
  assert.deepEqual(s.penalty, first, 'one flag per down, the first one');
  assert.equal(s.forwardPasses, 3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module .../lib/game/pass.js`.

- [ ] **Step 3: Write the implementation**

Append to `lib/game/constants.js`:

```js
// --- passing ---
// A throw is the loose-ball machinery with a much bigger initial speed, so its
// total flight is the same closed form as the fumble roll-out:
// speed * DT / (1 - BALL_FRICTION) = speed / 3.6 units.
// 400 / 3.6 = 111 units = 29.6 yards at full power — a long throw on a field
// whose whole depth is 30 yards. Half power covers about 15.
export const PASS_SPEED_MAX = 400;
// The shortest handoff still has to leave the passer's hands and reach the man
// beside him: 60 / 3.6 = 16.7 units = 4.4 yards of travel.
export const PASS_SPEED_MIN = 60;
// The ball leaves from the passer's leading edge, strictly outside his own
// scoop range so he cannot re-take his own throw where he stands — the same
// reasoning, and the same arithmetic, as FUMBLE_SPAWN_EPSILON.
export const PASS_SPAWN_EPSILON = 0.5;
// Nobody may claim a throw for this many sub-steps. Much shorter than
// LOOSE_BALL_GRACE_SUBSTEPS, because a throw only needs to clear the thrower,
// not give a scattered field a fair race: at PASS_SPEED_MIN the ball is
// already 2.8 units further out after 3 sub-steps, so a handoff to the man
// two yards away is still catchable this turn.
export const PASS_GRACE_SUBSTEPS = 3;
// A forward pass nobody caught is incomplete once the throw has decayed to
// walking pace — this game has no z axis, so this is what "it hit the ground"
// means. A backward throw never gets here: a lateral on the ground is live.
export const PASS_DEAD_SPEED = 12;
// The illegal-pass penalty: this many yards back from the previous spot, and
// the down counts.
export const PENALTY_YARDS = 5;
// Drag length that means a full-power throw. Longer than MAX_ARROW_UNITS
// because a throw covers far more ground than a run.
export const MAX_PASS_ARROW_UNITS = 60;
```

Create `lib/game/pass.js`:

```js
/**
 * Throwing: the forward-pass rules, and the act of letting go of the ball.
 *
 * The spec's rule is one forward pass per down and only from behind the line
 * of scrimmage; backward throws are unlimited, and a handoff is simply a short
 * one — so there is a single throw mechanic here, not two. An illegal throw is
 * never blocked. It happens exactly as asked, a flag is recorded on the state,
 * and rules.js's nextDown enforces it after the whistle.
 *
 * A thrown ball IS a loose ball: same shape, same per-sub-step decay in
 * physics.js, same checkPickup. That is what makes a catch, a dropped handoff
 * and an interception one code path instead of three.
 */
import { add, scale } from './vec.js';
import { carrier } from './state.js';
import { yardsOfY } from './view.js';
import {
  PASS_SPEED_MIN, PASS_SPEED_MAX, PASS_SPAWN_EPSILON, PASS_GRACE_SUBSTEPS,
  PICKUP_RADIUS_BONUS,
} from './constants.js';

/**
 * Forward means the throw carries the ball toward the goal the offense
 * attacks, which is +y. A dead-flat sideways throw is a lateral, not a forward
 * pass — hence the strict comparison.
 */
export function isForward(dir) {
  return dir.y > 0;
}

/**
 * Why this throw would draw a flag, or null if it is clean.
 *
 * Backward throws are always clean. A forward throw is clean only from behind
 * the line and only if this down has not already had one — and "already had
 * one" counts an earlier ILLEGAL forward pass too, which is why releasePass
 * increments the tally whatever the verdict here. Behind the line is judged on
 * the passer's centre: the ball is drawn at his leading edge, but that edge
 * swings with his facing and the rule should not depend on where he is looking.
 */
export function passFoul(state, passer, dir) {
  if (!isForward(dir)) return null;
  if (state.forwardPasses > 0) return 'second-forward-pass';
  if (yardsOfY(passer.pos.y) > state.losYard) return 'illegal-forward-pass';
  return null;
}

/**
 * Put the planned throw in the air, and report what happened: a `pass` event
 * always, plus a `flag` event when it drew one. Returns [] and changes nothing
 * when no throw is planned, or when the man who planned it is no longer the
 * one holding the ball — a fumble between planning and the whistle cancels it.
 */
export function releasePass(state) {
  const planned = state.plannedPass;
  if (!planned) return [];
  const car = carrier(state);
  if (!car || car.id !== planned.from) return [];

  const forward = isForward(planned.dir);
  const foul = passFoul(state, car, planned.dir);
  if (forward) state.forwardPasses += 1;
  // One flag per down: a second foul does not overwrite the first.
  if (foul && state.penalty === null) state.penalty = { foul, spot: state.losYard };

  const speed = PASS_SPEED_MIN + (PASS_SPEED_MAX - PASS_SPEED_MIN) * planned.power;
  const offset = car.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON;
  state.ball = {
    carrierId: null,
    pos: add(car.pos, scale(planned.dir, offset)),
    vel: scale(planned.dir, speed),
    loose: PASS_GRACE_SUBSTEPS,
    forward,
  };

  const events = [{ type: 'pass', by: car.id, forward }];
  if (foul) events.push({ type: 'flag', foul });
  return events;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the eleven new `pass.test.js` tests and the whole pre-existing suite.

- [ ] **Step 5: Commit**

```bash
git add lib/game/pass.js lib/game/constants.js test/game/pass.test.js
git commit -m "feat: throwing — forward-pass rules and the release"
```

---

### Task 3: The throw in the turn, and the incomplete pass

**Files:**
- Modify: `lib/game/rules.js` — add `checkIncomplete` (append after `checkPickup`)
- Modify: `lib/game/turn.js` — imports, and `runTurn`
- Test: `test/game/turn.test.js` (append)

**Interfaces:**
- Consumes: `releasePass(state)` from Task 2; `clearPass(state)` and `setPass` from Task 1; `PASS_DEAD_SPEED` from `constants.js`; the ball's `forward` flag written by `releasePass`.
- Produces: `checkIncomplete(state) -> Array<{type: 'incomplete'}>`; `state.deadReason === 'incomplete'` as a new way for a play to end; `runTurn` releases any planned throw at the start of the turn and clears `state.plannedPass` at the end.

- [ ] **Step 1: Write the failing tests**

Extend `test/game/turn.test.js`'s existing import from `../../lib/game/state.js` to add `setPass`:

```js
import { createGame, setPlan, getPlayer, setPass } from '../../lib/game/state.js';
```

Then append:

```js
test('a planned throw goes up at the snap of the turn, and the ball flies', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb'); // nobody out there to catch it
  setPass(s, { x: 0, y: 1 }, 1);
  const { frames, events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'pass'), 'the throw was reported');
  assert.equal(s.ball.carrierId, null, 'the ball is out of his hands');
  assert.ok(frames[0].looseBall, 'loose from the very first sub-step');
  const first = frames[0].ball;
  const last = frames[frames.length - 1].ball;
  const travelled = Math.hypot(last.x - first.x, last.y - first.y);
  assert.ok(travelled > 40, `the throw covered ground (${travelled.toFixed(1)} units)`);
  assert.equal(s.plannedPass, null, 'a throw is planned for one turn only');
});

test('a forward pass nobody catches is incomplete: dead ball, play over', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb');
  setPass(s, { x: 0, y: 1 }, 1);
  let turns = 0;
  while (s.phase !== 'playOver' && turns < 8) { runTurn(s, mulberry32(1)); turns += 1; }
  assert.equal(s.deadReason, 'incomplete');
  assert.equal(s.phase, 'playOver');
});

test('a backward throw nobody catches stays live — a lateral on the ground is a fumble', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb');
  setPass(s, { x: 0, y: -1 }, 1);
  let turns = 0;
  while (s.phase !== 'playOver' && turns < 8) { runTurn(s, mulberry32(1)); turns += 1; }
  assert.equal(s.deadReason, null, 'still live after the ball has stopped');
  assert.equal(s.ball.carrierId, null);
});

test('a teammate downfield catches the throw', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'o-wr1');
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  // Park him straight downfield of the QB, inside the first turn's flight.
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 40 };
  setPass(s, { x: 0, y: 1 }, 1);
  const { events } = runTurn(s, mulberry32(1));
  assert.deepEqual(
    events.find((e) => e.type === 'pickup'),
    { type: 'pickup', by: 'o-wr1', team: 'offense' },
  );
  assert.equal(s.ball.carrierId, 'o-wr1');
  assert.equal(s.deadReason, null, 'a completion keeps the down alive');
});

test('a defender in the throwing lane intercepts it — the play is over', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'd-cb1');
  const qb = getPlayer(s, 'o-qb');
  const cb = getPlayer(s, 'd-cb1');
  cb.pos = { x: qb.pos.x, y: qb.pos.y + 40 };
  cb.plan = null;
  s.aiTeam = null; // hot-seat: he stands where he is put, so the throw finds him
  setPass(s, { x: 0, y: 1 }, 1);
  const { events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'pickup' && e.team === 'defense'));
  assert.equal(s.deadReason, 'recovered');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the throw is never released, so `events` has no `pass`, `s.ball.carrierId` is still `'o-qb'`, and `deadReason` never becomes `'incomplete'`.

- [ ] **Step 3: Write the implementation**

In `lib/game/rules.js`, add `PASS_DEAD_SPEED` to the existing import from `./constants.js`, and append this function immediately after `checkPickup`:

```js
/**
 * A forward pass nobody caught. There is no z axis in this game, so "the ball
 * hit the ground" is modelled as the throw having decayed to PASS_DEAD_SPEED:
 * at that point the play is dead, the down counts, and nextDown spots the ball
 * back at the previous line — an incomplete pass gains nothing.
 *
 * A BACKWARD throw gets no such mercy, and needs no code here: a lateral on
 * the ground is a live ball, which is exactly what the loose-ball machinery
 * already does with it. Only `forward` throws are checked.
 */
export function checkIncomplete(state) {
  if (state.deadReason || state.ball.carrierId !== null || !state.ball.forward) return [];
  if (len(state.ball.vel) > PASS_DEAD_SPEED) return [];
  state.deadReason = 'incomplete';
  return [{ type: 'incomplete' }];
}
```

In `lib/game/turn.js`, extend the two imports and add one:

```js
import { checkTackles, checkPickup, checkDeadBall, checkIncomplete } from './rules.js';
import { ballPos, clearPass } from './state.js';
import { releasePass } from './pass.js';
```

Then replace `runTurn`:

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
  // The throw leaves before anyone moves. The arrow said where the ball goes;
  // from here it is an ordinary loose ball and the machinery below flies it,
  // decides who catches it, and rules on what that catch means.
  events.push(...releasePass(state));
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
    // Last: a catch in this same sub-step beats the ball settling.
    events.push(...checkIncomplete(state));
    frames.push(snapshot(state));
    if (state.deadReason) break;
  }
  for (const p of state.players) p.charge = 0; // the burst lasts one turn (spec)
  clearAiPlans(state); // ...and the computer's arrows do not outlive the turn either
  clearPass(state);    // ...nor does a throw: it is planned one turn at a time
  state.turnIndex += 1;
  state.phase = state.deadReason ? 'playOver' : 'planning';
  return { frames, events };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the five new tests and the whole pre-existing suite.

- [ ] **Step 5: Commit**

```bash
git add lib/game/turn.js lib/game/rules.js test/game/turn.test.js
git commit -m "feat: throws leave at the snap of the turn; an uncaught forward pass is incomplete"
```

---

### Task 4: Calling the penalty after the down

**Files:**
- Modify: `lib/game/rules.js:136-160` (`nextDown`)
- Test: `test/game/rules.test.js` (append)

**Interfaces:**
- Consumes: `state.penalty` (Task 1, written by Task 2), `state.deadReason === 'incomplete'` (Task 3), `PENALTY_YARDS` from `constants.js`.
- Produces: `nextDown(state)` enforces or declines the flag and resets `plannedPass`, `forwardPasses` and `penalty` for the new down.

- [ ] **Step 1: Write the failing tests**

Extend `test/game/rules.test.js`'s existing import from `../../lib/game/constants.js` to:

```js
import { NEARBY_RADIUS, PENALTY_YARDS } from '../../lib/game/constants.js';
```

Then append:

```js
test('an enforced flag wipes the play and spots the ball back from the previous line', () => {
  const s = createGame({ seed: 1 });
  s.losYard = 4;
  s.penalty = { foul: 'illegal-forward-pass', spot: 4 };
  s.deadReason = 'touchdown';      // he scored on the illegal throw
  s.forwardPasses = 1;
  nextDown(s);
  assert.equal(s.phase, 'planning', 'the touchdown does not stand');
  assert.equal(s.result, null);
  assert.equal(s.down, 2, 'the down still counts');
  assert.equal(s.losYard, 4 - PENALTY_YARDS);
  assert.equal(s.penalty, null, 'the flag is spent');
  assert.equal(s.forwardPasses, 0, 'a new down gets a new forward pass');
  assert.equal(s.plannedPass, null);
});

test('the defense declines the flag when it has just taken the ball', () => {
  const s = createGame({ seed: 1 });
  s.penalty = { foul: 'second-forward-pass', spot: 0 };
  s.deadReason = 'recovered';      // intercepted
  nextDown(s);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result, 'turnover-fumble', 'the defense keeps the football');
});

test('an incomplete pass is spotted at the previous line, and costs the down', () => {
  const s = createGame({ seed: 1 });
  s.losYard = 3;
  s.deadReason = 'incomplete';
  s.ball = { carrierId: null, pos: fieldPos(0, 9), vel: { x: 0, y: 0 } }; // it landed 6 on
  nextDown(s);
  assert.equal(s.down, 2);
  assert.equal(s.losYard, 3, 'an incomplete pass gains nothing');
});

test('a flag on 4th down is a turnover on downs', () => {
  const s = createGame({ seed: 1 });
  s.down = 4;
  s.penalty = { foul: 'second-forward-pass', spot: 0 };
  s.deadReason = 'tackled';
  nextDown(s);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result, 'turnover-on-downs');
});

test('with no flag, an ordinary down is spotted exactly as it always was', () => {
  const s = createGame({ seed: 1 });
  s.losYard = 0;
  s.deadReason = 'tackled';
  getPlayer(s, 'o-qb').pos = fieldPos(0, 6);
  nextDown(s);
  assert.equal(s.down, 2);
  assert.ok(Math.abs(s.losYard - 6) < 1e-9, 'spotted where the play died');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the first test reports `phase` as `'gameOver'` and `result` as `'touchdown'` (the flag is ignored), and the incomplete test spots the ball at 9 instead of 3.

- [ ] **Step 3: Write the implementation**

In `lib/game/rules.js`, add `PENALTY_YARDS` to the existing import from `./constants.js`, then replace `nextDown` entirely:

```js
/**
 * The between-downs bookkeeping, including any flag the down earned.
 *
 * A flag is enforced unless the defense would rather have the football: when
 * the play ended in a defensive recovery — an interception, or a fumble they
 * fell on — they decline it and keep the ball. That is the whole decline rule
 * here, the one case where declining is obviously right. No menu, no prompt.
 *
 * Enforcement wipes whatever the illegal play produced, a touchdown included,
 * and spots the ball PENALTY_YARDS behind the previous line of scrimmage. The
 * down still counts — real football's "loss of down", which in a game with no
 * first downs is simply the ordinary increment.
 *
 * Spot = the ball's yard when the play died, clamped so a deep sack can't push
 * the formation out of frame. Two cases ignore where the ball stopped: an
 * enforced flag comes back from the previous line, and so does an incomplete
 * pass, which by rule gains nothing.
 */
export function nextDown(state) {
  const enforcing = state.penalty !== null && state.deadReason !== 'recovered';
  if (!enforcing) {
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
  }
  if (state.down >= 4) {
    state.phase = 'gameOver';
    state.result = 'turnover-on-downs';
    return;
  }
  const raw =
    enforcing ? state.losYard - PENALTY_YARDS
    : state.deadReason === 'incomplete' ? state.losYard
    : yardsOfY(ballPos(state).y);
  const spot = Math.max(TOP_YARD + 8, Math.min(GOAL_YARD - 0.5, raw));
  state.down += 1;
  state.losYard = spot;
  state.phase = 'planning';
  state.turnIndex = 0;
  state.players = formationPlayers(spot);
  state.ball = { carrierId: 'o-qb', pos: null, vel: null };
  state.deadReason = null;
  state.plannedPass = null;
  state.forwardPasses = 0;
  state.penalty = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the five new tests and everything before them, including the pre-existing `nextDown` tests in `rules.test.js`, which set no `penalty` and so take the unchanged path.

- [ ] **Step 5: Commit**

```bash
git add lib/game/rules.js test/game/rules.test.js
git commit -m "feat: enforce the illegal-pass flag after the whistle"
```

---

### Task 5: Double-tap, then drag

**Files:**
- Modify: `lib/game/gesture.js`
- Test: `test/game/gesture.test.js` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DOUBLE_TAP_MS` (exported from `gesture.js`); `classifyGesture(log, prevClickAt = null)` returning `{ kind: 'passdrag', dir, throttle }` when armed, and the existing `'drag' | 'click' | 'longpress'` shapes otherwise. The added parameter is optional and defaults to `null`, so every existing caller keeps its exact behaviour.

- [ ] **Step 1: Write the failing tests**

Extend `test/game/gesture.test.js`'s import from `../../lib/game/gesture.js` to:

```js
import { classifyGesture, DRAG_MIN_UNITS, LONGPRESS_MS, DOUBLE_TAP_MS } from '../../lib/game/gesture.js';
```

Then append:

```js
test('a drag soon after a tap on the same player is a throw, not a run', () => {
  const log = [{ t: 1100, x: 0, y: 0 }, { t: 1200, x: 0, y: 20 }];
  assert.equal(classifyGesture(log, 1000).kind, 'passdrag', 'tapped 100ms before the drag');
  assert.equal(classifyGesture(log).kind, 'drag', 'no tap at all: an ordinary run arrow');
  assert.equal(classifyGesture(log, null).kind, 'drag');
  assert.equal(
    classifyGesture(log, 1100 - DOUBLE_TAP_MS - 1).kind, 'drag',
    'a stale tap does not arm a throw',
  );
});

test('a throw drag carries the same direction and throttle as a run drag', () => {
  const log = [{ t: 1100, x: 0, y: 0 }, { t: 1200, x: 0, y: MAX_ARROW_UNITS }];
  const g = classifyGesture(log, 1000);
  assert.equal(g.kind, 'passdrag');
  assert.deepEqual(g.dir, { x: 0, y: 1 });
  assert.equal(g.throttle, 1);
});

test('arming changes nothing about a tap or a long press', () => {
  const tap = [{ t: 1100, x: 0, y: 0 }, { t: 1150, x: 0, y: 1 }];
  assert.equal(classifyGesture(tap, 1000).kind, 'click');
  const hold = [{ t: 1100, x: 0, y: 0 }, { t: 1100 + LONGPRESS_MS, x: 0, y: 1 }];
  assert.equal(classifyGesture(hold, 1000).kind, 'longpress');
});

test('movement still beats duration, armed or not', () => {
  const slow = [{ t: 0, x: 0, y: 0 }, { t: LONGPRESS_MS + 200, x: 0, y: DRAG_MIN_UNITS + 1 }];
  assert.equal(classifyGesture(slow).kind, 'drag');
  assert.equal(classifyGesture(slow, -100).kind, 'drag', 'stale tap: still a run');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `DOUBLE_TAP_MS` is undefined, and `classifyGesture` returns `kind: 'drag'` where `'passdrag'` is expected.

- [ ] **Step 3: Write the implementation**

Replace the body of `lib/game/gesture.js` below its imports, keeping the imports as they are:

```js
export const DRAG_MIN_UNITS = 4;
export const LONGPRESS_MS = 500;
export const DOUBLE_TAP_MS = 400;

/**
 * `prevClickAt` is when THIS SAME player was last tapped, or null if he wasn't
 * (app/input.js keeps that book, because it is pointer state). A drag that
 * begins within DOUBLE_TAP_MS of that tap is the spec's double-tap-then-drag:
 * a throw rather than a run. It carries the same direction and throttle as a
 * run drag — only the verb changes — so the caller reads one field to tell
 * them apart.
 */
export function classifyGesture(log, prevClickAt = null) {
  const down = log[0];
  const up = log[log.length - 1];
  const travel = sub(up, down);
  if (len(travel) >= DRAG_MIN_UNITS) {
    const armed = prevClickAt !== null && down.t - prevClickAt <= DOUBLE_TAP_MS;
    return {
      kind: armed ? 'passdrag' : 'drag',
      dir: norm(travel),
      throttle: Math.min(1, len(travel) / MAX_ARROW_UNITS),
    };
  }
  if (up.t - down.t >= LONGPRESS_MS) return { kind: 'longpress' };
  return { kind: 'click' };
}
```

Also update the file's doc comment at the top to name the fourth verb:

```js
/**
 * Pointer-log → intent. The spec's verbs on a player are a click (reposition,
 * pre-snap only), a hold-and-drag (set direction and force), a long press
 * (toggle a stance mode), and a tap-then-drag (throw the ball). Movement beats
 * duration: a slow deliberate drag must never register as a long press.
 */
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the four new tests plus every pre-existing `gesture.test.js` test, which call `classifyGesture(log)` with one argument and so get `prevClickAt = null`.

- [ ] **Step 5: Commit**

```bash
git add lib/game/gesture.js test/game/gesture.test.js
git commit -m "feat: tap-then-drag is a throw, not a run"
```

---

### Task 6: Drawing the planned throw

**Files:**
- Modify: `lib/game/render.js` — `STYLE_GAME`, imports, and a new export
- Test: `test/game/render.test.js` (append)

**Interfaces:**
- Consumes: `state.plannedPass` (Task 1); `MAX_PASS_ARROW_UNITS` (Task 2); `getPlayer` from `state.js`.
- Produces: `renderPassArrow(state) -> string` — markup for the planned throw, or `''`. Its group carries `data-pass="<passer id>"` and its path `class="pass"`, so `app/main.js` and the tests can tell it from a run arrow's `data-for` / `class="mv"`.

- [ ] **Step 1: Write the failing tests**

Extend `test/game/render.test.js`'s two imports to:

```js
import {
  renderBoardShell, renderPlayers, renderArrows, renderLooseBall, renderPassArrow,
  facingAngle, STYLE_GAME,
} from '../../lib/game/render.js';
import { createGame, setPlan, setMode, getPlayer, setPass } from '../../lib/game/state.js';
import { TEAM_SIZE, MAX_ARROW_UNITS, MAX_PASS_ARROW_UNITS } from '../../lib/game/constants.js';
```

Then append:

```js
test('the planned throw draws its own arrow, distinct from a run arrow', () => {
  const s = createGame({ seed: 1 });
  assert.equal(renderPassArrow(s), '', 'nothing planned, nothing drawn');
  setPass(s, { x: 0, y: 1 }, 1);
  const svg = renderPassArrow(s);
  assert.ok(svg.includes('data-pass="o-qb"'));
  assert.ok(svg.includes('class="pass"'), 'its own class, not the run arrow\'s');
  assert.ok(!svg.includes('class="mv"'));
  assert.ok(svg.includes('marker-end="url(#ar)"'));
  const qb = getPlayer(s, 'o-qb');
  assert.ok(svg.includes(`${qb.pos.y + MAX_PASS_ARROW_UNITS}`), 'full power = full length');
});

test('a throw arrow is longer than a run arrow at the same throttle', () => {
  assert.ok(MAX_PASS_ARROW_UNITS > MAX_ARROW_UNITS);
});

test('no throw arrow once the man who planned it no longer has the ball', () => {
  const s = createGame({ seed: 1 });
  setPass(s, { x: 0, y: 1 }, 1);
  s.ball = { carrierId: 'o-rb', pos: null, vel: null };
  assert.equal(renderPassArrow(s), '');
});

test('the throw arc style is registered in the game stylesheet', () => {
  const { markup } = renderBoardShell(0);
  assert.ok(markup.includes('.pass{'), 'the pass arrow has a style rule');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `renderPassArrow is not a function` (or a SyntaxError about the missing export).

- [ ] **Step 3: Write the implementation**

In `lib/game/render.js`, extend the imports:

```js
import { gameView } from './view.js';
import { reach } from './modes.js';
import { getPlayer } from './state.js';
import { MAX_ARROW_UNITS, MAX_PASS_ARROW_UNITS } from './constants.js';
```

Add one rule to `STYLE_GAME`, immediately after the `.plan-arrow` line:

```js
  '.plan-arrow{opacity:.85}',
  '.pass{fill:none;stroke:#b3261e;stroke-width:1.2;stroke-dasharray:3 2}',
```

And append this export at the end of the file:

```js
/**
 * The planned throw: a dashed red arrow from whoever is holding the ball. It
 * is deliberately unlike a run arrow — a throw is a different verb, and the
 * player has to be able to tell at a glance which one he drew. Nothing is
 * drawn once the planner no longer has the ball; the throw will not happen
 * either (releasePass cancels it), so drawing it would be a lie.
 */
export function renderPassArrow(state) {
  const planned = state.plannedPass;
  if (!planned || state.ball.carrierId !== planned.from) return '';
  const from = getPlayer(state, planned.from);
  const tip = {
    x: from.pos.x + planned.dir.x * planned.power * MAX_PASS_ARROW_UNITS,
    y: from.pos.y + planned.dir.y * planned.power * MAX_PASS_ARROW_UNITS,
  };
  return (
    `<g class="plan-arrow" data-pass="${planned.from}">` +
    `<path d="M ${num(from.pos.x)} ${num(from.pos.y)} L ${num(tip.x)} ${num(tip.y)}" class="pass" marker-end="url(#ar)"/>` +
    `</g>`
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the four new tests and the whole pre-existing suite.

- [ ] **Step 5: Commit**

```bash
git add lib/game/render.js test/game/render.test.js
git commit -m "feat: draw the planned throw as its own arrow"
```

---

### Task 7: Wire throwing into the page

**Files:**
- Modify: `app/input.js` — per-player last-tap bookkeeping
- Modify: `app/main.js` — imports, `onGesture`, `onDragPreview`, `paint`, the post-whistle flag message
- Modify: `README.md` — "How to play"

**Interfaces:**
- Consumes: `setPass` / `clearPass` (Task 1), `renderPassArrow` (Task 6), `classifyGesture(log, prevClickAt)` and `DOUBLE_TAP_MS` (Task 5), `state.penalty` (Tasks 1-4).
- Produces: no new module exports — this is the DOM layer.

- [ ] **Step 1: Track the previous tap, per player**

Replace `app/input.js`'s body below its doc comment and import with:

```js
export function attachInput(board, { hitTest, onGesture, onDragPreview }) {
  let log = null;
  let playerId = null;
  // When each player was last tapped. A tap arms the NEXT drag on that same
  // player as a throw (the spec's double-tap-then-drag); anything else disarms
  // him, so a tap from ten seconds ago can never turn a run into a throw.
  // classifyGesture owns the timing rule; this map only remembers the tap.
  const lastTapAt = new Map();

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
    onDragPreview(playerId, log, lastTapAt.get(playerId) ?? null);
  });

  board.on('pointerup', (e) => {
    if (!log) return;
    const p = board.point(e.clientX, e.clientY);
    log.push({ t: e.timeStamp, ...p });
    const gesture = classifyGesture(log, lastTapAt.get(playerId) ?? null);
    if (gesture.kind === 'click') lastTapAt.set(playerId, log[log.length - 1].t);
    else lastTapAt.delete(playerId);
    onGesture(playerId, gesture, p);
    log = null;
    playerId = null;
  });

  board.on('pointercancel', () => {
    log = null;
    playerId = null;
    onDragPreview(null, null, null);
  });
}
```

- [ ] **Step 2: Make a tap-then-drag throw the ball**

In `app/main.js`, extend the two imports:

```js
import {
  createGame, setPlan, setMode, getPlayer, clearAllPlans, isControllable, setPass,
} from '../lib/game/state.js';
import {
  renderBoardShell, renderPlayers, renderArrows, renderPassArrow, renderLooseBall, looseBallMark,
} from '../lib/game/render.js';
```

In `onGesture`, add a `passdrag` branch above the existing `drag` branch, and leave every other branch as it is:

```js
  if (gesture.kind === 'passdrag') {
    // Tap-then-drag on the man with the ball is a throw. Anyone else tapped
    // and dragged is just running — there is nothing in his hands to throw.
    if (!setPass(state, gesture.dir, gesture.throttle)) {
      say(`${p.role} doesn't have the ball.`);
    } else {
      say(`${p.role} will throw.`);
    }
  } else if (gesture.kind === 'drag') {
```

In `onDragPreview`, take the new third argument and draw the throw preview in the pass style:

```js
function onDragPreview(playerId, log, prevTapAt) {
  if (animating) return; // the overlay belongs to the loose ball right now
  if (!playerId || !log || state.phase !== 'planning') {
    layer('game-overlay').clear();
    return;
  }
  const g = classifyGesture(log, prevTapAt);
  if (g.kind !== 'drag' && g.kind !== 'passdrag') return;
  const p = getPlayer(state, playerId);
  const throwing = g.kind === 'passdrag' && state.ball.carrierId === playerId;
  // Not named `reach` — that word already means a player's tackling reach in
  // lib/game/modes.js, and this is an arrow length.
  const arrowUnits = throwing ? MAX_PASS_ARROW_UNITS : MAX_ARROW_UNITS;
  const tipX = p.pos.x + g.dir.x * g.throttle * arrowUnits;
  const tipY = p.pos.y + g.dir.y * g.throttle * arrowUnits;
  layer('game-overlay').clear().svg(
    `<path d="M ${p.pos.x} ${p.pos.y} L ${tipX} ${tipY}" class="${throwing ? 'pass' : 'mv'}" marker-end="url(#ar)"/>`,
  );
}
```

That needs `MAX_PASS_ARROW_UNITS` on the existing constants import:

```js
import { TURN_SECONDS, MAX_ARROW_UNITS, MAX_PASS_ARROW_UNITS } from '../lib/game/constants.js';
```

- [ ] **Step 3: Draw the throw arrow, and call the flag after the whistle**

In `paint()`, add the pass arrow to the arrows layer:

```js
  layer('game-arrows').clear().svg(
    state.phase === 'planning' ? renderArrows(state) + renderPassArrow(state) : '',
  );
```

In the Run Turn handler's `finish()`, add the throw events to the existing message loop and report the flag last, so the flag is what the player is left reading:

```js
  const finish = () => {
    animating = false;
    paint();
    for (const e of events) {
      if (e.type === 'tackled') say('Tackled!');
      if (e.type === 'fumble') say('FUMBLE! The ball is loose!');
      if (e.type === 'touchdown') say('TOUCHDOWN!');
      if (e.type === 'out-of-bounds') say('Out of bounds.');
      if (e.type === 'pickup') say(`Recovered by ${e.team}.`);
      if (e.type === 'incomplete') say('Incomplete.');
    }
    // The flag is called after the down, not when it was thrown — the spec is
    // explicit that an illegal throw is allowed to play out first.
    if (state.phase === 'playOver' && state.penalty) {
      say(state.penalty.foul === 'second-forward-pass'
        ? `FLAG: two forward passes. ${PENALTY_YARDS} yards from the previous spot, loss of down.`
        : `FLAG: forward pass from beyond the line. ${PENALTY_YARDS} yards from the previous spot, loss of down.`);
    }
  };
```

That needs `PENALTY_YARDS` on the constants import too, so the line becomes:

```js
import {
  TURN_SECONDS, MAX_ARROW_UNITS, MAX_PASS_ARROW_UNITS, PENALTY_YARDS,
} from '../lib/game/constants.js';
```

- [ ] **Step 4: Verify — automated, then in the browser**

Run: `npm test`
Expected: PASS, the whole suite. (`app/` has no automated coverage; the checks below are this task's verification.)

Chromium is pre-installed and Playwright is configured to find it (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Do NOT run `playwright install`, and do NOT add a dependency to `package.json` — install Playwright outside the repo if you need it, and confirm with `git status` that `package.json` and `package-lock.json` are untouched. Serve with `npm run serve` and drive the page, confirming each of these:

1. Drag the QB normally: an ordinary solid run arrow appears, and no throw arrow.
2. Tap the QB, then drag him within 400 ms: a dashed red arrow appears instead, the message reads "QB will throw.", and `#game-arrows [data-pass="o-qb"]` is present while `#game-arrows [data-for="o-qb"]` is not (planning a throw does not plan a run).
3. Tap the QB, wait a second, then drag: an ordinary run arrow — the stale tap does not arm a throw.
4. Tap a player who does NOT have the ball and drag: the message says he doesn't have the ball, and no `[data-pass]` element exists.
5. Throw forward to a receiver and press Run Turn: the ball leaves the QB and travels as its own node during the animation. If a teammate reaches it, the HUD reports the recovery and the down continues.
6. Throw forward, let it fall incomplete, and run turns until the play ends: the message reads "Incomplete."; press Next Down and the new line of scrimmage equals the old one.
7. Throw one legal forward pass, catch it, then throw a second forward pass and finish the down: after the whistle the message reads `FLAG: two forward passes. 5 yards from the previous spot, loss of down.` Press Next Down and confirm the new line of scrimmage is 5 yards behind the previous one.
8. Throw backwards several times in one down: no flag is ever called.

Save a screenshot of the board with a throw arrow drawn to `/tmp/claude-0/-home-user-football-by-turn/b59a4267-d8f9-5d26-a8e2-1a87082816af/scratchpad/pass-arrow.png` and **look at it**: confirm all 14 players are on the field and the dashed throw arrow runs from the QB. Report anything in that image that does not match what you expect, even if every scripted check passed.

- [ ] **Step 5: Document it**

In `README.md`, insert this immediately after the existing **Long-press a player** bullet and its sub-list, as a new bullet in the same list:

```markdown
- **Tap the ball carrier, then drag** to throw. The dashed red arrow shows where
  the ball is going and how hard — a short backward drag is a handoff to the man
  beside you, a long forward one is a bomb. Anyone can catch a throw, including
  the defense, so a forward pass into traffic is an interception waiting to
  happen. You get **one forward pass per down, and only from behind the line of
  scrimmage**; backward throws and handoffs are unlimited. Throw illegally and
  the game lets you — then calls the flag once the down is over: 5 yards back
  from the previous spot and the down still counts, unless the defense came away
  with the ball, in which case they keep it. A forward pass nobody catches is
  incomplete: dead ball, no gain. A backward throw nobody catches is a live ball,
  same as a fumble.
```

- [ ] **Step 6: Commit**

```bash
git add app/input.js app/main.js README.md
git commit -m "feat: throw the ball by tapping the carrier and dragging"
```

---

## Final verification

- [ ] `npm test` — the entire suite green, with no pre-existing test edited. `git diff origin/main --stat -- test/` should show one new file (`test/game/pass.test.js`) and additions plus at most one import line changed in each of `state.test.js`, `turn.test.js`, `rules.test.js`, `gesture.test.js`, `render.test.js`.
- [ ] `git grep -n "plannedPass"` — every read goes through `state.plannedPass`; there is no second field holding a throw.
- [ ] Browser checks 7 and 8 above are the spec's acceptance tests: an illegal throw is allowed and flagged afterwards, and backward throws never draw one.
- [ ] The computer opponent still works: play a full down against it with a forward pass in it, and confirm no defensive arrow is ever drawn.
