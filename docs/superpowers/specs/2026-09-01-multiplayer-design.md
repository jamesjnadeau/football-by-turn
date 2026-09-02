# Multiplayer: two coaches, one drive

## Motivation

Every game this page deals is played against a program. The learned defense,
the smart assignment defense, the scripted tutorial opponent, the pursuit
brain — all of them are `coachAi` called at the top of `runTurn`, planning a
side the human cannot see. The one thing the game has never had is the thing
that makes drawing arrows interesting in the first place: another person
drawing arrows back.

This adds it. Two coaches meet in a lobby, one takes the offense and one takes
the defense, and they play a drive against each other half a second at a time.
It becomes a fourth entry on the side chooser you reach after picking 7 or 11
player, alongside Play Offense, Play Defense and Training Mode.

## What a match is

**A drive.** Sides are fixed for its whole length: the coach dealt the offense
keeps the offense until the drive ends. It ends the way drives end today —
a touchdown, a turnover, or a turn on downs — because `nextDown` and the rest
of the down machinery already decide all of that and this feature changes none
of it. There is no score, no game clock, and no possession change, because the
single-player game has no model for any of those and inventing one is a
different piece of work.

When the drive ends both coaches see the result and are offered *Play again*,
which puts them back through the queue for a fresh pairing rather than a
rematch with the same person, and *Back*, which returns them to the home
screen.

## The clock

Each turn is timed. The turn runs when both coaches have committed or the
clock expires, whichever comes first.

- **30 seconds** on the first turn of a down. That is the huddle: formations
  are being set, personnel is being chosen, and every arrow on the board is
  being drawn from scratch.
- **12 seconds** on every turn after it. Mid-play a coach is adjusting two or
  three arrows against a picture he can already read, and a full half minute
  for that would make one down take three minutes.

Either coach can end his turn early, and does so by committing; the wait is
for the other man, not for the clock.

### When the clock expires on a coach who never committed

The server keeps each coach's last committed play and replays it. Two rules
constrain the replay, both of them inherited from how the engine already
works:

- **Spots are skipped.** A play carries where a coach's men were standing,
  because repositioning is part of what a play is. But repositioning is a
  pre-snap act, and re-applying stale spots on turn three would teleport a
  coach's men back to the line in the middle of a down.
- **A stance is set only where it differs.** `applyScriptedOrders` follows
  exactly this rule today, for the reason its comment gives: re-committing to
  a stance every turn hands that team a permanent charge bonus. A coach who
  goes quiet for four turns must not collect a free burst on each one.

If a coach has never committed at all, there is nothing to replay and his men
keep whatever orders they have — which on the first turn of the first down
means standing still behind the snap.

## Where the truth lives

**The server runs the game.** A Durable Object holds the authoritative state,
owns the clock, collects both coaches' plays, calls `runTurn` itself, and
sends both clients the identical frames to animate. The clients are input
collectors and viewers.

This is not the obvious design, and the reason it is the chosen one is worth
writing down, because the obvious design looks much cheaper and is a trap.

Every turn in this game is reproducible: `runTurn(state, random)` is pure with
respect to time and randomness, and `mulberry32` is a seeded integer PRNG. So
it is tempting to exchange only the two coaches' plays — a few hundred bytes —
and let each browser simulate the identical down locally, with no game logic
on the server at all. That is lockstep, and it requires both browsers to
compute bit-identical floating point.

They will not. `vec.js` computes every distance with `Math.hypot`, and
`rules.js`, `lob.js`, `modes.js` and `block.js` use `Math.cos` and `Math.sin`.
ECMAScript specifies none of those to bit exactness; V8, SpiderMonkey and
JavaScriptCore are each free to land a fraction of an ulp apart. `Math.hypot`
sits on the hot path of every physics sub-step and every tackle check, thirty
sub-steps to the turn. Chrome against Chrome would agree. Chrome against
Safari would drift, and a drift inside a tackle probability is a down where
one screen shows a tackle and the other shows a touchdown. Server-authoritative
simulation makes divergence impossible by construction rather than by luck,
and it costs 8–15KB of frames per turn on a link that is otherwise idle for
thirty seconds at a stretch.

