import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, setPlan, clearAllPlans, setMode, getPlayer, ballPos, carrier,
  isControllable, setPass, clearPass, aimSnap, defaultSpots, defensePlayers, SNAP_TARGET_ID,
} from '../../lib/game/state.js';
import { teamSize } from '../../lib/game/rosters.js';
import { fieldPos } from '../../lib/game/view.js';

test('a new game: 1st down at yard 20, planning, a full team a side, the centre has the ball', () => {
  const s = createGame({ seed: 7 });
  assert.equal(s.down, 1);
  assert.equal(s.losYard, 20);
  assert.equal(s.phase, 'planning');
  assert.equal(s.turnIndex, 0);
  assert.equal(s.players.filter((p) => p.team === 'offense').length, teamSize(s));
  assert.equal(s.players.filter((p) => p.team === 'defense').length, teamSize(s));
  // The down starts the way a down starts: the ball on the centre, waiting to
  // be snapped. The quarterback does not have it until he is thrown it.
  const c = getPlayer(s, 'o-c');
  assert.equal(s.ball.carrierId, 'o-c');
  assert.deepEqual(ballPos(s), c.pos);
  assert.equal(carrier(s).id, 'o-c');
});

test('a new game is 1st and 10 from the offense\'s own 20', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.down, 1);
  assert.equal(s.losYard, 20);
  assert.equal(s.toGoYard, 30);
});

test('offense lines up behind the LOS, defense beyond it, nobody overlapping', () => {
  const s = createGame({ seed: 1 });
  const losY = fieldPos(0, s.losYard).y;
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
  assert.deepEqual(getPlayer(s, 'o-rb').plan, {
    dir: { x: 0, y: 1 }, throttle: 0.8, target: null, short: false,
  });
  setPlan(s, 'o-rb', { x: 1, y: 0 }, 0.5);
  assert.deepEqual(getPlayer(s, 'o-rb').plan, {
    dir: { x: 1, y: 0 }, throttle: 0.5, target: null, short: false,
  });
  clearAllPlans(s);
  assert.ok(s.players.every((p) => p.plan === null));
});

test('a plan carries its landing spot, and defaults to not having one', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  assert.equal(getPlayer(s, 'o-rb').plan.target, null);
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.5, { x: 1, y: 2 });
  assert.deepEqual(getPlayer(s, 'o-rb').plan.target, { x: 1, y: 2 });
});

test('a plan remembers whether the man falls short of where he was pointed', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.5, { x: 1, y: 2 });
  assert.equal(getPlayer(s, 'o-rb').plan.short, false, 'he gets where he was sent');
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1, { x: 1, y: 2 }, true);
  assert.equal(getPlayer(s, 'o-rb').plan.short, true, 'he does not, and is still running');
});

test('mode legality: tuck = non-lineman carrier only, prepared = defense only, holding = offense only', () => {
  const s = createGame({ seed: 1 });
  // The centre holds the ball pre-snap (see the "ball starts tucked in a
  // lineman's hands" comment in state.js), but a lineman can never tuck --
  // this used to be exactly the bug where a double tap on the centre before
  // the snap tucked him instead of offering the cut block.
  assert.equal(setMode(s, 'o-c', 'tucked'), false);     // has the ball, but is a lineman
  assert.equal(setMode(s, 'o-qb', 'tucked'), false);    // no ball until it is snapped to him
  assert.equal(setMode(s, 'o-rb', 'tucked'), false);    // no ball
  s.ball.carrierId = 'o-rb';
  assert.equal(setMode(s, 'o-rb', 'tucked'), true);     // a non-lineman carrier can tuck
  setMode(s, 'o-rb', 'normal');
  s.ball.carrierId = 'o-c';
  assert.equal(setMode(s, 'd-lb', 'prepared'), true);
  assert.equal(setMode(s, 'o-lg', 'prepared'), false);
  assert.equal(setMode(s, 'o-lg', 'holding'), true);
  assert.equal(setMode(s, 'd-nt', 'holding'), false);
  // the cut block: offensive linemen only, and only before the play has moved
  assert.equal(setMode(s, 'o-lg', 'cutBlock'), true);
  assert.equal(setMode(s, 'o-rb', 'cutBlock'), false);   // not a lineman
  assert.equal(setMode(s, 'd-nt', 'cutBlock'), false);   // not offense
  setMode(s, 'o-lg', 'normal');
  s.turnIndex = 1;
  assert.equal(setMode(s, 'o-lg', 'cutBlock'), false);   // past the first turn
  // setting a mode arms the next-turn charge (spec: momentum after preparing)
  assert.equal(setMode(s, 'o-c', 'holding'), true);
  assert.equal(getPlayer(s, 'o-c').charge, 1);
  // toggling back to normal clears it
  setMode(s, 'o-c', 'normal');
  assert.equal(getPlayer(s, 'o-c').mode, 'normal');
  assert.equal(getPlayer(s, 'o-c').charge, 0);
});

