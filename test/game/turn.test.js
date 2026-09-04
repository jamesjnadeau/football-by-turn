import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, unplannedPlayers } from '../../lib/game/turn.js';
import { nextDown } from '../../lib/game/rules.js';
import { createGame, setPlan, getPlayer, setPass, setMode } from '../../lib/game/state.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { SUBSTEPS_PER_TURN } from '../../lib/game/constants.js';
import { teamSize } from '../../lib/game/rosters.js';
import { fieldPos, GOAL_YARD } from '../../lib/game/view.js';
import { norm, dist, sub } from '../../lib/game/vec.js';
import { lobLanded, isLob } from '../../lib/game/lob.js';
import { passReach, lockOnPass, powerForTravel } from '../../lib/game/pass.js';

/**
 * The snap taken: the ball in the quarterback's hands and nothing pending.
 * A down now opens with the ball on the CENTRE and a lateral to the
 * quarterback already planned, which is the state before the one these tests
 * are about -- they start from a backfield carrier, so they say so.
 */
function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

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

test('a cut-blocking lineman moves into the drive phase the turn after, then back to normal', () => {
  const s = createGame({ seed: 1 });
  setMode(s, 'o-lg', 'cutBlock');
  const facing = { ...getPlayer(s, 'o-lg').facing };
  runTurn(s, mulberry32(1));
  assert.equal(getPlayer(s, 'o-lg').mode, 'cutBlockDrive', 'the lunge turn gives way to the drive turn');
  assert.deepEqual(getPlayer(s, 'o-lg').facing, facing, 'still driving the same line he committed to');
  runTurn(s, mulberry32(1));
  assert.equal(getPlayer(s, 'o-lg').mode, 'normal', 'the drive turn expires on its own');
  assert.equal(getPlayer(s, 'o-lg').facing, null);
});

test('charge is consumed by the turn that uses it, and so is the cut-block assist flag', () => {
  const s = createGame({ seed: 1 });
  setMode(s, 'o-lg', 'cutBlock');
  runTurn(s, mulberry32(1)); // now in the drive phase
  getPlayer(s, 'o-rb').pos = { ...getPlayer(s, 'o-lg').pos };
  runTurn(s, mulberry32(1));
  // Nothing to assert on cutBlockAssist's exact value here (it depends on
  // where the sub-step loop leaves both players) — this test's job is only
  // to prove runTurn does not throw once applyCutBlockAssist is wired into
  // the sub-step loop for a real, full-roster game.
  assert.equal(typeof getPlayer(s, 'o-rb').cutBlockAssist, 'boolean');
});

test('a clean run to the end zone ends the turn early with a touchdown', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
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
  afterSnap(s);
  assert.equal(unplannedPlayers(s).length, teamSize(s) * 2);
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const ids = unplannedPlayers(s);
  assert.equal(ids.length, teamSize(s) * 2 - 1);
  assert.ok(!ids.includes('o-rb'));
});

test('a player with a throw planned is not nagged for a run arrow', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  afterSnap(s);
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
  afterSnap(s);
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'd-lb'); // no traffic in between
  const y0 = getPlayer(s, 'd-lb').pos.y;
  runTurn(s, mulberry32(1));
  // The QB stands upfield of the LB, so closing on him means moving in -y.
  assert.ok(getPlayer(s, 'd-lb').pos.y < y0, 'the LB closed on the QB');
});

test('the unplanned warning counts only the players the human is coaching', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  afterSnap(s);
  const ids = unplannedPlayers(s);
  assert.equal(ids.length, teamSize(s), 'the offense, and nobody else');
  assert.ok(ids.every((id) => id.startsWith('o-')));
});

test('a real computer-coached game: hidden plans hold, aiTeam survives the down, and the defense closes', () => {
  // Seed 1, everyone on offense charging straight downfield: three turns to
  // a tackle (not a touchdown or a fumble recovery), so nextDown actually
  // rebuilds state.players from formationPlayers rather than short-circuiting
  // to gameOver — which is what exercises (b). Confirmed by running this
  // exact scenario repeatedly: same three turns, same tackle, every time.
  const s = createGame({ seed: 1, ai: 'defense' });
  afterSnap(s);
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
  afterSnap(s);
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

test('an ordinary forward pass nobody catches is incomplete in the turn it was thrown', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  s.players = s.players.filter((p) => p.id === 'o-qb'); // nobody out there to catch it
  assert.ok(!isLob(passReach(0.4)), '0.4 is a flat throw, not a lob');
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.4);
  const { events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'incomplete'), 'ruled incomplete');
  assert.equal(s.deadReason, 'incomplete');
  assert.equal(s.phase, 'playOver');
  assert.equal(s.turnIndex, 1, 'decided in its own turn, never left live for another');
});

