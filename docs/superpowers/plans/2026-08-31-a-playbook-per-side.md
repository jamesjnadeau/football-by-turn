# A Playbook Per Side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The five play slots stop being one shared book. A coach keeps five
offensive plays and five defensive plays, the menu shows the book for the side
he is coaching, and neither book can ever be handed to the other side.

**Architecture:** The stored blob under `football-by-turn:playbook` grows from
one book to a **library** — `{ offense: [5 slots], defense: [5 slots] }` — at
version 3, with versions 1 and 2 still readable as the offense's book, because
until sides existed the coach was always the offense. `lib/game/playbook.js`
keeps being the pure file that knows what a playbook IS and gains the library
alongside it, including the one pure question the app has to ask —
`playbookSide(state)`, which is `humanSide(state)` from `hud.js` with hot-seat
answering "offense". `app/playbook-store.js` stays the only `localStorage` in
the repo and now loads and saves a library under the same key, so an existing
coach's five plays migrate on first read. `app/main.js` holds the library
instead of a book and asks `playbookSide(state)` which five slots to paint,
save into and call from — so the section follows the mid-game Defense button
as well as the home-screen choice.

**Tech Stack:** Plain ES modules, `node --test` (`npm test`). No new
dependencies, no build step, one new `id` attribute in `index.html` and no new
CSS.

**Spec:** The user's request, quoted in full because there is no separate spec
document for this feature:

> create a plan to fix the fact that storing plays is shared between offense
> and defense. There should be a set of plays for offense, and a set of plays
> for defense, they should not be shared

Design decisions argued from it (the executor implements these, not
alternatives):

1. **Two books in one stored blob, not two storage keys.** One key means one
   read, one write, one version number and one migration to reason about.
   `app/playbook-store.js` is deliberately the only file in the repo that
   touches `localStorage`, and giving it two keys would double the surface
   that has to be wrapped in `try`/`catch` for nothing.
2. **The old book becomes the offense's.** A version-1 or version-2 blob was
   saved when the human could only ever coach the offense (sides landed after
   the playbook did). Reading it as the offense's five plays is not a guess,
   it is what those plays are. The defense's book starts empty.
3. **Which book is on screen is derived, never stored.** `playbookSide(state)`
   is computed from `state.aiTeam` every paint, so the section follows the
   in-game Defense button — which can hand the human the other side of the
   ball mid-visit — and not just the home-screen press. There is no third
   place a side can be recorded and drift out of step.
4. **Hot-seat gets the offense's book.** In hot-seat (`aiTeam: null`) both
   teams are the human's and neither book is strictly right. The offense's is
   the answer, for the same reason `hud.js` already reads hot-seat as the
   offense line at kickoff: the drive is still yours to script. A hot-seat
   play captures defenders too; those come back as skips if it is ever called
   while the computer has the defense, which is exactly what happens today and
   what the README already documents.
5. **The heading says which book you are looking at.** Without it, pressing
   the Defense button would silently swap five slot labels and a coach would
   think his plays had been eaten. `<h2>Plays</h2>` becomes
   `Plays — Offense` / `Plays — Defense`, from a pure function.
6. **No third book for `training` mode.** Training mode is the human coaching
   the offense; it uses the offense's book. The home-screen `side` id never
   reaches the playbook at all — `state.aiTeam` is the single source.
7. **Five slots per book stays five.** `PLAY_SLOTS` is not touched. This
   change is about whose plays they are, not how many.

## Global Constraints

- No npm dependencies and no build step, ever.
- Nothing under `lib/` may import `node:` modules or touch the DOM.
- `app/` files have no unit tests (they touch the DOM); everything with logic
  or copy in it lives in `lib/` where `node --test` reaches it. The app wiring
  is verified by hand in the browser against the checklist in Task 1, Step 8.
- The storage key stays exactly `'football-by-turn:playbook'`. Changing it
  would orphan every coach's saved plays instead of migrating them.
- Every `localStorage` access stays wrapped in `try`/`catch`: the property
  access itself throws when the browser has blocked site data, and an
  exception at module scope takes the whole game down.