test('cut block is offensive linemen only -- every role in the default roster', () => {
  const s = createGame({ seed: 1 });
  for (const id of ['o-c', 'o-lg', 'o-rg']) {
    assert.equal(setMode(s, id, 'cutBlock'), true, `${id} is a lineman and should be able to cut block`);
    setMode(s, id, 'normal');
  }
  for (const id of ['o-wr1', 'o-wr2', 'o-qb', 'o-rb']) {
    assert.equal(setMode(s, id, 'cutBlock'), false, `${id} is offense but not a lineman`);
  }
  for (const id of ['d-nt', 'd-dt1', 'd-dt2', 'd-cb1', 'd-cb2', 'd-lb', 'd-s']) {
    assert.equal(setMode(s, id, 'cutBlock'), false, `${id} is defense`);
  }
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

test('the AI level defaults to the pursuit brain and can be asked for smart', () => {
  assert.equal(createGame({ seed: 1 }).aiLevel, 'pursuit');
  assert.equal(createGame({ seed: 1, ai: 'defense' }).aiLevel, 'pursuit');
  assert.equal(createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' }).aiLevel, 'smart');
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
  // Linemen can never tuck (see the mode-legality test above), so hand the
  // ball to a back to demonstrate the tucked axis-lock.
  s.ball.carrierId = 'o-rb';
  const rb = getPlayer(s, 'o-rb');
  setMode(s, 'o-rb', 'tucked');
  assert.notEqual(rb.facing, null, 'tucking commits to a line same as breaking down');
  setMode(s, 'o-rb', 'normal');
  assert.equal(rb.facing, null, 'standing back up releases it');

  const lg = getPlayer(s, 'o-lg');
  setMode(s, 'o-lg', 'holding');
  assert.notEqual(lg.facing, null, 'holding position commits to a line too');
});

test('a new game comes up with the snap planned, nothing thrown, and no flag', () => {
  const s = createGame({ seed: 1 });
  // Not null any more: the centre has the ball and is already aimed at the
  // quarterback. It is marked `auto` because nobody asked for it, and it
  // carries a `target` so the whistle re-aims it at him rather than firing
  // along wherever he happened to be standing when the huddle broke.
  assert.deepEqual(s.plannedPass, {
    from: 'o-c', dir: { x: 0, y: -1 }, power: 0, auto: true, target: 'o-qb',
  });
  assert.equal(s.forwardPasses, 0, 'planned, not thrown');
  assert.equal(s.penalty, null);
});

test('aimSnap locks the snap onto the quarterback, not just aims a fallback at him', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.plannedPass.target, SNAP_TARGET_ID);
  // Re-aiming (the quarterback having moved) keeps the lock, it doesn't drop it.
  getPlayer(s, 'o-qb').pos = { x: 155, y: 70 };
  assert.equal(aimSnap(s), true);
  assert.equal(s.plannedPass.target, SNAP_TARGET_ID);
});

test('the snap is aimed at the quarterback, wherever he is standing', () => {
  const s = createGame({ seed: 1 });
  // Straight back to begin with, and it follows him: put him out to one side
  // and re-aim, and the throw leans that way instead.
  assert.deepEqual(s.plannedPass.dir, { x: 0, y: -1 });
  getPlayer(s, 'o-qb').pos = { x: 155, y: 70 };
  assert.equal(aimSnap(s), true);
  assert.ok(s.plannedPass.dir.x > 0, 'aimed to his new side');
  assert.ok(s.plannedPass.dir.y < 0, 'and still backwards, so it stays a lateral');
});

test('a throw the coach set himself is never re-aimed by the snap', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.plannedPass.auto, true);
  // His own call replaces it, and carries no `auto` mark...
  assert.equal(setPass(s, 'o-c', { x: 1, y: 0 }, 0.4), true);
  assert.equal(s.plannedPass.auto, undefined);
  // ...so re-aiming refuses to touch it, however many times it is asked.
  assert.equal(aimSnap(s), false);
  assert.deepEqual(s.plannedPass, { from: 'o-c', dir: { x: 1, y: 0 }, power: 0.4, target: null });
});

