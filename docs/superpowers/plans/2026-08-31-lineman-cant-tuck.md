# Lineman Can't Tuck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop offensive linemen from ever entering the `'tucked'` stance — most
visibly, the centre currently can be long-pressed into "tucked" on the opening
play because he's the placeholder pre-snap ball carrier. After this plan, no
lineman (C, LG, RG, and — on the 11-a-side roster — LT, RT) can tuck, no
matter who is holding the ball or what turn it is. The other half of the
user's request, "linemen are the only ones that can cut block," is already
true of the shipped code (verified below); this plan adds a regression test
that locks it in rather than re-implementing it.

**Architecture:** `player.mode` legality is decided in exactly one place,
`setMode` in `lib/game/state.js`. The `'tucked'` branch there currently only
checks "are you the current ball carrier" — no position check. This plan adds
a `!OFFENSIVE_LINE_ROLES.has(p.role)` guard to that branch, the same set
already used to gate `'cutBlock'` two lines below it. The UI's long-press
stance picker in `app/main.js` independently re-derives which stance to
*offer* before calling `setMode` (so a refusal doesn't read as a confusing
"C can't do that" message); it needs the identical guard, applied by
reordering its checks so the lineman/cut-block case is decided before the
carrier-tucked case.

**Tech Stack:** Plain ES modules, `node --test` (`npm test`). No new
dependencies, no new constants.

**Spec:** The user's own description, quoted in full because there is no
separate spec document for this feature:

> the offensive center player currently tries to tuck the ball on the first
> play, make it so lineman can't tuck the ball, and they are the only ones
> that can cut block.

## Global Constraints

- No npm dependencies, no build step, no DOM/`node:` imports inside
  `lib/game/` (existing project-wide rule).
- `npm test` (`node --test`) must pass after every task.
- Comment style: prose explaining **why**, matching the density and voice of
  the surrounding file. Do not write comments that only restate the code.
- No new constants are introduced by this plan — reuse the existing
  `OFFENSIVE_LINE_ROLES` set from `lib/game/rosters.js`.

## Design decisions (resolving spec ambiguities — read before implementing)

1. **One choke point, one fix.** Every mode change in the codebase — human
   long press, AI (`ai.js`), the option-play autoplan (`offense.js`), play/
   coach-log replay (`play.js`, `coach-log.js`), and the learned offense
   policy's `tuckIfPressured` (`lib/game/learned/offense-policy.js:217`) —
   calls `setMode`, and `setMode` is the only place that ever writes
   `p.mode = mode`. Fixing the `'tucked'` branch in `setMode` (Task 1) is
   therefore sufficient to make the rule hold everywhere in the simulation;
   nothing else in `lib/game/` needs to change.

2. **"Linemen can't tuck" means never, not just pre-snap.** The spec's
   trigger is the first-play bug, but the fix reads literally: a lineman must
   never be allowed to tuck, at any `turnIndex`, regardless of who currently
   holds the ball. This is a strict superset of "don't let the centre tuck on
   turn 0," and it's what `!OFFENSIVE_LINE_ROLES.has(p.role)` with no
   `turnIndex` condition gives us. One consequence: if a lineman ever ends up
   as the ball's `carrierId` mid-play (e.g. recovering a live fumble), he
   simply can't enter `'tucked'` — he falls through to `'holding'` in the UI
   (offense, not tucked, not cut-block-eligible past turn 0). That's an
   accepted, natural side effect, not a gap to patch.

3. **The UI's stance picker needs the same guard, reordered rather than just
   patched in place.** `app/main.js`'s long-press handler
   (`app/main.js:390-403`) currently checks "is he the carrier → tucked"
   *before* "is he a lineman on turn 0 → cut block." That ordering is exactly
   why the centre gets offered `'tucked'` today. The fix is to check the
   lineman/cut-block case first — it already existed as its own branch right
   below the carrier check — so a lineman on turn 0 is always routed to cut
   block, and a lineman off turn 0 (or not currently in mode `'normal'`) falls
   through to `'holding'` like any other offensive non-carrier. Adding
   `!OFFENSIVE_LINE_ROLES.has(p.role)` to the carrier-tucked branch too keeps
   it consistent with `setMode`'s own legality even though, with the reorder,
   that branch can now only ever be reached by a non-lineman.

