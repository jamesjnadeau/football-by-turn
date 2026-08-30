# Saved Plays Remember Where Everyone Lined Up — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A play saved from the Coaches Menu brings back the *formation* it was saved from, not just the arrows drawn on it. Calling the play from a later down puts every man the coach dragged pre-snap back on the spot he was dragged to — relative to that down's line of scrimmage — and only then puts the arrows, stances and throw back on top.

**Architecture:** Three separable pieces, in the layer each already owns.

1. `lib/game/formation.js` — the pre-snap rulebook and the only writer of `p.pos` — gains a **batch** placer, `placeFormation(state, spots)`. `placePlayer` cannot do this job: it judges each spot against where everybody is standing *right now*, so a saved formation in which two men swapped places refuses both of them. The batch placer judges the arrangement as a whole and reports which men it could not seat.
2. `lib/game/play.js` — which knows what a play IS — grows a fourth field, `spots`, alongside `plans`, `stances` and `pass`. It is stored the way `state.js`'s own formation table is stored: **yards across from the middle of the field, and yards from the line of scrimmage**, never SVG units, so a play saved on the 25 lines up correctly on the 40.
3. `lib/game/playbook.js` — the storage format — goes to version 2, and reads version 1 as a play with no formation in it, which is exactly what a version-1 play is.

`app/main.js` changes only where the menu speaks: a called play now re-aligns a computer-coached defense against the look it just produced, and says how the formation reads.

**Tech Stack:** Vanilla ES modules, no build step, `node --test` for everything under `lib/`, a manual browser pass for `app/`.

**Spec:** this document. The request verbatim:

> the current coaches menu ability to save plays doesn't save the starting position of the players, please write a plan ... to fix this

## Decisions (made while planning — change them only with a reason)

1. **Coordinates are LOS-relative, in yards.** `{ across, down }`, the same pair `state.js`'s `OFFENSE`/`DEFENSE` tables use (`across` = yards right of centre, negative left; `down` = yards downfield of the LOS, negative behind it). Absolute SVG units would pin a play to the yard line it was saved on, which is the one thing a saved play must not be.
2. **Every one of the coach's players is saved, not just the ones he moved.** A play is the whole picture you come to the line with. It also means calling a play *replaces* the formation — a receiver left split wide by the previous call comes back in — which is the same promise `applyPlay` already makes about arrows.
3. **"Nothing to save yet" now counts a moved man.** Because of decision 2 every play carries fourteen (or seven) spots, so `isEmptyPlay` cannot just count them. It compares them against the drive-start formation: a play with no arrows, no stances, no throw and everyone standing where the down put them is still empty.
4. **A spot that cannot be seated is a skip, not a failure.** Same rule the rest of `applyPlay` already follows: an id this game has no player for, a spot past this down's line, a spot off the field, a spot another man is already standing on — that man stays where he is and comes back in `skipped`. Half a formation is a disappointment; a NaN in a position is a broken game.
5. **Storage version goes to 2, and version 1 still loads.** A version-1 play has no formation and calls exactly as it does today. Losing a coach's five plays to a format bump would be a worse bug than the one this plan fixes.
6. **Only the human's team.** `capturePlay` already skips `state.aiTeam`; spots follow the same filter, so a play saved in hot-seat carries both teams and skips the defense once the computer is coaching it — the behaviour `test/game/play.test.js` already asserts for arrows.

## Global Constraints

