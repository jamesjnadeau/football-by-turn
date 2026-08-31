# Eleven-a-Side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the eleven-a-side game the home screen already advertises as
*coming soon*, and light its button up.

**Architecture:** Team size stops being a constant and becomes data. A new
`lib/game/rosters.js` holds one roster per variant — the drive-start formation
for both teams, the team size, and how many men the formation rule wants on the
line — keyed by the same `'7'` / `'11'` ids `lib/game/variants.js` already uses
for the home screen. `createGame({ variant })` records the choice in
`state.variantId`, `nextDown` re-forms from it, and `app/home.js` passes the id
of the button that was pressed all the way through. Three pieces of the
computer's assignment defense silently assume "exactly one linebacker and
exactly one middle lineman"; each is generalized so a five-man front and a
two-backer box behave, and each is written so the one-backer / three-lineman
case returns exactly what it returns today.

**Tech Stack:** Vanilla ES modules, no build step. Tests are Node's built-in
runner (`node --test`), no framework, no DOM.

**Spec:** There is no separate spec document — the user's request ("add an
11-player version of the engine/field/players and anything else that matters;
the menu to show it is a separate plan") is the spec, and the design decisions
it needed are recorded under **Design Decisions** below. The menu it refers to
has since shipped: `lib/game/variants.js`, `lib/game/home.js` and `app/home.js`
are the home screen, and its `11 Player` entry is already written with
`teamSize: 11, available: false`. This plan is what makes that entry true.

---

## One correction to the brief

**The current game is 7-a-side, not 8.** `TEAM_SIZE = 7` in
`lib/game/constants.js`, seven entries per team in `lib/game/state.js`, and
`VARIANTS[0].teamSize` is 7. Nothing in the tree is eight. This plan builds
eleven-a-side against the seven-a-side that actually exists.

The brief also said "instead of" the current game. The home screen has landed
since, and it offers both — so eleven a side is added *beside* seven rather
than replacing it, and the coach picks. See **The library default** below for
what that means and how to change it if you disagree.

## Design Decisions

Each of these was settled by working the numbers against the current code, and
each is load-bearing for at least one task.

- **`'7'` and `'11'` are the vocabulary, not new names.** `lib/game/variants.js`
  already keys the home screen on those two strings. `rosters.js` uses the same
  keys, `createGame` takes `{ variant }`, and the state field is `variantId`.
  One id runs from the button the coach pressed to the formation that is built.
- **The eleven roster is a superset of the seven roster's ids.** `o-c`, `o-lg`,
  `o-rg`, `o-wr1`, `o-wr2`, `o-qb`, `o-rb`, `d-nt`, `d-dt1`, `d-dt2`, `d-cb1`,
  `d-cb2`, `d-lb` and `d-s` all keep their ids *and their drive-start
  positions*, except `o-wr2`, which moves off the line. This is why the roughly
  250 hardcoded id references across the suite need no attention at all.
- **`o-c` and `o-qb` must exist in every roster.** The snap runs between
  `SNAPPER_ID` and `SNAP_TARGET_ID` (`lib/game/state.js`), the centre starts
  every down holding the ball, and `aimSnap` puts the lateral on automatically.
  Both rosters have both men; Task 1 adds a guard so a future roster that
  forgets one fails loudly at build time rather than opening a down with the
  ball stuck on a lineman.
- **Exactly seven on the line.** `minOnLine` for the eleven roster is 7 — the
  real rule, no longer rounded. The drive-start offense puts exactly seven men
  on it (LT LG C RG RT TE WR1) and four in the backfield (WR2 as a flanker, FB,
  QB, RB).
- **`o-wr2` moves from `down: -1` to `down: -3`.** `ON_LINE_YARDS` is 2, so a
  flanker has to be three yards off the ball to count as a back. Without this
  the formation shows eight on the line, which is legal but is not the
  formation.
- **The offense's x positions sum to zero.** `alignDefense` puts the free
  safety over `middle`, the mean of the offense's x. A non-zero mean would put
  `d-s` at some fraction of a yard no formation table could reproduce, and the
  "aligning reproduces the drive-start defense" test would fail. TE at +7.5 is
  balanced by FB at −7.5.
- **TE and FB are `RADIUS_MID`, not `RADIUS_SKILL`.** `coverAssignments` calls
  anyone who can run at 90% of a defensive back's top speed a receiver
  (`AI_THREAT_SPEED_RATIO`), and only `RADIUS_SKILL` bodies clear that bar. Mid
  radius therefore leaves the eleven roster with exactly three coverage threats
  (WR1, WR2, RB) against exactly three man defenders (CB1, CB2, FS), safety
  free — nobody comes off the snap uncovered. Making the tight end a receiving
  threat is a reasonable later change, but it needs a fourth cover man with it.
- **The defense is a five-two-four.** Five down (NT, both DTs, two new DEs), two
  linebackers, four backs (both CBs, a new FS, and S as the free man). An odd
  front is what `containRank` wants — it leaves exactly one man dead in the
  middle — and four backs is what a three-threat offense wants.
- **The defensive line array is ordered middle-out, not left to right.**
  `alignDefense` pairs `front[i]` with `onLine[i]`, where `onLine` is the
  offense's on-the-line men sorted by distance from the ball with ties on id:
  `[C(0), LG(−2.5), RG(+2.5), LT(−5), RT(+5)]`. The defensive line must be
  listed `[NT(0), DT1(−2.5), DT2(+2.5), DE1(−5), DE2(+5)]` to match, or the
  alignment will not reproduce the defense it is already standing in.
- **No field or view changes.** The field is 53⅓ yards wide and the frame runs
  from 20 yards behind the drive start to the end line. 22 bodies fit with room:
  the widest man is a receiver at ±15 yards against a ±26.67 yard sideline, and
  the deepest is the RB at 7 yards behind the LOS against a 12-yard floor on the
  spot (`nextDown` clamps to `TOP_YARD + 8`). `lib/field/` and
  `lib/game/view.js` are untouched.

### The library default

`DEFAULT_VARIANT` stays `'7'`. That follows the convention this codebase
already states twice in `createGame` — of `ai` and `aiLevel` both: *"the default
is the older one so the library's semantics, and every test written against
them, stay exactly as they were; app/main.js is what opts the played game in."*
The home screen is what opts a coach into eleven a side, and it is the only
thing that needs to.

The practical effect is large: with the default unchanged, **no existing
assertion value changes anywhere in the suite**. The churn is five import swaps,
one function rename, and the variants test. The eleven-a-side game gets its
coverage from the new `test/game/rosters.test.js`, which is written to be
thorough precisely because the old suite will not exercise it.

