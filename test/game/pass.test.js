import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isForward, passFoul, releasePass,
  passSpeed, passReach, passTravel, powerForTravel, passOrigin, passAim,
} from '../../lib/game/pass.js';
import { createGame, getPlayer, setPass } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';
import { len } from '../../lib/game/vec.js';
import {
  PASS_SPEED_MIN, PASS_SPEED_MAX, PASS_SPAWN_EPSILON, PASS_GRACE_SUBSTEPS,
  PICKUP_RADIUS_BONUS, PASS_REACH_MAX, DT, BALL_FRICTION, SUBSTEPS_PER_TURN,
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

test('a non-unit direction does not secretly change the throw\'s power', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: 3 }, 1); // three times as long as a unit vector
  releasePass(s);
  assert.ok(Math.abs(len(s.ball.vel) - PASS_SPEED_MAX) < 1e-9, 'full power, not triple');
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

test('a throw\'s speed and its total reach are one arithmetic, shared with the ball', () => {
  assert.ok(Math.abs(passSpeed(0) - PASS_SPEED_MIN) < 1e-9);
  assert.ok(Math.abs(passSpeed(1) - PASS_SPEED_MAX) < 1e-9);
  // The closed form of physics.js's per-sub-step decay, summed out.
  assert.ok(Math.abs(passReach(1) - (PASS_SPEED_MAX * DT) / (1 - BALL_FRICTION)) < 1e-9);
  assert.ok(Math.abs(passReach(1) - PASS_REACH_MAX) < 1e-9, 'the constant is that same number');
  assert.ok(passReach(1) > 111 && passReach(1) < 111.2, 'the longest throw: 111 units, 29.6 yards');
  assert.ok(passReach(0) > 16.6 && passReach(0) < 16.8, 'the shortest: 4.4 yards, a handoff');
});

test('a throw only gets part of the way inside its own turn', () => {
  const whole = passReach(1);
  const turn = passTravel(1, SUBSTEPS_PER_TURN);
  assert.ok(turn < whole, 'the decay never quite arrives');
  assert.ok(Math.abs(turn / whole - 0.8437) < 1e-3, 'about 84% of it in half a second');
  assert.equal(passTravel(1, 0), 0, 'nothing has been thrown yet');
});

test('powerForTravel is the inverse: the power that gets the ball there this turn', () => {
  const units = passTravel(0.4, SUBSTEPS_PER_TURN);
  assert.ok(Math.abs(powerForTravel(units) - 0.4) < 1e-6);
  assert.equal(powerForTravel(0), 0, 'nothing to cover is the softest throw there is');
  assert.equal(powerForTravel(10000), 1, 'and no drag throws it further than full power');
});

test('a throw starts at the passer\'s leading edge and is aimed a reach beyond it', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const origin = passOrigin(qb, { x: 0, y: 2 }); // non-unit on purpose
  const edge = qb.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON;
  assert.ok(Math.abs(origin.y - (qb.pos.y + edge)) < 1e-9, 'his leading edge, not his centre');
  assert.ok(Math.abs(origin.x - qb.pos.x) < 1e-9);
  const aim = passAim(qb, { x: 0, y: 2 }, 1);
  assert.ok(Math.abs(aim.y - (origin.y + passReach(1))) < 1e-9, 'a full reach past the hand');
});
