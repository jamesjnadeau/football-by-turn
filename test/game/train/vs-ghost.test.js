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
import { DEFENSE_GENOME } from '../../../lib/game/learned/defense-genome.js';
import { setCover } from '../../../lib/game/cover.js';
import { evaluateVsGhost } from '../../../lib/game/train/vs-ghost.js';

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

test('a ghost who blocks a lineman survives the defense substituting him off', () => {
  // The failure this guards: a coach who puts his right guard on the right
  // tackle — an ordinary blocking order, and the commonest one in a real
  // recorded log — has that order replayed onto the board by the ghost, and
  // then the candidate defense subs to nickel, which is the package that
  // takes d-dt2 off the field. The order is left pointed at a man who is no
  // longer playing, and the turn dies on him.
  const snaps = Array.from({ length: MIN_GHOST_SNAPSHOTS + 4 }, (_, i) => {
    const s = createGame({ seed: 1 + i, variant: '7' });
    setCover(s, 'o-rg', 'd-dt2');
    s.down = 1 + (i % 4);
    s.turnIndex = i % 3;
    return captureSnapshot(s, 'offense');
  });
  // The shipped genome never leaves stacked, so the bias is forced: what is
  // under test is a candidate that DOES sub, which is what evolve's own walk
  // reaches within a generation or two of any seed.
  const values = { ...DEFENSE_GENOME.values, 'sub:nickel:bias': 5 };
  assert.doesNotThrow(() => evaluateVsGhost(values, {
    log: snaps, side: 'defense', plays: 4, seed: 7,
  }));
});