If you would rather eleven a side were the library default too, it is
`DEFAULT_VARIANT = '11'` and then six assertions to re-tune — but do it as a
follow-up, not inside this plan, so the two changes stay separable.

## Known state of the tree

- **Baseline: `main` at `d47810d`** ("make long passing more accurate"), working
  tree clean apart from this untracked plan file. `npm test` reports **391
  passing, 0 failing**. Every "run the suite" step below means *all green* —
  there are no pre-existing failures to excuse, and every exact-match snippet
  quoted in this plan was checked against that commit.
- **The other untracked plan under `docs/superpowers/plans/` is not yours.**
  Leave it alone and never stage it.
- The lob-passing and home-screen work that was in flight when this plan was
  first drafted has landed (through commit `d47810d`). This plan is written
  against that tree — in particular against the automatic snap (`aimSnap`, the
  centre holding the ball at the start of every down) and against
  `spotFault`'s `outside-hashes` rule.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/game/rosters.js` (**new**) | One roster per variant. The only file that knows what a formation looks like. |
| `lib/game/state.js` (modify) | Loses both formation tables; `formationPlayers` and `createGame` take a variant id; `state.variantId` is recorded. |
| `lib/game/constants.js` (modify) | Loses `TEAM_SIZE` and `MIN_ON_LINE` (per-roster now); gains `BACKER_LANE_UNITS`. |
| `lib/game/rules.js` (modify) | `nextDown` re-forms on `state.variantId`. |
| `lib/game/defense.js` (modify) | New `orderedMates` and `backerLane`; `containSide` → `containRank`; `flowLinebacker` keeps a lane. |
| `lib/game/formation.js` (modify) | `formationFoul` asks the roster; `alignDefense` places backers in lanes. |
| `lib/game/variants.js` (modify) | The `11` entry becomes playable and describes the game it now starts. |
| `app/home.js` (modify) | Passes the pressed button's variant id into the game. |
| `app/main.js` (modify) | Takes a variant, reads `minOnLine(state)`, deals every New Game from the same variant. |
| `README.md` (modify) | The home-screen paragraph and the two *v1 interpretation decisions* bullets about team size. |
| `test/game/rosters.test.js` (**new**) | Everything the eleven-a-side game needs held to. |
| `test/game/{ai,formation,render,state,turn,defense,variants}.test.js` (modify) | Import swaps and one rename. No assertion values change. |

## Global Constraints

- **No build step, no dependencies.** Vanilla ES modules loaded straight off the
  filesystem. Nothing may be added to `package.json`.
- **Tests are `node --test` only** — `node:test` and `node:assert/strict`, no
  framework, no DOM.
- **The seven-a-side game must stay bit-identical.** Every generalization in
  Tasks 2 and 3 must return exactly today's value for a one-backer,
  three-lineman defense. Each of those tasks has a step that proves it.
- **`lib/` stays pure outside `turn.js`/`rules.js`** — no dice, no clock.
  `formation.js` and `defense.js` read state and return facts.
- **The eleven roster's positions are fixed by this plan.** They are chosen so
  `alignDefense` reproduces them exactly and so the offense's x sums to zero;
  moving one number breaks both. If a position must change, re-derive the table
  and re-run Task 4's alignment test.
- **Commit after every task, with the suite green.**

---

### Task 1: The roster module

Move both formation tables out of `state.js` into a roster keyed by variant id,
and thread that id through game creation, `nextDown`, and the app. No behaviour
changes: `'11'` does not exist yet and `'7'` is the default.

**Files:**
- Create: `lib/game/rosters.js`
- Modify: `lib/game/state.js`, `lib/game/constants.js`, `lib/game/rules.js`, `lib/game/formation.js`, `app/main.js`
- Modify: `test/game/ai.test.js`, `test/game/formation.test.js`, `test/game/render.test.js`, `test/game/state.test.js`, `test/game/turn.test.js`, `test/game/variants.test.js`

**Interfaces:**
- Consumes: `SNAPPER_ID` and `SNAP_TARGET_ID`, already exported from `lib/game/state.js`.
- Produces:
  - `ROSTERS: Record<string, Roster>` where
    `Roster = { id: string, teamSize: number, minOnLine: number, offense: Spec[], defense: Spec[] }`
    and `Spec = { id: string, role: string, radius: number, across: number, down: number }`
  - `DEFAULT_VARIANT: string` — `'7'`
  - `getRoster(id: string | undefined): Roster` — falls back to the default for an unknown id
  - `teamSize(state): number`, `minOnLine(state): number`
  - `formationPlayers(losYard: number, variantId?: string): Player[]`
  - `createGame({ seed, ai, aiLevel, variant })`, storing `state.variantId`

- [x] **Step 1: Write the failing test**

Create `test/game/rosters.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROSTERS, DEFAULT_VARIANT, getRoster, teamSize, minOnLine,
} from '../../lib/game/rosters.js';
import { createGame, SNAPPER_ID, SNAP_TARGET_ID } from '../../lib/game/state.js';
import { nextDown } from '../../lib/game/rules.js';

test('every roster fields as many a side as it claims, with unique ids and a snap to take', () => {
  for (const roster of Object.values(ROSTERS)) {
    assert.equal(roster.offense.length, roster.teamSize, `${roster.id} offense`);
    assert.equal(roster.defense.length, roster.teamSize, `${roster.id} defense`);
    const ids = [...roster.offense, ...roster.defense].map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${roster.id} ids are unique`);
    assert.ok(roster.minOnLine <= roster.teamSize, `${roster.id} can field its line`);
    for (const id of [SNAPPER_ID, SNAP_TARGET_ID]) {
      assert.ok(roster.offense.some((s) => s.id === id), `${roster.id} has ${id}`);
    }
  }
});

test('an unknown variant falls back to the default rather than throwing', () => {
  assert.equal(getRoster('9').id, DEFAULT_VARIANT);
  assert.equal(getRoster(undefined).id, DEFAULT_VARIANT);
});

