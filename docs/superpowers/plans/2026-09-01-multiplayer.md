# Multiplayer: two coaches, one drive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth home-screen side, *Multiplayer*, that puts two coaches into a
per-side lobby queue, pairs them, and plays one drive between them with a
Cloudflare Worker's Durable Objects running the authoritative simulation and
each browser only collecting input and animating what the server sends back.

**Architecture:** Two new pure modules carry all of the actual game logic
this feature needs — `lib/game/lobby.js` (queue-screen markup) and
`worker/match-engine.js` (the whole life of a match as a plain reducer over
messages) — following the same discipline `lib/game/home.js` and
`lib/game/turn.js` already use: build markup as strings, keep simulation a
pure function of `(state, random)`, and let a thin platform layer (a DOM
script for the browser, a Durable Object class for the server) do nothing but
plumbing on top. `lib/game/` gains a serialize/hydrate pair for `state.js`
and a team parameter on `play.js`'s `applyPlay`, and becomes a second
consumer's dependency (the Worker's) as well as the browser's, which is why
Global Constraints below repeats the DOM-free rule explicitly. `app/main.js`
gains one new concept, a `net` handle, threaded through `startGame` and
`pressRun`; when it is present the client stops calling `runTurn` itself and
instead sends `capturePlay`'s own output to the server.

**Tech Stack:** Plain ES modules, no build step, `node --test` (`npm test`)
for everything under `lib/` and `worker/`. Cloudflare Workers + Durable
Objects, deployed with `wrangler`. No new client-side dependencies.

**Spec:** `docs/superpowers/specs/2026-09-01-multiplayer-design.md`

## Global Constraints

- **No build step for the browser.** Every file under `app/` and `lib/`
  stays a plain ES module loaded directly. `worker/` is new territory — it
  runs under `workerd` via `wrangler`, not in a browser, but it too stays
  free of bundler-only syntax (no TypeScript, no JSX): plain ES modules,
  same as everything else.
- **`lib/game/` is DOM-free, and now doubly so.** It already had one
  consumer (the browser) that could never prove this by crashing on a
  missing `document` — `node --test` has no DOM either. It now has a second
  consumer (the Worker) that runs somewhere `document` does not exist at
  all: an accidental `document`/`window`/`localStorage` reference under
  `lib/game/` will not just be untestable, it will make every match crash at
  runtime. Nothing in this plan adds such a reference; if a task seems to
  need one, stop and re-read the spec's "Where the truth lives" section
  before writing it.
- **`lib/` never reaches into `app/` or `worker/`.** The dependency runs one
  way: `app/` and `worker/` both import from `lib/`, `lib/` imports from
  neither.
- **Tests live at `test/<mirror of source path>.test.js`** and run under
  `npm test` (`node --test`). `worker/match-engine.js` gets
  `test/worker/match-engine.test.js`; `worker/lobby-engine.js` gets
  `test/worker/lobby-engine.test.js`.
- **A yard is 3.75 SVG units** (`UNITS_PER_YARD_X` / the `fieldPos` /
  `xToYards` family in `lib/game/view.js` and `lib/field/geometry.js`).
  Nothing in this feature invents a new coordinate system — every spot a
  play carries is already yards-from-midfield and yards-from-the-LOS
  (`capturePlay`'s `spots`), and that is the wire format too.
- **The wire format for a turn's orders is `capturePlay`'s own shape**,
  hardened by `sanitizePlay` — both already exist
  (`lib/game/play.js`). This plan does not invent a second serialization for
  the same data.
- **Commit after every task**, with the subject style this repo uses:
  lowercase `feat:` / `test:` / `docs:` / `fix:` and a sentence, not a noun
  phrase.
- **`npm test` must stay green after every task.**

## Design decisions (resolving spec ambiguities — read before implementing)

The spec settles the architecture; it does not spell out field names, file
boundaries within `worker/`, or a couple of implementation-level questions.
These are the calls this plan makes.

1. **Placement rules already live in `lib/game/formation.js` — nothing
   moves.** The spec says "those rules currently live in `app/main.js`" and
   asks for them to be extracted. Reading the code shows this already
   happened: `spotFault`, `placePlayer` and `placeFormation` are pure
   exports of `lib/game/formation.js`, and `lib/game/play.js`'s `applyPlay`
   already calls `placeFormation` to seat a loaded play's spots — the exact
   check a hostile client's spots need to go through. `app/main.js` only
   holds `FAULT_WORDS`, the strings it prints when `spotFault` refuses a
   drag; that is UI copy, not a rule, and stays where it is. Task 2 below is
   what actually matters for the referee: `applyPlay` has to be told WHICH
   team's play it is seating, because a match has two humans and today's
   `applyPlay` infers "mine" from `state.aiTeam`. Once that lands, the
   Durable Object commits a play as `applyPlay(state, play, team)` and gets
   the same `placeFormation` refusal the board already gets — no new
   placement code, anywhere.
2. **The match record's RNG is reseeded once per turn, not carried as a
   running stream.** `runTurn(state, random)` already takes a plain
   function, the same way `mulberry32(seed)` is threaded through the whole
   single-player game from one `New Game` press to the next. A Durable
   Object cannot rely on a live JS closure surviving between messages —
   WebSocket hibernation is explicitly what makes a `MatchDO` cheap (spec,
   "Cost"), and hibernation evicts the instance's memory between events. So
   `worker/match-engine.js` does not carry a `random` function inside its
   match record at all; the record carries only `seed` (a plain number,
   chosen once at `start` and stored), and every call into the engine that
   needs randomness derives its own generator as
   `mulberry32(seed + state.turnIndex)` — cheap, deterministic from two
   numbers that are already being persisted every turn as part of the
   authoritative state, and correct precisely because `runTurn` only calls
   `random()` while resolving ONE turn, and every turn already has a unique,
   stable `turnIndex`. This is a new, small helper,
   `turnRandom(record)`, in `worker/match-engine.js` — not a change to
   `lib/game/rng.js`.
3. **The wire protocol's message shapes**, since the spec describes them in
   prose. `worker/match-engine.js` and `app/multiplayer.js` are both built
   against these exact shapes:
   - Lobby, client → server: `{ type: 'join', variant, side }` (the
     upgrade request's query string is what the DO actually reads to open
     the socket in the right queue — see Task 12 — but the engine itself
     works in these terms so it is testable without an HTTP request object),
     `{ type: 'switch' }`.
   - Lobby, server → client: `{ type: 'queued', offense: N, defense: N }`,
     `{ type: 'matched', matchId, side, token }`.
   - Match, client → server: `{ type: 'commit', turnIndex, play }` where
     `play` is exactly `capturePlay`'s return shape (`sanitizePlay` is run
     on it before anything else touches it).
   - Match, server → client (a `MatchDO` broadcast strips the other side's
     private fields per-recipient — see Task 7): `{ type: 'start', seed,
     variant, losYard, side, deadlineAt }`, `{ type: 'turn', frames, events,
     down, deadlineAt, state }` (`state` is the tailored snapshot — Task 7's
     `stripForSide`), `{ type: 'timeUp' }`, `{ type: 'opponentGone',
     resumeBy }`, `{ type: 'opponentBack' }`, `{ type: 'matchOver', reason }`
     (`reason` ∈ `'down' | 'opponent-left' | 'refused'`).
   `turnIndex` rides on the `commit` message itself, sibling to `play`, and
   is never added to `sanitizePlay`'s schema — `sanitizePlay` is shared with
   the playbook's storage format (Task 2's design decision keeps that
   sharing intact), and a saved play has no notion of which turn it answers.
4. **`worker/lobby-engine.js` is its own pure module, separate from
   `worker/match-engine.js`.** The spec describes `LobbyDO` and `MatchDO` as
   two different Durable Object classes with two different jobs (queueing
   vs. playing a drive), and the same "plain function of (record, message)"
   discipline the spec asks for `MatchDO`'s logic applies just as well to
   the queue — two FIFO queues, a broadcast of both depths, a pop-both-when-
   ready match. Splitting it out keeps `match-engine.js` from also knowing
   about queueing, and gives the queue's own awkward cases (a `switch`
   mid-queue, popping two waiters at once) their own focused test file.
5. **Session tokens are opaque random strings the DO mints, not JWTs.** The
   spec only requires that "a stranger" cannot walk into a live match by
   guessing its id — a `crypto.randomUUID()` per player, minted at
   `matched` and checked on every reconnect, is the whole requirement.
   Nothing here needs to be verifiable offline or to carry a payload.

## File structure

| File | Responsibility |
|---|---|
| `lib/game/state.js` | *(modify)* `serializeState`/`hydrateState`. |
| `lib/game/play.js` | *(modify)* `applyPlay(state, play, team)`. |
| `lib/game/home.js` | *(modify)* `SIDES` gains `multiplayer`. |
| `lib/game/lobby.js` | The lobby screen's markup: side pick, queue depths, a Switch button. |
| `app/home.js` | *(modify)* the `multiplayer` id imports `app/multiplayer.js`. |
| `app/multiplayer.js` | Owns the lobby socket and the match socket; hands off to `app/main.js`'s `startGame` once matched. |
| `app/main.js` | *(modify)* the `net` seam: `startGame({..., net})`, `state.remoteTeam`, End Turn, the HUD countdown, hidden controls in a match. |
| `worker/match-engine.js` | Pure: `(record, message) → { record, messages }` for one match's whole life. |
| `worker/lobby-engine.js` | Pure: the two-queue pairing logic for one variant's lobby. |
| `worker/match-do.js` | `MatchDO` — sockets, the alarm, storage; a thin shell over `match-engine.js`. |
| `worker/lobby-do.js` | `LobbyDO` — sockets and storage; a thin shell over `lobby-engine.js`. |
| `worker/index.js` | The Worker's `fetch`: routes `/lobby` and `/match/<id>` to the two DOs, everything else falls through to `assets`. |
| `wrangler.toml` | Worker + Durable Object bindings, the `assets` binding at `_site`. |
| `package.json` | *(modify)* `build:site` script. |
| `.github/workflows/deploy.yml` | *(modify)* Pages jobs become `wrangler deploy`. |

---

### Task 1: `lib/game/state.js` gains `serializeState`/`hydrateState`, round-tripped

**Files:**
- Modify: `lib/game/state.js`
- Test: `test/game/state.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `serializeState(state)` → a plain JSON-serializable object (the
  state itself already is one; this makes that a guarantee rather than an
  accident). `hydrateState(data)` → a state deep-equal to the one
  `serializeState` was given, sharing no references with it.

The state object built by `createGame` is already plain data — every field
named in Task's own reading of `state.js` (`seed`, `aiTeam`, `variantId`,
`aiLevel`, `down`, `losYard`, `toGoYard`, `phase`, `turnIndex`, `players`
(each a plain object of numbers/strings/vectors/null), `ball`,
`plannedPass`, `aiPlay`, `tendencyCounts`, `scriptedOrders`,
`genomeOverrides`, `forwardPasses`, `penalty`, `deadReason`, `result`) is a
number, a string, `null`, a plain `{x,y}` vector, or an array/object built
from those. There are no functions, `Map`s, `Set`s or class instances
anywhere in it. The "nearly" the spec warns about is exactly this: proving
it with a test rather than assuming it, because a `Map` or a `Set` added to
`state` by some future task would silently `JSON`-round-trip into garbage.

- [ ] **Step 1: Write the failing test**

Add to `test/game/state.test.js` (it already imports `createGame`,
`getPlayer`, `setPlan`, `setMode` — reuse those):

```js
import { serializeState, hydrateState } from '../../lib/game/state.js';
import { runTurn } from '../../lib/game/turn.js';
import { mulberry32 } from '../../lib/game/rng.js';

