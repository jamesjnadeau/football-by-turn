# QB run option autoplan

## Motivation

The coach currently draws every arrow, stance and throw by hand. This adds a
one-press "Autoplan offense" that draws up a quarterback run option for the
human's own offense: a give/keep read at the snap, and an adaptive "block the
nearest man / find the daylight" heuristic for every turn after, recomputed
fresh from wherever the ball actually is when the button is pressed — not a
script tied to a turn number.

Two triggers, one function: the existing Coaches Menu gets a new "Autoplan
offense" button, and the board gets a third quick-press icon (🎁) stacked
above the Run Turn (⏩) button. Both call the same `autoplanOffense(state)`.

## Why the play can't be a literal snap-then-handoff

The engine resolves at most one throw per turn (`turn.js`'s `releasePass`
fires once, at the top of the turn, against whatever `state.plannedPass`
holds), and the quarterback does not become the ball's carrier until that
throw has flown and landed — which normally happens mid-turn, during the
sub-step loop. During the **planning** phase of turn 0, `state.ball.carrierId`
is still `SNAPPER_ID` ('o-c'). A true "QB gets the snap, then hands off"
cannot be authored as two throws inside one `Run Turn` press.

The engine already treats a handoff as nothing special — pass.js's own
comment: "a handoff is simply a short [pass]." So the give/keep decision is
resolved **before the snap**, by choosing who the snap itself goes to: the QB
(`SNAP_TARGET_ID`, the ordinary automatic snap) for a keep, or a direct
override straight to the RB for a give (a pistol/shotgun-style direct snap).
This is a deliberate simplification, not an oversight: the *outcome* (who ends
up with the ball, and which way he's supposed to go) is what matters for
gameplay, and it is arrived at with real position data instead of a fabricated
lookahead.

## New file: `lib/game/offense.js`

Mirrors `play.js`'s shape (pure helpers plus one mutating entry point in the
same file) rather than the `ai.js`/`defense.js` split, because this is a
one-shot planning-time action triggered by a button press — like
`applyPlay` — not a per-turn brain `turn.js` calls on every `runTurn`.

Positions are read off the field, not off role names, matching the ethos
`defense.js`'s own header comment states — the one exception is looking up
the quarterback and running back by role/id, because every roster in
`rosters.js` guarantees exactly one of each (`SNAP_TARGET_ID` for the QB, and
the sole player with `role === 'RB'`).

### Entry point

```js
export function autoplanOffense(state) {
  if (state.phase !== 'planning' || state.aiTeam === 'offense') return null;

  const offense = state.players.filter((p) => p.team === 'offense');
  // Wipe this team's own current orders first, the same way applyPlay wipes
  // the human's board before drawing a new play over it.
  for (const p of offense) { setMode(state, p.id, 'normal'); clearPlan(state, p.id); }
  // Only clear a pass that belongs to the offense -- a hot-seat coach's own
  // throw planned for the DEFENSE (after a turnover) is not this button's to
  // wipe.
  if (!state.plannedPass || getPlayer(state, state.plannedPass.from).team === 'offense') {
    clearPass(state);
  }

  const note = state.turnIndex === 0 ? planOptionSnap(state, offense) : planInPlay(state, offense);
  aimSnap(state); // restores the automatic snap-to-QB, but only if nothing above set an override (see state.js's aimSnap)
  return note;
}
```

Returns a short human-readable string describing what it did (for
`app/main.js` to hand to `say()`), or `null` when it declined to act at all
(wrong phase, or the computer is already coaching this team — there is
nothing case where it partially declines; `planOptionSnap`/`planInPlay`
always produce *some* note once the top guard passes, even if it's just
"nothing to do").

### Turn 0: the option read