4. **Cut-block-is-lineman-only is already correct — verify, don't
   reimplement.** `setMode`'s existing `'cutBlock'` branch
   (`state.js:298-299`) already requires `p.team === 'offense' &&
   OFFENSIVE_LINE_ROLES.has(p.role) && state.turnIndex === 0`, and it's the
   only branch that ever grants `'cutBlock'` or `'cutBlockDrive'` (the drive
   phase is only ever entered by `block.js`'s `advanceCutBlockPhases`
   transitioning a player already in `'cutBlock'` — never originated fresh).
   The existing test at `test/game/state.test.js:96-98` already covers one
   non-lineman offensive role (`o-rb`) and one defensive role (`d-nt`). Task 3
   broadens that to every role in the default 7-a-side roster, as explicit
   regression protection for this half of the spec, without touching
   `setMode` itself.

5. **Fumble-related uses of `mode === 'tucked'` are unaffected.**
   `rules.js:51`'s `TUCK_BREAK_BONUS` and `modes.js:64`'s `fumbleChance`
   both key off `player.mode === 'tucked'`, but they're only ever evaluated
   for whoever the live ball carrier is — in every existing test and every
   AI code path (`tuckIfPressured` in `offense-policy.js`, always called with
   the QB or RB as `car`) that's a skill-position player, never a lineman.
   Excluding linemen from `'tucked'` doesn't change any of that logic; it
   just means a lineman carrier (an edge case already rare today) forfeits
   the tuck's fumble-protection bonus, which is the correct outcome, not a
   regression to guard against with new code.

## File Structure

No new files. Three existing files change:

- `lib/game/state.js` — `setMode`'s `'tucked'` legality branch (line 292):
  add the lineman exclusion. This is the actual behavior fix.
- `app/main.js` — the long-press stance-picker ternary (lines 390-403):
  reorder so a lineman is routed to `'cutBlock'`/`'holding'` and never
  offered `'tucked'`.
- `test/game/state.test.js` — update the two existing tests that assumed the
  centre could tuck (`'mode legality...'` and `'every special move locks an
  axis...'`), and add one new test broadening cut-block-exclusivity coverage.

`app/main.js` has no dedicated test file (it's the DOM/SVG UI layer with no
`node:test` coverage anywhere in this codebase — confirmed by `test/game/`
containing no `main.test.js` and no other file importing from `app/`), so
Task 2's verification is a full-suite run (to catch any accidental breakage
elsewhere) plus a manual smoke test via the dev server.

---

### Task 1: Stop `setMode` from ever granting `'tucked'` to a lineman

**Files:**
- Modify: `lib/game/state.js:292`
- Test: `test/game/state.test.js:86-108` (mode-legality test), `test/game/state.test.js:144-155` (axis-lock test)

**Interfaces:**
- Consumes: `OFFENSIVE_LINE_ROLES` (already imported at `state.js:12` from
  `./rosters.js` — no new import needed), `p.role`, `p.team`,
  `state.ball.carrierId`.
- Produces: `setMode(state, id, 'tucked')` now returns `false` for any player
  whose `role` is in `OFFENSIVE_LINE_ROLES`, regardless of `carrierId` or
  `turnIndex`. No other function's signature changes.