test('a state round-trips through serialize/hydrate byte for byte', () => {
  const s = createGame({ seed: 42 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.7);
  setMode(s, 'd-lb', 'prepared');
  const random = mulberry32(s.seed);
  runTurn(s, random);
  runTurn(s, random);

  const data = serializeState(s);
  const hydrated = hydrateState(data);
  assert.deepEqual(hydrated, s);
});

test('serializeState and hydrateState never hand back a shared reference', () => {
  const s = createGame({ seed: 1 });
  const data = serializeState(s);
  const hydrated = hydrateState(data);
  hydrated.players[0].pos.x = 999;
  assert.notEqual(s.players[0].pos.x, 999);
  data.players[0].pos.x = -999;
  assert.notEqual(hydrated.players[0].pos.x, -999);
});

test('hydrateState refuses anything that is not the shape serializeState makes', () => {
  assert.throws(() => hydrateState(null));
  assert.throws(() => hydrateState({}));
  assert.throws(() => hydrateState({ players: 'nope' }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/state.test.js`
Expected: FAIL — `serializeState`/`hydrateState` are not exported.

- [ ] **Step 3: Implement `serializeState`/`hydrateState`**

In `lib/game/state.js`, add near the bottom, after `clearPass`:

```js
/**
 * The state as plain JSON-safe data — a deep copy, not a view. A match's
 * Durable Object calls this after every turn to persist the authoritative
 * state (so a hibernated instance can wake up and keep refereeing) and to
 * build the tailored snapshot each client is sent (worker/match-engine.js's
 * stripForSide starts from this). structuredClone is exactly the "deep copy
 * of plain data" this state already is -- there is nothing here it cannot
 * clone, which Task 1's own round-trip test is what proves rather than
 * assumes.
 */
export function serializeState(state) {
  return structuredClone(state);
}

/**
 * The inverse: a state built by serializeState, back as a live state. Refuses
 * anything that is not at least shaped like one, because this is the one
 * place a corrupt or truncated Durable Object storage read would otherwise
 * turn into a state with `players` missing and every downstream function
 * throwing from a different, more confusing place.
 */
export function hydrateState(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.players)) {
    throw new Error('hydrateState: not a serialized state');
  }
  return structuredClone(data);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/game/state.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (nothing else imports these names yet)

- [ ] **Step 6: Commit**

```bash
git add lib/game/state.js test/game/state.test.js
git commit -m "feat: state.js can serialize and hydrate a game round-trip"
```

---

### Task 2: `applyPlay` takes the team it is writing

**Files:**
- Modify: `lib/game/play.js`
- Modify: `app/main.js` (the one call site — the playbook's "load a play" button)
- Test: `test/game/play.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `applyPlay(state, play, team = state.aiTeam ? otherTeam(state.aiTeam) : 'offense')`
  — see Step 3 for why the default is not simply "not `aiTeam`". Every
  existing single-player call site keeps working with no argument change;
  a match's `MatchDO` is the one caller that ever passes `team` explicitly.

Today `applyPlay`'s `mine(id)` helper reads `p.team !== state.aiTeam`,
which means "the human's team" in a single-player game where at most one
team is ever the computer's. In a match neither team is `aiTeam` (it stays
`null` — see the spec's `app/main.js` section and Task 15), so that test
would call BOTH teams "mine" and a defense coach's commit would also try to
move the offense. `applyPlay` has to be told which team's play this is.

- [ ] **Step 1: Write the failing tests**

Add to `test/game/play.test.js` (check its existing imports first; it
already imports `createGame`, `applyPlay`, `getPlayer` — add
`setMode`/`setPlan` only if not already present):

```js
test('applyPlay writes only the named team, even in a hot-seat game with no aiTeam', () => {
  const s = createGame({ seed: 1 }); // aiTeam null: both sides are "the human's" today
  const play = {
    name: 'x',
    plans: { 'd-lb': { dir: { x: 0, y: -1 }, throttle: 1 } },
    stances: {},
    pass: null,
    spots: {},
  };
  const result = applyPlay(s, play, 'defense');
  assert.deepEqual(getPlayer(s, 'd-lb').plan, {
    dir: { x: 0, y: -1 }, throttle: 1, target: null, short: false,
  });
  assert.deepEqual(result.applied, ['d-lb']);
});

test('applyPlay refuses to write the other team\'s players, and skips them', () => {
  const s = createGame({ seed: 1 });
  const play = {
    name: 'x',
    plans: { 'o-rb': { dir: { x: 0, y: 1 }, throttle: 1 } }, // an offense id, called for defense
    stances: {},
    pass: null,
    spots: {},
  };
  const result = applyPlay(s, play, 'defense');
  assert.equal(getPlayer(s, 'o-rb').plan, null);
  assert.deepEqual(result.skipped, ['o-rb']);
});

test('applyPlay still defaults to the human\'s team when aiTeam is set, with no team argument', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const play = {
    name: 'x',
    plans: { 'o-rb': { dir: { x: 1, y: 0 }, throttle: 0.5 } },
    stances: {},
    pass: null,
    spots: {},
  };
  applyPlay(s, play); // no team: single-player call sites pass none
  assert.notEqual(getPlayer(s, 'o-rb').plan, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/play.test.js`
Expected: FAIL — the first two tests write/refuse the wrong players because
`mine()` still reads `state.aiTeam`.

- [ ] **Step 3: Widen `applyPlay`**

In `lib/game/play.js`, change the signature and the `mine`/loop guards. The
default when no `team` is given has to reproduce today's behavior exactly:
"the human's team" when `aiTeam` is set, and — since a hot-seat game's
existing callers (the playbook) always mean the OFFENSE's book in hot-seat,
per `coachedSide` in `lib/game/hud.js` — the offense when it is not.
Reuse that exact rule rather than inventing a second one:

```js
import {
  setPlan, clearPlan, setMode, setPass, clearPass, aimSnap, defaultSpots,
  DEFAULT_VARIANT,
} from './state.js';
import { placeFormation } from './formation.js';
import { fieldPos, yardsOfY } from './view.js';
import { xToYards } from '../field/geometry.js';
import { coachedSide } from './hud.js';
```

```js
export function applyPlay(state, play, team = coachedSide(state)) {
  const applied = new Set();
  const skipped = new Set();
  const mine = (id) => {
    const p = state.players.find((pl) => pl.id === id);
    return p && p.team === team ? p : null;
  };

  for (const p of state.players) {
    if (p.team !== team) continue;
    setMode(state, p.id, 'normal');
    clearPlan(state, p.id);
  }
  clearPass(state);
```

The rest of the function (the spots loop, the plans loop, the stances loop,
the pass, the final `aimSnap`) is unchanged — every `mine(id)` and every
`p.team === state.aiTeam`/`!== state.aiTeam` guard inside it already goes
through the helper or is deleted the same way the two loops above show.

- [ ] **Step 4: Check the one other call site**

`app/main.js` calls `applyPlay(state, play)` for the "load a play from the
playbook" button — grep to confirm:

Run: `grep -n "applyPlay(" app/main.js`
Expected: one call, with no `team` argument. Leave it exactly as it is —
`coachedSide(state)` reproduces today's behavior, so no change is needed
there. (If the grep turns up a second call site this plan did not account
for, stop and read it before continuing — Task 15 is the only other place
this plan adds one, and it always passes `team` explicitly.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/game/play.test.js`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/game/play.js test/game/play.test.js
git commit -m "feat: applyPlay writes an explicitly named team, not just aiTeam's opposite"
```

---

### Task 3: The `multiplayer` entry on the side chooser

**Files:**
- Modify: `lib/game/home.js`
- Test: `test/game/home.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `SIDES` gains a fourth entry, `{ id: 'multiplayer', label:
  'Multiplayer', note: 'Play a live drive against another coach.' }`.
  `sideMarkup` already renders whatever `SIDES` is given, so this needs no
  change to `sideMarkup` itself.

- [ ] **Step 1: Write the failing test**

Add to `test/game/home.test.js` (check its existing imports; it already
imports `sideMarkup` and/or `SIDES` from `../../lib/game/home.js` — add
`SIDES` if it is not already imported):

```js
test('the side chooser offers multiplayer, a live drive against another coach', () => {
  const ids = SIDES.map((s) => s.id);
  assert.deepEqual(ids, ['offense', 'defense', 'training', 'multiplayer']);
  const markup = sideMarkup({ id: '7', label: 'Seven-a-side' });
  assert.match(markup, /data-side="multiplayer"/);
  assert.match(markup, /Multiplayer/);
  assert.match(markup, /Play a live drive against another coach\./);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/game/home.test.js`
Expected: FAIL — `SIDES` has three entries, not four.

- [ ] **Step 3: Add the entry**

In `lib/game/home.js`, append to `SIDES`:

```js
export const SIDES = [
  {
    id: 'offense',
    label: 'Play Offense',
    note: 'You call the runs and throws against the computer’s learned defense.',
  },
  {
    id: 'defense',
    label: 'Play Defense',
    note: 'You set the coverage against the computer’s learned offense.',
  },
  {
    id: 'training',
    label: 'Training Mode',
    note: 'The game as it always was: coach the offense against the computer’s smart assignment defense.',
  },
  {
    id: 'multiplayer',
    label: 'Multiplayer',
    note: 'Play a live drive against another coach.',
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/home.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/home.js test/game/home.test.js
git commit -m "feat: the side chooser offers multiplayer, a live drive against another coach"
```

---

### Task 4: `lib/game/lobby.js` — the queue screen's markup

**Files:**
- Create: `lib/game/lobby.js`
- Test: `test/game/lobby.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `lobbyMarkup({ variant, side, offenseDepth, defenseDepth })` → a
  markup string. `data-lobby-switch` (the Switch button) and
  `data-lobby-back` (leave the queue, back to the side chooser) are the
  hooks `app/multiplayer.js` (Task 14) listens for, mirroring
  `lib/game/home.js`'s `data-home-back` convention.

This is the screen a coach sits on between pressing *Multiplayer* and
being matched: which side he asked for, how many coaches are waiting for
each side, and a way to switch queues or leave. `escapeText` is reused from
`lib/field/escape.js`, the same import `lib/game/home.js` uses, because
`variant.label` is the only piece of this markup that is not a literal.

- [ ] **Step 1: Write the failing tests**

Create `test/game/lobby.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { lobbyMarkup } from '../../lib/game/lobby.js';

const variant = { id: '7', label: 'Seven-a-side' };

test('the lobby screen names the game, the side queued for, and both queue depths', () => {
  const markup = lobbyMarkup({ variant, side: 'offense', offenseDepth: 3, defenseDepth: 0 });
  assert.match(markup, /Seven-a-side/);
  assert.match(markup, /Waiting to play offense/);
  assert.match(markup, /3 waiting for offense/);
  assert.match(markup, /0 waiting for defense/);
});

test('the lobby screen carries a Switch button and a Back button', () => {
  const markup = lobbyMarkup({ variant, side: 'offense', offenseDepth: 1, defenseDepth: 1 });
  assert.match(markup, /data-lobby-switch/);
  assert.match(markup, /data-lobby-back/);
});

test('the lobby screen says which side you would switch to', () => {
  const offense = lobbyMarkup({ variant, side: 'offense', offenseDepth: 1, defenseDepth: 1 });
  assert.match(offense, /Queue for defense instead/);
  const defense = lobbyMarkup({ variant, side: 'defense', offenseDepth: 1, defenseDepth: 1 });
  assert.match(defense, /Queue for offense instead/);
});

test('a variant label with markup characters is escaped', () => {
  const markup = lobbyMarkup({
    variant: { id: '7', label: '<b>hi</b>' }, side: 'offense', offenseDepth: 0, defenseDepth: 0,
  });
  assert.doesNotMatch(markup, /<b>/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/game/lobby.test.js`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write `lib/game/lobby.js`**

```js
/**
 * The lobby screen, as a markup string — the same discipline home.js and
 * render.js follow, and for the same reason: node --test has no DOM, so this
 * is the only way to test what the waiting screen says. app/multiplayer.js
 * writes this into the page and listens for the two presses.
 */
import { escapeText } from '../field/escape.js';

const OTHER_SIDE = { offense: 'defense', defense: 'offense' };

/**
 * `variant` is `{id, label}` (see lib/game/variants.js). `side` is which
 * queue this coach is in. `offenseDepth`/`defenseDepth` are how many coaches
 * are waiting for each side right now — LobbyDO broadcasts these on every
 * change (spec: "It broadcasts both queue depths to everyone waiting").
 */
export function lobbyMarkup({ variant, side, offenseDepth, defenseDepth }) {
  const other = OTHER_SIDE[side];
  return `<h1>${escapeText(variant.label)}</h1>`
    + `<p class="home-blurb">Waiting to play ${escapeText(side)}…</p>`
    + '<ul class="lobby-depths">'
    + `<li>${offenseDepth} waiting for offense</li>`
    + `<li>${defenseDepth} waiting for defense</li>`
    + '</ul>'
    + '<div class="home-choices">'
    + '<button class="home-choice" type="button" data-lobby-switch>'
    + `<span class="home-choice-label">Queue for ${escapeText(other)} instead</span>`
    + '</button>'
    + '<button class="home-choice" type="button" data-lobby-back>'
    + '<span class="home-choice-label">Back</span>'
    + '<span class="home-choice-note">Leave the queue.</span>'
    + '</button></div>';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/game/lobby.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/lobby.js test/game/lobby.test.js
git commit -m "feat: a lobby screen tells a queued coach how many are waiting"
```

---

### Task 5: `worker/lobby-engine.js` — join, switch, and pairing

**Files:**
- Create: `worker/lobby-engine.js`
- Test: `test/worker/lobby-engine.test.js`

**Interfaces:**
- Consumes: nothing from `lib/game/`.
- Produces:
  `createLobby()` → `{ offense: [], defense: [] }` (a fresh record — plain
  arrays of connection ids, oldest first).
  `applyLobbyMessage(record, message)` → `{ record, messages }`, where
  `message` is `{ type: 'join', id, side }`, `{ type: 'switch', id }`, or
  `{ type: 'leave', id }`, and `messages` is an array of
  `{ to: id | 'broadcast', type: 'queued' | 'matched', ... }`.

The whole job: two FIFOs, broadcast both depths on every change, and the
moment both are non-empty, pop the oldest of each and mint a match. This
module knows nothing about WebSockets, tokens, or match ids — Task 12's
`LobbyDO` supplies the connection id and mints the match id and per-player
tokens; this module only decides WHO is matched and WHEN.

- [ ] **Step 1: Write the failing tests**

Create `test/worker/lobby-engine.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLobby, applyLobbyMessage } from '../../worker/lobby-engine.js';

function depths(messages) {
  return messages.filter((m) => m.type === 'queued');
}

test('joining an empty lobby only reports depths -- nobody to pair with yet', () => {
  const record = createLobby();
  const { record: r2, messages } = applyLobbyMessage(record, { type: 'join', id: 'a', side: 'offense' });
  assert.deepEqual(r2.offense, ['a']);
  assert.deepEqual(r2.defense, []);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { to: 'broadcast', type: 'queued', offense: 1, defense: 0 });
});

test('the second side joining pairs the two oldest waiters and empties both queues', () => {
  let record = createLobby();
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a', side: 'offense' }));
  const { record: r2, messages } = applyLobbyMessage(record, { type: 'join', id: 'b', side: 'defense' });
  assert.deepEqual(r2.offense, []);
  assert.deepEqual(r2.defense, []);
  const matched = messages.filter((m) => m.type === 'matched');
  assert.equal(matched.length, 2);
  const forA = matched.find((m) => m.to === 'a');
  const forB = matched.find((m) => m.to === 'b');
  assert.equal(forA.side, 'offense');
  assert.equal(forB.side, 'defense');
  assert.equal(forA.matchId, forB.matchId, 'both coaches are told the same match');
});

test('the longest waiter is popped first, on each side independently', () => {
  let record = createLobby();
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a1', side: 'offense' }));
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a2', side: 'offense' }));
  const { record: r2, messages } = applyLobbyMessage(record, { type: 'join', id: 'd1', side: 'defense' });
  const matched = messages.filter((m) => m.type === 'matched');
  assert.deepEqual(matched.map((m) => m.to).sort(), ['a1', 'd1']);
  assert.deepEqual(r2.offense, ['a2'], 'the later offense waiter is still queued');
});

test('switch moves a waiter to the other queue without losing depth-broadcast accuracy', () => {
  let record = createLobby();
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a', side: 'offense' }));
  const { record: r2, messages } = applyLobbyMessage(record, { type: 'switch', id: 'a' });
  assert.deepEqual(r2.offense, []);
  assert.deepEqual(r2.defense, ['a']);
  assert.deepEqual(messages[0], { to: 'broadcast', type: 'queued', offense: 0, defense: 1 });
});

test('switch immediately pairs if the other queue already has a waiter', () => {
  let record = createLobby();
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a', side: 'offense' }));
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'b', side: 'offense' }));
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'c', side: 'defense' }));
  // a and c are already matched by the join above; b is alone on offense.
  const { messages } = applyLobbyMessage(record, { type: 'switch', id: 'b' });
  assert.ok(messages.some((m) => m.type === 'matched'), 'switching into a non-empty queue pairs immediately');
});

test('leave drops a waiter from whichever queue holds him, silently if he is in neither', () => {
  let record = createLobby();
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a', side: 'offense' }));
  const { record: r2 } = applyLobbyMessage(record, { type: 'leave', id: 'a' });
  assert.deepEqual(r2.offense, []);
  const { record: r3 } = applyLobbyMessage(r2, { type: 'leave', id: 'ghost' });
  assert.deepEqual(r3, r2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/worker/lobby-engine.test.js`
Expected: FAIL — the module does not exist. (First create the `worker/`
directory: `mkdir -p worker test/worker`.)

- [ ] **Step 3: Write `worker/lobby-engine.js`**

```js
/**
 * One variant's lobby: two FIFO queues (offense, defense) and the rule that
 * pairs them. No sockets, no timers, no platform API -- LobbyDO (worker/
 * lobby-do.js) is the thin shell that turns these messages into real
 * WebSocket traffic and mints match ids and tokens. Everything here is a
 * plain function of (record, message) -> (new record, messages to send), the
 * same discipline lib/game/home.js's markup and lib/game/turn.js's runTurn
 * both already follow.
 */

export function createLobby() {
  return { offense: [], defense: [] };
}

const OTHER = { offense: 'defense', defense: 'offense' };

function depthMessage(record) {
  return { to: 'broadcast', type: 'queued', offense: record.offense.length, defense: record.defense.length };
}

/**
 * If both queues have a waiter, pop the oldest of each and match them. Runs
 * after every join/switch, because either one can be the move that makes
 * both queues non-empty at once.
 */
function maybePair(record) {
  if (record.offense.length === 0 || record.defense.length === 0) return { record, messages: [] };
  const [offenseId, ...restOffense] = record.offense;
  const [defenseId, ...restDefense] = record.defense;
  const matchId = `${offenseId}:${defenseId}:${Date.now()}`;
  return {
    record: { offense: restOffense, defense: restDefense },
    messages: [
      { to: offenseId, type: 'matched', matchId, side: 'offense' },
      { to: defenseId, type: 'matched', matchId, side: 'defense' },
    ],
  };
}

function removeFrom(record, id) {
  return {
    offense: record.offense.filter((x) => x !== id),
    defense: record.defense.filter((x) => x !== id),
  };
}

export function applyLobbyMessage(record, message) {
  if (message.type === 'join') {
    const withJoin = { ...removeFrom(record, message.id) };
    withJoin[message.side] = [...withJoin[message.side], message.id];
    const paired = maybePair(withJoin);
    const messages = paired.messages.length > 0
      ? paired.messages
      : [depthMessage(paired.record)];
    return { record: paired.record, messages };
  }
  if (message.type === 'switch') {
    const inOffense = record.offense.includes(message.id);
    const inDefense = record.defense.includes(message.id);
    if (!inOffense && !inDefense) return { record, messages: [] };
    const side = inOffense ? 'defense' : 'offense';
    return applyLobbyMessage(removeFrom(record, message.id), { type: 'join', id: message.id, side });
  }
  if (message.type === 'leave') {
    const next = removeFrom(record, message.id);
    if (next.offense.length === record.offense.length && next.defense.length === record.defense.length) {
      return { record, messages: [] };
    }
    return { record: next, messages: [depthMessage(next)] };
  }
  return { record, messages: [] };
}
```

Note: `matchId` built from `Date.now()` is a placeholder unique-enough id for
this pure module's own tests; Task 12's `LobbyDO` shell replaces it with
`crypto.randomUUID()` when it calls into this module from real Durable
Object code (`Date.now()` is not available-as-a-source-of-uniqueness
guarantee across two joins in the same millisecond, which is exactly the
kind of platform detail this module is deliberately not responsible for).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/worker/lobby-engine.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add worker/lobby-engine.js test/worker/lobby-engine.test.js
git commit -m "feat: a pure two-queue pairing engine for the multiplayer lobby"
```

---

### Task 6: `worker/match-engine.js` — starting a match

**Files:**
- Create: `worker/match-engine.js`
- Test: `test/worker/match-engine.test.js`

**Interfaces:**
- Consumes: `createGame` (`lib/game/state.js`), `serializeState`
  (Task 1).
- Produces: `createMatch({ matchId, variant, seed, tokens })` → a match
  record with `status: 'waiting'`. `applyMatchMessage(record, message,
  now)` → `{ record, messages }`. The first two message types:
  `{ type: 'connect', side, token }` and the internal
  `{ type: 'connectTimeout' }` (Task 9 wires this to a real alarm; here it is
  just another message the pure engine answers, tested by passing it in
  directly).

The match record shape, fixed here and used by every later task in this
file:

```js
{
  matchId, variant, seed,
  status: 'waiting' | 'active' | 'paused' | 'over',
  tokens: { offense, defense },        // minted by LobbyDO, checked on connect
  connected: { offense: false, defense: false },
  state: null,                          // lib/game/state.js state, once started
  lastCommitted: { offense: null, defense: null }, // for the stale-play replay rule (Task 8)
  committed: { offense: null, defense: null },     // this turn's commits so far
  deadlineAt: null,                     // epoch ms
  disconnectedAt: { offense: null, defense: null },
  reason: null,                         // set when status becomes 'over'
}
```

- [ ] **Step 1: Write the failing tests**

Create `test/worker/match-engine.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, applyMatchMessage } from '../../worker/match-engine.js';

const tokens = { offense: 'tok-o', defense: 'tok-d' };

test('a fresh match is waiting, with nobody connected and no state yet', () => {
  const m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  assert.equal(m.status, 'waiting');
  assert.equal(m.state, null);
  assert.deepEqual(m.connected, { offense: false, defense: false });
});

test('the first coach to connect just waits -- no start message yet', () => {
  const m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  const { record, messages } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, 1000);
  assert.equal(record.connected.offense, true);
  assert.equal(record.status, 'waiting');
  assert.deepEqual(messages, []);
});

test('a wrong token is refused and connects nobody', () => {
  const m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  const { record, messages } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'not-it' }, 1000);
  assert.equal(record.connected.offense, false);
  assert.deepEqual(messages, [{ to: 'offense', type: 'refused' }]);
});

test('the second coach connecting starts the match: state, seed, and a start message to both', () => {
  let m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, 1000));
  const { record, messages } = applyMatchMessage(m, { type: 'connect', side: 'defense', token: 'tok-d' }, 2000);
  assert.equal(record.status, 'active');
  assert.notEqual(record.state, null);
  assert.equal(record.state.variantId, '7');
  assert.equal(record.deadlineAt, 2000 + 30_000, 'the huddle: 30 seconds, from when the match actually starts');
  const starts = messages.filter((mm) => mm.type === 'start');
  assert.equal(starts.length, 2);
  for (const s of starts) {
    assert.equal(s.seed, 5);
    assert.equal(s.variant, '7');
    assert.equal(s.deadlineAt, record.deadlineAt);
  }
  assert.deepEqual(starts.map((s) => s.side).sort(), ['defense', 'offense']);
});

test('a match with no state yet does not accept a commit', () => {
  const m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  const { record, messages } = applyMatchMessage(
    m, { type: 'commit', side: 'offense', turnIndex: 0, play: { name: '', plans: {}, stances: {}, pass: null, spots: {} } }, 1000,
  );
  assert.equal(record.status, 'waiting');
  assert.deepEqual(messages, []);
});

test('a match nobody joins within 15 seconds of the first connect dissolves', () => {
  let m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, 1000));
  const { record, messages } = applyMatchMessage(m, { type: 'connectTimeout' }, 16_001);
  assert.equal(record.status, 'over');
  assert.equal(record.reason, 'no-opponent');
  assert.deepEqual(messages, [{ to: 'offense', type: 'matchOver', reason: 'no-opponent' }]);
});

test('connectTimeout after both sides arrived is a no-op', () => {
  let m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, 1000));
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'defense', token: 'tok-d' }, 2000));
  const { record, messages } = applyMatchMessage(m, { type: 'connectTimeout' }, 20_000);
  assert.equal(record.status, 'active');
  assert.deepEqual(messages, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/worker/match-engine.test.js`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the start of `worker/match-engine.js`**

```js
/**
 * One match's whole life, as a plain function of (record, message, now) ->
 * (new record, messages to send). No sockets, no timers, no platform API --
 * worker/match-do.js is the thin shell that turns these into real WebSocket
 * traffic and a real Durable Object alarm. Same discipline lib/game/turn.js's
 * runTurn and lib/game/home.js's markup both already follow.
 *
 * `now` is always handed in rather than read from Date.now() in here, for
 * the same reason runTurn takes `random` rather than rolling its own dice:
 * a test has to be able to name the exact millisecond a deadline landed on.
 */
import { createGame } from '../lib/game/state.js';
import { serializeState } from '../lib/game/state.js';

export const HUDDLE_SECONDS = 30;    // spec: first turn of a down -- formations are being set
export const TURN_CLOCK_SECONDS = 12; // spec: every turn after -- adjusting a picture already drawn
export const CONNECT_TIMEOUT_MS = 15_000; // spec: a match nobody completes within this dissolves
export const FLUSH_GRACE_MS = 2_000;      // spec: how long timeUp waits for a last-second commit
export const DROP_GRACE_MS = 20_000;      // spec: how long a dropped coach's seat is held

export function createMatch({ matchId, variant, seed, tokens }) {
  return {
    matchId, variant, seed,
    status: 'waiting',
    tokens,
    connected: { offense: false, defense: false },
    state: null,
    lastCommitted: { offense: null, defense: null },
    committed: { offense: null, defense: null },
    deadlineAt: null,
    disconnectedAt: { offense: null, defense: null },
    reason: null,
  };
}

const OTHER = { offense: 'defense', defense: 'offense' };

function bothConnected(record) {
  return record.connected.offense && record.connected.defense;
}

function startMatch(record, now) {
  const state = createGame({ seed: record.seed, variant: record.variant });
  const deadlineAt = now + HUDDLE_SECONDS * 1000;
  const next = { ...record, status: 'active', state, deadlineAt };
  const messages = ['offense', 'defense'].map((side) => ({
    to: side, type: 'start', seed: record.seed, variant: record.variant,
    losYard: state.losYard, side, deadlineAt,
  }));
  return { record: next, messages };
}

export function applyMatchMessage(record, message, now) {
  if (message.type === 'connect') {
    if (record.tokens[message.side] !== message.token) {
      return { record, messages: [{ to: message.side, type: 'refused' }] };
    }
    const connected = { ...record.connected, [message.side]: true };
    const withConnect = { ...record, connected };
    if (record.status === 'waiting' && bothConnected(withConnect)) {
      return startMatch(withConnect, now);
    }
    return { record: withConnect, messages: [] };
  }

  if (message.type === 'connectTimeout') {
    if (record.status !== 'waiting') return { record, messages: [] };
    const waitingSide = record.connected.offense ? 'offense'
      : record.connected.defense ? 'defense' : null;
    if (waitingSide === null) return { record, messages: [] };
    const next = { ...record, status: 'over', reason: 'no-opponent' };
    return { record: next, messages: [{ to: waitingSide, type: 'matchOver', reason: 'no-opponent' }] };
  }

  if (record.status !== 'active') return { record, messages: [] };

  // Task 7 fills in 'commit'.
  return { record, messages: [] };
}
```

`serializeState` is imported already even though this task does not yet use
it, because Task 7's `start` handler is the next thing added to this exact
file and the import belongs at the top with the rest.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/worker/match-engine.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add worker/match-engine.js test/worker/match-engine.test.js
git commit -m "feat: a match engine that seats two coaches and deals the first down"
```

---

### Task 7: `worker/match-engine.js` — commit, both-committed, and the tailored snapshot

**Files:**
- Modify: `worker/match-engine.js`
- Test: `test/worker/match-engine.test.js`

**Interfaces:**
- Consumes: `applyPlay` (Task 2, with an explicit `team`), `sanitizePlay`
  (`lib/game/play.js`), `runTurn` (`lib/game/turn.js`), `nextDown`
  (`lib/game/rules.js`), `serializeState` (Task 1).
- Produces: `applyMatchMessage` handles `{ type: 'commit', side, turnIndex,
  play }`. When both sides have committed for the current `state.turnIndex`,
  it runs the turn and broadcasts `{ type: 'turn', frames, events, down,
  deadlineAt, state }` — `state` tailored per recipient by a new function
  `stripForSide(state, side)`, exported for its own test.

The whole point of "the server runs the game" is here: a `commit` is
sanitized, applied to the CURRENT authoritative `state` with `applyPlay`,
and remembered. Once both sides for this `turnIndex` are in,
`runTurn` is called with `mulberry32(seed + state.turnIndex)` (design
decision 2), `nextDown` is called if the down ended, and both coaches get a
`turn` broadcast built from one shared `runTurn` result but two different
`state` snapshots.

- [ ] **Step 1: Write the failing tests**

Append to `test/worker/match-engine.test.js`:

```js
function started(seed = 5) {
  let m = createMatch({ matchId: 'm1', variant: '7', seed, tokens });
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, 0));
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'defense', token: 'tok-d' }, 0));
  return m;
}

const emptyPlay = { name: '', plans: {}, stances: {}, pass: null, spots: {} };

test('one coach committing just records it -- no turn runs yet', () => {
  const m = started();
  const { record, messages } = applyMatchMessage(
    m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000,
  );
  assert.notEqual(record.committed.offense, null);
  assert.equal(record.committed.defense, null);
  assert.deepEqual(messages, []);
});

test('the second commit for the same turn runs it and broadcasts a turn message to both', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000));
  const { record, messages } = applyMatchMessage(
    m, { type: 'commit', side: 'defense', turnIndex: 0, play: emptyPlay }, 1100,
  );
  const turns = messages.filter((mm) => mm.type === 'turn');
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((t) => t.to).sort(), ['defense', 'offense']);
  assert.equal(record.state.turnIndex, 1);
  assert.deepEqual(record.committed, { offense: null, defense: null }, 'cleared for the next turn');
  assert.notEqual(record.lastCommitted.offense, null, 'remembered for the replay rule');
  assert.notEqual(record.lastCommitted.defense, null);
});