- **`lib/` stays DOM-free and pure of storage.** Tests are `node --test`; run everything with `npm test`. Anything in `app/` or `index.html` is verified by hand in the browser, per Task 5.
- **`formation.js` is the only file that writes `p.pos` pre-snap.** `play.js` must not assign a position itself — it converts its stored yards to field units and hands them over.
- Football coordinates → units go through `fieldPos(across, downYards)` (`lib/game/view.js`); units → football coordinates go through `xToYards` (`lib/field/geometry.js`) and `yardsOfY` (`lib/game/view.js`). Do not re-derive either with a copy of `UNITS_PER_YARD_X`.
- Moving a man drops the order he was given — his `plan` and his `cover` — and re-aims the snap (`aimSnap`). That rule lives in `placePlayer` today; the batch placer must keep it, or a loaded formation would carry arrows drawn from the spots the men used to occupy.
- Numbers coming out of storage go through `sanitizePlay`, and a play with any bad number in it is dropped **whole**. Extend that guarantee to `spots`; do not weaken it for the new field.
- An illegal formation is allowed to be loaded. `formationFoul` flags it at the snap, exactly as it does when the coach drags himself into one; do not refuse the call.
- Every commit step stages **named paths only — never `git add -A`**.

## Sequencing — read this before starting

**Baseline:** branch `claude/coaches-play-save-positions-5af266` at `805074e` ("Start every down with the snap"), clean tree apart from this plan file, `npm test` **329 passing**.

Task 1 (the batch placer) and Task 3 (the storage version) are independent. Task 2 depends on Task 1. Task 4 depends on Task 2. Task 5 depends on everything.

## Reference — what is true today

| fact | where |
|---|---|
| A down puts everyone back in the drive-start formation: `state.players = formationPlayers(spot)` | `lib/game/rules.js`, `nextDown` |
| That formation is LOS-relative already: `pos: fieldPos(spec.across, losYard + spec.down)` | `lib/game/state.js`, `makePlayer` |
| Repositioning and plays share a gate: first turn of a down, planning phase | `formation.js` `canReposition`, `play.js` `canUsePlays` |
| A single move is refused for four reasons: `past-line`, `out-of-bounds`, `outside-hashes` (the man with the ball only), `occupied` | `formation.js` `spotFault` |
| A play carries `{ name, plans, stances, pass }` | `lib/game/play.js` `capturePlay` |
| The computer's defense re-aligns after every drag the coach makes | `app/main.js` `realignDefense` — **not** after a called play, which is the second half of this bug |

## File Structure

- `lib/game/state.js` — **modify**: export `defaultSpots()`, the `{ id: { across, down } }` map behind `OFFENSE`/`DEFENSE`. One new export; the tables themselves do not move.
- `lib/game/formation.js` — **modify**: new exported `placeFormation(state, spots)`.
- `lib/game/play.js` — **modify**: `capturePlay` records `spots`; `applyPlay` seats them first; `isEmptyPlay` measures them against the default; `sanitizePlay` validates them.
- `lib/game/playbook.js` — **modify**: `PLAYBOOK_VERSION` 1 → 2, with version 1 still readable.
- `app/main.js` — **modify**: `callPlay` re-aligns the computer's defense and says how the formation reads; the "nothing to save" line stops saying arrows are the only thing worth saving.
- `test/game/formation.test.js` — **modify**: the batch placer.
- `test/game/play.test.js` — **modify**: capture, apply, empty, sanitise.
- `test/game/playbook.test.js` — **modify**: version 2 round-trip, version 1 compatibility.
- `test/game/state.test.js` — **modify**: `defaultSpots` agrees with `formationPlayers`.
- `README.md` — **modify**: the playbook paragraph says formations are saved.

---

## Task 1: A formation can be seated all at once

`placePlayer` moves one man and judges him against everyone standing on the field. That is right for a drag and wrong for a saved formation: two men who swapped spots each land on the other, and both moves are refused, so the play loads with the formation it was saved from nowhere in sight.

`placeFormation` judges the **arrangement**. Each requested man is checked against the layout as it will actually end up: the men already accepted in their new spots, and the men who are not moving (or whose move was refused) where they stand.