- [ ] **Step 1: Update the existing tests to assert the new behavior (this is the failing test)**

  Replace the `'mode legality...'` test in `test/game/state.test.js` (currently
  lines 86-108) with:

  ```js
  test('mode legality: tuck = non-lineman carrier only, prepared = defense only, holding = offense only', () => {
    const s = createGame({ seed: 1 });
    // The centre holds the ball pre-snap (see the "ball starts tucked in a
    // lineman's hands" comment in state.js), but a lineman can never tuck --
    // this used to be exactly the bug where a long press on the centre before
    // the snap tucked him instead of offering the cut block.
    assert.equal(setMode(s, 'o-c', 'tucked'), false);     // has the ball, but is a lineman
    assert.equal(setMode(s, 'o-qb', 'tucked'), false);    // no ball until it is snapped to him
    assert.equal(setMode(s, 'o-rb', 'tucked'), false);    // no ball
    s.ball.carrierId = 'o-rb';
    assert.equal(setMode(s, 'o-rb', 'tucked'), true);     // a non-lineman carrier can tuck
    setMode(s, 'o-rb', 'normal');
    s.ball.carrierId = 'o-c';
    assert.equal(setMode(s, 'd-lb', 'prepared'), true);
    assert.equal(setMode(s, 'o-lg', 'prepared'), false);
    assert.equal(setMode(s, 'o-lg', 'holding'), true);
    assert.equal(setMode(s, 'd-nt', 'holding'), false);
    // the cut block: offensive linemen only, and only before the play has moved
    assert.equal(setMode(s, 'o-lg', 'cutBlock'), true);
    assert.equal(setMode(s, 'o-rb', 'cutBlock'), false);   // not a lineman
    assert.equal(setMode(s, 'd-nt', 'cutBlock'), false);   // not offense
    setMode(s, 'o-lg', 'normal');
    s.turnIndex = 1;
    assert.equal(setMode(s, 'o-lg', 'cutBlock'), false);   // past the first turn
    // setting a mode arms the next-turn charge (spec: momentum after preparing)
    assert.equal(setMode(s, 'o-c', 'holding'), true);
    assert.equal(getPlayer(s, 'o-c').charge, 1);
    // toggling back to normal clears it
    setMode(s, 'o-c', 'normal');
    assert.equal(getPlayer(s, 'o-c').mode, 'normal');
    assert.equal(getPlayer(s, 'o-c').charge, 0);
  });
  ```

  Replace the `'every special move locks an axis...'` test (currently lines
  144-155) with:

  ```js
  test('every special move locks an axis, and dropping back to normal releases it', () => {
    const s = createGame({ seed: 1 });
    // Linemen can never tuck (see the mode-legality test above), so hand the
    // ball to a back to demonstrate the tucked axis-lock.
    s.ball.carrierId = 'o-rb';
    const rb = getPlayer(s, 'o-rb');
    setMode(s, 'o-rb', 'tucked');
    assert.notEqual(rb.facing, null, 'tucking commits to a line same as breaking down');
    setMode(s, 'o-rb', 'normal');
    assert.equal(rb.facing, null, 'standing back up releases it');

    const lg = getPlayer(s, 'o-lg');
    setMode(s, 'o-lg', 'holding');
    assert.notEqual(lg.facing, null, 'holding position commits to a line too');
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node --test test/game/state.test.js`
  Expected: FAIL — `setMode(s, 'o-c', 'tucked')` still returns `true` against
  the current implementation, so the first `assert.equal(..., false)` in the
  rewritten mode-legality test throws.

- [ ] **Step 3: Implement the fix**

  In `lib/game/state.js`, change line 292 from:

  ```js
    (mode === 'tucked' && state.ball.carrierId === id) ||
  ```

  to:

  ```js
    (mode === 'tucked' && state.ball.carrierId === id && !OFFENSIVE_LINE_ROLES.has(p.role)) ||
  ```

  No import changes — `OFFENSIVE_LINE_ROLES` is already imported at the top
  of the file (`state.js:12`) for the `'cutBlock'` branch just below.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `node --test test/game/state.test.js`
  Expected: PASS

- [ ] **Step 5: Run the full suite**

  Run: `npm test`
  Expected: PASS — confirms nothing else in the suite (e.g. `play.test.js`,
  `rules.test.js`, `modes.test.js`, `render.test.js`,
  `learned/offense-policy.test.js`, all of which use `'tucked'` exclusively
  on `o-qb`, a non-lineman) depended on a lineman being tuckable.

- [ ] **Step 6: Commit**

  ```bash
  git add lib/game/state.js test/game/state.test.js
  git commit -m "fix: offensive linemen can never tuck the ball"
  ```

---

### Task 2: Stop the long-press UI from offering `'tucked'` to a lineman

**Files:**
- Modify: `app/main.js:390-403`

