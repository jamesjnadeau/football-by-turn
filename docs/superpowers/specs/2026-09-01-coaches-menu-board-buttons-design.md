# The coaches menu, out on the board — design

## What this is

Nine more quick-press plates on the right-hand margin, so that everything a
coach reaches for during a down is on the board instead of behind a dialog he
has to open first. Three of them are game controls that join the column that
already exists — 🧹 Clear Arrows, 🤖 Defense, 👥 Personnel. Six are the
playbook, in a second column beside it — 💾 Save current play, and 1️⃣–5️⃣ to
call one.

Every one of those icons also goes on to its own button inside the Coaches
Menu, so the plate on the board and the line in the menu wear the same mark and
read as the same thing.

Out of scope, and deliberately: the coaching log and the in-browser training
sections keep their menu buttons and get no icons at all. Velocity lines, Next
Down, New Game and Back to Home stay menu-only too — they are still there, and
still work, they simply do not earn a plate on the board.

## What the tutorial already built

This spec was written before the how-to-play tutorial landed, and the tutorial
built most of the machinery it proposed to invent. What is already in
`lib/game/render.js`:

- **`FIELD_BUTTONS`** — the column as a table, each entry carrying `attr`,
  `icon` and `slot`. Written down once so that "the plate a paint draws and
  the ring the tutorial pins to it are worked out from the same number".
- **`fieldButtonAnchor(name, losYard, cameraYard)`** — where a named plate
  sits, which is how the tutorial's highlight ring finds it.
- **`renderFieldButtons(state, { repositioning, animating, cameraYard, allow })`**
  — `allow` is a whitelist of button names; a lesson fields only the controls
  it is teaching, and a normal drive passes `null` and gets everything.
- **`renderBoardShell(losYard, toGoYard, cameraYard, { menu })`** and an
  `aimCamera` that repaints the menu plate and the button column every frame,
  so a scrolling run does not slide the column off with the field.

So the "one icon table" this spec called for exists. It is extended here rather
than duplicated, and gains a third consumer: the menu's own labels.

## Decisions

**1. Two columns, and nothing that exists today moves.**

The board's four plates (🔀 📋 🎁 ⏩) hold their exact slots. The three new
game controls take the free slots around them, and the playbook gets a column
of its own to the right:

```
slot   column 0 (x 260.6)      column 1 (x 273.6)
 -3    🤖 defense               💾 save play
 -2    👥 personnel             1️⃣ load 1
 -1    🔀 reposition   (today)  2️⃣ load 2
  0    📋 menu        (today)   3️⃣ load 3
 +1    🎁 autoplan    (today)   4️⃣ load 4
 +2    ⏩ run turn    (today)   5️⃣ load 5
 +3    🧹 clear arrows          —
```

Both columns centre on the window mid, as the single column does now, and the
rows line up across. Seven slots at the existing 13-unit pitch is 87 units in a
170-unit window, so there is room to spare.

The cost is that 🧹 sits below ⏩ rather than up with the other planning tools.
That is the right trade: Run the Turn is the most-pressed control in the game,
and a broom is not worth moving it for.

**2. The crop widens to 280; the field does not change.**

Two columns of 9-unit plates need 22 units of margin. The free strip between
the right-hand yard numbers and the frame is 18.8. So `renderBoardShell` and
`cameraViewBox` stop reading the shared `VIEWBOX_WIDTH` and use a game-only
`GAME_VIEWBOX_WIDTH = 280` — the same 13-unit pitch horizontally as vertically,
so the band reads as a grid rather than as columns squeezed together. Column 1
lands at x 273.6, whose plate ends at 278.1, leaving 1.9 units of clearance
inside the crop.

`lib/field/geometry.js` is untouched, which is the point: the standalone field
diagrams and everything that draws through `x()`/`y()` are unaffected. The
field is drawn exactly as before and simply sits in a wider crop. On a
width-constrained screen it renders 3.6% smaller, and its centre line sits 5
units left of the frame's centre (the field's 135 against the crop's 140).
Both are imperceptible, and it is the only arrangement in which the four
plates the coach already knows neither move nor shrink.

`FIELD_BTN_X` is currently derived as "the middle of the right margin" from
`VIEWBOX_WIDTH`. It keeps its value, so column 0 stays put — but after the
widening it is no longer the middle of anything, so it becomes a pinned
constant carrying the real reason.

Two things that could have broken and do not:

- **Dragging.** `app/input.js` converts pointer positions through
  `board.point()`, which reads the live CTM; there is no hardcoded width
  anywhere in the input path.
- **The tutorial's coach card.** `lib/game/tutorial/render.js` centres it on
  `CENTRE_X` and caps its width at `SIDELINE_RIGHT - SIDELINE_LEFT`. It never
  reads `VIEWBOX_WIDTH`, so it stays centred over the field, which is where it
  belongs — over the play, not over the control band.

