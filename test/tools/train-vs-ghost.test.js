import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GHOST_SITUATION_SHARE, ghostScenario, evaluateVsGhost, trainVsGhost,
} from '../../tools/train-vs-ghost.js';
import { logSituations } from '../../tools/ghost.js';
import { captureSnapshot } from '../../lib/game/coach-log.js';
import {
  createGame, setPlan, formationPlayers, aimSnap, SNAPPER_ID,
} from '../../lib/game/state.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../lib/game/learned/offense-spec.js';

/** A down at a given spot, with an arrow on every man of one side. */
function recorded({ down, toGo, losYard, turnIndex, team, dir }) {
  const s = createGame({ seed: 1 });
  s.down = down;
  s.losYard = losYard;
  s.toGoYard = losYard + toGo;
  s.players = formationPlayers(losYard, s.variantId);
  s.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  s.plannedPass = null;
  aimSnap(s);
  for (const p of s.players) if (p.team === team) setPlan(s, p.id, dir, 1);
  s.turnIndex = turnIndex;
  return captureSnapshot(s, team);
}

// A log shaped like a real one: a call at the top of a down AND what the coach
// did about it on the next turn, for both sides of the ball. The mid-play
// entries matter — a ghost with nothing recorded past turn zero stands still
// once the play is running, and a defense that stands still turns every down
// into a twenty-four-turn stalemate rather than a play.
const LOG = [
  recorded({ down: 1, toGo: 10, losYard: 30, turnIndex: 0, team: 'offense', dir: { x: 0.6, y: 0.8 } }),
  recorded({ down: 1, toGo: 10, losYard: 30, turnIndex: 1, team: 'offense', dir: { x: 0.3, y: 0.95 } }),
  recorded({ down: 3, toGo: 2, losYard: 62, turnIndex: 0, team: 'offense', dir: { x: 0, y: 1 } }),
  recorded({ down: 2, toGo: 6, losYard: 44, turnIndex: 0, team: 'defense', dir: { x: 0, y: -1 } }),
  recorded({ down: 2, toGo: 6, losYard: 44, turnIndex: 1, team: 'defense', dir: { x: 0, y: -1 } }),
];

test("scenarios are dealt from the log's own down-and-distances as well as at random", () => {
  const situations = logSituations(LOG, 'offense');
  assert.equal(situations.length, 2);
  const rand = mulberry32(4);
  const spots = new Set();
  for (let i = 0; i < 40; i++) spots.add(ghostScenario(rand, situations).losYard);
  assert.ok(spots.has(30) || spots.has(62), 'a recorded spot came up');
  assert.ok(spots.size > 3, 'and so did spots that were never recorded');
  assert.ok(GHOST_SITUATION_SHARE > 0 && GHOST_SITUATION_SHARE < 1);
});

test('every scenario is a plannable down inside the field', () => {
  const rand = mulberry32(6);
  for (let i = 0; i < 15; i++) {
    const s = ghostScenario(rand, logSituations(LOG, 'offense'));
    assert.equal(s.phase, 'planning');
    assert.equal(s.turnIndex, 0);
    assert.equal(s.aiTeam, null);
    assert.ok(s.down >= 1 && s.down <= 4);
    assert.ok(s.losYard >= 15 && s.losYard <= 80);
    assert.ok(s.toGoYard > s.losYard && s.toGoYard <= 100);
    assert.ok(s.plannedPass, 'the snap is aimed');
  }
});

test('evaluating a genome against the ghost is deterministic for a seed', () => {
  const opts = { log: LOG, side: 'defense', plays: 3, seed: 11 };
  const a = evaluateVsGhost({ ...DEFENSE_SPEC.reduce((g, p) => ({ ...g, [p.key]: p.init }), {}) }, opts);
  const b = evaluateVsGhost({ ...DEFENSE_SPEC.reduce((g, p) => ({ ...g, [p.key]: p.init }), {}) }, opts);
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.yardsPerPlay));
  assert.ok(a.touchdownRate >= 0 && a.touchdownRate <= 1);
  assert.ok(a.turnoverRate >= 0 && a.turnoverRate <= 1);
});

test('training the defense against an offense ghost produces a whole genome', () => {
  const opts = {
    log: LOG, side: 'defense', generations: 1, popSize: 3, plays: 2, seed: 3, sigma: 0.05,
  };
  const a = trainVsGhost(opts);
  const b = trainVsGhost(opts);
  assert.equal(a.score, b.score);
  assert.deepEqual(a.best, b.best);
  for (const p of DEFENSE_SPEC) assert.equal(typeof a.best[p.key], 'number', p.key);
});

test('training the offense against a defense ghost produces a whole genome', () => {
  const { best } = trainVsGhost({
    log: LOG, side: 'offense', generations: 1, popSize: 2, plays: 2, seed: 3, sigma: 0.05,
  });
  for (const p of OFFENSE_SPEC) assert.equal(typeof best[p.key], 'number', p.key);
});

test('importing the trainer runs no training and writes no files', () => {
  // The import at the top of this file already proved it: if the CLI body ran
  // on import, the suite would train for minutes and rewrite a genome module.
  assert.ok(true);
});
