# The defense reads the play

## Motivation

The computer does not know what a down is. It knows what a turn is.

`turn.js` calls `coachAi(state)` at the top of every half-second and the brains
answer from whatever is in front of them at that instant. Nothing carries over.
`learnedOrders` re-runs `schemeChoice` every turn, and one of that gate's three
inputs is `spread` — the width of the offense, measured live. Men scatter after
the snap, so the width grows, so **the man/zone call can flip in the middle of a
play**. `learnedCoverAssignments` re-runs its greedy claim every turn too, which
means a defender can silently hand his man to somebody else between turn one and
turn two. Neither is a decision anyone made; both are what happens when a
pre-snap call is recomputed from a post-snap picture.

The offense has a shallow version of the missing idea already. `state.aiPlay`
holds `{call, side, give}`, written at `turnIndex === 0` and read back on later
turns, so turn three still knows what turn zero decided. One field, one side of
the ball, and no notion of what the *other* team is doing.

So there is no object in the codebase that represents a down, and there is
nothing anywhere that answers the question a defense actually asks: **what is
this play?** The defense cannot read run or pass, cannot commit to that read,
and — the part that matters for the game — cannot be *wrong* about it. A coach
can already draw play-action with the tools he has: cut-block the line forward,
hold the quarterback, throw on turn two. Today it buys him nothing, because
there is no belief in the defense for the fake to corrupt.

## What this changes, in one sentence

The brains stop being handed a stream of instants and start being handed one
object per down — the look they snapped against, a fallible read of what the
play is, and the call they committed to — and the defense's second level acts
on that read, including when the read is wrong.

## Why the parameters start at zero

Every parameter this design adds inits to `0`, except `read:commit`, which inits
at its maximum. At those values the accumulator is identically zero, confidence
is zero, `committed` is never true, and the defense plays **byte for byte** the
defense it plays today.

This is the codebase's own idiom, not a new one, and `adapt:*` did it first.
Training is a walk away from a known-good posture, not from noise.

**How the shipped genome stays valid is worth stating precisely, because the
obvious answer is wrong.** `clampGenome` does fill missing keys from their spec
`init` — but only two callers on the read path use it (`formation.js:224` and
`learned/formation.js:54`), and neither is on the one that matters here:
`turn.js` and `ai.js:118` both hand `activeGenome(...)` to the policy **raw**. A
shipped genome missing a key its policy dereferences yields `undefined`, and
`undefined + undefined * x` is `NaN` for the whole game.

What actually holds the line is an invariant this repository already asserts as
a test — `test/game/learned/active.test.js:16`, *"the shipped genome holds every
key its spec names"*. So adding a key to `DEFENSE_SPEC` obliges you to add it to
`lib/game/learned/defense-genome.js` at its spec init in the same change. That
file's header forbids hand-editing in favour of retraining, and this is the
narrow exception the invariant creates: a mechanical key addition at init values,
with every trained float preserved, is not a hand-tuned genome.

The cost is stated plainly in **Training** below: the retrain is part of this
work, not a follow-up, because without it the feature is invisible.

## Where the code goes

A new module, `lib/game/read.js`. Pure and dice-free, like `defense.js` and
`zone.js` beside it: it reads state, it returns or writes plain serializable
data, and nothing in it rolls a die. A coached turn stays as reproducible as a
hand-planned one.

It owns one new state field.

### The field is `state.playRead`, not `state.play`

`play.js` already owns "a play" as a playbook entry — the thing a coach saves in
a slot and calls again on a later down. A second, unrelated `state.play` would
be a lasting reading hazard in a codebase whose comments talk about plays
constantly. `playRead` says which of the two it is.

```js
state.playRead = {
  look,   // frozen once, at the top of turn 0
  read,   // the defense's diagnosis, advanced once per turn
  call,   // { offense, defense } — what a brain committed to
}
```

`call.offense` absorbs today's `state.aiPlay` verbatim. `state.aiPlay` is
removed.

### Lifecycle

**Built lazily, inside `advancePlay`, on the turn where the field is null.**
Not in `nextDown`, and this is forced rather than preferred: `nextDown` ends by
running `maybeApplyLearnedFormations` and `answerOffense` (`rules.js`), and the
human then spends the entire planning phase dragging people around. A look
frozen at `nextDown` would be a picture nobody ever lined up in. Freezing at the
top of turn 0 catches the formation they actually snapped from.

Lazy construction also means a state carrying no field at all — an old save, a
test's hand-rolled object — simply works, the discipline `tendencyCounts` and
`genomeOverrides` already use.