**Files:**
- Modify: `lib/game/formation.js`
- Test: `test/game/formation.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `placeFormation(state, spots) -> { applied: string[], skipped: string[] }`, where `spots` is `[{ id, pos }]` with `pos` in SVG units. Off the reposition gate every id comes back skipped. Unknown ids are skipped. Accepted men have `plan` and `cover` cleared; `aimSnap` runs once at the end, not once per man.

- [ ] **Step 1: Write the failing tests**

Append to `test/game/formation.test.js`:

```js
test('a whole formation is seated in one call', () => {
  const s = createGame({ seed: 1 });
  const { applied, skipped } = placeFormation(s, [
    { id: 'o-wr1', pos: fieldPos(-22, -1) },
    { id: 'o-wr2', pos: fieldPos(22, -1) },
  ]);
  assert.deepEqual(applied.sort(), ['o-wr1', 'o-wr2']);
  assert.deepEqual(skipped, []);
  assert.equal(Math.round(yardsOfY(getPlayer(s, 'o-wr1').pos.y)), -1);
});

test('two men may swap spots, which one-at-a-time placement cannot do', () => {
  const s = createGame({ seed: 1 });
  const rb = { ...getPlayer(s, 'o-rb').pos };
  const qb = { ...getPlayer(s, 'o-qb').pos };
  const { applied, skipped } = placeFormation(s, [
    { id: 'o-rb', pos: qb },
    { id: 'o-qb', pos: rb },
  ]);
  assert.deepEqual(applied.sort(), ['o-qb', 'o-rb']);
  assert.deepEqual(skipped, []);
  assert.deepEqual(getPlayer(s, 'o-rb').pos, qb);
  assert.deepEqual(getPlayer(s, 'o-qb').pos, rb);
});

test('an impossible spot is skipped and the rest of the formation still seats', () => {
  const s = createGame({ seed: 1 });
  const where = { ...getPlayer(s, 'o-wr2').pos };
  const { applied, skipped } = placeFormation(s, [
    { id: 'o-wr1', pos: fieldPos(-22, -1) },   // fine
    { id: 'o-wr2', pos: fieldPos(0, 5) },      // past the line
    { id: 'nobody', pos: fieldPos(0, -3) },    // no such player
  ]);
  assert.deepEqual(applied, ['o-wr1']);
  assert.deepEqual(skipped.sort(), ['nobody', 'o-wr2']);
  assert.deepEqual(getPlayer(s, 'o-wr2').pos, where);
});

test('a man who could not be moved is still in the way of the men who follow', () => {
  const s = createGame({ seed: 1 });
  const rb = { ...getPlayer(s, 'o-rb').pos };
  const { applied, skipped } = placeFormation(s, [
    { id: 'o-rb', pos: fieldPos(0, 5) },  // refused: past the line, so he stays put
    { id: 'o-wr1', pos: rb },             // and his old spot is therefore occupied
  ]);
  assert.deepEqual(applied, []);
  assert.deepEqual(skipped.sort(), ['o-rb', 'o-wr1']);
});

test('seating a formation drops the orders the old spots were drawn from', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-wr1', { x: 1, y: 0 }, 1);
  placeFormation(s, [{ id: 'o-wr1', pos: fieldPos(-22, -1) }]);
  assert.equal(getPlayer(s, 'o-wr1').plan, null);
});

test('nobody is seated once the ball is in the air', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 1;
  const where = { ...getPlayer(s, 'o-wr1').pos };
  const { applied, skipped } = placeFormation(s, [{ id: 'o-wr1', pos: fieldPos(-22, -1) }]);
  assert.deepEqual(applied, []);
  assert.deepEqual(skipped, ['o-wr1']);
  assert.deepEqual(getPlayer(s, 'o-wr1').pos, where);
});
```

Add `placeFormation` to the import at the top of the file. Run `npm test` and watch them fail on the missing export.

- [ ] **Step 2: Write `placeFormation`**

In `lib/game/formation.js`, below `placePlayer`:

```js
/**
 * Seat a whole formation at once, and say who could not be seated.
 *
 * `placePlayer` judges one man against the field as it stands, which is right
 * for a drag and wrong for a saved formation: two men who swapped spots would
 * each land on the other and both moves would be refused. This judges the
 * ARRANGEMENT — every candidate against where everyone will actually end up —
 * so a permutation seats, and only a spot that is genuinely impossible skips.
 *
 * Requests are taken in order, and a man whose spot was refused stays where he
 * is and is back in the way of the men behind him. That is what makes one pass
 * enough: no accepted spot is ever invalidated by a later decision, so the
 * layout this returns never has two men standing inside each other.
 */
