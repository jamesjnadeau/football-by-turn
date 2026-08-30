import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  predictDestination, travelAlong, maxTravelAlong, throttleForDistance, planForDrag, predictOwnDestination,
} from '../../lib/game/predict.js';
import { createGame, getPlayer, setPlan } from '../../lib/game/state.js';
import { stepPhysics } from '../../lib/game/physics.js';
import { DT, SUBSTEPS_PER_TURN, MAX_ARROW_UNITS } from '../../lib/game/constants.js';

const DOWN = { x: 0, y: 1 };

/** A game trimmed to one player, so nothing can collide with him. */
function solo(id) {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === id);
  return s;
}

test('from a standstill a turn is worth exactly 7.75 units, whatever the size', () => {
  // ACCEL * DT is exactly 1 u/s per sub-step and nobody's maxSpeed is reached
  // inside 30 of them, so velocity ramps 1..30 and the distance is
  // (1+2+...+30) * DT = 465/60. The same for a lineman as for a receiver.
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  const c = getPlayer(solo('o-c'), 'o-c');
  assert.ok(Math.abs(maxTravelAlong(rb, DOWN) - 7.75) < 1e-9, `rb ${maxTravelAlong(rb, DOWN)}`);
  assert.ok(Math.abs(maxTravelAlong(c, DOWN) - 7.75) < 1e-9, `c ${maxTravelAlong(c, DOWN)}`);
});

test('a lower throttle covers proportionally less ground', () => {
  // Quarter throttle targets 15 u/s: velocity ramps 1..15 then holds 15 for the
  // remaining 15 sub-steps. (120 + 225) / 60 = 5.75.
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  assert.ok(Math.abs(travelAlong(rb, DOWN, 0.25) - 5.75) < 1e-9);
});

test('a player already moving reaches much further', () => {
  const s = solo('o-rb');
  const rb = getPlayer(s, 'o-rb');
  rb.vel = { x: 0, y: 30 };
  // Velocity ramps 31..60 and caps there: (31+60)*30/2 / 60 = 22.75.
  assert.ok(Math.abs(maxTravelAlong(rb, DOWN) - 22.75) < 1e-9);
});

test('the predicted destination is where an uncontested turn actually puts him', () => {
  const s = solo('o-rb');
  const rb = getPlayer(s, 'o-rb');
  const predicted = predictDestination(rb, DOWN, 0.4);
  setPlan(s, 'o-rb', DOWN, 0.4);
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) stepPhysics(s, DT);
  assert.ok(Math.abs(rb.pos.x - predicted.x) < 1e-9, 'x');
  assert.ok(Math.abs(rb.pos.y - predicted.y) < 1e-9, 'y');
});

test('predicting does not move the player it predicts for', () => {
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  const pos = { ...rb.pos };
  const vel = { ...rb.vel };
  predictDestination(rb, DOWN, 1);
  assert.deepEqual(rb.pos, pos);
  assert.deepEqual(rb.vel, vel);
  assert.equal(rb.plan, null);
});

test('throttleForDistance inverts travelAlong', () => {
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  const t = throttleForDistance(rb, DOWN, 5.75);
  assert.ok(Math.abs(t - 0.25) < 1e-3, `got ${t}`);
  assert.ok(Math.abs(travelAlong(rb, DOWN, t) - 5.75) < 1e-3);
});

test('throttleForDistance saturates rather than throwing', () => {
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  assert.equal(throttleForDistance(rb, DOWN, 1000), 1);
  assert.equal(throttleForDistance(rb, DOWN, -50), 0);
});

test('a reachable drag becomes a target the player lands on', () => {
  const s = solo('o-rb');
  const rb = getPlayer(s, 'o-rb');
  const plan = planForDrag(rb, { x: 0, y: 5 });
  assert.ok(plan.target, 'reachable drags carry a target');
  assert.ok(plan.throttle < 1, 'and cost less than full throttle');
  assert.ok(Math.abs(plan.target.y - (rb.pos.y + 5)) < 1e-2, 'landing on the drag point');
  setPlan(s, 'o-rb', plan.dir, plan.throttle);
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) stepPhysics(s, DT);
  assert.ok(Math.abs(rb.pos.y - plan.target.y) < 1e-9, 'the circle did not lie');
});

test('a reachable drag is not short', () => {
  const rb = getPlayer(solo('o-rb'), 'o-rb');
  assert.equal(planForDrag(rb, { x: 0, y: 5 }).short, false);
});

test('a drag past his reach keeps the target and pins the throttle', () => {
  const s = solo('o-rb');
  const rb = getPlayer(s, 'o-rb');
  const plan = planForDrag(rb, { x: 0, y: MAX_ARROW_UNITS });
  assert.equal(plan.throttle, 1);
  assert.deepEqual(plan.dir, DOWN);
  assert.equal(plan.short, true, 'he falls short of where the finger went');
  assert.ok(plan.target, 'but the board still says where he does get to');
  assert.ok(
    Math.abs(plan.target.y - (rb.pos.y + 7.75)) < 1e-9,
    'a full-throttle turn from a standstill, not the drag point',
  );
  setPlan(s, 'o-rb', plan.dir, plan.throttle);
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) stepPhysics(s, DT);
  assert.ok(Math.abs(rb.pos.y - plan.target.y) < 1e-9, 'the circle did not lie');
});

test('a moving player cannot be asked to stop short of his own coast', () => {
  // Throttle 0 still leaves him coasting; a drag shorter than that coast is
  // honoured as "as slow as you can", not as an unreachable spot.
  const s = solo('o-rb');
  const rb = getPlayer(s, 'o-rb');
  rb.vel = { x: 0, y: 40 };
  const plan = planForDrag(rb, { x: 0, y: 1 });
  assert.equal(plan.throttle, 0);
  assert.ok(plan.target, 'still a destination, just further out than asked');
  assert.ok(plan.target.y > rb.pos.y + 1, 'the circle shows the truth');
});

test('a player\'s own plan predicts where the whistle leaves him', () => {
  const s = createGame({ seed: 1 });
  const wr = getPlayer(s, 'o-wr1');
  setPlan(s, 'o-wr1', { x: 0, y: 1 }, 1);
  const end = predictOwnDestination(wr);
  assert.ok(end.y > wr.pos.y, 'the arrow carried him downfield');
  assert.deepEqual(end, predictDestination(wr, { x: 0, y: 1 }, 1), 'his own arrow, replayed');
});

test('a man with no arrow at all coasts to a stop rather than sprinting', () => {
  const s = createGame({ seed: 1 });
  const wr = getPlayer(s, 'o-wr1');
  wr.vel = { x: 0, y: 40 };
  const end = predictOwnDestination(wr);
  assert.ok(end.y > wr.pos.y, 'his momentum still carries him');
  assert.ok(end.y < predictDestination(wr, { x: 0, y: 1 }, 1).y, 'but nothing is driving him on');
});