**Advanced from exactly one call site.** `turn.js`, in the line immediately
above its existing `coachAi(state)`:

```js
advancePlay(state, activeGenome(state, 'defense'));
coachAi(state);
```

The genome is passed in rather than fetched, matching how `rules.js` already
calls `answerOffense(state, activeGenome(state, 'defense'))`.

**Cleared** by `nextDown` — the line that today sets `state.aiPlay = null` sets
`state.playRead = null` instead — and initialized `null` in `makeState`.

### Two constraints that fall out of the call site

**It must not gate on `state.aiTeam`.** The training harness runs hot-seat *on
purpose*: `aiTeam` is null while `defenseCoach(values)` calls `learnedOrders`
directly (`train/harness.js`). A percept that existed only when `aiTeam` was set
would be absent for every single play a genome is ever scored on. `advancePlay`
runs unconditionally.

**The read may never look at the opponent's orders.** Not `p.plan`, not
`p.cover`, not `p.mode`, not `state.plannedPass`. Positions, velocities and the
ball, and nothing else.

This is the rule the whole feature rests on. Because `advancePlay` runs before
`coachAi`, the board at that moment holds the human's drawn arrows. A read that
looked at them would diagnose the play call off the arrows themselves — perfect
on turn 0, and play-action impossible by construction. Restricting the cues to
the physical picture is what makes a fake work: a boot is visible only as
*motion*, one turn late.

It also means the computer never reads its own intentions as evidence, since
`clearAiPlans` has already wiped them at the previous whistle.

## The look

Frozen at the top of turn 0. Two features:

- **`spread`** — the widest offensive `pos.x` minus the narrowest, over the
  field width. This is the value `schemeFeatures` computes live today; moving it
  here is what stops the scheme flipping mid-down.
- **`backs`** — how many non-line, non-quarterback men are behind the line of
  scrimmage, over the offense's size.

Deliberately coarse, for the reason `defense-policy.js` already gives about its
own gate: a gate with three inputs can be learned from a few thousand plays, one
with thirty cannot.

`down` and `toGo` are not frozen. They are on `state`, they cannot change within
a down, and copying them would be two ways to ask the same question.

### One axis, not two

A flow-side read was considered and rejected. `flowLinebacker` and
`pursuitTarget` already mirror the carrier post-snap, and `anchorShift` already
slides zone anchors by recorded tendency. A learned side read would double the
genome surface to re-derive what the rule layer does well. Run-versus-pass is
the axis nothing in the codebase currently answers.

## The read

One signed accumulator and two derived numbers. Positive is pass.

```
z₀ = read:prior + read:spread·look.spread + read:backs·look.backs
zₜ = read:inertia·zₜ₋₁ + Σ read:<cue>·cueₜ

read = { pass: z, confidence: tanh(|z|), committed: |z| > read:commit }
```

`tanh` bounds confidence into `[0,1)` with no extra parameter to tune.
`read:inertia` in `[0,1]` is what makes the defense fallible in a way it can
learn out of: at 1 it never forgets and stays wrong for turns, at 0 it is
jumpy and never commits to anything.

Fallibility is deterministic. Nothing here rolls a die; the defense is fooled
because the evidence in front of it genuinely says the wrong thing for a turn,
which is both honest football and a property the training harness requires.

### The cues

All three are physical, all three are read at the top of turn `t ≥ 1`, off the
result of turn `t-1`'s physics.

Every cue is normalized into roughly `[-1, 1]` before its weight is applied, so
that one `−4…4` range serves all three and a genome cannot be handed a raw yard
count large enough to swamp the accumulator on its own.

- **`qbDepth`** — the quarterback's depth behind the line in yards, signed by
  `defendDir` so that dropping back is positive, divided by a full drop's depth
  and clamped. The loudest pass key in football, and it separates cleanly here:
  a real drop is `setPlan(qb, {x:0,y:-1}, genome['qb:drop'])`, while the option's
  fake boots him *forward* at `OPTION_FAKE_FORWARD`.
- **`lineFlow`** — the offensive line's mean velocity component downfield, over
  a lineman's own `maxSpeed`, and negated so that driving downfield reads as a
  run. Run blocking drives; pass protection sets and holds. Velocity, never the
  plan.
- **`ballAir`** — `1` when `state.ball.carrierId === null`, `0` otherwise.
  Usefully *not* conclusive: `planLearnedRun`'s give is a `setPass` from the
  centre to the back, so a direct snap looks like a throw for exactly one turn.
  That is the mesh point, and it falls out for free rather than being modelled.

