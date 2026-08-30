import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isForward, passFoul, releasePass } from '../../lib/game/pass.js';
import { createGame, getPlayer, setPass } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';
import { len } from '../../lib/game/vec.js';
import {
  PASS_SPEED_MIN, PASS_SPEED_MAX, PASS_SPAWN_EPSILON, PASS_GRACE_SUBSTEPS,
  PICKUP_RADIUS_BONUS,
} from '../../lib/game/constants.js';

test('forward means toward the goal the offense attacks; a flat lateral is not', () => {
  assert.equal(isForward({ x: 0, y: 1 }), true);
  assert.equal(isForward({ x: 1, y: 0.001 }), true);
  assert.equal(isForward({ x: 0, y: -1 }), false);
  assert.equal(isForward({ x: 1, y: 0 }), false);
});

test('backward throws are always legal, however many have gone before', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  s.forwardPasses = 5;
  assert.equal(passFoul(s, qb, { x: 0, y: -1 }), null);
  assert.equal(passFoul(s, qb, { x: 1, y: 0 }), null);
});

test('the first forward pass from behind the line is legal; a second is not', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  assert.equal(passFoul(s, qb, { x: 0, y: 1 }), null);
  s.forwardPasses = 1;
  assert.equal(passFoul(s, qb, { x: 0, y: 1 }), 'second-forward-pass');
});

test('a forward pass from beyond the line of scrimmage is illegal', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  qb.pos = fieldPos(0, s.losYard + 2); // he crossed the line before throwing
  assert.equal(passFoul(s, qb, { x: 0, y: 1 }), 'illegal-forward-pass');
  assert.equal(passFoul(s, qb, { x: 0, y: -1 }), null, 'he may still throw backwards');
});

test('releasing a throw puts the ball in the air, clear of the passer\'s own reach', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const from = { ...qb.pos };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const events = releasePass(s);
  assert.equal(s.ball.carrierId, null);
  assert.equal(s.ball.forward, true);
  assert.equal(s.ball.loose, PASS_GRACE_SUBSTEPS);
  assert.ok(Math.abs(len(s.ball.vel) - PASS_SPEED_MAX) < 1e-9, 'full power');
  const off = Math.hypot(s.ball.pos.x - from.x, s.ball.pos.y - from.y);
  assert.ok(off > qb.radius + PICKUP_RADIUS_BONUS, 'outside his own scoop range');
  assert.ok(Math.abs(off - (qb.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON)) < 1e-9);
  assert.deepEqual(events, [{ type: 'pass', by: 'o-qb', forward: true }]);
  assert.equal(s.forwardPasses, 1);
  assert.equal(s.penalty, null);
});

test('an illegal throw is allowed to happen, and flagged', () => {
  const s = createGame({ seed: 1 });
  s.forwardPasses = 1; // he already threw one this down
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5);
  const events = releasePass(s);
  assert.equal(s.ball.carrierId, null, 'the throw still happens');
  assert.deepEqual(s.penalty, { foul: 'second-forward-pass', spot: s.losYard });
  assert.deepEqual(events[1], { type: 'flag', foul: 'second-forward-pass' });
  assert.equal(s.forwardPasses, 2, 'an illegal forward pass still counts as one');
});

test('a backward throw touches neither the forward tally nor the flag', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: -1 }, 0.3);
  releasePass(s);
  assert.equal(s.forwardPasses, 0);
  assert.equal(s.penalty, null);
  assert.equal(s.ball.forward, false);
});

test('power scales the throw from the shortest handoff to the longest bomb', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: -1 }, 0);
  releasePass(s);
  assert.ok(Math.abs(len(s.ball.vel) - PASS_SPEED_MIN) < 1e-9, 'zero power is still a handoff');
});

test('a fumble between planning and the whistle cancels the throw', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  s.ball = { carrierId: 'o-rb', pos: null, vel: null }; // somebody else has it now
  assert.deepEqual(releasePass(s), []);
  assert.equal(s.ball.carrierId, 'o-rb', 'the ball stays where it is');
  assert.equal(s.forwardPasses, 0);
});

test('nothing planned, nothing thrown', () => {
  const s = createGame({ seed: 1 });
  assert.deepEqual(releasePass(s), []);
  assert.equal(s.ball.carrierId, 'o-qb');
});

test('only the first flag of a down is kept', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  releasePass(s);                       // legal: the down's one forward pass
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  releasePass(s);                       // illegal: second forward pass
  const first = { ...s.penalty };
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  releasePass(s);                       // illegal again
  assert.deepEqual(s.penalty, first, 'one flag per down, the first one');
  assert.equal(s.forwardPasses, 3);
});
