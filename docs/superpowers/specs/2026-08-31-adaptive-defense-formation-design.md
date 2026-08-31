# The learned defense answers the formation

## Motivation

Split a receiver wide against the computer and its corner does not move. Empty
the backfield and the same seven men stand in the same seven places. The
defense you face when you pick *offense* on the home screen — `defaultModeForSide`
hands you `{ ai: 'defense', level: 'learned' }` — is the one defense in the game
that never answers a look.

This is not an oversight; it is written down. `learnedDefenseSpots` reads the
genome and nothing else, and `realignLearnedDefense` intercepts the app's
realign hook specifically to re-stamp those fixed spots over the top of the
rule-based alignment, with a comment saying so: the genome look "does not
'answer' a changed offensive look, it just holds its ground." That was the
right call when the genome's spots were the only thing that made a learned
defense *look* learned. It is the wrong call now, because holding ground is
the one thing a real defense never does.

The other two brains already answer. `smart` and `basic` both run
`alignDefense` through `app/main.js`'s `realignDefense` on every reposition
drag, every called play and every personnel change: the front goes head-up on
the interior, the backs take the widest men left over, the deep man centres on
the formation. So the football is already written. What is missing is a way for
the learned defense to *use* it without ceasing to be learned.

Separately, no computer defense has ever substituted. `setPersonnel` has
exactly one caller in the codebase — the human's Personnel button. The computer
plays stacked against an empty backfield and stacked against a goal-line set,
because nothing has ever asked it not to.

## What this changes, in one sentence

The genome's spots stop being where the defense stands and become where it
stands *before it has looked at anything*; a new pull, learned per position
group, moves each man from there toward the answer `alignDefense` would give —
and a second learned decision subs the package before any of that happens.

## Why the parameters start at zero

Every parameter this design adds has `init: 0` (the pulls) or `init: -4` (the
substitution biases, which are logits). `clampGenome` already fills keys a
genome file does not carry from their spec `init`, and drops keys the spec does
not name:

> A genome loaded from an older file therefore always fits the code that is
> about to read it.

So the shipped `defense-genome.js` stays valid the day this lands, and at these
inits the defense plays **byte for byte** the defense it plays today: every pull
is zero, so every man stands on his genome spot, and both substitution logits
are firmly negative, so the package is always stacked. Nothing on screen changes
until the genome is retrained.

That is the whole shape of the approach and it is the codebase's own, stated in
`defense-spec.js`'s header: training is a walk away from a known-good posture,
not from noise. The cost is stated plainly in the Retraining section below: the
retrain is part of this work, not a follow-up, because without it the feature is
invisible.

## Where the code goes, and why not the obvious place

The obvious home is `lib/game/learned/formation.js`. It is the wrong one.

That module carries a deliberate constraint, stated in its header: it imports
nothing from `state.js`, `defense.js` or `formation.js`. The constraint is real
rather than stylistic — `state.js` imports *it* (for `maybeApplyLearnedFormations`
in `createGame`), so `learned/formation.js` → `defense.js` → `state.js` closes a
cycle, and `learned/formation.js` → `formation.js` → `state.js` closes another.

Everything this design needs is on the far side of that wall: `positionGroup`,
`deepMan` and `backerLane` from `defense.js`; `onTheLine`, `setPersonnel` and
the whole pairing algorithm from `formation.js`. Building the adaptation inside
`learned/` means re-keeping all of it as private copies. That module already
does this once, for `clearX`, and spends a paragraph justifying it and a test
binding the copy to `formation.js`'s `spotFault` so the two cannot drift. Doing
it three more times is how two rulebooks become four.

**So the adaptation lives in `lib/game/formation.js`**, beside `alignDefense` —
the module whose header already says its job is "where the defense stands to
answer it," and which holds every helper the answer is made of.

`formation.js` may import `learned/formation.js` freely (`learned/formation.js`
imports nothing back), so it can call `learnedDefenseSpots` for the base look.

### The one gap this leaves

`state.js`'s `createGame` cannot call into `formation.js` — that is the cycle.
So the opening kickoff look is the unadapted base: the genome's spots, stacked
personnel, exactly as today.

This is accepted rather than worked around. At a kickoff nobody has changed
anything yet — the offense is standing in its roster default, which is the look
the genome was trained against in the first place — and the first drag, called
play or personnel press runs `realignDefense` and adapts it. Closing this gap
properly means moving `positionGroup` and `onTheLine` down into leaf modules,
which is a refactor this feature does not need and should not smuggle in.

