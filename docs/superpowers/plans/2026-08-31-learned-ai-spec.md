# Learned AI ("v2") — Spec and Scope

The requirements for a learned, self-play-trained AI for football-by-turn:
offense and defense agents that co-evolve against each other, replacing/
augmenting the rule-based brains in `lib/game/ai.js`, `lib/game/defense.js`
and `lib/game/offense.js`. This document is the spec the two implementation
plans argue from:

- `docs/superpowers/plans/2026-08-31-learned-defense.md` — **first**: the
  shared learning foundation (genomes, training harness, evolution loop) plus
  the learned defense and its in-game integration.
- `docs/superpowers/plans/2026-08-31-learned-offense.md` — **second**: the
  learned offense, true competitive co-evolution, and its in-game integration.

## Requirements (the user's ask, verbatim in substance)

**Both sides learn:**

- **Starting positions** — each side learns per-player starting offsets from
  the line of scrimmage (not limited to the hardcoded rosters in
  `lib/game/rosters.js`); formation is a learned/searchable parameter, not a
  fixed lookup table.
- **Play-calling / in-play decisions** — offense learns run vs. pass, run
  direction, and receiver targeting (building on the run-option heuristic in
  `lib/game/offense.js` as a starting point, not necessarily its final form).
  Defense learns coverage assignment (who covers whom) and coverage scheme
  choice (man vs. a new zone concept — zone coverage does not exist yet, only
  man via `defense.js`'s `assignCoverage`).

**Training approach:** zero npm dependencies and no build step (the
project-wide ethos) — a hand-rolled evolutionary / population-based self-play
search over parameter vectors, run as a Node script against the headless
synchronous engine (`createGame` + `runTurn`), no browser and no deep-RL
framework.

**Reward signals** (already available, no new instrumentation): yards gained
per play from the ball's final yard vs. the line of scrimmage; outcomes from
`state.deadReason` / `state.result` (`touchdown`, `recovered` →
`turnover-fumble`, `turnover-on-downs`); per-sub-step events from `runTurn`
(`tackled`/`fumble`/`touchdown`/…).

- Defense objective: minimize yards gained per play; reward turnovers.
- Offense objective: maximize yards gained per play; reward touchdowns.

**Competitive dynamic:** the two learners co-evolve — trained in tandem
against each other across many simulated plays, so each side's improvement
pressures the other.

**Integration:** trained policies are selectable in the real game alongside
the existing pursuit/smart levels (`state.aiLevel`, `ai.js`'s `AI_MODES`) —
not just an offline research artifact.

## Decomposition decision

The user asked for exactly **two plans — Defense first, then Offense** —
rather than four (harness / offense / defense / integration). Consequences:

- The **shared foundation travels with the Defense plan**, because it is
  needed first: genome utilities, the episode harness, the evolution loop,
  and the `applyOrders`/`AI_MODES` integration seams in `ai.js`.
- Each plan **ends with working, integrated software**: the Defense plan
  ships a playable `aiLevel: 'learned'` defense; the Offense plan ships a
  playable computer-coached offense and the co-evolution trainer.
- **Bootstrap opponent:** true co-evolution needs both learners, so the
  Defense plan trains its first genome against the existing scripted offense
  autoplan (`autoplanOffense`) as an interim opponent only. The Offense plan
  replaces that with population-vs-population co-evolution (with a small hall
  of fame to damp cycling) and retrains both genomes; that final training run
  is the one that satisfies the "not against the static rule-based AI"
  requirement.

## Design decisions (fixed for both plans)

1. **Representation:** a policy is a flat `{key: number}` genome governed by a
   static spec (`{key, min, max, init}` per parameter). Learned behavior =
   hand-written structure (feature extraction, greedy assignment, dispatch)
   with learned numbers in every joint — the same shape as the existing
   `constants.js` knobs, but per-policy and searchable. No neural net; the
   parameter count (~30 a side) suits evolution strategies far better and
   stays inspectable.
2. **Search:** (μ+λ)-style elitist evolution with Gaussian mutation, seeded
   RNG (`mulberry32`) end to end. Within a generation, all candidates are
   scored on the **same** scenario seeds (common random numbers) to cut
   evaluation variance.
3. **Episode = one play**, from a randomized down/distance/spot scenario, run
   to the whistle (with a turn cap as a stalemate guard). Per-play scoring is
   lower-variance and better-attributed than per-drive.
4. **Training runs hot-seat** (`aiTeam: null`): the harness writes both
   teams' plans each planning phase, so no half-built game mode is needed to
   train, and `coachAi` inside `runTurn` stays inert.
5. **Genomes ship as generated JS modules** under `lib/game/learned/`
   (`defense-genome.js`, `offense-genome.js`), because the game is no-build
   ES modules in the browser and the deploy workflow copies `lib/`. Trainers
   overwrite these files; they are committed like any other source.
6. **Scope of learned formations:** genome formation offsets are keyed by
   player id for the default `'7'` variant. On other variants the learned
   *brain* still plays (it reads positions off the field, like `defense.js`),
   but formation offsets apply only where the ids match — elsewhere the
   roster's own spots stand.
7. **What stays rule-based:** the defensive front's rush/contain and the
   converge-when-past-the-line logic (`rushLineman`, `leverageAim`,
   `interceptPoint`) are reused as-is — the learned defense learns *scheme,
   assignment and alignment*, not how to run a pursuit angle. Likewise the
   offense reuses `daylightDirection` and the block-assignment helpers.
8. **In-game modes:** the Defense plan adds `{ai: 'defense', level:
   'learned'}` to `AI_MODES`; the Offense plan adds `{ai: 'offense', level:
   'learned'}` (the human coaches the defense). Hot-seat stays the last
   entry. The button cycle in `app/main.js` is already data-driven and needs
   no app changes.

## Out of scope

- Learned per-sub-step motor control (arrows stay per-turn, like every coach).
- Learning across variants other than `'7'` (the machinery generalizes; the
  shipped genomes target the default game).
- Any new dependency, build step, or non-deterministic training.
