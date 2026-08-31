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

Then open **http://localhost:8080** in a browser. `npm run serve` starts
`serve.py`, a static file server and nothing more; there's no build or bundling
step. It differs from a bare `python3 -m http.server` in exactly one way: it
sends `Cache-Control: no-store`, so a reload always gets every module as it is
on disk. Without that header the browser has only `Last-Modified` to go on and
falls back to guessing how long a file stays fresh, which on a no-build app can
leave the page running a mixture of edited and cached modules — a failure that
looks like a bug in the game rather than a bug in the cache. Pass a port to use
a different one (`python3 serve.py 8099`).

## Training the learned AI

The two learned levels — `Defense: computer (learned)` and
`Offense: computer (learned)` — play trained genomes shipped in
`lib/game/learned/defense-genome.js` and `offense-genome.js`. To retrain
them against each other (competitive co-evolution, the normal way):

    npm run train:coevolve -- --generations 20 --pop 12 --plays 12 --seed 1

To retrain just the defense against the scripted offense (the bootstrap the
first genome came from):

    npm run train:defense -- --generations 30 --pop 16 --plays 24 --seed 1

To train the defense against a ghost of **you** — the coach the game has
actually been recording:

    npm run train:vs-ghost -- --log coach-log.json --side defense

Every time you press **Run Turn**, the game writes down the call you just
made — where your men were standing, every arrow, every cover order, the
throw — and keeps it in the browser. **Copy coaching log** in the Coaches
Menu hands the whole record over as JSON; save it as a file and point the
trainer at it. The trainer replays your recorded calls as the opponent
(nearest recorded situation to the live one, deterministically) and evolves
the genome against thousands of simulated downs of *your* football, dealing
half its scenarios from the down-and-distances you actually played. Pass
`--side offense` to train the computer's offense against a ghost of your
defense instead. **Forget my tendencies** in the same menu clears the record.

Training is a seeded evolutionary search over each side's ~30 parameters
(starting spots, play-calling, coverage scheme and matchups, routes and
reads), simulating whole plays headlessly through the same engine the
browser runs. It is fully deterministic for a seed and writes the champions
back into the genome modules, which are committed like any other source.

## Deploying

Pushes to `main` publish the game to GitHub Pages via
`.github/workflows/deploy.yml`. The workflow runs the test suite, copies
`index.html`, `app/`, and `lib/` into the Pages artifact, and deploys — no
build step, same files the local server hands out.

The workflow enables Pages itself (`configure-pages` with `enablement: true`),
so there's no Settings step to remember. The site lives at
https://jamesjnadeau.github.io/football-by-turn/.

## How to play

The page opens on a **home screen** listing the games it can deal: **7 Player**
and **11 Player**. They are the same game with different-sized teams — the rules
below are true of both. Press either and the board takes over the screen; **Back
to Home** in the Coaches Menu brings the list back.

The drive starts **1st and 10 from the offense's own 20**, 80 yards from the
goal. The offense has **4 downs** to reach the line to gain — the marker moves
ten yards on every time it does, exactly like real football, over and over
however many sets it takes to score. Inside the 10 there's no line to gain
past the goal itself, so it's simply **goal to go**. Losing the ball however
that happens — failing to reach the sticks on 4th down, a fumble the defense
recovers, an interception, a flag that wipes a touchdown — ends the game as a
loss; only a touchdown wins.


**Every down starts with the snap.** The centre comes to the line holding the
ball, already aimed at the quarterback — a short backward toss, which is a
lateral, so it costs you nothing against the one forward pass a down allows.
You do not have to draw it and you are not nagged about the centre having no
arrow; it is how a play starts, not a call you make. It goes back on by itself
whenever it would otherwise be lost: a new down, **Clear Arrows**, a called
play, or moving either man. Re-aiming follows them both, so shifting the
quarterback out to one side leans the snap that way. Draw the centre a throw of
your own and it replaces the snap for good — yours is never re-aimed over.

Because the ball is spotted between the hash marks, the man holding it has to
line up between them: drag the centre wider than that while repositioning and
the spot is refused. Everyone else splits out as far as the sideline allows.

**The computer coaches the defense.** You draw arrows for your offensive
players; each turn the computer plans the defense and runs it. You never see
what it has planned: no defensive arrows and no coverage marks are ever drawn,
because the computer does not decide until you press **Run Turn**. The
**Defense:** button in the Coaches Menu cycles between three settings.