## New public surface

Three new exports from `lib/game/formation.js`, all taking `values` as a
parameter rather than reaching for `DEFENSE_GENOME`, so the training harness can
evaluate a candidate genome with them — the shape every function in `learned/`
already has:

```js
learnedPersonnel(state, values) -> 'stacked' | 'nickel' | 'dime'   // pure
learnedLook(state, values)      -> [{ id, pos }]                   // pure
answerOffense(state, values)    -> boolean                         // writes
```

`answerOffense` is the only writer and the only thing callers need: it returns
`false` and touches nothing unless `isLearnedDefense(state)` holds, so every
caller keeps its existing `alignDefense` fallback unchanged.

## The base look, and the answer

`learnedLook` computes, for each defender, a **base** spot and an **answer**
spot, and returns the interpolation between them.

Both are held in *yards* — across (yards from the field's middle, negative left)
and down (yards past the line of scrimmage on the defense's side) — and
converted to field units exactly once, at the end, through `fieldPos`. This is
the same coordinate pair the spec itself is written in, so the blend is
arithmetic on the genome's own numbers rather than on pixels.

**The base** is the genome's, unchanged: `pos:<id>:across` and `pos:<id>:down`
for every id the spec names. An id the spec does not name (a nickel or dime
newcomer, before the spec entries below are added) has no base and takes the
answer outright.

**The answer** reproduces `alignDefense`'s football, per position group. Let
`them` be the offense, `ball` the ball's spot, `mid` the mean across of the
offense, `front` this defense's own `positionGroup === 'line'` men in roster
order, `onLine` the offensive men within `ON_LINE_YARDS` of the line sorted by
distance from the ball ascending, `covered` the first `front.length` of those,
and `wide` everyone uncovered sorted by distance from the ball descending —
identical to `alignDefense`'s own ordering, because the whole point is that a
pull of 1 lands a man exactly where `alignDefense` would put him.

| group | answer across | answer down |
|---|---|---|
| `line` (i-th) | across of `onLine[i]`, last man if short | `ALIGN_LINE_YARDS` |
| `back` (i-th, excluding the free man) | across of `wide[i]` | `ALIGN_CORNER_YARDS + max(0, state.losYard - yardsOfY(wide[i].pos.y))` |
| the free man (`deepMan`) | `mid` | `ALIGN_DEEP_YARDS` |
| `backer`, and anyone else | `mid + backerLane(state, d)` | `ALIGN_BACKER_YARDS` |

Two of those rows deserve their reasons written down.

The **backer's** answer is `mid + backerLane`, where `alignDefense` uses
`ball.x + backerLane`. Anchoring the lanes on the formation's centre of mass
rather than on the ball is what makes a backer shade to strength — a defense
that keeps its lane spacing *and* leans toward where the bodies are. It is a
strict improvement on the rule-based answer, and it is the one place this design
knowingly diverges from "a pull of 1 equals `alignDefense`". The tests below
assert the divergence deliberately rather than letting it read as a bug.

The **free man** is `deepMan(state, team)`, read off the board before anything
is written, exactly as `alignDefense` reads it. Not "the back with the largest
genome depth", which would be the more self-consistent choice inside `learned/`:
`deepMan` is who `defense.js` will actually play as the free man during the
down, and the alignment agreeing with the play is worth more than the alignment
agreeing with the spec.

### The pull

Eight new spec parameters, `min: 0, max: 1, init: 0`:

```
adapt:line:width     adapt:line:depth
adapt:backer:width   adapt:backer:depth
adapt:back:width     adapt:back:depth
adapt:deep:width     adapt:deep:depth
```

Each man's spot is `lerp(base, answer, pull)` on each axis independently, using
his group's pair. At 0 he stands on his genome spot; at 1 he stands on the
answer; between is a defense with its own learned identity that still travels
with the men you split wide.

**On the depth pulls, honestly:** only the *backs'* answer-depth actually reads
the offense — it is a cushion off his own man, so a flanker three yards off the
ball drags his corner back with him. The other three answer-depths are
`alignDefense`'s own constants, so `adapt:<group>:depth` there does not mean
"answer the formation", it means "how much rule-based depth discipline do I take
on". That is still worth having, and not only in the abstract: the shipped
genome stands its nose tackle at `pos:d-nt:down = 6.17`, six yards off the ball,
which is a large part of why the current learned look reads as broken rather
than merely static. A depth pull is what lets training walk him back onto the
line.

### Legality

Unchanged, and deliberately so. After the blend, each spot goes through the same
treatment `learnedDefenseSpots` already applies: `down` floored at the spec's own
`0.5` (the defense's own side of the ball, which `spotFault` requires) and capped
at `MAX_YARD - losYard`; across clamped inside the sidelines; and the outward
`clearX` scan against everyone already standing — the offense as it is, and
teammates as they are placed, in order. Because the blend is a convex combination
of two spots that each already satisfy the depth bounds, no new clamp is needed
for the interpolation itself; the existing ones cover it.

## Substitution

`learnedPersonnel` scores one axis — *how much are they forcing me to sub* — and
cuts it twice:

```
z      = sub:spread·spread + sub:backs·backs + sub:toGo·toGo
dime   if z + sub:dime:bias   > 0
nickel if z + sub:nickel:bias > 0
stacked otherwise
```

Five new parameters: `sub:spread`, `sub:backs`, `sub:toGo` (`min: -4, max: 4,
init: 0`) and the two biases (`min: -4, max: 4, init: -4`).

The features:

- **`spread`** — `(max x - min x) / (SIDELINE_RIGHT - SIDELINE_LEFT)`, the
  identical expression `defense-policy.js`'s `schemeFeatures` already computes.
  The same reading feeding two decisions is the point: how wide they are is one
  fact about the offense, and the scheme gate and the substitution should not
  disagree about it.
- **`backs`** — the fraction of the offense *not* within `ON_LINE_YARDS` of the
  line. The empty-backfield tell, and the one thing `spread` cannot see: a team
  can be narrow and still have five men in routes.
- **`toGo`** — `min(1, (toGoYard - losYard) / 10)`, again `schemeFeatures`'s own.

One shared axis with two thresholds rather than two independent logits. Five
parameters instead of eight, and it encodes the true thing: nickel and dime are
two points on one line — how many bodies do I need in coverage — not two
unrelated decisions. At the init biases of `-4` with every weight at 0, `z` is 0
and both cuts fail, so an untrained genome is always stacked. This is
`scheme:bias`'s own trick, for the same reason.

### The newcomers

Nickel brings on `d-lb2` and dime brings on `d-cb3` (in the seven-a-side rosters
the genome is trained for). The spec does not name them, so `learnedDefenseSpots`
skips them and they keep their roster spot — after which the adaptation pass
moves them like anyone else, since it works off `positionGroup` rather than off
which keys the genome carries.

Four spec entries are added anyway — `pos:d-lb2:across`/`down` and
`pos:d-cb3:across`/`down`, with inits taken straight from `SEVEN_DEFENSE_NICKEL`
and `SEVEN_DEFENSE_DIME` — so a sub package is as learnable as the base one.
`defense-spec.js`'s header already blesses exactly this: formation keys are
per-id, and an id the field does not hold contributes nothing.

Seventeen new parameters on a roughly thirty-parameter genome. That is a
materially larger search space and training will take longer to converge; it is
the price of the feature and is noted here so it is not a surprise at the
retrain.

### `isLearnedDefense` has to widen

`setPersonnel` writes `state.variantId = '7-nickel'`. `isLearnedDefense` compares
`state.variantId === DEFENSE_VARIANT` — `'7'` — exactly. So without a change, the
instant the computer subs itself its learned formation switches *off* and it
falls through to the rule-based `alignDefense`, while `coachAi` carries on
running the learned brain in play, because that check has no variant gate at all.

The comparison becomes `baseVariantId(state.variantId) === DEFENSE_VARIANT`,
using the helper `rosters.js` already exports for this. A genome trained for the
seven-a-side game is a genome for its nickel and dime packages too; it is the
same eleven-versus-seven distinction that gate was written to make.

## Wiring

`answerOffense(state, values)`, in order:

1. `isLearnedDefense(state)` — false means return `false` and touch nothing.
2. `setPersonnel(state, learnedPersonnel(state, values))` — new bodies first,
   because the spots that follow have to be spots for the men actually on the
   field. `setPersonnel` is itself gated on `canReposition`, so this cannot fire
   after the snap.
3. Write `learnedLook(state, values)` onto the board, wiping each moved man's
   plan and cover exactly as `applyLearnedDefenseFormation` does — an order
   worked out from where he used to stand is a lie now.

Three call sites:

- **`app/main.js`'s `realignDefense`** — `answerOffense(state, DEFENSE_GENOME.values)`
  first, falling back to `alignDefense` when it returns false, replacing today's
  `realignLearnedDefense` call. This is the one that fires on every reposition
  drag, every called play and every personnel press. It is the fix.
- **`rules.js`'s `nextDown`** — after `maybeApplyLearnedFormations` (which still
  owns the learned *offense*'s formation) and before `aimSnap`. `nextDown` sets
  `phase = 'planning'` and `turnIndex = 0` immediately above, so `canReposition`
  holds and the substitution takes. The defense's spots are written twice on a
  new down; both writes are pure and the second wins, which is cheaper than
  teaching `maybeApplyLearnedFormations` about a module it cannot import.
- **`tools/harness.js`'s `defenseCoach`** — the same swap, with the *candidate's*
  `values`. Without this the new parameters are never exercised during evaluation
  and evolution cannot learn them; they would drift as free noise. The harness
  already runs `offenseCoach` before `defenseCoach` inside the turn loop, so the
  offense's formation is on the board when the defense reads it — which is
  precisely the condition adaptation needs to be trainable at all.

`realignLearnedDefense` loses its only caller and is deleted. Its
responsibility — "keep a learned defense looking learned all the way through
planning" — is now `answerOffense`'s, and better served.

## The Personnel button

`personnelBtn` is enabled whenever `canReposition(state)` is true, with no regard
for who is coaching the defense. Today that means a human coaching offense can
reach over and sub the computer's defense into dime for it. Once the computer
picks its own package the two would fight on every press: the human cycles,
`realignDefense` runs, `answerOffense` subs it straight back.

The button is disabled when `state.aiTeam === 'defense'`. This is a bug fix that
this feature makes unavoidable rather than a feature of it; it is listed here so
it is not mistaken for scope creep in review.

## Testing

The load-bearing pair — these two together *are* the backward-compatibility
guarantee, and if either fails the shipped genome's behaviour has silently
changed:

- with every `adapt:*` at 0, `learnedLook` returns spots identical to
  `learnedDefenseSpots` for the same genome and state;
- with the biases at their inits, `learnedPersonnel` returns `'stacked'` for
  every scenario — a spread look, an empty backfield, third and long.

Then the behaviour itself:

- a pull of 1 for a group lands that group where `alignDefense` lands it, within
  the `clearX` nudge — asserted per group, with the backer group asserted against
  `mid + backerLane` instead, so the deliberate divergence documented above is
  pinned rather than discovered;
- the one the feature exists for: place a receiver wide, run `answerOffense` with
  `adapt:back:width` at 1, and the corner paired with him has moved with him;
- a flanker off the line drags his corner deeper (`adapt:back:depth` at 1);
- every spot `answerOffense` writes passes `spotFault`, extending the invariant
  sweep already in `test/game/learned/formation.test.js` to the adapted look and
  to both sub packages;
- `learnedPersonnel` with hand-set weights returns nickel and dime for the looks
  that should draw them, and the resulting board has the right bodies on it;
- `isLearnedDefense` holds for `'7-nickel'` and `'7-dime'` and still does not
  hold for `'11'`;
- `answerOffense` returns false and writes nothing in hot-seat, under the smart
  and basic brains, and when the human coaches defense.

## Retraining

`npm run train:coevolve` after the mechanism lands, and the regenerated
`lib/game/learned/defense-genome.js` is committed as part of this work.

Until that retrain, the game plays exactly as it does today. That is what
`init: 0` buys and it is not a defect — but it does mean the feature is not
finished when the tests are green. A run whose genome still shows every
`adapt:*` at or near 0 is a real result worth reading rather than a failure to
hide: it would say the adaptation does not pay against the co-evolving offense,
and that is worth knowing before anyone tunes further.

## Non-goals

- **The `smart` and `basic` brains.** They already answer the formation through
  `alignDefense` and are not touched. They do not sub personnel either, and this
  design does not give them that — the substitution decision is a genome, and
  they do not have one.
- **The learned offense.** It has the mirror-image limitation (fixed genome
  spots that never answer the defense's look) and the mirror-image fix is
  plausible, but it is a separate feature with its own spec.
- **Depth adaptation that genuinely reads the offense** for the front, backers
  and deep man. Their answer-depths are constants; making them read the offense
  (crowding a heavy set, backing off an empty one) is a further step this design
  leaves open.
- **Closing the kickoff gap.** See "The one gap this leaves".
- **Mid-down substitution.** `setPersonnel`'s `canReposition` gate stands: you
  sub before the snap, not after it.
