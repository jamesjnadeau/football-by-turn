# The controls come out of the SVG — design

## What this is

The board's twelve quick-press controls stop being SVG plates and become real
HTML buttons. On a desktop they keep the right-hand column they have now. On a
phone they become a bar across the bottom, in the thumb zone, at a size a thumb
can actually hit.

The reason is arithmetic. A plate is drawn in field units, so its size on
screen is welded to the board's scale: the crop is 280 units wide, a phone is
about 390 pixels, so a unit is 1.39 pixels and a 9-unit plate renders about
**12.5 pixels**. The usual touch-target guidance is 44. That gap is what has
been producing accidental presses, and it cannot be closed inside the SVG —
44 pixels means 31.6 field units, and a *player* is about 2.

This reverses a decision the previous design recorded under "Not doing", which
declined an HTML rebuild to preserve the renderer's markup-string test
discipline. The cost of that decision has now been paid in mis-taps, and the
approach below keeps most of the discipline anyway (decision 1).

## Decisions

**1. One pure function describes the controls; a thin DOM layer paints them.**

A new `lib/game/controls.js` exports one function:

```js
controlsFor(state, { repositioning, animating, book, allow, aiLabel, highlight }) → Control[]
```

A `Control` is plain data — `{ name, icon, label, aria, group, disabled,
pressed, ringed }` — with no markup and no DOM. Every rule about which controls
exist, what they are called and when they are live lives there, so
`node --test` holds them exactly as it holds the renderer today.

**`label` and `aria` are two strings on purpose.** `label` is the short text the
Coaches Menu shows beside the icon; `aria` is the standalone accessible name for
the bar's icon-only button, which has no visible text to lean on. For most
controls they are the same, and the play slots are where they must differ: the
menu reads `1️⃣ Fly sweep`, while the bar's button has to announce itself as
`Call play 1: Fly sweep`. Today those two strings live in different files and
have quietly drifted — the menu says "Run Turn" where the board says "Run the
turn", "Reposition: off" against "Reposition players: off", "Save current play"
against "Save the current play". Putting both in one row is what stops that.

`app/controls.js` walks that list and syncs real `<button>` elements. It
creates each button **once** and thereafter only writes `textContent`,
`disabled` and classes. It never rebuilds with `innerHTML`, because that
throws away the focus of anyone working the controls from the keyboard —
the lesson `app/main.js` already learned with the Coaches Menu's five slot
buttons, which are built once and only relabelled for exactly this reason.

The alternative considered and rejected was to keep the "everything is a
string" habit and return HTML markup for `innerHTML`. It would have kept the
tests in their current shape, at the price of reintroducing that focus bug on
twelve buttons that are now the primary controls.

**2. The rules move to one place, and stop being stated three times.**

Today each control states its enable condition in three: the handler's own
guard, `*.disabled` in `paint()`, and `off:` in `renderFieldButtons`. All
three agree, nothing enforces that they keep agreeing, and two of the three
live in `app/main.js` where no test can reach them. A previous review found
this and could only suggest pinning the one testable leg.

Both the bottom bar and the Coaches Menu render from `controlsFor`, so each
rule is written once and is under test — including the legs that were
previously unreachable. The rules themselves do not change:

| control | rule |
|---|---|
| 📋 menu | always available |
| 🔀 reposition | **absent from the list** when `!canReposition(state) \|\| animating` — it goes rather than greys, as it does today. Carries `pressed` |
| 🎁 autoplan | disabled when `animating \|\| phase !== 'planning'` |
| ⏩ run | disabled when `animating \|\| phase !== 'planning'` |
| 🤖 defense | disabled when `animating \|\| phase !== 'planning'` |
| 👥 personnel | disabled when `animating \|\| !canReposition(state) \|\| aiTeam === 'defense'` |
| 💾 save | disabled when `animating \|\| !canUsePlays(state)` |
| 1️⃣–5️⃣ | as save, and also when that slot of `book` is empty |

`allow` filters the list, so the tutorial's deny-by-default whitelist keeps
working with no tutorial change — the same mechanism, moved.

