# "How to play" — the tutorial, design

## What this is

A guided tutorial reachable from the home screen, under the game chooser. Four
scenarios, each a real down played on the real engine with a handful of men on
the field, each teaching one group of verbs. It ends by telling the coach he is
ready and putting him back on the home screen.

The tutorial is not a simulation of the game. It **is** the game: the same
`runTurn`, the same physics, the same dice. What the tutorial adds is a script
that says what to do next, refuses everything else, and knows when a beat has
landed.

## Decisions

**1. Strict gating, on player and verb — not on aim.**
A step names one action. A gesture on the wrong man, or the wrong gesture on
the right man, is refused before anything is applied, with a nudge saying what
was wanted. But a drag that lands somewhere unhelpful is *allowed*; it simply
does not complete the step, and the card asks again. Refusing a cover drag that
missed the quarterback by two units would read as a broken game rather than as
a lesson.

**2. The lesson lives on the board, in SVG.**
A coach card at the bottom of the window, and a highlight ring pinned to the
thing that must be pressed — a board button or a player's body. Built as markup
strings in `lib/game/tutorial/render.js`, the same discipline `render.js` keeps,
so `node --test` can hold every word of it without a DOM. It is also the only
way to point at a control that lives in SVG coordinates.

The existing message plate at the top of the window is untouched and still says
what the game says: "Tackled!", "FUMBLE!". The card is the coach; the plate is
the referee.

**3. A fixed seed per scenario, and a replay when the play goes off script.**
Every scenario carries its own seed, so the dice are the same for every coach
and the authored beats are reproducible. A play that ends before the script is
done — an early tackle, a fumble, an incompletion — or that draws a flag,
resets the scenario to its first step with "let's run that one again". This
guarantees every coach actually performs every taught verb.

The risk this takes on: identical input reproduces the identical failure. It is
bounded by the fact that going off script requires the coach to have done
something the script did not ask for, and by the skip control, which is always
on the card. From the second attempt onward the card's footer names the skip
explicitly, so a stuck coach is always shown the way out.

**4. The other side is authored, never AI.**
Each scenario names the opposing side's orders per turn as plain data. A
`'scripted'` level in `ai.js` applies them through the existing `applyOrders`.
No scenario depends on how a trained genome happens to be feeling, and
retraining can never change what the tutorial demonstrates.

**5. The Coaches Menu is gone during a lesson.**
No 📋 plate, no dialog. The tutorial teaches the board's own quick-press
buttons, which is what a coach reaches for anyway, and a beginner cannot wander
into personnel packages or genome training in the middle of lesson one. The
card's skip control is the escape valve; skipping the last scenario ends the
tutorial and returns home.

**6. Drill rosters live in `rosters.js`, but in their own table.**
`rosters.js` says of itself that it is the only file that knows the shape of a
formation, so the drill formations go there rather than into a parallel
registry. They go into a separate `DRILL_ROSTERS` map that `getRoster` consults
after `ROSTERS`, for a reason found while checking: four existing tests iterate
`Object.values(ROSTERS)` and assert things that are true of real football and
false of a drill — equal sides, exactly `minOnLine` men on the line, an offense
whose x positions average to the middle of the field, a defense that
`alignDefense` would leave where it stands. Dropping drills into `ROSTERS`
would force all four to be weakened, and those tests guard the real game. A
second table keeps them sharp and gets the drills a weaker test of their own.

They are absent from `VARIANTS` either way, so the home screen cannot list them
and `isPlayable` cannot start one.

**7. A lesson's defense is never realigned.**
`reposition()` in main.js calls `realignDefense()` after every move, which for a
computer-coached defense slides its men to answer the new look. In scenario 4
that would break the authored vertical stack the moment the coach drags his
quarterback. A lesson's men stand where the script put them, so
`realignDefense` returns early during one.

## The scenarios