export function placeFormation(state, spots) {
  const applied = [];
  const skipped = [];
  if (!canReposition(state)) return { applied, skipped: spots.map((s) => s.id) };

  // The layout being judged against: everyone's position as it will stand.
  // A man about to move is taken out of it, and goes back in — at his new spot
  // or his old one — the moment his request is decided.
  const moving = new Set(spots.map((s) => s.id));
  const layout = state.players
    .filter((p) => !moving.has(p.id))
    .map((p) => ({ id: p.id, radius: p.radius, pos: p.pos }));

  for (const { id, pos } of spots) {
    const p = state.players.find((pl) => pl.id === id);
    if (!p) { skipped.push(id); continue; }
    const fault = spotFaultAmong(state, p, pos, layout);
    if (fault !== null) {
      skipped.push(id);
      layout.push({ id: p.id, radius: p.radius, pos: p.pos }); // he stays, and is in the way
      continue;
    }
    p.pos = pos;
    // The order he was given was worked out from where he was standing, so it
    // is a lie now — the same rule placePlayer keeps for a single drag.
    p.plan = null;
    p.cover = null;
    layout.push({ id: p.id, radius: p.radius, pos });
    applied.push(id);
  }
  // Once, at the end: the snap is aimed off two men who may both have moved.
  aimSnap(state);
  return { applied, skipped };
}
```

`spotFault` reads `state.players` for its occupancy check, which is the one thing that must come from the layout instead. Split it so both callers share every rule and differ only in who they look at:

```js
export function spotFault(state, id, pos) {
  const player = getPlayer(state, id);
  const others = state.players.filter((p) => p.id !== id);
  return spotFaultAmong(state, player, pos, others);
}

/** The same judgement, against a given set of bodies rather than the field. */
function spotFaultAmong(state, player, pos, others) {
  // ... the existing past-line / out-of-bounds / outside-hashes checks, on
  // `player` instead of the looked-up one ...
  for (const other of others) {
    if (other.id === player.id) continue;
    if (dist(other.pos, pos) < other.radius + player.radius) return 'occupied';
  }
  return null;
}
```

`spotFault`'s signature and behaviour do not change — `app/main.js` and the existing tests call it exactly as before.

- [ ] **Step 3: Run the suite**

`npm test` — 329 + 6 new, all passing. Nothing else in `lib/` should move.

- [ ] **Step 4: Commit**

```
git add lib/game/formation.js test/game/formation.test.js
git commit -m "Seat a whole formation in one judged pass"
```

---

## Task 2: A play carries the formation it was saved from

**Files:**
- Modify: `lib/game/state.js` (one new export), `lib/game/play.js`
- Test: `test/game/state.test.js`, `test/game/play.test.js`

**Interfaces:**
- Consumes: `placeFormation` from Task 1.
- Produces:
  - `defaultSpots() -> { [id]: { across, down } }` from `state.js` — the drive-start formation as yards, for every player on both teams.
  - A play is now `{ name, plans, stances, pass, spots }`, `spots` being `{ [id]: { across, down } }` in the same units.
  - `applyPlay` seats `spots` **before** it hands out plans and stances, and folds unseated ids into `skipped`.
  - `isEmptyPlay(play)` is true only when the arrows, stances and throw are all absent **and** every spot matches `defaultSpots()`.
  - `sanitizePlay` accepts a play with no `spots` (a version-1 play) as one with `spots: {}`.

- [ ] **Step 1: Write the failing tests**

In `test/game/state.test.js`:

```js
test('the default spots are the formation every down opens in', () => {
  const s = createGame({ seed: 1 });
  const spots = defaultSpots();
  assert.equal(Object.keys(spots).length, s.players.length);
  for (const p of s.players) {
    const { across, down } = spots[p.id];
    assert.deepEqual(p.pos, fieldPos(across, s.losYard + down));
  }
});
```

In `test/game/play.test.js`:

```js
test('capturing takes where every one of the coach\'s men is standing', () => {
  const state = drawn();
  getPlayer(state, 'o-wr1').pos = fieldPos(-22, -1);
  const play = capturePlay(state, 'Trips');
  assert.equal(Object.keys(play.spots).length, 7);          // his team only
  assert.deepEqual(play.spots['o-wr1'], { across: -22, down: -1 });
  assert.equal('d-cb1' in play.spots, false);
});