`aiLabel` is threaded in rather than read, for the reason it already is today:
`AI_MODES` lives in `lib/game/ai.js`, and importing that for one string drags
the whole learned-AI module graph — `learned/*`, `tendencies.js`, `defense.js`,
`pursuit.js` — into a module whose job is describing buttons. `controlsFor`
inherits that boundary along with the rule it serves.

**3. Two layouts, one list, pure CSS.**

Because the list is data, the layout is a stylesheet rather than a renderer.

- **Desktop.** The right-hand column as it is now: six game controls, six
  playbook, over the board's out-of-bounds margin. Nothing covers the field.
- **Phone.** A bar across the bottom holding the six game controls and a 📓
  playbook toggle — seven at 44 pixels is 308 of a 390-pixel screen. The
  toggle opens the playbook as a sheet above the bar: 💾 Save and 1️⃣–5️⃣.

44 pixels is a floor, not a fixed size: the buttons are sized in `rem` with a
`min-width`/`min-height` of `2.75rem`, so they follow the reader's own text
size instead of pinning to one device's pixels.

📓 is a separate icon from 💾 on purpose. 💾 is an action — it saves the
current play — and a button that sometimes saves and sometimes opens a drawer
is two buttons wearing one mark.

**4. A disabled button is genuinely inert, which is the whole of the
"don't let them be pressed" fix.**

A greyed SVG plate keeps `tabindex="0"` and `pointer-events: all`, so it takes
the tap, takes keyboard focus, and does nothing, silently — `cursor: default`
is the only feedback, and a phone has no cursor. A native `<button disabled>`
cannot be tapped or focused at all. No guard to write; the platform does it.

The play-call rule itself is unchanged and was never broken:
`canUsePlays(state)` is `phase === 'planning' && turnIndex === 0`, and
`callPlay` has always refused outside it. Only the refusal was silent.

**5. Button highlights leave the SVG; player highlights stay.**

The tutorial's ring is `<circle class="tut-ring">` placed from
`fieldButtonAnchor`, which will not exist. So the ring splits by what it is
pointing at: a **player** highlight keeps the SVG circle, because a player is
on the field; a **button** highlight becomes a class on the DOM button, drawn
in CSS.

Which button is ringed stays a tested rule rather than DOM code: `controlsFor`
takes the lesson's `highlight` and marks the matching control `ringed`. A
tutorial concept in a general control module is not new — `allow` already
lives that way in `renderFieldButtons`.

**A constraint falls out of the phone layout, and is written down here because
nothing else would catch it:** a lesson may only ring a control that is
visible in the current layout. Today this is safe — the only names any lesson
rings are `run`, `reposition` and `menu`, all game controls, all in the bar's
visible row. A playbook button ringed on a phone would be ringing something
inside a closed sheet. A test asserts that every `highlight.kind === 'button'`
name in `lib/game/tutorial/script.js` belongs to the `game` group.

**6. The board gets its width back.**

`GAME_VIEWBOX_WIDTH` returns to the shared `VIEWBOX_WIDTH` of 270. The ten
extra units existed only to hold the second column of plates; with the
controls out of the SVG the field renders 3.6% larger again, and its centre
line returns to the frame's centre.

## Architecture

### New files

**`lib/game/controls.js`** — `controlsFor(state, opts) → Control[]`, and the
`Control` shape. Pure; imports the same predicates the renderer imports today
(`canReposition`, `canUsePlays`, `personnelId`, `coachedSide`).

**`app/controls.js`** — the DOM layer. Builds the buttons once from a
`controlsFor` snapshot and syncs them on every paint.

It does **not** import `app/main.js`. The press functions there
(`pressRun`, `toggleReposition`, `pressAi`, `savePlay`, `callPlay`, …) are
module-scope and importing them would make a cycle, since `main.js` must
import this module to mount it. Instead `main.js` hands them over at mount
time as a map of `name → handler`, and this module only calls what it was
given. That keeps the dependency one-way and leaves `main.js` the single owner
of what a press *does* — the discipline the current board and menu already
share.