The ball is on the 50 for all four. Positions are `across` (yards from the
middle, negative left) and `down` (yards from the line of scrimmage, negative
toward the offense's own goal), exactly as `rosters.js` writes them.

### Roster `tutorial-2v2` — scenarios 1, 3 and 4

    offense   o-c   C    across 0   down -1
              o-qb  QB   across 0   down -4
    defense   d-nt  NT   across 0   down  1
              d-lb  LB   across 0   down  4

Four men on one vertical line, `minOnLine: 0`.

### Roster `tutorial-pass` — scenario 2

The same, plus `o-rb  RB  across 6  down -5`. Offset rather than stacked
behind the quarterback: a throw straight backward down the line is a lateral,
which is not the lesson.

### Scenario 1 — "The snap, and running with it"

Coach: offense. Scripted: defense. Buttons: run only.

The nose tackle is authored to rush the passer and the linebacker to fill
behind him — a real but unhurried rush, so the taught beats have room.

1. **The snap.** The dashed arrow from centre to quarterback is already drawn.
   Explain that every play starts with it, that it is the one order a coach
   never has to give, and that it can be aimed at somebody else if he wants.
   *Required:* press ⏩. *Highlighted:* the ⏩ plate.
2. **Running, and how hard.** Drag from the quarterback. The lesson is that
   the drag says two things — which way, and how hard, because arrow length is
   throttle — and that the filled circle is where he actually ends up at the
   whistle. *Required:* a drag on `o-qb`. Then press ⏩.
3. **Tucking.** Double-tap the quarterback. Tucked he is a little slower and
   far less likely to fumble, and he is locked onto the axis he was running.
   *Required:* a double tap on `o-qb` leaving him `tucked`. Then press ⏩.
4. **The whistle.** Let it run out. The card names what ended the play.

### Scenario 2 — "Blocking, and throwing it"

Coach: offense. Roster `tutorial-pass`. Buttons: run only. The defense is the
same two men, authored the same way.

1. **The cut block.** Double-tap the centre. Only a lineman can do this, and
   only on the first turn of a play — it is a call made at the line. The shove
   itself waits for the snap, so the rest of the huddle can still be drawn.
   *Required:* a double tap on `o-c` leaving him `cutBlock`.
2. **Draw the routes.** Set the quarterback and the back running however he
   likes, with the warning that the throw is coming next turn and the
   quarterback has to still be behind the line to make it legally.
   *Required:* both `o-qb` and `o-rb` have a plan. Then press ⏩.
3. **The throw.** Double-tap the quarterback and drag onto the back — two
   quick taps, then drag, and dropping it on a man of your own locks the throw
   onto him. *Required:* `state.plannedPass` from `o-qb` targeting `o-rb`.
   Then press ⏩.
4. **The whistle.** Let it run out.

### Scenario 3 — "Playing defense"

Coach: defense. Scripted: offense. Buttons: run only.

Authored offense: the centre covers (blocks) the nose tackle from the snap
onward, and the quarterback takes the ball and runs left.

1. **Covering a man.** Drag the linebacker's arrow onto the quarterback. A
   cover order is not an arrow: it is re-aimed at wherever the man has got to,
   every sub-step, which is what lets it stay with somebody who cuts.
   *Required:* a drag on `d-lb` leaving `d-lb.cover === 'o-qb'`. Then press ⏩.
2. **Breaking down.** He is on him now — double-tap the linebacker to set his
   feet. He reaches further and hits harder inside the wedge he is facing, and
   can only shuffle sideways from here. This is taught at the moment the
   computer's own defense would do it, which is the honest place for it.
   *Required:* a double tap on `d-lb` leaving him `prepared`. Then press ⏩.
3. **The whistle.** Let it run out.

### Scenario 4 — "Where they stand"

Coach: offense. Roster `tutorial-2v2`. Buttons: reposition and run.

1. **Reposition on.** Press 🔀. *Required:* `repositioning === true`.
   *Highlighted:* the 🔀 plate.
2. **Move a man.** Drag the quarterback somewhere else. In this mode a drag
   moves a man rather than giving him an order, and the snap re-aims itself
   from wherever the two end up. *Required:* `o-qb` has moved off his starting
   spot.
3. **Reposition off.** Press 🔀 again. *Required:* `repositioning === false`.
4. **Coach it.** Anything goes: draw what he likes and run it to the whistle.
   *Required:* nothing; ⏩ until the play ends.
5. **The sign-off.** "You're ready to coach." Back to the home screen.

## Architecture

### New files

`lib/game/tutorial/script.js` — the scenarios as data. Pure, no imports from
`app/`.

`lib/game/tutorial/machine.js` — the step machine. Pure functions over
`(scenario, stepIndex, state, ctx)`:

    stepAt(scenario, index)                  -> step | null
    allows(scenario, index, action)          -> null | nudge string
    isComplete(scenario, index, state, ctx)  -> boolean
    offScript(scenario, index, state)        -> boolean
    cardFor(scenario, index, attempt)        -> card

`lib/game/tutorial/render.js` — `coachCardMark(card, losYard, cameraYard)` and
`highlightMark(anchor)`.

`app/tutorial.js` — the bridge. Builds each scenario's state, holds the step
index and the attempt count, and answers main.js's four questions.

`app/tutorial-store.js` — the "finished it" flag in `localStorage`, matching
`coach-store.js` and `genome-store.js`.

### Changed files

`lib/game/state.js` — `createGame` gains `losYard` and `scriptedOrders`
options. `losYard` is hardcoded to `DRIVE_START_YARD` today, which is why a
drill would otherwise open on the own 20.

`lib/game/ai.js` — a `'scripted'` level, branching before `applyAiModes` the
way the learned-offense branch does, so an authored stance is not overwritten
by the generic break-down rule. Past the end of the orders array the last
turn's orders repeat: a blocker told to block should keep blocking rather than
go limp when `clearAiPlans` wipes him at the whistle.

`lib/game/rosters.js` — the two drill rosters, and optional `offenseSize` /
`defenseSize` on a roster, defaulting to `teamSize`. `formationPlayers`
asserts each side's length against its own size, which is what lets scenario 2
field three men against two. Real variants are untouched.

`lib/game/render.js` — a `game-tutorial` layer at the top of the z-order; the
button column's geometry extracted into `fieldButtonLayout` so
`renderFieldButtons` and the new `fieldButtonAnchor` cannot disagree about
where a plate is; an `allow` option naming which buttons a lesson fields; and
the card's style rules in `STYLE_GAME`, which is the board's stylesheet and so
the right home for something drawn on the board.

`lib/game/home.js` / `app/home.js` — the "How to play" button under the variant
list. It skips the side chooser.

`app/main.js` — one `lesson` variable, consulted at `onGesture`, `pressRun`,
`toggleReposition`, `pressBoardButton` and `paint`.

## Data flow

A press or a gesture arrives in `main.js`, which builds an **action**:

    {kind: 'run'}
    {kind: 'reposition'}
    {kind: 'menu'}
    {kind: 'gesture', playerId, gestureKind}   // 'drag' | 'passdrag' | 'doubletap' | 'click'

`lesson.allows(action)` returns `null` to proceed or a nudge string. A nudge is
said on the card and the action is dropped before anything is applied, so there
is never a half-committed order to undo.

When the action does proceed and is committed, `main.js` calls
`lesson.saw(ctx)` with what happened — `{repositioning, ranTurn, events}`. The
bridge asks `isComplete`; if the step landed, the index advances and the card
changes. After a turn it then asks `offScript`, in that order, so the final
"watch it finish" step is reached before the play-over check that would
otherwise call it a failure.

Every step also carries a `demo`: the model answer, as data — `{verb: 'drag',
id, to}`, `{verb: 'doubletap', id, mode}`, `{verb: 'pass', from, target}`,
`{verb: 'run'}` and so on. Nothing in the running game reads it. It exists so
the integration test below can perform each step's intended action without
test-only knowledge of what the step meant, and it is what a future animated
hint would draw.

`offScript` is true when a flag has been thrown, or when the play is over while
the current step still needs a live play. Every step carries `needsLivePlay`;
only the closing beat of each scenario sets it false.

An off-script scenario is rebuilt from scratch: a fresh `createGame` with the
same scenario seed, the step index back to zero, and the attempt count up one.

## Error handling

A drill roster with `minOnLine: 0` cannot draw an illegal-formation flag, so the
only flags reachable in a lesson are the two pass fouls, both from scenario 2.
Both are caught by `offScript` and replayed.

`updateCoverPlans` already drops a cover order whose man has left the field, so
an authored order naming an id the scenario does not field degrades to no order
rather than throwing mid-turn. The script test below is what stops one being
written in the first place.

Skipping the last scenario, finishing it, and pressing skip on the sign-off all
land in the same place: the finished flag is stored and `onExit` returns to the
home screen.

## Testing

Everything under `lib/game/tutorial/` is pure and gets ordinary `node --test`
coverage: the machine's allow/refuse table, step advancement, off-script
detection, replay bookkeeping, and the card and highlight markup as strings.

Two tests carry more weight than the rest:

**The script is valid.** Every step's named player exists in its scenario's
roster; every authored order names a real id on the scripted team; every
scenario's coached side is the one the human is given; every step has a nudge
and a `needsLivePlay`. This is the test that keeps the data honest, since the
data is where the whole tutorial lives.

**The seed does what the script says.** A headless run drives each scenario
through the real `createGame` / `runTurn` with its own seed, performing the
scripted action at each step, and asserts every step completes and the play does
not go off script. This is the only thing that can prove decision 3's fixed
seeds actually produce the authored beats — and it will fail loudly if a physics
or tuning change ever moves them.

## Not doing

Snapping to somebody other than the quarterback is stated in scenario 1's first
card but never made a step; the tutorial says it is possible and moves on.

There is no beat about the down-and-distance line or the four-down cycle. Each
scenario is one down, played and left; `nextDown` is never called.