test('a spot is saved off the line of scrimmage, not off the yard line', () => {
  const state = drawn();
  state.losYard = 6;
  getPlayer(state, 'o-wr1').pos = fieldPos(-22, 6 - 1);
  assert.deepEqual(capturePlay(state, 'Trips').spots['o-wr1'], { across: -22, down: -1 });
});

test('a play that only moves a man is not empty', () => {
  const state = afterSnap(createGame({ ai: 'defense' }));
  assert.equal(isEmptyPlay(capturePlay(state, '')), true);
  getPlayer(state, 'o-wr1').pos = fieldPos(-22, -1);
  assert.equal(isEmptyPlay(capturePlay(state, '')), false);
});

test('calling a play lines the formation back up on this down\'s line', () => {
  const from = drawn();
  getPlayer(from, 'o-wr1').pos = fieldPos(-22, -1);
  const play = capturePlay(from, 'Trips');

  const to = afterSnap(createGame({ ai: 'defense' }));
  to.losYard = 6;
  to.players = formationPlayers(6);
  applyPlay(to, play);
  assert.deepEqual(getPlayer(to, 'o-wr1').pos, fieldPos(-22, 5));
});

test('calling a play puts back a man the previous call had moved', () => {
  const state = afterSnap(createGame({ ai: 'defense' }));
  const home = { ...getPlayer(state, 'o-wr1').pos };
  const plain = capturePlay(state, 'Base');
  getPlayer(state, 'o-wr1').pos = fieldPos(-22, -1);
  applyPlay(state, plain);
  assert.deepEqual(getPlayer(state, 'o-wr1').pos, home);
});

test('the arrows are given after the men are seated, not before', () => {
  const from = drawn();
  getPlayer(from, 'o-wr1').pos = fieldPos(-22, -1);
  setPlan(from, 'o-wr1', { x: 0, y: 1 }, 1);
  const state = afterSnap(createGame({ ai: 'defense' }));
  applyPlay(state, capturePlay(from, 'Trips'));
  // Seating a man clears his plan; if that ran second the arrow would be gone.
  assert.deepEqual(getPlayer(state, 'o-wr1').plan.dir, { x: 0, y: 1 });
  assert.deepEqual(getPlayer(state, 'o-wr1').pos, fieldPos(-22, -1));
});

test('a spot this down has no room for is skipped, and the play still loads', () => {
  const from = drawn();
  const play = capturePlay(from, 'Deep');
  play.spots['o-wr1'] = { across: 0, down: 4 };  // past the line
  const state = afterSnap(createGame({ ai: 'defense' }));
  const home = { ...getPlayer(state, 'o-wr1').pos };
  const { skipped } = applyPlay(state, play);
  assert.equal(skipped.includes('o-wr1'), true);
  assert.deepEqual(getPlayer(state, 'o-wr1').pos, home);
});

