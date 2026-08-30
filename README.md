# football-by-turn

A turn-based football game played entirely with drawn arrows. Both teams sit at the
line, you draw where every player should run and how hard, hit **Run Turn**, and
watch half a second of simulated football play out — blocking, tackling, and the
occasional fumble included. Then you draw the next turn's arrows and go again,
until the play ends in a tackle, a fumble recovered by the defense, an out-of-bounds,
or a touchdown.

It's built as an HTML/SVG page with no build step and no server-side logic — open
`index.html` and everything runs in the browser.

## Running it

```
npm run serve
```

Then open **http://localhost:8080** in a browser. `npm run serve` just starts a
static file server (`python3 -m http.server 8080`); there's no build or bundling
step.

## How to play

Each drive starts 1st and goal from the offense's own 10-yard line, and the
offense has **4 downs** to score before the ball turns over.

**The computer coaches the defense.** You draw arrows for your seven offensive
players; each turn the computer sends every defender at the ball — leading the
carrier rather than chasing where he just was — and breaks a defender down into
the tackling stance once he is within range to make the hit. You never see what
it has planned: no defensive arrows are drawn, ever, because the computer does
not decide until you press **Run Turn**. Press **Defense: computer** to take the
defense back and play hot-seat, coaching both teams yourself; press it again to
hand the defense back over.

- All the controls live in the **Coaches Menu**. Press the vertical green
  **COACHES MENU** text down the right-hand side of the field to open it; press
  Esc, click outside it, or press **Close** to dismiss it. Every button in it
  closes the menu as it acts, so you can watch the board. The play's status —
  the warning about unplanned players, `TOUCHDOWN!`, `FUMBLE!` — is drawn on the
  field itself, in the end zone, so it stays readable with the menu shut.
- **Drag a player** to say where you want him at the end of the turn: a filled
  green circle appears on the spot he will actually be standing when the whistle
  blows, and a longer drag still means a harder run. Half a second does not buy
  much ground from a standing start — about two yards — so drag past what he can
  cover and the circle gives way to the old green arrow, which means "full speed
  that way, and you won't get all the way there this turn". Either mark stays
  visible until you change it or run the turn.
- **Long-press a player** to toggle their stance, shown by a quarter-circle arc
  around them facing their direction of travel:
  - The **ball carrier** long-pressed **tucks** the ball in — a little slower,
    but much better protected against fumbling.
  - A **defender** long-pressed gets ready to **tackle**: they slow down a lot,
    but gain extra reach and a better chance of bringing the runner down.
  - Any other **offensive player** long-pressed drops into **defend position**:
    movement is severely limited, but their reach goes up and they become much
    harder to shove out of the way — useful for holding a block.

  Long-press the same player again to go back to normal.
- **Tap the ball carrier, then drag** to throw. The dashed red arrow shows where
  the ball is going and how hard — a short backward drag is a handoff to the man
  beside you, a long forward one is a bomb. Anyone can catch a throw, including
  the defense, so a forward pass into traffic is an interception waiting to
  happen. You get **one forward pass per down, and only from behind the line of
  scrimmage**; backward throws and handoffs are unlimited. Throw illegally and
  the game lets you — then calls the flag once the down is over: 5 yards back
  from the previous spot and the down still counts, unless the defense came away
  with the ball, in which case they keep it. A forward pass nobody catches is
  incomplete: dead ball, no gain. A backward throw nobody catches is a live ball,
  same as a fumble.
- Press **Run Turn** to play out half a second of simulated movement — everyone
  moves along their arrow at once, with blocking friction as players come
  together, and a chance of a tackle whenever a defender gets within reach of
  the ball carrier. If any player doesn't have an arrow set yet, you'll get a
  warning naming how many; press **Run Turn** again to run the turn anyway.
- **Clear Arrows** wipes every plan for the current turn, in case you want to
  start over before running it.
