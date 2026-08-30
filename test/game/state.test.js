import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, setPlan, clearAllPlans, setMode, placePlayer, getPlayer, ballPos, carrier,
  isControllable, setPass, clearPass,
} from '../../lib/game/state.js';
import { TEAM_SIZE } from '../../lib/game/constants.js';
import { fieldPos } from '../../lib/game/view.js';

test('a new game: 1st down at yard 0, planning, TEAM_SIZE a side, QB has the ball', () => {
  const s = createGame({ seed: 7 });
  assert.equal(s.down, 1);
  assert.equal(s.losYard, 0);
  assert.equal(s.phase, 'planning');
  assert.equal(s.turnIndex, 0);
  assert.equal(s.players.filter((p) => p.team === 'offense').length, TEAM_SIZE);
  assert.equal(s.players.filter((p) => p.team === 'defense').length, TEAM_SIZE);
  const qb = getPlayer(s, 'o-qb');
  assert.equal(s.ball.carrierId, 'o-qb');
  assert.deepEqual(ballPos(s), qb.pos);
  assert.equal(carrier(s).id, 'o-qb');
});

test('offense lines up behind the LOS, defense beyond it, nobody overlapping', () => {
  const s = createGame({ seed: 1 });
  const losY = fieldPos(0, 0).y;
  for (const p of s.players) {
    if (p.team === 'offense') assert.ok(p.pos.y < losY, `${p.id} behind LOS`);
    else assert.ok(p.pos.y > losY, `${p.id} beyond LOS`);
  }
  for (const a of s.players) for (const b of s.players) {
    if (a.id < b.id) {
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
      assert.ok(d >= a.radius + b.radius, `${a.id} and ${b.id} overlap`);
    }
  }
});

test('mass grows with radius squared', () => {
  const s = createGame({ seed: 1 });
  const line = s.players.find((p) => p.radius === 3.5);
  const skill = s.players.find((p) => p.radius === 2.5);
  assert.equal(line.mass, 3.5 * 3.5);
  assert.equal(skill.mass, 2.5 * 2.5);
});

test('plans can be set, replaced, and cleared', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.8);
  assert.deepEqual(getPlayer(s, 'o-rb').plan, { dir: { x: 0, y: 1 }, throttle: 0.8 });
  setPlan(s, 'o-rb', { x: 1, y: 0 }, 0.5);
  assert.deepEqual(getPlayer(s, 'o-rb').plan, { dir: { x: 1, y: 0 }, throttle: 0.5 });
  clearAllPlans(s);
  assert.ok(s.players.every((p) => p.plan === null));
});

test('mode legality: tuck = carrier only, prepared = defense only, holding = offense only', () => {
  const s = createGame({ seed: 1 });
  assert.equal(setMode(s, 'o-qb', 'tucked'), true);     // has the ball
  assert.equal(setMode(s, 'o-rb', 'tucked'), false);    // no ball
  assert.equal(setMode(s, 'd-lb', 'prepared'), true);
  assert.equal(setMode(s, 'o-c', 'prepared'), false);
  assert.equal(setMode(s, 'o-c', 'holding'), true);
  assert.equal(setMode(s, 'd-nt', 'holding'), false);
  // setting a mode arms the next-turn charge (spec: momentum after preparing)
  assert.equal(getPlayer(s, 'o-qb').charge, 1);
  // toggling back to normal clears it
  setMode(s, 'o-qb', 'normal');
  assert.equal(getPlayer(s, 'o-qb').mode, 'normal');
  assert.equal(getPlayer(s, 'o-qb').charge, 0);
});