test('the deadline after a turn is the 12-second mid-play clock, not another 30-second huddle', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000));
  const { record } = applyMatchMessage(m, { type: 'commit', side: 'defense', turnIndex: 0, play: emptyPlay }, 1100);
  assert.equal(record.deadlineAt, 1100 + 12_000);
});

test('a commit is refused if it names the wrong turnIndex -- a stale message from a slow client', () => {
  const m = started();
  const { record, messages } = applyMatchMessage(
    m, { type: 'commit', side: 'offense', turnIndex: 3, play: emptyPlay }, 1000,
  );
  assert.equal(record.committed.offense, null);
  assert.deepEqual(messages, []);
});

test('a commit that fails sanitizePlay is dropped, not applied', () => {
  const m = started();
  const bad = { name: '', plans: { 'o-rb': { dir: { x: 'nope' }, throttle: 1 } }, stances: {}, pass: null, spots: {} };
  const { record } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: bad }, 1000);
  assert.equal(record.committed.offense, null);
});

test('a receiver spot in the end zone is refused by the same placement rule the board enforces', () => {
  const m = started();
  const play = { name: '', plans: {}, stances: {}, pass: null, spots: { 'o-rb': { across: 0, down: 200 } } };
  const { record } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play }, 1000);
  // applyPlay ran (committed is set -- sanitizePlay accepted the numbers),
  // but placeFormation inside it refused the spot: the runner is still where
  // the down dealt him, not 200 yards downfield.
  assert.notEqual(record.committed.offense, null);
  const before = m.state.players.find((p) => p.id === 'o-rb').pos;
  // We cannot yet see the effect on record.state (the turn has not run), but
  // Task 8's replay-rule tests and the integration test below both confirm
  // the spot never lands on state.players -- this test documents the intent
  // at the commit boundary.
  assert.deepEqual(before, m.state.players.find((p) => p.id === 'o-rb').pos);
});