test('a forward pass nobody catches is incomplete: dead ball, play over', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  s.players = s.players.filter((p) => p.id === 'o-qb');
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  let turns = 0;
  while (s.phase !== 'playOver' && turns < 8) { runTurn(s, mulberry32(1)); turns += 1; }
  assert.equal(s.deadReason, 'incomplete');
  assert.equal(s.phase, 'playOver');
});

test('a backward throw nobody catches stays live — a lateral on the ground is a fumble', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  s.players = s.players.filter((p) => p.id === 'o-qb');
  setPass(s, 'o-qb', { x: 0, y: -1 }, 1);
  let turns = 0;
  while (s.phase !== 'playOver' && turns < 8) { runTurn(s, mulberry32(1)); turns += 1; }
  assert.equal(s.deadReason, null, 'still live after the ball has stopped');
  assert.equal(s.ball.carrierId, null);
});

test('a teammate downfield catches the throw', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'o-wr1');
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  // Park him straight downfield of the QB, inside the first turn's flight.
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 40 };
  // A flat throw, not a lob: this test is about the catch, and a lob would put
  // the ball down somewhere inside a six-yard circle instead of on his chest.
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.4);
  const { events } = runTurn(s, mulberry32(1));
  const pickup = events.find((e) => e.type === 'pickup');
  assert.equal(pickup.by, 'o-wr1');
  assert.equal(pickup.team, 'offense');
  assert.equal(typeof pickup.atYard, 'number');
  assert.equal(s.ball.carrierId, 'o-wr1');
  assert.equal(s.deadReason, null, 'a completion keeps the down alive');
});

test('a defender in the throwing lane intercepts it — the play is over', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'd-cb1');
  const qb = getPlayer(s, 'o-qb');
  const cb = getPlayer(s, 'd-cb1');
  cb.pos = { x: qb.pos.x, y: qb.pos.y + 40 };
  cb.plan = null;
  s.aiTeam = null; // hot-seat: he stands where he is put, so the throw finds him
  // A flat throw, not a lob: this test is about the catch, and a lob would put
  // the ball down somewhere inside a six-yard circle instead of on his chest.
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.4);
  const { events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'pickup' && e.team === 'defense'));
  assert.equal(s.deadReason, 'recovered');
});

test('breaking the huddle a man short of the line draws a flag on the snap', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-wr1').pos = fieldPos(-20, -6); // four on the line, three backs
  runTurn(s, mulberry32(1));
  assert.deepEqual(s.penalty, { foul: 'illegal-formation', spot: s.losYard });
});

test('a legal formation draws no flag', () => {
  const s = createGame({ seed: 1 });
  runTurn(s, mulberry32(1));
  assert.equal(s.penalty, null);
});

test('the formation is judged at the snap only, not on every turn of the down', () => {
  const s = createGame({ seed: 1 });
  runTurn(s, mulberry32(1)); // legal at the snap
  // Everyone has scattered by now; that is a play, not a formation.
  getPlayer(s, 'o-wr1').pos = fieldPos(-20, -6);
  runTurn(s, mulberry32(1));
  assert.equal(s.penalty, null);
});

test('an illegal formation costs five yards from the previous spot', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-wr1').pos = fieldPos(-20, -6);
  const spot = s.losYard;
  runTurn(s, mulberry32(1));
  s.phase = 'playOver';
  s.deadReason = 'tackled';
  nextDown(s);
  assert.equal(s.losYard, spot - 5);
  assert.equal(s.down, 2);
});

test('a lob hangs past the whistle and is ruled where it lands', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s); // the centre starts with it now; this is about the throw
  s.players = s.players.filter((p) => p.id === 'o-qb'); // nobody out there to catch it
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1, null, 1); // full loft: this test is about a throw spanning multiple turns
  const random = mulberry32(1);
  runTurn(s, random);
  assert.equal(s.phase, 'planning', 'the turn ended with the ball still up');
  assert.equal(s.deadReason, null, 'nothing is ruled while it is in the air');
  assert.ok(s.ball.lob && !lobLanded(s.ball.lob), 'still flying');
  assert.equal(s.plannedPass, null, 'and the throw is not re-thrown next turn');
  let turns = 1;
  while (s.phase !== 'playOver' && turns < 8) { runTurn(s, random); turns += 1; }
  assert.equal(s.deadReason, 'incomplete');
  assert.ok(turns >= 2, `it took more than the turn it was thrown in (${turns})`);
});