test('a game remembers the variant it was dealt, and keeps it across a down', () => {
  const s = createGame({ seed: 1, variant: '7' });
  assert.equal(s.variantId, '7');
  assert.equal(teamSize(s), 7);
  assert.equal(minOnLine(s), 5);
  assert.equal(s.players.length, 14);

  s.phase = 'playOver';
  s.deadReason = 'tackle';
  nextDown(s);
  assert.equal(s.variantId, '7', 'the next down is played with the same teams');
  assert.equal(s.players.length, 14);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/game/rosters.test.js`
Expected: FAIL — `Cannot find module .../lib/game/rosters.js`.

- [x] **Step 3: Create `lib/game/rosters.js`**

The two tables are moved verbatim out of `lib/game/state.js` — do not retype
them, and do not change a number.

```js
/**
 * The teams each game can field: how many a side, how many men the formation
 * rule wants on the line, and where everybody stands at the snap.
 *
 * Keyed by the same ids lib/game/variants.js gives the home screen, so the
 * string on the button a coach presses is the string this file is looked up
 * with. This is the only file that knows the shape of a formation: state.js
 * builds players from these tables, formation.js asks them how many men the
 * line needs, and app/main.js names one when it deals a game.
 *
 * Positions are in yards relative to the line of scrimmage: `across` from the
 * middle of the field (negative is left), `down` toward the team's own goal (so
 * the offense is negative and the defense positive).
 *
 * ORDER MATTERS in these arrays, and not only for rendering. formation.js's
 * alignDefense pairs the defensive line with the offense's interior IN ARRAY
 * ORDER, against an offensive line it has sorted from the ball outwards; and
 * defense.js's deepestThreat breaks ties on array order, which is what makes
 * "the deepest man is the centre" true at the snap.
 */
import { RADIUS_LINE, RADIUS_MID, RADIUS_SKILL } from './constants.js';

const SEVEN_OFFENSE = [
  { id: 'o-c', role: 'C', radius: RADIUS_LINE, across: 0, down: -1 },
  { id: 'o-lg', role: 'LG', radius: RADIUS_LINE, across: -2.5, down: -1 },
  { id: 'o-rg', role: 'RG', radius: RADIUS_LINE, across: 2.5, down: -1 },
  { id: 'o-wr1', role: 'WR', radius: RADIUS_SKILL, across: -15, down: -1 },
  { id: 'o-wr2', role: 'WR', radius: RADIUS_SKILL, across: 15, down: -1 },
  { id: 'o-qb', role: 'QB', radius: RADIUS_MID, across: 0, down: -4 },
  { id: 'o-rb', role: 'RB', radius: RADIUS_SKILL, across: 0, down: -7 },
];

const SEVEN_DEFENSE = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-dt2', role: 'DT', radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: 0, down: 4 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];

export const ROSTERS = {
  7: {
    id: '7',
    teamSize: 7,
    // Real football wants seven of eleven on the line; 7/11 of a seven-man
    // team rounds to five, which is exactly what this formation shows.
    minOnLine: 5,
    offense: SEVEN_OFFENSE,
    defense: SEVEN_DEFENSE,
  },
};

/**
 * What a game is dealt from when nobody names a variant. The older game, for
 * the reason createGame gives about `ai` and `aiLevel`: the library's semantics
 * and every test written against them stay as they were, and app/main.js — here
 * meaning the home screen behind it — is what opts a coach into anything else.
 */
export const DEFAULT_VARIANT = '7';

/**
 * The named roster, or the default. An unrecognised name falls back rather than
 * throwing: the id arrives from a button's `data-variant`, and a stale one
 * should deal a playable game rather than a blank screen. (`isPlayable` in
 * variants.js is the gate that stops it getting here at all; this is the second
 * lock on the same door.)
 */
export function getRoster(id) {
  return ROSTERS[id] ?? ROSTERS[DEFAULT_VARIANT];
}

/** How many players a side this game is being played with. */
export function teamSize(state) {
  return getRoster(state.variantId).teamSize;
}

/** How many men this game's formation rule wants on the line of scrimmage. */
export function minOnLine(state) {
  return getRoster(state.variantId).minOnLine;
}
```

- [x] **Step 4: Rewrite the top of `lib/game/state.js`**

Delete the `OFFENSE` const and the doc comment above it ("One drive-start
formation per team…"), and delete the `DEFENSE` const. Leave `SNAPPER_ID` /
`SNAP_TARGET_ID` and the comment above them exactly where they are, but change
that comment's opening line from "Named here, beside the formation they come
from" to:

```js
/**
 * The snap runs between these two. Named here rather than in rosters.js
 * because they are the same two men in every game this page deals — a variant
 * that had no centre or nobody under him would be a different sport.
 * formationPlayers refuses to build a roster missing either of them.
 */
```

Change the `constants.js` import line

```js
import { RADIUS_LINE, RADIUS_MID, RADIUS_SKILL, TEAM_SIZE } from './constants.js';
```

to

```js
import { getRoster, DEFAULT_VARIANT } from './rosters.js';
```

Replace `formationPlayers` with:

```js
/**
 * Both teams at the snap, built from the named variant's roster. rosters.js is
 * the only place a formation is written down; this is the only place one is
 * built.
 */
export function formationPlayers(losYard, variantId = DEFAULT_VARIANT) {
  const roster = getRoster(variantId);
  if (roster.offense.length !== roster.teamSize
    || roster.defense.length !== roster.teamSize) {
    throw new Error(`variant "${roster.id}" must have exactly ${roster.teamSize} players a side`);
  }
  // A roster with nobody to snap the ball, or nobody to snap it to, would open
  // every down with the ball stuck in a lineman's hands and no way to start —
  // aimSnap simply gives up. Better to fail here, where the roster is written.
  for (const id of [SNAPPER_ID, SNAP_TARGET_ID]) {
    if (!roster.offense.some((spec) => spec.id === id)) {
      throw new Error(`variant "${roster.id}" has no "${id}" to take the snap`);
    }
  }
  return [
    ...roster.offense.map((s) => makePlayer(s, 'offense', losYard)),
    ...roster.defense.map((s) => makePlayer(s, 'defense', losYard)),
  ];
}
```

In `createGame`, take the option and record the resolved id:

```js
export function createGame({
  seed = 1, ai = null, aiLevel = 'pursuit', variant = DEFAULT_VARIANT,
} = {}) {
  const state = {
    seed,
    aiTeam: ai,
    // Which game this is: the same id the home screen's button carries.
    // Resolved through getRoster rather than stored raw, so an unknown name
    // never survives into the state where nextDown would rebuild the field
    // from it every down.
    variantId: getRoster(variant).id,
```

and change the `players` line to:

```js
    players: formationPlayers(0, variant),
```

Everything else in `createGame` — `ball: { carrierId: SNAPPER_ID, ... }` and the
trailing `aimSnap(state); return state;` — stays as it is.

- [x] **Step 5: Point `nextDown` at the game's variant**

In `lib/game/rules.js`, change

```js
  state.players = formationPlayers(spot);
```

to

```js
  state.players = formationPlayers(spot, state.variantId);
```

- [x] **Step 6: Move the two constants out of `constants.js`**

Delete `export const TEAM_SIZE = 7;`, and delete `MIN_ON_LINE` together with the
comment block above it (the one beginning "Real football wants seven of eleven
on the line") — that reasoning now sits on each roster's `minOnLine`. Put the
new lateral constant where `MIN_ON_LINE` was, beside the other alignment
numbers:

```js
// How far apart linebackers keep themselves across the field: 22.5 units, six
// yards. A UNITS value rather than a yards one because it is used as a lateral
// offset from the ball's x, which is already in units — the same reasoning as
// AI_CONTAIN_UNITS. A defense with one linebacker gets a lane of zero, which is
// what keeps a one-backer box playing exactly as it did before lanes existed.
export const BACKER_LANE_UNITS = 22.5;
```

(`BACKER_LANE_UNITS` is unused until Task 2. Adding it here keeps `constants.js`
touched once rather than twice.)

- [x] **Step 7: Point the formation rule at the roster**

In `lib/game/formation.js`, add

```js
import { minOnLine } from './rosters.js';
```

remove `MIN_ON_LINE` from the `./constants.js` import list, and change
`formationFoul`'s body to:

```js
  return lineCount(state, 'offense') < minOnLine(state) ? 'illegal-formation' : null;
```

- [x] **Step 8: Point the app at the variant**

In `app/main.js`, remove `MIN_ON_LINE` from the `../lib/game/constants.js`
import list and add below it:

```js
import { minOnLine, DEFAULT_VARIANT } from '../lib/game/rosters.js';
```

Declare the variant beside the game state, so it is initialised before anything
reads it — put it immediately after the `let state = ...` line near the top of
the module:

```js
// Which game this drive is: the id of the home-screen button that started it.
// startGame() sets it and New Game re-reads it, so New Game deals the same game
// again — switching is what Back to Home is for.
let variantId = DEFAULT_VARIANT;
```

Change `formationNote` to ask the state rather than a constant:

```js
function formationNote() {
  const n = lineCount(state, 'offense');
  const need = minOnLine(state);
  return n < need
    ? `${n} on the line — ILLEGAL FORMATION (needs ${need}).`
    : `${n} on the line.`;
}
```

In `startNewGame`, deal from it:

```js
  state = createGame({
    seed: (Math.random() * 2 ** 31) | 0, ai: 'defense', aiLevel: 'smart', variant: variantId,
  });
```

And take it in `startGame`, above the `inputAttached` check:

```js
export function startGame({ variant = DEFAULT_VARIANT, onExit = () => {} } = {}) {
  exitToHome = onExit;
  variantId = variant;
```

Extend `startGame`'s doc comment with a line about it:

```js
 * `variant` is the id of the button that was pressed — see lib/game/variants.js
 * and lib/game/rosters.js. It is held for the whole visit, so New Game deals
 * the same game again and a coach who wants the other one goes back home for
 * it.
```

- [x] **Step 9: Fix the six test files that referenced the deleted constants**

Mechanical: no assertion value changes, because the default variant is still
`'7'`.

`test/game/state.test.js` — replace
`import { TEAM_SIZE } from '../../lib/game/constants.js';` with
`import { teamSize } from '../../lib/game/rosters.js';`, and change the two
assertions in the first test to `teamSize(s)`.

`test/game/ai.test.js` — replace
`import { TEAM_SIZE, AI_LEAD_MAX_SECONDS, AI_BREAKDOWN_UNITS } from '../../lib/game/constants.js';`
with

```js
import { AI_LEAD_MAX_SECONDS, AI_BREAKDOWN_UNITS } from '../../lib/game/constants.js';
import { teamSize } from '../../lib/game/rosters.js';
```

and change both `TEAM_SIZE` uses to `teamSize(s)`.

`test/game/turn.test.js` — replace
`import { SUBSTEPS_PER_TURN, TEAM_SIZE } from '../../lib/game/constants.js';` with

```js
import { SUBSTEPS_PER_TURN } from '../../lib/game/constants.js';
import { teamSize } from '../../lib/game/rosters.js';
```

and change the three uses to `teamSize(s) * 2`, `teamSize(s) * 2 - 1` and
`teamSize(s)`.

`test/game/render.test.js` — drop `TEAM_SIZE,` from the `constants.js` import
list, add `import { teamSize } from '../../lib/game/rosters.js';` beneath it,
and change `TEAM_SIZE * 2` to `teamSize(s) * 2`.

`test/game/formation.test.js` — replace
`import { MIN_ON_LINE, TEAM_SIZE } from '../../lib/game/constants.js';` with
`import { minOnLine, teamSize } from '../../lib/game/rosters.js';`, then
`MIN_ON_LINE` → `minOnLine(s)`, `MIN_ON_LINE - 1` → `minOnLine(s) - 1`,
`TEAM_SIZE` → `teamSize(s)`.

`test/game/variants.test.js` — replace
`import { TEAM_SIZE } from '../../lib/game/constants.js';` with
`import { ROSTERS } from '../../lib/game/rosters.js';`, and replace the whole
"the playable variant fields the team the game actually builds" test with one
that holds every playable variant against the roster it will actually build:

```js
test('every playable variant fields the team the game actually builds', () => {
  for (const v of VARIANTS) {
    if (!v.available) continue;
    const roster = ROSTERS[v.id];
    assert.ok(roster, `${v.id} has a roster to build from`);
    assert.equal(v.teamSize, roster.teamSize, `${v.id} team size`);
  }
});
```

- [x] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS — 394 tests, 0 failures (391 as before, plus the three new
roster tests). This task changes no behaviour, so a single failure means
something was mistyped.

- [x] **Step 11: Commit**

```bash
git add lib/game/rosters.js lib/game/state.js lib/game/constants.js lib/game/rules.js lib/game/formation.js app/main.js test/game && git commit -m "refactor: make the roster data the variant names, not a constant"
```

---

### Task 2: Linebacker lanes

Two linebackers mirroring the same ball both want the same yard of grass, and
would spend every turn shoving each other off it. Give each backer a lane
offset from the ball, worked out from where he is standing among his mates, and
keep it both in the pre-snap alignment and in the in-play mirror.

**Files:**
- Modify: `lib/game/defense.js`, `lib/game/formation.js`
- Modify: `test/game/rosters.test.js`

**Interfaces:**
- Consumes: `groupMates(state, player): Player[]` and `positionGroup(player): 'line' | 'backer' | 'back'`, both already exported by `defense.js`; `BACKER_LANE_UNITS` from Task 1.
- Produces:
  - `orderedMates(state, player): Player[]` — his group mates sorted left to right by `pos.x`, ties on id
  - `backerLane(state, player): number` — signed lateral offset in SVG units; `0` for a lone backer

- [x] **Step 1: Write the failing test**

Append to `test/game/rosters.test.js`, adding
`import { getPlayer } from '../../lib/game/state.js';` (extend the existing
`state.js` import), `import { backerLane, orderedMates } from '../../lib/game/defense.js';`
and `import { BACKER_LANE_UNITS } from '../../lib/game/constants.js';`:

```js
test('a lone backer keeps no lane — he plays the ball, as he always has', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '7' });
  assert.equal(backerLane(s, getPlayer(s, 'd-lb')), 0);
  assert.deepEqual(orderedMates(s, getPlayer(s, 'd-lb')).map((p) => p.id), ['d-lb']);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/game/rosters.test.js`
Expected: FAIL — `does not provide an export named 'backerLane'`.

- [x] **Step 3: Add `orderedMates` and `backerLane` to `lib/game/defense.js`**

Add `BACKER_LANE_UNITS` to the `./constants.js` import list, then add these two
functions immediately below `groupMates`:

```js
/**
 * This player's group mates, left to right across the field, ties on id.
 *
 * Ordering by POSITION rather than by formation order is what makes a lane or a
 * contain assignment a fact about where a man is standing: two linebackers who
 * cross during a play swap lanes rather than running back across each other to
 * reclaim the one their id was born with.
 */
export function orderedMates(state, player) {
  return groupMates(state, player)
    .slice()
    .sort((a, b) => a.pos.x - b.pos.x || a.id.localeCompare(b.id));
}

/**
 * How far off the ball this backer holds himself, across the field.
 *
 * Backers spread evenly about the ball, BACKER_LANE_UNITS apart, in the order
 * they are standing in. One backer gets zero — he IS the middle — so a defense
 * with a single linebacker mirrors the ball exactly as it always has.
 */
export function backerLane(state, player) {
  const mates = orderedMates(state, player);
  const i = mates.findIndex((p) => p.id === player.id);
  return (i - (mates.length - 1) / 2) * BACKER_LANE_UNITS;
}
```

- [x] **Step 4: Keep the lane in the mirror**

In `flowLinebacker`, replace the final line

```js
  return { aim: { x: aim.x, y: losY(state) + dir * AI_BACKER_DEPTH_UNITS }, cover: null };
```

with

```js
  // The lane belongs to the mirror and not to the FILL above it: waiting is
  // when a box has to be shared, and arriving at the ball is not.
  const lane = backerLane(state, player);
  return {
    aim: { x: aim.x + lane, y: losY(state) + dir * AI_BACKER_DEPTH_UNITS },
    cover: null,
  };
```

- [x] **Step 5: Place backers explicitly in `alignDefense`**

In `lib/game/formation.js`, add `backerLane` to the import from `./defense.js`,
then insert this block immediately after the `if (free) { ... }` block and
before the `for (const d of mine)` catch-all loop:

```js
  // Backers share the middle of the field rather than stacking on the ball —
  // the same lanes defense.js's flowLinebacker keeps during the play, so what
  // the coach lines up against is what he will be playing against. A defense
  // with one backer gets a lane of zero and lands on the ball, which is exactly
  // where the catch-all below used to put him.
  for (const d of mine.filter((p) => positionGroup(p) === 'backer')) {
    aim.set(d.id, {
      x: ball.x + backerLane(state, d),
      y: offLine(state, team, ALIGN_BACKER_YARDS),
    });
  }
```

- [x] **Step 6: Prove the one-backer case is untouched**

Run: `npm test`
Expected: PASS, everything. The two tests that would catch a lane leaking into
a one-backer defense are `formation.test.js`'s "aligning against the drive-start
offense reproduces the drive-start defense" and `defense.test.js`'s "a
linebacker holds his depth and mirrors the ball across the field" — confirm both
are in the passing list.

- [x] **Step 7: Commit**

```bash
git add lib/game/defense.js lib/game/formation.js test/game/rosters.test.js && git commit -m "feat: give linebackers lanes so a box can hold more than one"
```

---

### Task 3: Contain ranks

`containSide` returns −1, 0 or +1, which gives exactly one free rusher and one
contain man per side. A five-man front needs two men a side holding *different*
edges, or the outside pair stack on the inside pair's aim point. Replace the
side with a signed rank counted out from the middle.

**Files:**
- Modify: `lib/game/defense.js`
- Modify: `test/game/defense.test.js`, `test/game/rosters.test.js`

**Interfaces:**
- Consumes: `orderedMates` from Task 2.
- Produces: `containRank(state, player): number` — `0` for the man nearest the middle of his own front, then −1, −2… to his left and +1, +2… to his right. `containSide` is removed.

- [x] **Step 1: Write the failing test**

In `test/game/defense.test.js`, rename every `containSide` to `containRank` —
the import on line 5, three call sites in "the front works out its own edges
from where it is standing", and one in "a lone lineman contains nothing". No
expected values change: a three-man front's ranks are −1, 0, +1, exactly the
sides it had.

Then append to `test/game/rosters.test.js` (adding `containRank` to the
`defense.js` import):

```js
test('a three-man front ranks as it always did: one free, one each side', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '7' });
  assert.deepEqual(
    ['d-dt1', 'd-nt', 'd-dt2'].map((id) => containRank(s, getPlayer(s, id))),
    [-1, 0, 1],
  );
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/game/defense.test.js`
Expected: FAIL — `does not provide an export named 'containRank'`.

- [x] **Step 3: Replace `containSide` with `containRank`**

In `lib/game/defense.js`, replace the whole `containSide` function *and its doc
comment* with:

```js
/**
 * How far out on the front this lineman is playing: 0 for the man nearest the
 * middle, then -1, -2 … to his left and +1, +2 … to his right.
 *
 * A rank rather than a side, because contain is a distance and not only a
 * direction: on a five-man front the ends have to hold a wider edge than the
 * tackles inside them, or all four would manage the same yard of grass and
 * leave the same gap. rushLineman multiplies this by AI_CONTAIN_UNITS to get
 * the edge each man keeps, so a three-man front's -1/0/+1 is exactly the six
 * units either side it always kept.
 *
 * Derived from where his own line is actually standing, not from a role name,
 * so a four-man front, an unbalanced one, or a line that has drifted during the
 * play still yields exactly one man free up the middle. The middle man is
 * whoever is closest to the midpoint of the front's own span, ties going to the
 * man further left and then to the earlier id — deterministic, because nothing
 * the computer decides may depend on iteration luck.
 */
export function containRank(state, player) {
  const line = orderedMates(state, player);
  const xs = line.map((p) => p.pos.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const middle = line.reduce((a, b) =>
    Math.abs(b.pos.x - mid) < Math.abs(a.pos.x - mid) ? b : a);
  return line.findIndex((p) => p.id === player.id)
    - line.findIndex((p) => p.id === middle.id);
}
```

- [x] **Step 4: Use the rank in `rushLineman`**

Replace these four lines of `rushLineman`

```js
  const side = containSide(state, player);
  if (side === 0) return { aim, cover: null };
  const edge = car.pos.x + side * AI_CONTAIN_UNITS;
  const x = side < 0 ? Math.min(aim.x, edge) : Math.max(aim.x, edge);
```

with

```js
  const rank = containRank(state, player);
  if (rank === 0) return { aim, cover: null };
  const edge = car.pos.x + rank * AI_CONTAIN_UNITS;
  const x = rank < 0 ? Math.min(aim.x, edge) : Math.max(aim.x, edge);
```

- [x] **Step 5: Prove the three-man front is untouched**

Run: `npm test`
Expected: PASS, everything. `defense.test.js`'s "an edge rusher keeps his side
of the ball" pins the three-man front's exact aim points (`x: 129`, `x: 135`,
`x: 141`); confirm it is in the passing list.

- [x] **Step 6: Commit**

```bash
git add lib/game/defense.js test/game/defense.test.js test/game/rosters.test.js && git commit -m "feat: contain is a rank out from the middle, not a side"
```

---

### Task 4: The eleven-a-side roster

Add the eleven-a-side tables and hold them to everything the seven-a-side game
is held to. The home screen still does not offer it — that is Task 5.

**Files:**
- Modify: `lib/game/rosters.js`
- Modify: `test/game/rosters.test.js`

**Interfaces:**
- Consumes: `ROSTERS` (Task 1), `backerLane` (Task 2), `containRank` (Task 3).
- Produces: `ROSTERS['11']` — offense `o-c o-lg o-rg o-lt o-rt o-te o-wr1 o-wr2 o-fb o-qb o-rb`, defense `d-nt d-dt1 d-dt2 d-de1 d-de2 d-lb d-lb2 d-cb1 d-cb2 d-fs d-s`, `teamSize: 11`, `minOnLine: 7`.

- [x] **Step 1: Write the failing test**

Append to `test/game/rosters.test.js`. Extend the imports first: add
`setPlan` to the `state.js` import; add
`import { runTurn } from '../../lib/game/turn.js';`,
`import { mulberry32 } from '../../lib/game/rng.js';`,
`import { lineCount, formationFoul, alignDefense, spotFault } from '../../lib/game/formation.js';`
and `coverAssignments, deepMan` to the `defense.js` import.

```js
test('every roster comes to the line legally, with nobody the rulebook would refuse', () => {
  for (const id of Object.keys(ROSTERS)) {
    const s = createGame({ seed: 1, variant: id });
    assert.equal(lineCount(s, 'offense'), minOnLine(s), `${id}: exactly enough on the line`);
    assert.equal(formationFoul(s), null, `${id}: legal formation`);
    for (const p of s.players) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${id}: ${p.id} at a legal spot`);
    }
  }
});

test('every roster is balanced across the field, so the free man aligns over the middle', () => {
  for (const id of Object.keys(ROSTERS)) {
    const s = createGame({ seed: 1, variant: id });
    const offense = s.players.filter((p) => p.team === 'offense');
    const mean = offense.reduce((sum, p) => sum + p.pos.x, 0) / offense.length;
    assert.equal(mean, 135, `${id}: the middle of the field`);
  }
});

test("aligning against a drive-start formation reproduces that variant's own defense", () => {
  for (const id of Object.keys(ROSTERS)) {
    const s = createGame({ seed: 1, variant: id });
    for (const { id: who, pos } of alignDefense(s)) {
      assert.deepEqual(pos, getPlayer(s, who).pos, `${id}: ${who} was already where he belongs`);
    }
  }
});

test('eleven a side: every coverage threat has a man on him and the safety is free', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '11' });
  assert.deepEqual([...coverAssignments(s, 'defense').entries()].sort(), [
    ['d-cb1', 'o-wr1'], ['d-cb2', 'o-wr2'], ['d-fs', 'o-rb'],
  ]);
  assert.equal(deepMan(s, 'defense').id, 'd-s', 'and he is the last man back');
});

test('eleven a side: the five-man front ranks itself out from the middle', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '11' });
  assert.deepEqual(
    ['d-de1', 'd-dt1', 'd-nt', 'd-dt2', 'd-de2']
      .map((id) => containRank(s, getPlayer(s, id))),
    [-2, -1, 0, 1, 2],
  );
});

test('eleven a side: the two backers split the box rather than stacking on the ball', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '11' });
  assert.deepEqual(orderedMates(s, getPlayer(s, 'd-lb')).map((p) => p.id), ['d-lb', 'd-lb2']);
  assert.equal(backerLane(s, getPlayer(s, 'd-lb')), -BACKER_LANE_UNITS / 2);
  assert.equal(backerLane(s, getPlayer(s, 'd-lb2')), BACKER_LANE_UNITS / 2);
});

test('the lane is read off the field, so backers who cross over swap lanes', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '11' });
  getPlayer(s, 'd-lb').pos = { x: 200, y: 100 };
  assert.equal(backerLane(s, getPlayer(s, 'd-lb')), BACKER_LANE_UNITS / 2,
    'he is the right-hand backer now');
});

test('a computer-coached eleven-a-side down runs to a whistle and re-forms both teams', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart', variant: '11' });
  const random = mulberry32(1);
  for (const p of s.players) {
    if (p.team === 'offense') setPlan(s, p.id, { x: 0, y: 1 }, 1);
  }
  let turns = 0;
  while (s.phase !== 'playOver' && turns < 40) {
    runTurn(s, random);
    turns += 1;
  }
  assert.equal(s.phase, 'playOver', `the play ended (in ${turns} turns)`);
  assert.ok(s.players.every((p) => p.team !== 'defense' || (p.plan === null && p.cover === null)),
    'the computer left nothing behind for the coach to read');

  nextDown(s);
  if (s.phase === 'planning') {
    assert.equal(s.players.length, 22, 'both teams re-formed eleven a side');
    assert.equal(s.variantId, '11');
  }
});
```

Also change the third test written in Task 1 — "a game remembers the variant it
was dealt" — over to the eleven roster, since that is now the interesting case:

```js
test('a game remembers the variant it was dealt, and keeps it across a down', () => {
  const s = createGame({ seed: 1, variant: '11' });
  assert.equal(s.variantId, '11');
  assert.equal(teamSize(s), 11);
  assert.equal(minOnLine(s), 7);
  assert.equal(s.players.length, 22);

  s.phase = 'playOver';
  s.deadReason = 'tackle';
  nextDown(s);
  assert.equal(s.variantId, '11', 'the next down is played with the same teams');
  assert.equal(s.players.length, 22);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/game/rosters.test.js`
Expected: FAIL — `teamSize(s)` is 7, because `getRoster('11')` falls back to the
default.

- [x] **Step 3: Add the eleven tables to `lib/game/rosters.js`**

Insert above the `ROSTERS` object:

```js
/**
 * Eleven a side. A pro-style set: five linemen and a tight end, one receiver
 * split on the line and one flanked off it, a fullback on the weak side, a
 * quarterback and a back.
 *
 * Three things here are load-bearing and must not be nudged casually:
 *
 *   - exactly SEVEN of these are within ON_LINE_YARDS of the line (the five
 *     linemen, the tight end and o-wr1), which is minOnLine exactly. o-wr2 is
 *     three yards off the ball precisely so that he is a back rather than an
 *     eighth man on it;
 *   - the x positions SUM TO ZERO, which is what puts the free safety dead in
 *     the middle when alignDefense averages them;
 *   - o-te and o-fb are RADIUS_MID rather than RADIUS_SKILL, which keeps them
 *     under defense.js's AI_THREAT_SPEED_RATIO bar. That leaves exactly three
 *     coverage threats — both receivers and the back — for exactly three man
 *     defenders, so nobody comes off the snap uncovered.
 */
const ELEVEN_OFFENSE = [
  { id: 'o-c', role: 'C', radius: RADIUS_LINE, across: 0, down: -1 },
  { id: 'o-lg', role: 'LG', radius: RADIUS_LINE, across: -2.5, down: -1 },
  { id: 'o-rg', role: 'RG', radius: RADIUS_LINE, across: 2.5, down: -1 },
  { id: 'o-lt', role: 'LT', radius: RADIUS_LINE, across: -5, down: -1 },
  { id: 'o-rt', role: 'RT', radius: RADIUS_LINE, across: 5, down: -1 },
  { id: 'o-te', role: 'TE', radius: RADIUS_MID, across: 7.5, down: -1 },
  { id: 'o-wr1', role: 'WR', radius: RADIUS_SKILL, across: -15, down: -1 },
  { id: 'o-wr2', role: 'WR', radius: RADIUS_SKILL, across: 15, down: -3 },
  { id: 'o-fb', role: 'FB', radius: RADIUS_MID, across: -7.5, down: -3 },
  { id: 'o-qb', role: 'QB', radius: RADIUS_MID, across: 0, down: -4 },
  { id: 'o-rb', role: 'RB', radius: RADIUS_SKILL, across: 0, down: -7 },
];

/**
 * The answer to it: a five-two-four. Five down, two backers, four backs with
 * the safety free over the top.
 *
 * THE LINE IS LISTED MIDDLE-OUT, not left to right, and that is not a style
 * choice: formation.js's alignDefense pairs this array in order against the
 * offense's on-the-line men sorted from the ball outwards, which comes out
 * [C, LG, RG, LT, RT]. Reorder this array and the defense stops aligning where
 * it is already standing.
 */
const ELEVEN_DEFENSE = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-dt2', role: 'DT', radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: 'd-de1', role: 'DE', radius: RADIUS_LINE, across: -5, down: 1 },
  { id: 'd-de2', role: 'DE', radius: RADIUS_LINE, across: 5, down: 1 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: -3, down: 4 },
  { id: 'd-lb2', role: 'LB', radius: RADIUS_MID, across: 3, down: 4 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-fs', role: 'FS', radius: RADIUS_SKILL, across: -7.5, down: 2 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];
```

and add the entry to `ROSTERS`, after `7`:

```js
  11: {
    id: '11',
    teamSize: 11,
    // Real football, unrounded: seven of eleven on the line.
    minOnLine: 7,
    offense: ELEVEN_OFFENSE,
    defense: ELEVEN_DEFENSE,
  },
```

`d-de1`, `d-de2`, `d-fs` and `d-lb2` need no work in `defense.js` — `DE`, `FS`
and `LB` are all already in its `GROUPS` table.

- [x] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — 404 tests, 0 failures. The default variant is still `'7'`, so
nothing that does not name `'11'` has changed behaviour.

- [x] **Step 5: Commit**

```bash
git add lib/game/rosters.js test/game/rosters.test.js && git commit -m "feat: add the eleven-a-side roster"
```

---

### Task 5: Light up the home screen

The game exists; make the button work.

**Files:**
- Modify: `lib/game/variants.js`, `app/home.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `ROSTERS['11']` (Task 4), `startGame({ variant, onExit })` (Task 1, Step 8).
- Produces: `VARIANTS[1].available === true`. No signature changes.

- [x] **Step 1: Write the failing test**

In `test/game/variants.test.js`, change the first test:

```js
test('two games are offered, and both of them can be played', () => {
  assert.deepEqual(VARIANTS.map((v) => v.id), ['7', '11']);
  assert.equal(isPlayable('7'), true);
  assert.equal(isPlayable('11'), true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/game/variants.test.js`
Expected: FAIL — `isPlayable('11')` is `false`.

- [x] **Step 3: Make the variant playable**

In `lib/game/variants.js`, change the `11` entry's `note` and `available`:

```js
  {
    id: '11',
    label: '11 Player',
    note: 'Five linemen, a tight end, two receivers, a fullback, a quarterback and a back.',
    teamSize: 11,
    available: true,
  },
```

Also update the file's own opening comment, which currently promises the work
this plan just did — replace "so offering the eleven-a-side game one day is a
flag flipped here plus the formations that game needs — not a second screen"
with:

```js
 * Adding a game is an entry here plus the roster it fields in
 * lib/game/rosters.js — not a second screen.
```

- [x] **Step 4: Pass the pressed button's id into the game**

In `app/home.js`'s `start`, change

```js
  game.startGame({ onExit: showHome });
```

to

```js
  game.startGame({ variant: variantId, onExit: showHome });
```

- [x] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — 404 tests, 0 failures.

- [x] **Step 6: Update `README.md`**

Three edits.

First, the home-screen paragraph in *How to play* (around line 36) becomes:

```
The page opens on a **home screen** listing the games it can deal: **7 Player**
and **11 Player**. They are the same game with different-sized teams — the rules
below are true of both. Press either and the board takes over the screen; **Back
to Home** in the Coaches Menu brings the list back.
```

Second, in the same section, "You draw arrows for your seven offensive players"
becomes "You draw arrows for your offensive players" — the count now depends on
the game — and, a few lines below, "then it is seven players converging on one"
becomes "then it is the whole defense converging on one".

Third, replace both team-size bullets in *v1 interpretation decisions* — the
one beginning "**`TEAM_SIZE` = 7-a-side**" and the one beginning "**The
formation rules are the real ones, scaled to seven a side.**" — with:

```markdown
- **Two team sizes, picked off the home screen.** **11 Player** is the full
  game: five linemen, a tight end, two receivers, a fullback, a quarterback and
  a back, against a five-two-four defense. **7 Player** is the original, and is
  kept because it is a genuinely quicker game to draw for — 22 players all
  needing an arrow every half-second turn is a lot of drawing. Both formations
  live in `lib/game/rosters.js`, keyed by the same ids the home screen's buttons
  carry; it is the only file that knows what a formation looks like, and
  everything downstream reads the roster off the state.
- **The formation rules are the real ones.** Eleven a side wants seven of eleven
  on the line, which is exactly what its drive-start formation shows. Seven a
  side rounds that to five, and shows five. Eligible receiver and
  covered/uncovered rules are deliberately left out, because this game lets
  anyone catch a pass. An illegal formation is enforced with the same machinery
  as an illegal forward pass — five yards from the previous spot, and the down
  counts.
```

- [x] **Step 7: Commit**

```bash
git add lib/game/variants.js app/home.js test/game/variants.test.js README.md && git commit -m "feat: offer the eleven-a-side game on the home screen"
```

---

### Task 6: Look at it

Nothing in the suite renders to a screen, and 22 bodies is about what a board
this size can hold. This task is a look, not a build — but it is the only step
that can catch a role label overflowing a 2.5-unit circle, or two new players
reading as one blob.

**Files:**
- Modify: none expected. If something must move it is a position in `lib/game/rosters.js` or `render.js`'s `.gp-role` font size — and moving a position means re-deriving the table and re-running Task 4's alignment test.

**Interfaces:**
- Consumes: the finished game.
- Produces: nothing. A judgement.

- [ ] **Step 1: Serve the game**

```bash
npm run serve
```

- [ ] **Step 2: Open http://localhost:8080 and press 11 Player**

Check exactly these:

1. The **11 Player** button is no longer greyed out and no longer says *coming
   soon*, and pressing it brings up a board.
2. Twenty-two players are on the field, eleven dark and eleven white.
3. Every role label — the six new ones (`LT`, `RT`, `TE`, `FB`, `DE`, `FS`) and
   the eight that were already there — is legible inside its circle and not
   spilling over the rim.
4. Nobody overlaps anybody at the snap, nobody is outside a sideline, and
   nobody is off the top of the frame.
5. The snap arrow is drawn from the centre back to the quarterback, exactly as
   it is in the seven-player game.
6. Press **Reposition**: the green on-the-line band holds exactly seven men, and
   the four backs are clearly outside it. The board reads `7 on the line.` and
   not `ILLEGAL FORMATION`.

- [ ] **Step 3: Play a down**

Draw arrows for a few players and press **Run Turn** twice. Confirm the
animation is smooth with 22 bodies, and that the defense does something
sensible: the front rushes with the ends holding a wider edge than the tackles,
the two linebackers sit at depth *beside* each other rather than on top of each
other, and the corners follow the receivers.

- [ ] **Step 4: Check the two games do not leak into each other**

Press **Back to Home**, then **7 Player**. Confirm fourteen players come up and
the board reads `5 on the line.` Press **New Game** from the Coaches Menu and
confirm it deals seven a side again rather than switching.

- [ ] **Step 5: Commit if anything moved**

If Steps 2–4 needed no change there is nothing to commit and this task is done.
Otherwise:

```bash
npm test && git add -A && git commit -m "fix: <what the board showed>"
```

---

## Self-Review

**Spec coverage.** The brief has three parts. *Engine*: Tasks 2 and 3
generalize the two pieces of the computer's brain that assumed a one-backer,
three-lineman defense, and Task 1 removes the hard-coded team size from the
rulebook. *Field*: no change needed, and **Design Decisions** records the
arithmetic showing 22 bodies fit the existing frame — `lib/field/` and
`view.js` are untouched. *Players*: Task 4 adds the eleven-man tables. "Anything
else that matters" is covered by the snapper guard (Task 1, the automatic snap
needs `o-c` and `o-qb` in every roster), `nextDown` re-forming on the same
variant (Task 1), the illegal-formation count following the roster (Task 1), the
home screen actually offering the game (Task 5), and the visual check (Task 6).
The menu itself was out of scope and has since shipped; Task 5 is only the flag
and the one argument it needs.

**Placeholders.** None. Every code step carries its code, every test step its
assertions. Every claim about what passes and what fails was measured by
applying this plan to a scratch copy of the current tree, not reasoned about.

**Type consistency.** `containRank` is introduced in Task 3 and `containSide`
appears nowhere after it. `orderedMates` and `backerLane` are introduced in
Task 2 and consumed by Task 3's `containRank` and by `alignDefense`.
`teamSize(state)` / `minOnLine(state)` take a state, not a roster, at every call
site; `getRoster` takes an id and returns a roster at every call site.
`formationPlayers(losYard, variantId)` keeps its second parameter optional, so
any caller that has not been updated still builds the default game.
`state.variantId`, `createGame({ variant })`, `startGame({ variant })` and
`VARIANTS[].id` all carry the same `'7'` / `'11'` strings.

**Playbook across variants.** `applyPlay` already skips an id the current
formation has no player for and reports it in `skipped`, so a play saved eleven
a side and called seven a side loses its tight end and says so. That is existing
behaviour, verified unchanged against this plan; no task needed.