**3. `FIELD_BUTTONS` grows a column, and becomes the menu's icon source too.**

Every entry gains `col`, and `fieldButtonAnchor` returns
`x: FIELD_BTN_X + col * FIELD_BTN_PITCH`. The existing four are `col: 0` and do
not move. `app/main.js` imports the table to compose its menu labels, so the
plate and the menu line cannot wear different marks — that is the whole of
"users can relate the two", enforced by there being one place to write an emoji
down.

The five playbook slots share one attribute, `data-play-button`, whose *value*
is the slot index. `fieldButtonMark` gains an optional `attrValue` (default
`'1'`, which is what every existing plate renders) so the five can be told
apart by one dispatch line instead of five attributes.

**4. The plates never show state; the message plate and the field do.**

A menu button can say `Personnel: nickel`. A plate cannot, and will not try:
pressing 🤖 or 👥 changes the setting, the message plate says what it changed
to — as Personnel already does — and the eleven men on the field show it. No
badge, no icon that swaps per mode.

The one exception is the `aria-label`, which carries the live setting
("Personnel: nickel", "Call play 2: Fly sweep", "Slot 3 is empty"). A screen
reader has no message plate to hear and no field to look at, and the existing
🔀 plate already labels itself this way.

**5. The board presses call the menu's own functions.**

There is one rule per control, and both surfaces obey it. `savePlay()` and
`callPlay(i)` are reused verbatim — they already open with `closeMenu()`, which
is a no-op when the menu is shut, so a board press needs nothing new. Clear,
Defense and Personnel are inline anonymous listeners today, so they are
extracted to named functions and the menu listeners become `closeMenu();
pressX()` — the shape `toggleReposition` and `pressRun` already have.

**6. The new plates get no lesson gate, because no lesson fields them.**

`refused({ kind })` guards `pressRun`, `pressMenu`, `toggleReposition` and
gestures. `pressAutoplan` has no such guard, for the reason all nine new
controls need none: `allow` is a whitelist, no lesson names them, so no plate
is ever drawn during a lesson, and the Coaches Menu is closed for all of the
tutorial but its final beat — where opening it is what ends the tutorial.

The whitelist is the lock. If a future lesson ever fields one of these plates,
that lesson must add the matching `refused({ kind })` guard at the top of the
press function, exactly as the run and reposition lessons did.

This also means **the tutorial needs no change at all** for this work: because
`fielded(name)` is deny-by-default, the nine new plates are absent from every
existing lesson the moment they are added, and copy like "the one above
fast-forward" stays true.

## Architecture

### Changed files

**`lib/game/render.js`**

- `GAME_VIEWBOX_WIDTH = 280`, used by `renderBoardShell` and `cameraViewBox`.
  `VIEWBOX_WIDTH` stays imported only for `FIELD_BTN_X`'s pinned value.
- `FIELD_BUTTONS` gains `col` on every entry and nine new entries:
  `clear`, `ai`, `personnel` in column 0; `save`, `play1`…`play5` in column 1.
- `fieldButtonAnchor` returns an x derived from `col`.
- `fieldButtonMark` gains `attrValue = '1'`.
- `renderFieldButtons` draws the nine new plates, each behind `fielded(name)`,
  and takes `book` — the coached side's five slots — as a new option. It
  imports `canUsePlays` from `play.js` the way it already imports
  `canReposition` from `formation.js`; `book` is passed in because the library
  lives in `app/main.js` behind localStorage, and the renderer stays a pure
  function of what it is handed.

**`app/main.js`**

- `pressClear()`, `pressAi()`, `pressPersonnel()` extracted from the inline
  listeners; the menu listeners call them after `closeMenu()`.
- Two handler/greying mismatches are closed while the functions are being
  extracted, because a plate makes both reachable: `pressPersonnel()` carries
  the full guard including `state.aiTeam === 'defense'`, which `paint()` greys
  the menu button on but the handler never checked; and `clearBtn` starts
  greying on `phase !== 'planning'`, which its handler has always returned
  early on while the button stayed pressable and did nothing.
- `pressBoardButton` gains the new matches, including one line that reads the
  slot index off `data-play-button`.
- `aimCamera` passes `book: myBook()` to `renderFieldButtons`.
- Menu labels composed from `FIELD_BUTTONS`: the four rewritten every paint
  (`ai`, `reposition`, `personnel`, `autoplan`) get the icon in their template;
  the static three (`run`, `clear`, `save-play`) are prefixed once at startup.
- `paintPlays()` labels a slot `1️⃣ Fly sweep` / `1️⃣ (empty)` — the keycap
  carries the number that `1.` used to.

