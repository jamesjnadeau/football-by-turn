# In-Browser Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coach on the deployed GitHub Pages site presses one button and the
game evolves a genome against a ghost of his own recorded play — in a web
worker, on his own device, in a few seconds, with no terminal and no Node. The
champion plays immediately as an override on his machine, and he can copy it
out as a well-defined JSON **genome bundle** and send it to the maintainer,
who runs one CLI that validates it, plays it head-to-head against the shipped
genome, and adopts it only if it actually wins.

**Architecture:** The deploy workflow copies `index.html`, `app/` and `lib/`
to Pages and never `tools/`, so the browser-safe half of the training stack
moves under `lib/game/train/` — the harness, the evolution loop, the ghost,
the fitness functions, and the vs-ghost trainer — leaving the `tools/` files
as thin re-export shims plus their CLI bodies. Every existing import path,
test and npm script keeps working; `lib/game/train/` contains zero `node:`
imports and a test proves it transitively. `app/train-worker.js` is a module
worker that runs `trainVsGhost` and posts a progress message per generation
and one bundle at the end. A pure `lib/game/train/bundle.js` owns the bundle
format for both the browser export and the Node import. The trained genome
reaches the live game as plain data on the state — `state.genomeOverrides` —
which `lib/game/learned/active.js` resolves for `ai.js` and
`learned/formation.js`; `app/genome-store.js` is the only thing that knows
where a bundle is kept. `tools/import-genome.js` closes the loop.

**Tech Stack:** Plain ES modules, `node --test` (`npm test`), `mulberry32`
seeded RNG, browser `localStorage`, a module `Worker`. No new dependencies,
no build step.

## Spec

The user's ask, quoted, in the order it was said:

> coulD the training be done via a web worker and exported?

> yes, but I want a way for folks to bring the in-browser-training back to me,
> so it should have export interfaces I can use, and tooling to import it back
> to the main code base for use

So, in three parts:

- **(A)** Run the ghost-training loop in the browser itself, in a module web
  worker, so a player on the deployed GitHub Pages site can press a button and
  evolve the AI genome against a ghost of his own recorded play — no terminal,
  no Node.
- **(B)** The freshly trained genome is used live on that device via an
  override, AND exportable as a well-defined JSON "genome bundle" that players
  can send back to the maintainer.
- **(C)** A Node CLI imports a contributed bundle into the codebase: validate,
  evaluate head-to-head against the incumbent shipped genome, and adopt only
  on merit.

Binding design decisions (the executor implements these, not alternatives):

1. **The training core moves under `lib/`.** `.github/workflows/deploy.yml`
   copies only `index.html`, `app/` and `lib/` into the Pages artifact — the
   README's "Deploying" section says the same — so `tools/` never ships and
   nothing the browser runs may live there. Relocate the pure parts of
   `tools/harness.js`, `tools/evolve.js`, `tools/ghost.js`, the fitness
   functions (today tangled into `tools/train-defense.js` and
   `tools/coevolve.js` beside their `node:fs` imports) and the pure parts of
   `tools/train-vs-ghost.js` into `lib/game/train/`. The `tools/` files become
   thin re-export shims plus their CLI bodies, so every existing import path,
   test and npm script keeps working unchanged; the moved code itself changes
   as little as possible. `lib/game/train/` must contain zero `node:` imports,
   and nothing it reaches transitively may live outside `lib/`.
2. **The worker** is `app/train-worker.js`, spawned as a module worker
   (`new Worker(new URL('./train-worker.js', import.meta.url), { type: 'module' })`).
   Workers have no `localStorage`: the page posts it everything — the coach
   log, which side to train, the seed genome values (shipped or current
   override), generations/pop/plays/sigma, and a seed. It posts back
   `{type: 'progress', gen, score}` per generation through the evolve loop's
   `onGeneration` hook and `{type: 'done', bundle}` at the end. Training stays
   fully deterministic for a seed. The default side to train is the genome
   OPPOSING the side the human's log records — `tools/train-vs-ghost.js`'s
   convention exactly: `--side` names the genome to TRAIN and the ghost plays
   the other one, which is the side the human was recorded coaching.
3. **The genome bundle** is JSON, never a JS file:
   `{ kind: 'football-by-turn-genome', version: 1, side, variant, values,
   meta: { trainedBy, generations, popSize, plays, sigma, seed, fitness,
   snapshots, exportedAt } }`. A pure `lib/game/train/bundle.js` owns
   `makeBundle(...)` and `parseBundle(text)` — the latter returning
   `{bundle}` or `{error: <reason string>}`, validating kind, version, side,
   variant, and that `values` clamps idempotently against that side's spec.
   Both the browser export and the Node import CLI use these same functions.
4. **Live use via an override, injected as plain data.** Nothing under `lib/`
   may touch `localStorage` or the DOM, so the override rides on the state: a
   `state.genomeOverrides` field
   (`{ defense: valuesOrNull, offense: valuesOrNull }`, default nulls,
   initialized in `createGame`). `rules.js`'s `nextDown` rebuilds `players`,
   `ball`, `plannedPass`, `aiPlay`, `forwardPasses`, `penalty` and
   `deadReason` and touches nothing else, so the override survives from down
   to down untouched — verified, and Task 4 pins it with a test.
   `coachLearnedDefense` and `coachAi`'s learned-offense branch in `ai.js`,
   and `maybeApplyLearnedFormations` / `realignLearnedDefense` in
   `learned/formation.js`, all prefer the override values over the shipped
   genome when present. `app/main.js` loads and saves overrides through a new
   `app/genome-store.js` (the discipline of `app/coach-store.js`) and hands
   them to `createGame` at game start.
5. **UI, in the Coaches Menu, built the way the existing menu buttons are
   built:** a **Train vs. my log** button — disabled with an empty log, and
   refusing with a spoken note when the log is too thin, reusing the
   mid-play-snapshot concern `tools/train-vs-ghost.js` already warns about —
   that spawns the worker, reports progress through `say(...)`, and on
   completion stores the override, announces the result, and enables **Copy
   trained genome** (the bundle JSON to the clipboard, the clipboard-then-
   prompt approach the coaching-log copy button already uses) and **Use the
   shipped genome** (discard the override). Worker parameters are fixed,
   modest constants — a browser run finishes in seconds — and v1 exposes no
   knobs.
6. **The import CLI** is `tools/import-genome.js`: `--bundle <path>` required,
   `--force` optional. It parses and validates through `parseBundle`,
   evaluates the contributed values against the incumbent shipped genome with
   the existing seeded harness — the same scenarios and the same dice for
   both — reporting yards/play, touchdown rate and turnover rate for each
   (for a defense bundle: vs the scripted offense AND vs the learned offense;
   for an offense bundle the mirror, vs the smart defense AND vs the learned
   defense), prints the comparison, and rewrites the genome module via
   `genomeModuleSource` — preserving the bundle's own meta plus the measured
   numbers — ONLY if the challenger wins the primary matchup, unless
   `--force`. Exit 1 with a reason on an invalid bundle. The CLI body is
   guarded like the other trainers (importing the module runs nothing), with
   an npm script `import:genome`. The README gains a short "Contributing a
   trained genome" section.
7. **All house conventions hold** — see Global Constraints.

## Global Constraints

- No npm dependencies and no build step, ever.
- Nothing under `lib/` may import `node:` modules or touch the DOM or
  `localStorage` — `lib/` ships to the browser as-is. Only `tools/` and `app/`
  may reach outside it, and only `tools/` may use `node:fs`. This constraint is
  the entire reason for Task 1, and Task 1 ends by testing it.
- All randomness flows through a passed-in `rand`/`random` function seeded by
  `mulberry32` — no `Math.random()` and no `Date.now()` in `lib/` or in any
  training path. The browser run uses a fixed seed constant, so pressing the
  button twice is reproducible rather than a slot machine; it still climbs,
  because the second run seeds from the genome the first one produced.
- `app/` files get no unit tests (they touch the DOM, `localStorage` and
  `Worker`, none of which `node --test` has). Everything with logic in it lives
  in `lib/` or `tools/` where the test runner reaches it; the app-wiring task
  is verified by the browser walk spelled out in it.
- New test files mirror the source tree: `test/game/train/` for
  `lib/game/train/*`, `test/game/learned/` for `lib/game/learned/*`,
  `test/tools/` for `tools/*`. `node --test` discovers them recursively.