It also settles two things for free. Cheating is not possible, because a client
can only send a play. And reconnection is nearly trivial, because there is a
source of truth to ask.

### Why not WebRTC

WebRTC buys latency, which is the right trade for a game where a 60ms round
trip through a datacentre is felt. The unit of interaction here is a
thirty-second huddle followed by a half-second animation. Nobody can perceive
the difference between a peer connection and a WebSocket at that cadence, and
the peer connection costs NAT traversal failures, a TURN relay for the players
behind symmetric NATs, TURN's bandwidth billing, and a signalling exchange
that has to succeed before anyone plays. A hibernating Durable Object holding
two WebSockets is less code, less failure surface, and the same product.

## The pieces

### The Worker

One Worker, deployed by wrangler, serving the entire game.

An `assets` binding points at a `_site` directory and serves the page; the
Worker's own `fetch` handles exactly two paths, both WebSocket upgrades:

- `/lobby?variant=<7|11>&side=<offense|defense>`
- `/match/<id>`

Everything else falls through to the static assets. There are no other server
routes. The game is still a page that runs in the browser, and the Worker is a
referee it talks to.

### `LobbyDO`

One instance per variant. It holds two queues, offense and defense, because
coaches queue for the side they want to play rather than taking what they are
dealt.

That choice splits the queue, and a split queue can deadlock: four coaches all
waiting for the offense sit there while the lobby has four people in it. The
lobby answers that with information rather than a policy. It broadcasts both
queue depths to everyone waiting, updated on every change, so a coach can see
that three people want the ball and nobody wants to stop them; and it accepts
a `switch` message that moves a socket to the other queue without losing its
place in line.

When both queues are non-empty it pops the longest waiter from each, mints a
match id, and sends both a `matched` message carrying that id, the side each
was assigned, and a per-player token. Both clients close the lobby socket and
open the match.

Coaches are anonymous. There are no accounts and no names to type; the match
screen says *You* and *Your opponent*.

### `MatchDO`

One instance per match. It holds the authoritative state from `createGame`,
the seeded `random`, both sockets, which side each coach has, each coach's
last committed play, and the current deadline as a DO alarm.

It imports `lib/game/` directly — `createGame`, `runTurn`, `applyPlay`,
`nextDown`, `sanitizePlay` — and runs the same simulation the browser would.
Those modules are pure ES modules with no DOM references, and keeping them
that way becomes a constraint the repository now has to hold: `lib/game/`
has a second consumer, and it is not a browser.

The match logic itself does not live in the Durable Object class. It lives in
`worker/match-engine.js` as a plain function of `(match record, message) →
(new record, messages to send)`, with no sockets, no timers and no platform
API. The DO class is socket and alarm plumbing over the top. This is the same
discipline `lib/game/home.js` follows in building markup as a string so it can
be tested without a DOM, and it has the same payoff: a whole drive, including
every awkward case, is testable under `node --test` with nothing installed.

### The client

`app/multiplayer.js` owns both sockets and the lobby screen, and hands off to
`main.js` when a match starts. `lib/game/lobby.js` builds the lobby markup as
a string, the way `homeMarkup` does, so the waiting screen and its queue
counts are tested without a DOM.

## The protocol

**Joining.** The client opens `/lobby` with its variant and preferred side.
The lobby replies with `queued`, carrying both depths, and repeats it whenever
they change. `switch` moves the client between queues. `matched` ends the
lobby socket's life.

**Starting.** Both clients open `/match/<id>` presenting their token. The
first arrival waits. On the second, the DO calls `createGame` with a seed it
picks and broadcasts `start`: the seed, the variant, the starting yard line,
each coach's side, and the first deadline. A match that does not see both
sockets within 15 seconds dissolves, and the coach who did arrive goes back to
the queue.

**A turn.** Each client sends one `commit` message per turn, carrying the
structure `capturePlay` already produces — plans, stances, the planned pass,
and spots. That structure is the wire format; multiplayer's protocol and the
playbook's storage format are the same thing, already serializable, already
deep-copied, already hardened by `sanitizePlay`. It gains one field,
`turnIndex`, because a play today is only ever a first-turn thing and a
mid-play commit has to say which turn it answers.

