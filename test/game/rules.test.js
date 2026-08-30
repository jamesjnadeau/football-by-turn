import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tackleProbability, checkTackles, checkPickup, checkDeadBall, nextDown } from '../../lib/game/rules.js';
import { createGame, getPlayer, setMode, setPlan } from '../../lib/game/state.js';
import { fieldPos, GOAL_YARD } from '../../lib/game/view.js';
import { SIDELINE_LEFT } from '../../lib/field/geometry.js';
import { NEARBY_RADIUS, PENALTY_YARDS } from '../../lib/game/constants.js';

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

test('a prepared defender only gets the tackle-power bonus when the carrier is inside his wedge', () => {
  // Squared up: no plan, no velocity, so setMode locks the team default
  // facing ({0,-1}), which points straight at the QB sitting south of him.
  const squared = scenario(['o-qb', 'd-lb']);
  const qb1 = getPlayer(squared, 'o-qb'), lb1 = getPlayer(squared, 'd-lb');
  qb1.pos = { x: 135, y: 100 }; lb1.pos = { x: 135, y: 105 };
  setMode(squared, 'd-lb', 'prepared');
  const inCone = tackleProbability(squared, lb1, qb1);

  // Same geometry, but the defender committed east instead — the QB is
  // outside the wedge he locked in.
  const turned = scenario(['o-qb', 'd-lb']);
  const qb2 = getPlayer(turned, 'o-qb'), lb2 = getPlayer(turned, 'd-lb');
  qb2.pos = { x: 135, y: 100 }; lb2.pos = { x: 135, y: 105 };
  setPlan(turned, 'd-lb', { x: 1, y: 0 }, 1);
  setMode(turned, 'd-lb', 'prepared');
  const offCone = tackleProbability(turned, lb2, qb2);

  // Same geometry again, never prepared at all: the bonus-free baseline.
  const baseline = scenario(['o-qb', 'd-lb']);
  const qb3 = getPlayer(baseline, 'o-qb'), lb3 = getPlayer(baseline, 'd-lb');
  qb3.pos = { x: 135, y: 100 }; lb3.pos = { x: 135, y: 105 };
  const noBonus = tackleProbability(baseline, lb3, qb3);

  assert.equal(offCone, noBonus, 'facing away from the carrier earns no power bonus, prepared or not');
  assert.ok(inCone > offCone, 'facing the carrier is what earns it');
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

/** Rolls in order, then 0.99 (which fails every later check) forever. */
const rolls = (...vals) => { let i = 0; return () => (i < vals.length ? vals[i++] : 0.99); };

// Defence sits at higher y and faces down the field, so a defender north of the
// QB is squared up on him. Stance reach here is 5.5 + the QB's 3 = 8.5 units;
// the wedge doubles the defender's half of that, giving 14.
test('a squared-up defender makes the hit from beyond his stance reach', () => {
  const s = scenario(['o-qb', 'd-lb']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 135, y: 112 }; // 12 apart
  setMode(s, 'd-lb', 'prepared');
  const events = checkTackles(s, rolls(0, 0.99)); // tackle lands, ball held
  assert.deepEqual(events, [{ type: 'tackled', by: 'd-lb' }]);
});

test('the same defender cannot reach that far to the side', () => {
  const s = scenario(['o-qb', 'd-lb']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 147, y: 100 }; // 12 away, square abeam
  setMode(s, 'd-lb', 'prepared');
  assert.deepEqual(checkTackles(s, rolls(0, 0.99)), [], 'out of the wedge, out of range');
});

test('the wedge is longer, not infinite', () => {
  const s = scenario(['o-qb', 'd-lb']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 135, y: 120 }; // 20 apart, dead ahead
  setMode(s, 'd-lb', 'prepared');
  assert.deepEqual(checkTackles(s, rolls(0, 0.99)), []);
});

test('an unprepared defender gets no wedge at all', () => {
  const s = scenario(['o-qb', 'd-lb']);
  const qb = getPlayer(s, 'o-qb'), lb = getPlayer(s, 'd-lb');
  qb.pos = { x: 135, y: 100 }; lb.pos = { x: 135, y: 112 };
  assert.deepEqual(checkTackles(s, rolls(0, 0.99)), [], 'still just a circle of radius 3');
});

test('an enforced flag wipes the play and spots the ball back from the previous line', () => {
  const s = createGame({ seed: 1 });
  s.losYard = 4;
  s.penalty = { foul: 'illegal-forward-pass', spot: 4 };
  s.deadReason = 'touchdown';      // he scored on the illegal throw
  s.forwardPasses = 1;
  nextDown(s);
  assert.equal(s.phase, 'planning', 'the touchdown does not stand');
  assert.equal(s.result, null);
  assert.equal(s.down, 2, 'the down still counts');
  assert.equal(s.losYard, 4 - PENALTY_YARDS);
  assert.equal(s.penalty, null, 'the flag is spent');
  assert.equal(s.forwardPasses, 0, 'a new down gets a new forward pass');
  assert.equal(s.plannedPass, null);
});

test('the defense declines the flag when it has just taken the ball', () => {
  const s = createGame({ seed: 1 });
  s.penalty = { foul: 'second-forward-pass', spot: 0 };
  s.deadReason = 'recovered';      // intercepted
  nextDown(s);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result, 'turnover-fumble', 'the defense keeps the football');
});

test('an incomplete pass is spotted at the previous line, and costs the down', () => {
  const s = createGame({ seed: 1 });
  s.losYard = 3;
  s.deadReason = 'incomplete';
  s.ball = { carrierId: null, pos: fieldPos(0, 9), vel: { x: 0, y: 0 } }; // it landed 6 on
  nextDown(s);
  assert.equal(s.down, 2);
  assert.equal(s.losYard, 3, 'an incomplete pass gains nothing');
});

test('a flag on 4th down is a turnover on downs', () => {
  const s = createGame({ seed: 1 });
  s.down = 4;
  s.penalty = { foul: 'second-forward-pass', spot: 0 };
  s.deadReason = 'tackled';
  nextDown(s);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result, 'turnover-on-downs');
});

test('with no flag, an ordinary down is spotted exactly as it always was', () => {
  const s = createGame({ seed: 1 });
  s.losYard = 0;
  s.deadReason = 'tackled';
  getPlayer(s, 'o-qb').pos = fieldPos(0, 6);
  nextDown(s);
  assert.equal(s.down, 2);
  assert.ok(Math.abs(s.losYard - 6) < 1e-9, 'spotted where the play died');
});
