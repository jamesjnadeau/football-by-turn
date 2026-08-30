import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tackleProbability, checkTackles, checkPickup } from '../../lib/game/rules.js';
import { createGame, getPlayer, setMode } from '../../lib/game/state.js';
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