test('a play saved in hot-seat does not move the computer\'s defense', () => {
  const hotseat = afterSnap(createGame({ seed: 1 }));   // aiTeam null: both teams are his
  getPlayer(hotseat, 'd-cb1').pos = fieldPos(-22, 2);
  const play = capturePlay(hotseat, 'Both');
  assert.equal('d-cb1' in play.spots, true);

  const state = afterSnap(createGame({ ai: 'defense' }));
  const home = { ...getPlayer(state, 'd-cb1').pos };
  const { skipped } = applyPlay(state, play);
  assert.deepEqual(getPlayer(state, 'd-cb1').pos, home);
  assert.equal(skipped.includes('d-cb1'), true);
});

test('a version-1 play — no spots at all — loads its arrows and moves nobody', () => {
  const state = drawn();
  getPlayer(state, 'o-wr1').pos = fieldPos(-22, -1);
  const where = { ...getPlayer(state, 'o-wr1').pos };
  applyPlay(state, sanitizePlay({ ...goodPlay() }));   // goodPlay has no `spots`
  assert.deepEqual(getPlayer(state, 'o-wr1').pos, where);
});

test('sanitising rejects a play with a NaN in a spot', () => {
  assert.equal(sanitizePlay({ ...goodPlay(), spots: { 'o-wr1': { across: NaN, down: -1 } } }), null);
  assert.equal(sanitizePlay({ ...goodPlay(), spots: { 'o-wr1': { down: -1 } } }), null);
  assert.equal(sanitizePlay({ ...goodPlay(), spots: 7 }), null);
});

test('sanitising refuses a __proto__ spot', () => {
  const raw = { ...goodPlay(), spots: {} };
  Object.defineProperty(raw.spots, '__proto__', { value: { across: 0, down: 0 }, enumerable: true });
  assert.equal(sanitizePlay(raw), null);
});
```

Import `formationPlayers` and `fieldPos` in `test/game/play.test.js` as needed.

- [ ] **Step 2: Export the default formation from `state.js`**

```js
/**
 * The drive-start formation as football coordinates, by id — what
 * `formationPlayers` builds every down out of, before anybody drags anyone.
 * Exported because play.js has to be able to tell a formation the coach SET
 * from the one the down handed him: a play with nothing in it but the spots
 * everyone already occupies is an empty play.
 */
export function defaultSpots() {
  const out = {};
  for (const s of [...OFFENSE, ...DEFENSE]) out[s.id] = { across: s.across, down: s.down };
  return out;
}
```

- [ ] **Step 3: Teach `play.js` the fourth field**

New imports at the top of `play.js`: `placeFormation` from `./formation.js`, `defaultSpots` from `./state.js`, `fieldPos` and `yardsOfY` from `./view.js`, `xToYards` from `../field/geometry.js`. No cycle: `formation.js` imports `state.js` and neither imports `play.js`.

`capturePlay` — inside the loop that already skips `state.aiTeam`:

```js
    // Where he is lining up, as yards from the middle of the field and yards
    // from the line of scrimmage — never SVG units. A play saved on the 25 is
    // called on the 40, and the picture has to be the same picture.
    spots[p.id] = {
      across: xToYards(p.pos.x),
      down: yardsOfY(p.pos.y) - state.losYard,
    };
```

and return `spots` with the rest. `isEmptyPlay`:

```js
/** Within a rounding error of the same spot — a float round-trip, not a nudge. */
const SPOT_EPS = 1e-6;

function movedAnyone(spots) {
  const home = defaultSpots();
  return Object.entries(spots).some(([id, s]) => {
    const d = home[id];
    return !d || Math.abs(s.across - d.across) > SPOT_EPS || Math.abs(s.down - d.down) > SPOT_EPS;
  });
}

