import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepPhysics } from '../../lib/game/physics.js';
import { createGame, setPlan, setMode, getPlayer } from '../../lib/game/state.js';
import { setCover } from '../../lib/game/cover.js';
import { maxSpeed } from '../../lib/game/modes.js';
import { DT, SUBSTEPS_PER_TURN, STANCE_LATERAL_MULT, COVER_GRAB_REACH } from '../../lib/game/constants.js';
import { len } from '../../lib/game/vec.js';
import { RELEASE_SPEED } from '../../lib/game/constants.js';

function run(state, substeps) {
  for (let i = 0; i < substeps; i++) stepPhysics(state, DT);
}

test('a planned player accelerates toward its arrow and tops out at maxSpeed', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-rb');
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
  s.players = s.players.filter((p) => p.id === 'o-rb');
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

/** A lone linebacker, broken down and committed straight upfield at (0, -1). */
function squaredUpLb() {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'd-lb');
  setPlan(s, 'd-lb', { x: 0, y: -1 }, 1);
  setMode(s, 'd-lb', 'prepared');
  return s;
}

test('a broken-down defender still drives up his own axis at full speed', () => {
  const s = squaredUpLb();
  const lb = getPlayer(s, 'd-lb');
  run(s, SUBSTEPS_PER_TURN * 4);
  assert.ok(len(lb.vel) > maxSpeed(lb) * 0.95, `stance must not tax the drive, got ${len(lb.vel)}`);
  assert.ok(len(lb.vel) <= maxSpeed(lb) + 1e-6, 'and never past it');
});

test('but he can only shuffle across it', () => {
  const s = squaredUpLb();
  const lb = getPlayer(s, 'd-lb');
  setPlan(s, 'd-lb', { x: 1, y: 0 }, 1); // try to slide sideways out of the stance
  run(s, SUBSTEPS_PER_TURN * 4);
  const cap = maxSpeed(lb) * STANCE_LATERAL_MULT;
  assert.ok(Math.abs(len(lb.vel) - cap) < cap * 0.05, `sideways is capped at ${cap}, got ${len(lb.vel)}`);
});

test('a defender who stands back up gets his agility back', () => {
  const s = squaredUpLb();
  const lb = getPlayer(s, 'd-lb');
  setMode(s, 'd-lb', 'normal');
  setPlan(s, 'd-lb', { x: 1, y: 0 }, 1);
  run(s, SUBSTEPS_PER_TURN * 4);
  assert.ok(len(lb.vel) > maxSpeed(lb) * 0.95, 'full speed sideways once out of the stance');
});

/**
 * Every special move commits to an axis now, not just the prepared stance
 * (see setMode in state.js) — clampToStance's guard is keyed off `facing`
 * alone, so a tucked runner and a holding blocker get the same elliptical cap
 * a broken-down defender does.
 */
function tuckedQbLockedDownfield() {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb');
  const qb = getPlayer(s, 'o-qb');
  qb.vel = { x: 0, y: 30 }; // already driving downfield when he tucks
  setMode(s, 'o-qb', 'tucked');
  return s;
}

test('a tucked runner is fast along the line he tucked on and can only shuffle across it', () => {
  const s = tuckedQbLockedDownfield();
  const qb = getPlayer(s, 'o-qb');
  assert.deepEqual(qb.facing, { x: 0, y: 1 }, 'tucking locked the axis he was already driving on');

  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  run(s, SUBSTEPS_PER_TURN * 4);
  assert.ok(len(qb.vel) > maxSpeed(qb) * 0.95, 'full speed along the locked line');

  const s2 = tuckedQbLockedDownfield();
  const qb2 = getPlayer(s2, 'o-qb');
  setPlan(s2, 'o-qb', { x: 1, y: 0 }, 1); // try to cut across the locked axis
  run(s2, SUBSTEPS_PER_TURN * 4);
  // tucked's own top speed is TUCK_SPEED_MULT (0.85) of base; the lateral cap
  // is STANCE_LATERAL_MULT (0.3) of THAT — the two taxes stack.
  const cap = maxSpeed(qb2) * STANCE_LATERAL_MULT;
  assert.ok(Math.abs(len(qb2.vel) - cap) < cap * 0.05, `sideways is capped at ${cap}, got ${len(qb2.vel)}`);
});