- A blob that cannot be read reads as an empty library, never as a partly
  loaded one. These numbers go straight into the physics.
- `npm test` must end `fail 0` at every commit.

## File Structure

- Modify: `lib/game/playbook.js` — the library replaces the single book as the
  stored shape. Adds `BOOK_SIDES`, `emptyLibrary`, `bookFor`, `putBook`,
  `playbookSide`, `playbookHeading`, `serializeLibrary`, `parseLibrary`;
  removes `serializePlaybook` and `parsePlaybook` (there is one stored blob,
  so there is one pair of functions for it); `PLAY_SLOTS`, `emptyPlaybook`,
  `firstEmptySlot` and `putPlay` are untouched. Gains one import: `humanSide`
  from `./hud.js`.
- Modify: `test/game/playbook.test.js` — the slot tests stay; the storage
  tests become library tests, plus the side/heading tests.
- Modify: `app/playbook-store.js` — `loadPlaybook`/`savePlaybook` become
  `loadLibrary`/`saveLibrary` over the same key.
- Modify: `index.html` — one `id` on the Plays heading.
- Modify: `app/main.js` — holds a `library`, asks `playbookSide(state)` which
  book to paint, save into and call from, and writes the heading.
- Modify: `README.md` — the Plays bullet says there are two books.

Two tasks. Task 1 is the whole behaviour change: the format, the store and the
app move together because a rename that leaves `app/main.js` importing names
that no longer exist is a broken commit, and this repo has no build step to
catch one. Task 2 is the documentation.

---

## Task 1: Two books, one per side of the ball

**Files:**
- Modify: `lib/game/playbook.js`
- Modify: `app/playbook-store.js`
- Modify: `index.html:72`
- Modify: `app/main.js` (imports at 33-34, element handles near 41, module
  state near 77-79, `paintPlays`, `savePlay`, `callPlay`)
- Test: `test/game/playbook.test.js`

**Interfaces:**
- Consumes: `sanitizePlay(raw)` from `lib/game/play.js` (unchanged);
  `humanSide(state)` from `lib/game/hud.js` — returns `'offense'`,
  `'defense'`, or `null` in hot-seat.
- Produces, from `lib/game/playbook.js`:
  - `PLAY_SLOTS: 5`, `PLAYBOOK_VERSION: 3` (unchanged name, new value)
  - `BOOK_SIDES: ['offense', 'defense']`
  - `emptyPlaybook(): (Play|null)[]` — five nulls (unchanged)
  - `emptyLibrary(): { offense: (Play|null)[], defense: (Play|null)[] }`
  - `firstEmptySlot(playbook): number` (unchanged)
  - `putPlay(playbook, slot, play): (Play|null)[]` (unchanged)
  - `bookFor(library, side): (Play|null)[]`
  - `putBook(library, side, book): Library`
  - `playbookSide(state): 'offense' | 'defense'`
  - `playbookHeading(state): string`
  - `serializeLibrary(library): string`
  - `parseLibrary(text: unknown): Library`
  - **Gone:** `serializePlaybook`, `parsePlaybook`.
- Produces, from `app/playbook-store.js`: `loadLibrary(): Library` and
  `saveLibrary(library): boolean` — false when the browser refused to keep it.
  **Gone:** `loadPlaybook`, `savePlaybook`.
- A `Play` is unchanged: `{ name, plans, stances, pass, spots }`, with
  `plans[id] = { dir, throttle }`, `stances[id] = { mode, facing }`,
  `pass = { from, dir, power } | null`, `spots[id] = { across, down }`.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `test/game/playbook.test.js` with exactly this content:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAY_SLOTS, PLAYBOOK_VERSION, BOOK_SIDES, emptyPlaybook, emptyLibrary,
  firstEmptySlot, putPlay, bookFor, putBook, playbookSide, playbookHeading,
  serializeLibrary, parseLibrary,
} from '../../lib/game/playbook.js';

const play = (name) => ({
  name,
  plans: { 'o-qb': { dir: { x: 0, y: -1 }, throttle: 1 } },
  stances: {},
  pass: null,
  spots: {},
});