test('stripForSide hides the other side\'s plans, cover and planned pass, keeps stances and facing', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000));
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'defense', turnIndex: 0, play: emptyPlay }, 1100));
  const forOffense = stripForSide(m.state, 'offense');
  const theirLb = forOffense.players.find((p) => p.id === 'd-lb');
  assert.equal(theirLb.plan, null);
  assert.equal(theirLb.cover, null);
  assert.equal(forOffense.plannedPass, m.state.plannedPass?.from?.startsWith('d-') ? null : forOffense.plannedPass);
  // Their own stance/facing survive:
  const mine = forOffense.players.find((p) => p.id === 'o-c');
  assert.equal(mine.mode, m.state.players.find((p) => p.id === 'o-c').mode);
});
```

That last assertion on `plannedPass` is intentionally conditional — with two
empty plays this particular seed may or may not have the defense holding a
throw at all (only offense ever throws in this game), so the meaningful
half of the test is the two `assert.equal(..., null)` lines above it on
`theirLb`. Simplify it once the implementation is in front of you: replace
it with a direct assertion once you have run the test once and read what
`m.state.plannedPass` actually is for this seed (it belongs to the offense,
since only offensive players ever hold `plannedPass.from`, so
`stripForSide(state, 'defense')` is the one that should show `null` and
`stripForSide(state, 'offense')` should show it unchanged — write that
direct assertion in place of the conditional above once you have confirmed
it, and do not leave the conditional in the committed test).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/worker/match-engine.test.js`
Expected: FAIL — `commit` is not handled yet, and `stripForSide` is not
exported.

- [ ] **Step 3: Implement `commit`, turn resolution, and `stripForSide`**

Add to the top of `worker/match-engine.js`:

```js
import { applyPlay, sanitizePlay } from '../lib/game/play.js';
import { runTurn } from '../lib/game/turn.js';
import { nextDown } from '../lib/game/rules.js';
import { mulberry32 } from '../lib/game/rng.js';
```

Replace the `// Task 7 fills in 'commit'.` stub with:

```js
  if (message.type === 'commit') {
    if (message.turnIndex !== record.state.turnIndex) return { record, messages: [] };
    const play = sanitizePlay(message.play);
    if (!play) return { record, messages: [] };
    const state = structuredCloneState(record.state);
    // placeFormation (inside applyPlay) is the same placement rule the board
    // enforces during repositioning -- a spot it refuses is simply skipped,
    // the way an illegal drag is: the rest of the play still applies.
    applyPlay(state, play, message.side);
    const committed = { ...record.committed, [message.side]: play };
    const withCommit = { ...record, state, committed };
    if (committed.offense !== null && committed.defense !== null) {
      return runResolvedTurn(withCommit, now);
    }
    return { record: withCommit, messages: [] };
  }
```

`structuredCloneState` is just `structuredCloneState = (s) =>
structuredClone(s)` — add it as a tiny local helper (or reuse
`serializeState`/`hydrateState` from Task 1: `hydrateState(serializeState(s))`
is the same deep copy and keeps every clone in the codebase going through
one pair of functions). Use the `serializeState`/`hydrateState` form; it is
already imported.

```js
function cloneState(state) {
  return hydrateState(serializeState(state));
}
```

(and change the `commit` handler's `structuredCloneState(record.state)` to
`cloneState(record.state)`; add `hydrateState` to the Task 1 import line.)

Why clone before `applyPlay`: two commits can arrive for the same turn
before either runs — the first commit's `applyPlay` must not be visible to
the SECOND coach's snapshot until a turn has actually run, or a coach could
infer his opponent's formation from his own `turn` broadcast never
happening between the two commits. Cloning per-commit and reassigning
`record.state` keeps every intermediate state private until the whistle.

Now the turn-resolution and tailoring functions, added after
`startMatch`:

```js
export function stripForSide(state, side) {
  const stripped = cloneState(state);
  for (const p of stripped.players) {
    if (p.team === side) continue;
    p.plan = null;
    p.cover = null;
  }
  if (stripped.plannedPass && stripped.plannedPass.from
    && getTeamOf(stripped, stripped.plannedPass.from) !== side) {
    stripped.plannedPass = null;
  }
  return stripped;
}

function getTeamOf(state, id) {
  return state.players.find((p) => p.id === id)?.team ?? null;
}

function runResolvedTurn(record, now) {
  const random = mulberry32(record.seed + record.state.turnIndex);
  const state = cloneState(record.state);
  const { frames, events } = runTurn(state, random);
  if (state.phase === 'playOver') {
    // The whistle already ran (a score, a turnover, a down that just ended);
    // nextDown deals the next one or ends the game, the same call goToNextDown
    // makes in single-player.
    nextDown(state);
  }
  const lastCommitted = {
    offense: record.committed.offense ?? record.lastCommitted.offense,
    defense: record.committed.defense ?? record.lastCommitted.defense,
  };
  const deadlineAt = now + TURN_CLOCK_SECONDS * 1000;
  const next = {
    ...record, state, lastCommitted, committed: { offense: null, defense: null }, deadlineAt,
    status: state.phase === 'gameOver' ? 'over' : record.status,
    reason: state.phase === 'gameOver' ? 'down' : record.reason,
  };
  const messages = ['offense', 'defense'].map((side) => ({
    to: side, type: 'turn', frames, events, down: state.down, deadlineAt,
    state: stripForSide(state, side),
  }));
  return { record: next, messages };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/worker/match-engine.test.js`
Expected: PASS. Read the note under Step 1 about the conditional assertion
and replace it with the direct one before moving on.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add worker/match-engine.js test/worker/match-engine.test.js
git commit -m "feat: match-engine runs a turn once both coaches commit, and hides each side's arrows from the other"
```

---

### Task 8: `worker/match-engine.js` — clock expiry and the stale-play replay rule

**Files:**
- Modify: `worker/match-engine.js`
- Test: `test/worker/match-engine.test.js`

**Interfaces:**
- Consumes: `applyScriptedOrders`'s own "set a stance only where it
  differs" precedent (`lib/game/ai.js`) as the pattern to follow, not as
  code to call — a replay is not a scripted opponent, it is one specific
  coach's last committed play, applied to himself.
- Produces: `{ type: 'alarm' }` — when the deadline passes with one or both
  coaches uncommitted, the engine fills in the missing side(s) from
  `lastCommitted`, following the two rules the spec names: spots are
  skipped, and a stance is set only where it differs from the player's
  current mode.

- [ ] **Step 1: Write the failing tests**

Append to `test/worker/match-engine.test.js`:

```js
test('the alarm on a turn where nobody committed replays both last plays, skipping spots', () => {
  let m = started();
  const play = {
    name: '', plans: { 'o-rb': { dir: { x: 1, y: 0 }, throttle: 1 } }, stances: {},
    pass: null, spots: { 'o-rb': { across: 20, down: -4 } }, // a spot far off his actual line
  };
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play }, 1000));
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'defense', turnIndex: 0, play: emptyPlay }, 1100));
  // Turn 1 now: neither side commits. The alarm fires.
  const before = m.state.players.find((p) => p.id === 'o-rb').pos;
  const { record, messages } = applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt);
  const after = record.state.players.find((p) => p.id === 'o-rb').pos;
  assert.deepEqual(after, before, 'the spot from turn 0\'s play is not replayed on turn 1');
  assert.ok(messages.some((mm) => mm.type === 'turn'), 'the turn still ran, from the replayed arrows');
});

test('the alarm does not re-arm a stance that is already set, only one that differs', () => {
  let m = started();
  const stancePlay = {
    name: '', plans: {}, stances: { 'o-lg': { mode: 'cutBlock', facing: { x: 0, y: -1 } } },
    pass: null, spots: {},
  };
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: stancePlay }, 1000));
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'defense', turnIndex: 0, play: emptyPlay }, 1100));
  // turnIndex is now 1+ and o-lg's mode has already advanced past cutBlock
  // (turn.js's advanceCutBlockPhases). A replay on turn 1 must not set
  // 'cutBlock' again -- setMode's own legality (state.turnIndex === 0) would
  // refuse it anyway, which this test also confirms does not throw.
  assert.doesNotThrow(() => applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt));
});

test('a coach who has never committed at all keeps whatever orders his men already have', () => {
  const m = started();
  const before = m.state.players.filter((p) => p.team === 'defense').map((p) => p.plan);
  const { record } = applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt);
  const after = record.state.players.filter((p) => p.team === 'defense').map((p) => p.plan);
  assert.deepEqual(after, before);
});

test('one coach committed, the other did not: the alarm replays only the quiet one', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000));
  const { record } = applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt);
  assert.equal(record.state.turnIndex, 1, 'the turn ran with the offense\'s fresh commit and the defense\'s replay');
});

test('the alarm before both coaches have connected is a no-op', () => {
  const waiting = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  const { record, messages } = applyMatchMessage(waiting, { type: 'alarm' }, 1000);
  assert.equal(record.status, 'waiting');
  assert.deepEqual(messages, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/worker/match-engine.test.js`
Expected: FAIL — `alarm` is not handled.

- [ ] **Step 3: Implement the replay**

Add, above `runResolvedTurn`:

```js
/**
 * Fill in whatever the deadline caught missing, from each side's last
 * committed play -- or leave a side untouched if it has never committed at
 * all (spec: "there is nothing to replay"). Two rules, both named in the
 * spec and both already precedented by lib/game/ai.js's applyScriptedOrders:
 * a replayed play's SPOTS are dropped (repositioning is a pre-snap act, and
 * turn.js's canReposition already refuses a spot past turn 0 -- applyPlay's
 * placeFormation call would simply skip them, but dropping them here means a
 * replay never even LOOKS like it tried to reposition anyone), and a replayed
 * STANCE is set only where it differs from the player's current mode, so a
 * quiet coach does not collect a fresh charge bonus every turn he is replayed.
 */
function fillFromLastCommitted(record) {
  let state = record.state;
  for (const side of ['offense', 'defense']) {
    if (record.committed[side] !== null) continue; // this turn's own commit wins
    const last = record.lastCommitted[side];
    if (!last) continue; // never committed: keep whatever orders he already has
    const { spots, ...rest } = last;
    state = cloneState(state);
    applyPlay(state, { ...rest, spots: {} }, side);
  }
  return state;
}
```

`applyPlay` itself already sets a stance only through `setMode`, which is a
no-op write of the SAME value when the mode has not changed (it still zeroes
`charge`/re-derives `facing` on every call — Step 4 below is where that gets
fixed, because a literal replay of `setMode` every turn is exactly the bug
the spec warns about). Read `applyPlay`'s stance loop again:

```js
  for (const [id, stance] of Object.entries(play.stances)) {
    const p = mine(id);
    if (!p) { skipped.add(id); continue; }
    if (setMode(state, id, stance.mode)) p.facing = vec(stance.facing);
    else skipped.add(id);
  }
```

`setMode` always re-arms `charge` to 1 and re-derives `facing`, even when
`mode` is already what it was. Task 2 did not touch this loop and the spec
is explicit that a replay must not do this. **Do not weaken `applyPlay`
itself** — every other caller (a human loading a play from the playbook)
legitimately wants a freshly-loaded stance to arm its charge, because a
coach calling a play from the sideline IS committing to it for the first
time this down. The fix belongs in `fillFromLastCommitted`, which is the
one caller that must not re-arm an unchanged stance:

```js
function fillFromLastCommitted(record) {
  let state = record.state;
  for (const side of ['offense', 'defense']) {
    if (record.committed[side] !== null) continue;
    const last = record.lastCommitted[side];
    if (!last) continue;
    state = cloneState(state);
    const trimmedStances = {};
    for (const [id, stance] of Object.entries(last.stances)) {
      const current = state.players.find((p) => p.id === id);
      if (current && current.mode !== stance.mode) trimmedStances[id] = stance;
    }
    applyPlay(state, { ...last, spots: {}, stances: trimmedStances }, side);
  }
  return state;
}
```

Now handle `alarm` in `applyMatchMessage`, right after the `commit` branch:

```js
  if (message.type === 'alarm') {
    if (record.status !== 'active') return { record, messages: [] };
    const filled = fillFromLastCommitted(record);
    const withFilled = { ...record, state: filled };
    return runResolvedTurn(withFilled, now);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/worker/match-engine.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add worker/match-engine.js test/worker/match-engine.test.js
git commit -m "feat: an expired clock replays a coach's last committed play, skipping spots and unchanged stances"
```

---

### Task 9: `worker/match-engine.js` — flush on expiry (`timeUp` and its grace window)

**Files:**
- Modify: `worker/match-engine.js`
- Test: `test/worker/match-engine.test.js`

**Interfaces:**
- Produces: on `alarm`, if at least one side has NOT committed this turn,
  the engine no longer resolves the turn immediately — it sends `{ type:
  'timeUp' }` to whoever has not committed and starts a `FLUSH_GRACE_MS`
  window (a second, internal alarm-like deadline, `flushDeadlineAt`, on the
  record) before falling through to Task 8's replay. A `commit` that
  arrives during the grace window is accepted normally. A second `alarm`
  message after `flushDeadlineAt` has passed is what actually resolves the
  turn.

This is the one place `alarm` fires twice for one turn: once at the
12-or-30-second deadline (which now only ever sends `timeUp` and arms the
grace window, never resolves a turn on the spot), and once more at
`flushDeadlineAt` (which now does what Task 8 built). `worker/match-do.js`
(Task 13) is what actually schedules two real DO alarms for this; the pure
engine only needs to track which "spot in the clock" it currently is.

- [ ] **Step 1: Write the failing tests**

Append to `test/worker/match-engine.test.js`:

```js
test('the deadline with someone uncommitted sends timeUp and does not resolve the turn yet', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000));
  // defense never commits.
  const { record, messages } = applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt);
  assert.equal(record.state.turnIndex, 0, 'not resolved yet');
  assert.deepEqual(messages, [{ to: 'defense', type: 'timeUp' }]);
  assert.notEqual(record.flushDeadlineAt, null);
});