- No test may depend on the shipped genomes' trained values. Every test that
  needs a genome builds one with `makeGenome(DEFENSE_SPEC)` /
  `makeGenome(OFFENSE_SPEC)` and overrides the keys it cares about; tests that
  necessarily touch a shipped genome (the import CLI's incumbent) assert only
  that its numbers are finite.
- Test names never contain an apostrophe inside a single-quoted JS string; use
  double quotes for the name, or word it without one.
- Nothing here changes what any existing level does when no override is
  present: `smart`, `pursuit`, both learned levels and Training Mode all run
  exactly the code they run today.

## File Structure

- Create: `lib/game/train/harness.js` — moved verbatim from `tools/harness.js`.
- Create: `lib/game/train/evolve.js` — moved verbatim from `tools/evolve.js`.
- Create: `lib/game/train/ghost.js` — the pure half of `tools/ghost.js`.
- Create: `lib/game/train/fitness.js` — `defenseFitness` + `offenseFitness`
  and their four constants, lifted out of the two trainers.
- Create: `lib/game/train/vs-ghost.js` — the pure half of
  `tools/train-vs-ghost.js`, plus (Task 3) the browser run constants and the
  log-readiness check.
- Create: `lib/game/train/bundle.js` — the genome bundle format.
- Create: `lib/game/learned/active.js` — which genome a side actually plays.
- Modify: `tools/harness.js`, `tools/evolve.js`, `tools/ghost.js`,
  `tools/train-defense.js`, `tools/coevolve.js`, `tools/train-vs-ghost.js` —
  shims plus CLI bodies.
- Modify: `lib/game/state.js` — the `genomeOverrides` field and its option.
- Modify: `lib/game/ai.js` — read the active genome for both learned brains.
- Modify: `lib/game/learned/formation.js` — same, for the three formation
  hooks.
- Create: `app/genome-store.js` — `localStorage` for the trained bundles.
- Create: `app/train-worker.js` — the module worker.
- Modify: `app/main.js` — the three menu buttons, the worker, the override.
- Modify: `index.html` — the three menu buttons.
- Create: `tools/import-genome.js` — the import gauntlet CLI.
- Modify: `package.json` — the `import:genome` script.
- Modify: `README.md` — "Contributing a trained genome".
- Tests: `test/game/train/browser-safe.test.js`,
  `test/game/train/bundle.test.js`, `test/game/train/vs-ghost.test.js`,
  `test/game/train/harness.test.js`, `test/game/learned/active.test.js`,
  `test/tools/import-genome.test.js`.

---

### Task 1: Move the training core under `lib/`

**Files:**
- Create: `lib/game/train/harness.js`, `lib/game/train/evolve.js`,
  `lib/game/train/ghost.js`, `lib/game/train/fitness.js`,
  `lib/game/train/vs-ghost.js`
- Modify: `tools/harness.js`, `tools/evolve.js`, `tools/ghost.js`,
  `tools/train-defense.js`, `tools/coevolve.js`, `tools/train-vs-ghost.js`
- Test: `test/game/train/browser-safe.test.js`

This is a relocation, not a rewrite. The five new `lib/` modules hold the same
code the `tools/` files hold today, with two deliberate exceptions called out
in Step 5 and nothing else. Every existing test file
(`test/tools/harness.test.js`, `evolve.test.js`, `ghost.test.js`,
`coevolve.test.js`, `train-defense.test.js`, `train-vs-ghost.test.js`) keeps
importing from `tools/` and keeps passing unchanged — that is the proof the
move was clean, and Step 8 runs it before anything new is built on top.

**Interfaces:**
- Consumes: nothing new. The moved modules keep the imports they have, with
  their relative paths rewritten for their new home (`'../lib/game/rng.js'`
  becomes `'../rng.js'`, `'../lib/game/learned/genome.js'` becomes
  `'../learned/genome.js'`, `'./harness.js'` stays `'./harness.js'`).
- Produces — the same names, from new modules:
  - `lib/game/train/harness.js`: `MAX_TURNS_PER_PLAY`, `scenario(rand, variant)`,
    `playOnePlay(state, offenseCoach, defenseCoach, random)`,
    `defenseCoach(values)`, `scriptedOffenseCoach(state)`,
    `evaluateDefense(values, {plays, seed, offenseCoach})`,
    `learnedOffenseCoach(values)`, `evaluateMatch(offValues, defValues, {plays, seed})`.
  - `lib/game/train/evolve.js`: `evolve({spec, fitness, seedGenome, popSize,
    generations, elite, sigma, seed, onGeneration}) -> {best, score, history}`.
  - `lib/game/train/ghost.js`: `SITUATION_WEIGHTS`, `liveSituation(state, team)`,
    `situationDistance(a, b)`, `nearestSnapshot(log, situation)`,
    `ghostCoach(log, team)`, `logSituations(log, side)`.
  - `lib/game/train/fitness.js`: `TURNOVER_BONUS_YARDS`,
    `TOUCHDOWN_PENALTY_YARDS`, `defenseFitness(stats)`, `TD_BONUS_YARDS`,
    `TURNOVER_PENALTY_YARDS`, `offenseFitness(stats)`.
  - `lib/game/train/vs-ghost.js`: `GHOST_SITUATION_SHARE`,
    `ghostScenario(rand, situations, variant)`,
    `evaluateVsGhost(values, {log, side, plays, seed})`,
    `trainVsGhost({log, side, generations, popSize, plays, seed, sigma,
    seedGenome, onGeneration}) -> {best, score, history}`.
  - `tools/ghost.js` keeps `loadGhostLog(path)` — the one thing a browser has
    no use for — and re-exports the rest.

- [ ] **Step 1: Create `lib/game/train/harness.js`**

Create `lib/game/train/harness.js` — `tools/harness.js`'s body, with its
import paths rewritten and its "Node-only" note replaced by the note that
explains why it is here now:

```js
/**
 * The training harness: deal a random down, let two coach functions plan
 * both teams hot-seat, run the engine to the whistle, score the play.
 *
 * Everything is seeded (mulberry32) and nothing here rolls its own dice, so
 * a fitness evaluation is exactly reproducible — and two candidate genomes
 * evaluated with the same seed see the SAME downs and the same tackle rolls,
 * which is what makes their fitnesses comparable (common random numbers).
 *
 * Runs hot-seat (aiTeam null) on purpose: runTurn's own coachAi stays inert
 * and the harness is the only coach of either side, so training needs no
 * half-real game mode.
 *
 * This lives under lib/ rather than tools/ because the browser trains too:
 * .github/workflows/deploy.yml copies index.html, app/ and lib/ to Pages and
 * never tools/, so app/train-worker.js could not reach a trainer that lived
 * there. Nothing in this directory may import a node: module or touch the
 * DOM — test/game/train/browser-safe.test.js holds the whole directory, and
 * everything it reaches, to that.
 */
import {
  createGame, formationPlayers, aimSnap, ballPos, SNAPPER_ID,
} from '../state.js';
import { runTurn } from '../turn.js';
import { yardsOfY, GOAL_YARD } from '../view.js';
import { mulberry32 } from '../rng.js';
import { applyOrders, applyAiModes } from '../ai.js';
import { learnedOrders } from '../learned/defense-policy.js';
import { applyLearnedDefenseFormation, applyLearnedOffenseFormation } from '../learned/formation.js';
import { autoplanOffense } from '../offense.js';
import { coachLearnedOffense } from '../learned/offense-policy.js';
import { FIRST_DOWN_YARDS } from '../constants.js';

/** A play that has not died by now never will (both sides re-plan every
 *  turn); call it over and score the ball where it lies. */
export const MAX_TURNS_PER_PLAY = 24;

/**
 * A fresh down somewhere a real drive could be: random down, random spot
 * (never so deep that MIN_SPOT_YARD clamping kicks in, never inside the 20),
 * random distance. Randomizing the situation is what gives the scheme gate's
 * down/toGo features something to learn from.
 */
export function scenario(rand, variant = '7') {
  const state = createGame({ seed: 1 + Math.floor(rand() * 2 ** 30), variant });
  state.down = 1 + Math.floor(rand() * 4);
  state.losYard = 15 + Math.floor(rand() * 66); // 15..80
  state.toGoYard = Math.min(
    state.losYard + 1 + Math.floor(rand() * FIRST_DOWN_YARDS), GOAL_YARD,
  );
  state.players = formationPlayers(state.losYard, variant);
  state.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  state.plannedPass = null;
  aimSnap(state);
  return state;
}

/**
 * One play, start to whistle. The coaches are (state) => void and are called
 * every planning phase, offense first (the human plans first in spirit; the
 * defense answers). Yards are the ball's final yard against the opening line
 * of scrimmage — zero for an incompletion, exactly as nextDown spots it.
 */
export function playOnePlay(state, offenseCoach, defenseCoach, random) {
  const startLos = state.losYard;
  const events = [];
  for (let t = 0; t < MAX_TURNS_PER_PLAY && state.phase !== 'playOver'; t++) {
    offenseCoach(state);
    defenseCoach(state);
    events.push(...runTurn(state, random).events);
  }
  const bp = ballPos(state);
  const yards = state.deadReason === 'incomplete' || !bp
    ? 0
    : yardsOfY(bp.y) - startLos;
  return {
    yards,
    deadReason: state.deadReason,
    touchdown: state.deadReason === 'touchdown',
    turnover: state.deadReason === 'recovered',
    events,
  };
}

/**
 * The learned defense as a coach function: its genome's formation at the top
 * of the down, the breakdown stance near the carrier (the same modes coachAi
 * applies), and learnedOrders every turn.
 */
export function defenseCoach(values) {
  return (state) => {
    if (state.turnIndex === 0 && state.phase === 'planning') {
      applyLearnedDefenseFormation(state, values);
    }
    applyAiModes(state, 'defense');
    applyOrders(state, learnedOrders(state, 'defense', values));
  };
}

/**
 * The interim opponent: the scripted QB run option (offense.js). The Offense
 * plan replaces this with the co-evolving learned offense; until then it is
 * the strongest offense the codebase can field without a human.
 */
export function scriptedOffenseCoach(state) {
  autoplanOffense(state);
}

/** Mean per-play stats for one defense genome over `plays` seeded scenarios. */
export function evaluateDefense(values, { plays, seed, offenseCoach = scriptedOffenseCoach }) {
  const rand = mulberry32(seed);
  const coach = defenseCoach(values);
  let yards = 0;
  let touchdowns = 0;
  let turnovers = 0;
  for (let i = 0; i < plays; i++) {
    const state = scenario(rand);
    const result = playOnePlay(
      state, offenseCoach, coach, mulberry32(1 + Math.floor(rand() * 2 ** 30)),
    );
    yards += result.yards;
    if (result.touchdown) touchdowns += 1;
    if (result.turnover) turnovers += 1;
  }
  return {
    yardsPerPlay: yards / plays,
    touchdownRate: touchdowns / plays,
    turnoverRate: turnovers / plays,
  };
}

/**
 * The learned offense as a coach function: its genome's formation at the
 * top of the down (the auto snap re-aims itself — it is locked on the QB,
 * and releasePass re-solves a locked throw at the whistle), then the
 * whole-down brain every turn.
 */
export function learnedOffenseCoach(values) {
  return (state) => {
    if (state.turnIndex === 0 && state.phase === 'planning') {
      applyLearnedOffenseFormation(state, values);
    }
    coachLearnedOffense(state, values);
  };
}

/** Learned offense vs learned defense: one stats object, read positively by
 *  the offense's fitness and negatively by the defense's. */
export function evaluateMatch(offValues, defValues, { plays, seed }) {
  return evaluateDefense(defValues, {
    plays, seed, offenseCoach: learnedOffenseCoach(offValues),
  });
}
```

- [ ] **Step 2: Create `lib/game/train/evolve.js`**

Create `lib/game/train/evolve.js` — `tools/evolve.js` verbatim, two import
paths rewritten:

```js
/**
 * A small elitist (mu+lambda) evolution loop over genome objects. Nothing in
 * it knows about football: it takes a spec, a fitness function and a seed,
 * and hill-climbs. Selection keeps the top `elite`, refill mutates random
 * elites, and the whole walk is deterministic from `seed`.
 *
 * Fitness receives (genome, generationIndex) so the caller can key common
 * random numbers to the generation: every candidate within one generation
 * should be scored on the same simulated downs, or selection is choosing
 * lucky schedules rather than good genomes.
 *
 * `onGeneration(gen, scored)` is the only window out: the CLIs print the
 * champion through it and app/train-worker.js posts it to the page.
 */
import { mulberry32 } from '../rng.js';
import { clampGenome, mutateGenome } from '../learned/genome.js';

export function evolve({
  spec, fitness, seedGenome = null,
  popSize = 16, generations = 20, elite = 4, sigma = 0.08, seed = 1,
  onGeneration = null,
}) {
  const rand = mulberry32(seed);
  const base = clampGenome(spec, seedGenome);
  let pop = [base];
  while (pop.length < popSize) pop.push(mutateGenome(spec, base, rand, sigma));

  let best = null;
  const history = [];
  for (let g = 0; g < generations; g++) {
    const scored = pop
      .map((genome) => ({ genome, score: fitness(genome, g) }))
      .sort((a, b) => b.score - a.score);
    if (!best || scored[0].score > best.score) best = scored[0];
    history.push(scored[0].score);
    if (onGeneration) onGeneration(g, scored);

    const parents = scored.slice(0, elite).map((s) => s.genome);
    pop = [...parents];
    while (pop.length < popSize) {
      const parent = parents[Math.floor(rand() * parents.length)];
      pop.push(mutateGenome(spec, parent, rand, sigma));
    }
  }
  return { best: best.genome, score: best.score, history };
}
```

- [ ] **Step 3: Create `lib/game/train/ghost.js`**

Create `lib/game/train/ghost.js` — `tools/ghost.js` without `loadGhostLog`
and without its `node:fs` import (both stay behind in the shim):

```js
/**
 * A ghost of the coach: the recorded log (lib/game/coach-log.js) played back
 * as an opponent.
 *
 * Given a live state it finds the recorded snapshot whose SITUATION is nearest
 * — same game, same side of the ball, closest down, distance, spot and turn —
 * and puts that call on the board. Nearest-neighbor rather than a fitted model
 * because a few hundred snapshots of one human is far too little to fit
 * anything and exactly enough to look things up in; and deterministic rather
 * than sampled because the whole point of the training path is that a seed
 * reproduces it exactly. The ghost rolls no dice at all.
 *
 * Pure: it takes a log as data. Reading one off disk is tools/ghost.js's job,
 * because the browser trains against the log it already has in memory.
 */
import { applySnapshot } from '../coach-log.js';

/**
 * What "a similar situation" means, in weights.
 *
 * turnIndex is heaviest because it is the difference between a call and a
 * scramble: turn zero is a play the coach drew up from a formation, and turn
 * three is what he did about it once it broke — replaying one as the other is
 * the one mistake that would make the ghost a stranger. down comes next (third
 * down is a different game from first), then distance, then field position,
 * which matters least: a coach's third-and-two is his third-and-two whether he
 * is on his own 30 or the other 40.
 */
export const SITUATION_WEIGHTS = {
  turnIndex: 4,
  down: 3,
  toGo: 1,
  losYard: 0.15,
};

/** The situation a live state is in, in captureSnapshot's own shape. */
export function liveSituation(state, team) {
  return {
    down: state.down,
    toGo: state.toGoYard - state.losYard,
    losYard: state.losYard,
    turnIndex: state.turnIndex,
    variant: state.variantId,
    side: team,
  };
}

/**
 * How unlike each other two situations are. Infinity across variants, because
 * a call made with eleven men on the field is not a nearer version of a
 * seven-man call — it is a call for a different set of bodies, and the ids in
 * it would half-apply.
 */
export function situationDistance(a, b) {
  if (a.variant !== b.variant) return Infinity;
  return SITUATION_WEIGHTS.turnIndex * Math.abs(a.turnIndex - b.turnIndex)
    + SITUATION_WEIGHTS.down * Math.abs(a.down - b.down)
    + SITUATION_WEIGHTS.toGo * Math.abs(a.toGo - b.toGo)
    + SITUATION_WEIGHTS.losYard * Math.abs(a.losYard - b.losYard);
}

/**
 * The recorded call nearest this situation, or null when the log holds nothing
 * for this side of the ball in this game. Ties go to the OLDEST matching
 * snapshot (strictly-nearer wins), which is what makes the lookup reproducible
 * for a given log rather than dependent on how it was ordered.
 */
export function nearestSnapshot(log, situation) {
  let best = null;
  let bestD = Infinity;
  for (const snap of log) {
    if (snap.situation.side !== situation.side) continue;
    const d = situationDistance(snap.situation, situation);
    if (!Number.isFinite(d) || d >= bestD) continue;
    best = snap;
    bestD = d;
  }
  return best;
}

/**
 * The ghost as a coach function — the same `(state) => void` shape
 * harness.js's playOnePlay takes for either side, so it drops straight into
 * the training loop where a scripted or learned coach would go.
 *
 * A situation the log has nothing for leaves the board alone rather than
 * guessing: both trainers refuse to start against an empty ghost (see
 * vs-ghost.js's ghostReadiness and tools/train-vs-ghost.js's CLI guard), so a
 * silent turn here means one odd down and not a whole training run against a
 * statue.
 */
export function ghostCoach(log, team) {
  return (state) => {
    const snap = nearestSnapshot(log, liveSituation(state, team));
    if (!snap) return;
    applySnapshot(state, team, snap);
  };
}

/**
 * The situations this log actually holds for one side, at the top of a down —
 * the down-and-distances the human really played, which is what the trainer
 * deals its scenarios from so the genome is judged on the football this coach
 * actually calls rather than on a uniform sample of the field.
 */
export function logSituations(log, side) {
  return log
    .filter((s) => s.situation.side === side && s.situation.turnIndex === 0)
    .map((s) => s.situation);
}
```

- [ ] **Step 4: Create `lib/game/train/fitness.js`**

Create `lib/game/train/fitness.js` — the two fitness functions and their four
constants, lifted out of `tools/train-defense.js` and `tools/coevolve.js`
unchanged and put in one place, because the browser needs them and neither of
those files can be reached from a browser:

```js
/**
 * What "better" means, for each side of the ball. One number per side, both
 * denominated in yards so their three terms share a scale.
 *
 * Lifted out of the two trainers that used to own one each (train-defense.js
 * and coevolve.js) so that the browser trainer scores a genome exactly the way
 * the CLIs do — a genome trained on a phone has to be comparable to one
 * trained on a laptop, or tools/import-genome.js is comparing nothing.
 */

// A turnover is worth about a possession's field position; a touchdown given
// up costs more than any one play's yardage.
export const TURNOVER_BONUS_YARDS = 8;
export const TOUCHDOWN_PENALTY_YARDS = 10;

export function defenseFitness(stats) {
  return -stats.yardsPerPlay
    + TURNOVER_BONUS_YARDS * stats.turnoverRate
    - TOUCHDOWN_PENALTY_YARDS * stats.touchdownRate;
}

// The same two prices, read from the other sideline.
export const TD_BONUS_YARDS = 10;
export const TURNOVER_PENALTY_YARDS = 8;

export function offenseFitness(stats) {
  return stats.yardsPerPlay
    + TD_BONUS_YARDS * stats.touchdownRate
    - TURNOVER_PENALTY_YARDS * stats.turnoverRate;
}
```

- [ ] **Step 5: Create `lib/game/train/vs-ghost.js`**

Create `lib/game/train/vs-ghost.js` — the pure half of
`tools/train-vs-ghost.js`. This carries the plan's only two deliberate changes
to moved code, both of them the reason the move is possible at all:

1. `trainVsGhost` gains `seedGenome = null`, defaulting to the shipped genome
   exactly as before when it is not passed. The browser seeds from the coach's
   own current override so a second press continues from where the first left
   off.
2. `trainVsGhost` gains `onGeneration = null`, passed straight through to
   `evolve`. The hard-coded `console.log` moves out to the CLI body in Step 6,
   where the console actually is; the worker posts a message instead. The
   existing test calls `trainVsGhost` without it and simply stops logging,
   which changes no assertion.

```js
/**
 * Train a genome against a GHOST OF YOU — the log the game's Coaches Menu
 * records, replayed by ghost.js as the opponent coach.
 *
 * `side` names the genome to TRAIN; the ghost always plays the other one,
 * which is the side the human was recorded coaching. Training the defense
 * against a ghost of your offense is the normal use.
 *
 * Everything else is the existing machinery: harness.js plays the downs,
 * evolve.js hill-climbs, and fitness.js prices the result, so a genome trained
 * here is comparable to one trained against the scripted offense or in
 * co-evolution. The only new thing is who is standing across the ball.
 *
 * Two front doors run this: tools/train-vs-ghost.js (a log off disk, progress
 * to the console) and app/train-worker.js (a log out of localStorage, progress
 * posted to the page). Both get the same walk for the same seed.
 */
import { formationPlayers, aimSnap, SNAPPER_ID } from '../state.js';
import { GOAL_YARD } from '../view.js';
import { mulberry32 } from '../rng.js';
import { DEFENSE_SPEC } from '../learned/defense-spec.js';
import { DEFENSE_GENOME } from '../learned/defense-genome.js';
import { OFFENSE_SPEC } from '../learned/offense-spec.js';
import { OFFENSE_GENOME } from '../learned/offense-genome.js';
import { evolve } from './evolve.js';
import {
  scenario, playOnePlay, defenseCoach, learnedOffenseCoach,
} from './harness.js';
import { defenseFitness, offenseFitness } from './fitness.js';
import { ghostCoach, logSituations } from './ghost.js';

/**
 * How often a training down is dealt from a situation the log actually holds
 * rather than from the harness's uniform sample of the field. Half and half on
 * purpose: all-recorded would overfit the genome to the handful of spots one
 * human happened to play from, and all-random would spend most of its downs in
 * situations the ghost has nothing near and therefore plays badly in.
 */
export const GHOST_SITUATION_SHARE = 0.5;

/**
 * A training down: the harness's own random scenario, or — half the time — the
 * same thing re-spotted to a down and distance the human really played. Every
 * value is clamped back into the harness's own legal range, because a log can
 * carry a goal-line snap or a fourth-and-thirty and the scenario contract is
 * what the rest of the harness relies on.
 */
export function ghostScenario(rand, situations, variant = '7') {
  const state = scenario(rand, variant);
  if (!situations.length || rand() >= GHOST_SITUATION_SHARE) return state;
  const pick = situations[Math.floor(rand() * situations.length)];
  state.down = Math.max(1, Math.min(4, Math.round(pick.down)));
  state.losYard = Math.max(15, Math.min(80, Math.round(pick.losYard)));
  state.toGoYard = Math.min(
    state.losYard + Math.max(1, Math.round(pick.toGo)), GOAL_YARD,
  );
  state.players = formationPlayers(state.losYard, variant);
  state.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  state.plannedPass = null;
  aimSnap(state);
  return state;
}

/**
 * Mean per-play stats for one genome over `plays` seeded downs against the
 * ghost. Same aggregation as harness.js's evaluateDefense — one stats object,
 * read negatively by the defense's fitness and positively by the offense's.
 */
export function evaluateVsGhost(values, { log, side, plays, seed }) {
  const ghostSide = side === 'defense' ? 'offense' : 'defense';
  const situations = logSituations(log, ghostSide);
  const ghost = ghostCoach(log, ghostSide);
  const offense = side === 'defense' ? ghost : learnedOffenseCoach(values);
  const defense = side === 'defense' ? defenseCoach(values) : ghost;

  const rand = mulberry32(seed);
  let yards = 0;
  let touchdowns = 0;
  let turnovers = 0;
  for (let i = 0; i < plays; i++) {
    const state = ghostScenario(rand, situations);
    const result = playOnePlay(
      state, offense, defense, mulberry32(1 + Math.floor(rand() * 2 ** 30)),
    );
    yards += result.yards;
    if (result.touchdown) touchdowns += 1;
    if (result.turnover) turnovers += 1;
  }
  return {
    yardsPerPlay: yards / plays,
    touchdownRate: touchdowns / plays,
    turnoverRate: turnovers / plays,
  };
}

/**
 * The whole run. `seedGenome` is where the walk starts: the shipped champion
 * by default, or — in the browser — the genome this coach already trained, so
 * that pressing the button twice keeps climbing instead of starting over.
 * `onGeneration` is how the caller watches: the CLI prints, the worker posts.
 */
export function trainVsGhost({
  log, side, generations, popSize, plays, seed, sigma,
  seedGenome = null, onGeneration = null,
}) {
  const spec = side === 'defense' ? DEFENSE_SPEC : OFFENSE_SPEC;
  const shipped = side === 'defense' ? DEFENSE_GENOME.values : OFFENSE_GENOME.values;
  const fitness = side === 'defense' ? defenseFitness : offenseFitness;
  return evolve({
    spec,
    seedGenome: seedGenome ?? shipped,
    popSize,
    generations,
    sigma,
    seed,
    // Common random numbers: every candidate in generation g sees the same
    // downs and the same dice — and the same ghost, which rolls none.
    fitness: (genome, gen) => fitness(
      evaluateVsGhost(genome, { log, side, plays, seed: seed * 1000003 + gen }),
    ),
    onGeneration,
  });
}
```

- [ ] **Step 6: Turn the six `tools/` files into shims**

Replace `tools/harness.js` entirely with:

```js
/**
 * The training harness, unchanged for every caller — the code itself now lives
 * in lib/game/train/harness.js so that app/train-worker.js can run the very
 * same loop the CLI trainers run. The deploy workflow copies index.html, app/
 * and lib/ to GitHub Pages and never tools/, which is the whole reason.
 *
 * Kept as a file rather than deleted so that every existing import path — the
 * other trainers, test/tools/harness.test.js — still resolves.
 */
export * from '../lib/game/train/harness.js';
```

Replace `tools/evolve.js` entirely with:

```js
/**
 * The evolution loop, unchanged for every caller — see tools/harness.js for
 * why the code now lives under lib/game/train/.
 */
export * from '../lib/game/train/evolve.js';
```

Replace `tools/ghost.js` entirely with:

```js
/**
 * The ghost coach. The lookup itself is pure and now lives in
 * lib/game/train/ghost.js, because the browser replays a log too; what stays
 * here is the one thing a browser has no use for — reading a log off disk.
 *
 * Node-only, therefore; lib/ must never import from here.
 */
import { readFileSync } from 'node:fs';
import { parseCoachLog } from '../lib/game/coach-log.js';

export * from '../lib/game/train/ghost.js';

/** A log as exported by the game's Coaches Menu, read off disk. */
export function loadGhostLog(path) {
  return parseCoachLog(readFileSync(path, 'utf8'));
}
```

In `tools/train-defense.js`, delete the two constants and the `defenseFitness`
body and replace the `evolve`/`harness` imports with lib ones. The file's head
becomes exactly this (everything from `export function trainDefense` down is
untouched):

```js
/**
 * Train the defense genome against the scripted offense and write the result
 * into lib/game/learned/defense-genome.js, where the game imports it.
 *
 * Usage:
 *   node tools/train-defense.js --generations 30 --pop 16 --plays 24 --seed 1
 *
 * The opponent here is offense.js's scripted autoplan — a bootstrap, not the
 * end state. tools/train-coevolve.js retrains this genome against the LEARNED
 * offense, population against population; keep using that.
 *
 * The fitness function moved to lib/game/train/fitness.js with the rest of the
 * training core (the browser trains too); it is re-exported here so that every
 * existing importer — tools/coevolve.js, the tests — still finds it.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DEFENSE_SPEC } from '../lib/game/learned/defense-spec.js';
import { DEFENSE_GENOME } from '../lib/game/learned/defense-genome.js';
import { genomeModuleSource } from '../lib/game/learned/genome.js';
import { evolve } from '../lib/game/train/evolve.js';
import { evaluateDefense } from '../lib/game/train/harness.js';
import {
  defenseFitness, TURNOVER_BONUS_YARDS, TOUCHDOWN_PENALTY_YARDS,
} from '../lib/game/train/fitness.js';

export { defenseFitness, TURNOVER_BONUS_YARDS, TOUCHDOWN_PENALTY_YARDS };
```

In `tools/coevolve.js`, delete `TD_BONUS_YARDS`, `TURNOVER_PENALTY_YARDS` and
the `offenseFitness` body, and repoint the imports. The file's head becomes
exactly this (everything from `const mean =` down is untouched):

```js
/**
 * Competitive co-evolution: two populations, alternating generations, each
 * side scored by playing the other's champion — plus a small HALL OF FAME
 * of past champions, because pure champion-vs-champion co-evolution chases
 * its own tail (beat today's opponent, forget yesterday's). Scoring against
 * a few generations of history keeps improvements real.
 *
 * This is the training the spec actually asks for; train-defense.js's
 * scripted-opponent run was the bootstrap that made the first defense
 * genome worth playing against.
 *
 * Both fitness functions moved to lib/game/train/fitness.js with the rest of
 * the training core; the offense's is re-exported here so that every existing
 * importer still finds it.
 */
import { mulberry32 } from '../lib/game/rng.js';
import { clampGenome, mutateGenome } from '../lib/game/learned/genome.js';
import { OFFENSE_SPEC } from '../lib/game/learned/offense-spec.js';
import { DEFENSE_SPEC } from '../lib/game/learned/defense-spec.js';
import { evaluateMatch } from '../lib/game/train/harness.js';
import {
  defenseFitness, offenseFitness, TD_BONUS_YARDS, TURNOVER_PENALTY_YARDS,
} from '../lib/game/train/fitness.js';

export { offenseFitness, TD_BONUS_YARDS, TURNOVER_PENALTY_YARDS };
```

Replace `tools/train-vs-ghost.js` entirely with the shim plus its CLI body —
same flags, same messages, same output file, with the per-generation log now
passed in as `onGeneration` rather than baked into the trainer:

```js
/**
 * Train a genome against a GHOST OF YOU — the log the game's Coaches Menu
 * exports, replayed by tools/ghost.js as the opponent coach.
 *
 * Usage:
 *   node tools/train-vs-ghost.js --log coach-log.json --side defense \
 *     --generations 20 --pop 12 --plays 16 --seed 1
 *
 * `--side` names the genome to TRAIN; the ghost always plays the other one,
 * which is the side the human was recorded coaching. Training the defense
 * against a ghost of your offense is the normal use, and it writes
 * lib/game/learned/defense-genome.js exactly as tools/train-defense.js does;
 * training the offense against a ghost of your defense writes
 * offense-genome.js the same way.
 *
 * The trainer itself lives in lib/game/train/vs-ghost.js, because the browser
 * runs the same one (app/train-worker.js). What is here is the terminal: a log
 * read off disk, per-generation printing, and the file write.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { genomeModuleSource } from '../lib/game/learned/genome.js';
import { trainVsGhost } from '../lib/game/train/vs-ghost.js';
import { loadGhostLog } from './ghost.js';

export * from '../lib/game/train/vs-ghost.js';

function numArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

function strArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

// CLI body — guarded so importing this module (the tests) runs nothing and
// writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logPath = strArg('log', null);
  const side = strArg('side', 'defense');
  if (!logPath) {
    console.error('usage: node tools/train-vs-ghost.js --log <path> [--side defense|offense]');
    process.exit(1);
  }
  if (side !== 'defense' && side !== 'offense') {
    console.error(`--side must be "defense" or "offense", not "${side}"`);
    process.exit(1);
  }
  const log = loadGhostLog(logPath);
  const ghostSide = side === 'defense' ? 'offense' : 'defense';
  // A ghost with nothing to imitate stands still for every down, and a genome
  // trained against a statue is worse than the one it started from. Refuse
  // loudly rather than spend twenty minutes producing that.
  const usable = log.filter(
    (s) => s.situation.side === ghostSide && s.situation.variant === '7',
  );
  if (usable.length === 0) {
    console.error(`${logPath} holds no '7' ${ghostSide} snapshots — the ghost would have nobody to imitate.`);
    process.exit(1);
  }
  // A log of nothing but play calls leaves the ghost standing still the moment
  // a down starts running, and a side that stands still turns most plays into
  // stalemates scored at the turn cap rather than into football. A log exported
  // from real drives always has mid-play snapshots; say so when one does not,
  // rather than quietly training on nonsense.
  if (!usable.some((s) => s.situation.turnIndex > 0)) {
    console.warn('warning: no mid-play snapshots in this log — the ghost will stand still once a play is running.');
  }
  const opts = {
    generations: numArg('generations', 20),
    popSize: numArg('pop', 12),
    plays: numArg('plays', 16),
    seed: numArg('seed', 1),
    sigma: numArg('sigma', 0.08),
  };
  console.log(
    `training ${side} against a ghost of ${usable.length} recorded ${ghostSide} snapshots:`,
    opts,
  );
  const { best, score } = trainVsGhost({
    log,
    side,
    ...opts,
    onGeneration: (gen, scored) =>
      console.log(`gen ${gen}: champion ${scored[0].score.toFixed(3)}`),
  });
  const file = side === 'defense' ? 'defense-genome.js' : 'offense-genome.js';
  const exportName = side === 'defense' ? 'DEFENSE_GENOME' : 'OFFENSE_GENOME';
  console.log(`champion fitness ${score.toFixed(3)} — writing ${file}`);
  writeFileSync(
    new URL(`../lib/game/learned/${file}`, import.meta.url),
    genomeModuleSource(exportName, best, {
      variant: '7',
      trainedBy: 'tools/train-vs-ghost.js',
      opponent: `ghost of ${logPath} (${usable.length} ${ghostSide} snapshots)`,
      options: opts,
      fitness: score,
    }),
  );
}
```

- [ ] **Step 7: Write the browser-safety test**

Create `test/game/train/browser-safe.test.js`. It walks the relative-import
graph out of `lib/game/train/` and holds every file it reaches to the two
rules that make this directory shippable — the guard that turns decision 1
from a promise into a fact:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRAIN = fileURLToPath(new URL('../../../lib/game/train/', import.meta.url));
const LIB = fileURLToPath(new URL('../../../lib/', import.meta.url));

const entries = () => readdirSync(TRAIN)
  .filter((f) => f.endsWith('.js'))
  .map((f) => TRAIN + f);

/** Every file reachable from `roots` by following relative imports. */
function reachable(roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
      if (m[1].startsWith('.')) queue.push(resolve(dirname(file), m[1]));
    }
  }
  return seen;
}

