/**
 * Integration tests: these drive the COMPOSED path — `runTurn` calling
 * stepPhysics, checkDeadBall, checkTackles and checkPickup in the real order,
 * over real sub-steps — rather than poking one rule function with a
 * hand-built state. Two whole-game bugs only showed up here:
 *
 *  1. A fumble used to be inert: the ball spawned on top of the fumbler and
 *     checkPickup ran in the same sub-step, so the fumbler always re-claimed
 *     it instantly and no defence could ever recover.
 *  2. A tackle used to be able to cancel a touchdown that had already
 *     physically happened in the same sub-step.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../../lib/game/turn.js';
import { checkDeadBall } from '../../lib/game/rules.js';
import { createGame, getPlayer, setMode, setPlan } from '../../lib/game/state.js';
import { fieldPos, GOAL_YARD } from '../../lib/game/view.js';
import {
  DT, FUMBLE_BALL_SPEED, BALL_FRICTION, LOOSE_BALL_GRACE_SUBSTEPS,
  PICKUP_RADIUS_BONUS, FUMBLE_SPAWN_EPSILON, RADIUS_MID,
} from '../../lib/game/constants.js';

/** A game trimmed to the players a scenario names; carrier stays the QB. */
/**
 * The snap taken: the ball in the quarterback's hands and nothing pending.
 * A down now opens with the ball on the CENTRE and a lateral to the
 * quarterback already planned, which is the state before the one these tests
 * are about.
 */
function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

function scenario(ids) {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => ids.includes(p.id));
  // These scenarios are about what happens once someone is running with the
  // ball, so they start from the snap already taken. Left alone, the down
  // opens with the ball on a centre this filter has usually thrown away.
  return afterSnap(s);
}

/** A scripted `random`: the listed rolls in order, then 0.99 (fail everything). */
function rolls(seq) {
  let i = 0;
  return () => (i < seq.length ? seq[i++] : 0.99);
}

/** Closed form for how far a loose ball has rolled after n sub-steps. */
function looseTravel(n) {
  return (FUMBLE_BALL_SPEED * DT * (1 - BALL_FRICTION ** n)) / (1 - BALL_FRICTION);
}

const FUMBLE_ORIGIN = { x: 135, y: 100 };
// The scripted angle roll below is 0.5 → angle = π → the ball pops out along −x.
const SPAWN_OFFSET = RADIUS_MID + PICKUP_RADIUS_BONUS + FUMBLE_SPAWN_EPSILON;
const SPAWN = { x: FUMBLE_ORIGIN.x - SPAWN_OFFSET, y: FUMBLE_ORIGIN.y };
// Where the ball is on the first sub-step anyone is allowed to touch it.
const BALL_AT_GRACE_END = {
  x: SPAWN.x - looseTravel(LOOSE_BALL_GRACE_SUBSTEPS),
  y: FUMBLE_ORIGIN.y,
};

/**
 * QB carrying at FUMBLE_ORIGIN, LB touching him. The rolls are
 * [tackle succeeds, fumble happens, pop-out angle] — everything after that is
 * 0.99, which fails every later tackle roll.
 */
function fumbleSetup(extraIds) {
  const s = scenario(['o-qb', 'd-lb', ...extraIds]);
  getPlayer(s, 'o-qb').pos = { ...FUMBLE_ORIGIN };
  getPlayer(s, 'd-lb').pos = { x: 135, y: 106 }; // exactly at reach, no overlap
  return s;
}

test('integration: a fumble puts the ball on the ground, outside the fumbler\'s reach', () => {
  const s = fumbleSetup([]);
  const { frames, events } = runTurn(s, rolls([0, 0, 0.5]));
  assert.ok(events.some((e) => e.type === 'fumble'), 'the hit forced a fumble');
  assert.ok(
    !events.some((e) => e.type === 'pickup'),
    'nobody is standing where the ball popped out, so it stays loose all turn',
  );
  assert.equal(s.ball.carrierId, null);
  assert.equal(s.deadReason, null, 'a loose ball keeps the play alive');
  // It spawned off the fumbler's body, not on it.
  assert.ok(
    Math.hypot(frames[0].looseBall.x - FUMBLE_ORIGIN.x, frames[0].looseBall.y - FUMBLE_ORIGIN.y)
      > RADIUS_MID + PICKUP_RADIUS_BONUS,
    'the pop-out clears the fumbler\'s own pickup radius',
  );
  // And it actually travelled: total roll-out is ~12.5 units (3.3 yards).
  const travelled = Math.hypot(s.ball.pos.x - SPAWN.x, s.ball.pos.y - SPAWN.y);
  assert.ok(travelled > 8, `loose ball rolled a contestable distance (${travelled.toFixed(2)} units)`);
});

