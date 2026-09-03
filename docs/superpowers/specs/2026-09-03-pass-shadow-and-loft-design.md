# Pass shadow and loft — design

## What this is

A deep throw today shows a coach two things: a short cosmetic arrow near the
passer (capped at `MAX_PASS_ARROW_UNITS`, nowhere near the real landing spot
on a long throw) and a landing circle far downfield showing the *uncertainty*
around where it lands. Nothing connects the two, nothing says how long the
ball is going to hang in the air, and nothing says which of the men on the
field it sails over without any chance of a play on it. This makes exactly
the throw that most needs foresight — the deep lob — the hardest one to plan.

This adds three things, all at throw-planning time only:

- A **flight-path line** from the passer to the real landing spot, with the
  dead-zone stretch (the part of the flight nobody can touch, already modelled
  in [lob.js](../../../lib/game/lob.js)'s `deadZone`) drawn differently from
  the catchable stretches at either end.
- **Shadow balls** — one per turn boundary the throw is still in the air —
  marking where the ball will be when this turn ends, and the next, until it
  lands.
- A **loft control**: once a throw is aimed and committed, the coach can grab
  its arrow again and drag to trade speed for hang time, without moving the
  destination. The shadow balls move with it live.

## Decisions

**1. Loft is a new, independent axis on the throw. Distance and direction
never move once the destination is set.**

`state.plannedPass` gains a `loft` field, `0`–`1`, default `0`. It is read by
nothing except the hang-time calculation — `dir`, `power`, and therefore the
real landing spot, are exactly what the first drag committed, before or after
any loft adjustment.

Today's hang time is a fixed multiple of the throw's own arithmetic
(`lobSubsteps` in [lob.js:74](../../../lib/game/lob.js)): every lob, however
short or long the coach's arm, resolves at `LOB_TIME_MULT = 2` turns' worth of
distance-share. `lobSubsteps` gains a second parameter and interpolates
between two multipliers instead of using one fixed one:

```
lobSubsteps(distanceUnits, loft = 0)
  mult = LOB_MIN_TIME_MULT + loft * (LOB_TIME_MULT - LOB_MIN_TIME_MULT)
  return max(1, round(mult * SUBSTEPS_PER_TURN * distanceUnits / PASS_REACH_MAX))
```

`LOB_TIME_MULT` keeps its current value and becomes the ceiling — a throw
dragged to full loft behaves exactly as every lob does today. The new
`LOB_MIN_TIME_MULT = 1` is the floor: the longest throw in the game, thrown
with no loft at all, now covers the board in one turn instead of two.

**This is a real balance change, not only a visual one, and is intended.** A
coach who never touches the loft handle gets a faster ball than the game
throws today. It applies everywhere `lobSubsteps` is reached, including
computer-controlled and auto-snap throws — the AI does not choose a loft
value in this design (see Not doing), so every AI lob also gets faster.
`planLob` and `releasePass` thread the same `loft` through to the actual
throw, so the preview and the ball that leaves the hand always agree.

Loft does not touch `scatterRadius` — how tight the landing circle is stays
governed by distance alone, exactly as `LOB_SCATTER_PER_YARD` sets it today.
Loft is a timing dial, not an accuracy one.

**2. The loft handle is the existing cosmetic arrow tip — not a new widget,
and not the real landing point.**

The arrow drawn while planning a throw (`passArrowMark` /
`passArrowTip`, [render.js:544](../../../lib/game/render.js)) is deliberately
short — capped at `MAX_PASS_ARROW_UNITS` (60 units) regardless of how far the
throw actually reaches, because that comment already explains it as a drag
length, not a distance. It is nowhere near the real landing spot on a deep
throw; only the separate landing circle marks that. Redrawing it out to the
real landing point was considered and rejected — it is a second rendering
change this feature does not need, since the new flight-path line (decision
3) already draws that connection.

So the loft handle is that same short tip, wherever it already renders. Once
`plannedPass` exists, is not locked onto a receiver, and its throw reaches
past `LOB_LOCK_YARDS`, a pointer-down within `PICK_SLOP_UNITS` of that tip is
a loft grab rather than nothing. `PICK_SLOP_UNITS` is the same fat-finger
margin every other pick in the game already uses
([pass.js](../../../lib/game/pass.js) — `receiverAt`, `backOnPasser`).

**Input plumbing.** `hitTest` in `app/main.js` today returns a player id or
`null`; every gesture in the game starts on a player
([input.js](../../../app/input.js) — `if (!playerId) return;`). This is the
first gesture that starts on empty field. `hitTest` gains a second possible
result: `{ loft: passerId }`, checked only when no player is under the
pointer (players always win the hit test, unchanged). `attachInput` branches
on the shape of what `hitTest` returns: a plain id continues through the
existing tap/drag/double-tap machinery unchanged; a `{ loft }` result skips
`classifyGesture` entirely — a loft adjustment is not a run, a throw, or a
stance toggle, it has no direction or throttle of its own — and instead
reports its raw pointer log through two new callbacks,
`onLoftDragPreview(passerId, log)` on move and `onLoftDrag(passerId, log)` on
release, parallel to the existing `onDragPreview` / `onGesture` pair.

**Loft from a drag.** A new pure function (in `pass.js`, beside `passAim` and
`passOrigin`) turns a drag log into a loft value:

```
loftFromDrag(plannedPass, travel)
  shaft = norm(plannedPass.dir)
  signed = dot(travel, shaft)
  return clamp(signed / LOFT_DRAG_UNITS, 0, 1)
```

Dragging the tip further from the passer (`signed > 0`) raises loft toward
`1`; dragging it back toward the passer lowers it toward `0`, where it floors
— it cannot go negative, and there is no "undo the throw" gesture here the
way `backOnPasser` cancels the original pass drag. `LOFT_DRAG_UNITS` is a new
constant sizing how much pointer travel spans the full range; a first cut of
`30` (half of `MAX_PASS_ARROW_UNITS`) is a reasonable start and is a tuning
knob, not a load-bearing number. The value is **absolute per grab**, not
incremental: each new loft gesture is read from its own pointer-down, not
added to whatever loft was already set, so a short, deliberate re-drag always
means what it visually shows.

`onLoftDragPreview` writes the clamped result straight into
`state.plannedPass.loft` on every move — there is nothing to roll back on
release the way a cancelled run or throw drag has, so the "preview" and the
committed value are the same write. The shadow balls and flight path,
described next, redraw from whatever `plannedPass` holds after every paint,
so they track the drag live.

**3. A flight-path line connects the arrow to the landing circle; the dead
zone gets its own look.**

New in `render.js`, drawn only when the planned throw is unlocked and long
enough to lob: a thin line from `passOrigin` to `passAim`
(the two ends `passLandingMark` and `passArrowMark` already use separately),
class `pass-flight`. The stretch of it inside the dead zone — the part of
`deadZone`'s existing `{start, end}` span nobody can touch — gets a second
class, `pass-flight-dead` (dashed), same red as the rest of the throw's
markup but visually distinct from the two catchable stretches at either end.

`deadZone` in `lob.js` currently takes a `lob` object and is unexported —
useful only once a real lob exists. It splits into an exported pure function,
`deadZoneSpan(totalDistanceUnits) → {start, end}`, with `deadZone(lob)`
becoming a two-line wrapper (`deadZoneSpan(dist(lob.from, lob.to))`) so the
one already-tested formula serves both the live ball and the pre-throw
preview.

**4. Shadow balls mark projected position at each turn boundary.**

A new pure function, `passShadowSpots(player, dir, power, loft)` in
`pass.js`, alongside `passLanding`:

```
passShadowSpots(player, dir, power, loft)
  reach = passReach(power)
  if !isLob(reach): return []
  origin = passOrigin(player, dir)
  aim = passAim(player, dir, power)
  total = lobSubsteps(reach, loft)
  turns = ceil(total / SUBSTEPS_PER_TURN)
  return [1..turns].map(n => lerp(origin, aim, min(n * SUBSTEPS_PER_TURN, total) / total))
```

Each point is drawn with the existing `football()` shape
([render.js:208](../../../lib/game/render.js)) in a new `pass-shadow` class
(black, semi-transparent, no rotation — it is a marker, not a ball in
flight). A throw that lands inside its own first turn gets one shadow, at the
aim point; a two-turn throw gets two, exactly matching "if it takes two
turns, show it twice."

This is deliberately computed from the **aim point**, not a rolled scatter —
`planLob`'s random landing offset is only ever drawn once, at the moment the
ball actually leaves the hand (`releasePass`), same as today. The shadow
balls show where the throw is *aimed* to be at each turn boundary; the
landing circle continues to be the one place the coach is told how much that
guess could be off by. Nothing here draws from `state`'s random stream, so
planning-time re-renders stay free of side effects, same discipline the rest
of the preview code already follows.

**5. Scope: unlocked lobs, planning-time only.**

None of this appears for a throw locked onto a receiver (`lockOnPass` never
arcs — [pass.js:127](../../../lib/game/pass.js)), or for a throw short enough
to stay inside `LOB_LOCK_YARDS` (nothing pending to preview; it resolves
within the turn it's thrown, same as today). All three new marks —
flight path, shadow balls, loft handle — are drawn from `state.plannedPass`
and stop the moment the play starts animating, exactly like today's
`renderPassArrow`. They do not persist into the live throw the way
`liveLobMark`'s landing circle does; a coach watching the actual flight sees
the real ball and the real landing circle, not a shadow of a plan that has
already been thrown.

## Architecture

### Changed files

**`lib/game/constants.js`** — new `LOB_MIN_TIME_MULT = 1` and
`LOFT_DRAG_UNITS = 30`. `LOB_TIME_MULT`'s comment is rewritten: it is now the
ceiling a coach reaches by dragging to full loft, not the only value a lob
ever takes.

**`lib/game/lob.js`** — `lobSubsteps(distanceUnits, loft = 0)` takes the new
parameter; `planLob(from, aim, random, loft = 0)` threads it through to the
`substeps` it computes. `deadZone(lob)` splits into exported
`deadZoneSpan(totalDistanceUnits)` plus a thin wrapper.

**`lib/game/pass.js`** — new exports `loftFromDrag(plannedPass, travel)` and
`passShadowSpots(player, dir, power, loft)`. `releasePass` reads
`planned.loft ?? 0` and passes it to `planLob`.

**`lib/game/state.js`** — `setPass(state, id, dir, power, target, loft = 0)`
stores `loft` on `plannedPass`. Every existing caller that omits it keeps
today's `0` default — which, per decision 1, is a real behavior change from
today's fixed `LOB_TIME_MULT`, not a no-op default.

**`lib/game/render.js`** — new `passFlightMark(from, to, deadStart, deadEnd)`
and `passShadowMark(spots)`, plus the `pass-flight`, `pass-flight-dead`, and
`pass-shadow` CSS rules alongside the existing `.pass-land` / `.pass-halo`
block. `renderPassArrow` and the live preview's `throwMark` (`app/main.js`)
both grow the new marks alongside the arrow and landing circle they already
draw, for the unlocked-and-lobbing case only.

**`app/input.js`** — `attachInput`'s `pointerdown` branches on whether
`hitTest` returned a player id or a `{ loft }` result; the latter skips
`classifyGesture` and reports through the two new callbacks described in
decision 2.

**`app/main.js`** — `hitTest` gains the loft-handle branch, checked after the
existing player loop finds nothing. Two new handlers wire
`onLoftDragPreview` / `onLoftDrag` to `loftFromDrag` and a direct write to
`state.plannedPass.loft`, then repaint.

## Testing

**Gained.** Unit coverage in `test/game/lob.test.js` for `lobSubsteps` at
`loft = 0`, `loft = 1` (matching today's existing expectations exactly, so
nothing that currently passes at full loft silently drifts), and a
mid-range value; `deadZoneSpan` as a pure function independent of a `lob`
object. `test/game/pass.test.js` gains `loftFromDrag` (both directions,
clamping at both ends, per-grab independence from any prior loft) and
`passShadowSpots` (spot count and position for one-turn and two-turn
throws, at varying loft). `test/game/state.test.js` gains `setPass`'s new
`loft` argument and its default. A new hit-test case confirms a player under
the pointer always wins over an overlapping loft handle, and that the loft
handle is absent for a locked or short-of-`LOB_LOCK_YARDS` throw.

**Lost.** None expected — this is additive to a part of the codebase
(`lob.js`, `pass.js`) that is already pure-function-heavy and under test;
existing `lobSubsteps`/`planLob` call sites gain a parameter with a default
rather than changing shape.

**Still untested.** The `app/` wiring — `attachInput`'s new branch, the live
loft-drag updating `state.plannedPass.loft` and repainting the shadow balls
in real time, and the loft handle's on-field hit target — same as every
other `app/` interaction today. Verified by hand: drag out a deep lob, grab
the arrow tip again, drag it both directions, watch the shadow balls and
dead-zone segment move; confirm a short throw and a locked throw show none
of the three new marks; confirm the actual thrown ball's hang time matches
whatever the shadow balls last showed.

## Risks

**Existing tests and tuning pinned to today's fixed two-turn lob.** Anything
in `test/game/pass.test.js`, `test/game/train/*`, or the AI's own tuning that
assumes a max-distance lob takes exactly `LOB_TIME_MULT * SUBSTEPS_PER_TURN`
substeps will now see `LOB_MIN_TIME_MULT`'s faster default instead, since no
caller passes a non-zero `loft` unless a coach has dragged for one. These
need auditing during implementation, not just the two lob-specific test
files named above.

**A five-mark throw is a lot of ink for one plan.** Arrow, landing circle,
flight-path line, dead-zone dash, and now one or two shadow balls, all live
at once for a single deep throw. Worth a look on a phone-sized board once
built, not just at desktop scale.

**The hit-test contract changes shape for the first time.** Every gesture in
the game has started on a player since the input model was written; this is
the first one that doesn't, and `attachInput`'s branch on what `hitTest`
returns is new code in a file that has had none. Keeping the player branch
completely unchanged (decision 2) is what limits the blast radius here.

## Not doing

- No change to `LOB_SCATTER_PER_YARD` or `scatterRadius` — loft is a timing
  dial, not an accuracy one, per decision 1.
- No AI strategic choice of loft. Computer-controlled and auto-snap throws
  all use the default `loft = 0`, same as any human throw the coach never
  adjusts. Teaching the AI to choose loft is a separate feature.
- No redraw of the interactive arrow out to the real landing point — decision
  2 keeps it as today's short cosmetic tip.
- No per-player highlighting for the dead zone, only the arrow segment
  (decision 3) — marking individual players was considered and set aside.
- No shadow balls or flight path once the play starts animating — planning
  time only, per decision 5. The live throw keeps exactly the marks it draws
  today (`liveLobMark`'s landing circle).
- No shadow ball for a throw short of `LOB_LOCK_YARDS` — it resolves within
  the turn it's thrown, same as today, so there is nothing pending to show.
- No mid-drag cancel gesture for a loft adjustment beyond dragging back to
  `loft = 0` — there is no equivalent of `backOnPasser`'s "call the whole
  throw off" for this second, smaller gesture.
