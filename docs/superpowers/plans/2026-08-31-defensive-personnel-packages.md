# Defensive Personnel Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coach sub the defense between three personnel packages — **stacked** (today's equal-lineman-count default), **nickel** (one lineman out, one linebacker in), and **dime** (one lineman out, one cornerback in) — from a menu button, on any down.

**Architecture:** Four new roster tables (one nickel/dime pair per team size) live in `lib/game/rosters.js` as *extra entries in the existing `ROSTERS` table*, keyed by compound ids (`'7-nickel'`, `'11-dime'`, …) built from the base variant id (`'7'`, `'11'`) plus a personnel suffix. This is a deliberate choice: `state.variantId` already drives every place a roster gets looked up — `formationPlayers`, `defaultSpots`, `nextDown`, `isEmptyPlay` — so teaching `rosters.js` a new *id shape* means every one of those call sites picks up personnel packages for free, with **zero changes** to `state.js`'s `formationPlayers`/`defaultSpots`, `rules.js`'s `nextDown`, or `play.js`. The only genuinely new runtime behavior is a **mid-down** swap (the coach clicking the menu button before the snap, after already dragging players around) — for that one case a fresh `formationPlayers()` call is wrong (it would reseat the *offense* back to its defaults too, discarding whatever the coach already dragged), so a new `setPersonnel` in `formation.js` rebuilds only the defense half of `state.players`.

**Tech Stack:** Vanilla JS (ES modules), Node's built-in `node:test` runner (`npm test`), a static `index.html` served by `python3 serve.py` (`npm run serve`, already registered as the `football-by-turn` launch config).

**Spec:** No separate spec document — this is a bounded feature fully scoped by the user's own request (menu item; three named packages; nickel = lineman→linebacker; dime = lineman→cornerback; counts matching real football's 4-lineman/11-man and 2-lineman/7-man sub packages) and by the brainstorming-skill design already agreed in chat before this plan was written.

## Global Constraints

- Every new roster entry must satisfy the codebase's existing invariants, proven by the generic sweeps in `test/game/rosters.test.js` that iterate `Object.keys(ROSTERS)`/`Object.values(ROSTERS)` — legality (`spotFault` is null for every player), unique ids, `defense.length === teamSize`, and — the hard one — `alignDefense(s)` reproduces each defender's own default spot exactly (the "aligning against a drive-start formation reproduces that variant's own defense" test). Because the new tables are added directly into `ROSTERS`, they are swept into all of these automatically — no new test code is required for those invariants, but the numbers below were derived by hand-tracing `alignDefense`'s actual pairing algorithm against the real offense tables (not guessed), specifically so that sweep passes on the first run.
- Don't touch `lib/game/defense.js`. `positionGroup`'s `GROUPS` table already maps `NT`/`DT`/`DE` → `'line'`, `LB` → `'backer'`, `CB`/`S`/`FS` → `'back'`, and every AI/alignment function in that file already derives its behavior from *how many* defenders are in each group, not from fixed role names or fixed roster shapes. A correctly-shaped new roster table needs nothing there to change.
- Don't touch `variants.js` or `home.js` — personnel is an in-game, per-down menu choice, not a home-screen game-size choice. The two are orthogonal (a 7-a-side or 11-a-side game each gets all three packages).
- Follow the file's own documentation convention throughout: comments explain *why* a number is what it is, not what the code obviously does (see the existing `ORDER MATTERS` comment at the top of `rosters.js` for the tone to match).

---

## Task 1: Personnel-package roster tables and id helpers

**Files:**
- Modify: `lib/game/rosters.js`
- Test: `test/game/rosters.test.js`

**Interfaces:**
- Produces: `PERSONNEL_PACKAGES` (`['stacked', 'nickel', 'dime']`), `personnelId(variantId) -> 'stacked'|'nickel'|'dime'`, `baseVariantId(variantId) -> string`, `variantWithPersonnel(variantId, personnel) -> string` — all exported from `lib/game/rosters.js`, all consumed by Task 3 (`formation.js`) and Task 4 (`app/main.js`).
- Produces: four new `ROSTERS` entries — `'7-nickel'`, `'7-dime'`, `'11-nickel'`, `'11-dime'` — each shaped exactly like the existing `'7'`/`'11'` entries (`{ id, teamSize, minOnLine, offense, defense }`).