test('dropping a tucked runner back to normal clears his axis and restores full agility', () => {
  const s = tuckedQbLockedDownfield();
  const qb = getPlayer(s, 'o-qb');
  setMode(s, 'o-qb', 'normal');
  assert.equal(qb.facing, null);
  setPlan(s, 'o-qb', { x: 1, y: 0 }, 1);
  run(s, SUBSTEPS_PER_TURN * 4);
  assert.ok(len(qb.vel) > maxSpeed(qb) * 0.95, 'full speed sideways once untucked');
});

test('a holding blocker is likewise pinned to one line', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-c');
  const c = getPlayer(s, 'o-c');
  setPlan(s, 'o-c', { x: 0, y: -1 }, 1); // no velocity yet: the arrow sets the axis
  setMode(s, 'o-c', 'holding');
  assert.deepEqual(c.facing, { x: 0, y: -1 });

  setPlan(s, 'o-c', { x: 1, y: 0 }, 1); // try to slide sideways out of the stance
  run(s, SUBSTEPS_PER_TURN * 4);
  const cap = maxSpeed(c) * STANCE_LATERAL_MULT;
  assert.ok(Math.abs(len(c.vel) - cap) < cap * 0.05, `sideways is capped at ${cap}, got ${len(c.vel)}`);
});

test('a blocker holds the man he covers off at arm\'s length', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => ['o-c', 'd-nt'].includes(p.id));
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  // Overlapping by a hair, both standing still, no plans: one step of
  // positional correction is all this is measuring.
  c.pos = { x: 135, y: 100 };
  nt.pos = { x: 135, y: 100 + c.radius + nt.radius - 0.5 };
  setCover(s, 'o-c', 'd-nt');
  c.plan = null;
  nt.plan = null;
  stepPhysics(s, DT);
  const gap = len({ x: nt.pos.x - c.pos.x, y: nt.pos.y - c.pos.y });
  assert.ok(
    Math.abs(gap - (c.radius + nt.radius + COVER_GRAB_REACH)) < 1e-6,
    `pushed out to the grab distance, got ${gap}`,
  );
});

test('two players with no cover order between them touch at their own radii', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => ['o-c', 'd-nt'].includes(p.id));
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  c.pos = { x: 135, y: 100 };
  nt.pos = { x: 135, y: 100 + c.radius + nt.radius - 0.5 };
  c.plan = null;
  nt.plan = null;
  stepPhysics(s, DT);
  const gap = len({ x: nt.pos.x - c.pos.x, y: nt.pos.y - c.pos.y });
  assert.ok(Math.abs(gap - (c.radius + nt.radius)) < 1e-6, `got ${gap}`);
});

test('a lob flies its scripted path and pays no attention to friction', () => {
  const s = createGame({ seed: 1 });
  const lob = { from: { x: 135, y: 70 }, to: { x: 135, y: 150 }, substeps: 40, elapsed: 0 };
  s.ball = { carrierId: null, pos: { ...lob.from }, vel: { x: 0, y: 400 }, loose: 0, forward: true, lob };
  stepPhysics(s, DT);
  assert.equal(lob.elapsed, 1, 'the flight clock ran');
  assert.ok(Math.abs(s.ball.pos.y - (70 + 80 / 40)) < 1e-9, 'one fortieth of the way');
  assert.ok(Math.abs(len(s.ball.vel) - 400) < 1e-9, 'its release speed is left alone');
});

test('a lob that has landed stays where it landed', () => {
  const s = createGame({ seed: 1 });
  const lob = { from: { x: 135, y: 70 }, to: { x: 135, y: 150 }, substeps: 2, elapsed: 0 };
  s.ball = { carrierId: null, pos: { ...lob.from }, vel: { x: 0, y: 400 }, loose: 0, forward: true, lob };
  for (let i = 0; i < 10; i++) stepPhysics(s, DT);
  assert.deepEqual(s.ball.pos, lob.to, 'it does not roll on past the spot');
});

test('an ordinary loose ball still rolls and decays', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: null, pos: { x: 135, y: 100 }, vel: { x: 10, y: 0 }, loose: 0, lob: null };
  stepPhysics(s, DT);
  assert.ok(s.ball.pos.x > 135, 'rolled');
  assert.ok(len(s.ball.vel) < 10, 'slowed');
});