test('repositioning: allowed only at turn 0 planning, and only on your own side of the LOS', () => {
  const s = createGame({ seed: 1 });
  const ok = placePlayer(s, 'o-wr1', fieldPos(-20, -2));
  assert.equal(ok, true);
  assert.deepEqual(getPlayer(s, 'o-wr1').pos, fieldPos(-20, -2));
  // offense may not set up past the LOS
  assert.equal(placePlayer(s, 'o-wr1', fieldPos(-20, 2)), false);
  // defense may not set up behind it
  assert.equal(placePlayer(s, 'd-cb1', fieldPos(-20, -2)), false);
  // once the play has run a turn, nobody repositions
  s.turnIndex = 1;
  assert.equal(placePlayer(s, 'o-wr1', fieldPos(-15, -2)), false);
});

test('the computer opponent is opt-in, and its players take no orders', () => {
  const hotSeat = createGame({ seed: 1 });
  assert.equal(hotSeat.aiTeam, null, 'the library default is still hot-seat');
  assert.equal(isControllable(hotSeat, 'd-lb'), true);

  const vsCpu = createGame({ seed: 1, ai: 'defense' });
  assert.equal(vsCpu.aiTeam, 'defense');
  assert.equal(isControllable(vsCpu, 'o-rb'), true, 'the human still coaches his own team');
  assert.equal(isControllable(vsCpu, 'd-lb'), false, 'the computer\'s players are off limits');
});

test('breaking down freezes the defender facing where he was headed, and only then', () => {
  const s = createGame({ seed: 1 });
  const lb = getPlayer(s, 'd-lb');
  assert.equal(lb.facing, null, 'nobody starts with a locked axis');

  setPlan(s, 'd-lb', { x: 3, y: 4 }, 1);
  setMode(s, 'd-lb', 'prepared');
  assert.deepEqual(lb.facing, { x: 0.6, y: 0.8 }, 'the axis is the heading at breakdown, normalised');

  // The lock is a commitment: re-aiming the arrow afterwards does not swing it.
  setPlan(s, 'd-lb', { x: -1, y: 0 }, 1);
  assert.deepEqual(lb.facing, { x: 0.6, y: 0.8 }, 'a later arrow does not re-point the stance');

  setMode(s, 'd-lb', 'normal');
  assert.equal(lb.facing, null, 'standing up again releases the axis');
});

test('every special move locks an axis, and dropping back to normal releases it', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  setMode(s, 'o-qb', 'tucked');
  assert.notEqual(qb.facing, null, 'tucking commits to a line same as breaking down');
  setMode(s, 'o-qb', 'normal');
  assert.equal(qb.facing, null, 'standing back up releases it');

  const c = getPlayer(s, 'o-c');
  setMode(s, 'o-c', 'holding');
  assert.notEqual(c.facing, null, 'holding position commits to a line too');
});

test('a new game has no throw planned, no forward pass thrown, and no flag', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.plannedPass, null);
  assert.equal(s.forwardPasses, 0);
  assert.equal(s.penalty, null);
});

test('only the ball carrier can plan a throw, and a second throw replaces the first', () => {
  const s = createGame({ seed: 1 });
  assert.equal(setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5), true);
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 0, y: 1 }, power: 0.5 });
  setPass(s, 'o-qb', { x: 1, y: 0 }, 0.9);
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 1, y: 0 }, power: 0.9 });
  // The bug this signature exists to prevent: a player who is not the carrier
  // must be refused, not silently substituted with whoever is.
  assert.equal(setPass(s, 'o-wr1', { x: 0, y: 1 }, 0.5), false);
  assert.equal(s.plannedPass.from, 'o-qb', 'the QB\'s throw is untouched');
  clearPass(s);
  assert.equal(s.plannedPass, null);
  // Nobody is carrying the ball, so there is nothing to throw.
  s.ball = { carrierId: null, pos: { x: 100, y: 100 }, vel: { x: 0, y: 0 } };
  assert.equal(setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5), false);
  assert.equal(s.plannedPass, null);
});

test('Clear Arrows drops the planned throw along with the run arrows', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5);
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  clearAllPlans(s);
  assert.equal(s.plannedPass, null);
  assert.ok(s.players.every((p) => p.plan === null));
});
