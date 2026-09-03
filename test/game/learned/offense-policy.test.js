import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxDefenders, callFeatures, chooseCall, chooseSide, planLearnedRun,
  eligibleReceivers, routeDir, planLearnedPassSnap, receiverScore, planThrow,
  coachLearnedOffense, tuckIfPressured,
} from '../../../lib/game/learned/offense-policy.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { createGame, getPlayer, ballPos } from '../../../lib/game/state.js';
import { fieldPos } from '../../../lib/game/view.js';
import { runTurn } from '../../../lib/game/turn.js';
import { mulberry32 } from '../../../lib/game/rng.js';
import { advancePlay } from '../../../lib/game/read.js';
import { OFFENSE_GENOME } from '../../../lib/game/learned/offense-genome.js';

test('the box is the defenders crowding the line near the ball', () => {
  const s = createGame({ seed: 1 });
  // The '7' front: three linemen a yard off the ball, corners 15 wide,
  // backer 4 deep, safety 8 deep — the box is exactly the front three.
  assert.deepEqual(
    boxDefenders(s).map((p) => p.id).sort(),
    ['d-dt1', 'd-dt2', 'd-nt'],
  );
});

test('callFeatures normalizes the situation', () => {
  const s = createGame({ seed: 1 });
  const f = callFeatures(s);
  assert.equal(f.down, 0);
  assert.equal(f.toGo, 1);
  assert.equal(f.box, 3 / 7);
});

test('the call gate is a thresholded logit; the seed genome runs on 1st and 10', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(OFFENSE_SPEC); // bias -2, toGo 1, box 1
  assert.equal(chooseCall(s, g), 'run');
  assert.equal(chooseCall(s, { ...g, 'call:bias': 2 }), 'pass');
  // Stack the box and a box-weighted genome starts throwing.
  const stacked = { ...g, 'call:bias': -1.5, 'call:box': 4 };
  assert.equal(chooseCall(s, stacked), 'pass'); // -1.5 + 1 + 4·(3/7) > 0
});

test('the run goes away from the heavier side of the box', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(OFFENSE_SPEC);
  const ball = ballPos(s);
  // Shift the whole front left of the ball: run right.
  for (const id of ['d-nt', 'd-dt1', 'd-dt2']) {
    getPlayer(s, id).pos = fieldPos(-4, s.losYard + 1);
  }
  assert.equal(chooseSide(s, g), 1);
  // Shift it right: run left.
  for (const id of ['d-nt', 'd-dt1', 'd-dt2']) {
    getPlayer(s, id).pos = fieldPos(4, s.losYard + 1);
  }
  assert.equal(chooseSide(s, g), -1);
});

test('a wide read means give: direct snap to the back, boot fake by the QB', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(OFFENSE_SPEC), 'run:sideBias': 2 }; // force right
  // Park the play-side edge defender wide: contain, so the option gives.
  getPlayer(s, 'd-dt2').pos = fieldPos(6, s.losYard + 1);
  const play = planLearnedRun(s, g);
  assert.deepEqual(play, { call: 'run', side: 1, give: true });
  assert.equal(s.plannedPass.from, 'o-c');
  assert.equal(s.plannedPass.target, 'o-rb');
  assert.notEqual(s.plannedPass.auto, true); // the call replaced the auto snap
  for (const id of ['o-c', 'o-lg', 'o-rg']) {
    assert.equal(getPlayer(s, id).mode, 'cutBlock', id);
  }
  assert.ok(getPlayer(s, 'o-rb').plan.dir.y > 0, 'the back dives upfield');
  assert.ok(getPlayer(s, 'o-qb').plan.dir.x < 0, 'the QB boots away from the play');
});

test('a crashing read means keep: the QB carries it wide', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(OFFENSE_SPEC), 'run:sideBias': 2 };
  // The '7' front is tight (edge defender level with the guard): keep.
  const play = planLearnedRun(s, g);
  assert.deepEqual(play, { call: 'run', side: 1, give: false });
  assert.equal(s.plannedPass.auto, true, 'the ordinary snap to the QB stands');
  assert.ok(getPlayer(s, 'o-qb').plan.dir.x > 0, 'the keep bends play-side');
  assert.ok(getPlayer(s, 'o-qb').plan.dir.y > 0, 'and upfield');
  assert.equal(getPlayer(s, 'o-qb').plan.throttle, 1);
});

