import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepPhysics } from '../../lib/game/physics.js';
import { createGame, setPlan, getPlayer } from '../../lib/game/state.js';
import { maxSpeed } from '../../lib/game/modes.js';
import { DT, SUBSTEPS_PER_TURN } from '../../lib/game/constants.js';
import { len } from '../../lib/game/vec.js';
import { RELEASE_SPEED } from '../../lib/game/constants.js';

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

/**
 * Collision scenarios hand-place players, so trim the roster to just the
 * ones named — the full formation has players sitting exactly where these
 * scenarios want empty grass (d-lb lines up at (135, 100)).
 */
function pair(ids) {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => ids.includes(p.id));
  return s;
}

test('overlapping players are pushed apart, the heavier one moving less', () => {
  const s = pair(['d-nt', 'o-rb']);
  const nt = getPlayer(s, 'd-nt');   // radius 3.5
  const rb = getPlayer(s, 'o-rb');   // radius 2.5
  nt.pos = { x: 135, y: 100 };
  rb.pos = { x: 135, y: 104 };       // gap 4 < 3.5 + 2.5
  const ntY = nt.pos.y, rbY = rb.pos.y;
  const contacts = stepPhysics(s, DT);
  assert.ok(rb.pos.y - rbY > 0, 'light player pushed away');
  assert.ok(ntY - nt.pos.y > 0, 'heavy player pushed the other way');
  assert.ok(rb.pos.y - rbY > ntY - nt.pos.y, 'lighter one moved farther');
  assert.ok(contacts.some((c) => (c.a.id === 'd-nt' && c.b.id === 'o-rb') || (c.a.id === 'o-rb' && c.b.id === 'd-nt')));
});

test('a holding blocker barely budges when a charger slams in', () => {
  const withHold = pair(['o-c', 'd-nt']);
  const without = pair(['o-c', 'd-nt']);
  for (const s of [withHold, without]) {
    const c = getPlayer(s, 'o-c'), nt = getPlayer(s, 'd-nt');
    c.pos = { x: 135, y: 100 };
    nt.pos = { x: 135, y: 106 };
    nt.vel = { x: 0, y: -25 };       // charging into the blocker
  }
  getPlayer(withHold, 'o-c').mode = 'holding';
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) { stepPhysics(withHold, DT); stepPhysics(without, DT); }
  const heldDrift = 100 - getPlayer(withHold, 'o-c').pos.y;
  const normalDrift = 100 - getPlayer(without, 'o-c').pos.y;
  assert.ok(heldDrift < normalDrift / 2, `holding drift ${heldDrift} vs normal ${normalDrift}`);
});

test('contact friction slows a player sliding past another', () => {
  const s = pair(['o-wr1', 'd-cb1']);
  const wr = getPlayer(s, 'o-wr1'), cb = getPlayer(s, 'd-cb1');
  wr.pos = { x: 135, y: 100 };
  cb.pos = { x: 139.5, y: 100 };     // radii 2.5 + 2.5 = 5, so overlapping by 0.5
  wr.vel = { x: 0, y: 10 };          // sliding along the tangent
  const before = len(wr.vel);
  stepPhysics(s, DT);
  assert.ok(len(wr.vel) < before, 'tangential friction bled speed');
});

test('fast releases shed less speed than slow grinding (the pass-route exemption)', () => {
  const grind = pair(['o-wr1', 'd-cb1']);
  const release = pair(['o-wr1', 'd-cb1']);
  for (const [s, speed] of [[grind, RELEASE_SPEED * 0.5], [release, RELEASE_SPEED * 1.5]]) {
    const wr = getPlayer(s, 'o-wr1'), cb = getPlayer(s, 'd-cb1');
    wr.pos = { x: 135, y: 100 };
    cb.pos = { x: 139.5, y: 100 };
    wr.vel = { x: 0, y: speed };
    stepPhysics(s, DT);
  }
  const lostGrind = 1 - len(getPlayer(grind, 'o-wr1').vel) / (RELEASE_SPEED * 0.5);
  const lostRelease = 1 - len(getPlayer(release, 'o-wr1').vel) / (RELEASE_SPEED * 1.5);
  assert.ok(lostRelease < lostGrind, `release lost ${lostRelease}, grind lost ${lostGrind} (fractions)`);
});