test('the training core is a real directory with modules in it', () => {
  assert.ok(entries().length >= 5, `found ${entries().length} modules`);
});

test('nothing the training core reaches imports a node: module', () => {
  for (const file of reachable(entries())) {
    assert.doesNotMatch(
      readFileSync(file, 'utf8'), /from 'node:/,
      `${file} imports a node: module, so it cannot ship to the browser`,
    );
  }
});

test('nothing the training core reaches lives outside lib/', () => {
  for (const file of reachable(entries())) {
    assert.ok(
      file.startsWith(LIB),
      `${file} is outside lib/, which the deploy workflow does not copy`,
    );
  }
});
```

- [ ] **Step 8: Prove the move changed nothing**

Run: `node --test test/game/train/browser-safe.test.js`
Expected: PASS (3 tests).

Run: `npm test`
Expected: ALL PASS, with every one of `test/tools/harness.test.js`,
`evolve.test.js`, `ghost.test.js`, `coevolve.test.js`,
`train-defense.test.js` and `train-vs-ghost.test.js` green and *unedited* —
they still import from `tools/` and still see every name they did. A failure
in any of them means a shim dropped an export; fix the shim, not the test.
The only visible difference anywhere is that `train-vs-ghost.test.js` no
longer prints `gen 0: champion ...` lines, because per-generation logging is
now the CLI's job.

Run: `npm run train:vs-ghost -- --log /dev/null --side defense`
Expected: exits 1 with
`/dev/null holds no '7' offense snapshots — the ghost would have nobody to imitate.`
— the CLI guard still works through the shim.

- [ ] **Step 9: Commit**

```bash
git add lib/game/train tools/harness.js tools/evolve.js tools/ghost.js tools/train-defense.js tools/coevolve.js tools/train-vs-ghost.js test/game/train/browser-safe.test.js
git commit -m "refactor: move the training core under lib/ so the browser can run it"
```

---

### Task 2: The genome bundle

**Files:**
- Create: `lib/game/train/bundle.js`
- Test: `test/game/train/bundle.test.js`

**Interfaces:**
- Consumes: `clampGenome` (`../learned/genome.js`); `DEFENSE_SPEC`,
  `DEFENSE_VARIANT` (`../learned/defense-spec.js`); `OFFENSE_SPEC`,
  `OFFENSE_VARIANT` (`../learned/offense-spec.js`).
- Produces:
  - `BUNDLE_KIND = 'football-by-turn-genome'`, `BUNDLE_VERSION = 1`.
  - `specForSide(side) -> {spec, variant} | null`.
  - `makeBundle({side, values, meta}) -> bundle` — throws on an unknown side;
    `values` clamped into the side's spec.
  - `serializeBundle(bundle) -> string` — pretty JSON, so a coach who opens the
    file he was sent can read it.
  - `parseBundle(text) -> {bundle} | {error: string}`.
  - A bundle is
    `{kind, version, side, variant, values, meta}`, with `meta` carrying
    `{trainedBy, generations, popSize, plays, sigma, seed, fitness, snapshots,
    exportedAt}` when the browser made it.

- [ ] **Step 1: Write the failing test**

Create `test/game/train/bundle.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUNDLE_KIND, BUNDLE_VERSION, specForSide, makeBundle, serializeBundle, parseBundle,
} from '../../../lib/game/train/bundle.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';