test("the read threshold is the genome's, not the constant", () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'd-dt2').pos = fieldPos(4, s.losYard + 1); // ~5.6 units outside the edge
  const wide = { ...makeGenome(OFFENSE_SPEC), 'run:sideBias': 2, 'run:read': 2 };
  assert.equal(planLearnedRun(s, wide).give, true); // 5.6 > 2: contain
  const s2 = createGame({ seed: 1 });
  getPlayer(s2, 'd-dt2').pos = fieldPos(4, s2.losYard + 1);
  const narrow = { ...makeGenome(OFFENSE_SPEC), 'run:sideBias': 2, 'run:read': 10 };
  assert.equal(planLearnedRun(s2, narrow).give, false); // 5.6 < 10: crash
});

test('eligible receivers are the skill men, never the line or the passer', () => {
  const s = createGame({ seed: 1 });
  assert.deepEqual(
    eligibleReceivers(s).map((p) => p.id).sort(),
    ['o-rb', 'o-wr1', 'o-wr2'],
  );
});

test('routeDir turns degrees into unit directions, upfield by default', () => {
  const g = makeGenome(OFFENSE_SPEC);
  const right = routeDir({ ...g, 'route:o-wr2:deg0': 90 }, 'o-wr2', 'deg0');
  assert.ok(Math.abs(right.x - 1) < 1e-9 && Math.abs(right.y) < 1e-9);
  assert.deepEqual(routeDir(g, 'o-te', 'deg0'), { x: 0, y: 1 }); // no key: upfield
  const wr1 = routeDir(g, 'o-wr1', 'deg0'); // init -20°: bends left, still upfield
  assert.ok(wr1.x < 0 && wr1.y > 0);
});

test('a pass snap sends routes, a drop, and protection', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(OFFENSE_SPEC);
  const play = planLearnedPassSnap(s, g);
  assert.deepEqual(play, { call: 'pass' });
  for (const id of ['o-wr1', 'o-wr2', 'o-rb']) {
    assert.ok(getPlayer(s, id).plan, `${id} runs a route`);
  }
  const qb = getPlayer(s, 'o-qb');
  assert.ok(qb.plan.dir.y < 0, 'the QB drops back');
  assert.equal(qb.plan.throttle, g['qb:drop']);
  assert.ok(getPlayer(s, 'o-c').plan, 'the line protects');
  assert.equal(s.plannedPass.auto, true, 'the ordinary snap stands');
});

test('receiverScore prices separation up, depth up, distance down', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = makeGenome(OFFENSE_SPEC); // sep 1, depth 0.5, dist -0.3
  const qb = getPlayer(s, 'o-qb');
  const wr2 = getPlayer(s, 'o-wr2');
  wr2.pos = fieldPos(10, s.losYard + 4);
  getPlayer(s, 'd-cb2').pos = fieldPos(10, s.losYard + 10); // 6 yards of separation
  const base = receiverScore(s, g, qb, wr2);
  getPlayer(s, 'd-cb2').pos = fieldPos(10, s.losYard + 5); // now 1 yard
  assert.ok(receiverScore(s, g, qb, wr2) < base);
});

test('planThrow locks on inside the lock zone and lobs beyond it', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...makeGenome(OFFENSE_SPEC), 'throw:go': -20 }; // anything is open enough
  const qb = getPlayer(s, 'o-qb');
  // wr2 close and wide open: a locked throw.
  getPlayer(s, 'o-wr2').pos = fieldPos(10, s.losYard + 3);
  getPlayer(s, 'o-wr1').pos = fieldPos(-2, s.losYard - 1);
  getPlayer(s, 'o-rb').pos = fieldPos(2, s.losYard - 5);
  getPlayer(s, 'd-cb2').pos = fieldPos(22, s.losYard + 12);
  assert.equal(planThrow(s, g, qb), true);
  assert.equal(s.plannedPass.target, 'o-wr2');

  // The same receiver far downfield: an unlocked lob.
  const s2 = createGame({ seed: 1 });
  s2.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s2.plannedPass = null;
  const qb2 = getPlayer(s2, 'o-qb');
  getPlayer(s2, 'o-wr2').pos = fieldPos(10, s2.losYard + 14);
  getPlayer(s2, 'o-wr1').pos = fieldPos(-2, s2.losYard - 1);
  getPlayer(s2, 'o-rb').pos = fieldPos(2, s2.losYard - 5);
  getPlayer(s2, 'd-cb2').pos = fieldPos(22, s2.losYard + 20);
  assert.equal(planThrow(s2, g, qb2), true);
  assert.equal(s2.plannedPass.target, null);
  assert.ok(s2.plannedPass.dir.y > 0, 'thrown downfield');
});