It owns the phone sheet's open/closed state, which is view state and belongs
here rather than in the game.

**`test/game/controls.test.js`** — the rules.

### Changed files

**`lib/game/render.js`** — `renderFieldButtons`, `fieldButtonMark`,
`menuButtonMark` and `fieldButtonAnchor` are deleted, with the seven
`FIELD_BTN_*` geometry constants and the `.fbtn-*` rules in `STYLE_GAME`:
about 150 lines. `renderBoardShell` loses its `game-menu` and `game-buttons`
layers. `GAME_VIEWBOX_WIDTH` goes.

`FIELD_BUTTONS`, `FIELD_BUTTON_ICONS` and `fieldButtonNames` are **deleted from
`render.js` rather than kept there**. Once the plates are gone the renderer has
no consumer for an icon at all — every remaining reader is the menu or the bar —
so the table moves into `lib/game/controls.js` and becomes part of the control
rows themselves. Keeping it in a module that no longer draws buttons would leave
`controls.js` importing the whole renderer for one string, which is the same
mistake the `ai.js` import was.

The "one emoji, one place" invariant is unchanged in force — there is still
exactly one table — and both its integrity test and the `index.html` heading
assertion move with it.

**`app/main.js`** — `aimCamera` stops painting the two button layers.
`anchorFor` keeps only its player branch. The menu's own buttons take their
labels and disabled state from `controlsFor` instead of from twelve hand-written
lines in `paint()`. The press functions themselves are unchanged.

**`index.html`** — the bar, the sheet, and the first media query this project
has had. The board becomes `height: calc(100% - var(--control-bar-height))` on
narrow screens, so the bar takes its space from the field rather than covering
it — see the risk below.

**`lib/game/tutorial/render.js`** — `highlightMark` keeps drawing the SVG ring
for players. Button rings are CSS.

## Testing

**Gained.** `test/game/controls.test.js` covers every rule in decision 2's
table, including the enable legs that today exist only in `app/main.js` and
are unreachable by any test. This is the largest single gain in the change:
roughly 25 new assertions over rules that were previously guarded once, in a
file no runner can load.

Also: `allow` filtering; reposition's absence rather than disablement; the
`ringed` flag; and the layout constraint from decision 5, asserted against
`script.js` itself.

**Lost.** The plate-geometry tests — plates not overlapping, staying inside
the crop, rows aligning across columns, one plate per table row. They describe
SVG that will not exist, and what replaces them is CSS, which `node --test`
cannot see. About 15 assertions.

**Still untested.** `app/controls.js`, like the rest of `app/`. It is verified
in the browser at both widths: every control does what its Coaches Menu twin
does, disabled controls cannot be pressed, focus survives a repaint, the
tutorial's ring lands on the right button in both layouts, and the bar does not
cover the field.

## Risks

**The bar covers the bottom of the field.** On a phone the bottom of the
window is behind the offense at the snap — exactly where a coach is dragging.
The board must give up its own height rather than let the bar sit over it. It
is a one-line CSS fix and an easy one to forget, and the symptom (players you
cannot reach on the last few yards) reads as a drag bug rather than a layout
one.

**Two layouts, one set of behaviour.** Every browser check runs twice, at both
widths. The desktop layout is the one that already works, so the phone layout
is where the surprises will be.

**The DOM sync layer is new untested code** in a project whose renderer is
almost entirely tested. Decision 1 keeps the rules out of it, which is what
holds the blast radius down: a bug there is a painting bug, not a rules bug.

## Not doing

- No change to any press function, or to any rule about when a control is
  live. This moves where the rules are stated, not what they say.
- No change to `canUsePlays` — see decision 4. The play-call rule was already
  correct.
- No new tutorial lesson and no change to an existing one. `allow` and the
  highlight descriptors keep their present shape.
- No confirmation prompt or undo on `callPlay`. A 44-pixel target and a truly
  inert disabled button are the fix being made here; if mis-taps survive both,
  that is the next conversation, not this one.
- No move of the Coaches Menu itself out of its `<dialog>`.
- No change to `lib/field/geometry.js`.