**`index.html`** — 📋 on the dialog's `<h1>`, so the plate that opens the menu
and the menu it opens wear the same mark. No other markup change; the labels
are written by `main.js`.

**`test/game/render.test.js`** — three assertions hardcode the old 270 and
move to 280.

## Data flow

A press on a plate and a press on its menu button reach the same function, from
opposite directions:

```
board click/keydown ──► pressBoardButton(target)
                            │  closest('[data-…-button]')
                            ▼
menu button click ──► closeMenu() ──► pressClear / pressAi / pressPersonnel
                                      toggleReposition / pressRun / pressAutoplan
                                      savePlay / callPlay(i)
                                             │
                                             ▼
                                      mutate state, say(…), paint()
                                             │
                                             ▼
                 aimCamera ──► renderFieldButtons(state, { …, book: myBook() })
```

`aimCamera` redraws the whole `game-buttons` layer every frame, which is what
lets the plates grey, lets 🔀 vanish at the snap, and keeps the column pinned
to the window while the field scrolls under it. Slots are fixed, so a vanished
plate leaves its gap rather than shuffling the column.

## Enabled and greyed

Each plate greys on exactly the condition its menu twin does:

| Plate | Off when |
|---|---|
| 🔀 reposition | *vanishes* when `!canReposition(state)`, as today |
| 🎁 autoplan | `animating \|\| phase !== 'planning'` |
| ⏩ run | `animating \|\| phase !== 'planning'` |
| 🧹 clear | `animating \|\| phase !== 'planning'` |
| 🤖 defense | `animating \|\| phase !== 'planning'` |
| 👥 personnel | `animating \|\| !canReposition(state) \|\| aiTeam === 'defense'` |
| 💾 save | `animating \|\| !canUsePlays(state)` |
| 1️⃣–5️⃣ | `animating \|\| !canUsePlays(state) \|\| !book[i]` |
| 📋 menu | never — `menuButtonMark` draws it, and it is always available |

## Known rough edge

Pressing 🤖 can hand the computer the defense and put the coach on offense, and
the playbook is per-side — so 1️⃣–5️⃣ start calling a different five plays. The
menu has a heading that says which book is on screen; the board column has no
room for one. The `aria-label`s carry the side and the mode change already
announces itself on the message plate, but a sighted coach gets no explicit
"this is the offense's book now" on the board.

Accepted as-is. A heading would cost a slot and a lot of margin to fix
something the message plate already half-says.

## Testing

`node --test`, in `test/game/render.test.js` unless noted:

- Each of the nine new plates is present, and carries the icon `FIELD_BUTTONS`
  gives it — asserted against the table, never against a literal, so a test
  cannot drift from the code it guards.
- Table integrity: every entry in `FIELD_BUTTONS` is drawn by either
  `renderFieldButtons` or `menuButtonMark`, and no plate carries an emoji that
  is not in the table. This is the test that keeps the board and the menu
  honest as controls are added.
- The playbook column has exactly `PLAY_SLOTS` plates.
- Geometry: the two columns are one `FIELD_BTN_PITCH` apart, no two plates
  overlap, rows align across the columns, and every plate falls inside the
  280-wide crop.
- `cameraViewBox` and `renderBoardShell` report the same width, at several
  camera positions.
- Greying: one case per row of the table above, including a play slot that is
  empty, a play slot that is full, and the whole playbook column while the down
  is under way.
- `allow`: a lesson's whitelist fields none of the nine new plates.

The menu labels and the presses need a DOM, so they are verified in the browser
preview rather than in `node --test`: press all nine new plates and confirm each
does what its menu twin does, confirm the greying matches the menu's, confirm
every menu button shows the icon its plate shows, run one tutorial lesson to
confirm the column is still just the plates it fields, and confirm the field
sits right at the new width.

## Not doing

- No icons or plates for the coaching log or the in-browser training sections.
- No icon for Next Down, Velocity lines, New Game or Back to Home; they stay
  menu-only, unchanged.
- No state read-out on any plate — no badges, no per-mode icons.
- No new tutorial lesson, and no change to any existing one.
- No `refused({ kind })` gates for the new controls — see decision 6.
- No fix for the pre-existing gap where `savePlayBtn` and the slot buttons are
  left out of the run-time lock list in `animate()`. Both their handlers guard
  on `animating` themselves, so nothing can be pressed through; the buttons
  merely look live for the length of the animation. Unrelated to this work.
- No rebuild of the plates as HTML `<button>`s. It would buy native button
  semantics and rem-sized touch targets, but it retires `renderFieldButtons`
  and `menuButtonMark` along with their markup tests, which is the discipline
  this renderer is built on.
- No change to `lib/field/geometry.js`, and so no change to the standalone
  field diagrams.