```js
function planOptionSnap(state, offense) {
  const qb = offense.find((p) => p.id === SNAP_TARGET_ID);
  const rb = offense.find((p) => p.role === 'RB');
  const line = offense.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role));
  if (!qb || !rb) return 'Nothing to autoplan -- this formation has no QB/RB to run an option with.';

  const side = playSide(offense);
  const edgeX = playSideEdgeX(side, line);
  const reader = readDefender(state, side);
  const give = reader !== null && side * (reader.pos.x - edgeX) > OPTION_READ_UNITS;

  if (give) {
    const from = getPlayer(state, SNAPPER_ID);
    const gap = sub(rb.pos, from.pos);
    if (len(gap) > 0) {
      const travel = Math.max(0, len(gap) - spawnOffset(from));
      setPass(state, SNAPPER_ID, norm(gap), powerForTravel(travel, Infinity), rb.id);
    }
  }
  // else: leave plannedPass alone. autoplanOffense's trailing aimSnap() call
  // puts the ordinary snap-to-QB back on, exactly as it does after Clear
  // Arrows or a new down.

  const leanDir = norm({ x: side * OPTION_DIVE_LEAN, y: 1 });
  for (const p of line) {
    setPlan(state, p.id, leanDir, 1); // gives cutBlock's setMode a heading to freeze into `facing`
    setMode(state, p.id, 'cutBlock');
  }

  setPlan(state, rb.id, leanDir, 1); // the dive -- real when he has the ball, the fake when he doesn't
  setPlan(
    state, qb.id,
    give
      ? norm({ x: -side, y: OPTION_FAKE_FORWARD }) // a boot away from the play, selling nothing
      : norm({ x: side * OPTION_KEEP_LEAN, y: 1 }), // the keep: wider than the dive, clearing the crashed reader
    give ? OPTION_FAKE_THROTTLE : 1,
  );

  const blockers = offense.filter((p) => p.id !== qb.id && p.id !== rb.id && !OFFENSIVE_LINE_ROLES.has(p.role));
  applyBlocks(state, blockers);

  return give
    ? 'Read: contain outside. Direct snap to the RB -- the QB fakes the boot.'
    : 'Read: crash inside. QB keeps it -- the RB fakes the dive.';
}
```

`playSide`, `playSideEdgeX` and `readDefender` are exported (pure, and
individually testable):

```js
/** Which way (1 = right/+x, -1 = left/-x) this play runs. The tight end's
 * own side if there is one (the extra gap/blocker), else a fixed default. */
export function playSide(offense) {
  const te = offense.find((p) => p.role === 'TE');
  return te ? (Math.sign(te.pos.x) || 1) : 1;
}

/** The x of the widest offensive lineman on the play side -- the edge of the
 * blocked box, and the reference the read is measured against. */
export function playSideEdgeX(side, line) {
  const onSide = line.filter((p) => side * p.pos.x >= 0);
  const pool = onSide.length ? onSide : line;
  return pool.reduce((best, p) => (side * p.pos.x > side * best.pos.x ? p : best)).pos.x;
}

/** The widest defensive lineman on the play side -- the man the option reads.
 * Reuses defense.js's own positionGroup so a 4-man, 3-man or unbalanced front
 * all still hand back a reader. Null if the defense has fielded no line at all. */
export function readDefender(state, side) {
  const dl = state.players.filter((p) => p.team === 'defense' && positionGroup(p) === 'line');
  if (!dl.length) return null;
  return dl.reduce((best, p) => (side * p.pos.x > side * best.pos.x ? p : best));
}
```

The read itself: `reader.pos.x` more than `OPTION_READ_UNITS` outside
`edgeX` (toward the play side) reads as **contain** (he's widened himself to
protect the edge, so the alley he vacated inside is the give); anything at or
inside that line reads as **crash** (he's already squeezing the dive, so the
edge he just vacated is the keep). This is the same "how far outside the
ball a containing rusher keeps himself" idea `defense.js`'s own
`AI_CONTAIN_UNITS` measures, read from the offense's side of the ball.

### Every turn after: adaptive, not scripted