- [ ] **Step 1: Write the failing tests**

Open `test/game/rosters.test.js`. Change the existing import block at the top from:

```js
import {
  ROSTERS, DEFAULT_VARIANT, getRoster, teamSize, minOnLine,
} from '../../lib/game/rosters.js';
```

to:

```js
import {
  ROSTERS, DEFAULT_VARIANT, getRoster, teamSize, minOnLine,
  PERSONNEL_PACKAGES, personnelId, baseVariantId, variantWithPersonnel,
} from '../../lib/game/rosters.js';
```

and change:

```js
import {
  backerLane, orderedMates, containRank, coverAssignments, deepMan,
} from '../../lib/game/defense.js';
```

to:

```js
import {
  backerLane, orderedMates, containRank, coverAssignments, deepMan, positionGroup,
} from '../../lib/game/defense.js';
```

Then append these tests at the end of the file:

```js
test('personnelId reads the package off a variant id, and baseVariantId strips it back off', () => {
  assert.equal(personnelId('7'), 'stacked');
  assert.equal(personnelId('11'), 'stacked');
  assert.equal(personnelId('7-nickel'), 'nickel');
  assert.equal(personnelId('11-dime'), 'dime');
  assert.equal(baseVariantId('7-nickel'), '7');
  assert.equal(baseVariantId('11-dime'), '11');
  assert.equal(baseVariantId('7'), '7');
});

test('variantWithPersonnel names the roster for any base and package, falling back to stacked', () => {
  assert.equal(variantWithPersonnel('7', 'nickel'), '7-nickel');
  assert.equal(variantWithPersonnel('7-nickel', 'dime'), '7-dime');
  assert.equal(variantWithPersonnel('11-dime', 'stacked'), '11');
  assert.equal(variantWithPersonnel('7', 'wishbone'), '7', 'an unknown package strands nobody');
});

test('PERSONNEL_PACKAGES names stacked first — that is what a fresh down is dealt', () => {
  assert.deepEqual(PERSONNEL_PACKAGES, ['stacked', 'nickel', 'dime']);
});

test('seven a side nickel fields two linemen and two backers, in exchange for one lineman', () => {
  const s = createGame({ seed: 1, variant: '7-nickel' });
  const d = s.players.filter((p) => p.team === 'defense');
  assert.equal(d.length, 7);
  assert.equal(d.filter((p) => positionGroup(p) === 'line').length, 2);
  assert.equal(d.filter((p) => positionGroup(p) === 'backer').length, 2);
  assert.equal(d.filter((p) => positionGroup(p) === 'back').length, 3);
});

test('seven a side dime fields two linemen and four backs, in exchange for one lineman', () => {
  const s = createGame({ seed: 1, variant: '7-dime' });
  const d = s.players.filter((p) => p.team === 'defense');
  assert.equal(d.length, 7);
  assert.equal(d.filter((p) => positionGroup(p) === 'line').length, 2);
  assert.equal(d.filter((p) => positionGroup(p) === 'backer').length, 1);
  assert.equal(d.filter((p) => positionGroup(p) === 'back').length, 4);
});

test('eleven a side nickel fields four linemen and three backers, in exchange for one lineman', () => {
  const s = createGame({ seed: 1, variant: '11-nickel' });
  const d = s.players.filter((p) => p.team === 'defense');
  assert.equal(d.length, 11);
  assert.equal(d.filter((p) => positionGroup(p) === 'line').length, 4);
  assert.equal(d.filter((p) => positionGroup(p) === 'backer').length, 3);
  assert.equal(d.filter((p) => positionGroup(p) === 'back').length, 4);
});

test('eleven a side dime fields four linemen and five backs, in exchange for one lineman', () => {
  const s = createGame({ seed: 1, variant: '11-dime' });
  const d = s.players.filter((p) => p.team === 'defense');
  assert.equal(d.length, 11);
  assert.equal(d.filter((p) => positionGroup(p) === 'line').length, 4);
  assert.equal(d.filter((p) => positionGroup(p) === 'backer').length, 2);
  assert.equal(d.filter((p) => positionGroup(p) === 'back').length, 5);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `personnelId`, `baseVariantId`, `variantWithPersonnel`, `PERSONNEL_PACKAGES` are not exported yet, and `'7-nickel'` etc. are not in `ROSTERS`, so `createGame({ variant: '7-nickel' })` falls back to the default `'7'` roster and the new count assertions fail.

- [ ] **Step 3: Add the four new roster tables**

In `lib/game/rosters.js`, immediately after the `SEVEN_DEFENSE` array (after its closing `];`, before the `ELEVEN_OFFENSE` comment block), insert:

```js
/**
 * Nickel: one lineman out, a second linebacker in. The line is the stacked
 * front's own first two entries — nose and left tackle — so the two men who
 * stay are standing exactly where they already were; only the third man
 * (d-dt2, the right tackle) is gone. The extra backer's lane follows
 * defense.js's own spacing formula for two backers (BACKER_LANE_UNITS either
 * side of the ball), the same math backerLane runs at kickoff — see the "two
 * backers split the box" test in this file for the eleven-a-side version of
 * the same spacing.
 */