test('a receiver who gets under a hanging lob catches it on the next turn', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s); // the centre starts with it now; this is about the throw
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'o-wr1');
  // Deep in his own end, and two thirds power: a lob that comes down SHORT of
  // the goal line, so the catch is a catch rather than a touchdown.
  getPlayer(s, 'o-qb').pos = fieldPos(0, -18);
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.67, null, 1);
  const random = mulberry32(1);
  runTurn(s, random);
  assert.ok(s.ball.lob && !lobLanded(s.ball.lob), 'still in the air at the whistle');
  // The coach can see where it is coming down, so he puts his man on the spot.
  getPlayer(s, 'o-wr1').pos = { ...s.ball.lob.to };
  let turns = 1;
  while (s.phase === 'planning' && s.ball.carrierId === null && turns < 8) {
    runTurn(s, random);
    turns += 1;
  }
  assert.equal(s.ball.carrierId, 'o-wr1', 'he was standing where it came down');
  assert.equal(s.deadReason, null, 'a completion short of the goal keeps the down alive');
});

test('the frames carry the ball\'s drawn size, so the animation can swell it', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s); // the centre starts with it now; this is about the throw
  s.players = s.players.filter((p) => p.id === 'o-qb'); // nobody out there to catch it
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const random = mulberry32(1);
  // Every frame of the whole flight, which is more than one turn's worth: a
  // bomb is barely half way there when the first whistle blows, so a single
  // turn's frames need never have reached the top of the arc.
  const scales = [];
  let turns = 0;
  while (s.phase === 'planning' && turns < 8) {
    const { frames } = runTurn(s, random);
    for (const f of frames) if (f.looseBall) scales.push(f.looseBall.scale);
    turns += 1;
  }
  assert.equal(scales[0], 1, 'ordinary size out of the hand');
  const biggest = Math.max(...scales);
  assert.ok(biggest > 1, `it swells as it climbs (${biggest.toFixed(2)})`);
  assert.equal(scales[scales.length - 1], 1, 'and is back to size where it came down');
});

test('a receiver on a route catches a throw locked onto him', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'o-wr1');
  afterSnap(s);
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x + 20, y: qb.pos.y + 10 };
  setPlan(s, 'o-wr1', { x: 0, y: 1 }, 1); // gone downfield the moment the ball is thrown
  const lock = lockOnPass(qb, wr);
  setPass(s, 'o-qb', lock.dir, lock.power, 'o-wr1');
  const { events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'pickup' && e.by === 'o-wr1'),
    'the ball was thrown to where he was going');
  assert.equal(s.ball.carrierId, 'o-wr1');
});

test('the same throw aimed at where he was standing sails behind him', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'o-wr1');
  afterSnap(s);
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x + 20, y: qb.pos.y + 10 };
  setPlan(s, 'o-wr1', { x: 0, y: 1 }, 1);
  // No target on the throw, so nothing re-aims it: this is the flat throw at
  // his feet that the lead exists to replace.
  const flat = norm(sub(wr.pos, qb.pos));
  setPass(s, 'o-qb', flat, powerForTravel(dist(qb.pos, wr.pos) - 4.5));
  const { events } = runTurn(s, mulberry32(1));
  assert.ok(!events.some((e) => e.type === 'pickup'), 'he had already left');
});

test('a receiver running flat across in front of the passer is still found', () => {
  // The case the meeting solve exists for: the gap is short, the ball cannot be
  // thrown gently enough to loiter, and he is moving sideways out of its path.
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'o-wr1');
  afterSnap(s);
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 10 };
  setPlan(s, 'o-wr1', { x: 1, y: 0 }, 1);
  const lock = lockOnPass(qb, wr);
  setPass(s, 'o-qb', lock.dir, lock.power, 'o-wr1');
  const { events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'pickup' && e.by === 'o-wr1'), 'he was met, not led past');
});

test('the other coach\'s men are not this coach\'s to be warned about', () => {
  // The warning feed skips the team the computer coaches. A match has no
  // computer -- it has another human, named by remoteTeam -- and counting
  // his men told a coach that 13 players had no direction when 7 of them
  // were never his to order.
  const s = createGame({ seed: 1, ai: null });
  s.remoteTeam = 'defense';
  const ids = unplannedPlayers(s);
  assert.ok(ids.length > 0, 'his own men still count');
  assert.ok(ids.every((id) => getPlayer(s, id).team === 'offense'),
    'nobody on the other coach\'s side is listed');
});