test('integration: a player standing on the loose ball cannot claim it until the grace period expires', () => {
  const s = fumbleSetup(['d-cb1']);
  // Parked in the pop-out's path, 3 units from where the ball lands — inside
  // his 3.5-unit pickup range from the very first loose sub-step, but 7.5
  // units from the carrier, so he plays no part in the hit itself. Only the
  // grace countdown can be what stops him claiming it immediately.
  const waiter = getPlayer(s, 'd-cb1');
  waiter.pos = { x: SPAWN.x - 3, y: FUMBLE_ORIGIN.y };
  const pickupRange = waiter.radius + PICKUP_RADIUS_BONUS;

  const { frames } = runTurn(s, rolls([0, 0, 0.5]));

  for (let i = 0; i < LOOSE_BALL_GRACE_SUBSTEPS; i++) {
    const f = frames[i];
    assert.ok(f.looseBall, `sub-step ${i}: ball is still on the ground`);
    const d = Math.hypot(f.looseBall.x - waiter.pos.x, f.looseBall.y - waiter.pos.y);
    assert.ok(d <= pickupRange, `sub-step ${i}: he is close enough to scoop it (${d.toFixed(2)})`);
  }
  // ...and he takes it on the very first sub-step he is allowed to.
  assert.equal(frames.length, LOOSE_BALL_GRACE_SUBSTEPS + 1);
  assert.equal(frames[LOOSE_BALL_GRACE_SUBSTEPS].looseBall, null);
  assert.equal(s.ball.carrierId, 'd-cb1');

  // Meanwhile the ball moved measurably, and exactly as far as the closed
  // form for the roll-out says: FUMBLE_BALL_SPEED * DT * (1 - f^n) / (1 - f).
  const first = frames[0].looseBall;
  const last = frames[LOOSE_BALL_GRACE_SUBSTEPS - 1].looseBall;
  const moved = Math.hypot(last.x - first.x, last.y - first.y);
  assert.ok(moved > 4, `ball travelled during the grace period (${moved.toFixed(2)} units)`);
  assert.ok(Math.abs(moved - looseTravel(LOOSE_BALL_GRACE_SUBSTEPS - 1)) < 1e-9);
});

test('integration: a defender in the loose ball\'s path recovers it — turnover', () => {
  const s = fumbleSetup(['d-cb1']);
  // Waiting right where the ball arrives as the grace period expires. He is
  // 10 units from the carrier at the snap of this scenario, well out of
  // tackle range, so he takes no part in the hit itself.
  getPlayer(s, 'd-cb1').pos = { ...BALL_AT_GRACE_END };
  const { events } = runTurn(s, rolls([0, 0, 0.5]));
  assert.ok(events.some((e) => e.type === 'fumble'));
  const pickup = events.find((e) => e.type === 'pickup');
  assert.deepEqual(pickup, { type: 'pickup', by: 'd-cb1', team: 'defense' });
  assert.equal(s.ball.carrierId, 'd-cb1');
  assert.equal(s.deadReason, 'recovered');
  assert.equal(s.phase, 'playOver');
});

test('integration: an offensive teammate can recover his own fumble — play stays alive', () => {
  const s = fumbleSetup(['o-rb']);
  getPlayer(s, 'o-rb').pos = { ...BALL_AT_GRACE_END };
  const { events } = runTurn(s, rolls([0, 0, 0.5]));
  assert.ok(events.some((e) => e.type === 'fumble'));
  const pickup = events.find((e) => e.type === 'pickup');
  assert.deepEqual(pickup, { type: 'pickup', by: 'o-rb', team: 'offense' });
  assert.equal(s.ball.carrierId, 'o-rb');
  assert.equal(s.deadReason, null, 'offense recovering keeps the down alive');
  assert.equal(s.phase, 'planning');
});

/**
 * The goal plane and a tackle can both come true in one sub-step. The ball
 * crossing already happened, physically; the tackle is a die roll about what
 * happens next. Crossing must win.
 */
function goalLineSetup() {
  const s = scenario(['o-qb', 'd-lb']);
  const goalY = fieldPos(0, GOAL_YARD).y;
  const qb = getPlayer(s, 'o-qb');
  qb.pos = { x: 135, y: goalY - RADIUS_MID - 0.2 }; // leading edge 0.2 units short
  qb.vel = { x: 0, y: 20 };
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  // Beside him, not in front: close enough for a prepared defender's reach
  // (5.5 + 3 = 8.5) but too far to collide (radii sum to 6).
  const lb = getPlayer(s, 'd-lb');
  lb.pos = { x: 142, y: qb.pos.y };
  setMode(s, 'd-lb', 'prepared');
  return s;
}

test('integration: crossing the goal plane beats a tackle rolled in the same sub-step', () => {
  const s = goalLineSetup();
  // [0, 0.3] = a tackle roll that would certainly succeed, and no fumble.
  const { events, frames } = runTurn(s, rolls([0, 0.3]));
  assert.equal(frames.length, 1, 'the play ends on the sub-step the plane is broken');
  assert.ok(events.some((e) => e.type === 'touchdown'), 'touchdown scored');
  assert.ok(!events.some((e) => e.type === 'tackled'), 'the tackle does not cancel it');
  assert.equal(s.deadReason, 'touchdown');
});

test('a tackle that already stood in an earlier sub-step is not overwritten by checkDeadBall', () => {
  // The reorder must not let a carrier who is dragged over the line AFTER the
  // whistle score. checkDeadBall's deadReason guard is what prevents it.
  const s = scenario(['o-qb']);
  getPlayer(s, 'o-qb').pos = { x: 135, y: fieldPos(0, GOAL_YARD).y + 1 };
  s.deadReason = 'tackled';
  assert.deepEqual(checkDeadBall(s), []);
  assert.equal(s.deadReason, 'tackled');
});