test('a new playbook is five empty slots', () => {
  const pb = emptyPlaybook();
  assert.equal(PLAY_SLOTS, 5);
  assert.equal(pb.length, PLAY_SLOTS);
  assert.ok(pb.every((slot) => slot === null));
});

test('the first empty slot is the lowest one, and -1 when the book is full', () => {
  let pb = emptyPlaybook();
  assert.equal(firstEmptySlot(pb), 0);
  pb = putPlay(pb, 0, play('A'));
  assert.equal(firstEmptySlot(pb), 1);
  for (let i = 1; i < PLAY_SLOTS; i++) pb = putPlay(pb, i, play(`P${i}`));
  assert.equal(firstEmptySlot(pb), -1);
});

test('putPlay copies rather than mutating', () => {
  const pb = emptyPlaybook();
  const next = putPlay(pb, 2, play('A'));
  assert.equal(pb[2], null);
  assert.equal(next[2].name, 'A');
});

test('putPlay ignores a slot outside the five', () => {
  const pb = emptyPlaybook();
  for (const slot of [-1, PLAY_SLOTS, 1.5, '0', NaN]) {
    assert.equal(putPlay(pb, slot, play('A')), pb, String(slot));
  }
});

test('a new library is an empty book for each side of the ball', () => {
  const lib = emptyLibrary();
  assert.deepEqual(BOOK_SIDES, ['offense', 'defense']);
  for (const side of BOOK_SIDES) assert.deepEqual(lib[side], emptyPlaybook());
});

test('the two books are not the same array', () => {
  const lib = emptyLibrary();
  assert.notEqual(lib.offense, lib.defense);
});

test('bookFor reads one side, and an unknown side is an empty book', () => {
  const lib = putBook(emptyLibrary(), 'defense', putPlay(emptyPlaybook(), 0, play('Cover 2')));
  assert.equal(bookFor(lib, 'defense')[0].name, 'Cover 2');
  assert.equal(bookFor(lib, 'offense')[0], null);
  assert.deepEqual(bookFor(lib, 'special-teams'), emptyPlaybook());
});

test('putBook copies rather than mutating, and leaves the other side alone', () => {
  const lib = emptyLibrary();
  const next = putBook(lib, 'offense', putPlay(emptyPlaybook(), 0, play('Sweep')));
  assert.equal(lib.offense[0], null);
  assert.equal(next.offense[0].name, 'Sweep');
  assert.deepEqual(next.defense, emptyPlaybook());
});

test('putBook ignores a side there is no book for', () => {
  const lib = emptyLibrary();
  assert.equal(putBook(lib, 'kicking', emptyPlaybook()), lib);
});

test('the book on screen is the side the coach is coaching', () => {
  assert.equal(playbookSide({ aiTeam: 'defense' }), 'offense');
  assert.equal(playbookSide({ aiTeam: 'offense' }), 'defense');
});

test('hot-seat reads the offense book', () => {
  assert.equal(playbookSide({ aiTeam: null }), 'offense');
});

test('the heading says which book is on screen', () => {
  assert.equal(playbookHeading({ aiTeam: 'defense' }), 'Plays — Offense');
  assert.equal(playbookHeading({ aiTeam: 'offense' }), 'Plays — Defense');
  assert.equal(playbookHeading({ aiTeam: null }), 'Plays — Offense');
});

test('a library round-trips through storage', () => {
  let lib = emptyLibrary();
  lib = putBook(lib, 'offense', putPlay(emptyPlaybook(), 0, play('Sweep')));
  lib = putBook(lib, 'defense', putPlay(emptyPlaybook(), 3, play('Cover 2')));
  assert.deepEqual(parseLibrary(serializeLibrary(lib)), lib);
});

test('an offensive play never turns up in the defense book', () => {
  const lib = putBook(emptyLibrary(), 'offense', putPlay(emptyPlaybook(), 0, play('Sweep')));
  const back = parseLibrary(serializeLibrary(lib));
  assert.equal(back.offense[0].name, 'Sweep');
  assert.ok(back.defense.every((slot) => slot === null));
});

