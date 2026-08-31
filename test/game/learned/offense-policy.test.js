import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxDefenders, callFeatures, chooseCall, chooseSide,
} from '../../../lib/game/learned/offense-policy.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { createGame, getPlayer, ballPos } from '../../../lib/game/state.js';
import { fieldPos } from '../../../lib/game/view.js';

test('the box is the defenders crowding the line near the ball', () => {
  const s = createGame({ seed: 1 });
  // The '7' front: three linemen a yard off the ball, corners 15 wide,
  // backer 4 deep, safety 8 deep — the box is exactly the front three.
  assert.deepEqual(
    boxDefenders(s).map((p) => p.id).sort(),
    ['d-dt1', 'd-dt2', 'd-nt'],
  );
});

test('callFeatures normalizes the situation', () => {
  const s = createGame({ seed: 1 });
  const f = callFeatures(s);
  assert.equal(f.down, 0);
  assert.equal(f.toGo, 1);
  assert.equal(f.box, 3 / 7);
});

test('the call gate is a thresholded logit; the seed genome runs on 1st and 10', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(OFFENSE_SPEC); // bias -2, toGo 1, box 1
  assert.equal(chooseCall(s, g), 'run');
  assert.equal(chooseCall(s, { ...g, 'call:bias': 2 }), 'pass');
  // Stack the box and a box-weighted genome starts throwing.
  const stacked = { ...g, 'call:bias': -1.5, 'call:box': 4 };
  assert.equal(chooseCall(s, stacked), 'pass'); // -1.5 + 1 + 4·(3/7) > 0
});

test('the run goes away from the heavier side of the box', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(OFFENSE_SPEC);
  const ball = ballPos(s);
  // Shift the whole front left of the ball: run right.
  for (const id of ['d-nt', 'd-dt1', 'd-dt2']) {
    getPlayer(s, id).pos = fieldPos(-4, s.losYard + 1);
  }
  assert.equal(chooseSide(s, g), 1);
  // Shift it right: run left.
  for (const id of ['d-nt', 'd-dt1', 'd-dt2']) {
    getPlayer(s, id).pos = fieldPos(4, s.losYard + 1);
  }
  assert.equal(chooseSide(s, g), -1);
});