- **Defense: computer (smart)** — the default. Assignment football. The
  defensive line rushes the ball but the outside rushers keep contain, so the
  pocket has walls and a carrier who wants the edge has to run around somebody.
  The linebacker does not chase into the backfield: he holds his depth a couple
  of yards off the line and mirrors the ball across the field until the run
  declares, then fills. The cornerbacks take the receivers man-to-man — the same
  cover order you give by dragging, re-aimed at their man every fraction of a
  second — and the safety plays free behind everything, so nobody gets over the
  top. All of that is off the moment the ball comes loose or the carrier crosses
  the line: then it is the whole defense converging on one, each on the angle
  that arrives in front of him rather than behind.
- **Defense: computer (basic)** — the original brain. Every defender runs
  straight at the ball, leading the carrier rather than chasing where he just
  was. Easier to beat: get one man moving sideways and the whole defense follows
  him.
- **Defense: you** — hot-seat. You coach both teams.

Either computer breaks a defender down into the tackling stance once he is
within range to make the hit.

- **Three buttons run down the right-hand margin of the field**, clear of the
  yard numbers. The middle one opens the menu; the two either side are
  shortcuts to buttons already in it, not extra features — each calls exactly
  what its twin in the menu calls, so the two can never say different things.
  - 📋 **Coaches Menu**, in the middle, where the vertical `COACHES MENU`
    legend used to be spelled down the sideline. Press Esc, click outside the
    menu, or press **Close** to dismiss it. Every button in it closes the menu
    as it acts, so you can watch the board.
  - 🔀 **above** it is **Reposition** (see below). It shows green and
    pressed-in while the mode is on, and is only there while you are setting
    up: it disappears at the snap, which is also your cue that the play has
    started.
  - ⏩ **below** it is **Run Turn** — the same warning if someone has no
    direction set, and the same second press to run anyway. It greys out rather
    than vanishing when there is no turn to run, so it never moves.

  All three are ordinary buttons to a keyboard: tab to one and press Enter or
  Space. The clipboard is the first tab stop on the page, which matters because
  everything the menu holds is out of the tab order until it is open.
- Nearly all the controls live in the **Coaches Menu**. The play's status — the
  warning about unplanned players, `TOUCHDOWN!`, `FUMBLE!` — is drawn on the
  field itself, in the end zone, so it stays readable with the menu shut.

- **Drag a player** to say where you want him at the end of the turn: a filled
  green circle appears on the spot he will actually be standing when the whistle
  blows, and a longer drag still means a harder run. Half a second does not buy
  much ground from a standing start — about two yards — so drag past what he can
  cover and the old green arrow appears *alongside* the circle: the circle is
  still the truth about where he ends up this turn, and the arrow says he is
  running full speed that way and is not done when the whistle goes. Either mark
  stays visible until you change it or run the turn.
- **Drag a player onto one of theirs** to put him on that man. The circle gives
  way to a dotted line running to the man he has taken, and a green disc appears
  under that man with just its rim showing. From then on he does not run at a
  fixed spot — he re-aims at his man every moment of the turn, and while your
  team has the ball he works to get his body *between* that man and your ball
  carrier rather than merely chasing him. Taking a man on costs nothing and is
  worth a little: slightly more force to hold ground in contact, and an arm's
  length of extra reach — against that man alone. Drag him anywhere else to call
  it off.
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
  beside you, a long forward one is a bomb. The automatic snap is drawn in the
  same red, but running all the way to the quarterback rather than at a length
  scaled by power: it is thrown as gently as the game allows, so its length
  would say nothing, and where it is going is the useful thing to see.
  - **Drop the drag on one of your own within 15 yards** and the throw locks
    onto him. It leads him: the ball goes to where his own route puts him, not
    to where he is standing, and it is thrown at the pace that meets him there
    rather than at whatever force you happened to drag. Draw his route after
    locking on if you like — the aim is taken at the snap, from the orders as
    they finally stand. He gets a red halo, the way a covered man gets a green
    one. What can still beat it is what beats a real pass: a defender who gets
    to the ball first, or a receiver who is knocked off his route on the way.
  - **Drag further than that** and you are throwing a **lob**. Nothing locks on;
    a red circle shows where the ball is coming down instead, and it grows the
    longer the throw — the ball lands *somewhere* inside it, not on the middle.
    A lob goes up as well as out, so it takes about twice as long to arrive and
    is usually still in the air when the turn ends: you get a whole planning
    phase to run somebody under it. While it is over everyone's heads it is
    drawn bigger and **nobody can catch it** — not your receiver, not the
    defense. It is live for the first 15 yards of its flight, and again for the
    last 3 as it comes down.

  Anyone can catch a throw, including
  the defense, so a forward pass into traffic is an interception waiting to
  happen. You get **one forward pass per down, and only from behind the line of
  scrimmage**; backward throws and handoffs are unlimited. Throw illegally and
  the game lets you — then calls the flag once the down is over: 5 yards back
  from the previous spot and the down still counts, unless the defense came away
  with the ball, in which case they keep it. A forward pass nobody catches is
  incomplete: dead ball, no gain. A backward throw nobody catches is a live ball,
  same as a fumble.