const SEVEN_DEFENSE_NICKEL = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: -3, down: 4 },
  { id: 'd-lb2', role: 'LB', radius: RADIUS_MID, across: 3, down: 4 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];

/**
 * Dime: one lineman out, a third cornerback in. The line is the same two
 * survivors nickel keeps. The new corner is the third-widest defender the
 * alignment algorithm hands a man to once the front only covers the centre
 * and the left guard — it lands on the right guard, at the same depth every
 * corner plays (ALIGN_CORNER_YARDS), which is why he is standing over an
 * interior lineman rather than out on the numbers: alignDefense pairs
 * whoever is left in array order against whoever is left uncovered, widest
 * first, and by the third corner all that is left is the guard.
 */
const SEVEN_DEFENSE_DIME = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-cb3', role: 'CB', radius: RADIUS_SKILL, across: 2.5, down: 2 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: 0, down: 4 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];
```

Then, immediately after the `ELEVEN_DEFENSE` array (after its closing `];`, before `export const ROSTERS = {`), insert:

```js
/**
 * Eleven a side nickel: one lineman out (d-de2, the right end — the front's
 * last array entry), a third linebacker in. The surviving four linemen are
 * the stacked front's own first four entries, unmoved. Three backers split
 * BACKER_LANE_UNITS lanes evenly about the ball, the same formula
 * backerLane runs live — for three men that is a full lane either side of
 * the middle one, twice what two backers hold.
 */
const ELEVEN_DEFENSE_NICKEL = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-dt2', role: 'DT', radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: 'd-de1', role: 'DE', radius: RADIUS_LINE, across: -5, down: 1 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: -6, down: 4 },
  { id: 'd-lb2', role: 'LB', radius: RADIUS_MID, across: 0, down: 4 },
  { id: 'd-lb3', role: 'LB', radius: RADIUS_MID, across: 6, down: 4 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-fs', role: 'FS', radius: RADIUS_SKILL, across: -7.5, down: 2 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];

/**
 * Eleven a side dime: the same lineman out as nickel, a fourth defensive
 * back in instead of a third backer. The two backers are untouched from the
 * stacked front. The new back is the fourth man alignDefense's widest-first
 * pairing reaches once the corners and the flanker safety have theirs — he
 * lands over the tight end's side of the formation, at the corners' own
 * depth, mirroring the flanker safety (d-fs) on the opposite hash.
 */
const ELEVEN_DEFENSE_DIME = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-dt2', role: 'DT', radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: 'd-de1', role: 'DE', radius: RADIUS_LINE, across: -5, down: 1 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: -3, down: 4 },
  { id: 'd-lb2', role: 'LB', radius: RADIUS_MID, across: 3, down: 4 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-fs', role: 'FS', radius: RADIUS_SKILL, across: -7.5, down: 2 },
  { id: 'd-cb3', role: 'CB', radius: RADIUS_SKILL, across: 7.5, down: 2 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];
```

- [ ] **Step 4: Add the four new `ROSTERS` entries and the personnel-id helpers**

Replace the `export const ROSTERS = { ... };` block with:

```js
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
  '7-nickel': {
    id: '7-nickel', teamSize: 7, minOnLine: 5, offense: SEVEN_OFFENSE, defense: SEVEN_DEFENSE_NICKEL,
  },
  '7-dime': {
    id: '7-dime', teamSize: 7, minOnLine: 5, offense: SEVEN_OFFENSE, defense: SEVEN_DEFENSE_DIME,
  },
  11: {
    id: '11',
    teamSize: 11,
    // Real football, unrounded: seven of eleven on the line.
    minOnLine: 7,
    offense: ELEVEN_OFFENSE,
    defense: ELEVEN_DEFENSE,
  },
  '11-nickel': {
    id: '11-nickel', teamSize: 11, minOnLine: 7, offense: ELEVEN_OFFENSE, defense: ELEVEN_DEFENSE_NICKEL,
  },
  '11-dime': {
    id: '11-dime', teamSize: 11, minOnLine: 7, offense: ELEVEN_OFFENSE, defense: ELEVEN_DEFENSE_DIME,
  },
};
```

(Formation legality, the on-the-line count and `minOnLine` are judged on the *offense* only — see `formationFoul` in `formation.js` — so every one of these six entries reuses the same `minOnLine` as its base variant untouched: only the defense differs between `'7'`/`'7-nickel'`/`'7-dime'`, and between `'11'`/`'11-nickel'`/`'11-dime'`.)

Then, after the existing `minOnLine` function at the bottom of the file, add:

```js
/** The three packages a coach may sub the defense into, in cycle order. */
export const PERSONNEL_PACKAGES = ['stacked', 'nickel', 'dime'];

/**
 * Which package a variant id is currently carrying: the suffix after the
 * dash, or 'stacked' for a bare id like '7' or '11'. The inverse of
 * variantWithPersonnel, and what the personnel menu button reads to label
 * and cycle itself.
 */
export function personnelId(variantId) {
  const dash = String(variantId).indexOf('-');
  return dash === -1 ? 'stacked' : variantId.slice(dash + 1);
}

/** The bare variant id underneath any personnel suffix: '7-nickel' -> '7'. */
export function baseVariantId(variantId) {
  const dash = String(variantId).indexOf('-');
  return dash === -1 ? variantId : variantId.slice(0, dash);
}

/**
 * The variant id that fields `personnel` for whichever base game `variantId`
 * is already playing: '7-nickel' + 'dime' -> '7-dime', '11' + 'stacked' ->
 * '11'. Falls back to the bare base id if that combination has no roster —
 * the same "never hand back a name nothing was built for" rule getRoster
 * itself keeps — so an unrecognised package cannot strand the game on an id
 * nothing can look up.
 */
export function variantWithPersonnel(variantId, personnel) {
  const base = baseVariantId(variantId);
  const id = personnel === 'stacked' ? base : `${base}-${personnel}`;
  return ROSTERS[id] ? id : base;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all new tests, and the whole suite (the generic `ROSTERS`-driven sweeps in `rosters.test.js` now also exercise the four new entries; if any of them fail on legality or on "alignment reproduces the drive-start defense," re-check the affected table's `across`/`down` values against the comment explaining how they were derived, in that order: front pairs array-order against the offense's on-the-line men nearest-to-farthest from the ball; backers split evenly by `BACKER_LANE_UNITS`; backs pair array-order against the offense's widest-uncovered skill players).

- [ ] **Step 6: Commit**

```bash
git add lib/game/rosters.js test/game/rosters.test.js
git commit -m "feat: add nickel and dime defensive personnel packages"
```

---

## Task 2: Extract `defensePlayers` from `formationPlayers`

**Files:**
- Modify: `lib/game/state.js`
- Test: `test/game/state.test.js`

**Interfaces:**
- Consumes: `getRoster(variantId)`, `DEFAULT_VARIANT` (both already imported in `state.js` from `./rosters.js`); the private `makePlayer(spec, team, losYard)` already in this file.
- Produces: `defensePlayers(losYard, variantId = DEFAULT_VARIANT) -> Array<Player>` — the defense half of what `formationPlayers` builds, alone. Consumed by Task 3's `setPersonnel` in `formation.js`.

- [ ] **Step 1: Write the failing test**

In `test/game/state.test.js`, change the top import from:

```js
import {
  createGame, setPlan, clearAllPlans, setMode, getPlayer, ballPos, carrier,
  isControllable, setPass, clearPass, aimSnap, defaultSpots, SNAP_TARGET_ID,
} from '../../lib/game/state.js';
```

to:

```js
import {
  createGame, setPlan, clearAllPlans, setMode, getPlayer, ballPos, carrier,
  isControllable, setPass, clearPass, aimSnap, defaultSpots, defensePlayers, SNAP_TARGET_ID,
} from '../../lib/game/state.js';
```

Then append at the end of the file:

```js
test('defensePlayers builds just the defense half of a formation, at any spot', () => {
  const players = defensePlayers(20, '7');
  assert.equal(players.length, 7);
  assert.ok(players.every((p) => p.team === 'defense'));
  const nt = players.find((p) => p.id === 'd-nt');
  assert.deepEqual(nt.pos, fieldPos(0, 21), 'a yard on the defense side of the 20');
});

test('defensePlayers picks up a nickel or dime package exactly like formationPlayers would', () => {
  const players = defensePlayers(20, '7-nickel');
  assert.equal(players.length, 7);
  assert.deepEqual(players.map((p) => p.id).sort(),
    ['d-cb1', 'd-cb2', 'd-dt1', 'd-lb', 'd-lb2', 'd-nt', 'd-s']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `defensePlayers is not defined` (or a bundler/import error naming it) — `defensePlayers` is not exported from `state.js` yet.

- [ ] **Step 3: Extract `defensePlayers` and refactor `formationPlayers` to use it**

In `lib/game/state.js`, replace the existing `formationPlayers` function:

```js
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

with:

```js
/**
 * The defense half of formationPlayers, alone: what a personnel-package
 * change (formation.js's setPersonnel) rebuilds when the offense already has
 * its own drags on the board and a fresh formationPlayers() call would throw
 * them away by reseating both sides at once.
 */
export function defensePlayers(losYard, variantId = DEFAULT_VARIANT) {
  const roster = getRoster(variantId);
  if (roster.defense.length !== roster.teamSize) {
    throw new Error(`variant "${roster.id}" must have exactly ${roster.teamSize} players a side`);
  }
  return roster.defense.map((s) => makePlayer(s, 'defense', losYard));
}

/**
 * Both teams at the snap, built from the named variant's roster. rosters.js is
 * the only place a formation is written down; this is the only place one is
 * built.
 */
export function formationPlayers(losYard, variantId = DEFAULT_VARIANT) {
  const roster = getRoster(variantId);
  if (roster.offense.length !== roster.teamSize) {
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
    ...defensePlayers(losYard, variantId),
  ];
}
```

(The doc comment that used to sit directly above `formationPlayers` moves down with it — `defensePlayers` is inserted above, with its own comment, so nothing is left undocumented.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the two new tests, and the whole suite (this is a pure extraction; `formationPlayers`'s own behavior, including both its error-throwing paths, is unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/game/state.js test/game/state.test.js
git commit -m "refactor: extract defensePlayers from formationPlayers"
```

---

## Task 3: `setPersonnel` — swap the defense's package without disturbing the offense

**Files:**
- Modify: `lib/game/formation.js`
- Test: `test/game/formation.test.js`

**Interfaces:**
- Consumes: `defensePlayers(losYard, variantId)` (Task 2, from `./state.js`); `variantWithPersonnel(variantId, personnel)` (Task 1, from `./rosters.js`); `canReposition(state)` (already in this file).
- Produces: `setPersonnel(state, personnel) -> boolean` — exported from `lib/game/formation.js`. Consumed by Task 4's menu button in `app/main.js`.

- [ ] **Step 1: Write the failing tests**

In `test/game/formation.test.js`, change the top import from:

```js
import {
  spotFault, onTheLine, lineCount, formationFoul, alignDefense, canReposition, placePlayer,
  placeFormation,
} from '../../lib/game/formation.js';
```

to:

```js
import {
  spotFault, onTheLine, lineCount, formationFoul, alignDefense, canReposition, placePlayer,
  placeFormation, setPersonnel,
} from '../../lib/game/formation.js';
```

Then append at the end of the file:

```js
test('setPersonnel swaps the defense without disturbing the offense', () => {
  const s = createGame({ seed: 1, variant: '7' });
  const movedWr1 = fieldPos(-20, -3);
  assert.ok(placePlayer(s, 'o-wr1', movedWr1));

  assert.ok(setPersonnel(s, 'nickel'));
  assert.equal(s.variantId, '7-nickel');
  assert.deepEqual(getPlayer(s, 'o-wr1').pos, movedWr1,
    'the offense stayed exactly where the coach put it');

  const ids = s.players.filter((p) => p.team === 'defense').map((p) => p.id).sort();
  assert.deepEqual(ids, ['d-cb1', 'd-cb2', 'd-dt1', 'd-lb', 'd-lb2', 'd-nt', 'd-s']);
  assert.equal(s.players.length, 14, 'still seven a side, both teams');
});

test('setPersonnel is refused once the play is under way', () => {
  const s = createGame({ seed: 1, variant: '7' });
  s.turnIndex = 1;
  const before = s.players.map((p) => p.id);
  assert.equal(setPersonnel(s, 'nickel'), false);
  assert.equal(s.variantId, '7');
  assert.deepEqual(s.players.map((p) => p.id), before);
});

test('setPersonnel cycles through stacked, nickel and dime and back', () => {
  const s = createGame({ seed: 1, variant: '11' });
  assert.ok(setPersonnel(s, 'nickel'));
  assert.equal(s.variantId, '11-nickel');
  assert.ok(setPersonnel(s, 'dime'));
  assert.equal(s.variantId, '11-dime');
  assert.ok(setPersonnel(s, 'stacked'));
  assert.equal(s.variantId, '11');
});

test('an unrecognised personnel package falls back to stacked rather than stranding the game', () => {
  const s = createGame({ seed: 1, variant: '7' });
  assert.ok(setPersonnel(s, 'wishbone'));
  assert.equal(s.variantId, '7');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `setPersonnel` is not exported from `formation.js` yet.

- [ ] **Step 3: Implement `setPersonnel`**

In `lib/game/formation.js`, change the two import lines at the top from:

```js
import {
  defendDir, losY, positionGroup, deepMan, backerLane,
} from './defense.js';
import { getPlayer, ballPos, aimSnap } from './state.js';
```

to:

```js
import {
  defendDir, losY, positionGroup, deepMan, backerLane,
} from './defense.js';
import {
  getPlayer, ballPos, aimSnap, defensePlayers,
} from './state.js';
import { variantWithPersonnel } from './rosters.js';
```

Then, immediately after `placeFormation`'s closing `}` (and before the `onTheLine` doc comment), insert:

```js
/**
 * Swap the defense onto a different personnel package — stacked, nickel, or
 * dime — for whatever down is currently being planned. Only the defense is
 * rebuilt: the offense keeps every spot the coach has already dragged it to,
 * which a fresh formationPlayers() call would otherwise throw away, because
 * that function reseats both sides from their roster defaults at once.
 *
 * Gated the same way placePlayer is, and for the same reason: personnel is
 * something you come to the line with, not something you change once the
 * ball is live.
 */
export function setPersonnel(state, personnel) {
  if (!canReposition(state)) return false;
  const variantId = variantWithPersonnel(state.variantId, personnel);
  state.variantId = variantId;
  state.players = [
    ...state.players.filter((p) => p.team === 'offense'),
    ...defensePlayers(state.losYard, variantId),
  ];
  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all four new tests, and the whole suite.

- [ ] **Step 5: Commit**

```bash
git add lib/game/formation.js test/game/formation.test.js
git commit -m "feat: setPersonnel swaps the defense mid-down without disturbing the offense"
```

---

## Task 4: The Personnel menu button

**Files:**
- Modify: `index.html`
- Modify: `app/main.js`

**Interfaces:**
- Consumes: `setPersonnel` (Task 3, from `../lib/game/formation.js`); `PERSONNEL_PACKAGES`, `personnelId` (Task 1, from `../lib/game/rosters.js`); `canReposition` (already imported in `app/main.js` from `formation.js`); the existing private `realignDefense()` and `say()` helpers already in `app/main.js`.
- Produces: a `#personnel` button in the Coaches Menu that cycles the defense through stacked → nickel → dime → stacked, mirroring exactly how the existing `#ai` (Defense: computer …) and `#reposition` buttons are wired — no new exports; this is the last consumer in the chain.

There is no dedicated test file for this task. `app/main.js` is UI glue with no DOM test harness in this project (the existing `#ai`/`#reposition` buttons have no unit tests of their own either — `ai.test.js` tests the pure `AI_MODES`/`aiModeIndex`/`nextAiMode` functions the button calls, which is exactly what Tasks 1 and 3 already did for this feature). Verification here is running the app in a browser (Step 4 below), matching this project's own convention for UI changes.

- [ ] **Step 1: Add the button to the menu**

In `index.html`, find:

```html
      <button id="reposition">Reposition: off</button>
```

and add a new line directly after it:

```html
      <button id="reposition">Reposition: off</button>
      <button id="personnel">Personnel: stacked</button>
```

- [ ] **Step 2: Wire the button in `app/main.js`**

Change the import:

```js
import {
  canReposition, placePlayer, spotFault, alignDefense, lineCount,
} from '../lib/game/formation.js';
```

to:

```js
import {
  canReposition, placePlayer, spotFault, alignDefense, lineCount, setPersonnel,
} from '../lib/game/formation.js';
```

Change the import:

```js
import { minOnLine, DEFAULT_VARIANT } from '../lib/game/rosters.js';
```

to:

```js
import {
  minOnLine, DEFAULT_VARIANT, PERSONNEL_PACKAGES, personnelId,
} from '../lib/game/rosters.js';
```

Add a DOM reference right after the existing `repositionBtn` line:

```js
const repositionBtn = document.getElementById('reposition');
const personnelBtn = document.getElementById('personnel');
```

In `paint()`, right after the two existing `repositionBtn` lines:

```js
  repositionBtn.textContent = `Reposition: ${repositioning ? 'on' : 'off'}`;
  repositionBtn.disabled = animating || !canReposition(state);
```

add:

```js
  personnelBtn.textContent = `Personnel: ${personnelId(state.variantId)}`;
  personnelBtn.disabled = animating || !canReposition(state);
```

In the animating-lockout block (where `repositionBtn.disabled = true;` is set alongside `aiBtn.disabled = true;` while a turn animates), add the matching line:

```js
    aiBtn.disabled = true;
    repositionBtn.disabled = true;
    personnelBtn.disabled = true;
    debugBtn.disabled = true;
```

Finally, right after the existing `aiBtn.addEventListener('click', ...)` block, add the new handler:

```js
personnelBtn.addEventListener('click', () => {
  closeMenu();
  if (animating || !canReposition(state)) return;
  const order = PERSONNEL_PACKAGES;
  const next = order[(order.indexOf(personnelId(state.variantId)) + 1) % order.length];
  if (!setPersonnel(state, next)) return;
  // A new package means new bodies on the field — realign them the same way
  // a drag during reposition mode does, and for the same reason: only when
  // the computer is coaching the defense, so a human coach's own drags are
  // never overwritten.
  realignDefense();
  pendingWarning = false;
  say(`Personnel: ${next}.`);
  paint();
});
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — this task touches no exported library function, so nothing here should change the count from Task 3's final run; this just confirms the edit didn't break an import path.

- [ ] **Step 4: Verify in the browser**

Start the dev server:

```bash
npm run serve
```

Open `http://localhost:8080` (or use the project's `football-by-turn` launch config / preview tooling). Then:

1. Open the Coaches Menu. Confirm a `Personnel: stacked` button appears below `Reposition: off`.
2. Click it. Confirm the label changes to `Personnel: nickel`, the menu closes, and the message line reads "Personnel: nickel." Turn on Reposition (or just look at the field) and confirm the defense now shows two down linemen and two off-ball linebackers instead of three linemen and one.
3. Click it twice more. Confirm it reads `Personnel: dime` (two linemen, four defensive backs), then cycles back to `Personnel: stacked` (the original three-lineman look).
4. Press Run Turn once. Confirm the `Personnel` button is now disabled (greyed out) — personnel can't be changed once the ball is live, exactly like the Reposition button.
5. Press Next Down (or New Game). Confirm the button re-enables and whichever package was last selected is still showing (New Game instead resets to `Personnel: stacked`, since it deals an entirely fresh game the same way it already resets `Defense: computer (smart)` on every new game).

If any step doesn't match, re-check the corresponding `paint()`/click-handler edit from Step 2 before touching the library code from Tasks 1–3 — the library-level behavior is already covered by the automated tests that passed in Task 3.

- [ ] **Step 5: Commit**

```bash
git add index.html app/main.js
git commit -m "feat: add a Personnel menu button to sub the defense pre-snap"
```