- The Coaches Menu has a **Plays** section. Draw the first set of arrows for a
  down, press **Save current play**, and name it — the play goes into one of
  five slots, stances and a planned throw included. Press a slot to call that
  play again on a later down; it replaces whatever you have drawn so far rather
  than adding to it. Saving and calling are offered only on the **first turn of
  a down** — that is what a play is — so the buttons grey out once the ball has
  moved. Saved plays are kept in your browser, so they survive a reload and a
  New Game. With all five slots full, saving asks which one to replace. Anyone
  in a saved play the current game has no orders to give — a defender in a play
  you saved while coaching both teams, say — is skipped, and the message says
  how many.
- When a play ends, **Next Down** appears — click it to spot the ball, advance
  the down counter, and re-form both teams at the new line of scrimmage. After
  a touchdown, a turnover on downs, or a fumble recovered by the defense, the
  game is over.
- **New Game** resets everything and starts a fresh drive from the 10.

One thing this version *doesn't* do: there's no click-to-reposition of players
before the snap. Every formation starts at its default positions — you set
direction and stance from there, but you can't drag a player to a new starting
spot pre-snap.

## Running the tests

```
npm test
```

Runs the full unit test suite (`node --test`) covering the physics, tackling,
downs/scoring, and rendering logic in `lib/`. There's no test runner install
step — it uses Node's built-in test runner directly.

## v1 interpretation decisions

A few calls made in turning the original one-paragraph spec into a playable
game:

- **Both teams are user-controlled.** There's no AI opponent — you draw the
  arrows for offense *and* defense, every turn. This keeps the whole thing a
  single-player sandbox for now rather than requiring any kind of opposing
  strategy engine.
- **No passing.** The ball only ever moves by a player carrying it (or a loose
  ball rolling free after a fumble). The spec's "less friction going downfield,
  such as for a pass release" line is implemented as a physics rule (a fast
  release past a defender gets a lighter friction coefficient than a slow
  grind), but there's no separate thrown-ball mechanic.
- **`TEAM_SIZE` = 7-a-side**, not the full 11: three linemen, a QB, a
  running back, and two wide receivers/corners on offense; a matching
  three-lineman front, two corners, a linebacker, and a safety on defense.
  Chosen to keep a turn-based, hand-drawn-arrow game legible — 22 players all
  needing an arrow every half-second turn would be a lot of drawing.
- **Player placement before the snap was scoped out of this pass** (see "How
  to play" above) — everything else in the original spec (drag-to-plan,
  long-press stances, blocking friction, tackling, fumbles, downs, and
  scoring) is implemented and playable.

## Design notes

The two paragraphs below are the original spec this game was built from, kept
here verbatim for reference.

This is a html/svg game using [play draw svg](https://www.vermont-football-officials.org/draw/), you can see the source code for that here: https://github.com/jamesjnadeau/vermont-football-officials


A user can click to move position(only at start of play, not during the play), or hold a player and draw a direction. An arrow is drawn showing the direction of travel and force. This can be reset. Size of character dictates weight, smaller is faster. B

all possession is shown by a small football. Game starts on the 10, they have 4 downs to score. Play is turn based, happening at half second intervals. User sets the direction for all players and is warned if not all players have a direction to move set. Blocking works as expected, with objects adding friction as they come together simulating players using their hands to move around each other. Play should follow football rules, and less friction(hand touching) should happen in appropriate scenrios, such as going down field for pass. Tackling is handled by players running into one another. A runner has the opportunity to tuck the ball, moving it inside their circle. This is activated by a long press. When tucked, the player moves at a little slower pace, but is more protected from fumbling the ball. The default stance is to have the ball untucked. The next turn after tucking, the user has more forward momentum and power based on their preparing to hit someone. Defensemen call also "prepare to tackle" in a similar way, but they must slow down significantly in their movement, to simulate someone breaking down getting ready to hit someone. This increases their chance to tackle and their reach. This is displayed visually by a quater of circle drawn around the player indicating direction of travel. A runner tucked and a defensive player ready to tackle, with all other things being equal, should be an equal match. A tackle will be more successful with more defensemen in the immediate area. An offensive player is able to push and block players during their movement. An offensive player can be set into "defend position mode" by holding down on them. This will be visually signalled by a quarter circle drawn around the player in the direction of travel. Movement in this mode is severly limted, but range of reach is increasded substantially, as well as abbility to resist momentum from defensemen charging forward.