test('the stored form carries a version, and today it is 3', () => {
  assert.equal(PLAYBOOK_VERSION, 3);
  assert.equal(JSON.parse(serializeLibrary(emptyLibrary())).v, PLAYBOOK_VERSION);
});

test('nothing usable in storage reads as an empty library', () => {
  for (const raw of [null, undefined, '', 'not json', '[]', '{"v":3}', '{"books":{}}']) {
    assert.deepEqual(parseLibrary(raw), emptyLibrary(), String(raw));
  }
});

test('a library from a version this build does not know is dropped', () => {
  const text = JSON.stringify({
    v: PLAYBOOK_VERSION + 1,
    books: { offense: [play('Sweep')], defense: [] },
  });
  assert.deepEqual(parseLibrary(text), emptyLibrary());
});

test('a version-2 book loads as the offense book, because that is whose it was', () => {
  const old = JSON.stringify({ v: 2, slots: [play('Sweep'), null, null, null, null] });
  const lib = parseLibrary(old);
  assert.equal(lib.offense[0].name, 'Sweep');
  assert.ok(lib.defense.every((slot) => slot === null));
});

test('a version-1 book still loads, as offense plays with no formation in them', () => {
  const old = JSON.stringify({
    v: 1,
    slots: [{ name: 'Sweep', plans: {}, stances: {}, pass: null }, null, null, null, null],
  });
  const lib = parseLibrary(old);
  assert.equal(lib.offense[0].name, 'Sweep');
  assert.deepEqual(lib.offense[0].spots, {});
  assert.ok(lib.defense.every((slot) => slot === null));
});

test('one corrupt play empties its slot and leaves the others alone', () => {
  const bad = play('Broken');
  bad.plans['o-qb'].throttle = 'fast';
  const text = JSON.stringify({
    v: PLAYBOOK_VERSION,
    books: { offense: [play('Good'), bad, null, null, null], defense: [] },
  });
  const lib = parseLibrary(text);
  assert.equal(lib.offense[0].name, 'Good');
  assert.equal(lib.offense[1], null);
  assert.equal(lib.offense.length, PLAY_SLOTS);
});

test('a stored book longer than five slots is cut to five', () => {
  const slots = Array.from({ length: 9 }, (_, i) => play(`P${i}`));
  const lib = parseLibrary(JSON.stringify({
    v: PLAYBOOK_VERSION,
    books: { offense: slots, defense: slots },
  }));
  assert.equal(lib.offense.length, PLAY_SLOTS);
  assert.equal(lib.offense[4].name, 'P4');
  assert.equal(lib.defense.length, PLAY_SLOTS);
});

