import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, unplannedPlayers } from '../../lib/game/turn.js';
import { nextDown } from '../../lib/game/rules.js';
import { createGame, setPlan, getPlayer, setPass } from '../../lib/game/state.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { SUBSTEPS_PER_TURN, TEAM_SIZE } from '../../lib/game/constants.js';
import { fieldPos, GOAL_YARD } from '../../lib/game/view.js';
import { norm, dist } from '../../lib/game/vec.js';

test('a turn produces one frame per sub-step and moves planned players', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const y0 = getPlayer(s, 'o-rb').pos.y;
  const { frames } = runTurn(s, mulberry32(1));
  assert.equal(frames.length, SUBSTEPS_PER_TURN);
  assert.ok(getPlayer(s, 'o-rb').pos.y > y0);
  assert.equal(s.phase, 'planning');
  assert.equal(s.turnIndex, 1);
});

test('velocity persists into the next turn (momentum carries)', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  runTurn(s, mulberry32(1));
  const v = getPlayer(s, 'o-rb').vel.y;
  assert.ok(v > 0, 'still moving after the turn ends');
});

test('charge is consumed by the turn that uses it', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-qb').charge = 1;
  runTurn(s, mulberry32(1));
  assert.equal(getPlayer(s, 'o-qb').charge, 0);
});

test('a clean run to the end zone ends the turn early with a touchdown', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb'); // no defense in the way
  const qb = getPlayer(s, 'o-qb');
  qb.pos = fieldPos(0, GOAL_YARD - 0.5);
  qb.vel = { x: 0, y: 20 };
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  const { frames, events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'touchdown'));
  assert.equal(s.phase, 'playOver');
  assert.ok(frames.length < SUBSTEPS_PER_TURN, 'stopped at the whistle');
});

test('a full scripted play: everyone charges, the play eventually ends', () => {
  // Everyone charging exactly straight up/down the field is a knife-edge, and
  // the reason is visible in physics.js's resolveCollisions: it is entirely
  // deterministic and symmetric about the x axis. The O-line and D-line meet
  // head-on with equal mass, equal target speed, and exactly mirrored x
  // positions, so every pairwise push and friction impulse has an equal and
  // opposite twin. Nothing in the loop can break that tie, and no defender
  // ever reaches the carrier to make checkTackles roll a die — so the exact
  // mirror is a genuine fixed point, not a slow grind.
  //
  // A real player never draws 14 pixel-perfect vertical arrows, so nudge every
  // plan a few degrees off the vertical (still "everyone charges downfield",
  // just not an exact mirror). That is the realistic case the spec's
  // "eventually ends" claim is about, and with the mirror broken some defender
  // does close the gap, so checkTackles's random() actually gets exercised.
  // 40 turns is a generous cap: across seeds 1-20, 50, 100, 500 and 12345 the
  // slowest play here ends on turn 10, most on turn 5.
  const s = createGame({ seed: 3 });
  for (const p of s.players) {
    const dir = norm({ x: p.team === 'offense' ? 0.05 : -0.05, y: p.team === 'offense' ? 1 : -1 });
    setPlan(s, p.id, dir, 1);
  }
  const random = mulberry32(3);
  let turns = 0;
  while (s.phase !== 'playOver' && turns < 40) {
    runTurn(s, random);
    turns += 1;
  }
  assert.equal(s.phase, 'playOver');
  assert.ok(s.deadReason, `play ended by ${s.deadReason}`);
});

test('unplannedPlayers lists everyone without an arrow (the warning feed)', () => {
  const s = createGame({ seed: 1 });
  assert.equal(unplannedPlayers(s).length, TEAM_SIZE * 2);
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const ids = unplannedPlayers(s);
  assert.equal(ids.length, TEAM_SIZE * 2 - 1);
  assert.ok(!ids.includes('o-rb'));
});

test('a player with a throw planned is not nagged for a run arrow', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.ok(unplannedPlayers(s).includes('o-qb'));
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  assert.ok(!unplannedPlayers(s).includes('o-qb'), 'he has a plan — to throw');
});

test('the computer coaches the defense during the turn — and its arrows never survive it', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  runTurn(s, mulberry32(1));
  const defense = s.players.filter((p) => p.team === 'defense');
  assert.ok(
    defense.every((p) => p.plan === null),
    'nothing of the computer\'s is readable once we are back in planning',
  );
  assert.ok(
    defense.some((p) => p.vel.x !== 0 || p.vel.y !== 0),
    'but the defense did move, so it really was coached',
  );
});

test('the computer runs its players at the ball', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'd-lb'); // no traffic in between
  const y0 = getPlayer(s, 'd-lb').pos.y;
  runTurn(s, mulberry32(1));
  // The QB stands upfield of the LB, so closing on him means moving in -y.
  assert.ok(getPlayer(s, 'd-lb').pos.y < y0, 'the LB closed on the QB');
});

