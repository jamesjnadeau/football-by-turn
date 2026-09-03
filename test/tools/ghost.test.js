import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SITUATION_WEIGHTS, loadGhostLog, liveSituation, situationDistance,
  nearestSnapshot, ghostCoach, logSituations,
} from '../../tools/ghost.js';
import { captureSnapshot, serializeCoachLog } from '../../lib/game/coach-log.js';
import {
  createGame, getPlayer, setPlan, formationPlayers, aimSnap, SNAPPER_ID,
} from '../../lib/game/state.js';

/** A down dealt at a given spot and distance, with one arrow on it. */
function recorded({ down, toGo, losYard, dir, team = 'offense', id = 'o-rb' }) {
  const s = createGame({ seed: 1 });
  s.down = down;
  s.losYard = losYard;
  s.toGoYard = losYard + toGo;
  s.players = formationPlayers(losYard, s.variantId);
  s.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  s.plannedPass = null;
  aimSnap(s);
  setPlan(s, id, dir, 1);
  return captureSnapshot(s, team);
}

const LOG = [
  recorded({ down: 1, toGo: 10, losYard: 20, dir: { x: 1, y: 0 } }),
  recorded({ down: 3, toGo: 2, losYard: 50, dir: { x: 0, y: 1 } }),
  recorded({ down: 3, toGo: 2, losYard: 50, dir: { x: 0, y: 1 }, team: 'defense', id: 'd-lb' }),
];

test('a situation is nearer itself than anything else', () => {
  const here = LOG[0].situation;
  assert.equal(situationDistance(here, here), 0);
  assert.ok(situationDistance(here, LOG[1].situation) > 0);
  for (const k of ['down', 'toGo', 'losYard', 'turnIndex']) {
    assert.ok(SITUATION_WEIGHTS[k] > 0, k);
  }
});

test('a different game is not a nearer situation, it is no situation at all', () => {
  const a = LOG[0].situation;
  assert.equal(situationDistance(a, { ...a, variant: '11' }), Infinity);
  assert.equal(nearestSnapshot(LOG, { ...a, variant: '11' }), null);
});

test('nearestSnapshot picks the closest down on the right side of the ball', () => {
  const near3rdShort = {
    down: 3, toGo: 3, losYard: 48, turnIndex: 0, variant: '7', side: 'offense',
  };
  assert.equal(nearestSnapshot(LOG, near3rdShort), LOG[1]);
  // The same situation from the other side of the ball finds the other entry.
  assert.equal(nearestSnapshot(LOG, { ...near3rdShort, side: 'defense' }), LOG[2]);
  const near1st = {
    down: 1, toGo: 9, losYard: 25, turnIndex: 0, variant: '7', side: 'offense',
  };
  assert.equal(nearestSnapshot(LOG, near1st), LOG[0]);
});

test('the ghost puts the recorded call on the board', () => {
  const s = createGame({ seed: 9 });
  s.down = 3;
  s.toGoYard = s.losYard + 2;
  assert.equal(getPlayer(s, 'o-rb').plan, null);
  ghostCoach(LOG, 'offense')(s);
  assert.deepEqual(getPlayer(s, 'o-rb').plan.dir, { x: 0, y: 1 });
  assert.equal(getPlayer(s, 'd-lb').plan, null, 'the defense is not his to coach');
});

test('the ghost is deterministic and coaches every turn', () => {
  const run = () => {
    const s = createGame({ seed: 9 });
    const ghost = ghostCoach(LOG, 'offense');
    ghost(s);
    const first = { ...getPlayer(s, 'o-rb').plan.dir };
    s.turnIndex = 2;
    ghost(s);
    return [first, { ...getPlayer(s, 'o-rb').plan.dir }];
  };
  assert.deepEqual(run(), run());
});

test('a ghost with nothing recorded for his side simply does nothing', () => {
  const s = createGame({ seed: 9 });
  ghostCoach([], 'offense')(s);
  assert.equal(getPlayer(s, 'o-rb').plan, null);
  assert.equal(liveSituation(s, 'offense').side, 'offense');
});

test('logSituations lists the first-turn situations for one side', () => {
  const off = logSituations(LOG, 'offense');
  assert.equal(off.length, 2);
  assert.deepEqual(off.map((x) => x.down).sort(), [1, 3]);
  assert.equal(logSituations(LOG, 'defense').length, 1);
});

test('loadGhostLog reads a log off disk', () => {
  const path = join(tmpdir(), `fbt-ghost-${process.pid}.json`);
  try {
    writeFileSync(path, serializeCoachLog(LOG));
    assert.deepEqual(loadGhostLog(path), LOG);
  } finally {
    rmSync(path, { force: true });
  }
});

test('an offense ghost matches across personnel packages', () => {
  const a = { down: 1, toGo: 10, losYard: 20, turnIndex: 0, variant: '7', side: 'offense' };
  const b = { ...a, variant: '7-nickel' };
  assert.ok(Number.isFinite(situationDistance(a, b)));
  // The package is not a difference it should pay for, either.
  assert.equal(situationDistance(a, b), situationDistance(a, { ...a }));
});

test('a defense ghost does not match across personnel packages', () => {
  const a = { down: 1, toGo: 10, losYard: 20, turnIndex: 0, variant: '7', side: 'defense' };
  const b = { ...a, variant: '7-nickel' };
  assert.equal(situationDistance(a, b), Infinity);
});

test('neither side matches across base variants', () => {
  for (const side of ['offense', 'defense']) {
    const a = { down: 1, toGo: 10, losYard: 20, turnIndex: 0, variant: '7', side };
    assert.equal(situationDistance(a, { ...a, variant: '11' }), Infinity);
    assert.equal(situationDistance(a, { ...a, variant: '11-nickel' }), Infinity);
  }
});
