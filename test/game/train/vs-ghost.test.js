import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_GHOST_SNAPSHOTS, BROWSER_TRAINING_RUN, GENERAL_SEED_OFFSET,
  ghostReadiness, trainVsGhost, evaluateVsGhost, evaluateVsGeneralOffense,
  blendedDefenseFitness,
} from '../../../lib/game/train/vs-ghost.js';
import { captureSnapshot } from '../../../lib/game/coach-log.js';
import {
  createGame, setPlan, formationPlayers, aimSnap, SNAPPER_ID,
} from '../../../lib/game/state.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { defenseFitness } from '../../../lib/game/train/fitness.js';

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

// The blended defense objective: a candidate's fitness against the ghost and
// against the learned offense, weighted by ghostShare. The scripted-offense
// path (evaluateVsGhost/offenseFitness for `side: 'offense'`) is untouched by
// any of this — only the defense side blends.
test('ghostShare 1 reproduces the pure-ghost fitness exactly', () => {
  const values = makeGenome(DEFENSE_SPEC);
  const ghostLog = log('offense', 20);
  const plays = 3;
  const seed = 7;
  const blended = blendedDefenseFitness(values, {
    log: ghostLog, plays, seed, ghostShare: 1,
  });
  const pureGhost = defenseFitness(evaluateVsGhost(values, {
    log: ghostLog, side: 'defense', plays, seed,
  }));
  assert.equal(blended.score, pureGhost);
  assert.equal(blended.ghostScore, pureGhost);
});

test('ghostShare 0 reproduces the pure-general fitness exactly', () => {
  const values = makeGenome(DEFENSE_SPEC);
  const ghostLog = log('offense', 20);
  const plays = 3;
  const seed = 7;
  const blended = blendedDefenseFitness(values, {
    log: ghostLog, plays, seed, ghostShare: 0,
  });
  const pureGeneral = defenseFitness(evaluateVsGeneralOffense(values, {
    plays, seed: seed + GENERAL_SEED_OFFSET,
  }));
  assert.equal(blended.score, pureGeneral);
  assert.equal(blended.generalScore, pureGeneral);
});

test('ghostShare 0.5 lands exactly midway between the two', () => {
  const values = makeGenome(DEFENSE_SPEC);
  const ghostLog = log('offense', 20);
  const plays = 3;
  const seed = 9;
  const blended = blendedDefenseFitness(values, {
    log: ghostLog, plays, seed, ghostShare: 0.5,
  });
  assert.equal(blended.score, (blended.ghostScore + blended.generalScore) / 2);
});

test('the blended evaluation is deterministic: same genome, same seed, same score', () => {
  const values = makeGenome(DEFENSE_SPEC);
  const opts = {
    log: log('offense', 20), plays: 3, seed: 13, ghostShare: 0.5,
  };
  const a = blendedDefenseFitness(values, opts);
  const b = blendedDefenseFitness(values, opts);
  assert.deepEqual(a, b);
});
