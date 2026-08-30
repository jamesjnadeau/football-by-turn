# Velocity Debug Lines and Plan-Arrow Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable debug overlay that draws each player's current speed and direction as a thin blue line out of his centre, and restyle the movement arrows to be green, half-weight, half-headed, and painted beneath the players.

**Architecture:** Everything visual is a string built in `lib/game/render.js` and written into a layer group by `app/main.js`; that stays true here. The velocity line becomes one more optional part inside each player's `<g>` (so it rides the per-frame `transform` for free), gated by an options argument to `renderPlayers`. The arrow restyle is a game-local style class plus a game-local arrowhead marker in `render.js` — `lib/field/style.js` is the shared stylesheet for the standalone field diagrams and must not be edited for game-only taste. The drag preview and the committed arrow are unified behind one `arrowMark()` helper so they cannot drift.

**Tech Stack:** Vanilla ES modules, SVG built as strings, `node --test` (no DOM) for the library, manual browser check for `app/` wiring.

**Spec:** this document — the request below is the spec verbatim; there is no separate design doc.

> based on the existing game, I'd like a debug mode that shows a players current speed and direction via a thin blue line come from their edge. The length of the line indicates the velocity. The line should come from the center of each player, and should be visible off the edge of the player. I should be able to toggle the display of these on and off with a button. Please also make the drawn arrows for player movement have much smaller points on the end, probably half their current size, same with the lines for those arrows. Please also make these arrows green, and drawn at a z layer under the players.

## Global Constraints

- Never edit `lib/field/style.js` or `lib/field/geometry.js`. `.mv` and the `#ar` marker there are shared by the standalone field diagrams; the game overrides them with its own classes in `STYLE_GAME` / `DEFS_GAME`.
- All coordinates written into markup go through `num()` from `lib/field/geometry.js` (2-decimal rounding, no `-0`).
- Units are SVG units: 1 yard = 3.75 units. Player radii are 2.5 / 3 / 3.5.
- Tests are `node --test`; run the whole suite with `npm test`. There is no DOM in tests — anything in `app/` is verified by hand in the browser.
- The exact green is `#1a7f37`; the exact blue is `#1668dc`. Use these literal strings everywhere.
- Existing behaviour that must not regress: the computer-coached team's arrows are never rendered (`renderArrows` filters on `state.aiTeam`).

**Z-order note:** `renderBoardShell` already emits `game-arrows` before `game-players`, and SVG paints in document order — so committed arrows are *already* under the players. Task 2 locks that with a test rather than changing it, and moves the live drag preview out of `game-overlay` (which is above the players) into a new `game-preview` layer so the preview obeys the same rule.

**Working-tree note:** the branch has uncommitted changes to several game files. Every commit step below stages named paths only — never `git add -A`.

---

## File Structure

- `lib/game/constants.js` — modify: add `DEBUG_VELOCITY_SECONDS`.
- `lib/game/render.js` — modify: `STYLE_GAME` gains `.plan-mv`, `.arh-g`, `.vel`; new exported `DEFS_GAME` (the green arrowhead marker); new exported `arrowMark()`; `renderBoardShell` emits `DEFS_GAME` and a `game-preview` layer; `renderArrows` uses `arrowMark`; `renderPlayers` takes an options argument and draws the velocity line.
- `app/main.js` — modify: drag preview uses `arrowMark` into `game-preview`; new `showVelocity` flag, `#debug` button wiring, and `paint()` passes the flag through.
- `index.html` — modify: add the `#debug` button.
- `test/game/render.test.js` — modify: update the arrowhead assertion, add arrow-style, layer-order, and velocity-line tests.

---

## Task 1: Green, half-weight plan arrows with a game-local arrowhead

