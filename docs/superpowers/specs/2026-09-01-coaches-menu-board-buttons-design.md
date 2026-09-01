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

## Decisions

**1. Two columns, and nothing that exists today moves.**

The board's four plates (🔀 📋 🎁 ⏩) hold their exact positions. The three new
game controls take the free slots around them, and the playbook gets a column
of its own to the right:

```
slot   column 1 (x 260.6)      column 2 (x 273.6)
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
150-unit window, so there is room to spare.

The cost is that 🧹 sits below ⏩ rather than up with the other planning tools.
That is the right trade: Run the Turn is the most-pressed control in the game,
and a broom is not worth moving it for.

**2. The crop widens to 280; the field does not change.**

Two columns of 9-unit plates need 22 units of margin. The free strip between
the right-hand yard numbers and the frame is 18.8. So `renderBoardShell` and
`cameraViewBox` stop reading the shared `VIEWBOX_WIDTH` and use a game-only
width of 280 — the same 13-unit pitch horizontally as vertically, so the band
reads as a grid rather than as columns squeezed together.

`lib/field/geometry.js` is untouched, which is the point: the standalone field
diagrams and everything that draws through `x()`/`y()` are unaffected. The
field is drawn exactly as before and simply sits in a wider crop. On a
width-constrained screen it renders 3.6% smaller, and its centre line sits 5
units left of the frame's centre (the field's 135 against the crop's 140).
Both are imperceptible, and it is the only arrangement in which the four
plates the coach already knows neither move nor shrink.

`FIELD_BTN_X` is currently derived as "the middle of the right margin" from
`VIEWBOX_WIDTH`. It keeps its value, so column 1 stays put — but after the
widening it is no longer the middle of anything, so it becomes a pinned
constant carrying the real reason.

Dragging is unaffected. `app/input.js` converts pointer positions through
`board.point()`, which reads the live CTM; there is no hardcoded width anywhere
in the input path.

**3. One icon table, imported by both surfaces.**

A new `lib/game/icons.js` holds every control's emoji, and is the only place
any of them is written down. `render.js` imports it for the plates, giving up
the four literals it carries today; `app/main.js` imports it to compose the
menu labels. That is what makes "the board and the menu agree" a property of
the code rather than of two lists someone remembers to keep in step.

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

## Architecture

### New files

**`lib/game/icons.js`** — one exported table, control id to emoji:

```js
export const ICONS = {
  menu: '📋', reposition: '🔀', autoplan: '🎁', run: '⏩',
  clear: '🧹', ai: '🤖', personnel: '👥', savePlay: '💾',
};
export const PLAY_SLOT_ICONS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
```

`PLAY_SLOT_ICONS` is separate because it is indexed by slot rather than named,
and its length is asserted against `PLAY_SLOTS` so the two cannot fall out of
step.

### Changed files

**`lib/game/render.js`**

- `GAME_VIEWBOX_WIDTH = 280`, used by `renderBoardShell` and `cameraViewBox`.
  `VIEWBOX_WIDTH` stays imported only for `FIELD_BTN_X`'s pinned value.
- `FIELD_BTN_COL_2_X = FIELD_BTN_X + FIELD_BTN_PITCH`.
- `fieldButtonMark` takes a `cx` alongside `cy` instead of reading
  `FIELD_BTN_X` off the module.
- `menuButtonMark` and the four existing plates take their icons from `ICONS`.
- `renderFieldButtons(state, { repositioning, animating, cameraYard, book })`
  draws all thirteen. It imports `canUsePlays` from `play.js` the way it
  already imports `canReposition` from `formation.js`. `book` — the coached
  side's five slots — is passed in, because the library lives in `app/main.js`
  behind localStorage and the renderer stays a pure function of what it is
  handed.

**`app/main.js`**

- `pressClear()`, `pressAi()`, `pressPersonnel()` extracted from the inline
  listeners; the menu listeners call them after `closeMenu()`.
- Two handler/greying mismatches are closed while the functions are being
  extracted, because a plate makes both reachable:
  `pressPersonnel()` carries the full guard including
  `state.aiTeam === 'defense'`, which `paint()` greys the menu button on but
  the handler never checked; and `clearBtn` starts greying on
  `phase !== 'planning'`, which its handler has always returned early on while
  the button stayed pressable and did nothing.
- `pressBoardButton` matches the nine new data attributes:
  `data-clear-button`, `data-ai-button`, `data-personnel-button`,
  `data-save-play-button`, and `data-play-slot-button="0..4"`.
- `paint()` passes `book: myBook()` to `renderFieldButtons`.
- Menu labels composed from `ICONS`: the three that are rewritten every paint
  (`ai`, `reposition`, `personnel`) get the icon in their template; the static
  ones (`run`, `clear`, `autoplan`, `save-play`) are prefixed once at startup.
- `paintPlays()` labels a slot `1️⃣ Fly sweep` / `1️⃣ (empty)` — the keycap
  carries the number that `1.` used to.

**`index.html`** — 📋 on the dialog's `<h1>`, so the plate that opens the menu
and the menu it opens wear the same mark. No other markup change; the labels
are written by `main.js`.

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
                          renderFieldButtons(state, { …, book: myBook() })
```

`paint()` redraws the whole `game-buttons` layer every time, which is what lets
the plates grey, and lets 🔀 vanish at the snap. Slots are fixed, so a vanished
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
| 💾 save play | `animating \|\| !canUsePlays(state)` |
| 1️⃣–5️⃣ | `animating \|\| !canUsePlays(state) \|\| !book[i]` |
| 📋 menu | never — it is built into the shell and always available |

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

- Each of the nine new plates is present, and carries the icon `icons.js` gives
  it — asserted against the table, never against a literal, so a test cannot
  drift from the code it guards.
- Table integrity: every entry in `ICONS` and `PLAY_SLOT_ICONS` is used by some
  plate, and no plate carries an emoji that is not in the table. This is the
  test that keeps the board and the menu honest as controls are added.
- `PLAY_SLOT_ICONS.length === PLAY_SLOTS`.
- Geometry: the two columns are one `FIELD_BTN_PITCH` apart, no two plates
  overlap, rows align across the columns, and every plate falls inside the
  280-wide crop.
- `cameraViewBox` and `renderBoardShell` report the same width, at several
  camera positions.
- Greying: one case per row of the table above, including a play slot that is
  empty, a play slot that is full, and the whole playbook column while the down
  is under way.
- `test/game/view.test.js` is checked for viewBox-string assertions and updated
  if it has any.

The menu labels and the presses need a DOM, so they are verified in the browser
preview rather than in `node --test`: press all nine new plates and confirm each
does what its menu twin does, confirm the greying matches the menu's, confirm
every menu button shows the icon its plate shows, and confirm the field still
sits right at the new width.

## Not doing

- No icons or plates for the coaching log or the in-browser training sections.
- No icon for Next Down, Velocity lines, New Game or Back to Home; they stay
  menu-only, unchanged.
- No state read-out on any plate — no badges, no per-mode icons.
- No rebuild of the plates as HTML `<button>`s. It would buy native button
  semantics and rem-sized touch targets, but it retires `renderFieldButtons`
  and `menuButtonMark` along with their markup tests, which is the discipline
  this renderer is built on.
- No change to `lib/field/geometry.js`, and so no change to the standalone
  field diagrams.