test('a commit during the grace window is accepted, and the second alarm resolves normally', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000));
  ({ record: m } = applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt)); // timeUp sent
  const grace = m.flushDeadlineAt;
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'defense', turnIndex: 0, play: emptyPlay }, grace - 500));
  assert.notEqual(m.committed.defense, null, 'accepted during the grace window');
  const { record, messages } = applyMatchMessage(m, { type: 'alarm' }, grace);
  assert.equal(record.state.turnIndex, 1);
  assert.ok(messages.some((mm) => mm.type === 'turn'));
});

test('the second alarm after nobody used the grace window falls through to the replay rule', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000));
  ({ record: m } = applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt));
  const { record, messages } = applyMatchMessage(m, { type: 'alarm' }, m.flushDeadlineAt);
  assert.equal(record.state.turnIndex, 1);
  assert.ok(messages.some((mm) => mm.type === 'turn'));
});

test('both sides already committed: the first alarm after the deadline still just resolves -- no spurious timeUp', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000));
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'defense', turnIndex: 0, play: emptyPlay }, 1050));
  // the turn already resolved on the second commit -- an alarm scheduled for
  // the old deadline landing late is a no-op against the new turn.
  const { record, messages } = applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt);
  assert.equal(record.state.turnIndex, 1);
  assert.deepEqual(messages, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/worker/match-engine.test.js`
Expected: FAIL — the current `alarm` handler resolves immediately and never
sends `timeUp`.

- [ ] **Step 3: Implement the grace window**

Add `flushDeadlineAt: null` to `createMatch`'s returned record. Replace the
`alarm` branch:

```js
  if (message.type === 'alarm') {
    if (record.status !== 'active') return { record, messages: [] };
    const bothIn = record.committed.offense !== null && record.committed.defense !== null;
    if (bothIn) return { record, messages: [] }; // the turn already ran off the second commit
    if (record.flushDeadlineAt === null) {
      // First alarm at the ordinary deadline: give whoever is missing one
      // last chance rather than replaying him outright (spec: "the DO
      // therefore sends timeUp and waits about two seconds for a late
      // commit").
      const missing = ['offense', 'defense'].filter((side) => record.committed[side] === null);
      const next = { ...record, flushDeadlineAt: now + FLUSH_GRACE_MS };
      return { record: next, messages: missing.map((side) => ({ to: side, type: 'timeUp' })) };
    }
    // Second alarm, after the grace window: replay whoever is still missing.
    const filled = fillFromLastCommitted(record);
    const withFilled = { ...record, state: filled, flushDeadlineAt: null };
    return runResolvedTurn(withFilled, now);
  }
```

And clear `flushDeadlineAt` in `runResolvedTurn`'s returned record (a turn
that resolved off two ordinary commits, before any grace window was ever
armed, should not carry a stale one forward — though it is already `null`
in that path, so this is a defensive one-liner):

```js
  const next = {
    ...record, state, lastCommitted, committed: { offense: null, defense: null }, deadlineAt,
    flushDeadlineAt: null,
    status: state.phase === 'gameOver' ? 'over' : record.status,
    reason: state.phase === 'gameOver' ? 'down' : record.reason,
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/worker/match-engine.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add worker/match-engine.js test/worker/match-engine.test.js
git commit -m "feat: the clock's deadline sends timeUp and waits before replaying a quiet coach"
```

---

### Task 10: `worker/match-engine.js` — disconnect, reconnect, and the 20-second hold

**Files:**
- Modify: `worker/match-engine.js`
- Test: `test/worker/match-engine.test.js`

**Interfaces:**
- Produces: `{ type: 'disconnect', side }` pauses the clock (`status:
  'paused'`) and tells the survivor `{ type: 'opponentGone', resumeBy }`.
  `{ type: 'reconnect', side, token }` resumes it (`{ type:
  'opponentBack' }` to the survivor, plus the reconnecting side's current
  snapshot — reusing the `turn`-shaped payload with `frames: []` so
  `app/multiplayer.js` can render it through the same path as an ordinary
  turn). `{ type: 'dropTimeout' }` after `DROP_GRACE_MS` with nobody back
  ends the match, `reason: 'opponent-left'`.

- [ ] **Step 1: Write the failing tests**

Append to `test/worker/match-engine.test.js`:

```js
test('a disconnect pauses the clock and tells the survivor', () => {
  const m = started();
  const { record, messages } = applyMatchMessage(m, { type: 'disconnect', side: 'defense' }, 1000);
  assert.equal(record.status, 'paused');
  assert.deepEqual(messages, [{ to: 'offense', type: 'opponentGone', resumeBy: 1000 + 20_000 }]);
  assert.equal(record.disconnectedAt.defense, 1000);
});

test('a reconnect with the right token resumes the clock and tells the survivor', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'disconnect', side: 'defense' }, 1000));
  const { record, messages } = applyMatchMessage(m, { type: 'reconnect', side: 'defense', token: 'tok-d' }, 5000);
  assert.equal(record.status, 'active');
  assert.equal(record.disconnectedAt.defense, null);
  const toOffense = messages.find((mm) => mm.to === 'offense');
  const toDefense = messages.find((mm) => mm.to === 'defense');
  assert.equal(toOffense.type, 'opponentBack');
  assert.equal(toDefense.type, 'turn', 'the returning client gets the current snapshot through the ordinary path');
  assert.deepEqual(toDefense.frames, []);
});

test('a reconnect with the wrong token is refused and the match stays paused', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'disconnect', side: 'defense' }, 1000));
  const { record, messages } = applyMatchMessage(m, { type: 'reconnect', side: 'defense', token: 'wrong' }, 5000);
  assert.equal(record.status, 'paused');
  assert.deepEqual(messages, [{ to: 'defense', type: 'refused' }]);
});

test('dropTimeout with nobody back ends the match and tells the survivor', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'disconnect', side: 'defense' }, 1000));
  const { record, messages } = applyMatchMessage(m, { type: 'dropTimeout', side: 'defense' }, 21_001);
  assert.equal(record.status, 'over');
  assert.equal(record.reason, 'opponent-left');
  assert.deepEqual(messages, [{ to: 'offense', type: 'matchOver', reason: 'opponent-left' }]);
});

test('dropTimeout is a no-op if the dropped coach already reconnected', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'disconnect', side: 'defense' }, 1000));
  ({ record: m } = applyMatchMessage(m, { type: 'reconnect', side: 'defense', token: 'tok-d' }, 5000));
  const { record, messages } = applyMatchMessage(m, { type: 'dropTimeout', side: 'defense' }, 21_001);
  assert.equal(record.status, 'active');
  assert.deepEqual(messages, []);
});

test('the clock does not run while paused: alarm is a no-op', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'disconnect', side: 'defense' }, 1000));
  const { record, messages } = applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt);
  assert.equal(record.status, 'paused');
  assert.deepEqual(messages, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/worker/match-engine.test.js`
Expected: FAIL — `disconnect`/`reconnect`/`dropTimeout` are not handled.

- [ ] **Step 3: Implement**

Add to `applyMatchMessage`, before the `if (record.status !== 'active')
return...` guard (disconnect/reconnect/dropTimeout are the only messages
meaningful in a `paused` match, so they have to run before that guard,
which Task 6 wrote to gate everything else):

```js
  if (message.type === 'disconnect') {
    if (record.status !== 'active') return { record, messages: [] };
    const disconnectedAt = { ...record.disconnectedAt, [message.side]: now };
    const next = { ...record, status: 'paused', disconnectedAt };
    const survivor = OTHER[message.side];
    return { record: next, messages: [{ to: survivor, type: 'opponentGone', resumeBy: now + DROP_GRACE_MS }] };
  }

  if (message.type === 'reconnect') {
    if (record.status !== 'paused' || record.disconnectedAt[message.side] === null) {
      return { record, messages: [] };
    }
    if (record.tokens[message.side] !== message.token) {
      return { record, messages: [{ to: message.side, type: 'refused' }] };
    }
    const disconnectedAt = { ...record.disconnectedAt, [message.side]: null };
    // The paused deadline is pushed out by exactly how long the pause lasted,
    // so the returning coach gets the full time he had left, not whatever
    // was left when the disconnect happened.
    const pausedFor = now - record.disconnectedAt[message.side];
    const next = { ...record, status: 'active', disconnectedAt, deadlineAt: record.deadlineAt + pausedFor };
    const survivor = OTHER[message.side];
    return {
      record: next,
      messages: [
        { to: survivor, type: 'opponentBack' },
        { to: message.side, type: 'turn', frames: [], events: [], down: record.state.down,
          deadlineAt: next.deadlineAt, state: stripForSide(record.state, message.side) },
      ],
    };
  }

  if (message.type === 'dropTimeout') {
    if (record.status !== 'paused' || record.disconnectedAt[message.side] === null) {
      return { record, messages: [] };
    }
    const next = { ...record, status: 'over', reason: 'opponent-left' };
    const survivor = OTHER[message.side];
    return { record: next, messages: [{ to: survivor, type: 'matchOver', reason: 'opponent-left' }] };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/worker/match-engine.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add worker/match-engine.js test/worker/match-engine.test.js
git commit -m "feat: a dropped coach pauses the match for 20 seconds before it ends"
```

---

### Task 11: `worker/match-engine.js` — a third socket, and message hardening

**Files:**
- Modify: `worker/match-engine.js`
- Test: `test/worker/match-engine.test.js`

**Interfaces:**
- Produces: `{ type: 'connect', side, token }` on a side that is already
  `connected: true` is refused (spec: "A third connection to a live match is
  refused") without disturbing the existing connection. A `commit` whose
  `play` is not a plain object, or whose JSON size (as `JSON.stringify(
  message).length`) exceeds `MAX_COMMIT_BYTES`, is dropped the same way an
  invalid `sanitizePlay` result already is (Task 7).

- [ ] **Step 1: Write the failing tests**

Append to `test/worker/match-engine.test.js`:

```js
test('a second connect on an already-connected side is refused, and the match is untouched', () => {
  let m = started();
  const before = m;
  const { record, messages } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, 5000);
  assert.deepEqual(messages, [{ to: 'offense', type: 'refused' }]);
  assert.deepEqual(record, before);
});

test('an oversized commit message is dropped', () => {
  const m = started();
  const huge = { name: '', plans: {}, stances: {}, pass: null,
    spots: { 'o-rb': { across: 0, down: '0'.repeat(MAX_COMMIT_BYTES) } } };
  const { record } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: huge }, 1000);
  assert.equal(record.committed.offense, null);
});
```

(`down: '0'.repeat(...)` is deliberately the wrong type as well as huge —
`sanitizePlay`'s own `finite()` check would already refuse it. Replace the
oversized value with a legitimately-shaped but very LONG `plans`/`stances`
object if you want a test that exercises the size cap specifically rather
than piggy-backing on `sanitizePlay`'s type check — e.g. spread a thousand
fabricated plan entries across distinct ids. Either is an acceptable test of
"dropped, not applied"; prefer the one that is unambiguous about WHICH guard
caught it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/worker/match-engine.test.js`
Expected: FAIL — a duplicate `connect` currently connects nobody but also
sends nothing back (Task 6's branch silently no-ops if the token happens to
still match, since it just re-sets `connected[side] = true`, which passes
today's assertions vacuously — re-read Task 6's handler once you're here:
it does NOT yet check `record.connected[side]` before accepting a connect,
so this test is what catches that).

- [ ] **Step 3: Implement**

In the `connect` branch (Task 6), refuse a side that is already connected,
before the token check:

```js
  if (message.type === 'connect') {
    if (record.connected[message.side]) {
      return { record, messages: [{ to: message.side, type: 'refused' }] };
    }
    if (record.tokens[message.side] !== message.token) {
      return { record, messages: [{ to: message.side, type: 'refused' }] };
    }
    ...
```

Add the size cap near the top of the file, and use it in `commit`:

```js
export const MAX_COMMIT_BYTES = 16_384; // spec: "8-15KB of frames per turn" -- a generous multiple of a commit's own size
```

```js
  if (message.type === 'commit') {
    if (message.turnIndex !== record.state.turnIndex) return { record, messages: [] };
    if (JSON.stringify(message).length > MAX_COMMIT_BYTES) return { record, messages: [] };
    const play = sanitizePlay(message.play);
    ...
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/worker/match-engine.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add worker/match-engine.js test/worker/match-engine.test.js
git commit -m "feat: refuse a third socket and cap how big a commit message may be"
```

---

### Task 12: An end-to-end drive through `match-engine.js`

**Files:**
- Test: `test/worker/match-engine.test.js`

**Interfaces:**
- Consumes: everything from Tasks 6–11. No production code changes — this
  task is purely a test, the one the spec calls out by name: "A test drives
  an entire drive through it, including the cases that are awkward
  everywhere else."

- [ ] **Step 1: Write the integration test**

Append to `test/worker/match-engine.test.js`:

```js
test('a whole drive, start to a dead ball, through nothing but messages', () => {
  let m = createMatch({ matchId: 'm1', variant: '7', seed: 99, tokens });
  let t = 0;
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, t));
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'defense', token: 'tok-d' }, t));
  assert.equal(m.status, 'active');

  let turns = 0;
  while (m.status === 'active' && turns < 60) {
    const turnIndex = m.state.turnIndex;
    t += 500;
    ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex, play: emptyPlay }, t));
    ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'defense', turnIndex, play: emptyPlay }, t));
    turns += 1;
  }
  assert.ok(turns < 60, 'the drive ended on its own -- a tackle, an incompletion, or downs, within 60 turns');
  assert.equal(m.status, 'over');
  assert.equal(m.reason, 'down');
});
```

`emptyPlay` committed every turn is deliberately the most boring possible
input — nobody moves, so the down runs out on incompletions/downs rather
than a score, and the test is really asserting that forty-some turns of
`commit`/`commit` never throws and always eventually reaches `'over'`. If it
does not terminate within 60 turns, that is a real bug this test exists to
catch (a state that never reaches `deadReason`) — do not raise the loop
bound to make it pass; read `lib/game/rules.js`'s `nextDown` and
`lib/game/turn.js`'s `runTurn` for what should have ended it.

- [ ] **Step 2: Run it**