Turn 0 has no cues, because nothing has moved yet. The read at the snap is the
prior and the look, which is the order a defense actually gets its information
in.
## New genome keys

Nine, appended to `DEFENSE_SPEC` in `learned/defense-spec.js`.

| key | range | init | what it weighs |
|---|---|---|---|
| `read:prior` | −4…4 | 0 | belief before any evidence |
| `read:spread` | −4…4 | 0 | how wide they lined up |
| `read:backs` | −4…4 | 0 | how many are in the backfield |
| `read:inertia` | 0…1 | 0 | how much of last turn's belief carries |
| `read:qbDepth` | −4…4 | 0 | the quarterback's depth |
| `read:lineFlow` | −4…4 | 0 | the line driving downfield |
| `read:ballAir` | −4…4 | 0 | the ball loose |
| `read:commit` | 0…8 | 8 | evidence needed before acting on the read |
| `read:trigger` | 0…10 | 0 | yards the second level bails on a pass read |

At these inits `z ≡ 0`, `committed` is never true, `read:trigger` is zero, and
the defense is unchanged.

## How the defense uses it

`learnedOrders` keeps its three rule-based guards untouched — no ball, the
defense has the ball, the carrier is past the line. The read still advances on
those turns, because `advancePlay` is unconditional and a percept with holes in
it would be a worse thing to reason about than one nobody consulted; the guards
simply do not consult it. Once the carrier is past the line there is nothing
left to diagnose anyway. Design decision 7's line
holds: the learned layer decides scheme, assignment and alignment, and does not
relearn how to run a pursuit angle. The changes are all inside the
scheme-and-assignment branch.

### The scheme is called once and never changes within a down

`schemeChoice` runs on turn 0, reading `look.spread` instead of live positions,
and writes `call.defense.scheme`. Later turns read the field.

That is a scheme in the football sense — a pre-snap call — and the mid-down flip
described in the motivation disappears, not because it is suppressed but because
the input stops moving. `schemeFeatures` gains a `look` argument and loses its
own spread computation.

### Assignments are made once and held

`learnedCoverAssignments` runs on turn 0 into `call.defense.cover`, a plain
`{defenderId: receiverId}` map, re-issued as the same orders every turn after.

No re-assignment logic is required, and none is added. If a covered man becomes
the carrier, guards two and three already take the whole defense over. `cover.js`
is untouched: `applyOrders` still issues through `setCover`, exactly as today.

### The trigger

Where the read bites. Both halves reuse helpers that already exist.

**Committed to run** — backers, and covering backs who are not the deep free
man, *drop their coverage* and take an aim at the carrier through
`leverageAim(p, interceptPoint(p, car), car)`, the same call guard three already
makes.

This is the whole mechanic. He leaves his man, and on play-action the throw goes
exactly where he was standing. It needs no new parameter: `read:commit` decides
how sure he must be, and that is the only question worth learning.

**Committed to pass** — second-level aims that are *not* coverage orders
(`deepAim`, `flowLinebacker`) move `read:trigger × confidence` yards *away* from
the line of scrimmage, along `defendDir`. He gives ground rather than filling.

The rushing line and the deep free man are excluded from both. Their jobs do not
change with the read, and decision 7 keeps them rule-based.

### The read is said out loud

`autoplan.js`'s `defenseNote` re-reads `learnedOrders`' branches to report what
the defense called. It gains the belief: *"They read run — the backers are
coming downhill."*

In a game about out-thinking an opponent, a defense that can be fooled is only
worth having if the coach can see that it was fooled.

## How the offense uses it

A fold-in with no behavioural change. `state.aiPlay` becomes `call.offense`,
written by `coachLearnedOffense` at turn 0 and read by it after. The call sites
that move are `learned/offense-policy.js` (the write and the read),
`autoplan.js`'s `offenseNote`, the reset in `rules.js`, and the initializer in
`state.js`.

The offense does **not** read the defense. Diagnosing coverage and pressure is a
symmetric feature roughly doubling this one, and it is a non-goal here.

## Training

This is the part of the design most likely to be got wrong, so it is written
down rather than left to the plan.

### The problem

`train:defense` — which the README names as *the* path that actually trains the
defense's adaptive weights — scores against `scriptedOffenseCoach`, which is
`autoplanOffense`, which is a quarterback run option that **never throws a
forward pass**. Ship `read:*` keys whose only exercise is a run and they score
as noise and evolve to garbage.