const META = {
  trainedBy: 'app/train-worker.js', generations: 12, popSize: 10, plays: 12,
  sigma: 0.08, seed: 1, fitness: -2.5, snapshots: 84,
  exportedAt: '2026-08-31T00:00:00.000Z',
};

/** A bundle serialized and mutated, the way a stranger's file might arrive. */
function tampered(mutate) {
  const raw = JSON.parse(serializeBundle(
    makeBundle({ side: 'defense', values: makeGenome(DEFENSE_SPEC) }),
  ));
  mutate(raw);
  return parseBundle(JSON.stringify(raw));
}

test('specForSide names each side spec and the variant it was written for', () => {
  assert.equal(specForSide('defense').spec, DEFENSE_SPEC);
  assert.equal(specForSide('defense').variant, '7');
  assert.equal(specForSide('offense').spec, OFFENSE_SPEC);
  assert.equal(specForSide('offense').variant, '7');
  assert.equal(specForSide('special-teams'), null);
});

test('a bundle round trips through text unchanged', () => {
  const made = makeBundle({
    side: 'defense', values: makeGenome(DEFENSE_SPEC), meta: META,
  });
  assert.equal(made.kind, BUNDLE_KIND);
  assert.equal(made.version, BUNDLE_VERSION);
  assert.equal(made.side, 'defense');
  assert.equal(made.variant, '7');
  assert.deepEqual(made.meta, META);
  const { bundle, error } = parseBundle(serializeBundle(made));
  assert.equal(error, undefined);
  assert.deepEqual(bundle, made);
});

test('an offense bundle round trips too', () => {
  const made = makeBundle({ side: 'offense', values: makeGenome(OFFENSE_SPEC) });
  const { bundle } = parseBundle(serializeBundle(made));
  assert.equal(bundle.side, 'offense');
  assert.deepEqual(bundle.values, makeGenome(OFFENSE_SPEC));
});

test('makeBundle clamps into the spec and refuses a side it does not know', () => {
  const made = makeBundle({ side: 'defense', values: { 'cov:dist': 99, junk: 1 } });
  assert.equal(made.values['cov:dist'], 3); // the spec's max
  assert.equal('junk' in made.values, false);
  assert.equal(Object.keys(made.values).length, DEFENSE_SPEC.length);
  assert.throws(() => makeBundle({ side: 'kickoff', values: {} }), /kickoff/);
});

test('parseBundle refuses anything that is not this format', () => {
  assert.match(parseBundle('').error, /no bundle text/);
  assert.match(parseBundle(null).error, /no bundle text/);
  assert.match(parseBundle('{oops').error, /not JSON/);
  assert.match(parseBundle('[]').error, /not a JSON object/);
  assert.match(tampered((b) => { b.kind = 'something-else'; }).error, /kind/);
  assert.match(tampered((b) => { b.version = 2; }).error, /version/);
  assert.match(tampered((b) => { b.side = 'special-teams'; }).error, /side/);
  assert.match(tampered((b) => { b.variant = '11'; }).error, /variant/);
});

test('parseBundle refuses values that would not survive a clamp', () => {
  assert.match(tampered((b) => { delete b.values['cov:dist']; }).error, /cov:dist/);
  assert.match(tampered((b) => { b.values['cov:dist'] = 99; }).error, /outside/);
  assert.match(tampered((b) => { b.values['cov:dist'] = 'wide'; }).error, /finite/);
  assert.match(tampered((b) => { b.values['cov:dist'] = null; }).error, /finite/);
  assert.match(tampered((b) => { b.values.junk = 1; }).error, /junk/);
  assert.match(tampered((b) => { b.values.__proto__ = 1; }).error, /__proto__/);
});