```js
function planInPlay(state, offense) {
  const car = carrier(state);
  if (!car || car.team !== 'offense') {
    // Loose ball, or the defense somehow already has it: everybody goes and
    // gets it. Reuses ai.js's own lead-the-carrier / chase-the-loose-ball
    // math -- the same function the computer's pursuit brain runs on the
    // other side of the ball.
    for (const p of offense) {
      const target = pursuitTarget(state, p);
      if (!target) continue;
      const to = sub(target, p.pos);
      if (len(to) === 0) continue;
      setPlan(state, p.id, norm(to), 1);
    }
    return 'Scrambling for the ball.';
  }

  setPlan(state, car.id, daylightDirection(state, car), 1);
  applyBlocks(state, offense.filter((p) => p.id !== car.id));
  return `${car.role} finds the alley -- everybody else blocks.`;
}
```

`daylightDirection` (pure, exported): scores a fan of running lanes by how
much room each has, and picks the widest.

```js
export function daylightDirection(state, carrier) {
  const defenders = state.players.filter((p) => p.team === 'defense');
  let bestDir = null;
  let bestScore = -Infinity;
  for (const deg of DAYLIGHT_ANGLES_DEG) { // [0, -20, 20, -40, 40, -60, 60] -- straightest first
    const rad = (deg * Math.PI) / 180;
    const dir = { x: Math.sin(rad), y: Math.cos(rad) }; // deg 0 = straight upfield (+y)
    let clearance = Infinity;
    for (const d of defenders) {
      const rel = sub(d.pos, carrier.pos);
      const along = dot(rel, dir);
      if (along <= 0 || along > DAYLIGHT_LOOKAHEAD_UNITS) continue; // behind him, or too far off to matter yet
      const across = len(sub(rel, scale(dir, along))); // perpendicular distance off this lane
      clearance = Math.min(clearance, across);
    }
    if (clearance > bestScore) { bestScore = clearance; bestDir = dir; } // strict >, so the first (straightest) win on a tie
  }
  return bestDir ?? { x: 0, y: 1 };
}
```

`applyBlocks` (module-private) pairs blockers to defenders with the same
greedy nearest-pair pass `defense.js`'s `claimNearest` already uses for
coverage (closest gap first, sorted, ties on id, nobody claimed twice), then
gives each pair a plan: run at him if still closing the gap, or commit to
`holding` (legal for any offensive player, not just linemen) once he's within
engaging range.

```js
function assignBlocks(blockers, defenders) {
  const pairs = [];
  for (const b of blockers) for (const d of defenders) pairs.push({ b: b.id, d: d.id, gap: dist(b.pos, d.pos) });
  pairs.sort((a, b) => a.gap - b.gap || a.b.localeCompare(b.b) || a.d.localeCompare(b.d));
  const map = new Map();
  const claimed = new Set();
  for (const { b, d } of pairs) {
    if (map.has(b) || claimed.has(d)) continue;
    map.set(b, d);
    claimed.add(d);
  }
  return map;
}

function applyBlocks(state, blockers) {
  const defenders = state.players.filter((p) => p.team === 'defense');
  const map = assignBlocks(blockers, defenders);
  for (const b of blockers) {
    const dId = map.get(b.id);
    if (!dId) continue; // more blockers than defenders left -- nobody left for him to block
    const d = getPlayer(state, dId);
    const gap = sub(d.pos, b.pos);
    if (len(gap) === 0) continue;
    setPlan(state, b.id, norm(gap), 1);
    if (len(gap) <= b.radius + d.radius + BLOCK_ENGAGE_UNITS) setMode(state, b.id, 'holding');
  }
}
```

Because this re-runs from whatever the board actually looks like every time
the button is pressed, it is not "scripted for turn 0 and 1, generic after" —
turn 0 is genuinely special (the ball is still physically on the centre, and
the direct-snap trick only makes sense before it moves), and every turn from
1 onward runs the *same* adaptive read, recomputed fresh, so a blocker too far
away to matter last turn can pick a man up this turn, and the carrier's lane
gets rescored against wherever the defense has actually gotten to.