That is not a hypothetical. It is precisely, mechanically, the `adapt:*` failure
the README already documents:

> A defense trained through `train:coevolve` cannot learn its `adapt:*` weights
> from that; they score as noise.

`train:coevolve` does present both calls, since `chooseCall` genuinely picks
pass. But its offense can collapse to always-run and take the read weights back
to noise with it.

### The distribution

`evaluateDefense`'s default offense deals one of three scripts per scenario,
uniformly at random from the seeded generator the rest of the evaluation already
turns on, in the idiom `dealOffensiveLook` established. Uniform rather than
weighted toward the run: the read has to learn both classes, and a distribution
that matched real play-calling frequency would give it the rarer class less
evidence for no benefit to what is being measured.

- **a recorded human run**, replayed from `default-offense.json`;
- **a recorded human pass**, replayed from `default-offense2.json`;
- **a scripted play-action pass** — run keys on turn 0, the line driving and the
  quarterback holding, and a throw on turn 2.

The synthetic dropback script this design originally called for is **dropped**:
`default-offense2.json` supplies twenty downs of real drop-back-and-throw, which
is better football than anything the harness would fabricate, and one fewer
thing to keep in step with the engine.

The third stays synthetic and is not garnish. **Neither log contains a fake** —
they are runs and they are passes, and nothing in either sells one and throws the
other. It is the only thing in the distribution that punishes over-committing,
and without it `read:inertia` is unconstrained and training returns whatever
value drifts. A feature about being fooled needs fakes in its training set.

`autoplanOffense` itself is **not** touched. It is the human's one-press button,
and changing what that button does is outside this work.

### Prerequisite: the variant barrier

`situationDistance` walls off snapshots recorded under a different variant:

```js
if (a.variant !== b.variant) return Infinity;
```

Its comment justifies this for seven-man against eleven-man football — a call
made with eleven bodies is not a nearer version of a seven-man call. That is
right, and it is not what the string actually compares.

Seventeen of `default-offense2.json`'s twenty downs were played against a nickel
defense and so carry `'7-nickel'`. `DEFENSE_VARIANT` is `'7'`. So a defense
trained at `'7'` can reach **three of those twenty downs**; the other seventeen
are invisible, and the pass arm of the distribution above mostly does not exist.

The barrier is wrong for this case and `rosters.js` proves it: `'7'`,
`'7-nickel'` and `'7-dime'` field the **identical `SEVEN_OFFENSE`**. They differ
only in the defensive package. For an offense ghost every id in those snapshots
exists and applies exactly.

**The fix**: compare `baseVariantId(a.variant)` against `baseVariantId(b.variant)`
— the helper already exists in `rosters.js` and already maps `'7-nickel' → '7'`
— for a ghost impersonating the **offense** only. A defense ghost keeps the
strict comparison, because there the personnel package is precisely the thing
that differs and `applySnapshot` would silently skip ids the package does not
field.

This is a prerequisite, not a nice-to-have: without it the training distribution
this design depends on is three downs of passing.

### The committed ghost logs

| log | snapshots | downs | variants (by down) | throws |
|---|---|---|---|---|
| `default-offense.json` | 61 | 7 | `7`×7 | 4, three of them turn-1 pitches to `o-rb` |
| `default-offense2.json` | 198 | 20 | `7`×3, `7-nickel`×17 | 18 across 15 downs, 7 to wide receivers at full power |

Both parse with nothing dropped. Both are entirely offense.

They are committed because `train:vs-ghost`'s `--log` otherwise names a file every
contributor has to record for themselves, so a genome trained that way cannot be
reproduced from a clean checkout. `.gitignore` ignores `coaching-logs/*` and
un-ignores `coaching-logs/default-*.json`: the name is the rule, so a log joins
the corpus by being named rather than by an edit to the ignore file, and every
other export the Coaches Menu drops in that folder stays the coach's own.

**What is in each, because it constrains the design:**

`default-offense.json` is the **run arm and only the run arm**. Seven downs, no
turn-0 throw, and three of its four throws are power-1 tosses to `o-rb` on turn
1 — pitches, not dropbacks. It is better than a synthetic option at being the run
arm (varied looks, hand-drawn arrows, downs running 3 to 17 turns), and those
pitches are real examples of "the ball is in the air and it is still a run",
which is exactly the ambiguity `read:ballAir` exists to price.