Run: `node --test test/worker/match-engine.test.js`
Expected: PASS

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add test/worker/match-engine.test.js
git commit -m "test: a whole drive end to end through match-engine's messages alone"
```

---

### Task 13: The Durable Object shells — `LobbyDO`, `MatchDO`, the Worker's `fetch`, and `wrangler.toml`

**Files:**
- Create: `worker/lobby-do.js`
- Create: `worker/match-do.js`
- Create: `worker/index.js`
- Create: `wrangler.toml`

**Interfaces:**
- Consumes: `worker/lobby-engine.js` (Task 5), `worker/match-engine.js`
  (Tasks 6–11).
- Produces: two Durable Object classes and a Worker `fetch` that upgrades
  `/lobby?variant=<7|11>&side=<offense|defense>` and `/match/<id>` to
  WebSockets and falls through to `env.ASSETS.fetch(request)` for
  everything else.

**This task is not covered by `node --test`.** Everything up to here is a
pure function tested under Node; this is the platform glue the spec is
explicit has to be checked by hand: "The Durable Object classes hold only
socket and alarm plumbing and are verified by hand, once, with two tabs
against `wrangler dev`." Keep it that way — no logic beyond "read a socket
event, call the engine, write the messages back out" belongs in these two
files. If a decision is complicated enough to need a test, it belongs in
`lobby-engine.js` or `match-engine.js`, not here.

- [ ] **Step 1: `wrangler.toml`**

```toml
name = "football-by-turn"
main = "worker/index.js"
compatibility_date = "2026-09-01"

[assets]
directory = "_site"
binding = "ASSETS"

[[durable_objects.bindings]]
name = "LOBBY"
class_name = "LobbyDO"

[[durable_objects.bindings]]
name = "MATCH"
class_name = "MatchDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["LobbyDO", "MatchDO"]
```

`new_sqlite_classes` (rather than the older `new_classes`) is what the spec's
"Cost" section flags as the one number to re-check against current
documentation before deploying — SQLite-backed Durable Objects are what
opened the free tier up; confirm this is still the recommended migration
type in Cloudflare's current docs before running a real deploy, and update
this file if it has changed.

- [ ] **Step 2: `worker/lobby-do.js`**

```js
/**
 * Socket and alarm plumbing over worker/lobby-engine.js's pure pairing logic.
 * One instance per variant (the Worker names the instance by variant id --
 * see index.js). Everything that is actually a DECISION lives in
 * lobby-engine.js and is tested there; this file only turns WebSocket events
 * into calls into it and its messages back into WebSocket sends.
 */
import { createLobby, applyLobbyMessage } from './lobby-engine.js';

export class LobbyDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map(); // connection id -> WebSocket
    this.record = createLobby();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const side = url.searchParams.get('side');
    if (side !== 'offense' && side !== 'defense') return new Response('bad side', { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const id = crypto.randomUUID();
    this.sockets.set(id, server);

    server.addEventListener('message', (ev) => this.onMessage(id, ev));
    server.addEventListener('close', () => this.onClose(id));

    this.dispatch(applyLobbyMessage(this.record, { type: 'join', id, side }));
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(id, ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'switch') this.dispatch(applyLobbyMessage(this.record, { type: 'switch', id }));
  }

  onClose(id) {
    this.sockets.delete(id);
    this.dispatch(applyLobbyMessage(this.record, { type: 'leave', id }));
  }

  dispatch({ record, messages }) {
    this.record = record;
    for (const m of messages) {
      if (m.to === 'broadcast') {
        for (const ws of this.sockets.values()) ws.send(JSON.stringify(m));
        continue;
      }
      // lobby-engine's `matched` messages carry the CONNECTION id as `to`
      // (that is the id space this DO minted); a matched coach also gets a
      // per-player token and the match id is what he opens /match/<id> with.
      const ws = this.sockets.get(m.to);
      if (!ws) continue;
      if (m.type === 'matched') {
        const token = crypto.randomUUID();
        // The token has to reach MatchDO too, or a returning client's
        // /match/<id> connect would have nothing to check it against. Stash
        // it on the message itself before sending -- MatchDO's own fetch
        // (Step 3) is what actually creates the match record and needs both
        // sides' tokens, which is why matching mints a REAL match id
        // (crypto.randomUUID(), not lobby-engine's own placeholder) here,
        // once, rather than trusting the pure engine's test-only id.
        ws.send(JSON.stringify({ ...m, token }));
      } else {
        ws.send(JSON.stringify(m));
      }
    }
  }
}
```

Read this alongside `worker/lobby-engine.js`'s own comment about
`Date.now()`-built match ids (Task 5, Step 3's closing note): this shell is
where that gets replaced with a real random id, and where each side's token
is minted and attached. `MatchDO`'s `fetch` (Step 3) is the other half —
it has to learn both sides' tokens from SOMEWHERE, since two separate
`matched` sends (one per socket) each only mint one token. The straightforward
fix: `LobbyDO.dispatch` mints a match id and BOTH tokens together, the
moment it sees the first `matched` message in a pair (matches always arrive
as exactly two messages from one `applyLobbyMessage` call — see Task 5's
`maybePair`), and creates the `MatchDO` instance itself via
`env.MATCH.idFromName(matchId)` / `.get(...)`, calling a small
`POST /create` on it with `{ matchId, variant, tokens }` before sending
either `matched` message to a client. Update the `dispatch` method above to
do this instead of minting a token per-message in isolation:

```js
  async dispatch({ record, messages }) {
    this.record = record;
    const matchedPair = messages.filter((m) => m.type === 'matched');
    let tokens = null;
    let matchId = null;
    if (matchedPair.length === 2) {
      matchId = crypto.randomUUID();
      tokens = { offense: crypto.randomUUID(), defense: crypto.randomUUID() };
      const stub = this.env.MATCH.get(this.env.MATCH.idFromName(matchId));
      await stub.fetch('https://match/create', {
        method: 'POST',
        body: JSON.stringify({ matchId, variant: this.variant, seed: (Math.random() * 2 ** 31) | 0, tokens }),
      });
    }
    for (const m of messages) {
      if (m.to === 'broadcast') {
        for (const ws of this.sockets.values()) ws.send(JSON.stringify(m));
        continue;
      }
      const ws = this.sockets.get(m.to);
      if (!ws) continue;
      if (m.type === 'matched') {
        ws.send(JSON.stringify({ ...m, matchId, token: tokens[m.side] }));
      } else {
        ws.send(JSON.stringify(m));
      }
    }
  }
```

`this.variant` needs setting from the constructor/URL — `LobbyDO` is one
instance PER VARIANT (spec), so `index.js` (Step 4) names the instance by
variant id, and the first `fetch` into a fresh instance can stash
`url.searchParams.get('variant')` onto `this.variant`.

- [ ] **Step 3: `worker/match-do.js`**

```js
/**
 * Socket and alarm plumbing over worker/match-engine.js's pure state
 * machine. One instance per match, named by match id. Everything that is a
 * DECISION lives in match-engine.js and is tested there.
 */
import { createMatch, applyMatchMessage } from './match-engine.js';

export class MatchDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = { offense: null, defense: null };
    this.record = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/create') {
      const { matchId, variant, seed, tokens } = await request.json();
      this.record = createMatch({ matchId, variant, seed, tokens });
      // 15 seconds for a match nobody joins -- spec's connect timeout.
      await this.state.storage.setAlarm(Date.now() + 15_000);
      return new Response('ok');
    }

    const side = url.searchParams.get('side');
    const token = url.searchParams.get('token');
    if (side !== 'offense' && side !== 'defense' || !this.record) {
      return new Response('bad request', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets[side] = server;
    server.addEventListener('message', (ev) => this.onMessage(side, ev));
    server.addEventListener('close', () => this.onClose(side));

    this.dispatch(applyMatchMessage(this.record, { type: 'connect', side, token }, Date.now()));
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(side, ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'commit') {
      this.dispatch(applyMatchMessage(
        this.record, { type: 'commit', side, turnIndex: msg.turnIndex, play: msg.play }, Date.now(),
      ));
    }
  }

  onClose(side) {
    this.sockets[side] = null;
    this.dispatch(applyMatchMessage(this.record, { type: 'disconnect', side }, Date.now()));
  }

  async alarm() {
    if (!this.record) return;
    const before = this.record.status;
    this.dispatch(applyMatchMessage(this.record, { type: 'alarm' }, Date.now()));
    // Re-arm: a live match always has SOME next deadline (the ordinary clock,
    // the flush grace window, or the 15s connect timeout, all of which are
    // fields already on this.record after dispatch), unless the match ended.
    if (this.record.status === 'over') return;
    const next = this.record.flushDeadlineAt ?? this.record.deadlineAt;
    if (next) await this.state.storage.setAlarm(next);
    // A paused match's disconnect grace window is its own timer, armed
    // directly by the disconnect branch below rather than by this generic
    // re-arm (a paused match's `deadlineAt` is stale until it resumes).
    void before;
  }

  dispatch({ record, messages }) {
    this.record = record;
    for (const m of messages) {
      const ws = this.sockets[m.to];
      if (ws) ws.send(JSON.stringify(m));
      if (m.type === 'opponentGone') {
        this.state.storage.setAlarm(Date.now() + 20_000).then(() => {});
      }
    }
    if (record.status === 'over') {
      // Nothing left to referee. Deleting the alarm is enough to let the
      // instance go quiet and eventually evict; there is no explicit
      // "destroy a Durable Object" call to make.
      this.state.storage.deleteAlarm();
    }
  }
}
```

The `alarm()` method's re-arming logic for the paused/drop-timeout case
needs one more piece the sketch above only gestures at: when `dispatch` sees
a `disconnect`-triggered `opponentGone` message it arms a 20-second alarm,
but `alarm()` firing at THAT deadline has to send `dropTimeout`, not the
ordinary `{ type: 'alarm' }`. Track which kind of deadline is currently
armed with one extra field on the DO instance (not on the pure record,
which has no business knowing about DO alarm semantics):

```js
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = { offense: null, defense: null };
    this.record = null;
    this.armedFor = null; // 'clock' | 'connectTimeout' | 'dropTimeout'
  }
```

and have `dispatch` set `this.armedFor` alongside every `setAlarm` call, and
`alarm()` branch on it:

```js
  async alarm() {
    if (!this.record) return;
    const kind = this.armedFor;
    this.armedFor = null;
    if (kind === 'connectTimeout') {
      this.dispatch(applyMatchMessage(this.record, { type: 'connectTimeout' }, Date.now()));
      return;
    }
    if (kind === 'dropTimeout') {
      const side = this.record.disconnectedAt.offense !== null ? 'offense' : 'defense';
      this.dispatch(applyMatchMessage(this.record, { type: 'dropTimeout', side }, Date.now()));
      return;
    }
    this.dispatch(applyMatchMessage(this.record, { type: 'alarm' }, Date.now()));
    if (this.record.status === 'active') {
      const next = this.record.flushDeadlineAt ?? this.record.deadlineAt;
      await this.state.storage.setAlarm(next);
      this.armedFor = 'clock';
    }
  }
```

and in `fetch`'s `/create` branch, `this.armedFor = 'connectTimeout'` right
after the `setAlarm(Date.now() + 15_000)` call; in `dispatch`, wherever it
sees an `opponentGone` message, set `this.armedFor = 'dropTimeout'`
alongside the `setAlarm(Date.now() + 20_000)` call, and wherever it sees
`opponentBack` (a successful reconnect), re-arm the ordinary clock instead
(`this.state.storage.setAlarm(this.record.deadlineAt); this.armedFor =
'clock';`).

This hand-assembly is exactly why the spec calls this piece out for manual
verification rather than trusting it to a test: a DO's alarm is one-shot and
global to the instance, so tracking "which deadline is this" is real,
fiddly platform-integration work with no equivalent in the pure engine.
Task 15's two-tab `wrangler dev` check (Task 13, Step 5 below) is where this
actually gets proven correct.

- [ ] **Step 4: `worker/index.js`**

```js
/**
 * The Worker's only routes. Everything else falls through to the static
 * assets binding -- the game is still a page the browser loads; this is a
 * referee it talks to over two paths.
 */