## New constants (`lib/game/constants.js`)

Appended as a new section, following the file's existing convention of one
named constant per concept with a comment explaining the number:

```js
// --- the human offense's autoplan (QB run option) ---
// How far wide of the offensive line's own edge the play-side defender has to
// be standing before the read calls him "containing" rather than "crashing".
// The same idea as AI_CONTAIN_UNITS (a defense's own contain lane), read from
// the other side of the ball.
export const OPTION_READ_UNITS = 6;
// The lean every play-side runner takes off a straight-upfield line: the
// ratio of sideways push to forward push in the (unnormalized) direction
// before it is normalized. The dive stays tight to the line the o-line is
// stepping; OPTION_KEEP_LEAN is wider because the quarterback has to clear
// the crashed read defender rather than hit a blocked gap.
export const OPTION_DIVE_LEAN = 0.5;
export const OPTION_KEEP_LEAN = 1.2;
// The quarterback's fake when the RB actually has the ball: a step away from
// the play, shallow upfield -- OPTION_FAKE_FORWARD plays the same role
// OPTION_DIVE_LEAN's y=1 does for the dive, and OPTION_FAKE_THROTTLE keeps it
// well under full speed, since it is a sell and not the play.
export const OPTION_FAKE_FORWARD = 0.3;
export const OPTION_FAKE_THROTTLE = 0.5;
// How close a blocker has to already be to the man he's assigned before
// autoplan commits him to the holding stance instead of just running at him
// -- past this range he is still closing the gap, not yet in a position to
// screen anybody.
export const BLOCK_ENGAGE_UNITS = 4;
// The fan of running lanes the ball carrier's "find daylight" heuristic
// scores, in degrees off a straight-upfield line. 0 first, so a dead tie
// reads as "there is no reason to cut" rather than being resolved by
// whichever angle happens to iterate last.
export const DAYLIGHT_ANGLES_DEG = [0, -20, 20, -40, 40, -60, 60];
// How far ahead of the carrier a defender counts against a candidate lane at
// all. A defender further upfield of him than this has not committed to
// anything yet; one already behind him already missed. About 8 yards.
export const DAYLIGHT_LOOKAHEAD_UNITS = 30;
```

## UI integration

**`index.html`** — one new button in the Coaches Menu, next to the other
planning-phase actions:

```html
<button id="run">Run Turn</button>
<button id="clear">Clear Arrows</button>
<button id="autoplan-offense">Autoplan offense</button>
<button id="ai">Defense: computer (smart)</button>
```

**`lib/game/render.js`** — a third quick-press field icon, 🎁 (U+1F381),
stacked directly above Run Turn. The existing two-button stack
(`renderFieldButtons`) puts `reposition` at `midY - offset` and `run` at
`midY + offset`; this adds `autoplan` at `midY + offset` and pushes `run` down
to `midY + offset * 2`, so top-to-bottom reads reposition, (menu, fixed at
`midY`), autoplan, run:

```js
export function renderFieldButtons(state, { repositioning = false, animating = false, cameraYard } = {}) {
  const midY = buttonColumnMidY(state.losYard, cameraYard ?? state.losYard);
  const offset = FIELD_BTN_PITCH;
  const parts = [];
  if (canReposition(state) && !animating) {
    parts.push(fieldButtonMark({
      attr: 'data-reposition-button', icon: '\u{1F500}',
      label: repositioning ? 'Reposition players: on' : 'Reposition players: off',
      cy: midY - offset, on: repositioning, pressed: repositioning,
    }));
  }
  if (state.aiTeam !== 'offense') {
    parts.push(fieldButtonMark({
      attr: 'data-autoplan-button', icon: '\u{1F381}',
      label: 'Autoplan offense',
      cy: midY + offset, off: animating || state.phase !== 'planning',
    }));
  }
  parts.push(fieldButtonMark({
    attr: 'data-run-button', icon: '\u{23E9}', label: 'Run the turn',
    cy: midY + offset * 2, off: animating || state.phase !== 'planning',
  }));
  return parts.join('');
}
```