test('a book stored as something other than an array reads as empty slots', () => {
  const lib = parseLibrary(JSON.stringify({
    v: PLAYBOOK_VERSION,
    books: { offense: 'Sweep' },
  }));
  assert.deepEqual(lib, emptyLibrary());
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test test/game/playbook.test.js
```

Expected: FAIL. `PLAYBOOK_VERSION` is still 2 and the new names are all
`undefined`, so the version test fails on the assertion and every test that
calls `emptyLibrary`, `bookFor`, `putBook`, `playbookSide`, `playbookHeading`,
`serializeLibrary` or `parseLibrary` fails with
`TypeError: ... is not a function`.

- [ ] **Step 3: Rewrite the playbook as a library of two books**

Replace the whole of `lib/game/playbook.js` with exactly this content:

```js
/**
 * The playbook: PLAY_SLOTS fixed slots for one side of the ball, and the
 * versioned JSON they survive a reload as. A playbook is an array; a slot is a
 * play or null. A LIBRARY is the pair of them — one book for the offense, one
 * for the defense — because a play is orders for named men, and the names
 * change with the side you coach: an offensive sweep called while coaching the
 * secondary is five arrows for people who are not on your team, which
 * applyPlay would skip whole. Pure — this file knows what a playbook IS, and
 * app/playbook-store.js is the only thing that knows where one is kept.
 *
 * Version 2 added `spots` — a play carries the formation it was called from,
 * not just its arrows. Version 3 split the one book into two. Both older
 * versions survive reading, because a coach's five plays outlive a format
 * change: a version-1 play is a play with no formation in it, which
 * sanitizePlay already reads as `spots: {}`, and a version-1 or -2 BOOK is the
 * offense's, because until sides existed the coach was always the offense.
 * Writing is always the current version.
 */
import { sanitizePlay } from './play.js';
import { humanSide } from './hud.js';

export const PLAY_SLOTS = 5;
export const PLAYBOOK_VERSION = 3;

/** The books a library holds, in the order they are stored in. */
export const BOOK_SIDES = ['offense', 'defense'];

/** Versions this build can read. Writing is always the current one. */
const READABLE = new Set([1, 2, 3]);

export function emptyPlaybook() {
  return Array.from({ length: PLAY_SLOTS }, () => null);
}

/** A fresh book for each side. Two arrays, never one array twice. */
export function emptyLibrary() {
  return { offense: emptyPlaybook(), defense: emptyPlaybook() };
}

/** The lowest unused slot, or -1 when every one is taken. */
export function firstEmptySlot(playbook) {
  return playbook.findIndex((slot) => slot === null);
}

/**
 * A copy of the playbook with `slot` set to `play`. A slot outside the five
 * returns the playbook unchanged rather than growing the array: five slots is
 * the contract, and the slot number comes from a prompt the coach typed.
 */
export function putPlay(playbook, slot, play) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PLAY_SLOTS) return playbook;
  const next = playbook.slice();
  next[slot] = play;
  return next;
}

/**
 * The book for one side of the ball. A side there is no book for reads as an
 * empty book rather than as undefined: the caller is about to index five slots
 * off this, and a menu of five empty buttons is a better answer than a crash.
 */
export function bookFor(library, side) {
  return BOOK_SIDES.includes(side) ? library[side] : emptyPlaybook();
}

/**
 * A copy of the library with `side`'s book replaced. A copy, for the same
 * reason putPlay makes one: the two books must never come to share an array,
 * or saving a play while coaching the offense would file it with the defense's
 * as well, which is the exact bug this shape exists to prevent.
 */
export function putBook(library, side, book) {
  if (!BOOK_SIDES.includes(side)) return library;
  return { ...library, [side]: book };
}

/**
 * Which book the coach is looking at: the one for the side he is coaching.
 * Derived from the state every time it is asked rather than stored anywhere,
 * so the mid-game Defense button — which can hand him the other side of the
 * ball — moves him to the other book with it.
 *
 * Hot-seat coaches both teams and so has no side of its own; it reads as the
 * offense's book, the same call hud.js makes when it gives hot-seat the
 * offense's kickoff line. The drive is still yours to script.
 */
export function playbookSide(state) {
  return humanSide(state) ?? 'offense';
}

/**
 * What the menu's Plays heading says. Without it, handing the computer the
 * other team would silently relabel five slot buttons and a coach would think
 * his plays had been eaten.
 */
export function playbookHeading(state) {
  return playbookSide(state) === 'defense' ? 'Plays — Defense' : 'Plays — Offense';
}

export function serializeLibrary(library) {
  return JSON.stringify({
    v: PLAYBOOK_VERSION,
    books: { offense: library.offense, defense: library.defense },
  });
}

/**
 * Exactly PLAY_SLOTS sanitised slots, however many were stored — and five
 * empty ones for anything that is not a list of plays at all.
 */
function parseSlots(raw) {
  const out = emptyPlaybook();
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < PLAY_SLOTS; i++) out[i] = sanitizePlay(raw[i]);
  return out;
}

/**
 * Storage back into a library. Anything unrecognisable — absent, not JSON, a
 * version this build does not know, a play with a NaN in it — reads as an
 * empty library or an empty slot. Losing a saved play is a disappointment;
 * loading a corrupt one puts NaN into the physics, so the trade is not close.
 */