When both have committed, or when the alarm fires, the DO applies both plays
through `applyPlay`, calls `runTurn`, and broadcasts `turn`: the frames, the
events, the new deadline, and the authoritative post-turn state. When the
whistle ends the down it calls `nextDown` and the broadcast carries the new
down instead.

**Flush on expiry.** Coaches send their board only when they commit, so when
the alarm fires the server may be holding nothing from a coach who has been
drawing for twenty-nine seconds. The DO therefore sends `timeUp` and waits
about two seconds for a late commit before running the turn. A coach who drew
and did not press still gets his arrows; a coach who has genuinely vanished
falls through to the replay rule above.

**Tailored snapshots.** The authoritative state contains both coaches' plans,
and a human coach's plans persist across turns — only the computer's are wiped
at each whistle. Shipping the whole state to both clients would therefore put
a coach's live arrows in his opponent's browser, unrendered but readable from
a console. The DO strips the other side's plans, cover orders and planned pass
from each client's copy before sending. Stances and facing stay in: those are
already drawn on the board once a turn has run.

## What changes in the existing code

**`lib/game/home.js`** — `SIDES` gains a fourth entry, `multiplayer`, labelled
*Multiplayer*: "Play a live drive against another coach." It is a list built
by a pure function with tests already on it.

**`app/home.js`** — that id imports `app/multiplayer.js` instead of
`app/main.js`.

**`lib/game/state.js`** — a serialize and a hydrate. This is the one genuinely
new piece of game code the feature needs: every client replaces its state with
the server's after every turn. The state is nearly all plain data already, and
"nearly" is where the bugs are, so it carries a round-trip test that builds a
state, runs turns into it, serializes, hydrates, and asserts deep equality.

**`lib/game/play.js`** — `applyPlay` takes the team it is writing. Today it
writes the human's side because there is only one human; a match has two.

**`app/main.js`** — `startGame` takes a `net` handle, null in single-player.
When it is present:

- *Nobody is the computer.* `aiTeam` stays null and a new `state.remoteTeam`
  names the side the other human coaches. The existing "is this player mine"
  gate reads `!== state.aiTeam` and becomes "neither the computer's nor the
  remote's", which keeps every gesture, every warning and every render off the
  opponent's men without touching `ai.js` at all.
- *This client does not run the turn.* Run Turn becomes End Turn: it sends
  `capturePlay` and locks the board. The half of `pressRun` that animates
  frames and narrates events is already a self-contained `finish()`; it is
  lifted into a function the `turn` handler calls with the server's frames, so
  both games narrate a down through identical code. `scheduleAutoAdvance`, New
  Game, Next Down and the AI-mode toggle are hidden in a match — the server
  owns those transitions.
- *The HUD gains a countdown* and a note on whether the opponent has committed.

**Placement rules need no extraction.** A committed play carries spots, so a
modified client could try to line a receiver up in the end zone, and the
referee has to enforce the same rules the board enforces during repositioning.
It already can: `spotFault`, `placePlayer` and `placeFormation` live in
`lib/game/formation.js` and are pure — `app/main.js` is only a caller, and
`applyPlay` already routes a loaded play's spots through `placeFormation`,
which refuses the illegal ones and reports them as `skipped`. The referee gets
this for free by calling the same function. Illegal formations that are merely
*penalized* rather than impossible need nothing either: `formationFoul`
already runs inside `runTurn`, and it will run on the server.

**The playbook needs no work.** Loading a saved play is a local gesture that
fills a coach's own board before he commits, and the books are already
per-side.

## Failure handling

**A coach drops.** The DO pauses the clock, tells the survivor, and holds the
match for 20 seconds. A returning client reopens `/match/<id>` with the token
it kept in `sessionStorage`; the DO sends the current snapshot and resumes the
clock. On timeout it tells the survivor the match is over, returns him to the
lobby, and deletes itself. The drive simply stops — there is no result, and
the computer does not take over an abandoned side, because that would silently
change which game is being played in the middle of a down.

**A stranger arrives.** The token issued at `matched` is what a client
presents to join, so learning a match id is not enough to walk into someone's
game. A third connection to a live match is refused.

**A hostile client.** Every incoming play goes through `sanitizePlay`, which
already exists to harden plays arriving from the playbook store, plus the
placement check above and a size and rate cap on messages.

## Hosting and deployment