- Press **Run Turn** to play out half a second of simulated movement — everyone
  moves along their arrow (or toward the man they were put on) at once, with
  blocking friction as players come together, and a chance of a tackle whenever
  a defender gets within reach of the ball carrier. If any player doesn't have
  an arrow set yet, you'll get a warning naming how many; press **Run Turn**
  again to run the turn anyway.
- **Reposition** — the 🔀 button on the board, or **Reposition** in the Coaches
  Menu — switches between drawing arrows and moving players around before the
  snap. With it on, dragging one of your
  players *moves* him rather than ordering him about — no arrows, no cover
  orders, no stances, and any orders he already had are dropped, because a
  destination is a spot on the field and moving him makes it a lie. A green
  band shows the two yards behind the ball that count as being **on the line**,
  so you can see what you are lining up against — the formation comes out a
  yard inside it, with room either side.

  Three spots are simply refused, and the board says why: past the line of
  scrimmage, outside a sideline, or on top of somebody. The formation *count*
  is not refused — you may break the huddle however you like, and the board
  keeps a running `5 on the line`. Come out with fewer than five and it reads
  `ILLEGAL FORMATION`; snap it anyway and you get the flag when the down ends,
  five yards from the previous spot.

  The computer answers your formation as you set it: the front goes head-up on
  your interior linemen, the corners take your two widest men, the linebacker
  sits over the ball and the safety plays over the top of everything — all read
  off where your players actually are, so splitting a receiver across the
  formation drags his corner with him. In hot-seat you are coaching both teams,
  so nothing is aligned for you; you place the defense yourself. Repositioning
  is offered on the first turn of a down and switches itself off at the snap.
- **Clear Arrows** wipes every plan for the current turn, in case you want to
  start over before running it.
- The Coaches Menu has a **Plays** section, and it holds two playbooks: five
  slots for the offense and five for the defense. Which one you see follows the
  side you are coaching, and the heading says so — a play is orders for named
  men, and your sweep is nobody's assignment when you are coaching the
  secondary. Set up a formation, draw the first set of arrows for a down, press
  **Save current play**, and name it — the play goes into one of that side's
  five slots, formation, stances and a planned throw included.
  Press a slot to call that play again on a later down; it replaces whatever
  you have drawn *and* whoever is standing where, rather than adding to it.
  Every man's spot is kept relative to the line of scrimmage, not the yard
  line, so a play saved on your own 25 lines up the same way when you call it
  from the 40. Saving and calling are offered only on the **first turn of a
  down** — that is what a play is — so the buttons grey out once the ball has
  moved, and moving a man before you save is as much a play as any arrow.
  Saved plays are kept in your browser, so they survive a reload and a New
  Game; anything you saved before the books were split comes back in the
  offense's, which is whose it was. With all five slots full, saving asks which
  one to replace. In hot-seat you are coaching both teams, and the offense's
  book is the one you get. Anyone in a saved play the current game has no
  orders to give — a defender in a play you saved while coaching both teams, a
  man whose saved spot will not fit on the down being played, say — is skipped,
  and the message says how many.
- When a play ends, **Next Down** appears — click it to spot the ball,
  re-form both teams at the new line of scrimmage, and rule on the down: reach
  the line to gain and it's a fresh 1st and 10 from there; fall short and the
  down counter simply advances. After a touchdown, or the offense losing the
  ball any way — a turnover on downs included — the game is over.
- **New Game** resets everything and starts a fresh drive, 1st and 10 from the
  offense's own 20.