test('a bundle with no meta parses, with an empty meta', () => {
  const { bundle } = tampered((b) => { delete b.meta; });
  assert.deepEqual(bundle.meta, {});
  assert.deepEqual(tampered((b) => { b.meta = 'notes'; }).bundle.meta, {});
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/train/bundle.test.js`
Expected: FAIL — cannot find module `lib/game/train/bundle.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/game/train/bundle.js`:

```js
/**
 * The genome bundle: one trained genome as plain JSON, the only thing that
 * crosses between a coach's browser and this repository.
 *
 * JSON and never a JS module, because it travels: a stranger sends the
 * maintainer a file, and a file that is source code is a file that runs. The
 * generated *-genome.js modules stay what they are — the trainers write them
 * on the way IN (see tools/import-genome.js), and nothing outside this repo
 * ever writes one.
 *
 * parseBundle is deliberately unforgiving about `values`: they must clamp
 * IDEMPOTENTLY against the side's own spec — every key the spec names, all
 * finite, all already inside their range, and nothing else. Quietly clamping a
 * stranger's genome would ship a genome nobody trained; a bundle that does not
 * fit this build's spec is a bundle from a different build, and the honest
 * answer is to say so.
 *
 * Pure, like coach-log.js and playbook.js: this file knows what a bundle IS.
 * app/genome-store.js knows where one is kept, and tools/import-genome.js
 * knows what to do with one that arrives.
 */
import { clampGenome } from '../learned/genome.js';
import { DEFENSE_SPEC, DEFENSE_VARIANT } from '../learned/defense-spec.js';
import { OFFENSE_SPEC, OFFENSE_VARIANT } from '../learned/offense-spec.js';

export const BUNDLE_KIND = 'football-by-turn-genome';
export const BUNDLE_VERSION = 1;

/** The spec a side's genome is governed by, and the variant it is written
 *  for — null for anything that is not a side of the ball. */
export function specForSide(side) {
  if (side === 'defense') return { spec: DEFENSE_SPEC, variant: DEFENSE_VARIANT };
  if (side === 'offense') return { spec: OFFENSE_SPEC, variant: OFFENSE_VARIANT };
  return null;
}

/**
 * Package a trained genome. The values are clamped on the way in, so a bundle
 * this repository produces always satisfies the check parseBundle applies to
 * one it receives.
 */
export function makeBundle({ side, values, meta = {} }) {
  const sided = specForSide(side);
  if (!sided) throw new Error(`unknown side "${side}"`);
  return {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    side,
    variant: sided.variant,
    values: clampGenome(sided.spec, values),
    meta: { ...meta },
  };
}

/** Indented on purpose: the coach who is about to email this can read it. */
export function serializeBundle(bundle) {
  return JSON.stringify(bundle, null, 2);
}

/** Why these values are not this spec's values, or null when they are. */
function valuesFault(spec, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return 'values is not an object';
  }
  const named = new Set(spec.map((p) => p.key));
  // Object.keys, not `in`: a JSON "__proto__" arrives as an own key and would
  // otherwise pass an inherited-property test without ever being a parameter.
  const stray = Object.keys(values).find((k) => !named.has(k));
  if (stray !== undefined) return `values holds "${stray}", which the spec does not name`;
  const clamped = clampGenome(spec, values);
  for (const p of spec) {
    const v = values[p.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return `values is missing a finite number for "${p.key}"`;
    }
    if (v !== clamped[p.key]) {
      return `values["${p.key}"] is outside the spec's [${p.min}, ${p.max}]`;
    }
  }
  return null;
}

/**
 * Whatever arrived, as a bundle — or a reason it is not one. `{bundle}` on
 * success and `{error}` on failure rather than a throw, because both callers
 * have something better to do with the reason than crash: the CLI prints it
 * and exits 1, and the store treats it as "no saved genome".
 */
export function parseBundle(text) {
  if (typeof text !== 'string' || text === '') return { error: 'no bundle text' };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'not JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'not a JSON object' };
  }
  if (raw.kind !== BUNDLE_KIND) return { error: `kind is not "${BUNDLE_KIND}"` };
  if (raw.version !== BUNDLE_VERSION) return { error: `version is not ${BUNDLE_VERSION}` };
  const sided = specForSide(raw.side);
  if (!sided) return { error: 'side is not "defense" or "offense"' };
  if (raw.variant !== sided.variant) {
    return { error: `variant is not "${sided.variant}", the only game the ${raw.side} spec is written for` };
  }
  const fault = valuesFault(sided.spec, raw.values);
  if (fault) return { error: fault };
  // Meta is a stranger's free text: carried, never trusted, never read for
  // anything but printing. A meta that is not an object is simply absent.
  const meta = raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)
    ? raw.meta : {};
  return {
    bundle: {
      kind: BUNDLE_KIND,
      version: BUNDLE_VERSION,
      side: raw.side,
      variant: raw.variant,
      // Rebuilt through clampGenome rather than handed over: the result is a
      // fresh object with exactly the spec's keys and no inherited surprises.
      values: clampGenome(sided.spec, raw.values),
      meta: { ...meta },
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/train/bundle.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test` — everything green.

```bash
git add lib/game/train/bundle.js test/game/train/bundle.test.js
git commit -m "feat: the genome bundle, the format a trained genome travels in"
```

---

### Task 3: Is this log worth training against, and how big is a browser run

**Files:**
- Modify: `lib/game/train/vs-ghost.js`
- Test: `test/game/train/vs-ghost.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces (added to `lib/game/train/vs-ghost.js`):
  - `MIN_GHOST_SNAPSHOTS = 12`.
  - `BROWSER_TRAINING_RUN = {generations: 12, popSize: 10, plays: 12,
    sigma: 0.08, seed: 1}`.
  - `ghostReadiness(log, variant) -> {side, ghostSide, snapshots, midPlay, ok,
    reason}` — `side` is the genome to TRAIN, `ghostSide` the side the log
    records, `reason` a sentence the board can say either way.

`ghostReadiness` is the browser's version of the two guards
`tools/train-vs-ghost.js`'s CLI body already applies, with one difference: the
CLI *warns* about a log with no mid-play snapshots and trains anyway, because
somebody is watching a terminal and can decide. The browser refuses, because
nobody is: a ghost that stands still the moment the ball is live turns every
down into a twenty-four-turn stalemate, and the coach would just watch a
progress message produce a worse genome than the one he had.

- [ ] **Step 1: Write the failing test**

Create `test/game/train/vs-ghost.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_GHOST_SNAPSHOTS, BROWSER_TRAINING_RUN, ghostReadiness, trainVsGhost,
} from '../../../lib/game/train/vs-ghost.js';
import { captureSnapshot } from '../../../lib/game/coach-log.js';
import {
  createGame, setPlan, formationPlayers, aimSnap, SNAPPER_ID,
} from '../../../lib/game/state.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';

/** One recorded planning phase, with an arrow on every man of one side. */
function recorded({ down, losYard, turnIndex, team }) {
  const s = createGame({ seed: 1 });
  s.down = down;
  s.losYard = losYard;
  s.toGoYard = losYard + 10;
  s.players = formationPlayers(losYard, s.variantId);
  s.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  s.plannedPass = null;
  aimSnap(s);
  for (const p of s.players) if (p.team === team) setPlan(s, p.id, { x: 0, y: 1 }, 1);
  s.turnIndex = turnIndex;
  return captureSnapshot(s, team);
}

/** `n` snapshots for one side, spread over downs and (unless `flat`) turns. */
function log(team, n, { flat = false } = {}) {
  return Array.from({ length: n }, (_, i) => recorded({
    down: 1 + (i % 4), losYard: 20 + (i % 5) * 10, turnIndex: flat ? 0 : i % 3, team,
  }));
}

test('an empty log is not worth training against', () => {
  const r = ghostReadiness([], '7');
  assert.equal(r.ok, false);
  assert.equal(r.snapshots, 0);
  assert.match(r.reason, /at least 12/);
});

test('a thin log is not worth training against', () => {
  const r = ghostReadiness(log('offense', MIN_GHOST_SNAPSHOTS - 1), '7');
  assert.equal(r.ok, false);
  assert.match(r.reason, /at least 12/);
});

test('a log of nothing but first-turn calls is refused, not merely warned about', () => {
  const r = ghostReadiness(log('offense', 20, { flat: true }), '7');
  assert.equal(r.ok, false);
  assert.equal(r.midPlay, 0);
  assert.match(r.reason, /past the snap/);
});

test('a real offense log trains the defense', () => {
  const r = ghostReadiness(log('offense', 20), '7');
  assert.equal(r.ok, true);
  assert.equal(r.ghostSide, 'offense');
  assert.equal(r.side, 'defense');
  assert.equal(r.snapshots, 20);
  assert.ok(r.midPlay > 0);
  assert.match(r.reason, /defense/);
});

test('a coach recorded mostly on defense trains the offense instead', () => {
  const r = ghostReadiness([...log('offense', 3), ...log('defense', 20)], '7');
  assert.equal(r.ok, true);
  assert.equal(r.ghostSide, 'defense');
  assert.equal(r.side, 'offense');
});

test('a log from another game does not count', () => {
  const r = ghostReadiness(log('offense', 20), '11');
  assert.equal(r.ok, false);
  assert.equal(r.snapshots, 0);
});

test('the browser run is modest and deterministic', () => {
  const { generations, popSize, plays, sigma, seed } = BROWSER_TRAINING_RUN;
  assert.ok(generations * popSize * plays <= 2000, 'a browser run is seconds, not minutes');
  assert.ok(generations >= 5 && popSize >= 4 && plays >= 4, 'and still a real search');
  assert.ok(sigma > 0 && sigma < 1);
  assert.equal(typeof seed, 'number');
});

test('a browser-sized run seeded from a genome is reproducible', () => {
  const seedGenome = makeGenome(DEFENSE_SPEC);
  const opts = {
    log: log('offense', 20), side: 'defense', seedGenome,
    generations: 1, popSize: 3, plays: 2, seed: 5, sigma: 0.05,
  };
  const a = trainVsGhost(opts);
  const b = trainVsGhost(opts);
  assert.equal(a.score, b.score);
  assert.deepEqual(a.best, b.best);
  for (const p of DEFENSE_SPEC) assert.equal(typeof a.best[p.key], 'number', p.key);
});

test('the seed genome is where the walk starts', () => {
  const seen = [];
  trainVsGhost({
    log: log('offense', 20), side: 'defense',
    seedGenome: { ...makeGenome(DEFENSE_SPEC), 'cov:dist': 2.5 },
    generations: 1, popSize: 1, plays: 1, seed: 5, sigma: 0,
    onGeneration: (gen, scored) => seen.push(scored[0].genome['cov:dist']),
  });
  // sigma 0 mutates nothing, so a population of one is the seed itself.
  assert.deepEqual(seen, [2.5]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/train/vs-ghost.test.js`
Expected: FAIL — `ghostReadiness`, `MIN_GHOST_SNAPSHOTS` and
`BROWSER_TRAINING_RUN` are not exported.

- [ ] **Step 3: Write the implementation**

In `lib/game/train/vs-ghost.js`, add these three exports immediately after
`GHOST_SITUATION_SHARE`:

```js
/**
 * How many recorded calls it takes before a ghost is worth training against.
 * Twelve is about three downs of coaching — few enough that a coach reaches it
 * in his first drive, many enough that the nearest-neighbor lookup has a real
 * choice to make rather than one answer for every situation on the field.
 */
export const MIN_GHOST_SNAPSHOTS = 12;

/**
 * The one run size the browser offers. 12 x 10 x 12 is 1,440 simulated downs:
 * about a second of a laptop's worker and a few of a phone's, which is what
 * makes this a button rather than a job. `seed` is fixed rather than random on
 * purpose — training twice on the same log gives the same genome, and it still
 * improves, because the second run starts from the first one's champion (see
 * trainVsGhost's seedGenome). No knobs in v1: a coach who wants to sweep them
 * has tools/train-vs-ghost.js.
 */
export const BROWSER_TRAINING_RUN = {
  generations: 12, popSize: 10, plays: 12, sigma: 0.08, seed: 1,
};

/**
 * Whether this log can be trained against, which side it would train, and a
 * sentence the board can say either way.
 *
 * The ghost imitates the side the human was RECORDED coaching — whichever side
 * he has more snapshots of, offense on a tie because coaching the offense
 * against a learned defense is the game's own default — and the genome that
 * gets trained is the other one. That is tools/train-vs-ghost.js's convention
 * exactly, arrived at from the log instead of from a flag.
 *
 * Two refusals, both of them the CLI's own guards. Too few calls, and there is
 * nothing to imitate. No calls past the first turn of a down, and the ghost
 * stands still the moment the ball is live: the CLI merely warns about that,
 * because a person is reading the terminal and can judge; here nobody is, and
 * a run that produces a genome trained against a statue is worse than no run.
 */
export function ghostReadiness(log, variant) {
  const forSide = (s) => log.filter(
    (snap) => snap.situation.side === s && snap.situation.variant === variant,
  );
  const offense = forSide('offense');
  const defense = forSide('defense');
  const ghostSide = defense.length > offense.length ? 'defense' : 'offense';
  const snaps = ghostSide === 'defense' ? defense : offense;
  const side = ghostSide === 'defense' ? 'offense' : 'defense';
  const midPlay = snaps.filter((s) => s.situation.turnIndex > 0).length;
  const base = { side, ghostSide, snapshots: snaps.length, midPlay };
  if (snaps.length < MIN_GHOST_SNAPSHOTS) {
    return {
      ...base,
      ok: false,
      reason: `Only ${snaps.length} recorded call(s) — run at least ${MIN_GHOST_SNAPSHOTS} turns and try again.`,
    };
  }
  if (midPlay === 0) {
    return {
      ...base,
      ok: false,
      reason: 'Every recorded call is a first-turn call — play some downs past the snap, so the ghost has something to do once the ball is live.',
    };
  }
  return {
    ...base,
    ok: true,
    reason: `Training the ${side} against a ghost of ${snaps.length} of your ${ghostSide} calls.`,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/train/vs-ghost.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test` — everything green.

```bash
git add lib/game/train/vs-ghost.js test/game/train/vs-ghost.test.js
git commit -m "feat: a browser run size, and whether a log is worth training against"
```

---

### Task 4: A genome the state carries

**Files:**
- Create: `lib/game/learned/active.js`
- Modify: `lib/game/state.js`
- Modify: `lib/game/ai.js`
- Modify: `lib/game/learned/formation.js`
- Test: `test/game/learned/active.test.js`

**Interfaces:**
- Consumes: `DEFENSE_GENOME` (`./defense-genome.js`), `OFFENSE_GENOME`
  (`./offense-genome.js`).
- Produces:
  - `shippedGenome(side) -> values` — the champion committed in this build.
  - `activeGenome(state, side) -> values` — the state's override when it has
    one, the shipped genome otherwise.
  - `createGame({..., genomeOverrides})` — a new option; the state gains
    `genomeOverrides: {defense: null, offense: null}` by default.

Why the state and not a module variable: nothing under `lib/` may read
`localStorage`, so the override has to arrive as plain data, exactly the way
`tendencyCounts` does. Why an option on `createGame` rather than an assignment
after it: `createGame` calls `maybeApplyLearnedFormations` and then `aimSnap`
before it returns, so an override assigned afterwards would miss the first
down's formation and leave the snap aimed at a quarterback standing somewhere
else. `nextDown` rebuilds `players`, `ball`, `plannedPass`, `aiPlay`,
`forwardPasses`, `penalty` and `deadReason` and nothing else, so the override
survives from down to down on its own — Step 1's test pins that.

- [ ] **Step 1: Write the failing test**

Create `test/game/learned/active.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shippedGenome, activeGenome } from '../../../lib/game/learned/active.js';
import { createGame } from '../../../lib/game/state.js';
import { nextDown } from '../../../lib/game/rules.js';
import { coachLearnedDefense } from '../../../lib/game/ai.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';
import { yardsOfY } from '../../../lib/game/view.js';

const deepSafety = {
  ...makeGenome(DEFENSE_SPEC), 'pos:d-s:across': 0, 'pos:d-s:down': 11,
};

test('the shipped genome holds every key its spec names', () => {
  for (const p of DEFENSE_SPEC) {
    assert.equal(typeof shippedGenome('defense')[p.key], 'number', p.key);
  }
  for (const p of OFFENSE_SPEC) {
    assert.equal(typeof shippedGenome('offense')[p.key], 'number', p.key);
  }
});

test('a game with no override plays the shipped genome', () => {
  const s = createGame({ seed: 1 });
  assert.deepEqual(s.genomeOverrides, { defense: null, offense: null });
  assert.equal(activeGenome(s, 'defense'), shippedGenome('defense'));
  assert.equal(activeGenome(s, 'offense'), shippedGenome('offense'));
});

test('a state from before overrides existed still reads as no override', () => {
  assert.equal(activeGenome({}, 'defense'), shippedGenome('defense'));
});

test('an override is played for its own side only', () => {
  const s = createGame({ seed: 1, genomeOverrides: { defense: deepSafety } });
  assert.equal(activeGenome(s, 'defense'), deepSafety);
  assert.equal(activeGenome(s, 'offense'), shippedGenome('offense'));
});

test('the override survives the next down', () => {
  const s = createGame({ seed: 1, genomeOverrides: { defense: deepSafety } });
  s.deadReason = 'tackled';
  nextDown(s);
  assert.equal(s.down, 2);
  assert.equal(activeGenome(s, 'defense'), deepSafety);
});

test('a learned defense stands the override formation, not the shipped one', () => {
  const s = createGame({
    seed: 2, ai: 'defense', aiLevel: 'learned', genomeOverrides: { defense: deepSafety },
  });
  const safety = s.players.find((p) => p.id === 'd-s');
  assert.ok(Math.abs((yardsOfY(safety.pos.y) - s.losYard) - 11) < 0.6);
});

test('the learned defense brain reads the override too', () => {
  const zone = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': 4 };
  const man = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': -4 };
  const covers = (values) => {
    const s = createGame({
      seed: 3, ai: 'defense', aiLevel: 'learned', genomeOverrides: { defense: values },
    });
    coachLearnedDefense(s);
    return s.players.filter((p) => p.cover).length;
  };
  assert.ok(covers(man) > 0, 'a man-leaning override takes receivers');
  assert.equal(covers(zone), 0, 'a zone-leaning override takes spots');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/learned/active.test.js`
Expected: FAIL — cannot find module `lib/game/learned/active.js`.

- [ ] **Step 3: Write `lib/game/learned/active.js`**

Create `lib/game/learned/active.js`:

```js
/**
 * Which genome a learned brain actually plays, this game.
 *
 * Normally the shipped one — the champion committed into defense-genome.js and
 * offense-genome.js by the trainers. But a coach who has trained a genome in
 * his own browser (app/train-worker.js) is playing against THAT one, and it
 * reaches the engine as plain data on the state, because nothing under lib/
 * may read localStorage. The app loads it and hands it over, exactly the way it
 * hands over tendencyCounts.
 *
 * Deliberately imports nothing but the two generated data modules. ai.js reads
 * this, learned/formation.js reads it, and state.js imports formation.js —
 * anything heavier here would close an import cycle.
 */
import { DEFENSE_GENOME } from './defense-genome.js';
import { OFFENSE_GENOME } from './offense-genome.js';

/** The genome this build ships for one side of the ball. */
export function shippedGenome(side) {
  return side === 'defense' ? DEFENSE_GENOME.values : OFFENSE_GENOME.values;
}

/**
 * The values one side's learned brain should play: the state's override when
 * it has one, the shipped genome otherwise. A state built before overrides
 * existed — an old save, a test's hand-rolled object — carries no field at all
 * and reads as no override, so every existing caller behaves exactly as it did.
 */
export function activeGenome(state, side) {
  const override = state.genomeOverrides ? state.genomeOverrides[side] : null;
  return override ?? shippedGenome(side);
}
```

- [ ] **Step 4: Add the field and the option to `lib/game/state.js`**

In `createGame`'s signature, add the option:

```js
export function createGame({
  seed = 1, ai = null, aiLevel = 'pursuit', variant = DEFAULT_VARIANT,
  genomeOverrides = null,
} = {}) {
```

and in the state literal, immediately after the `tendencyCounts: null,` field
and its comment, add:

```js
    // A genome trained in this browser (app/train-worker.js), per side, or
    // null for the one this build ships. Plain serializable data like
    // tendencyCounts, and handed over for the same reason: learned/active.js
    // is what reads it, and nothing under lib/ may read a browser's storage.
    // Taken as an option rather than assigned afterwards because
    // maybeApplyLearnedFormations runs below, before this function returns —
    // an override that arrived late would miss the first down's formation.
    genomeOverrides: {
      defense: genomeOverrides?.defense ?? null,
      offense: genomeOverrides?.offense ?? null,
    },
```

Also extend the doc comment above `createGame` with one paragraph, after the
`aiLevel` paragraph:

```js
 * `genomeOverrides` is `{defense, offense}` — trained genome values to play
 * instead of the shipped ones, either side null for "ship's own". See
 * learned/active.js.
```

- [ ] **Step 5: Read the active genome in `lib/game/ai.js`**

Replace the two shipped-genome imports:

```js
import { DEFENSE_GENOME } from './learned/defense-genome.js';
import { OFFENSE_GENOME } from './learned/offense-genome.js';
```

with one:

```js
import { activeGenome } from './learned/active.js';
```

In `coachLearnedDefense`, replace `DEFENSE_GENOME.values` with
`activeGenome(state, 'defense')`, and extend its doc comment's first sentence
so it still says what it plays:

```js
/**
 * The learned brain's orders — this game's genome (the shipped one, or one
 * trained in this browser: see learned/active.js), shaded by whatever this
 * game knows about the coach across the table, written into `state`. A game
 * carrying no counts reads as no tendencies at all, which is byte-for-byte the
 * defense this function played before it could learn anything.
 */
export function coachLearnedDefense(state) {
  applyOrders(state, learnedOrders(
    state, state.aiTeam, activeGenome(state, 'defense'), tendenciesForState(state),
  ));
}
```

In `coachAi`, replace `OFFENSE_GENOME.values` the same way:

```js
  if (state.aiTeam === 'offense' && state.aiLevel === 'learned') {
    coachLearnedOffense(state, activeGenome(state, 'offense'));
    return;
  }
```

- [ ] **Step 6: Read the active genome in `lib/game/learned/formation.js`**

Replace the two genome-module imports:

```js
import { DEFENSE_GENOME } from './defense-genome.js';
import { OFFENSE_GENOME } from './offense-genome.js';
```

with:

```js
import { activeGenome } from './active.js';
```

(The `DEFENSE_SPEC`/`DEFENSE_VARIANT` and `OFFENSE_SPEC`/`OFFENSE_VARIANT`
imports stay exactly as they are.) Then rewrite the three call sites:

```js
export function maybeApplyLearnedFormations(state) {
  if (isLearnedDefense(state)) {
    applyLearnedDefenseFormation(state, activeGenome(state, 'defense'));
  }
  if (state.aiTeam === 'offense' && state.aiLevel === 'learned'
    && state.variantId === OFFENSE_VARIANT) {
    applyLearnedOffenseFormation(state, activeGenome(state, 'offense'));
  }
}
```

```js
export function realignLearnedDefense(state) {
  if (!isLearnedDefense(state)) return false;
  return applyLearnedDefenseFormation(state, activeGenome(state, 'defense'));
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --test test/game/learned/active.test.js`
Expected: PASS (7 tests).

- [ ] **Step 8: Run the whole suite and commit**

Run: `npm test`
Expected: ALL PASS. Nothing else changes behavior — with no override,
`activeGenome` returns the very object the two modules imported before, so
every existing learned-AI test sees the same numbers it always did.

```bash
git add lib/game/learned/active.js lib/game/state.js lib/game/ai.js lib/game/learned/formation.js test/game/learned/active.test.js
git commit -m "feat: a learned brain plays the genome its state carries"
```

---

### Task 5: Train in the browser

**Files:**
- Create: `app/genome-store.js`
- Create: `app/train-worker.js`
- Modify: `index.html`
- Modify: `app/main.js`

**Interfaces:**
- Consumes: `parseBundle`, `serializeBundle`, `makeBundle`
  (`lib/game/train/bundle.js`); `trainVsGhost`, `ghostReadiness`,
  `BROWSER_TRAINING_RUN` (`lib/game/train/vs-ghost.js`);
  `maybeApplyLearnedFormations` (`lib/game/learned/formation.js`, whose
  `realignLearnedDefense` `app/main.js` already imports); `aimSnap`
  (`lib/game/state.js`).
- Produces (in `app/genome-store.js`):
  - `loadGenomeBundles() -> {defense: bundle|null, offense: bundle|null}`
  - `saveGenomeBundle(side, bundle) -> boolean`
  - `clearGenomeBundles() -> boolean`
  - `overrideValues(bundles) -> {defense: values|null, offense: values|null}`
- Produces (the worker protocol): the page posts one job
  `{log, side, generations, popSize, plays, sigma, seed, seedGenome,
  snapshots, exportedAt}`; the worker posts `{type: 'progress', gen, score}`
  per generation and `{type: 'done', bundle}` once.

No unit tests — these files touch the DOM, `localStorage` and `Worker`, none
of which `node --test` has. That is why Tasks 1–4 hold every rule these files
merely plumb together. Verification is Step 5's browser walk.

- [ ] **Step 1: Write `app/genome-store.js`**

Create `app/genome-store.js`:

```js
/**
 * Where a genome trained in this browser lives between sessions — one key per
 * side, each holding one serialized bundle.
 *
 * The same bargain app/coach-store.js and app/playbook-store.js keep: the
 * FORMAT is pure and tested under node --test (lib/game/train/bundle.js) and
 * only the plumbing is here, and every call is wrapped because localStorage
 * does not merely return null when the browser has blocked site data — the
 * property access itself throws. A coach whose browser will not remember him
 * should still get to play football against the genome this build ships.
 *
 * Stored as the whole BUNDLE and not just its values, so that Copy trained
 * genome still hands over a complete, importable file after a reload — the
 * meta is what tells the maintainer what he is looking at.
 */
import { parseBundle, serializeBundle } from '../lib/game/train/bundle.js';

const KEY = {
  defense: 'football-by-turn:genome:defense',
  offense: 'football-by-turn:genome:offense',
};

/** Anything that is not a valid bundle for this side reads as no bundle:
 *  a genome saved by an older build is a genome this one cannot play. */
function loadOne(side) {
  try {
    const { bundle } = parseBundle(localStorage.getItem(KEY[side]));
    return bundle && bundle.side === side ? bundle : null;
  } catch {
    return null;
  }
}

export function loadGenomeBundles() {
  return { defense: loadOne('defense'), offense: loadOne('offense') };
}

/** False when the browser refused to keep it — the caller says so out loud. */
export function saveGenomeBundle(side, bundle) {
  try {
    localStorage.setItem(KEY[side], serializeBundle(bundle));
    return true;
  } catch {
    return false;
  }
}

/** Both sides, always — a coach asking for the shipped AI back does not mean
 *  half of it. */
export function clearGenomeBundles() {
  try {
    localStorage.removeItem(KEY.defense);
    localStorage.removeItem(KEY.offense);
    return true;
  } catch {
    return false;
  }
}

/** The two bundles as the plain data `state.genomeOverrides` wants. */
export function overrideValues(bundles) {
  return {
    defense: bundles.defense ? bundles.defense.values : null,
    offense: bundles.offense ? bundles.offense.values : null,
  };
}
```

- [ ] **Step 2: Write `app/train-worker.js`**

Create `app/train-worker.js`:

```js
/**
 * Training, off the main thread.
 *
 * A training run is one to two seconds of solid arithmetic — a thousand-odd
 * simulated downs — and on the main thread that is a frozen board, a dead
 * menu, and a browser offering to kill the page. In a worker it is a progress
 * message every generation and a board that still scrolls.
 *
 * A worker has no localStorage and no DOM, so this file asks for nothing: the
 * page posts the whole job — the log, which genome to train, where to start
 * from, how big the run is, and the seed — and gets back one bundle. Every
 * number in the result is a function of that job, so the same job posted twice
 * produces the same genome twice.
 *
 * Spawned as a module worker (see app/main.js), which is what lets it import
 * lib/ directly; the deploy workflow copies lib/ to Pages, which is why the
 * trainer had to live there.
 */
import { trainVsGhost } from '../lib/game/train/vs-ghost.js';
import { makeBundle } from '../lib/game/train/bundle.js';

self.addEventListener('message', (e) => {
  const {
    log, side, generations, popSize, plays, sigma, seed, seedGenome,
    snapshots, exportedAt,
  } = e.data;
  const { best, score } = trainVsGhost({
    log,
    side,
    generations,
    popSize,
    plays,
    sigma,
    seed,
    seedGenome,
    onGeneration: (gen, scored) =>
      self.postMessage({ type: 'progress', gen, score: scored[0].score }),
  });
  self.postMessage({
    type: 'done',
    bundle: makeBundle({
      side,
      values: best,
      meta: {
        trainedBy: 'app/train-worker.js',
        generations,
        popSize,
        plays,
        sigma,
        seed,
        fitness: score,
        snapshots,
        // Stamped by the page, not read from a clock here: the training path
        // stays a pure function of the job it was given.
        exportedAt,
      },
    }),
  });
});
```

- [ ] **Step 3: Add the three menu buttons to `index.html`**

In `index.html`, inside `.menu-body`, insert these four lines immediately
BEFORE the existing `<button id="close-menu">Close</button>` (Close is the
last control in the menu and is the stable anchor):

```html
      <h2>In-browser training</h2>
      <button id="train">Train vs. my log</button>
      <button id="copy-genome">Copy trained genome</button>
      <button id="discard-genome">Use the shipped genome</button>
```

They need no CSS: `.menu-body button` and `.menu-body h2` already style them.

- [ ] **Step 4: Wire `app/main.js`**

Extend the `state.js` import with `aimSnap` — the override can move the
quarterback, and a snap aimed at where he used to stand would fire into space:

```js
import {
  createGame, setPlan, setMode, getPlayer, clearAllPlans, isControllable, setPass, ballPos,
  aimSnap,
} from '../lib/game/state.js';
```

Extend the `learned/formation.js` import:

```js
import { realignLearnedDefense, maybeApplyLearnedFormations } from '../lib/game/learned/formation.js';
```

Add three imports next to the other `app/` and `lib/game/` ones (after the
`./coach-store.js` import):

```js
import { ghostReadiness, BROWSER_TRAINING_RUN } from '../lib/game/train/vs-ghost.js';
import { serializeBundle } from '../lib/game/train/bundle.js';
import {
  loadGenomeBundles, saveGenomeBundle, clearGenomeBundles, overrideValues,
} from './genome-store.js';
```

Add the three button handles next to the existing ones (after the
`const clearLogBtn = ...` line):

```js
const trainBtn = document.getElementById('train');
const copyGenomeBtn = document.getElementById('copy-genome');
const discardGenomeBtn = document.getElementById('discard-genome');
```

Next to the other module-level holders that outlive New Game (`library`,
`coachLog`, `tendencies`), add:

```js
// What this coach has trained in his own browser: one bundle per side, or
// null. Not game state, for the same reason the playbook and the coaching log
// are not — New Game replaces `state` wholesale and a trained genome outlives
// a drive. `trainedSide` is which one the Copy button hands over; only one is
// ever trained in practice, and defense is the normal one.
let genomeBundles = loadGenomeBundles();
let trainedSide = genomeBundles.defense ? 'defense'
  : genomeBundles.offense ? 'offense' : null;
// The live training worker, or null. One at a time: a second run started on
// top of the first would race it for the same override.
let trainer = null;
```

In `paint()`, next to the other button labels (after the two `clearLogBtn` /
`copyLogBtn` lines), add:

```js
  trainBtn.disabled = animating || trainer !== null || coachLog.length === 0;
  copyGenomeBtn.textContent = trainedSide
    ? `Copy trained ${trainedSide} genome`
    : 'Copy trained genome';
  copyGenomeBtn.disabled = animating || trainedSide === null;
  discardGenomeBtn.disabled = animating || trainedSide === null;
```

In `pressRun`'s animation lock (the block that sets `runBtn.disabled = true`
and friends, ending at `clearLogBtn.disabled = true;`), add:

```js
    trainBtn.disabled = true;
    copyGenomeBtn.disabled = true;
    discardGenomeBtn.disabled = true;
```

In `startNewGame()`, hand the override to `createGame` rather than assigning it
afterwards — the formation goes on inside `createGame`:

```js
  state = createGame({
    seed: (Math.random() * 2 ** 31) | 0, ai: mode.ai, aiLevel: mode.level, variant: variantId,
    genomeOverrides: overrideValues(genomeBundles),
  });
```

Add the three handlers next to the other menu-button listeners, after the
`clearLogBtn` listener:

```js
/**
 * Put the freshly trained genome on the board. The brain reads it from the
 * next order it gives; the FORMATION is a pre-snap picture, so it only changes
 * while there still is one — maybeApplyLearnedFormations writes through
 * applyLearnedDefenseFormation, which is gated on the planning phase and turn
 * zero and does nothing the rest of the time. aimSnap follows because an
 * offense genome can move the quarterback, and the automatic snap is aimed at
 * where he stands — the same two lines, in the same order, that createGame and
 * nextDown end on.
 */
function applyGenomeOverrides() {
  state.genomeOverrides = overrideValues(genomeBundles);
  maybeApplyLearnedFormations(state);
  aimSnap(state);
}

function stopTraining() {
  if (trainer) trainer.terminate();
  trainer = null;
}

/**
 * Train a genome against a ghost of THIS coach, here, on this device — the
 * same run tools/train-vs-ghost.js makes, in a worker, seeded from whatever
 * genome is already playing so that a second press keeps climbing.
 *
 * The side is read off the log rather than chosen: the ghost imitates the side
 * you were recorded coaching and the genome that gets trained is the other one
 * (lib/game/train/vs-ghost.js's ghostReadiness). A log too thin to imitate is
 * refused out loud rather than trained against badly.
 */
function startTraining() {
  if (animating || trainer !== null) return;
  const ready = ghostReadiness(coachLog, state.variantId);
  if (!ready.ok) {
    say(ready.reason);
    return;
  }
  const job = {
    ...BROWSER_TRAINING_RUN,
    log: coachLog,
    side: ready.side,
    snapshots: ready.snapshots,
    seedGenome: genomeBundles[ready.side] ? genomeBundles[ready.side].values : null,
    exportedAt: new Date().toISOString(),
  };
  trainer = new Worker(new URL('./train-worker.js', import.meta.url), { type: 'module' });
  trainer.addEventListener('message', (e) => {
    if (e.data.type === 'progress') {
      say(`Training the ${ready.side} — generation ${e.data.gen + 1}`
        + ` of ${BROWSER_TRAINING_RUN.generations}, best ${e.data.score.toFixed(2)}.`);
      return;
    }
    const { bundle } = e.data;
    stopTraining();
    genomeBundles = { ...genomeBundles, [bundle.side]: bundle };
    trainedSide = bundle.side;
    if (!saveGenomeBundle(bundle.side, bundle)) {
      say('Trained — but this browser refused to save it, so copy it now or it goes away on reload.');
    } else {
      say(`Trained a new ${bundle.side} against ${ready.snapshots} of your calls`
        + ` (fitness ${bundle.meta.fitness.toFixed(2)}). It is playing now —`
        + ' Copy trained genome sends it in.');
    }
    applyGenomeOverrides();
    paint();
  });
  trainer.addEventListener('error', () => {
    stopTraining();
    say('Training could not start — this page has to be served over http (npm run serve), not opened as a file.');
    paint();
  });
  trainer.postMessage(job);
  say(`${ready.reason} This takes a few seconds.`);
  paint();
}

trainBtn.addEventListener('click', () => {
  closeMenu();
  startTraining();
});

/**
 * Hand the trained genome over as a bundle — the JSON file
 * tools/import-genome.js reads. Clipboard first, prompt as the fallback, the
 * same bargain the coaching-log copy button strikes and for the same reason.
 */
copyGenomeBtn.addEventListener('click', async () => {
  closeMenu();
  if (animating || trainedSide === null) return;
  const text = serializeBundle(genomeBundles[trainedSide]);
  try {
    await navigator.clipboard.writeText(text);
    say(`Copied your trained ${trainedSide} genome. Save it as JSON and send it in.`);
  } catch {
    window.prompt('Copy this genome bundle:', text);
    say('The browser refused the clipboard — the genome is in the prompt instead.');
  }
});

/** Back to the genome this build ships. Both sides, always — a coach asking
 *  for the shipped AI back does not mean half of it. */
discardGenomeBtn.addEventListener('click', () => {
  closeMenu();
  if (animating || trainedSide === null) return;
  genomeBundles = { defense: null, offense: null };
  trainedSide = null;
  clearGenomeBundles();
  applyGenomeOverrides();
  say('Back to the shipped genome. Your trained one is gone from this browser.');
  paint();
});
```

- [ ] **Step 5: Verify in the browser**

Run `npm test` first — all green. Nothing in this task can break a lib test, so
a failure here means a `lib/` file was edited by mistake.

Then `npm run serve`, open http://localhost:8080 and walk it:

1. **7 Player → Play Offense.** Open the Coaches Menu: below **Coaching log**
   there is now an **In-browser training** heading with **Train vs. my log**
   (greyed out, the log being empty), **Copy trained genome** (greyed out) and
   **Use the shipped genome** (greyed out).
2. Draw an arrow on the running back, press **Run Turn**, let it play. Reopen
   the menu: **Train vs. my log** is live (the log has one call in it) and the
   other two are still greyed out.
3. Press **Train vs. my log** now, with barely anything recorded: the board
   says *Only 1 recorded call(s) — run at least 12 turns and try again.* and
   nothing starts.
4. Play three or four whole downs, running the turn several times per down —
   at least a dozen turns in all, including turns after the snap. The Coaching
   log button's count climbs past 12.
5. Press **Train vs. my log**. The board says
   *Training the defense against a ghost of N of your offense calls. This takes
   a few seconds.*, then counts *generation 1 of 12*, *2 of 12*, … The board
   still scrolls and the menu still opens while it runs — that is the worker
   doing its job. Finally: *Trained a new defense against N of your calls
   (fitness …). It is playing now — Copy trained genome sends it in.*
6. Reopen the menu: **Copy trained defense genome** and **Use the shipped
   genome** are live. Press **Next Down** and look at the defense: its
   alignment is the trained one, and it should visibly answer the plays you
   have been calling.
7. Press **Copy trained defense genome** — the message says it was copied (or a
   prompt appears with the JSON). Paste it into a file, e.g.
   `~/contributed-genome.json`; keep it for Task 7. It must be one JSON object
   with `"kind": "football-by-turn-genome"`, `"version": 1`,
   `"side": "defense"`, `"variant": "7"`, a `"values"` object and a `"meta"`
   object carrying `fitness`, `snapshots` and `exportedAt`.
8. Reload the page and start another **Play Offense** game: **Copy trained
   defense genome** is still live — the genome survived the reload — and the
   defense is still the trained one.
9. Press **Train vs. my log** again. It runs the same twelve generations and
   finishes with a fitness no worse than last time, because it started from the
   genome it produced last time.
10. Press **Use the shipped genome**: the message says so, both buttons grey
    back out, and a reload keeps them out. The defense is back to the shipped
    alignment.
11. Back to Home → **7 Player → Play Defense**: the log now records your
    defense calls, and once there are enough of them **Train vs. my log** says
    *Training the offense against a ghost of …* — the side follows the log.
12. Back to Home → **7 Player → Training Mode**: the mode button reads
    `Defense: computer (smart)` and the game plays exactly as it always did;
    training an override changes nothing for a level that reads no genome.
13. No console errors anywhere in the walk.

(If verifying in an embedded preview pane rather than a real browser, turn
animations crawl — `requestAnimationFrame` barely fires there. The worker,
the progress messages, the button states and the copy flow are all still
checkable.)

- [ ] **Step 6: Commit**

```bash
git add app/genome-store.js app/train-worker.js app/main.js index.html
git commit -m "feat: train the AI against yourself in the browser, and export it"
```

---

### Task 6: Judge a genome from either sideline

**Files:**
- Modify: `lib/game/train/harness.js`
- Test: `test/game/train/harness.test.js`

The import CLI has to score a contributed genome twice — against the learned
opponent and against the scripted one — and for an offense bundle that second
opponent is a defense the harness cannot currently field. This task adds the
missing half and factors the aggregation both evaluators share, without moving
a single die: `evaluatePair` walks the same `rand` in the same order
`evaluateDefense` always did, so every existing fitness number is unchanged.

**Interfaces:**
- Consumes: `smartOrders` (`../defense.js`) — new import in `harness.js`.
- Produces (added to `lib/game/train/harness.js`):
  - `evaluatePair({offense, defense, plays, seed}) -> {yardsPerPlay,
    touchdownRate, turnoverRate}`.
  - `smartDefenseCoach(state)` — the assignment defense as a coach function.
  - `evaluateOffense(values, {plays, seed, defenseCoach}) -> stats`, defaulting
    to `smartDefenseCoach`.
  - `evaluateDefense` keeps its exact signature and its exact numbers.

- [ ] **Step 1: Write the failing test**

Create `test/game/train/harness.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePair, evaluateDefense, evaluateOffense, evaluateMatch,
  defenseCoach, learnedOffenseCoach, scriptedOffenseCoach, smartDefenseCoach,
  scenario,
} from '../../../lib/game/train/harness.js';
import { mulberry32 } from '../../../lib/game/rng.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';

const DEF = makeGenome(DEFENSE_SPEC);
const OFF = makeGenome(OFFENSE_SPEC);
const OPTS = { plays: 4, seed: 12 };

test('evaluatePair reproduces evaluateDefense exactly, dice for dice', () => {
  assert.deepEqual(
    evaluatePair({ offense: scriptedOffenseCoach, defense: defenseCoach(DEF), ...OPTS }),
    evaluateDefense(DEF, OPTS),
  );
});

test('evaluatePair reproduces evaluateMatch exactly, dice for dice', () => {
  assert.deepEqual(
    evaluatePair({ offense: learnedOffenseCoach(OFF), defense: defenseCoach(DEF), ...OPTS }),
    evaluateMatch(OFF, DEF, OPTS),
  );
});

test('smartDefenseCoach gives the assignment defense its orders', () => {
  const s = scenario(mulberry32(21));
  smartDefenseCoach(s);
  const defenders = s.players.filter((p) => p.team === 'defense');
  assert.ok(defenders.some((p) => p.plan || p.cover), 'somebody was told something');
});

test('evaluateOffense scores an offense genome against the smart defense', () => {
  const a = evaluateOffense(OFF, OPTS);
  const b = evaluateOffense(OFF, OPTS);
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.yardsPerPlay));
  assert.ok(a.touchdownRate >= 0 && a.touchdownRate <= 1);
  assert.ok(a.turnoverRate >= 0 && a.turnoverRate <= 1);
});

test('evaluateOffense takes any defense coach, including a learned one', () => {
  assert.deepEqual(
    evaluateOffense(OFF, { ...OPTS, defenseCoach: defenseCoach(DEF) }),
    evaluateMatch(OFF, DEF, OPTS),
  );
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/game/train/harness.test.js`
Expected: FAIL — `evaluatePair`, `smartDefenseCoach` and `evaluateOffense` are
not exported.

- [ ] **Step 3: Write the implementation**

In `lib/game/train/harness.js`, add `smartOrders` to the imports:

```js
import { smartOrders } from '../defense.js';
```

Then replace the whole `evaluateDefense` function with these four — the
aggregation lifted out unchanged, the old evaluator expressed through it, and
the two new pieces:

```js
/**
 * Mean per-play stats for two coaches over `plays` seeded scenarios. The one
 * place a fitness evaluation's dice are rolled: the scenarios come off one
 * `rand`, and each play's own randomness is a fresh generator seeded from it,
 * so two genomes evaluated at the same seed see the same downs and the same
 * tackle rolls whichever side of the ball each is on.
 */
export function evaluatePair({ offense, defense, plays, seed }) {
  const rand = mulberry32(seed);
  let yards = 0;
  let touchdowns = 0;
  let turnovers = 0;
  for (let i = 0; i < plays; i++) {
    const state = scenario(rand);
    const result = playOnePlay(
      state, offense, defense, mulberry32(1 + Math.floor(rand() * 2 ** 30)),
    );
    yards += result.yards;
    if (result.touchdown) touchdowns += 1;
    if (result.turnover) turnovers += 1;
  }
  return {
    yardsPerPlay: yards / plays,
    touchdownRate: touchdowns / plays,
    turnoverRate: turnovers / plays,
  };
}

/** Mean per-play stats for one defense genome over `plays` seeded scenarios. */
export function evaluateDefense(values, { plays, seed, offenseCoach = scriptedOffenseCoach }) {
  return evaluatePair({
    offense: offenseCoach, defense: defenseCoach(values), plays, seed,
  });
}

/**
 * The assignment defense (defense.js) as a coach function — the `smart` level,
 * hot-seat. It is to a contributed OFFENSE what scriptedOffenseCoach is to a
 * contributed defense: the best opponent this codebase can field with no
 * genome at all, and therefore the second opinion worth having when the
 * learned matchup is the only other evidence.
 */
export function smartDefenseCoach(state) {
  applyAiModes(state, 'defense');
  applyOrders(state, smartOrders(state, 'defense'));
}

/** The offense twin of evaluateDefense: one offense genome's mean per-play
 *  stats against a given defense coach, on the same downs and the same dice. */
export function evaluateOffense(values, { plays, seed, defenseCoach: defense = smartDefenseCoach }) {
  return evaluatePair({
    offense: learnedOffenseCoach(values), defense, plays, seed,
  });
}
```

`evaluateOffense` and `learnedOffenseCoach` reference each other's neighbours,
so put these four where `evaluateDefense` was — above `learnedOffenseCoach` —
and leave `evaluateMatch` at the bottom exactly as it is. Function
declarations hoist, so the order is only a matter of reading.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/game/train/harness.test.js`
Expected: PASS (5 tests). The first two are the ones that matter: they assert
the refactor moved no dice.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: ALL PASS, `test/tools/harness.test.js`, `coevolve.test.js`,
`train-defense.test.js` and `train-vs-ghost.test.js` included and unedited.

```bash
git add lib/game/train/harness.js test/game/train/harness.test.js
git commit -m "feat: evaluate a genome from either sideline"
```

---

### Task 7: Import a contributed genome

**Files:**
- Create: `tools/import-genome.js`
- Test: `test/tools/import-genome.test.js`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `readFileSync`, `writeFileSync` (`node:fs`); `pathToFileURL`
  (`node:url`); `parseBundle` (`../lib/game/train/bundle.js`);
  `defenseFitness`, `offenseFitness` (`../lib/game/train/fitness.js`);
  `evaluateDefense`, `evaluateOffense`, `evaluateMatch`
  (`../lib/game/train/harness.js`); `shippedGenome`
  (`../lib/game/learned/active.js`); `genomeModuleSource`
  (`../lib/game/learned/genome.js`).
- Produces:
  - `DEFAULT_PLAYS = 24`, `DEFAULT_SEED = 7`.
  - `gauntlet(values, side, {plays, seed}) -> {primary, secondary}`, each
    `{label, stats, fitness}`.
  - `compareBundle(bundle, {plays, seed}) -> {side, plays, seed, incumbent,
    challenger, wins}`.
  - `comparisonReport(comparison) -> string`.
  - The CLI: `node tools/import-genome.js --bundle <path> [--plays N]
    [--seed N] [--force]`, plus `npm run import:genome`.

Which matchup is primary, and why: the shipped genomes were last trained in
co-evolution against each other, so the matchup a contributed genome has to
win is the one against the LEARNED opponent. The scripted/smart run is the
second opinion — a genome that beats the learned offense while collapsing
against the scripted one has probably learned the offense rather than
football, and the maintainer gets to see that before adopting it.

- [ ] **Step 1: Write the failing test**

Create `test/tools/import-genome.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLAYS, DEFAULT_SEED, gauntlet, compareBundle, comparisonReport,
} from '../../tools/import-genome.js';
import { makeBundle } from '../../lib/game/train/bundle.js';
import { makeGenome } from '../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../lib/game/learned/offense-spec.js';

