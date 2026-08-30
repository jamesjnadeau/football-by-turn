import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiPlayers, pursuitTarget, defensePlans, coachAi, clearAiPlans,
} from '../../lib/game/ai.js';
import { createGame, getPlayer, setPlan } from '../../lib/game/state.js';
import { TEAM_SIZE, AI_LEAD_MAX_SECONDS } from '../../lib/game/constants.js';

test('with no computer opponent there is nothing to coach', () => {
  const s = createGame({ seed: 1 });
  assert.deepEqual(aiPlayers(s), []);
  assert.deepEqual(defensePlans(s), []);
});

test('the computer coaches exactly its own team', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const ids = aiPlayers(s).map((p) => p.id);
  assert.equal(ids.length, TEAM_SIZE);
  assert.ok(ids.every((id) => id.startsWith('d-')), 'defense only');
});

test('a standing carrier is chased where he stands', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.deepEqual(pursuitTarget(s, getPlayer(s, 'd-lb')), getPlayer(s, 'o-qb').pos);
});

test('a moving carrier is led, and a further-away pursuer aims further ahead', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  qb.vel = { x: 10, y: 0 };
  const near = pursuitTarget(s, getPlayer(s, 'd-nt')); // 5 yards off the ball
  const far = pursuitTarget(s, getPlayer(s, 'd-s'));   // 12 yards off it
  assert.ok(near.x > qb.pos.x, 'the aim point is ahead of the carrier');
  assert.ok(far.x > near.x, 'more ground to cover means more lead');
});

test('the lead is capped, so one breakaway cannot fling a pursuer off the field', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  qb.vel = { x: 40, y: 0 };
  const safety = getPlayer(s, 'd-s');
  safety.pos = { x: safety.pos.x, y: safety.pos.y + 1000 }; // absurdly far downfield
  const target = pursuitTarget(s, safety);
  assert.ok(
    Math.abs(target.x - qb.pos.x - 40 * AI_LEAD_MAX_SECONDS) < 1e-9,
    'lead time saturates at AI_LEAD_MAX_SECONDS',
  );
});

test('a loose ball is chased where it lies', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  s.ball = { carrierId: null, pos: { x: 135, y: 100 }, vel: { x: 0, y: 0 }, loose: 0 };
  assert.deepEqual(pursuitTarget(s, getPlayer(s, 'd-lb')), { x: 135, y: 100 });
});

test('every plan is a unit vector at the ball, full throttle', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const plans = defensePlans(s);
  assert.equal(plans.length, TEAM_SIZE);
  const qb = getPlayer(s, 'o-qb');
  for (const plan of plans) {
    const p = getPlayer(s, plan.id);
    assert.equal(plan.throttle, 1);
    assert.ok(Math.abs(Math.hypot(plan.dir.x, plan.dir.y) - 1) < 1e-9, `${plan.id}: unit direction`);
    // The QB stands upfield of every defender at the snap, so every pursuit
    // runs back toward him: -y.
    assert.ok(plan.dir.y < 0, `${plan.id} runs at the ball`);
    const to = { x: qb.pos.x - p.pos.x, y: qb.pos.y - p.pos.y };
    const l = Math.hypot(to.x, to.y);
    assert.ok(Math.abs(plan.dir.x - to.x / l) < 1e-9, `${plan.id}: x`);
    assert.ok(Math.abs(plan.dir.y - to.y / l) < 1e-9, `${plan.id}: y`);
  }
});

test('defensePlans is pure — it writes nothing into the state', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  defensePlans(s);
  assert.ok(s.players.every((p) => p.plan === null));
});

test('coachAi writes the plans; clearAiPlans wipes them and leaves the human\'s alone', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.5);

  coachAi(s);
  assert.ok(s.players.filter((p) => p.team === 'defense').every((p) => p.plan !== null));

  clearAiPlans(s);
  assert.ok(s.players.filter((p) => p.team === 'defense').every((p) => p.plan === null));
  assert.deepEqual(getPlayer(s, 'o-rb').plan, { dir: { x: 0, y: 1 }, throttle: 0.5 });
});