test('planThrow never plans an illegal forward pass', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...makeGenome(OFFENSE_SPEC), 'throw:go': -20 };
  const qb = getPlayer(s, 'o-qb');
  s.forwardPasses = 1; // one is already spent
  assert.equal(planThrow(s, g, qb), false);
  s.forwardPasses = 0;
  qb.pos = fieldPos(0, s.losYard + 2); // past the line
  assert.equal(planThrow(s, g, qb), false);
});

test('the hold clock forces the throw', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...makeGenome(OFFENSE_SPEC), 'throw:go': 40, 'throw:hold': 2 }; // nobody is ever open
  const qb = getPlayer(s, 'o-qb');
  s.turnIndex = 1;
  assert.equal(planThrow(s, g, qb), false); // still holding
  s.turnIndex = 2;
  assert.equal(planThrow(s, g, qb), true); // clock's up: best available
  assert.ok(s.plannedPass);
});

test('turn 0 decides the call and remembers it', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(OFFENSE_SPEC), 'call:bias': 4 }; // always pass
  coachLearnedOffense(s, g);
  assert.deepEqual(s.playRead.call.offense, { call: 'pass' });
  assert.ok(getPlayer(s, 'o-wr1').plan, 'routes are on');

  const s2 = createGame({ seed: 1 });
  const g2 = { ...makeGenome(OFFENSE_SPEC), 'call:bias': -4 }; // always run
  coachLearnedOffense(s2, g2);
  assert.equal(s2.playRead.call.offense.call, 'run');
});

test('a run play coaches the carrier to daylight, tucked under pressure', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 2;
  s.playRead = { look: null, read: null, call: { offense: { call: 'run', side: 1, give: false }, defense: null } };
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const qb = getPlayer(s, 'o-qb');
  getPlayer(s, 'd-nt').pos = fieldPos(0, s.losYard - 2); // in his face
  coachLearnedOffense(s, makeGenome(OFFENSE_SPEC));
  assert.ok(qb.plan, 'the carrier has somewhere to go');
  assert.equal(qb.mode, 'tucked');
  assert.ok(getPlayer(s, 'o-wr1').plan, 'everyone else blocks');
});

test('a loose ball sends the whole offense after it', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 3;
  s.playRead = { look: null, read: null, call: { offense: { call: 'run', side: 1, give: true }, defense: null } };
  s.ball = { carrierId: null, pos: fieldPos(2, s.losYard - 2), vel: { x: 0, y: 0 }, loose: 0 };
  s.plannedPass = null;
  coachLearnedOffense(s, makeGenome(OFFENSE_SPEC));
  for (const p of s.players.filter((pl) => pl.team === 'offense')) {
    assert.ok(p.plan, `${p.id} chases`);
  }
});

test('a full learned-offense down runs turn by turn without incident', () => {
  const s = createGame({ seed: 21 });
  const g = makeGenome(OFFENSE_SPEC);
  const random = mulberry32(21);
  for (let t = 0; t < 12 && s.phase !== 'playOver'; t++) {
    coachLearnedOffense(s, g);
    runTurn(s, random);
  }
  // Whatever the play became, the engine stayed coherent.
  assert.ok(['playOver', 'planning'].includes(s.phase));
  assert.equal(typeof s.turnIndex, 'number');
});

test('the learned offense records its call on the down, not on a field of its own', () => {
  const s = createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' });
  advancePlay(s);
  coachLearnedOffense(s, OFFENSE_GENOME.values);
  assert.equal(s.aiPlay, undefined);
  assert.ok(['run', 'pass'].includes(s.playRead.call.offense.call));
});

test('the offense call survives into a later turn', () => {
  const s = createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' });
  advancePlay(s);
  coachLearnedOffense(s, OFFENSE_GENOME.values);
  const called = s.playRead.call.offense;
  s.turnIndex = 1;
  coachLearnedOffense(s, OFFENSE_GENOME.values);
  assert.deepEqual(s.playRead.call.offense, called);
});