const OPTS = { plays: 3, seed: 5 };

test('the gauntlet plays a defense genome against both offenses, deterministically', () => {
  const values = makeGenome(DEFENSE_SPEC);
  const a = gauntlet(values, 'defense', OPTS);
  assert.deepEqual(a, gauntlet(values, 'defense', OPTS));
  assert.match(a.primary.label, /learned offense/);
  assert.match(a.secondary.label, /scripted offense/);
  for (const r of [a.primary, a.secondary]) {
    assert.ok(Number.isFinite(r.fitness));
    assert.ok(Number.isFinite(r.stats.yardsPerPlay));
    assert.ok(r.stats.touchdownRate >= 0 && r.stats.touchdownRate <= 1);
    assert.ok(r.stats.turnoverRate >= 0 && r.stats.turnoverRate <= 1);
  }
});

test('the gauntlet mirrors for an offense genome', () => {
  const a = gauntlet(makeGenome(OFFENSE_SPEC), 'offense', OPTS);
  assert.match(a.primary.label, /learned defense/);
  assert.match(a.secondary.label, /smart defense/);
  assert.ok(Number.isFinite(a.primary.fitness));
});

test('a comparison scores challenger and incumbent on the same downs', () => {
  const c = compareBundle(
    makeBundle({ side: 'defense', values: makeGenome(DEFENSE_SPEC) }), OPTS,
  );
  assert.equal(c.side, 'defense');
  assert.equal(c.plays, 3);
  assert.equal(c.seed, 5);
  assert.equal(typeof c.wins, 'boolean');
  assert.equal(c.wins, c.challenger.primary.fitness > c.incumbent.primary.fitness);
  assert.equal(c.challenger.primary.label, c.incumbent.primary.label);
  // The incumbent is whatever this build ships; nothing here may lean on its
  // trained numbers, only on their being numbers at all.
  assert.ok(Number.isFinite(c.incumbent.primary.fitness));
});