test('the unplanned warning counts only the players the human is coaching', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const ids = unplannedPlayers(s);
  assert.equal(ids.length, TEAM_SIZE, 'the offense, and nobody else');
  assert.ok(ids.every((id) => id.startsWith('o-')));
});

test('a real computer-coached game: hidden plans hold, aiTeam survives the down, and the defense closes', () => {
  // Seed 1, everyone on offense charging straight downfield: three turns to
  // a tackle (not a touchdown or a fumble recovery), so nextDown actually
  // rebuilds state.players from formationPlayers rather than short-circuiting
  // to gameOver — which is what exercises (b). Confirmed by running this
  // exact scenario repeatedly: same three turns, same tackle, every time.
  const s = createGame({ seed: 1, ai: 'defense' });
  for (const p of s.players) {
    if (p.team === 'offense') setPlan(s, p.id, { x: 0, y: 1 }, 1);
  }
  const random = mulberry32(1);

  const carrierDist = () => {
    const car = getPlayer(s, s.ball.carrierId);
    const defense = s.players.filter((p) => p.team === 'defense');
    return Math.min(...defense.map((d) => dist(d.pos, car.pos)));
  };
  const snapDist = carrierDist();

  let turns = 0;
  let lastDist = snapDist;
  while (s.phase !== 'playOver' && turns < 15) {
    runTurn(s, random);
    turns += 1;
    assert.ok(
      s.players.filter((p) => p.team === 'defense').every((p) => p.plan === null),
      `no computer plan should survive turn ${turns}`,
    );
    lastDist = carrierDist();
  }
  assert.equal(s.phase, 'playOver');
  assert.equal(s.deadReason, 'tackled', 'a real tackle, not a touchdown or a fumble recovery');
  assert.ok(
    lastDist < snapDist * 0.5,
    `the defense should have closed a lot of ground: ${snapDist.toFixed(2)} at the snap, ${lastDist.toFixed(2)} at the whistle`,
  );

  nextDown(s);
  assert.equal(s.aiTeam, 'defense', 'aiTeam survives the wholesale player rebuild between downs');
  assert.equal(s.phase, 'planning');
});

test('a planned throw goes up at the snap of the turn, and the ball flies', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb'); // nobody out there to catch it
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const { frames, events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'pass'), 'the throw was reported');
  assert.equal(s.ball.carrierId, null, 'the ball is out of his hands');
  assert.ok(frames[0].looseBall, 'loose from the very first sub-step');
  const first = frames[0].ball;
  const last = frames[frames.length - 1].ball;
  const travelled = Math.hypot(last.x - first.x, last.y - first.y);
  assert.ok(travelled > 40, `the throw covered ground (${travelled.toFixed(1)} units)`);
  assert.equal(s.plannedPass, null, 'a throw is planned for one turn only');
});

test('a forward pass nobody catches is incomplete in the turn it was thrown', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb'); // nobody out there to catch it
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const { events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'incomplete'), 'ruled incomplete');
  assert.equal(s.deadReason, 'incomplete');
  assert.equal(s.phase, 'playOver');
  assert.equal(s.turnIndex, 1, 'decided in its own turn, never left live for another');
});

test('a forward pass nobody catches is incomplete: dead ball, play over', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb');
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  let turns = 0;
  while (s.phase !== 'playOver' && turns < 8) { runTurn(s, mulberry32(1)); turns += 1; }
  assert.equal(s.deadReason, 'incomplete');
  assert.equal(s.phase, 'playOver');
});

test('a backward throw nobody catches stays live — a lateral on the ground is a fumble', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb');
  setPass(s, 'o-qb', { x: 0, y: -1 }, 1);
  let turns = 0;
  while (s.phase !== 'playOver' && turns < 8) { runTurn(s, mulberry32(1)); turns += 1; }
  assert.equal(s.deadReason, null, 'still live after the ball has stopped');
  assert.equal(s.ball.carrierId, null);
});

test('a teammate downfield catches the throw', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'o-wr1');
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  // Park him straight downfield of the QB, inside the first turn's flight.
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 40 };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const { events } = runTurn(s, mulberry32(1));
  assert.deepEqual(
    events.find((e) => e.type === 'pickup'),
    { type: 'pickup', by: 'o-wr1', team: 'offense' },
  );
  assert.equal(s.ball.carrierId, 'o-wr1');
  assert.equal(s.deadReason, null, 'a completion keeps the down alive');
});

test('a defender in the throwing lane intercepts it — the play is over', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'd-cb1');
  const qb = getPlayer(s, 'o-qb');
  const cb = getPlayer(s, 'd-cb1');
  cb.pos = { x: qb.pos.x, y: qb.pos.y + 40 };
  cb.plan = null;
  s.aiTeam = null; // hot-seat: he stands where he is put, so the throw finds him
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const { events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'pickup' && e.team === 'defense'));
  assert.equal(s.deadReason, 'recovered');
});
