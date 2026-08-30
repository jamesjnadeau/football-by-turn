import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepPhysics } from '../../lib/game/physics.js';
import { createGame, setPlan, getPlayer } from '../../lib/game/state.js';
import { maxSpeed } from '../../lib/game/modes.js';
import { DT, SUBSTEPS_PER_TURN } from '../../lib/game/constants.js';
import { len } from '../../lib/game/vec.js';

function run(state, substeps) {
  for (let i = 0; i < substeps; i++) stepPhysics(state, DT);
}

test('a planned player accelerates toward its arrow and tops out at maxSpeed', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const y0 = rb.pos.y;
  run(s, SUBSTEPS_PER_TURN * 4); // two seconds, plenty to saturate
  assert.ok(rb.pos.y > y0 + 10, 'moved downfield');
  assert.ok(len(rb.vel) <= maxSpeed(rb) + 1e-6, 'never exceeds max speed');
  assert.ok(len(rb.vel) > maxSpeed(rb) * 0.95, 'reached max speed');
});

test('half throttle targets half speed', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.5);
  run(s, SUBSTEPS_PER_TURN * 4);
  const v = len(rb.vel);
  assert.ok(Math.abs(v - maxSpeed(rb) * 0.5) < maxSpeed(rb) * 0.05, `got ${v}`);
});

test('a planless player with velocity coasts and slows', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  rb.vel = { x: 0, y: 20 };
  run(s, SUBSTEPS_PER_TURN);
  assert.ok(len(rb.vel) < 20, 'damped');
  assert.ok(rb.pos.y > getPlayer(createGame({ seed: 1 }), 'o-rb').pos.y, 'still drifted');
});

test('a charged player closes the gap to target speed faster than an uncharged one', () => {
  const a = createGame({ seed: 1 });
  const b = createGame({ seed: 1 });
  setPlan(a, 'o-rb', { x: 0, y: 1 }, 1);
  setPlan(b, 'o-rb', { x: 0, y: 1 }, 1);
  getPlayer(b, 'o-rb').charge = 1;
  run(a, 6);
  run(b, 6);
  assert.ok(len(getPlayer(b, 'o-rb').vel) > len(getPlayer(a, 'o-rb').vel));
});

test('a loose ball rolls and decays', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: null, pos: { x: 135, y: 100 }, vel: { x: 10, y: 0 } };
  run(s, SUBSTEPS_PER_TURN);
  assert.ok(s.ball.pos.x > 135, 'rolled');
  assert.ok(len(s.ball.vel) < 10, 'slowed');
});