**The Worker is the game; GitHub Pages stays as the single-player mirror.**
The Worker serves the page and the lobby and the match objects from one
origin, which is what makes the WebSocket same-origin with no cross-origin
story to get right, and what stops the page and the referee ever being a
version apart — they both import `lib/game/`, and a client running yesterday's
physics against today's authoritative simulation is a class of desync worth
designing out rather than debugging.

Pages keeps publishing the same files with nothing behind them. This was
originally specified the other way, with Pages deleted, on the grounds that
two live copies where only one has a lobby is a support problem. The argument
that won instead is availability: with both, a broken `wrangler deploy` costs
multiplayer rather than the whole game, and single-player has no server to
break.

What the two publications must not share is the home screen. A Pages build
that offered *Multiplayer* would open a socket to an origin with no Worker
under it, so the builds differ by one flag: `app/build-config.js` exports
`MULTIPLAYER`, `tools/build-site.js --no-multiplayer` overwrites that file in
the assembled output — never in the source tree — and `sidesFor` drops the
entry the flag denies. Pages is assembled with the flag off. Everything else
about the two copies is byte-identical.

**No domain is required.** `football-by-turn.<account>.workers.dev` serves
static assets, terminates TLS and upgrades WebSockets exactly as a custom
domain would. A custom name can be added later by pointing a domain's
nameservers at Cloudflare and adding a route, and changes nothing in this
design.

**`_site` is assembled, not authored.** The existing GitHub Action already
copies what the browser actually loads — `index.html`, `app/`, `lib/` — into
`_site`. That step moves into `npm run build:site` so CI and a laptop do the
same thing, and it keeps `docs/`, `tools/`, `PLAN.md`, the coaching logs and
the tests unpublished now that publishing is from a directory rather than a
git branch.

**Single-player development does not change.** `npm run serve` still runs
`serve.py` against the repo with no build step, because that is the loop where
physics gets edited and reloaded. Multiplayer gets its own loop: `wrangler
dev` runs the real workerd locally with real Durable Objects and the assembled
site, so a match is tested with two browser tabs at localhost, on the same
code path as production.

**CI.** The `test` job is untouched. Two deploy jobs hang off it and run in
parallel: `pages`, which is the old build and deploy with `--no-multiplayer`
added, keeping its own permissions and its `pages` concurrency group; and
`worker`, which assembles `_site` and runs `wrangler deploy` with a
`CLOUDFLARE_API_TOKEN` from repository secrets. Neither needs the other, and
neither failing takes the other down.

**Cost.** Static asset requests do not bill as Worker requests. A whole drive
is on the order of forty turns of a handful of small messages each — call it
500 requests, about $0.00008 at $0.15 per million — plus a fraction of a cent
of Durable Object duration, which WebSocket hibernation removes almost
entirely while coaches are thinking. The floor is the plan, not the traffic:
Durable Objects have historically required the $5/month Workers Paid plan,
though SQLite-backed objects have since been opened to the free tier. That is
the one number to check against current documentation before deploying;
nothing else here is sensitive to it.

## Testing

Most of this tests the way the rest of the repository does, as pure functions
under `node --test`: the lobby markup, the new home-screen entry, the state
serialize/hydrate round trip, `applyPlay` scoped to a team, and
the stale-play replay rule — including that it skips
spots and that it does not re-commit an unchanged stance.

The server is tested through `worker/match-engine.js`, which is a plain
function over messages. A test drives an entire drive through it, including
the cases that are awkward everywhere else: both coaches commit, one commits
and the clock expires, neither commits and the replay rule fires, a coach
drops mid-clock, a coach reconnects, a coach never arrives, a third socket
knocks, and a play arrives with a receiver standing in the end zone.

The Durable Object classes hold only socket and alarm plumbing and are
verified by hand, once, with two tabs against `wrangler dev`.

## Deliberately not in this

- No score, no game clock, no possession change. A match is one drive.
- No rematch against the same opponent; *Play again* is a fresh pairing.
- No spectators, no accounts, no names, no chat.
- No AI takeover of an abandoned side.
- No WebRTC. If a genuinely latency-sensitive mode is ever wanted, the
  peer connection can be layered under this protocol later without changing
  who is authoritative.