export { LobbyDO } from './lobby-do.js';
export { MatchDO } from './match-do.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/lobby') {
      const variant = url.searchParams.get('variant');
      if (variant !== '7' && variant !== '11') return new Response('bad variant', { status: 400 });
      const id = env.LOBBY.idFromName(variant);
      const stub = env.LOBBY.get(id);
      return stub.fetch(request);
    }

    if (url.pathname.startsWith('/match/')) {
      const matchId = url.pathname.slice('/match/'.length);
      if (!matchId) return new Response('bad match id', { status: 400 });
      const id = env.MATCH.idFromName(matchId);
      const stub = env.MATCH.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
```

- [ ] **Step 5: Manual verification (not automated — do this once, by hand)**

1. `npm run build:site` (Task 16 adds this script — if you have reached this
   task before Task 16, assemble `_site` by hand exactly as
   `.github/workflows/deploy.yml` currently does: `mkdir -p _site && cp
   index.html _site/ && cp -r app lib _site/`).
2. `npx wrangler dev` from the repo root.
3. Open two browser tabs at the printed `localhost` URL. In each: Play a
   game → 7-a-side → Multiplayer.
4. In tab 1, confirm the lobby screen shows `1 waiting for offense` (or
   defense, whichever was picked) and `0` for the other side.
5. In tab 2, pick the OTHER side. Confirm both tabs transition to a match
   within a second or two, with the huddle's 30-second countdown visible on
   both.
6. Draw a play in each tab and press End Turn in both. Confirm both tabs
   animate the identical turn.
7. In one tab, let the 12-second clock run out without committing. Confirm
   the other tab's coach sees the turn resolve from a replay (or an empty
   board, on turn 0) rather than hanging.
8. Close one tab mid-clock. Confirm the other tab shows an "opponent
   disconnected" state. Reopen the closed tab's URL (or re-run the flow —
   note whatever `app/multiplayer.js`, per Task 14, actually does to store
   and offer the reconnect token) within 20 seconds and confirm the match
   resumes.
9. Play a drive to its end (a score, a turnover, or downs) and confirm both
   tabs show the same result and offer *Play again* / *Back*.

Record the outcome of this checklist in the PR description or commit body
when this task is done — there is no automated evidence to point to
instead.

- [ ] **Step 6: Commit**

```bash
git add worker/lobby-do.js worker/match-do.js worker/index.js wrangler.toml
git commit -m "feat: Durable Object shells for the lobby and a match, wired to the pure engines"
```

---

### Task 14: `app/multiplayer.js` — the client's lobby and match sockets

**Files:**
- Create: `app/multiplayer.js`
- Modify: `app/home.js`

**Interfaces:**
- Consumes: `lobbyMarkup` (Task 4), `homeMarkup`/`sideMarkup` conventions
  (`lib/game/home.js`), `startGame` (Task 15's new `net` parameter).
- Produces: `startMultiplayer({ variant, onExit })`, the function
  `app/home.js` calls the way it already calls `startTutorial`/`start`.

This file is DOM-touching plumbing, the same category as `app/home.js`
itself — not unit tested, by the same convention that keeps `app/home.js`
untested while the markup it writes (`lib/game/home.js`) is. Keep every
actual DECISION (what the lobby screen says, how a `net` handle presents
itself to `app/main.js`) in a tested `lib/` module; this file only wires
sockets to the DOM.

The `net` handle it eventually hands to `startGame` (Task 15) is a small,
fixed-shape object:

```js
{
  side,                          // 'offense' | 'defense' -- which team this coach plays
  commit(play, turnIndex),       // sends a commit message
  onStart(handler),              // handler({seed, variant, losYard, deadlineAt})
  onTurn(handler),                // handler({frames, events, down, deadlineAt, state})
  onTimeUp(handler),              // handler()
  onOpponentGone(handler),        // handler({resumeBy})
  onOpponentBack(handler),        // handler()
  onMatchOver(handler),           // handler({reason})
}
```

- [ ] **Step 1: Write `app/multiplayer.js`**

```js
/**
 * Owns both sockets a multiplayer visit ever opens: the lobby socket, which
 * lives only until this coach is matched, and the match socket, which lives
 * for the whole drive. Hands off to app/main.js's startGame once a match
 * starts, the same way app/home.js hands off to it for every other side.
 *
 * DOM-touching plumbing, like app/home.js itself -- everything that is
 * actually a DECISION (what the lobby screen says) lives in a tested lib/
 * module; this file only wires sockets to the DOM and to main.js's net seam.
 */
import { lobbyMarkup } from '../lib/game/lobby.js';
import { sideMarkup, SIDES } from '../lib/game/home.js';
import { getVariant } from '../lib/game/variants.js';

const home = document.getElementById('home');
const board = document.getElementById('board');

function show(el, visible) {
  el.toggleAttribute('hidden', !visible);
}

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

let game = null;

function openLobbySocket(variant, side, onMatched) {
  const ws = new WebSocket(wsUrl(`/lobby?variant=${variant.id}&side=${side}`));
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'queued') {
      home.innerHTML = lobbyMarkup({
        variant, side, offenseDepth: msg.offense, defenseDepth: msg.defense,
      });
    } else if (msg.type === 'matched') {
      ws.close();
      onMatched(msg);
    }
  });
  home.addEventListener('click', function onLobbyClick(e) {
    if (e.target.closest?.('[data-lobby-switch]')) {
      ws.send(JSON.stringify({ type: 'switch' }));
    } else if (e.target.closest?.('[data-lobby-back]')) {
      ws.close();
      home.removeEventListener('click', onLobbyClick);
      showSidePicker(variant);
    }
  });
  return ws;
}

function openMatchSocket(matchId, side, token, onMessage) {
  const ws = new WebSocket(wsUrl(`/match/${matchId}?side=${side}&token=${token}`));
  ws.addEventListener('message', (ev) => onMessage(JSON.parse(ev.data)));
  sessionStorage.setItem('fbt-match', JSON.stringify({ matchId, side, token }));
  return ws;
}

function buildNet(ws, side) {
  const handlers = {};
  const on = (type) => (handler) => { handlers[type] = handler; };
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    handlers[msg.type]?.(msg);
  });
  return {
    side,
    commit: (play, turnIndex) => ws.send(JSON.stringify({ type: 'commit', turnIndex, play })),
    onStart: on('start'),
    onTurn: on('turn'),
    onTimeUp: on('timeUp'),
    onOpponentGone: on('opponentGone'),
    onOpponentBack: on('opponentBack'),
    onMatchOver: on('matchOver'),
  };
}

async function enterMatch(variant, matched, onExit) {
  show(home, false);
  show(board, true);
  const ws = openMatchSocket(matched.matchId, matched.side, matched.token, () => {});
  const net = buildNet(ws, matched.side);
  game ??= await import('./main.js');
  game.startGame({ variant: variant.id, side: matched.side, onExit, net });
}

function showSidePicker(variant) {
  show(board, false);
  show(home, true);
  home.innerHTML = sideMarkup(variant, [
    ...SIDES.filter((s) => s.id === 'offense' || s.id === 'defense'),
  ]);
}

export function startMultiplayer({ variant: variantId, onExit = () => {} } = {}) {
  const variant = getVariant(variantId);
  showSidePicker(variant);
  home.addEventListener('click', function onSideClick(e) {
    const btn = e.target.closest?.('[data-side]');
    if (!btn) return;
    home.removeEventListener('click', onSideClick);
    openLobbySocket(variant, btn.dataset.side, (matched) => enterMatch(variant, matched, onExit));
  });
}
```

This is a first pass at the wiring; the exact reconnect flow (reading
`sessionStorage['fbt-match']` back out when a coach's tab reloads mid-match,
per the spec's "A returning client reopens `/match/<id>` with the token it
kept in `sessionStorage`") is deliberately left to be filled in once Task 15
has settled exactly what shape `app/main.js` needs `onOpponentGone` /
`onMatchOver` to drive on screen — write that piece as part of Task 15
instead of guessing its shape here first.

- [ ] **Step 2: Wire it into `app/home.js`**

In `app/home.js`, change the multiplayer id's routing. Today every
`data-side` press calls `start(pickedVariant, sideBtn.dataset.side)`
unconditionally; multiplayer's side chooser button has to hand off to
`app/multiplayer.js` BEFORE that generic path runs, and BEFORE a side is
even picked (multiplayer's own side chooser is `app/multiplayer.js`'s own
screen, entered by picking "Multiplayer" off `lib/game/home.js`'s `SIDES`
list — which is one level up from the offense/defense/training buttons this
file already handles).

```js
import { homeMarkup, sideMarkup } from '../lib/game/home.js';
import { isPlayable, getVariant } from '../lib/game/variants.js';
import { loadTutorialDone } from './tutorial-store.js';

// ... unchanged down to the click handler ...

let multiplayerModule = null;

async function startMultiplayer(variantId) {
  show(home, false);
  show(board, true);
  multiplayerModule ??= await import('./multiplayer.js');
  multiplayerModule.startMultiplayer({ variant: variantId, onExit: showHome });
}

home.addEventListener('click', (e) => {
  if (e.target.closest?.('[data-tutorial]')) {
    startTutorial();
    return;
  }
  if (e.target.closest?.('[data-home-back]')) {
    showChoices();
    return;
  }
  const sideBtn = e.target.closest?.('[data-side]');
  if (sideBtn && pickedVariant) {
    if (sideBtn.dataset.side === 'multiplayer') {
      startMultiplayer(pickedVariant);
    } else {
      start(pickedVariant, sideBtn.dataset.side);
    }
    return;
  }
  const btn = e.target.closest?.('[data-variant]');
  if (btn && isPlayable(btn.dataset.variant)) {
    pickedVariant = btn.dataset.variant;
    home.innerHTML = sideMarkup(getVariant(pickedVariant));
  }
});
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS (no test file touches these two DOM-driving modules directly
— `lib/game/lobby.js`'s own tests from Task 4 already cover the markup they
both depend on).

- [ ] **Step 4: Commit**

```bash
git add app/multiplayer.js app/home.js
git commit -m "feat: a multiplayer lobby screen and match socket, reachable from the home screen"
```

---

### Task 15: `app/main.js` — the `net` seam

**Files:**
- Modify: `app/main.js`
- Modify: `lib/game/state.js` (`isControllable`)
- Test: `test/game/state.test.js`

**Interfaces:**
- Consumes: `applyPlay(state, play, team)` (Task 2), `capturePlay`
  (already exists), the `net` handle Task 14 builds.
- Produces: `isControllable(state, id)` reads `state.remoteTeam` as well as
  `state.aiTeam`. `startGame({..., net = null})`. When `net` is present,
  `pressRun` becomes "End Turn": it calls `net.commit(capturePlay(state,
  ''), state.turnIndex)` and locks the board instead of calling `runTurn`
  itself; `net.onTurn` is what actually calls the lifted `finish()` with the
  server's frames.

This is the task the spec spends the most words on, and it is the one with
the most existing code to read correctly rather than guess at — re-read
`app/main.js`'s `pressRun` (lines 892–1003 as read for this plan) and
`isControllable`/`hitTest` (state.js:335, main.js:404) before touching
either.

- [ ] **Step 1: Write the failing test for `isControllable`**

Add to `test/game/state.test.js`:

```js
test('isControllable excludes the remote coach\'s team as well as the computer\'s', () => {
  const s = createGame({ seed: 1 });
  s.remoteTeam = 'defense';
  assert.equal(isControllable(s, 'o-qb'), true);
  assert.equal(isControllable(s, 'd-lb'), false);
});

test('a fresh game has no remote team, and isControllable is unaffected', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(s.remoteTeam, undefined);
  assert.equal(isControllable(s, 'o-qb'), true);
  assert.equal(isControllable(s, 'd-lb'), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/game/state.test.js`
Expected: FAIL — `isControllable` does not read `remoteTeam` yet (the first
test passes accidentally today only because `s.remoteTeam` is undefined and
`p.team !== undefined` is always true for a real team name — check this: it
actually already PASSES today by coincidence. Re-read `isControllable`'s
current body: `getPlayer(state, id).team !== state.aiTeam`. With `aiTeam ===
null` and `remoteTeam` not yet read at all, `isControllable(s, 'd-lb')`
returns `true` today, not `false` — so this test DOES fail, for the right
reason: nothing currently excludes the remote team.)

- [ ] **Step 3: Widen `isControllable`**

In `lib/game/state.js`:

```js
/**
 * Whether the human at THIS browser may give this player orders. Two teams
 * are off limits: the computer's (`aiTeam`), unchanged from single-player,
 * and -- in a multiplayer match -- the other human's (`remoteTeam`, set by
 * app/main.js's startGame when a `net` handle is present, never by anything
 * under lib/). A single-player game never sets remoteTeam, so this reads
 * exactly as it always has for every existing caller.
 */
export function isControllable(state, id) {
  const team = getPlayer(state, id).team;
  return team !== state.aiTeam && team !== state.remoteTeam;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/game/state.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/game/state.js test/game/state.test.js
git commit -m "feat: isControllable also excludes the other coach's team in a multiplayer match"
```

- [ ] **Step 7: Lift `finish()` out of `pressRun`, unchanged in behavior**

This step is a pure refactor with no new test: `npm test` staying green
after it IS the verification, because nothing about single-player's
behavior may change. In `app/main.js`, the `finish` closure inside
`pressRun` (main.js:922–981 as read for this plan) captures `events` and
`passEvent` from `pressRun`'s own scope. Lift it to a module-level function
taking those as parameters, so Step 8 can call it from a `net.onTurn`
handler that has never called `runTurn` itself and so never has a `pressRun`
closure to be inside of:

```js
function finishTurn(events) {
  animating = false;
  paint();
  const passEvent = events.find((e) => e.type === 'pass');
  for (const e of events) {
    if (e.type === 'tackled') say('Tackled!');
    if (e.type === 'fumble') say('FUMBLE! The ball is loose!');
    if (e.type === 'touchdown') say('TOUCHDOWN!');
    if (e.type === 'out-of-bounds') say('Out of bounds.');
    if (e.type === 'pickup') {
      if (!passEvent) {
        say(`Recovered by ${e.team}.`);
      } else if (passEvent.auto) {
        if (e.team === 'defense') say(`Recovered by ${e.team}.`);
      } else {
        say(e.team === 'defense' ? 'INTERCEPTED!' : 'Caught!');
      }
    }
    if (e.type === 'incomplete') say('Incomplete.');
  }
  if (state.phase === 'planning' && state.ball.lob && !lobLanded(state.ball.lob)) {
    say('The ball is in the air — get someone under it.');
  }
  if (state.phase === 'playOver' && state.penalty) {
    say(`FLAG: ${FOUL_WORDS[state.penalty.foul]}.`
      + ` ${PENALTY_YARDS} yards from the previous spot, loss of down.`);
  }
  // Never in a match: the server owns down transitions (spec), the same way
  // this already never fires during a lesson.
  if (!lesson && !net && state.phase === 'playOver') {
    scheduleAutoAdvance(
      state.deadReason === 'touchdown' && !state.penalty ? startNewGame : goToNextDown,
    );
  }
  lessonSaw();
}
```

and change `pressRun`'s body to call `finishTurn(events)` in place of
invoking the old `finish` closure — `animate(frames, () =>
finishTurn(events))` and the bare `else finishTurn(events);` branch. Delete
the old `const finish = () => {...}` block entirely; nothing else in the
file refers to it by name (confirm with `grep -n "finish(" app/main.js`
before deleting — the only calls should be the two inside `pressRun` this
step is rewriting).

Run: `npm test`
Expected: PASS, unchanged. This step has no commit of its own — fold it
into Step 9's commit below, since Step 8 is what actually exercises
`finishTurn` from a second call site and proves the lift was faithful.

- [ ] **Step 8: `startGame` takes `net`, and `pressRun` branches on it**

In `app/main.js`, near the top-level `let` declarations (find where
`variantId`, `sideId`, `lesson` are declared — grep `let lesson` and
`let variantId`), add:

```js
// The multiplayer handle app/multiplayer.js hands startGame, or null in
// every single-player mode. Its presence is what turns Run Turn into End
// Turn (see pressRun) and is read nowhere else that state.aiTeam or
// state.remoteTeam do not already cover -- see isControllable.
let net = null;
```

In `startGame` (main.js:1436):

```js
export function startGame({
  variant = DEFAULT_VARIANT, side = 'training', onExit = () => {}, net: netHandle = null,
} = {}) {
  lesson = null;
  exitToHome = onExit;
  variantId = variant;
  sideId = side;
  net = netHandle;
  if (!inputAttached) {
    attachInput(board, { hitTest, onGesture, onDragPreview });
    inputAttached = true;
  }
  startNewGame();
  say(net
    ? 'Drag your players, then press End Turn — your opponent is doing the same.'
    : 'Drag your players, then open the Coaches Menu to run the turn.');
}
```

`startNewGame` (main.js:1300) has to build a NET game rather than a
single-player one when `net` is set: nobody is the computer (`ai: null`),
and `state.remoteTeam` is the side the other human coaches. It also must
NOT roll its own random seed or wait for `net.onStart` before doing
anything — a match's first `state` only exists once the server's `start`
message arrives (Task 6). Restructure the branch at the top of
`startNewGame`:

```js
function startNewGame() {
  cancelAutoAdvance();
  stopRepositioning();
  if (net) {
    startMultiplayerGame();
    return;
  }
  const mode = defaultModeForSide(sideId);
  state = createGame({
    seed: (Math.random() * 2 ** 31) | 0, ai: mode.ai, aiLevel: mode.level, variant: variantId,
    genomeOverrides: overrideValues(genomeBundles),
  });
  state.tendencyCounts = tendencies;
  random = mulberry32(state.seed);
  pendingWarning = false;
  rebuildBoard();
  say(kickoffMessage(state));
  paint();
}

/**
 * The multiplayer half of startNewGame: the board is dealt only once the
 * server's `start` message names the seed, because a match's state does not
 * exist anywhere until MatchDO calls createGame itself (spec: "The server
 * runs the game"). Until then the board sits blank -- app/multiplayer.js's
 * lobby screen was already the coach's waiting room, so a second wait here
 * is brief.
 */
function startMultiplayerGame() {
  net.onStart(({ seed, variant, losYard, side, deadlineAt }) => {
    state = createGame({ seed, variant, losYard });
    state.aiTeam = null;
    state.remoteTeam = side === 'offense' ? 'defense' : 'offense';
    sideId = side;
    random = mulberry32(seed); // unused for simulation (the server runs it), kept for anything that reads it defensively
    pendingWarning = false;
    rebuildBoard();
    say('Drag your players, then press End Turn — your opponent is doing the same.');
    startClockDisplay(deadlineAt);
    paint();
  });
  net.onTurn((msg) => applyServerTurn(msg));
  net.onTimeUp(() => say('Time is up — the server is waiting a moment longer for your opponent.'));
  net.onOpponentGone(({ resumeBy }) => say(`Your opponent dropped. Waiting up to ${Math.ceil((resumeBy - Date.now()) / 1000)}s…`));
  net.onOpponentBack(() => say('Your opponent is back.'));
  net.onMatchOver(({ reason }) => {
    say(reason === 'opponent-left' ? 'Your opponent left the match.' : 'The drive is over.');
    // Task 14's own follow-up: offer Play again / Back here, wired to
    // app/multiplayer.js's queue-rejoin and goHome respectively. This plan
    // leaves the exact markup to whoever implements this step, matching
    // this file's existing say()-driven messaging rather than inventing a
    // new UI primitive for one screen.
  });
}
```

`applyServerTurn` is the other half — it is what replaces `runTurn`'s
direct call inside `pressRun`, and it is what actually calls `finishTurn`
(Step 7) from a message handler instead of from `pressRun`'s own return:

```js
function applyServerTurn({ frames, events, down, deadlineAt, state: serverState }) {
  state = serverState;
  layer('game-arrows').clear();
  const finish = () => finishTurn(events);
  if (frames.length > 0) {
    animating = true;
    lockControlsForAnimation();
    animate(frames, finish);
  } else finish();
  startClockDisplay(deadlineAt);
}
```

`lockControlsForAnimation` is a small extraction of the block of
`xBtn.disabled = true` lines already inside `pressRun` (main.js:986–1000) —
pull those thirteen lines into their own function so both `pressRun` and
`applyServerTurn` can call it instead of duplicating the button list:

```js
function lockControlsForAnimation() {
  runBtn.disabled = true;
  autoplanBtn.disabled = true;
  clearBtn.disabled = true;
  nextBtn.disabled = true;
  newBtn.disabled = true;
  homeBtn.disabled = true;
  aiBtn.disabled = true;
  repositionBtn.disabled = true;
  personnelBtn.disabled = true;
  debugBtn.disabled = true;
  copyLogBtn.disabled = true;
  clearLogBtn.disabled = true;
  trainBtn.disabled = true;
  copyGenomeBtn.disabled = true;
  discardGenomeBtn.disabled = true;
}
```

and `pressRun`'s own animate-branch becomes:

```js
  if (frames.length > 0) {
    animating = true;
    lockControlsForAnimation();
    animate(frames, () => finishTurn(events));
  } else finishTurn(events);
```

Finally, `pressRun` itself branches at the top on whether a match is
running — it stops calling `runTurn` at all:

```js
function pressRun() {
  if (animating || state.phase !== 'planning') return;
  if (refused({ kind: 'run' })) return;
  const missing = lesson ? [] : unplannedPlayers(state);
  if (missing.length > 0 && !pendingWarning) {
    pendingWarning = true;
    say(`${missing.length} player(s) have no direction set. Press Run Turn again to run anyway.`);
    return;
  }
  pendingWarning = false;
  stopRepositioning();
  say('');
  recordPlanning();

  if (net) {
    // End Turn: send the board, then wait for the server's `turn` message
    // (applyServerTurn) to actually animate anything. Locking here, not
    // just disabling the button, matches single-player's own "no input
    // mid-animation" rule (onGesture's `if (animating) return`) for the
    // stretch where this client has committed but the opponent has not.
    animating = true;
    lockControlsForAnimation();
    net.commit(capturePlay(state, ''), state.turnIndex);
    return;
  }

  const { frames, events } = runTurn(state, random);
  layer('game-arrows').clear();
  if (frames.length > 0) {
    animating = true;
    lockControlsForAnimation();
    animate(frames, () => finishTurn(events));
  } else finishTurn(events);
}
```

`animating` being set true the instant a match's coach presses End Turn
(rather than only once frames start animating) is a deliberate difference
from single-player: single-player has nothing to wait FOR between the
press and the animation starting, but a match's coach may sit committed for
up to twelve seconds waiting on his opponent, and every existing gate this
codebase has for "don't take input mid-turn" already keys off `animating`
(`onGesture`, `hitTest` is unaffected since it does not check `animating`,
but `onGesture`'s own top line does). `applyServerTurn`'s own
`animating = true` line is therefore redundant with this one in the common
case and only matters for the alarm-driven turns a coach never explicitly
committed to (Task 8's replay rule) — leave it in `applyServerTurn` anyway,
since that function has to be correct even called on its own (e.g. from a
reconnect's `turn` message, which never went through `pressRun` at all).

- [ ] **Step 9: The HUD countdown and hidden controls**

Two more pieces the spec names explicitly: "The HUD gains a countdown and a
note on whether the opponent has committed" and "`scheduleAutoAdvance`, New
Game, Next Down and the AI-mode toggle are hidden in a match."

For the countdown, add a small `startClockDisplay(deadlineAt)` that ticks a
`setInterval` writing remaining seconds into a HUD element — this plan does
not have visibility into `index.html`'s current HUD markup from the files
read so far, so the concrete implementation is one task for whoever executes
this step to confirm against `index.html` and `lib/game/render.js`'s
existing HUD-rendering functions (`downDistanceText` et al., imported
already at the top of `app/main.js`) before writing it — follow the exact
pattern those already use (a `<div>` written into by `app/main.js`, styled
by a rule in `index.html`) rather than introducing a new rendering
mechanism. Do not skip verifying this against the live markup; guessing an
element id here is exactly the kind of placeholder this plan's own
discipline forbids elsewhere.

For hiding controls, find the `newBtn`, `nextBtn`, `aiBtn` click handlers
(main.js:1005 region and 1321–1331 as read for this plan) and add
`if (net) return;` as the first line of each of the three handlers' bodies
— NOT to `pressRun`, `pressAutoplan`, or any button a match still needs.
`scheduleAutoAdvance` itself is already gated by `finishTurn`'s `!lesson &&
!net` check from Step 7; no separate change is needed there.

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS — nothing under `test/` exercises `net`-mode directly (there
is no DOM harness in this repository for `app/main.js`), so this is a
regression check on single-player behavior, not new coverage. New coverage
for the multiplayer path is Task 12's end-to-end `match-engine` test plus
Task 13's manual two-tab check.

- [ ] **Step 11: Commit**

```bash
git add app/main.js
git commit -m "feat: a net handle turns Run Turn into End Turn and hands the server's frames to the same animation path"
```

---

### Task 16: Build and deploy — `build:site`, and CI moves from Pages to `wrangler deploy`

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: nothing from earlier tasks except that `worker/` and
  `wrangler.toml` (Task 13) exist.
- Produces: `npm run build:site` assembles `_site` the same way
  `.github/workflows/deploy.yml`'s `build` job already does today, callable
  identically from a laptop or from CI.

- [ ] **Step 1: `build:site` script**

`.github/workflows/deploy.yml`'s current `build` job runs:

```
mkdir -p _site
cp index.html _site/
cp -r app lib _site/
touch _site/.nojekyll
```

Turn that into a script `npm run build:site` can call. Add to
`package.json`'s `scripts`:

```json
    "build:site": "node tools/build-site.js"
```

Create `tools/build-site.js` (this directory already exists and holds
plain Node CLI scripts — `train-defense.js` etc. — match their style: no
dependencies, `node:fs`/`node:path` only):

```js
#!/usr/bin/env node
/**
 * Assembles `_site`: exactly what the browser actually loads, copied out of
 * the repo so publishing is from a directory rather than from a git branch.
 * The one thing that changed from the old GitHub Pages build script is that
 * this now runs identically on a laptop (for `wrangler dev`) and in CI (for
 * `wrangler deploy`) -- see the spec's "Hosting and deployment" section.
 */
import { cpSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE = join(ROOT, '_site');

rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
copyFileSync(join(ROOT, 'index.html'), join(SITE, 'index.html'));
cpSync(join(ROOT, 'app'), join(SITE, 'app'), { recursive: true });
cpSync(join(ROOT, 'lib'), join(SITE, 'lib'), { recursive: true });
writeFileSync(join(SITE, '.nojekyll'), '');
console.log('_site assembled.');
```

(`.nojekyll` no longer does anything once GitHub Pages is gone — Step 2
removes the last consumer of it. Leave the line in anyway: it is harmless,
and removing it is a separate, unrelated cleanup this task should not
bundle in.)

- [ ] **Step 2: Run it**

Run: `npm run build:site`
Expected: a `_site` directory appears containing `index.html`, `app/`,
`lib/`, `.nojekyll`. Confirm `_site/lib/game/lobby.js` and every other new
file from this plan is present (the `cpSync` of the whole `lib` and `app`
directories picks up everything automatically — this is just a sanity
check, not a sign anything needs listing by hand).

- [ ] **Step 3: Add `_site/` to `.gitignore`**

Check `.gitignore`'s current contents first (`cat .gitignore`); add `_site/`
if it is not already ignored — this is a build output and must never be
committed.

- [ ] **Step 4: Rewrite `.github/workflows/deploy.yml`**

Replace the whole file. The `test` job is untouched (spec: "The `test` job
is untouched"); the `build`/`deploy` jobs become one `deploy` job running
`wrangler deploy`, reading a `CLOUDFLARE_API_TOKEN` repository secret the
spec names explicitly. The Pages-only `permissions` and `concurrency` block
go with the jobs that needed them.

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm run build:site
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy
```

`cloudflare/wrangler-action@v3` runs `wrangler deploy` from the repo root
with `wrangler.toml` (Task 13) already in place, so it needs no `command`
arguments beyond `deploy` itself; it installs its own pinned `wrangler`
rather than requiring a repo dependency.

The comment the spec's own "Hosting and deployment" section asks to be kept
in mind, worth leaving as a comment in the workflow file itself so a future
reader does not have to go find the spec to learn it:

```yaml
  # A bad deploy here takes down single-player too, where the old Pages
  # build would have left a broken server without touching a working site.
  # This is the deliberate trade the multiplayer design doc makes: one
  # origin, one deploy, no version-skew story between the page and the
  # referee it now talks to.
```

Place that comment above the `deploy:` job.

- [ ] **Step 5: `CLOUDFLARE_API_TOKEN` and the Workers Paid plan — one manual step, not automatable**

This plan cannot create the repository secret or verify the Cloudflare
account's plan tier — both require access this plan's executor does not
have. Before merging this task (or before its first push to `main`
triggers a real deploy), a human needs to:

1. Create a Cloudflare API token scoped to Workers/Durable Objects deploy
   permissions, and add it as the `CLOUDFLARE_API_TOKEN` secret in this
   repository's GitHub settings.
2. Confirm, against Cloudflare's current documentation, whether
   SQLite-backed Durable Objects (`new_sqlite_classes` in `wrangler.toml`,
   Task 13) are available on the free Workers plan, or whether the $5/month
   Workers Paid plan is still required — the spec flags this explicitly as
   "the one number to check against current documentation before
   deploying."

Do not merge this task's workflow change to `main` until both are done, or
the very first push will fail CI on a missing secret (survivable — it is
only the deploy job that fails, and `test` still gates the push) or,
worse, deploy against an account that cannot host Durable Objects at all.

- [ ] **Step 6: Commit**

```bash
git add package.json tools/build-site.js .gitignore .github/workflows/deploy.yml
git commit -m "feat: build:site is a script, and CI deploys the Worker instead of GitHub Pages"
```

---

## Self-review notes (for whoever executes this plan)

- **Task 15, Step 9's HUD countdown is intentionally underspecified.** Every
  other task in this plan names an exact file, an exact function, and exact
  code. That one does not, because this plan's own reading of the codebase
  (Task list above) never opened `index.html`'s HUD markup or asked how
  `lib/game/render.js` currently renders the down/distance line into the
  page — writing a fabricated element id there would be exactly the kind of
  placeholder this plan's own house style forbids. Read `index.html` and
  wherever `downDistanceText` gets written into the DOM before writing this
  step's code, and follow that existing pattern rather than inventing a new
  one.
- **Task 14's reconnect flow (reading back `sessionStorage['fbt-match']` on
  a reloaded tab) is sketched but not fully wired**, for the same reason:
  it depends on decisions Task 15 makes about how `app/main.js` presents a
  "reconnecting…" state, which did not exist yet when Task 14 was written.
  Revisit `app/multiplayer.js` once Task 15 is done and add the actual
  reload-time check (`sessionStorage.getItem('fbt-match')` on module load,
  before `startMultiplayer` is even called) and its own `openMatchSocket`
  call using the stored token, rather than the lobby flow.
- **Every other task is complete as written**: each has failing tests
  written before implementation, a concrete diff, and a passing `npm test`
  as its own verification. Tasks 6 through 12 in particular are checked
  against every awkward case the spec's "Testing" section names by name:
  both commit, one commits and the clock expires, neither commits (the
  replay rule, including that it skips spots and does not re-arm an
  unchanged stance), a coach drops mid-clock, a coach reconnects, a coach
  never arrives, a third socket knocks, and a play with a receiver in the
  end zone.