**Files:**
- Modify: `lib/game/render.js` (`STYLE_GAME` block, new `DEFS_GAME`, `renderBoardShell`, `renderArrows`)
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: `num` from `lib/field/geometry.js`, `STYLE`/`DEFS` from `lib/field/style.js` (unchanged).
- Produces:
  - `export const DEFS_GAME: string` — a `<defs>` block holding the `ar-g` marker.
  - `export function arrowMark(from: {x:number,y:number}, to: {x:number,y:number}): string` — one `<path class="plan-mv" marker-end="url(#ar-g)">`. Task 2 calls this from `app/main.js`.

**Why the head halves for free:** SVG markers default to `markerUnits="strokeWidth"`, so a marker's on-board size is `markerWidth × stroke-width`. Today's arrow is `markerWidth="5"` at `stroke-width:1.7` → 8.5 units of marker box. Dropping the stroke to `.85` and keeping `markerWidth="5"` gives 4.25 units — exactly half the head, and exactly half the line weight, which is what the request asks for. Do **not** also shrink `markerWidth`; that would quarter the head.

- [ ] **Step 1: Write the failing tests**

Add to `test/game/render.test.js` (at the end of the file):

```js
test('plan arrows are green, half-weight, and carry the game arrowhead', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const svg = renderArrows(s);
  assert.ok(svg.includes('class="plan-mv"'), 'the game arrow class, not the shared .mv');
  assert.ok(svg.includes('marker-end="url(#ar-g)"'));
  assert.ok(!svg.includes('url(#ar)"'), 'not the shared black arrowhead');
  // Half of the shared .mv weight (1.7), which halves the arrowhead with it:
  // markers default to markerUnits="strokeWidth".
  assert.ok(STYLE_GAME.includes('.plan-mv{stroke:#1a7f37;stroke-width:.85;'), 'green at half weight');
  assert.ok(STYLE_GAME.includes('.arh-g{fill:#1a7f37}'), 'the arrowhead is green too');
});

test('the board shell defines the game arrowhead at full marker width', () => {
  const { markup } = renderBoardShell(0);
  assert.ok(markup.includes('id="ar-g"'), 'the green marker is defined');
  assert.ok(markup.includes('markerWidth="5"'), 'the head halves via stroke-width, not markerWidth');
});

test('arrowMark draws a rounded path between two points', () => {
  assert.equal(
    arrowMark({ x: 1, y: 2 }, { x: 3.456, y: 4 }),
    '<path d="M 1 2 L 3.46 4" class="plan-mv" marker-end="url(#ar-g)"/>',
  );
});
```

Extend the import at the top of `test/game/render.test.js` to pull in `arrowMark`:

```js
import {
  renderBoardShell, renderPlayers, renderArrows, renderLooseBall, facingAngle, arrowMark, STYLE_GAME,
} from '../../lib/game/render.js';
```

And update the one existing assertion that names the old marker — in the test `arrows render only for planned players, scaled by throttle`, change:

```js
  assert.ok(full.includes('marker-end="url(#ar)"'));
```

to:

```js
  assert.ok(full.includes('marker-end="url(#ar-g)"'));
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test test/game/render.test.js
```

Expected: FAIL — `arrowMark` is not exported (`SyntaxError: The requested module ... does not provide an export named 'arrowMark'`).

- [ ] **Step 3: Add the style rules**

In `lib/game/render.js`, replace the `STYLE_GAME` array's last entry (`'.plan-arrow{opacity:.85}',`) with:

```js
  '.plan-arrow{opacity:.85}',
  // The plan arrow overrides nothing: it uses its own class rather than the
  // shared `.mv`, so there is no cascade to lose. Green, and half the weight
  // `.mv` draws at (1.7 -> .85) — which halves the arrowhead with it, because
  // markers are sized in stroke-widths by default. The dash gap is halved to
  // match, so the dotted line keeps its proportions at the lighter weight.
  '.plan-mv{stroke:#1a7f37;stroke-width:.85;fill:none;stroke-dasharray:.1 2.2;stroke-linecap:round}',
  '.arh-g{fill:#1a7f37}',
```