export function parseLibrary(text) {
  const out = emptyLibrary();
  if (typeof text !== 'string' || text === '') return out;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  if (!READABLE.has(raw.v)) return out;
  // Before version 3 there was one book and it was the offense's — a coach
  // could only ever be the offense at the time he saved it. This is a
  // migration, not a guess: those plays ARE offensive plays.
  if (raw.v < 3) {
    out.offense = parseSlots(raw.slots);
    return out;
  }
  if (!raw.books || typeof raw.books !== 'object') return out;
  for (const side of BOOK_SIDES) out[side] = parseSlots(raw.books[side]);
  return out;
}
```

- [ ] **Step 4: Run the whole suite to verify it passes**

```bash
npm test
```

Expected: `fail 0`. Nothing outside `test/game/playbook.test.js` imports the
two removed functions, so no other test changes.

- [ ] **Step 5: Point the store at the library**

Replace the whole of `app/playbook-store.js` with exactly this content:

```js
/**
 * Where the playbooks live between sessions. The only localStorage in the
 * repo, and the reason lib/game/playbook.js is pure: node --test has no
 * browser storage, so the format is tested there and only the plumbing is
 * here.
 *
 * One key holds both books — one read, one write, one version number, one
 * migration. The key has not changed since there was only one book, which is
 * what lets a coach's existing five plays come back as his offense's.
 *
 * Every call is wrapped, because localStorage does not merely return null when
 * the browser has blocked site data — the property access itself throws, and an
 * exception at module scope would take the whole game down with it. A coach who
 * cannot persist his plays should still get to play football.
 */
import { emptyLibrary, parseLibrary, serializeLibrary } from '../lib/game/playbook.js';

const KEY = 'football-by-turn:playbook';

export function loadLibrary() {
  try {
    return parseLibrary(localStorage.getItem(KEY));
  } catch {
    return emptyLibrary();
  }
}