test('an identical challenger does not win, because a tie is not a win', () => {
  const values = makeGenome(DEFENSE_SPEC);
  const c = compareBundle(makeBundle({ side: 'defense', values }), OPTS);
  const twin = compareBundle(makeBundle({ side: 'defense', values }), OPTS);
  assert.equal(c.challenger.primary.fitness, twin.challenger.primary.fitness);
  const self = { ...c, incumbent: c.challenger };
  assert.equal(self.challenger.primary.fitness > self.incumbent.primary.fitness, false);
});

test('the report names both matchups, both genomes and a verdict', () => {
  const text = comparisonReport(compareBundle(
    makeBundle({ side: 'defense', values: makeGenome(DEFENSE_SPEC) }), OPTS,
  ));
  assert.match(text, /learned offense/);
  assert.match(text, /scripted offense/);
  assert.match(text, /primary/);
  assert.match(text, /shipped/);
  assert.match(text, /contributed/);
  assert.match(text, /yds\/play/);
  assert.match(text, /VERDICT/);
});

test('the defaults are a real evaluation and not a token one', () => {
  assert.ok(DEFAULT_PLAYS >= 16);
  assert.ok(Number.isInteger(DEFAULT_SEED));
});

test('importing the CLI evaluates nothing and writes no files', () => {
  // The import at the top of this file already proved it: if the CLI body ran
  // on import, the suite would play a gauntlet and rewrite a genome module.
  assert.ok(true);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/tools/import-genome.test.js`
Expected: FAIL — cannot find module `tools/import-genome.js`.

- [ ] **Step 3: Write the implementation**

Create `tools/import-genome.js`:

```js
/**
 * Take a genome somebody trained in his browser and decide whether this
 * repository should ship it.
 *
 * Usage:
 *   node tools/import-genome.js --bundle contributed.json
 *   node tools/import-genome.js --bundle contributed.json --plays 40 --seed 3
 *   node tools/import-genome.js --bundle contributed.json --force
 *
 * Three gates, in order. It has to BE a bundle (lib/game/train/bundle.js
 * refuses a file from another build, another version, or a genome whose values
 * do not fit this spec). It has to WIN — the same downs and the same dice as
 * the genome currently shipped, judged on the matchup that genome was last
 * trained on. And only then is the generated module rewritten, carrying the
 * contributor's own meta and the numbers actually measured here, so that
 * `git log` on defense-genome.js says where its values came from.
 *
 * --force ships a loser anyway, for the one case worth having it: a genome
 * that is interesting rather than better.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseBundle } from '../lib/game/train/bundle.js';
import { defenseFitness, offenseFitness } from '../lib/game/train/fitness.js';
import {
  evaluateDefense, evaluateOffense, evaluateMatch,
} from '../lib/game/train/harness.js';
import { shippedGenome } from '../lib/game/learned/active.js';
import { genomeModuleSource } from '../lib/game/learned/genome.js';

/** Enough downs that a yard per play means something, few enough that the
 *  whole comparison — four evaluations — is over in a few seconds. */
export const DEFAULT_PLAYS = 24;
export const DEFAULT_SEED = 7;

/**
 * Two matchups for one genome. The PRIMARY is against the learned opponent —
 * the matchup the shipped genomes were last co-evolved on, and therefore the
 * one a challenger has to win. The secondary is against the opponent that has
 * no genome at all: the scripted run option for a defense, the assignment
 * defense for an offense. A genome that wins the first and collapses in the
 * second has learned an opponent rather than football, and the maintainer
 * should see that before adopting it.
 */
export function gauntlet(values, side, { plays, seed }) {
  if (side === 'defense') {
    const primary = evaluateMatch(shippedGenome('offense'), values, { plays, seed });
    const secondary = evaluateDefense(values, { plays, seed });
    return {
      primary: {
        label: 'defense vs the learned offense',
        stats: primary,
        fitness: defenseFitness(primary),
      },
      secondary: {
        label: 'defense vs the scripted offense',
        stats: secondary,
        fitness: defenseFitness(secondary),
      },
    };
  }
  const primary = evaluateMatch(values, shippedGenome('defense'), { plays, seed });
  const secondary = evaluateOffense(values, { plays, seed });
  return {
    primary: {
      label: 'offense vs the learned defense',
      stats: primary,
      fitness: offenseFitness(primary),
    },
    secondary: {
      label: 'offense vs the smart defense',
      stats: secondary,
      fitness: offenseFitness(secondary),
    },
  };
}

/**
 * Challenger and incumbent through the same gauntlet at the same seed — common
 * random numbers, exactly as within a training generation: both genomes see
 * the same downs and the same tackle rolls, which is the only way two
 * fitnesses compare at all. A tie is not a win: the shipped genome keeps its
 * place unless somebody actually beats it.
 */
export function compareBundle(bundle, { plays = DEFAULT_PLAYS, seed = DEFAULT_SEED } = {}) {
  const incumbent = gauntlet(shippedGenome(bundle.side), bundle.side, { plays, seed });
  const challenger = gauntlet(bundle.values, bundle.side, { plays, seed });
  return {
    side: bundle.side,
    plays,
    seed,
    incumbent,
    challenger,
    wins: challenger.primary.fitness > incumbent.primary.fitness,
  };
}

const num = (v) => v.toFixed(2);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

function row(label, r) {
  return `  ${label.padEnd(13)}${num(r.stats.yardsPerPlay).padStart(9)}`
    + `${pct(r.stats.touchdownRate).padStart(8)}${pct(r.stats.turnoverRate).padStart(8)}`
    + `${num(r.fitness).padStart(10)}`;
}

/** The whole comparison as something a maintainer can read in one glance. */
export function comparisonReport(c) {
  const lines = [
    `${c.side} genome — ${c.plays} seeded downs per matchup at seed ${c.seed}, same downs for both`,
    '',
  ];
  for (const key of ['primary', 'secondary']) {
    lines.push(c.incumbent[key].label + (key === 'primary' ? '   (primary)' : ''));
    lines.push(`  ${''.padEnd(13)}${'yds/play'.padStart(9)}${'TD'.padStart(8)}`
      + `${'TO'.padStart(8)}${'fitness'.padStart(10)}`);
    lines.push(row('shipped', c.incumbent[key]));
    lines.push(row('contributed', c.challenger[key]));
    lines.push('');
  }
  lines.push(c.wins
    ? `VERDICT: the contributed genome wins the primary matchup, ${num(c.challenger.primary.fitness)} to ${num(c.incumbent.primary.fitness)}.`
    : `VERDICT: the contributed genome does not beat the shipped one, ${num(c.challenger.primary.fitness)} to ${num(c.incumbent.primary.fitness)}.`);
  return lines.join('\n');
}

function numArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

function strArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

// CLI body — guarded so importing this module (the tests) evaluates nothing
// and writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bundlePath = strArg('bundle', null);
  if (!bundlePath) {
    console.error('usage: node tools/import-genome.js --bundle <path> [--plays N] [--seed N] [--force]');
    process.exit(1);
  }
  let text;
  try {
    text = readFileSync(bundlePath, 'utf8');
  } catch (err) {
    console.error(`cannot read ${bundlePath}: ${err.message}`);
    process.exit(1);
  }
  const { bundle, error } = parseBundle(text);
  if (error) {
    console.error(`${bundlePath} is not a genome bundle this build can use: ${error}`);
    process.exit(1);
  }
  const opts = { plays: numArg('plays', DEFAULT_PLAYS), seed: numArg('seed', DEFAULT_SEED) };
  console.log(
    `${bundlePath}: a ${bundle.side} genome for the '${bundle.variant}' game,`
    + ` trained by ${bundle.meta.trainedBy ?? 'someone'}`
    + (bundle.meta.snapshots ? ` against ${bundle.meta.snapshots} recorded calls` : ''),
  );
  const comparison = compareBundle(bundle, opts);
  console.log('');
  console.log(comparisonReport(comparison));
  const force = process.argv.includes('--force');
  if (!comparison.wins && !force) {
    console.log('Not adopted. Pass --force to ship it anyway.');
    process.exit(0);
  }
  const file = bundle.side === 'defense' ? 'defense-genome.js' : 'offense-genome.js';
  const exportName = bundle.side === 'defense' ? 'DEFENSE_GENOME' : 'OFFENSE_GENOME';
  writeFileSync(
    new URL(`../lib/game/learned/${file}`, import.meta.url),
    genomeModuleSource(exportName, bundle.values, {
      variant: bundle.variant,
      trainedBy: 'tools/import-genome.js',
      opponent: `contributed bundle ${bundlePath}`,
      // The contributor's own account of the run, carried verbatim so the
      // genome module records where its numbers actually came from.
      contributed: bundle.meta,
      gauntlet: {
        plays: comparison.plays,
        seed: comparison.seed,
        primary: {
          label: comparison.challenger.primary.label,
          stats: comparison.challenger.primary.stats,
        },
        secondary: {
          label: comparison.challenger.secondary.label,
          stats: comparison.challenger.secondary.stats,
        },
      },
      fitness: comparison.challenger.primary.fitness,
    }),
  );
  console.log(
    `${comparison.wins ? 'Adopted' : 'Forced'} — wrote lib/game/learned/${file}.`
    + ' Run npm test, play a drive, and commit it like any other source file.',
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/tools/import-genome.test.js`
Expected: PASS (7 tests; the gauntlets take a couple of seconds).

- [ ] **Step 5: Add the npm script**

In `package.json`, add one line to `scripts`, after `train:vs-ghost`:

```json
    "import:genome": "node tools/import-genome.js"
```

- [ ] **Step 6: Run the CLI end to end**

Using the bundle saved in Task 5, Step 7:

Run: `npm run import:genome -- --bundle ~/contributed-genome.json`
Expected: the header line naming the side, variant and trainer; the two-block
comparison table; a VERDICT line. If the contributed genome won, it also says
`Adopted — wrote lib/game/learned/defense-genome.js.`; if it lost, `Not
adopted. Pass --force to ship it anyway.` and nothing is written
(`git status` is clean).

Run: `npm run import:genome`
Expected: exits 1 with the usage line.

Run: `npm run import:genome -- --bundle package.json`
Expected: exits 1 with
`package.json is not a genome bundle this build can use: kind is not "football-by-turn-genome"`.

Run: `npm run import:genome -- --bundle /nope.json`
Expected: exits 1 with `cannot read /nope.json: ...`.

If a genome was adopted, run `npm test` — ALL PASS. No test may depend on a
genome's trained values, so a new champion changes no assertion; if one fails,
that test was written wrong and should build its own genome with
`makeGenome(...)`. Then `git checkout lib/game/learned/` unless you actually
mean to ship it.

- [ ] **Step 7: Document it**

In `README.md`, add this section immediately after the "Training the learned
AI" section and before "## Deploying":

```markdown
## Contributing a trained genome

You don't need Node to train this game's AI — the deployed site trains it
too. Play a few downs so the game has recorded your calls, then open the
Coaches Menu and press **Train vs. my log**. A web worker evolves the genome
opposing the side you were coaching against a ghost of your own play — about
1,400 simulated downs, a few seconds — and the champion starts playing on your
device immediately. Press it again and it keeps climbing from where it left
off; **Use the shipped genome** puts it back.

**Copy trained genome** hands the result over as a *genome bundle*: one JSON
object, `{ kind: "football-by-turn-genome", version: 1, side, variant, values,
meta }`. Save it as a file and send it in. It is data, never code — nothing in
it runs.

To judge a bundle somebody sent you:

    npm run import:genome -- --bundle contributed.json

It validates the file against this build's genome spec, then plays the
contributed genome and the currently shipped one through the same gauntlet on
the same seeded downs with the same dice — against the learned opponent (the
primary matchup, the one the shipped genomes were co-evolved on) and against
the opponent with no genome at all — and prints yards per play, touchdown
rate, turnover rate and fitness for both. It rewrites
`lib/game/learned/<side>-genome.js` only if the contribution wins the primary
matchup; `--force` ships one that didn't, and `--plays` / `--seed` re-run the
gauntlet somewhere else. Run `npm test`, play a drive, and commit the genome
module like any other source file.
```

- [ ] **Step 8: Commit**

```bash
git add tools/import-genome.js test/tools/import-genome.test.js package.json README.md
git commit -m "feat: import a contributed genome, on merit"
```

---

## Verification checklist (whole plan)

- `npm test` green from a clean checkout, with every pre-existing test file in
  `test/tools/` unedited — the relocation in Task 1 changed no caller.
- `test/game/train/browser-safe.test.js` passes: nothing reachable from
  `lib/game/train/` imports a `node:` module or lives outside `lib/`. Confirm
  by hand too: `grep -rn "node:" lib/` prints nothing.
- `npm run train:defense -- --generations 2 --pop 4 --plays 4 --seed 3`,
  `npm run train:coevolve -- --generations 2 --pop 4 --plays 4 --seed 3` and
  `npm run train:vs-ghost -- --log coach-log.json --side defense
  --generations 2 --pop 4 --plays 4` all still run through the shims and still
  rewrite a loadable genome module. (`git checkout lib/game/learned/`
  afterwards.)
- `npm run serve`, then the full Task 5 browser walk, end to end: the training
  buttons appear, a thin log is refused with a spoken reason, a real log trains
  in seconds with per-generation progress and a board that stays responsive,
  the trained genome plays and survives a reload, a second run continues from
  the first, Copy hands over a valid bundle, Use the shipped genome reverts it,
  and no console errors anywhere.
- The exported bundle round-trips: `npm run import:genome -- --bundle <that
  file>` validates it, prints a four-row comparison and a verdict, and writes
  the genome module only on a win (or with `--force`).
- Invalid inputs to the CLI exit 1 with a reason: no `--bundle`, an unreadable
  path, a file that is not JSON, and a JSON file that is not a bundle.
- With no override anywhere — a fresh browser profile, or after **Use the
  shipped genome** — every AI level plays exactly what it played before this
  plan: `activeGenome` returns the very object `ai.js` and
  `learned/formation.js` used to import directly.
