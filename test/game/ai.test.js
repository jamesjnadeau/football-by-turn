import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiPlayers, pursuitTarget, defensePlans, coachAi, clearAiPlans, applyAiModes,
  coachSmartDefense,
} from '../../lib/game/ai.js';
import { createGame, getPlayer, setPlan, setMode } from '../../lib/game/state.js';
import { runTurn } from '../../lib/game/turn.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { TEAM_SIZE, AI_LEAD_MAX_SECONDS, AI_BREAKDOWN_UNITS } from '../../lib/game/constants.js';

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
  assert.deepEqual(getPlayer(s, 'o-rb').plan, {
    dir: { x: 0, y: 1 }, throttle: 0.5, target: null, short: false,
  });
});

test('a defender breaks down only once he is close enough to make the hit', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  const near = getPlayer(s, 'd-lb');
  const far = getPlayer(s, 'd-s');
  near.pos = { x: qb.pos.x, y: qb.pos.y + AI_BREAKDOWN_UNITS - 1 };
  far.pos = { x: qb.pos.x, y: qb.pos.y + AI_BREAKDOWN_UNITS + 1 };
  applyAiModes(s);
  assert.equal(near.mode, 'prepared');
  assert.equal(far.mode, 'normal');
});

test('a defender who gets left behind stands back up', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  const lb = getPlayer(s, 'd-lb');
  lb.pos = { x: qb.pos.x, y: qb.pos.y + 1 };
  applyAiModes(s);
  assert.equal(lb.mode, 'prepared');
  lb.pos = { x: qb.pos.x, y: qb.pos.y + AI_BREAKDOWN_UNITS + 5 };
  applyAiModes(s);
  assert.equal(lb.mode, 'normal', 'no point breaking down with nobody to hit');
});

test('holding the stance does not re-arm the charge every turn', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  const lb = getPlayer(s, 'd-lb');
  lb.pos = { x: qb.pos.x, y: qb.pos.y + 1 };
  applyAiModes(s);
  assert.equal(lb.charge, 1, 'setting the stance arms the burst, once');
  lb.charge = 0;   // what runTurn does at the end of every turn
  applyAiModes(s); // still close, still prepared — nothing changed
  assert.equal(lb.charge, 0, 'no free burst for standing in the stance he is already in');
});

test('nobody stays broken down for a loose ball — everyone sprints at it', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const lb = getPlayer(s, 'd-lb');
  setMode(s, 'd-lb', 'prepared'); // he had broken down on the carrier a moment ago
  assert.equal(lb.mode, 'prepared');
  s.ball = { carrierId: null, pos: { ...lb.pos }, vel: { x: 0, y: 0 }, loose: 0 };
  applyAiModes(s);
  assert.ok(aiPlayers(s).every((p) => p.mode === 'normal'), 'a loose ball is a footrace');
});

test('coachAi sets the stance as well as the arrow', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const qb = getPlayer(s, 'o-qb');
  const lb = getPlayer(s, 'd-lb');
  lb.pos = { x: qb.pos.x, y: qb.pos.y + 1 };
  coachAi(s);
  assert.equal(lb.mode, 'prepared');
  assert.ok(lb.plan !== null);
});

test('the smart brain puts the corners on the receivers, arrows and all', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  coachAi(s);
  const cb = getPlayer(s, 'd-cb1');
  assert.equal(cb.cover, 'o-wr1');
  assert.ok(cb.plan !== null, 'a cover order is still a plan');
  assert.ok(s.players.filter((p) => p.team === 'defense').every((p) => p.plan !== null),
    'everybody got a job');
});

test('the smart brain sends the linebacker to his depth, not at the quarterback', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  coachAi(s);
  // He is at (135, 100) and his mirror spot is (135, 93): straight up the
  // field toward the line, and no lateral drift.
  assert.deepEqual(getPlayer(s, 'd-lb').plan.dir, { x: 0, y: -1 });
});

test('the pursuit brain is untouched and hands out no coverage', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  coachAi(s);
  assert.ok(s.players.every((p) => p.cover === null), 'the old brain covers nobody');
  assert.deepEqual(
    s.players.filter((p) => p.team === 'defense').map((p) => p.plan.dir),
    defensePlans(s).map((pl) => pl.dir),
  );
});

test('the computer\'s coverage does not outlive the turn either', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  coachSmartDefense(s);
  assert.ok(s.players.some((p) => p.cover !== null), 'somebody was covering');
  clearAiPlans(s);
  assert.ok(s.players.filter((p) => p.team === 'defense')
    .every((p) => p.plan === null && p.cover === null));
});

test('a whole smart turn runs, and leaves nothing of the computer behind', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  runTurn(s, mulberry32(1));
  assert.ok(s.players.filter((p) => p.team === 'defense')
    .every((p) => p.plan === null && p.cover === null),
  'no plan and no halo for the human to read');
});