**Interfaces:**
- Consumes: `OFFENSIVE_LINE_ROLES` (already imported at `app/main.js:26`),
  `setMode` (Task 1's updated legality), `state.turnIndex`,
  `state.ball.carrierId`, `p.team`, `p.role`, `p.mode`.
- Produces: no new exports; this is a local ternary inside the existing
  `longpress` gesture branch of the pointer-input handler.

- [ ] **Step 1: Reorder and guard the stance-picker ternary**

  In `app/main.js`, replace the `longpress` branch's `target` computation
  (currently lines 391-401):

  ```js
    const target =
      p.mode !== 'normal' ? 'normal'
      : state.ball.carrierId === playerId ? 'tucked'
      : p.team === 'defense' ? 'prepared'
      // An offensive lineman gets the cut block instead of holding, but only
      // on the snap itself — setMode's own legality agrees (OFFENSIVE_LINE_ROLES,
      // turnIndex === 0); surfacing the same condition here means the long
      // press offers the stance he can actually use instead of one setMode
      // would just refuse past the first turn.
      : p.team === 'offense' && OFFENSIVE_LINE_ROLES.has(p.role) && state.turnIndex === 0 ? 'cutBlock'
      : 'holding';
  ```

  with:

  ```js
    const target =
      p.mode !== 'normal' ? 'normal'
      // An offensive lineman can never tuck (setMode refuses it outright), so
      // this has to be checked before the carrier-tucked branch below —
      // otherwise a long press on the centre pre-snap (he's the placeholder
      // ball carrier before the snap) would offer 'tucked' and setMode would
      // silently refuse it. On the snap itself he gets the cut block instead;
      // any other turn he falls through to holding like any other lineman.
      : p.team === 'offense' && OFFENSIVE_LINE_ROLES.has(p.role) && state.turnIndex === 0 ? 'cutBlock'
      : state.ball.carrierId === playerId && !OFFENSIVE_LINE_ROLES.has(p.role) ? 'tucked'
      : p.team === 'defense' ? 'prepared'
      : 'holding';
  ```

- [ ] **Step 2: Run the full suite**

  Run: `npm test`
  Expected: PASS — `app/main.js` has no direct test coverage, so this step is
  a regression check that nothing elsewhere accidentally imports and depends
  on the old ordering (nothing does; `main.js` isn't imported by any test).

- [ ] **Step 3: Manual smoke test**

  Run: `npm run serve`, open the printed local URL in a browser, and long
  press the centre (`C`) before running the first turn.
  Expected: the message line reads `C: cut block.` (not `C: tucked.` and not
  `C can't do that.`).

- [ ] **Step 4: Commit**

  ```bash
  git add app/main.js
  git commit -m "fix: long-press picker never offers a lineman the tuck stance"
  ```

---

### Task 3: Regression test — cut block stays lineman-only across the whole roster

**Files:**
- Test: `test/game/state.test.js` (new test, add after the mode-legality test from Task 1)

**Interfaces:**
- Consumes: `createGame`, `setMode` (unchanged by this task), the default
  7-a-side roster's player ids: linemen `'o-c'`, `'o-lg'`, `'o-rg'`;
  non-lineman offense `'o-wr1'`, `'o-wr2'`, `'o-qb'`, `'o-rb'`; defense
  `'d-nt'`, `'d-dt1'`, `'d-dt2'`, `'d-cb1'`, `'d-cb2'`, `'d-lb'`, `'d-s'`
  (all defined in `lib/game/rosters.js`'s `SEVEN_OFFENSE`/`SEVEN_DEFENSE`,
  the default variant `createGame` uses when no `variant` option is passed).
- Produces: nothing new — this task only adds test coverage. No production
  code changes; `setMode`'s `'cutBlock'` branch (`state.js:298-299`) is
  already correct, per Design Decision 4.

- [ ] **Step 1: Write the test**

  Add to `test/game/state.test.js`, after the `'mode legality...'` test:

  ```js
  test('cut block is offensive linemen only -- every role in the default roster', () => {
    const s = createGame({ seed: 1 });
    for (const id of ['o-c', 'o-lg', 'o-rg']) {
      assert.equal(setMode(s, id, 'cutBlock'), true, `${id} is a lineman and should be able to cut block`);
      setMode(s, id, 'normal');
    }
    for (const id of ['o-wr1', 'o-wr2', 'o-qb', 'o-rb']) {
      assert.equal(setMode(s, id, 'cutBlock'), false, `${id} is offense but not a lineman`);
    }
    for (const id of ['d-nt', 'd-dt1', 'd-dt2', 'd-cb1', 'd-cb2', 'd-lb', 'd-s']) {
      assert.equal(setMode(s, id, 'cutBlock'), false, `${id} is defense`);
    }
  });
  ```

- [ ] **Step 2: Run the test to verify it passes**

  Run: `node --test test/game/state.test.js`
  Expected: PASS immediately — `setMode`'s `'cutBlock'` legality already
  implements this rule (see Design Decision 4); this step confirms it rather
  than driving new implementation.

- [ ] **Step 3: Run the full suite**

  Run: `npm test`
  Expected: PASS

- [ ] **Step 4: Commit**

  ```bash
  git add test/game/state.test.js
  git commit -m "test: lock in cut block as offensive-linemen-only across every role"
  ```
