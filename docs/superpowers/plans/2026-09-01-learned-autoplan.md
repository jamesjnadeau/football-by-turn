# Learned Autoplan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 🎁 button prefills the human's board with what the **learned**
brain would play on the side he is coaching — the learned offense
(`coachLearnedOffense`) when he coaches the offense, and the learned defense
(`learnedOrders`) when he has elected to coach the defense — instead of the
scripted QB-option autoplan it draws today.

**Architecture:** The two learned brains already exist and are already the
only thing `ai.js` dispatches at `aiLevel: 'learned'`; the button has simply
never been pointed at them. A new module `lib/game/autoplan.js` becomes the
button's single entry point: it decides which side the coach is on
(`hud.js`'s `humanSide`, hot-seat reading as the offense — the same call
`playbook.js` makes), wipes that side's stale orders, and then runs the very
same brain call `ai.js`/`train/harness.js` make for the computer —
`coachLearnedOffense(state, activeGenome(state, 'offense'))` for the offense,
`applyAiModes(state, 'defense')` + `applyOrders(state, learnedOrders(state,
'defense', activeGenome(state, 'defense'), null))` for the defense — and
turns the result into a sentence for `say()`. Nothing about either brain
changes, and `offense.js`'s scripted `autoplanOffense` stays exactly where it
is because `train/harness.js`'s `scriptedOffenseCoach` is built on it.

**Tech Stack:** Plain ES modules, `node --test` (`npm test`). No new
dependencies, no build step, no new constants.

**Spec:** The user's own request, quoted in full because there is no separate
spec document for this feature:

> the 🎁 icon currently prefills the next moves for offense, can you make this
> prefilled off of the currently set learned AI instead of the simpler one
> it's using now. Also, if I've elected to control the defense, please have it
> fill it the defensive moves in the same way as I just descbired for the
> offense.

## Global Constraints

- No npm dependencies, no build step, no DOM or `node:` imports inside
  `lib/game/` (existing project-wide rule).
- `npm test` (`node --test`) must pass after every task. The baseline before
  this plan is **720 passing**.
- Comment style: prose explaining **why**, matching the density and voice of
  the surrounding file. Never write a comment that only restates the code.
- No new constants, and no change to any genome, spec or generated
  `*-genome.js` file.
- `lib/game/offense.js`'s `autoplanOffense` and every one of its tests stay
  as they are: `lib/game/train/harness.js:213` (`scriptedOffenseCoach`) is
  the scripted offense the defense genome was trained against.
- `PLAN.md` at the repository root is the historical record of the original
  v1 build and is **not** updated by this plan. `README.md` is user-facing
  and **is**.

## Design decisions (resolving spec ambiguities — read before implementing)

1. **"The currently set learned AI" means `activeGenome(state, side)`.**
   That is the one function in the codebase that answers "which genome is
   actually playing this game": the coach's own browser-trained bundle
   (`state.genomeOverrides`, written by `app/main.js`'s
   `applyGenomeOverrides`) when he has one, the shipped champion otherwise.
   Pressing 🎁 after training a genome in the Coaches Menu therefore draws up
   *that* genome's play.

2. **The button ignores `state.aiLevel`.** `aiLevel` names the brain the
   *computer* is running on the *other* side of the ball; when the human
   coaches the offense it says nothing about the offense. The 🎁 is now
   defined as "show me what the learned brain would do here", so it always
   runs the learned brain, at every level and in hot-seat.

3. **Which side the button plans for: the side the coach is on.**
   `humanSide(state) ?? 'offense'` — the computer's team is never the
   button's to draw for, and hot-seat (where both teams are the human's)
   keeps today's behaviour and plans the offense. This is exactly the call
   `playbook.js`'s `playbookSide` already makes for the same reason, so
   Task 1 lifts it into `hud.js` as `coachedSide` and both callers use it.

4. **Parity with the computer, verbatim.** The offense branch is
   `coachLearnedOffense` and the defense branch is the two lines
   `train/harness.js:202-203` already runs. No re-implementation, no
   "human-friendly" variant: what the button draws is byte-for-byte what the
   computer would have played from that board, and the tests assert exactly
   that.

5. **Turn 0 remembers its call in `state.aiPlay`, for the human too.**
   `coachLearnedOffense` writes the play call there on turn 0 and reads it
   back on later turns (that is how a pass call keeps releasing its
   receivers). `rules.js`'s `nextDown` already resets it every down and
   nothing else writes it while the human coaches the offense, so letting the
   button use it is free. Consequence, and it is the right one: press 🎁 on
   turn 0 and again on turn 2 and the second press continues the *same*
   called play; hand-draw turn 0 and press 🎁 on turn 2 and there is no
   remembered call, so the brain falls through to its runner branch (find
   daylight, everybody blocks). That is a sane answer, not a bug.