- [ ] **Step 4: Add the game-local arrowhead marker**

In `lib/game/render.js`, immediately after the `STYLE_GAME` definition, add:

```js
/**
 * The game's own arrowhead. `lib/field/style.js` ships a black `#ar` for the
 * standalone diagrams and is shared with them, so the green one lives here
 * instead of being a fork of that file. Same geometry as `#ar` — it is the
 * lighter stroke that makes it draw at half the size.
 */
export const DEFS_GAME =
  '<defs>' +
  '<marker id="ar-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">' +
  '<path d="M0,1 L9,5 L0,9 z" class="arh-g"/>' +
  '</marker>' +
  '</defs>';
```

- [ ] **Step 5: Emit the marker from the board shell**

In `lib/game/render.js`, inside `renderBoardShell`, change the `markup` line:

```js
      `<style>${STYLE}${STYLE_GAME}</style>${DEFS}` +
```

to:

```js
      `<style>${STYLE}${STYLE_GAME}</style>${DEFS}${DEFS_GAME}` +
```

- [ ] **Step 6: Add `arrowMark` and route `renderArrows` through it**

In `lib/game/render.js`, add above `renderArrows`:

```js
/**
 * One movement arrow. The committed plan arrows and app/main.js's live drag
 * preview both come through here, so the arrow a player is dragging and the
 * arrow he ends up with are the same picture by construction.
 */
export function arrowMark(from, to) {
  return `<path d="M ${num(from.x)} ${num(from.y)} L ${num(to.x)} ${num(to.y)}" class="plan-mv" marker-end="url(#ar-g)"/>`;
}
```

Then in `renderArrows`, replace the returned template line:

```js
      return `<g class="plan-arrow" data-for="${p.id}"><path d="M ${num(p.pos.x)} ${num(p.pos.y)} L ${num(tip.x)} ${num(tip.y)}" class="mv" marker-end="url(#ar)"/></g>`;
```

with:

```js
      return `<g class="plan-arrow" data-for="${p.id}">${arrowMark(p.pos, tip)}</g>`;
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS, whole suite green.

- [ ] **Step 8: Commit**

```bash
git add lib/game/render.js test/game/render.test.js && git commit -m "feat: plan arrows draw green at half weight with a half-size head"
```

---

## Task 2: The drag preview draws under the players, in the same style

**Files:**
- Modify: `lib/game/render.js` (`renderBoardShell` layer list)
- Modify: `app/main.js` (`onDragPreview`, `onGesture`)
- Test: `test/game/render.test.js`

**Interfaces:**
- Consumes: `arrowMark` from Task 1.
- Produces: a `game-preview` layer id, sitting between `game-arrows` and `game-players`.

Committed arrows are already beneath the players — `game-arrows` is emitted first and SVG paints in document order. The live preview is not: it goes into `game-overlay`, which is last. `game-overlay` has to stay on top (the animated loose ball lives there), so the preview gets a layer of its own on the correct side of the players.

- [ ] **Step 1: Write the failing test**

Add to `test/game/render.test.js`:

```js
test('arrows and the drag preview are painted beneath the players', () => {
  const { markup } = renderBoardShell(0);
  const at = (id) => markup.indexOf(`id="${id}"`);
  assert.ok(at('game-preview') > -1, 'the preview has a layer of its own');
  assert.ok(at('game-arrows') < at('game-players'), 'committed arrows under the players');
  assert.ok(at('game-preview') < at('game-players'), 'the live preview under them too');
  assert.ok(at('game-players') < at('game-overlay'), 'the overlay stays on top for the loose ball');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test test/game/render.test.js
```

Expected: FAIL — `the preview has a layer of its own` (`game-preview` is not in the markup).

- [ ] **Step 3: Add the layer**

In `lib/game/render.js`, inside `renderBoardShell`, change:

```js
      `<g id="game-arrows"></g><g id="game-players"></g><g id="game-overlay"></g>`,
```

to:

```js
      // Order is z-order. Arrows and the live drag preview go under the
      // players; the overlay stays on top, because that is where the animated
      // loose ball is drawn.
      `<g id="game-arrows"></g><g id="game-preview"></g>` +
      `<g id="game-players"></g><g id="game-overlay"></g>`,
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Point the drag preview at the new layer and the shared arrow**

In `app/main.js`, extend the `render.js` import:

```js
import {
  renderBoardShell, renderPlayers, renderArrows, renderLooseBall, looseBallMark, arrowMark,
} from '../lib/game/render.js';
```

In `onGesture`, change the preview clear from the overlay to the preview layer:

```js
  layer('game-preview').clear();
```

Then replace the whole body of `onDragPreview` with:

```js
function onDragPreview(playerId, log) {
  if (animating) return; // the board belongs to the turn being drawn right now
  if (!playerId || !log || state.phase !== 'planning') {
    layer('game-preview').clear();
    return;
  }
  const g = classifyGesture(log);
  if (g.kind !== 'drag') return;
  const p = getPlayer(state, playerId);
  const tip = {
    x: p.pos.x + g.dir.x * g.throttle * MAX_ARROW_UNITS,
    y: p.pos.y + g.dir.y * g.throttle * MAX_ARROW_UNITS,
  };
  layer('game-preview').clear().svg(arrowMark(p.pos, tip));
}
```

- [ ] **Step 6: Check it by hand in the browser**

```bash
npm run serve
```

Open <http://localhost:8080>. Drag from a player: the preview arrow is green, thin, small-headed, and passes *behind* any player circle it crosses. Release: the committed arrow looks identical and is also behind the players. Press Run Turn: no stray preview arrow is left on the board.

- [ ] **Step 7: Commit**

```bash
git add lib/game/render.js app/main.js test/game/render.test.js && git commit -m "feat: draw the drag preview under the players in the plan-arrow style"
```

---

## Task 3: The velocity line

**Files:**
- Modify: `lib/game/constants.js` (new `DEBUG_VELOCITY_SECONDS`)
- Modify: `lib/game/render.js` (`STYLE_GAME`, new `velocityLine`, `playerMark`, `renderPlayers`)
- Test: `test/game/render.test.js`

**Interfaces:**
- Produces: `renderPlayers(state, options?: { showVelocity?: boolean }): string`. The second argument is optional and defaults to off, so every existing caller and test keeps its meaning. Task 4 passes the flag from `app/main.js`.
- Produces: `export const DEBUG_VELOCITY_SECONDS = 0.25` in `constants.js`.

**Length rule:** the line runs from the player's centre out to `radius + speed × DEBUG_VELOCITY_SECONDS`. The `radius` term is what guarantees it is visible past his edge at any non-zero speed; the part that sticks out past the edge is exactly proportional to speed, so that visible overhang is the readout. A player standing still gets no line at all — a zero vector has no direction to point.

- [ ] **Step 1: Add the constant**

In `lib/game/constants.js`, append at the end of the file:

```js

// --- the debug overlay ---
// The velocity line runs from a player's centre out past his edge by his speed
// times this many seconds — half a turn. A skill player at top speed (60 u/s)
// draws 15 units of overhang, about 4 yards, which reads clearly without
// crossing the whole formation.
export const DEBUG_VELOCITY_SECONDS = 0.25;
```

- [ ] **Step 2: Write the failing tests**

Extend the `constants.js` import at the top of `test/game/render.test.js`:

```js
import { TEAM_SIZE, MAX_ARROW_UNITS, DEBUG_VELOCITY_SECONDS } from '../../lib/game/constants.js';
```

Add to `test/game/render.test.js`:

```js
test('velocity lines are off by default and drawn from the player centre when on', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-rb').vel = { x: 0, y: 20 };
  assert.ok(!renderPlayers(s).includes('class="vel"'), 'off unless asked for');
  const svg = renderPlayers(s, { showVelocity: true });
  assert.equal((svg.match(/class="vel"/g) || []).length, 1, 'only the player who is moving gets one');
  assert.ok(svg.includes('<line x1="0" y1="0"'), 'from the centre of the player group');
});

