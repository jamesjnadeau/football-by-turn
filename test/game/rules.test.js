import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tackleProbability, checkTackles, checkPickup, checkDeadBall, nextDown } from '../../lib/game/rules.js';
import { createGame, getPlayer, setMode } from '../../lib/game/state.js';
import { fieldPos, GOAL_YARD } from '../../lib/game/view.js';
import { SIDELINE_LEFT } from '../../lib/field/geometry.js';
import { NEARBY_RADIUS } from '../../lib/game/constants.js';

/** A game trimmed to just the players a scenario names, carrier = QB. */
function scenario(ids) {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => ids.includes(p.id));
  return s;
}

test('spec: tucked runner vs one prepared defender, all else equal, is exactly 50/50', () => {
  const s = scenario(['o-qb', 'd-lb']); // same radius (3), both stationary
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 135, y: 105 };
  setMode(s, 'o-qb', 'tucked');
  setMode(s, 'd-lb', 'prepared');
  assert.equal(tackleProbability(s, lb, qb), 0.5);
});

test('a prepared defender tackles better than an unprepared one', () => {
  const s = scenario(['o-qb', 'd-lb']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 135, y: 105 };
  const before = tackleProbability(s, lb, qb);
  setMode(s, 'd-lb', 'prepared');
  assert.ok(tackleProbability(s, lb, qb) > before);
});

test('spec: more defenders in the immediate area make the tackle more likely', () => {
  const s = scenario(['o-qb', 'd-lb', 'd-s']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb'), sSaf = getPlayer(s, 'd-s');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 135, y: 105 };
  sSaf.pos = { x: 135, y: 300 }; // far away
  const alone = tackleProbability(s, lb, qb);
  sSaf.pos = { x: 135 + NEARBY_RADIUS - 1, y: 100 }; // in the area
  assert.ok(tackleProbability(s, lb, qb) > alone);
});

test('momentum matters: a fast-charging defender tackles better', () => {
  const s = scenario(['o-qb', 'd-lb']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 135, y: 105 };
  const still = tackleProbability(s, lb, qb);
  lb.vel = { x: 0, y: -20 };
  assert.ok(tackleProbability(s, lb, qb) > still);
});

test('checkTackles: reach matters — prepared defender attempts from farther out', () => {
  const s = scenario(['o-qb', 'd-lb']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 };
  lb.pos = { x: 135, y: 100 + 3 + 3 + 1.5 }; // 1.5 beyond touching: out of normal reach
  assert.deepEqual(checkTackles(s, () => 0), []);
  setMode(s, 'd-lb', 'prepared'); // reach +2.5 covers the gap
  const events = checkTackles(s, () => 0.99); // 0.99 > any p → tackle fails, but attempted
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'broken');
  assert.ok(lb.tackleCooldown > 0, 'broken tackle sets cooldown');
});

test('a successful roll downs the runner and ends the play', () => {
  const s = scenario(['o-qb', 'd-lb']);
  getPlayer(s, 'o-qb').pos = { x: 135, y: 100 };
  getPlayer(s, 'd-lb').pos = { x: 135, y: 105 };
  // first roll (tackle) 0 → success; second roll (no fumble) 0.3 > FUMBLE_UNTUCKED(0.25)
  const rolls = [0, 0.3];
  const events = checkTackles(s, () => rolls.shift());
  assert.equal(events[0].type, 'tackled');
  assert.equal(s.deadReason, 'tackled');
});

test('an untucked runner can fumble on the hit; the ball comes loose', () => {
  const s = scenario(['o-qb', 'd-lb']);
  getPlayer(s, 'o-qb').pos = { x: 135, y: 100 };
  getPlayer(s, 'd-lb').pos = { x: 135, y: 105 };
  // first roll (tackle) low → success; second roll (fumble) 0 → fumbles; third roll (angle) for dropBall
  const rolls = [0, 0, 0.5];
  const events = checkTackles(s, () => rolls.shift());
  assert.equal(events[0].type, 'fumble');
  assert.equal(s.ball.carrierId, null);
  assert.ok(s.ball.pos && s.ball.vel, 'ball is loose with a velocity');
  assert.ok(Number.isFinite(s.ball.vel.x) && Number.isFinite(s.ball.vel.y), 'fumble velocity is a real number, not NaN');
  assert.equal(s.deadReason, null, 'a fumble keeps the play alive');
});

test('a tucked runner survives the same fumble roll', () => {
  const s = scenario(['o-qb', 'd-lb']);
  getPlayer(s, 'o-qb').pos = { x: 135, y: 100 };
  getPlayer(s, 'd-lb').pos = { x: 135, y: 105 };
  setMode(s, 'o-qb', 'tucked');
  const rolls = [0, 0.1]; // 0.1 > FUMBLE_TUCKED(0.05) but < FUMBLE_UNTUCKED(0.25)
  const events = checkTackles(s, () => rolls.shift());
  assert.equal(events[0].type, 'tackled');
});

test('pickups: offense recovering keeps the play alive, defense recovering kills it', () => {
  const off = scenario(['o-rb', 'd-s']);
  off.ball = { carrierId: null, pos: getPlayer(off, 'o-rb').pos, vel: { x: 0, y: 0 } };
  const e1 = checkPickup(off);
  assert.deepEqual(e1[0], { type: 'pickup', by: 'o-rb', team: 'offense' });
  assert.equal(off.ball.carrierId, 'o-rb');
  assert.equal(off.deadReason, null);

  const def = scenario(['o-rb', 'd-s']);
  def.ball = { carrierId: null, pos: getPlayer(def, 'd-s').pos, vel: { x: 0, y: 0 } };
  checkPickup(def);
  assert.equal(def.ball.carrierId, 'd-s');
  assert.equal(def.deadReason, 'recovered');
});

test('touchdown: the ball crossing the goal plane ends everything', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  qb.pos = { x: 135, y: fieldPos(0, GOAL_YARD).y + 1 };
  const events = checkDeadBall(s);
  assert.equal(events[0].type, 'touchdown');
  assert.equal(s.deadReason, 'touchdown');
  nextDown(s);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result, 'touchdown');
});

test('the carrier stepping out of bounds kills the play', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  qb.pos = { x: SIDELINE_LEFT - 1, y: fieldPos(0, 2).y };
  const events = checkDeadBall(s);
  assert.equal(events[0].type, 'out-of-bounds');
  assert.equal(s.deadReason, 'out-of-bounds');
});

test('between downs: ball is spotted where it died, down advances, formation resets there', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  qb.pos = { x: 150, y: fieldPos(0, 4).y };
  s.deadReason = 'tackled';
  s.turnIndex = 5;
  nextDown(s);
  assert.equal(s.down, 2);
  assert.equal(s.losYard, 4);
  assert.equal(s.phase, 'planning');
  assert.equal(s.turnIndex, 0);
  assert.equal(s.ball.carrierId, 'o-qb');
  assert.equal(s.deadReason, null);
  // the new formation is planted around the new LOS
  const c = getPlayer(s, 'o-c');
  assert.ok(Math.abs(c.pos.y - fieldPos(0, 3).y) < 1e-9, 'centre one yard behind the new LOS');
});

test('failing on 4th down is a turnover on downs', () => {
  const s = createGame({ seed: 1 });
  s.down = 4;
  getPlayer(s, 'o-qb').pos = fieldPos(0, 2);
  s.deadReason = 'tackled';
  nextDown(s);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result, 'turnover-on-downs');
});

test('a defensive recovery ends the game as a turnover', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'd-s', pos: null, vel: null };
  s.deadReason = 'recovered';
  nextDown(s);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result, 'turnover-fumble');
});