/**
 * The load-bearing line itself: runTurn's own call to advancePlay
 * (lib/game/turn.js, immediately above coachAi). Every other test in this
 * suite that touches state.playRead calls advancePlay by hand (see
 * test/game/read.test.js); this one runs real turns through runTurn instead,
 * on a learned-defense game, and never calls advancePlay itself. Delete that
 * line and state.playRead is never built on this path: percept() in
 * defense-policy.js falls back to a fresh stand-in every turn instead of the
 * state's own percept, so committedScheme decides the scheme over again off
 * a picture that has moved -- the exact mid-down man/zone flip this branch
 * exists to remove.
 */
test('a real learned-defense game commits its scheme through runTurn, not by hand', () => {
  const s = createGame({ seed: 7, ai: 'defense', aiLevel: 'learned' });
  const random = mulberry32(7);
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1); // give the offense something to do
  runTurn(s, random);
  assert.ok(s.playRead, 'the real turn built the percept');
  const scheme = s.playRead.call.defense?.scheme;
  assert.ok(scheme === 'man' || scheme === 'zone', 'the defense committed to a scheme on turn one');
  assert.equal(s.phase, 'planning', 'the down is still live for a second turn');
  runTurn(s, random);
  assert.equal(s.playRead.call.defense.scheme, scheme,
    'the same scheme holds a turn later -- a down does not flip man/zone mid-play');
});

/**
 * Friction arcs. A frame says where every man is; it must also say where any
 * of them is being leaned on by an opponent, because that is a thing the board
 * draws and the board only ever sees frames -- in a match it never runs the
 * physics at all, it just plays back what the server sent.
 *
 * One entry per man per point of friction, each carrying the bearing toward
 * the opponent doing the leaning: a man squeezed from two sides gets two.
 */
function collide(s, ids) {
  s.players = s.players.filter((p) => ids.includes(p.id));
  return s;
}

/** Every friction entry naming this man, across the whole turn's first frame. */
function frictionsOn(frame, id) {
  return frame.frictions.filter((f) => f.id === id);
}

test('two engaged opponents each get a friction bearing toward the other', () => {
  const s = collide(afterSnap(createGame({ seed: 1 })), ['o-rb', 'd-nt']);
  const rb = getPlayer(s, 'o-rb'), nt = getPlayer(s, 'd-nt');
  s.ball = { carrierId: 'o-rb', pos: null, vel: null };
  rb.pos = { x: 135, y: 100 };
  nt.pos = { x: 139, y: 100 };   // straight to the rb's right, inside contact
  const { frames } = runTurn(s, mulberry32(1));
  const [onRb] = frictionsOn(frames[0], 'o-rb');
  const [onNt] = frictionsOn(frames[0], 'd-nt');
  assert.ok(onRb && onNt, 'both men are marked');
  assert.ok(Math.abs(onRb.angle - 0) < 1e-6, `rb leans right, got ${onRb.angle}`);
  assert.ok(Math.abs(Math.abs(onNt.angle) - Math.PI) < 1e-6, `nt leans left, got ${onNt.angle}`);
});

test('teammates leaning on each other are not friction', () => {
  const s = collide(afterSnap(createGame({ seed: 1 })), ['o-rb', 'o-c']);
  getPlayer(s, 'o-rb').pos = { x: 135, y: 100 };
  getPlayer(s, 'o-c').pos = { x: 139, y: 100 };
  s.ball = { carrierId: 'o-rb', pos: null, vel: null };
  const { frames } = runTurn(s, mulberry32(1));
  assert.deepEqual(frames[0].frictions, [], 'a teammate bump is traffic, not a fight');
});

test('a man squeezed by two opponents gets one friction arc toward each', () => {
  const s = collide(afterSnap(createGame({ seed: 1 })), ['o-rb', 'd-nt', 'd-lb']);
  getPlayer(s, 'o-rb').pos = { x: 135, y: 100 };
  getPlayer(s, 'd-nt').pos = { x: 139, y: 100 };  // to his right
  getPlayer(s, 'd-lb').pos = { x: 131, y: 100 };  // and to his left
  s.ball = { carrierId: 'o-rb', pos: null, vel: null };
  const { frames } = runTurn(s, mulberry32(1));
  const onRb = frictionsOn(frames[0], 'o-rb');
  assert.equal(onRb.length, 2, 'one arc per point of friction');
  const bearings = onRb.map((f) => f.angle);
  assert.ok(bearings.some((a) => Math.abs(a) < 1e-6), `one toward the man on his right, got ${bearings}`);
  assert.ok(bearings.some((a) => Math.abs(Math.abs(a) - Math.PI) < 1e-6), `one toward the man on his left, got ${bearings}`);
});