test('the snap is only planned before the play, and only from the man with the ball', () => {
  const s = createGame({ seed: 1 });
  s.plannedPass = null;
  s.turnIndex = 1;
  assert.equal(aimSnap(s), false, 'the play has started');
  s.turnIndex = 0;
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  assert.equal(aimSnap(s), false, 'the centre is not the one holding it');
  assert.equal(s.plannedPass, null);
});

test('only the ball carrier can plan a throw, and a second throw replaces the first', () => {
  const s = createGame({ seed: 1 });
  // Take the snap first: this is about setPass, not about who starts with it.
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  assert.equal(setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5), true);
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 0, y: 1 }, power: 0.5, target: null });
  setPass(s, 'o-qb', { x: 1, y: 0 }, 0.9);
  assert.deepEqual(s.plannedPass, { from: 'o-qb', dir: { x: 1, y: 0 }, power: 0.9, target: null });
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

test('a throw can be locked onto a receiver, and the next one clears the lock', () => {
  const s = createGame({ seed: 1 });
  // Take the snap first: this is about the lock, not about who starts with it.
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5, 'o-wr1');
  assert.equal(s.plannedPass.target, 'o-wr1');
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5);
  assert.equal(s.plannedPass.target, null, 'a fresh drag is a fresh order');
});

test('Clear Arrows drops the coach\'s throw and leaves the snap standing', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-c', { x: 1, y: 0 }, 0.5); // his own call, out to the side
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  clearAllPlans(s);
  assert.ok(s.players.every((p) => p.plan === null), 'the arrows are gone');
  // Wiping the board must not leave a down that cannot start, so the snap is
  // put straight back — aimed at the quarterback again, not out to the side.
  assert.deepEqual(s.plannedPass, {
    from: 'o-c', dir: { x: 0, y: -1 }, power: 0, auto: true, target: 'o-qb',
  });
});

test('the default spots are the formation every down opens in', () => {
  const s = createGame({ seed: 1 });
  const spots = defaultSpots();
  assert.equal(Object.keys(spots).length, s.players.length);
  for (const p of s.players) {
    const { across, down } = spots[p.id];
    assert.deepEqual(p.pos, fieldPos(across, s.losYard + down));
  }
});

test('defensePlayers builds just the defense half of a formation, at any spot', () => {
  const players = defensePlayers(20, '7');
  assert.equal(players.length, 7);
  assert.ok(players.every((p) => p.team === 'defense'));
  const nt = players.find((p) => p.id === 'd-nt');
  assert.deepEqual(nt.pos, fieldPos(0, 21), 'a yard on the defense side of the 20');
});

test('defensePlayers picks up a nickel or dime package exactly like formationPlayers would', () => {
  const players = defensePlayers(20, '7-nickel');
  assert.equal(players.length, 7);
  assert.deepEqual(players.map((p) => p.id).sort(),
    ['d-cb1', 'd-cb2', 'd-dt1', 'd-lb', 'd-lb2', 'd-nt', 'd-s']);
});