export function isEmptyPlay(play) {
  return Object.keys(play.plans).length === 0
    && Object.keys(play.stances).length === 0
    && play.pass === null
    && !movedAnyone(play.spots);
}
```

`applyPlay` — after the clear loop and `clearPass(state)`, **before** the plans go on:

```js
  // The formation first. Seating a man drops the order he was holding, so
  // arrows given before this would be wiped by it — and an arrow drawn from
  // the spot he is only now arriving at would have been drawn from the wrong
  // place anyway.
  const wanted = [];
  for (const [id, spot] of Object.entries(play.spots)) {
    if (!mine(id)) { skipped.add(id); continue; }
    wanted.push({ id, pos: fieldPos(spot.across, state.losYard + spot.down) });
  }
  const seated = placeFormation(state, wanted);
  for (const id of seated.skipped) skipped.add(id);
```

Do **not** add seated ids to `applied`: that count is the orders given, and standing where you were told to stand is not one. (State this in the comment so it does not get "fixed" later.)

`sanitizePlay` — after the stances block:

```js
  const spots = {};
  // Absent is not corrupt: a play saved before formations were part of one has
  // no spots, and loads as the arrows it is.
  const rawSpots = raw.spots ?? {};
  if (typeof rawSpots !== 'object' || Array.isArray(rawSpots)) return null;
  for (const [id, spot] of Object.entries(rawSpots)) {
    if (id === '__proto__') return null;
    if (!spot || typeof spot !== 'object') return null;
    const across = finite(spot.across);
    const down = finite(spot.down);
    if (across === null || down === null) return null;
    spots[id] = { across, down };
  }
```

and return it. Nothing here clamps a spot to the field: `placeFormation` is what judges a spot, and it judges it against the down it is actually being called on.

- [ ] **Step 4: Run the suite**

`npm test`. Every existing play test must still pass — several build plays by hand without a `spots` key, which is exactly the version-1 path, so a failure there means the `?? {}` default is missing somewhere.

- [ ] **Step 5: Commit**

```
git add lib/game/state.js lib/game/play.js test/game/state.test.js test/game/play.test.js
git commit -m "Save the formation a play was called from"
```

---

## Task 3: The storage format goes to version 2

**Files:**
- Modify: `lib/game/playbook.js`
- Test: `test/game/playbook.test.js`

**Interfaces:**
- Consumes: `sanitizePlay`'s tolerance of a missing `spots` (Task 2).
- Produces: `PLAYBOOK_VERSION === 2`; `serializePlaybook` writes `v: 2`; `parsePlaybook` reads `v: 1` and `v: 2` and nothing else.

- [ ] **Step 1: Write the failing tests**

```js
test('a version-1 book still loads, as plays with no formation in them', () => {
  const old = JSON.stringify({ v: 1, slots: [{ name: 'Sweep', plans: {}, stances: {}, pass: null }, null, null, null, null] });
  const book = parsePlaybook(old);
  assert.equal(book[0].name, 'Sweep');
  assert.deepEqual(book[0].spots, {});
});

test('a book written today says version 2', () => {
  assert.equal(JSON.parse(serializePlaybook(emptyPlaybook())).v, 2);
});

test('a version this build has never heard of is still an empty book', () => {
  assert.deepEqual(parsePlaybook(JSON.stringify({ v: 3, slots: [] })), emptyPlaybook());
});
```

- [ ] **Step 2: Make the change**

```js
export const PLAYBOOK_VERSION = 2;

/** Versions this build can read. Writing is always the current one. */
const READABLE = new Set([1, 2]);
```

and in `parsePlaybook`, `if (!READABLE.has(raw.v) || !Array.isArray(raw.slots)) return out;`. Extend the file's header comment to say why version 1 survives: a coach's five plays outlive a format change, and a version-1 play is not a corrupt play — it is a play with no formation, which `sanitizePlay` already knows how to read.

- [ ] **Step 3: Run the suite, then commit**

```
git add lib/game/playbook.js test/game/playbook.test.js
git commit -m "Playbook version 2, reading version 1"
```

---

## Task 4: The menu answers the new look

Two loose ends in `app/main.js`, both visible only in the browser.

1. `callPlay` does not re-align the computer's defense. Every *drag* does (`realignDefense`), so a formation set by hand gets answered and the identical formation set by a called play does not — the corners stay lined up over where the receivers used to be.
2. `savePlay`'s refusal says "Draw some arrows first", which is no longer the whole truth: moving a man is now something to save.

**Files:**
- Modify: `app/main.js`
- Test: none possible (no DOM in `node --test`) — Task 5's browser script covers it.

- [ ] **Step 1: Re-align, and say how the formation reads**

In `callPlay`, after `applyPlay`:

```js
  const { applied, skipped } = applyPlay(state, play);
  // A called play sets a formation, and a formation is a question the defense
  // has to answer — the same answer a drag gets. Without this the corners stay
  // lined up over the last play's receivers.
  realignDefense();