(`canReposition`/`fieldButtonMark`/`FIELD_BTN_PITCH` already exist in this
file; only the body above changes, plus the new import of `renderFieldButtons`
staying exported as it already is.)

**`app/main.js`**:

- Import `autoplanOffense` from `../lib/game/offense.js`.
- `const autoplanBtn = document.getElementById('autoplan-offense');`
- A `pressAutoplanOffense()` function, the same shape as `pressRun`/`toggleReposition` — one function both triggers call:

  ```js
  function pressAutoplanOffense() {
    if (animating || state.phase !== 'planning') return;
    const note = autoplanOffense(state);
    if (note === null) return; // declined silently -- the computer is coaching this team
    pendingWarning = false;
    say(note);
    paint();
  }
  ```
- `autoplanBtn.addEventListener('click', () => { closeMenu(); pressAutoplanOffense(); });`
- `pressBoardButton` grows a fourth branch: `else if (target.closest('[data-autoplan-button]')) pressAutoplanOffense();`
- `paint()` grows: `autoplanBtn.disabled = animating || state.phase !== 'planning' || state.aiTeam === 'offense';` and disables it in the same block `pressRun` already greys every other control out in while `animating`.

## Testing

New `test/game/offense.test.js`, following `test/game/defense.test.js`'s
style (plain `node:test`, `createGame`/`getPlayer` fixtures, moving a specific
player's `pos` to set up a scenario). At minimum:

- `playSide`: returns the tight end's side on the 11-man roster; defaults to
  1 (right) on the 7-man roster, which has no TE.
- `playSideEdgeX`/`readDefender`: basic geometry on a hand-built player list.
- The read: moving the play-side edge defender wide of the tackle box calls a
  give (`autoplanOffense` on turn 0 leaves `state.plannedPass.target` as the
  RB's id); moving him inside/even calls a keep (`state.plannedPass.target`
  stays the QB's, i.e. the untouched automatic snap).
- O-line ends up in `cutBlock` with a plan, on turn 0 only.
- `autoplanOffense` returns `null` and changes nothing when
  `state.aiTeam === 'offense'`, and when `state.phase !== 'planning'`.
- Turn 1+ with the RB carrying: the RB gets a plan from `daylightDirection`,
  and every other offensive player gets either a run-at-him plan or a
  `holding` stance pointed at a defender, with no two blockers assigned the
  same defender.
- `daylightDirection`: a defender planted directly in the straight-upfield
  lane, with both flanks clear, produces a direction other than straight
  upfield; a fully symmetric defense produces straight upfield (the tie-break).
- Loose ball (`state.ball.carrierId = null`, `pos` set): every offense
  player's plan points toward the ball.

## Non-goals

- No attempt to model the QB physically carrying the ball toward the RB
  before it changes hands — the direct-snap simplification is deliberate (see
  above), not a placeholder for a future two-throw mechanic.
- No new stance, mode, or physics change. Every primitive used
  (`cutBlock`, `holding`, `setPass` with a `target`, `setPlan`) already exists.
- No AI difficulty setting, no "watch the computer run this play" mode — this
  is strictly a fill-in-the-arrows helper for the human's own team, in the
  same spirit as loading a saved play.
- Play-side selection is a single fixed heuristic (TE's side, else right). No
  per-play formation strength analysis beyond that.
- Every offensive player's mode is reset to `normal` before each re-plan,
  including a lineman still mid-`cutBlockDrive` from a cut block he threw the
  turn before. In the common case he is immediately reassigned a fresh block
  by `applyBlocks` anyway, so this is invisible; only in the edge case of more
  offensive blockers than remaining defenders does it end his drive a turn
  early with nothing to show for it. Accepted as a simple, uniform "everyone
  gets fresh orders every press" rule rather than special-cased.