6. **The defense prefill reads no tendencies.** `coachLearnedDefense` shades
   the learned defense with `tendenciesForState(state)` — but those counts
   are recorded *only when the human is the offense*
   (`app/main.js`'s `recordPlanning`), so they describe **the coach's own
   offense**. The offense across the table from a human defensive coach is
   the computer's, which nothing counts. Feeding the coach his own habits
   would aim his defense at a receiver *he* likes throwing to, which is
   worse than no reading at all, so the defense branch passes `null` — which
   `defense-policy.js` documents as identical to "no history". Counting the
   computer's own calls is a possible future feature and is out of scope
   here.

7. **The defense branch does not reset modes; `applyAiModes` owns them.**
   `applyAiModes` is a complete mode policy for a defense (`prepared` inside
   `AI_BREAKDOWN_UNITS` of an opposing carrier, `normal` otherwise) and it
   deliberately calls `setMode` only on an actual change, because every
   `setMode` re-arms the next-turn `charge` burst. Wiping every defender to
   `normal` first and letting `applyAiModes` put the stance back would hand
   out a fresh `charge` on every press. So the defense wipe clears plans and
   cover orders only. (The offense branch does reset modes to `normal`, as
   today's `autoplanOffense` does: a stale `holding`/`cutBlock` stance has no
   equivalent policy to overwrite it, and the learned run sets its own.)

8. **The prefill can put a defender in the tackling stance, and that is
   fine.** `applyAiModes` breaks a man down only once he is inside
   `AI_BREAKDOWN_UNITS` of an opposing carrier, which at the snap nobody is
   (measured on the seed game: the nearest defender is 16.9 units off the
   centre, against a threshold of 11), so a fresh down comes back all
   `normal`. Later in a down it will set stances — the computer's own
   behaviour, now visible as a wedge on the coach's own player instead of
   hidden. It stays; a double tap takes it off.

9. **The wipe clears cover orders too.** Today's `autoplanOffense` clears
   plans and modes but not `player.cover`, so a man given a cover order and
   then left without an arrow by the new plan would keep chasing his old
   assignment. `setPlan` clears `cover` for everyone who *does* get an
   arrow, which is why this has never bitten, but the new module clears it
   explicitly on both sides rather than relying on that.

10. **The button plans orders, never positions.** The learned genomes also
    carry a *formation* (`learned/formation.js`), and
    `maybeApplyLearnedFormations` stands it up only for the computer's side.
    Where the human's men line up stays his own call (Reposition), and the
    prefill plans from wherever they actually are. Out of scope: an
    "align me the learned way" button.

11. **The board button stops hiding.** `renderFieldButtons` currently omits
    the 🎁 plate entirely when `state.aiTeam === 'offense'` — precisely the
    case this plan gives it a job in. It is now always drawn, in the same
    slot, with the side named in its `aria-label` ("Autoplan defense"), and
    the menu twin's label follows on every paint.

12. **After a turnover the defense brain says "everybody get the ball".**
    `learnedOrders`' first branch aims the whole team at the ball when the
    coached team is the one holding it. That is what the computer plays, and
    a defensive turnover ends the game (`rules.js`'s `nextDown` →
    `turnover-fumble`), so this branch is nearly unreachable from a planning
    phase. Parity wins; there is no return game to draw up here.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/game/hud.js` *(modify)* | Gains `coachedSide(state)` — the side the coach's own controls act on. `humanSide` unchanged. |
| `lib/game/playbook.js` *(modify)* | `playbookSide` delegates to `coachedSide` instead of repeating `humanSide(state) ?? 'offense'`. |
| `lib/game/autoplan.js` *(create)* | The 🎁's whole brain: which side, wipe, run the learned brain, describe what it drew. Mutating, like `offense.js` and `play.js`; the only new module. |
| `lib/game/render.js` *(modify)* | Draws the 🎁 plate unconditionally and labels it with the coached side. |
| `app/main.js` *(modify)* | Presses `autoplanLearned` instead of `autoplanOffense`; the menu button's label and disabled rule follow the coached side. |
| `index.html` *(modify)* | The menu button's initial text loses the hard-coded "offense". |
| `test/game/autoplan.test.js` *(create)* | Everything the new module does, on both sides of the ball. |
| `test/game/hud.test.js`, `test/game/render.test.js` *(modify)* | `coachedSide`, and the plate's new visibility and labels. |
| `README.md` *(modify)* | The 🎁 documented for the first time; the field-button list corrected from three to four. |

`lib/game/offense.js` is deliberately absent from that list: the scripted
autoplan it holds is the training harness's opponent and does not change.

---

### Task 1: `coachedSide` — one answer to "whose side am I on"

**Files:**
- Modify: `lib/game/hud.js` (append after `humanSide`, around line 31)
- Modify: `lib/game/playbook.js:87-89`
- Test: `test/game/hud.test.js`

**Interfaces:**
- Produces: `coachedSide(state) -> 'offense' | 'defense'` (exported from
  `lib/game/hud.js`). Tasks 2 and 4 both consume it.

- [ ] **Step 1: Write the failing test**

Append to `test/game/hud.test.js`:

```js
test('coachedSide is the side the coach controls, and hot-seat is the offense', () => {
  assert.equal(coachedSide(createGame({ seed: 1, ai: 'defense' })), 'offense');
  assert.equal(coachedSide(createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' })), 'defense');
  assert.equal(coachedSide(createGame({ seed: 1 })), 'offense'); // hot-seat
});
```

and add `coachedSide` to that file's existing `hud.js` import:

```js
import {
  spotText, downDistanceText, humanSide, coachedSide, gameOverMessage, kickoffMessage,
} from '../../lib/game/hud.js';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/hud.test.js`
Expected: FAIL — `coachedSide is not a function` (it is not exported yet).

- [ ] **Step 3: Write the implementation**

In `lib/game/hud.js`, directly below `humanSide`:

```js
/**
 * The side a coach's own controls act on. His own team when the computer has
 * the other one; in hot-seat, where both teams are his, the offense — the
 * drive is still the thing being scripted. playbook.js's playbookSide and
 * autoplan.js's 🎁 both need exactly this answer, and a button that disagreed
 * with the book beside it would be a bug nobody could see.
 */
export function coachedSide(state) {
  return humanSide(state) ?? 'offense';
}
```

In `lib/game/playbook.js`, change the import on line 20 and the body of
`playbookSide` (lines 87-89), keeping its existing doc comment:

```js
import { coachedSide } from './hud.js';
```

```js
export function playbookSide(state) {
  return coachedSide(state);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the 720-test baseline plus this one, including every
existing `playbookSide` test.

- [ ] **Step 5: Commit**

```bash
git add lib/game/hud.js lib/game/playbook.js test/game/hud.test.js
git commit -m "refactor: one answer to which side the coach is on"
```

---

### Task 2: `autoplan.js` — the learned offense behind the 🎁

**Files:**
- Create: `lib/game/autoplan.js`
- Test: `test/game/autoplan.test.js` (create)

**Interfaces:**
- Consumes: `coachedSide` (Task 1); `coachLearnedOffense(state, genome)` from
  `lib/game/learned/offense-policy.js`; `activeGenome(state, side)` from
  `lib/game/learned/active.js`; `setMode`, `clearPlan`, `clearPass`,
  `aimSnap`, `getPlayer`, `carrier` from `lib/game/state.js`; `clearCover`
  from `lib/game/cover.js`.
- Produces:
  - `autoplanLearned(state) -> string | null` — the button's entry point.
    A short sentence for `say()`, or `null` when it declined (not in the
    planning phase). Task 4 consumes it.
  - `autoplanLearnedOffense(state) -> string` — the offense half, exported
    for tests.
  - `clearTeamOrders(state, team, { modes })` — the wipe, exported for tests
    and reused by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `test/game/autoplan.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoplanLearned, autoplanLearnedOffense, clearTeamOrders } from '../../lib/game/autoplan.js';
import { createGame, getPlayer, setPlan, setMode, aimSnap } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';
import { setCover } from '../../lib/game/cover.js';
import { coachLearnedOffense } from '../../lib/game/learned/offense-policy.js';
import { activeGenome } from '../../lib/game/learned/active.js';
import { makeGenome } from '../../lib/game/learned/genome.js';
import { OFFENSE_SPEC } from '../../lib/game/learned/offense-spec.js';

/** What a team's board actually says, for a byte-for-byte comparison. */
const board = (s, team) => s.players
  .filter((p) => p.team === team)
  .map((p) => ({ id: p.id, plan: p.plan, cover: p.cover, mode: p.mode }));

/** A genome that is the seed spec with a few keys pushed. */
const offenseGenome = (over) => ({ ...makeGenome(OFFENSE_SPEC), ...over });

test('the 🎁 draws exactly what the learned offense would have played', () => {
  const pressed = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  const computer = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });

  autoplanLearned(pressed);
  coachLearnedOffense(computer, activeGenome(computer, 'offense'));
  aimSnap(computer);

  assert.deepEqual(board(pressed, 'offense'), board(computer, 'offense'));
  assert.deepEqual(pressed.plannedPass, computer.plannedPass);
  assert.deepEqual(pressed.aiPlay, computer.aiPlay);
});

test('the 🎁 plays the genome the coach has trained, not the shipped one', () => {
  const run = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  run.genomeOverrides = { offense: offenseGenome({ 'call:bias': -4 }), defense: null };
  const runNote = autoplanLearned(run);

  const pass = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  pass.genomeOverrides = { offense: offenseGenome({ 'call:bias': 4 }), defense: null };
  const passNote = autoplanLearned(pass);

  assert.match(runNote, /^Learned call: run/);
  assert.match(passNote, /^Learned call: pass/);
  // The run is the option: the line commits to the cut block. The pass is
  // protection -- the same guard takes a man on instead.
  assert.equal(getPlayer(run, 'o-lg').mode, 'cutBlock');
  assert.equal(getPlayer(pass, 'o-lg').mode, 'holding');
});

test('the press wipes the coach\'s stale orders before it draws', () => {
  // A board the learned offense declines to draw on at all -- the defense has
  // the ball -- so what is left on it afterwards is the wipe and nothing else.
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  s.turnIndex = 2;
  s.ball = { carrierId: 'd-nt', pos: null, vel: null };
  setPlan(s, 'o-wr1', { x: 0, y: 1 }, 1);
  setCover(s, 'o-wr2', 'd-cb1');
  setMode(s, 'o-lg', 'holding');

  autoplanLearnedOffense(s);

  assert.deepEqual(
    board(s, 'offense').filter((p) => p.plan || p.cover || p.mode !== 'normal'),
    [],
    'every arrow, assignment and stance of the last play is gone',
  );
});

test('the automatic snap survives the press, and a give replaces it', () => {
  // The read is the widest lineman on the play side against the edge of the
  // blocked box: the seed front stands the tackle right on the guard's own
  // outside shoulder, which reads as a crash and therefore a keep.
  const keep = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  keep.genomeOverrides = { offense: offenseGenome({ 'call:bias': -4 }), defense: null };
  autoplanLearned(keep);
  assert.equal(keep.plannedPass.auto, true, 'a keep leaves the ordinary snap to the QB');
  assert.equal(keep.plannedPass.target, 'o-qb');

  // Widen that tackle to 10 yards out and he is playing contain: 7.5 yards
  // (28 units, at 3.75 units to the yard) outside the guard, well past the
  // genome's 6-unit read. The alley inside him is the give.
  const give = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  give.genomeOverrides = { offense: offenseGenome({ 'call:bias': -4 }), defense: null };
  getPlayer(give, 'd-dt2').pos = fieldPos(10, give.losYard + 1);
  autoplanLearned(give);
  assert.equal(give.plannedPass.target, 'o-rb', 'a give is a direct snap to the back');
  assert.ok(!give.plannedPass.auto);
});

test('the 🎁 declines outside the planning phase and changes nothing', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  s.phase = 'playOver';
  const before = board(s, 'offense');
  assert.equal(autoplanLearned(s), null);
  assert.deepEqual(board(s, 'offense'), before);
});

test('hot-seat draws up the offense, the same side the playbook opens on', () => {
  const s = createGame({ seed: 1 }); // aiTeam null
  const note = autoplanLearned(s);
  assert.match(note, /^Learned call:/);
  assert.ok(getPlayer(s, 'o-qb').plan, 'the quarterback has an arrow');
  assert.equal(getPlayer(s, 'd-nt').plan, null, 'and the defense has none');
});

test('a broken play reads off the ball, not off the called play', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  s.turnIndex = 2;
  s.ball = { carrierId: 'o-rb', pos: null, vel: null };
  const note = autoplanLearnedOffense(s);
  assert.match(note, /RB/);
  assert.ok(getPlayer(s, 'o-rb').plan, 'the carrier is pointed at daylight');
  assert.ok(getPlayer(s, 'o-lg').plan, 'and everybody else blocks');
});

test('clearTeamOrders wipes one team and leaves the other alone', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  setPlan(s, 'd-nt', { x: 0, y: -1 }, 1);
  clearTeamOrders(s, 'offense', { modes: true });
  assert.equal(getPlayer(s, 'o-qb').plan, null);
  assert.ok(getPlayer(s, 'd-nt').plan, 'the other team is not this button\'s to wipe');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/autoplan.test.js`
Expected: FAIL — `Cannot find module '.../lib/game/autoplan.js'`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/autoplan.js`:

```js
/**
 * The 🎁 button: prefill the coach's own board with what the LEARNED brain
 * would play from here.
 *
 * It plans for whichever side he is coaching — his offense, or his defense
 * when he has taken that side — and it plans it with the genome actually in
 * play this game (learned/active.js: his own trained one when he has trained
 * one, the shipped champion otherwise). There is no second copy of either
 * brain in here: the offense branch calls coachLearnedOffense and the defense
 * branch calls learnedOrders through ai.js's own applyOrders, which is
 * exactly what ai.js does for the computer and what train/harness.js does for
 * a training run. What the button draws IS what the computer would have
 * played, and the tests hold the two together.
 *
 * Mutating, in the mould of offense.js's autoplanOffense and play.js's
 * applyPlay: a one-shot planning-time action a press triggers, not a per-turn
 * brain turn.js calls. offense.js's scripted autoplan stays where it is —
 * train/harness.js's scriptedOffenseCoach is the opponent the shipped defense
 * genome was trained against.
 */
import {
  setMode, clearPlan, clearPass, aimSnap, getPlayer, carrier,
} from './state.js';
import { clearCover } from './cover.js';
import { coachedSide } from './hud.js';
import { activeGenome } from './learned/active.js';
import { coachLearnedOffense } from './learned/offense-policy.js';

/**
 * Wipe one team's current orders, the way applyPlay wipes the human's board
 * before drawing a new play over it. Cover goes with the arrows: a man left
 * without an arrow by the new plan would otherwise keep chasing last play's
 * assignment.
 *
 * `modes` is off for a defense, where applyAiModes is the mode policy and
 * owns the whole question — resetting to `normal` first would re-arm the
 * next-turn `charge` burst on every single press, which is a gift no human
 * gets from a drag.
 *
 * A planned throw is only cleared when it belongs to this team: a hot-seat
 * coach's throw drawn for the OTHER side of the ball is not this button's to
 * take away.
 */
export function clearTeamOrders(state, team, { modes = false } = {}) {
  for (const p of state.players) {
    if (p.team !== team) continue;
    if (modes) setMode(state, p.id, 'normal');
    clearPlan(state, p.id);
    clearCover(state, p.id);
  }
  if (state.plannedPass && getPlayer(state, state.plannedPass.from).team === team) {
    clearPass(state);
  }
}

/**
 * What the learned offense just drew, in a sentence. Turn 0 is read off
 * state.aiPlay, which is where coachLearnedOffense records the call it made
 * (and where it looks the call up again on later turns); everything after is
 * read off the board, because a broken play is whatever the ball is doing.
 */
function offenseNote(state) {
  const car = carrier(state);
  if (!car) return 'Loose ball -- everybody goes and gets it.';
  if (car.team !== 'offense') return 'They have the ball -- there is nothing for the offense to draw up.';

  if (state.turnIndex === 0) {
    const play = state.aiPlay;
    // planLearnedRun/planLearnedPassSnap both hand back null when the
    // formation has no quarterback for them to run, and leave the board bare.
    if (!play) return 'Nothing to draw up -- this formation has no quarterback for the learned offense.';
    if (play.call === 'pass') {
      return 'Learned call: pass. Routes on, the quarterback drops back, the line protects.';
    }
    const way = play.side > 0 ? 'right' : 'left';
    return play.give
      ? `Learned call: run ${way}. Contain outside -- direct snap to the back, the quarterback fakes the boot.`
      : `Learned call: run ${way}. Crash inside -- the quarterback keeps it, the back fakes the dive.`;
  }

  const throwing = state.plannedPass
    && !state.plannedPass.auto
    && getPlayer(state, state.plannedPass.from).team === 'offense';
  if (throwing) {
    const { target } = state.plannedPass;
    return target
      ? `The throw goes to the ${getPlayer(state, target).role}.`
      : 'The throw goes up -- a lob to where he will be.';
  }
  return `${car.role} runs the learned offense -- everybody else blocks.`;
}

/** The offense half: wipe, run the brain, put the snap back. */
export function autoplanLearnedOffense(state) {
  clearTeamOrders(state, 'offense', { modes: true });
  coachLearnedOffense(state, activeGenome(state, 'offense'));
  // Restores the automatic snap-to-QB, but only if nothing above set an
  // override of its own -- a give is a direct snap to the back, and aimSnap
  // leaves a coach's own call alone (see state.js).
  aimSnap(state);
  return offenseNote(state);
}

/**
 * The button. A short sentence for the board to say, or null when it declined
 * — which is only ever the wrong phase, since the side it plans for is by
 * definition the side the computer is not coaching.
 */
export function autoplanLearned(state) {
  if (state.phase !== 'planning') return null;
  return autoplanLearnedOffense(state);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the baseline plus this task's tests. (Task 3 replaces the
one-branch body of
`autoplanLearned`; the defense side is not wired yet, so every test above
runs through the offense branch.)

- [ ] **Step 5: Commit**

```bash
git add lib/game/autoplan.js test/game/autoplan.test.js
git commit -m "feat: the gift button draws up the learned offense"
```

---

### Task 3: the defensive half of the 🎁

**Files:**
- Modify: `lib/game/autoplan.js`
- Test: `test/game/autoplan.test.js`

**Interfaces:**
- Consumes: `clearTeamOrders` (Task 2); `applyAiModes(state, team)` and
  `applyOrders(state, orders)` from `lib/game/ai.js`; `learnedOrders(state,
  team, genome, tendencies)` and `schemeChoice(state, genome, tendencies)`
  from `lib/game/learned/defense-policy.js`; `pastLine(state, team, point)`
  from `lib/game/defense.js`.
- Produces: `autoplanLearnedDefense(state) -> string`, and an
  `autoplanLearned` that now routes on `coachedSide(state)`.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/autoplan.test.js` (and add these imports at the top of
the file):

```js
import { autoplanLearnedDefense } from '../../lib/game/autoplan.js';
import { applyAiModes, applyOrders } from '../../lib/game/ai.js';
import { learnedOrders } from '../../lib/game/learned/defense-policy.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { emptyTendencies } from '../../lib/game/tendencies.js';

const defenseGenome = (over) => ({ ...makeGenome(DEFENSE_SPEC), ...over });
/** A game the human is coaching from the defensive side. */
const coachingDefense = () => createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' });
```

```js
test('coaching the defense, the 🎁 draws exactly what the learned defense would have played', () => {
  const pressed = coachingDefense();
  const computer = coachingDefense();

  autoplanLearned(pressed);
  applyAiModes(computer, 'defense');
  applyOrders(computer, learnedOrders(computer, 'defense', activeGenome(computer, 'defense'), null));

  assert.deepEqual(board(pressed, 'defense'), board(computer, 'defense'));
  assert.ok(board(pressed, 'defense').some((p) => p.plan), 'and it is not an empty board');
});

test('the defensive press leaves the offense, and the snap, alone', () => {
  const s = coachingDefense();
  const offenseBefore = board(s, 'offense');
  const snapBefore = { ...s.plannedPass };

  autoplanLearned(s);

  assert.deepEqual(board(s, 'offense'), offenseBefore);
  assert.deepEqual({ ...s.plannedPass }, snapBefore, 'the snap is the offense\'s order, not his');
});

test('the defensive press plays the genome the coach has trained', () => {
  const man = coachingDefense();
  man.genomeOverrides = { offense: null, defense: defenseGenome({ 'scheme:bias': -4 }) };
  const zone = coachingDefense();
  zone.genomeOverrides = { offense: null, defense: defenseGenome({ 'scheme:bias': 4 }) };

  assert.match(autoplanLearned(man), /^Learned defense: man/);
  assert.match(autoplanLearned(zone), /^Learned defense: zone/);
  // Man is assignments; zone is spots. The corners say which one was played.
  assert.ok(getPlayer(man, 'd-cb1').cover, 'man coverage claims a receiver');
  assert.equal(getPlayer(zone, 'd-cb1').cover, null, 'a zone defender covers grass');
});

test('the defensive press does not read the coach his own offensive habits', () => {
  const shaded = coachingDefense();
  // scheme:bias -0.5 is man on its own; a full pass-tendency shade (±1) would
  // flip it to zone. Those counts are what the COACH's offense does, and the
  // offense he is facing here is the computer's, so they must not be read.
  shaded.genomeOverrides = { offense: null, defense: defenseGenome({ 'scheme:bias': -0.5 }) };
  shaded.tendencyCounts = { ...emptyTendencies(), calls: { '1:long': { run: 0, pass: 100 } } };

  assert.match(autoplanLearned(shaded), /^Learned defense: man/);
});

test('the defensive note follows the ball once the play has broken', () => {
  const past = coachingDefense();
  past.turnIndex = 1;
  past.ball = { carrierId: 'o-rb', pos: null, vel: null };
  getPlayer(past, 'o-rb').pos = fieldPos(0, past.losYard + 6); // through the line
  assert.match(autoplanLearnedDefense(past), /past the line/);
  assert.ok(getPlayer(past, 'd-cb1').plan, 'everybody takes an angle at him');

  const ours = coachingDefense();
  ours.turnIndex = 1;
  ours.ball = { carrierId: 'd-cb1', pos: null, vel: null };
  assert.match(autoplanLearnedDefense(ours), /everybody to the ball/);

  const loose = coachingDefense();
  loose.turnIndex = 1;
  loose.ball = { carrierId: null, pos: fieldPos(0, loose.losYard + 2), vel: { x: 0, y: 0 } };
  assert.match(autoplanLearnedDefense(loose), /^Loose ball/);
});
```

Extend the file's existing `autoplan.js` import rather than adding a second
`import` line for it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/autoplan.test.js`
Expected: FAIL — `autoplanLearnedDefense is not a function`, and the routing
tests fail because `autoplanLearned` still plans the offense.

- [ ] **Step 3: Write the implementation**

In `lib/game/autoplan.js`, add to the imports:

```js
import { applyAiModes, applyOrders } from './ai.js';
import { learnedOrders, schemeChoice } from './learned/defense-policy.js';
import { pastLine } from './defense.js';
```

Add above `autoplanLearned`:

```js
/**
 * What the learned defense just called, in a sentence. learnedOrders' own
 * three branches, re-read here rather than reported back by it, so that
 * function stays the pure orders-only contract defense.js set — the test
 * above holds the words against the orders so the two cannot drift.
 */
function defenseNote(state, genome) {
  const car = carrier(state);
  if (!car) return 'Loose ball -- everybody goes and gets it.';
  // learnedOrders has no return game: when this team is the one holding it,
  // its answer is the whole side converging on the ball. Say so rather than
  // dressing it up as a call.
  if (car.team === 'defense') return 'We have it -- everybody to the ball.';
  if (pastLine(state, 'defense', car.pos)) {
    return 'He is past the line -- everybody takes an angle at him.';
  }
  return schemeChoice(state, genome, null) === 'zone'
    ? 'Learned defense: zone. The front rushes, everybody else drops to his spot.'
    : 'Learned defense: man. The front rushes, the backs take their men, the free man plays over the top.';
}

/**
 * The defense half: wipe the arrows and assignments, then the same two lines
 * ai.js's coachLearnedDefense and train/harness.js's learned coach run.
 *
 * Modes are applyAiModes' business alone (see clearTeamOrders), and the
 * tendency reading is deliberately null: those counts are what THIS coach's
 * offense keeps doing (app/main.js records them only while he has the ball),
 * and the offense across the table from him here is the computer's. A defense
 * shaded toward his own favourite receiver would be reading the wrong team.
 */
export function autoplanLearnedDefense(state) {
  clearTeamOrders(state, 'defense');
  const genome = activeGenome(state, 'defense');
  applyAiModes(state, 'defense');
  applyOrders(state, learnedOrders(state, 'defense', genome, null));
  return defenseNote(state, genome);
}
```

and replace `autoplanLearned`'s body:

```js
export function autoplanLearned(state) {
  if (state.phase !== 'planning') return null;
  return coachedSide(state) === 'defense'
    ? autoplanLearnedDefense(state)
    : autoplanLearnedOffense(state);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the baseline plus this task's tests.

- [ ] **Step 5: Commit**

```bash
git add lib/game/autoplan.js test/game/autoplan.test.js
git commit -m "feat: the gift button draws up the learned defense too"
```

---

### Task 4: wire the button — board plate, menu button, press

**Files:**
- Modify: `lib/game/render.js` (imports, and `renderFieldButtons`'s autoplan
  block around lines 296-305)
- Modify: `app/main.js:19` (import), `:53` (import), `:237` (paint), `:675`
  (board press), `:841-853` (the press handler and its listener)
- Modify: `index.html:64`
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: `autoplanLearned(state)` (Tasks 2-3), `coachedSide(state)`
  (Task 1).
- Produces: no new exports. `renderFieldButtons` gains a `data-autoplan-button`
  plate in every game state, labelled `Autoplan offense` or
  `Autoplan defense`.

- [ ] **Step 1: Write the failing test**

Append to `test/game/render.test.js`:

```js
test('the autoplan plate is always on the board, and names the side it draws for', () => {
  const mine = renderFieldButtons(createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' }));
  assert.match(buttonGroup(mine, 'data-autoplan-button'), /aria-label="Autoplan offense"/);

  // Coaching the defense used to hide this plate entirely — now it draws up
  // the defense instead.
  const theirs = renderFieldButtons(createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' }));
  assert.match(buttonGroup(theirs, 'data-autoplan-button'), /aria-label="Autoplan defense"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/render.test.js`
Expected: FAIL — the second assertion finds no `data-autoplan-button` group
at all (`buttonGroup` returns nothing for the hidden plate), and the first
finds the fixed label `Autoplan offense` only by luck of the old wording.

- [ ] **Step 3: Write the implementation**

`lib/game/render.js` — add to the imports at the top of the file:

```js
import { coachedSide } from './hud.js';
```

and replace the conditional block inside `renderFieldButtons`:

```js
  // Always in its place, like Run the Turn: the side it draws for changes
  // with the Defense button, but a button that vanished when you took the
  // other team would be one you had to go looking for.
  parts.push(fieldButtonMark({
    attr: 'data-autoplan-button',
    icon: '\u{1F381}',
    label: `Autoplan ${coachedSide(state)}`,
    cy: midY + offset,
    off: animating || state.phase !== 'planning',
  }));
```

`app/main.js`:

- line 19 — add `coachedSide` to the `hud.js` import;
- line 53 — replace the `offense.js` import with

```js
import { autoplanLearned } from '../lib/game/autoplan.js';
```

- line 237 — the disabled rule loses its `aiTeam` clause and the label
  follows the coached side:

```js
  autoplanBtn.textContent = `Autoplan ${coachedSide(state)}`;
  autoplanBtn.disabled = animating || state.phase !== 'planning';
```

- line 675 — `else if (target.closest('[data-autoplan-button]')) pressAutoplan();`
- lines 838-853 — the handler, renamed and re-pointed:

```js
/**
 * Draw up what the learned brain would play on the coach's own side of the
 * ball: the menu's Autoplan button and the board's 🎁 both come here, same as
 * pressRun's own shortcut discipline.
 */
function pressAutoplan() {
  if (animating || state.phase !== 'planning') return;
  const note = autoplanLearned(state);
  if (note === null) return; // declined silently -- there was nothing to plan
  pendingWarning = false;
  say(note);
  paint();
}

autoplanBtn.addEventListener('click', () => {
  closeMenu();
  pressAutoplan();
});
```

`index.html` line 64 — the label is written by every paint, so the markup
carries the neutral word:

```html
      <button id="autoplan-offense">Autoplan</button>
```

(The element id stays `autoplan-offense`: renaming it buys nothing and
touches two more files.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the baseline plus this task's test.

- [ ] **Step 5: Check it in the actual game**

`app/main.js` has no test harness (there is no DOM in `node --test`), so this
one is checked by eye:

Run: `npm run serve`, open the page, deal the 7-player game.
Expected:
1. The menu button reads **Autoplan offense**; press 🎁 and the offense is
   drawn up with a message beginning "Learned call:" (the shipped offense
   genome throws on 1st and 10, so expect the pass call).
2. Press **Defense:** until it reads *Offense: computer (learned)* — you now
   coach the defense. The menu button reads **Autoplan defense**, the 🎁 is
   still on the board, and pressing it draws arrows and cover marks on your
   defenders and nothing at all on the computer's offense.
3. Press **Run Turn** in each case and the play runs normally.

- [ ] **Step 6: Commit**

```bash
git add lib/game/render.js app/main.js index.html test/game/render.test.js
git commit -m "feat: the gift button follows the side you are coaching"
```

---

### Task 5: say so in the README

**Files:**
- Modify: `README.md` (the "How to play" field-button list, around lines
  178-196)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Fix the count and document the button**

The list currently opens "**Three buttons run down the right-hand margin of
the field**" and describes 📋, 🔀 and ⏩ — the 🎁 has never been in it.
Change the opening to **Four buttons**, and insert this entry between the 🔀
and ⏩ bullets:

```markdown
  - 🎁 **below** it is **Autoplan** — one press draws up a whole play for the
    side you are coaching, using the same trained brain the computer plays:
    the learned offense's run/pass call, option read, routes and throws when
    the offense is yours, and the learned defense's man/zone call, coverage
    matchups and rush when you have taken the defense. It plans from wherever
    your men are actually standing — where they line up is still your call —
    and everything it draws is an ordinary order you can redraw, so it is a
    starting point and not a decision. Press it again on a later turn and it
    reads the board again. If you have trained a genome in this browser
    (**Train against your ghost**), that is the brain it draws with.
```

- [ ] **Step 2: Check the surrounding text still reads true**

Run: `grep -n "Three buttons\|four\|🎁" README.md`
Expected: no "Three buttons" left, and the 🎁 entry present. Read the
paragraph above the list ("The middle one opens the menu; the two either side
are shortcuts...") and correct it to match four plates.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: the gift button, and there are four of them"
```

---

## Self-Review

**1. Spec coverage.**

| Spec sentence | Task |
| --- | --- |
| "make this prefilled off of the currently set learned AI instead of the simpler one" | Task 2 (`coachLearnedOffense` + `activeGenome`), Task 4 (the button points at it) |
| "if I've elected to control the defense, please have it fill in the defensive moves in the same way" | Task 1 (which side), Task 3 (the defensive brain), Task 4 (the plate stops hiding) |

**2. Placeholder scan.** Every step carries the code it needs; no "add
appropriate error handling", no "similar to Task N". The one step without a
code block is Task 4 Step 5, which is a manual browser check and lists its
three expected observations.

**3. Every expectation in these tests was run against the engine before the
plan was written** (a throwaway script that stubs `autoplan.js`'s two
branches out of the same calls the tasks specify). Confirmed there:
offense and defense parity are byte-for-byte; the shipped offense genome
calls a **pass** on 1st and 10; `call:bias` ±4 flips run/pass and the guard's
stance with it (`cutBlock` on the run, `holding` on the pass); the seed front
reads as a keep and a tackle widened to 10 yards reads as a give (direct snap
to `o-rb`); the defensive press leaves the offense and the snap untouched and
every defender comes back `normal`; `scheme:bias` ±4 flips man/zone (`d-cb1`
covers `o-wr1` in man, has a spot and no assignment in zone); and
`scheme:bias -0.5` with a 100-pass tendency bucket stays **man** when the
shade is not read, where reading it would have made it zone.

**4. Type consistency.** `coachedSide(state) -> 'offense' | 'defense'` is
used with that exact name in Tasks 2, 3 and 4. `autoplanLearned(state) ->
string | null` is produced in Task 2, re-bodied (same signature) in Task 3,
and consumed in Task 4. `clearTeamOrders(state, team, { modes })` is defined
in Task 2 with `modes` defaulting to `false` and called with `{ modes: true }`
from the offense branch and bare from the defense branch, which is the
distinction design decision 7 turns on. `learnedOrders(state, team, genome,
tendencies)` and `schemeChoice(state, genome, tendencies)` are called with
the four/three arguments their existing signatures declare.