```

and let the message carry the count, since an illegal formation is a thing the coach cannot see by counting circles:

```js
  const note = formationNote();
  say(skipped.length === 0
    ? `"${play.name}" called. ${applied.length} player(s) set. ${note}`
    : `"${play.name}" called. ${applied.length} set, ${skipped.length} skipped. ${note}`);
```

- [ ] **Step 2: Fix the refusal**

```js
    say('Nothing to save yet. Move someone or draw some arrows first.');
```

- [ ] **Step 3: Commit**

```
git add app/main.js
git commit -m "A called play is a formation the defense answers"
```

---

## Task 5: Verify in the browser, and write it down

**Files:**
- Modify: `README.md`
- Verify: the whole thing, by hand

- [ ] **Step 1: Run the browser script**

`npm run serve`, open `http://localhost:8080`.

1. **Save a formation.** Reposition on, drag `WR1` out wide and the `RB` across, reposition off, draw one arrow. **Save current play**, name it `Trips`. It saves.
2. **Move away from it.** Drag the receivers back somewhere else. Press slot 1. Everyone snaps back to the `Trips` picture, the arrow comes back, and the message counts the men on the line.
3. **The defense answers.** The corner that was lined up over the old spot is now over the new one.
4. **A later down.** Run the turn to a whistle, take **Next Down**, press slot 1. The same picture, on the new line of scrimmage.
5. **Nothing but a formation.** New Game, move one man, save. It saves — no "draw some arrows first".
6. **Nothing at all.** New Game, save immediately. Refused, with the new wording.
7. **Deep in your own end.** Take the ball back near the top of the frame and call a play whose formation would sit off the field or past the line: it loads, the impossible men stay where they are, and the message counts them as skipped.
8. **It survives a reload.** Reload the page, press slot 1: the formation is still in it.
9. **An old book still opens.** In the console, write a version-1 book to `localStorage['football-by-turn:playbook']`, reload, press its slot: the arrows come back and nobody moves.

- [ ] **Step 2: Update the README**

In the playbook paragraph (the "Save current play" bullet), say that a play now saves the formation as well as the arrows, stances and throw; that spots are kept relative to the line of scrimmage so a play called on a later down lines up the same way; and that a man whose spot will not fit on the down being played is skipped like any other order that cannot be given.

- [ ] **Step 3: Commit and push**

```
git add README.md
git commit -m "README: plays save the formation"
git push -u origin claude/coaches-play-save-positions-5af266
```

---

## Not doing (deliberately)

- **The predicted-destination circle for a loaded arrow.** `applyPlay` calls `setPlan` without a `target`, so a called play draws the old-style arrow and no destination dot until the coach re-drags. That is true today and is a separate fix (`planForDrag` lives in `predict.js`, and `play.js` would have to import it).
- **A "formation only" save, or naming formations separately from plays.** One list of five slots, one kind of thing in them.
- **Refusing to load a play that produces an illegal formation.** A coach may line up illegally by hand and find out at the snap; a called play is not held to a stricter rule.
- **Rounding spots on the way into storage.** The numbers are floats out of a drag; `SPOT_EPS` is what absorbs the round-trip, and JSON of fourteen pairs is not a size problem.