/** False when the browser refused to keep it — the caller says so out loud. */
export function saveLibrary(library) {
  try {
    localStorage.setItem(KEY, serializeLibrary(library));
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Give the Plays heading an id**

In `index.html`, line 72, change:

```html
      <h2>Plays</h2>
```

to:

```html
      <h2 id="plays-heading">Plays</h2>
```

Nothing else in the markup changes: the five slot buttons are still built by
`app/main.js`, because `PLAY_SLOTS` is the library's number to decide.

- [ ] **Step 7: Wire the menu to the book for the side being coached**

In `app/main.js`, make five edits.

**7a.** The imports at lines 33-34. Change:

```js
import { PLAY_SLOTS, firstEmptySlot, putPlay } from '../lib/game/playbook.js';
import { loadPlaybook, savePlaybook } from './playbook-store.js';
```

to:

```js
import {
  PLAY_SLOTS, firstEmptySlot, putPlay, bookFor, putBook, playbookSide, playbookHeading,
} from '../lib/game/playbook.js';
import { loadLibrary, saveLibrary } from './playbook-store.js';
```

**7b.** The element handles. Immediately above the existing
`const savePlayBtn = document.getElementById('save-play');`, add:

```js
const playsHeading = document.getElementById('plays-heading');
```

**7c.** The module state. Change:

```js
// Not game state: the playbook outlives New Game, and lives in the browser
// rather than in `state`, which is replaced wholesale.
let playbook = loadPlaybook();
```

to:

```js
// Not game state: the playbooks outlive New Game, and live in the browser
// rather than in `state`, which is replaced wholesale. Two books, one per
// side of the ball — a defensive coach is never offered arrows drawn for men
// he does not have.
let library = loadLibrary();

/**
 * The five slots for the side being coached right now. Asked fresh every time
 * rather than kept in a variable: the Defense button can hand the human the
 * other team mid-drive, and the menu has to follow it.
 */
function myBook() {
  return bookFor(library, playbookSide(state));
}
```

**7d.** `paintPlays`. Replace the function with:

```js
function paintPlays() {
  const usable = !animating && canUsePlays(state);
  const book = myBook();
  playsHeading.textContent = playbookHeading(state);
  savePlayBtn.disabled = !usable;
  for (let i = 0; i < PLAY_SLOTS; i++) {
    const play = book[i];
    slotBtns[i].textContent = play ? `${i + 1}. ${play.name}` : `${i + 1}. (empty)`;
    slotBtns[i].disabled = !usable || !play;
  }
}
```

Its doc comment above stays as it is, and gains one paragraph:

```js
/**
 * A play is what you come to the line with, so both saving and calling one are
 * offered only on the first turn of a down. Off it the buttons go grey rather
 * than disappearing: a grey button explains itself, a vanished one does not.
 *
 * Which five plays these are follows the side the human is coaching, and the
 * heading says which — a coach who hands the computer the other team is
 * looking at a different book a moment later, and five relabelled buttons with
 * nothing to explain them read as five lost plays.
 */
```

**7e.** `savePlay` and `callPlay`. In `savePlay`, replace the block from
`let slot = firstEmptySlot(playbook);` through `const kept = savePlaybook(playbook);`
with:

```js
  const side = playbookSide(state);
  const book = bookFor(library, side);
  let slot = firstEmptySlot(book);
  if (slot === -1) {
    const answer = window.prompt(
      `All ${PLAY_SLOTS} slots are full. Replace which one (1-${PLAY_SLOTS})?`,
      '1',
    );
    const n = Number(answer);
    if (!Number.isInteger(n) || n < 1 || n > PLAY_SLOTS) return;
    slot = n - 1;
  }
  // Into this side's book only. putBook copies, so the other side's five are
  // the same five they were.
  library = putBook(library, side, putPlay(book, slot, play));
  const kept = saveLibrary(library);
```

In `callPlay`, change:

```js
  const play = playbook[i];
```

to:

```js
  const play = myBook()[i];
```

Nothing else in either function changes — the prompts, the messages, the
`realignDefense()` call and the `closeMenu()`/`paint()` ordering all stay.

- [ ] **Step 8: Verify it in the browser**

`app/` has no unit tests, so this is the coverage. Run the server:

```bash
npm run serve
```

Open the page and work through all nine:

1. **The old book migrates.** In the console, before anything else:
   `localStorage.setItem('football-by-turn:playbook', JSON.stringify({v:2,slots:[{name:'Old Sweep',plans:{},stances:{},pass:null,spots:{'o-qb':{across:0,down:-5}}},null,null,null,null]}))`,
   then reload. Pick **7 Player → Play Offense** and open the Coaches Menu:
   the heading reads **Plays — Offense** and slot 1 reads `1. Old Sweep`.
2. **The defense's book starts empty.** Back to Home → **7 Player → Play
   Defense** → menu: the heading reads **Plays — Defense** and all five slots
   read `(empty)` and are greyed.
3. **A defensive play saves and calls.** Still coaching the defense, turn
   Reposition on, drag two defenders, draw an arrow on a third, press **Save
   current play**, name it `Cover 2`. The message names slot 1. Reopen the
   menu: `1. Cover 2`. Press **Next Down** (or run a turn to a whistle and
   advance), then press slot 1: the defenders line up and the arrow comes
   back, and the message counts what was set.
4. **The books do not mix.** Back to Home → **Play Offense** → menu: the
   heading reads **Plays — Offense**, slot 1 is still `Old Sweep`, and
   `Cover 2` is nowhere in the five.
5. **The stored shape is right.** Console:
   `JSON.parse(localStorage['football-by-turn:playbook'])` → `v` is `3`,
   `books.offense[0].name` is `'Old Sweep'`, `books.defense[0].name` is
   `'Cover 2'`.
6. **Both books survive a reload.** Reload, go back into each side, check
   both slots are still there.
7. **The heading follows the Defense button.** Start **Training Mode** (the
   heading reads Plays — Offense) and press the Defense button until it reads
   `Offense: computer (learned)`: the heading flips to **Plays — Defense**
   and the slots become the defense's five. Press it once more to
   `Defense: you` (hot-seat): the heading reads **Plays — Offense** again and
   the offense's five come back.
8. **Grey off the first turn.** Run a turn: Save current play and all five
   slots go grey, on both sides.
9. **A blocked browser still plays.** In a private window with site data
   blocked, the game loads, the menu opens with five empty slots, and saving
   a play says `for this session only`.

- [ ] **Step 9: Commit**

```bash
git add lib/game/playbook.js test/game/playbook.test.js app/playbook-store.js index.html app/main.js
git commit -m "feat: a playbook for the offense and a playbook for the defense"
```

---

## Task 2: The README says there are two books

**Files:**
- Modify: `README.md` (the **Plays** bullet, lines 233-247)

**Interfaces:**
- Consumes: the behaviour Task 1 shipped. Produces nothing code reads.

- [ ] **Step 1: Rewrite the Plays bullet**

In `README.md`, replace the bullet that currently begins
`- The Coaches Menu has a **Plays** section.` — all of it, through
`is skipped, and the message says how many.` — with:

```markdown
- The Coaches Menu has a **Plays** section, and it holds two playbooks: five
  slots for the offense and five for the defense. Which one you see follows the
  side you are coaching, and the heading says so — a play is orders for named
  men, and your sweep is nobody's assignment when you are coaching the
  secondary. Set up a formation, draw the first set of arrows for a down, press
  **Save current play**, and name it — the play goes into one of that side's
  five slots, formation, stances and a planned throw included.
  Press a slot to call that play again on a later down; it replaces whatever
  you have drawn *and* whoever is standing where, rather than adding to it.
  Every man's spot is kept relative to the line of scrimmage, not the yard
  line, so a play saved on your own 25 lines up the same way when you call it
  from the 40. Saving and calling are offered only on the **first turn of a
  down** — that is what a play is — so the buttons grey out once the ball has
  moved, and moving a man before you save is as much a play as any arrow.
  Saved plays are kept in your browser, so they survive a reload and a New
  Game; anything you saved before the books were split comes back in the
  offense's, which is whose it was. With all five slots full, saving asks which
  one to replace. In hot-seat you are coaching both teams, and the offense's
  book is the one you get. Anyone in a saved play the current game has no
  orders to give — a defender in a play you saved while coaching both teams, a
  man whose saved spot will not fit on the down being played, say — is skipped,
  and the message says how many.
```

- [ ] **Step 2: Check nothing else in the README still says one book**

```bash
grep -n -i "five slots\|playbook\|save current play" README.md
```

Expected: every hit is inside the bullet you just wrote. If another line
elsewhere describes the playbook as a single shared set, fix it the same way.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: the playbook is two playbooks, one per side"
```

---

## Self-Review

**Spec coverage.**

| Requirement | Task |
|---|---|
| A set of plays for offense | 1 (`emptyLibrary`, `books.offense`, Step 8 checks 1 and 4) |
| A set of plays for defense | 1 (`books.defense`, Step 8 check 3) |
| They are not shared | 1 (`putBook` copies; `playbookSide` picks one; Step 8 checks 4 and 5; the tests `an offensive play never turns up in the defense book` and `putBook copies rather than mutating, and leaves the other side alone`) |
| Existing saved plays are not lost | 1 (`parseLibrary` reads v1/v2 as the offense's book; Step 8 check 1) |
| The coach can tell which book he is in | 1 (`playbookHeading`, Step 8 check 7) |

**Type consistency.** `library` is `{ offense, defense }` everywhere:
`emptyLibrary` builds it, `bookFor`/`putBook` read and replace one key,
`serializeLibrary` writes it under `books`, `parseLibrary` returns it,
`loadLibrary`/`saveLibrary` move it, and `app/main.js` holds it in `library`.
A book is always an array of exactly `PLAY_SLOTS` slots — `emptyPlaybook`,
`parseSlots` and `putPlay` all preserve that length. `playbookSide` returns
one of `BOOK_SIDES` and is the only argument ever passed as `side`.
`PLAYBOOK_VERSION` is the one version constant and is 3.

**Removals accounted for.** `serializePlaybook`, `parsePlaybook`,
`loadPlaybook` and `savePlaybook` are deleted in Task 1 Steps 3 and 5, and
their only callers — `app/playbook-store.js`, `app/main.js` and
`test/game/playbook.test.js` — are all rewritten in the same task and the same
commit, so no commit leaves a dangling import.