test('the velocity line pokes past the player edge in proportion to speed', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb'); // radius 2.5
  const drawnX = () => Number(
    renderPlayers(s, { showVelocity: true }).match(/<line x1="0" y1="0" x2="([-\d.]+)"/)[1],
  );
  rb.vel = { x: 40, y: 0 };
  assert.equal(drawnX(), rb.radius + 40 * DEBUG_VELOCITY_SECONDS, '2.5 of body + 10 of speed');
  rb.vel = { x: 80, y: 0 };
  assert.equal(drawnX(), rb.radius + 80 * DEBUG_VELOCITY_SECONDS, 'twice the speed, twice the overhang');
});

test('the velocity line points along the velocity, not along the plan', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  rb.vel = { x: 0, y: -40 }; // drifting back upfield
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1); // told to go the other way
  const line = renderPlayers(s, { showVelocity: true }).match(/<line x1="0" y1="0" x2="([-\d.]+)" y2="([-\d.]+)"/);
  assert.equal(Number(line[1]), 0);
  assert.equal(Number(line[2]), -(rb.radius + 40 * DEBUG_VELOCITY_SECONDS));
});

test('the velocity line is a thin blue hairline', () => {
  assert.ok(STYLE_GAME.includes('.vel{stroke:#1668dc;stroke-width:.4;'));
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
node --test test/game/render.test.js
```

Expected: FAIL — `off unless asked for` passes trivially, but `only the player who is moving gets one` fails with `Expected values to be strictly equal: 0 !== 1`.

- [ ] **Step 4: Add the style rule**

In `lib/game/render.js`, add to the `STYLE_GAME` array, after the `.arh-g` entry:

```js
  // The debug velocity line. Thinner than anything else on the board on
  // purpose: it is an instrument, drawn over the player, not part of the play.
  '.vel{stroke:#1668dc;stroke-width:.4;stroke-linecap:round;pointer-events:none}',
```

- [ ] **Step 5: Extend the render.js imports**

In `lib/game/render.js`, change:

```js
import { MAX_ARROW_UNITS, PREPARED_CONE_HALF_ANGLE } from './constants.js';
```

to:

```js
import { MAX_ARROW_UNITS, PREPARED_CONE_HALF_ANGLE, DEBUG_VELOCITY_SECONDS } from './constants.js';
```

- [ ] **Step 6: Draw the line**

In `lib/game/render.js`, add above `playerMark`:

```js
/**
 * The debug read-out of a player's motion, in the player group's local space:
 * a hairline from his centre out to radius + speed × DEBUG_VELOCITY_SECONDS.
 * The radius term is what puts the tip outside his own circle at any speed;
 * the length BEYOND his edge is the part that reads as velocity, and it is
 * strictly proportional to it. Standing still there is no direction to point,
 * so a stopped player gets nothing.
 */
function velocityLine(player) {
  const { x, y } = player.vel;
  const speed = Math.hypot(x, y);
  if (speed === 0) return '';
  const k = (player.radius + speed * DEBUG_VELOCITY_SECONDS) / speed;
  return `<line x1="0" y1="0" x2="${num(x * k)}" y2="${num(y * k)}" class="vel"/>`;
}
```

- [ ] **Step 7: Hang it off `playerMark` and `renderPlayers`**

In `lib/game/render.js`, change the signature of `playerMark`:

```js
function playerMark(player, isCarrier, tucked, showVelocity) {
```

and add, immediately before that function's closing `return (`:

```js
  if (showVelocity) parts.push(velocityLine(player)); // last, so it draws over the body
```

Then replace `renderPlayers` with:

```js
/**
 * `showVelocity` turns on the debug read-out. It is an argument rather than a
 * flag on the state because it is a property of the view, not of the game —
 * New Game replaces the state and must not silently switch it off.
 */
export function renderPlayers(state, { showVelocity = false } = {}) {
  return state.players
    .map((p) => playerMark(p, state.ball.carrierId === p.id, p.mode === 'tucked', showVelocity))
    .join('');
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS, whole suite green.

- [ ] **Step 9: Commit**

```bash
git add lib/game/constants.js lib/game/render.js test/game/render.test.js && git commit -m "feat: render a debug velocity line from each player's centre"
```

---

## Task 4: The toggle button

**Files:**
- Modify: `index.html`
- Modify: `app/main.js`

**Interfaces:**
- Consumes: `renderPlayers(state, { showVelocity })` from Task 3.

The flag is a module-level `let` in `app/main.js`, not part of `state`: it is a view preference, and `state` is thrown away and rebuilt by New Game.

- [ ] **Step 1: Add the button**

In `index.html`, after the `#ai` button line, add:

```html
    <button id="debug">Velocity lines: off</button>
```

- [ ] **Step 2: Wire up the element and the flag**

In `app/main.js`, after `const aiBtn = document.getElementById('ai');` add:

```js
const debugBtn = document.getElementById('debug');
```

and after `let animating = false;` add:

```js
// A debug read-out, not game state: New Game replaces `state` wholesale, and
// having asked to see velocities should survive that.
let showVelocity = false;
```

- [ ] **Step 3: Paint the lines and the button's own label**

In `app/main.js`, inside `paint()`, change:

```js
  layer('game-players').clear().svg(renderPlayers(state) + renderLooseBall(state));
```

to:

```js
  layer('game-players').clear().svg(renderPlayers(state, { showVelocity }) + renderLooseBall(state));
```

and add, next to the other button lines in `paint()` (after the `aiBtn.disabled` line):

```js
  debugBtn.textContent = `Velocity lines: ${showVelocity ? 'on' : 'off'}`;
  debugBtn.disabled = animating;
```

- [ ] **Step 4: Lock the button during the animation**

In `app/main.js`, in the `runBtn` click handler, in the block that disables the controls by hand, add after `aiBtn.disabled = true;`:

```js
    debugBtn.disabled = true;
```

- [ ] **Step 5: Handle the click**

In `app/main.js`, after the `aiBtn.addEventListener(...)` block, add:

```js
debugBtn.addEventListener('click', () => {
  // Dead while a turn is being drawn, like every other control: paint()
  // rewrites the player layer, which would throw away the transforms the
  // animation loop is driving. The lines a running turn shows are the
  // velocities from the last paint — the read-out refreshes when it lands.
  if (animating) return;
  showVelocity = !showVelocity;
  paint();
});
```

- [ ] **Step 6: Check it by hand in the browser**

```bash
npm run serve
```

Open <http://localhost:8080> and confirm:
1. The button reads `Velocity lines: off` and no blue lines are drawn.
2. Click it: it reads `Velocity lines: on`. Everyone is stationary at the snap, so still no lines — that is correct.
3. Draw arrows, press Run Turn, and wait for it to land: every moving player now has a blue hairline out of his centre, poking clearly past his circle, pointing the way he is actually travelling, longer for the faster players.
4. Run another turn: the buttons grey out during the animation, and the lines update when it finishes.
5. Click the button again: the lines disappear and the label goes back to `off`.
6. New Game with the lines on: they stay on (the label still reads `on`).

- [ ] **Step 7: Commit**

```bash
git add index.html app/main.js && git commit -m "feat: toggle the velocity debug lines from the panel"
```

---

## Verification

- [ ] `npm test` — the whole suite passes.
- [ ] The browser walkthrough in Task 2 Step 6 and Task 4 Step 6 both pass.