`default-offense2.json` is the **pass arm**. Twenty downs, fifteen of them
carrying a throw, seven of those to `o-wr1` or `o-wr2` at full power on turns
1 through 4, with downs running 12 to 14 turns and heavy `holding` stances. That
is drop-back-and-throw, and it is what the first log has none of. Its
down-and-distance spread is wider too — 1&10, 2&2, 2&7, 2&10, 3&1.

**Neither log has a turn-0 throw**, across all 27 downs. That is not a defect in
the coaching: in this engine a drop-back pass *cannot* put a throw on turn 0,
because turn 0 is the drop and the routes and the throw is set on turn 1 to 4.
It matters here only as a warning about what the logs cannot be used for — see
the note below.

Neither log contains a **fake**. That is why the play-action script stays
synthetic.

Twenty-seven downs is also thin for the ghost's nearest-neighbour lookup, whose
`SITUATION_WEIGHTS` weight `turnIndex` heaviest and which has few recorded downs
reaching the high teens. A richer log is expected later and drops in by name; no
code changes when it does.

### A known bias this design inherits

Because no recorded down carries a turn-0 throw, and because `recordPlanning`
counts only turn 0 while `observationFromSnapshot` classifies by whether that
snapshot carries a throw, **the tendency layer records every one of these 27
downs as a run**. Run through the project's own code, both logs yield
`targets: {}`, `favorite: null`, and a `passRate` of 0.18–0.31 for a coach who
threw on fifteen of twenty downs.

The consequences reach this design: `favoriteDiscount` can never fire, and
`schemeShade` leans the man/zone gate — which this design now calls once, at the
snap, off `look` — on a `passRate` biased toward run.

**It is not fixed here.** It is a pre-existing defect in `tendencies.js` and
`app/main.js`, spun out as its own task with the reproduction. This design does
not touch `tendencies.js`, and the post-snap read it adds is in fact the layer
that catches what a turn-0 classifier structurally cannot.

### Fitness is unchanged

Checked rather than assumed. A linebacker who bites on a fake is out of
position, the throw completes, and that moves `gainYardsPerPlay`, `PASS_PENALTY`
and `AIR_YARD_PENALTY` at once. `defenseFitness` already prices this.

### Deliverable

The `baseVariantId` relaxation in `situationDistance`, without which the pass arm
of the distribution is three downs; a regenerated
`lib/game/learned/defense-genome.js` from `train:defense`; and a README update,
since the README explains these training paths in detail and one of them is
changing.

## Testing

A new `test/game/read.test.js` pins the properties the design rests on:

- **The look is frozen.** Scatter the players after turn 0 and `look.spread`
  does not move. The mid-down-flip regression, held directly.
- **Orders are not evidence.** A state with a drawn pass plan but no motion yet
  yields the same `z` as one with nothing drawn. The honesty rule, pinned rather
  than trusted to reviewers.
- **A zero genome is today's defense.** With every `read:*` at init,
  `learnedOrders` returns output equal to the current function's for the same
  state — an equality assertion, the way the project already holds `cov:dist = 1`
  equal to `defense.js`'s greedy assignment.
- **Play-action fools it.** Run keys on turn 1, pass keys on turn 2, high
  inertia, and the read is still on run. The mechanic as a scenario.
- **It runs hot-seat.** `advancePlay` with `aiTeam` null, which is every play the
  harness ever scores.
- **Scheme and assignments hold** across the turns of one down.

The variant relaxation gets its own coverage in `test/tools/ghost.test.js` (or
`test/game/train/`, wherever `situationDistance` is currently held): an offense
situation at `'7'` finds a `'7-nickel'` snapshot, a defense situation at `'7'`
still does not, and `'7'` against `'11'` stays `Infinity` for both sides.

Existing tests that move: `test/game/ai-learned.test.js` (`schemeFeatures` gains
its `look` argument), `test/game/learned/defense-policy.test.js`,
`test/game/learned/offense-policy.test.js` and `test/game/autoplan.test.js` (the
`aiPlay` → `call.offense` rename), and `test/tools/harness.test.js` for the
three-way scenario deal.

## Non-goals

- **The offense does not read the defense.** No coverage or blitz diagnosis.
- **No flow-side read.** One axis; the rule layer already mirrors flow.
- **The scheme does not change mid-down.** Adjustment happens through the
  trigger, not by re-calling the coverage.
- **`autoplanOffense` is unchanged.** The human's button stays the human's
  button.
- **`cover.js`, `zone.js` and the rush/contain rules are unchanged.** Decision 7
  holds.
- **`tendencies.js` is not fixed here.** The turn-0 pass-blindness described
  above is a pre-existing defect with its own task. This design inherits the
  bias and does not widen it.