- **Back to Home** leaves the drive and returns to the home screen. It abandons
  the play you were in — the next press of **7 Player** or **11 Player** starts
  a fresh drive — but your saved plays are kept, the same as they are across a
  reload. Like **Next Down** and **New Game**, it is dead while a turn is being
  drawn.



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

- **The computer coaches the defense, but you can take it back.** The played
  game starts with the computer running assignment defense against you. The
  Defense button in the Coaches Menu cycles three settings: *computer (smart)*,
  which rushes with contain, fills with the linebacker and plays man with help
  over the top; *computer (basic)*, which sends every defender straight at the
  ball; and *you*, a hot-seat game where you draw the arrows for both teams.
  The library itself still defaults to hot-seat — `createGame` with no `ai`
  coaches nobody — so the rules stay decidable without an opponent in the way,
  and `app/main.js` is what opts the played game in.
- **A throw is a loose ball with a much bigger initial speed.** Same shape, same
  per-sub-step decay, same pickup check — which is what makes a catch, a dropped
  handoff and an interception one code path instead of three, and why anyone on
  the field can come down with a pass. Separately, the spec's "less friction
  going downfield, such as for a pass release" line is implemented as a physics
  rule of its own: a fast release past a defender gets a lighter friction
  coefficient than a slow grind.
- **Two team sizes, picked off the home screen.** **11 Player** is the full
  game: five linemen, a tight end, two receivers, a fullback, a quarterback and
  a back, against a five-two-four defense. **7 Player** is the original, and is
  kept because it is a genuinely quicker game to draw for — 22 players all
  needing an arrow every half-second turn is a lot of drawing. Both formations
  live in `lib/game/rosters.js`, keyed by the same ids the home screen's buttons
  carry; it is the only file that knows what a formation looks like, and
  everything downstream reads the roster off the state.
- **The formation rules are the real ones.** Eleven a side wants seven of eleven
  on the line, which is exactly what its drive-start formation shows. Seven a
  side rounds that to five, and shows five. Eligible receiver and
  covered/uncovered rules are deliberately left out, because this game lets
  anyone catch a pass. An illegal formation is enforced with the same machinery
  as an illegal forward pass — five yards from the previous spot, and the down
  counts.
- **Still a single drive, with no scoreboard and no safety rule.** Real downs
  and a real 80-yard field don't turn this into a full two-team game: there's
  one offense, no possession swap, and no clock. Losing the ball however it
  happens — a turnover on downs included — ends the game; there's no running
  score to protect and no possession swap to hand the ball back to. And
  because there's no second team, there's no safety rule either — nothing to
  award the two points to. A team pinned deep just keeps the ball spottable a
  short way off its own goal line instead.


## Design notes

The two paragraphs below are the original spec this game was built from, kept
here verbatim for reference.

This is a html/svg game using [play draw svg](https://www.vermont-football-officials.org/draw/), you can see the source code for that here: https://github.com/jamesjnadeau/vermont-football-officials


A user can click to move position(only at start of play, not during the play), or hold a player and draw a direction. An arrow is drawn showing the direction of travel and force. This can be reset. Size of character dictates weight, smaller is faster. B

all possession is shown by a small football. Game starts on the 10, they have 4 downs to score. Play is turn based, happening at half second intervals. User sets the direction for all players and is warned if not all players have a direction to move set. Blocking works as expected, with objects adding friction as they come together simulating players using their hands to move around each other. Play should follow football rules, and less friction(hand touching) should happen in appropriate scenrios, such as going down field for pass. Tackling is handled by players running into one another. A runner has the opportunity to tuck the ball, moving it inside their circle. This is activated by a long press. When tucked, the player moves at a little slower pace, but is more protected from fumbling the ball. The default stance is to have the ball untucked. The next turn after tucking, the user has more forward momentum and power based on their preparing to hit someone. Defensemen call also "prepare to tackle" in a similar way, but they must slow down significantly in their movement, to simulate someone breaking down getting ready to hit someone. This increases their chance to tackle and their reach. This is displayed visually by a quater of circle drawn around the player indicating direction of travel. A runner tucked and a defensive player ready to tackle, with all other things being equal, should be an equal match. A tackle will be more successful with more defensemen in the immediate area. An offensive player is able to push and block players during their movement. An offensive player can be set into "defend position mode" by holding down on them. This will be visually signalled by a quarter circle drawn around the player in the direction of travel. Movement in this mode is severly limted, but range of reach is increasded substantially, as well as abbility to resist momentum from defensemen charging forward.
