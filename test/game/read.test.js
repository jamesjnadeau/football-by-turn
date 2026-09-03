import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapLook, advanceRead, advancePlay, setCalledPlay } from '../../lib/game/read.js';
import { learnedOrders } from '../../lib/game/learned/defense-policy.js';
import { createGame, getPlayer, setMode, setPlan } from '../../lib/game/state.js';
import { nextDown } from '../../lib/game/rules.js';
import { makeGenome } from '../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { fieldPos } from '../../lib/game/view.js';

const inert = () => makeGenome(DEFENSE_SPEC);

test('snapLook measures the offense it is handed', () => {
  const s = createGame({ seed: 1 });
  const look = snapLook(s);
  assert.ok(look.spread > 0 && look.spread <= 1);
  assert.ok(look.backs >= 0 && look.backs <= 1);
  // The quarterback lines up behind the line, so the reference is positive.
  assert.ok(look.qbDepth > 0);
});

test('advancePlay builds the percept on the turn it finds none', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.playRead, null);
  advancePlay(s, inert());
  assert.deepEqual(s.playRead.look, snapLook(s));
  assert.deepEqual(s.playRead.call, { offense: null, defense: null });
  assert.equal(s.playRead.read.pass, 0);
});

test('the look is frozen: scattering the offense does not move it', () => {
  const s = createGame({ seed: 1 });
  advancePlay(s, inert());
  const before = { ...s.playRead.look };
  // Sweep the whole offense to one sideline — a live measurement would jump.
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 6);
  }
  advancePlay(s, inert());
  assert.deepEqual(s.playRead.look, before);
});

test('an inert genome reads nothing and commits to nothing', () => {
  const s = createGame({ seed: 1 });
  const g = inert();
  advancePlay(s, g);
  for (let i = 0; i < 5; i++) advancePlay(s, g);
  assert.equal(s.playRead.read.pass, 0);
  assert.equal(s.playRead.read.confidence, 0);
  assert.equal(s.playRead.read.committed, false);
});

test('the percept is built hot-seat, with no aiTeam at all', () => {
  // Every play the training harness ever scores is this: aiTeam null, both
  // sides coached by the harness itself. A percept that needed an aiTeam
  // would be missing from all of them.
  const s = createGame({ seed: 1 });
  assert.equal(s.aiTeam, null);
  advancePlay(s, inert());
  assert.ok(s.playRead);
  advancePlay(s, inert());
  assert.ok(s.playRead.read);
});

test('advanceRead at the snap is the prior and the look, and nothing else', () => {
  // read:commit is set explicitly here, above the 0.5 this z lands on --
  // it now inits at 0 (the permissive end; see defense-spec.js), so leaning
  // on the spec's own default would make this test about that init instead
  // of about what it is actually checking: the accumulator's arithmetic.
  const g = {
    ...inert(), 'read:prior': 0.5, 'read:spread': 2, 'read:backs': -1, 'read:commit': 8,
  };
  const look = { spread: 0.25, backs: 0.5, qbDepth: 6 };
  const r = advanceRead(look, null, null, g);
  assert.equal(r.pass, 0.5 + 2 * 0.25 + -1 * 0.5); // 0.5
  assert.equal(r.confidence, Math.tanh(0.5));
  assert.equal(r.committed, false);
});

test('confidence is bounded and committed follows read:commit', () => {
  const g = { ...inert(), 'read:prior': 4, 'read:commit': 1 };
  const r = advanceRead({ spread: 0, backs: 0, qbDepth: 6 }, null, null, g);
  assert.ok(r.confidence < 1);
  assert.equal(r.committed, true);
});

test('a lineman in a pass-protection stance reads the same as one without', () => {
  const g = { ...inert(), 'read:lineFlow': 1 };
  const run = createGame({ seed: 1 });
  const pass = createGame({ seed: 1 });
  advancePlay(run, g);
  advancePlay(pass, g);
  for (const s of [run, pass]) {
    for (const p of s.players) if (p.team === 'offense') p.vel = { x: 0, y: 2 };
  }
  // The only difference: the stance an order would have put them in.
  for (const p of pass.players) {
    if (p.team === 'offense' && ['C', 'LG', 'RG', 'LT', 'RT'].includes(p.role)) {
      setMode(pass, p.id, 'holding');
    }
  }
  advancePlay(run, g);
  advancePlay(pass, g);
  assert.equal(pass.playRead.read.pass, run.playRead.read.pass);
});

test('a call written before the first turn does not cost the down its snap read', () => {
  // setCalledPlay can be the first thing to touch a down: the training harness
  // coaches before runTurn, and the offense's autoplan button runs in planning.
  const g = { ...inert(), 'read:prior': 1.5 };
  const early = createGame({ seed: 1 });
  setCalledPlay(early, 'offense', { call: 'run', side: 1, give: false });
  advancePlay(early, g);

  const plain = createGame({ seed: 1 });
  advancePlay(plain, g);

  assert.equal(early.playRead.read.pass, plain.playRead.read.pass);
  assert.equal(early.playRead.read.pass, 1.5);
});

test('a fresh down clears the percept, and the next advancePlay takes a new snap read', () => {
  // Idiom borrowed from rules.test.js's 'between downs' test: snap taken,
  // carrier spotted downfield, then a whistle and nextDown.
  const s = createGame({ seed: 1 }); // 1st & 10 at the 20, toGoYard 30
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  advancePlay(s, inert());
  assert.ok(s.playRead, 'the down this play is about has a percept');

  const qb = getPlayer(s, 'o-qb');
  qb.pos = { x: 150, y: fieldPos(0, 24).y }; // a 4-yard gain, short of the sticks
  s.deadReason = 'tackled';
  s.turnIndex = 5;
  nextDown(s);
  assert.equal(s.playRead, null, 'the whistle wipes the percept, not just the call on it');

  // The next down's first advancePlay must take the SNAP read (prior + look),
  // not a continued one (inertia off a read that no longer exists) -- the
  // same distinction Finding 1 pins, now proven across a whistle too.
  const g = { ...inert(), 'read:prior': 1.5 };
  advancePlay(s, g);
  assert.equal(s.playRead.read.pass, 1.5);
});

test('a quarterback dropping back reads pass, and the option keep does not', () => {
  const g = { ...inert(), 'read:qbDepth': 1 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g);
  const qb = s.players.find((p) => p.id === 'o-qb');
  const started = qb.pos.y;

  // Five yards further from the line: a full drop.
  qb.pos = { x: qb.pos.x, y: started - 5 * (fieldPos(0, 1).y - fieldPos(0, 0).y) };
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass > 0, 'a drop is a pass key');

  // Reset the belief, then send him forward instead: the option's fake.
  s.playRead = null;
  advancePlay(s, g);
  qb.pos = { x: qb.pos.x, y: started + 2 * (fieldPos(0, 1).y - fieldPos(0, 0).y) };
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass < 0, 'running forward is a run key');
});

// Both directions are pinned deliberately: a cue built from Math.abs(vel.y)
// instead of the signed value would drive downfield AND retreating equally,
// and would still pass a test that only ever checked one direction.
test('a line driving downfield reads run', () => {
  const g = { ...inert(), 'read:lineFlow': 1 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g);
  for (const p of s.players) {
    if (p.team === 'offense') p.vel = { x: 0, y: 40 }; // downfield, hard
  }
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass < 0);
});

test('a line retreating reads pass, not run', () => {
  const g = { ...inert(), 'read:lineFlow': 1 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g);
  for (const p of s.players) {
    if (p.team === 'offense') p.vel = { x: 0, y: -40 }; // pass-set, hard
  }
  advancePlay(s, g);
  // Near +0.93, the mirror of the downfield case: 40 / (150/3.5) = 0.9333.
  assert.ok(s.playRead.read.pass > 0, 'a retreating line is a pass key, not a run key');
});

test('a loose ball reads pass, whoever let go of it', () => {
  const g = { ...inert(), 'read:ballAir': 1 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g);
  s.ball = { carrierId: null, pos: fieldPos(0, s.losYard), vel: { x: 0, y: 1 } };
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass > 0);
});

test('inertia is what play-action fools: run keys stick after they stop', () => {
  const g = { ...inert(), 'read:lineFlow': 2, 'read:inertia': 0.9, 'read:commit': 0.5 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g);
  // Turn 1: the line drives. Run keys, hard.
  //
  // 40 u/s is a real drive, not a nudge: a lineman's own speed is
  // SPEED_FACTOR / radius = 150 / 3.5 = 42.86, so this is most of what he has,
  // and the cue lands near -0.93 rather than the -0.07 a walking pace gives.
  // The read has to clear read:commit below for `committed` to mean anything.
  for (const p of s.players) if (p.team === 'offense') p.vel = { x: 0, y: 40 };
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass < 0 && s.playRead.read.committed);
  // Turn 2: everything stops — the fake is over and it was a pass all along.
  for (const p of s.players) if (p.team === 'offense') p.vel = { x: 0, y: 0 };
  advancePlay(s, g);
  assert.ok(s.playRead.read.pass < 0, 'he is still wrong, which is the point');
});

test('the read never looks at the orders', () => {
  // Covers every field read.js:21 forbids except `mode`, which the separate
  // 'a lineman in a pass-protection stance reads the same as one without'
  // test above already pins.
  const g = { ...inert(), 'read:qbDepth': 1, 'read:lineFlow': 1, 'read:ballAir': 1 };
  const drawn = createGame({ seed: 1 });
  const bare = createGame({ seed: 1 });
  // Draw a whole passing play on one of them and nothing on the other: a
  // movement plan, a cover assignment, and a planned pass, none of which the
  // other board has. No physics has run, so the two boards are physically
  // identical — only the orders differ.
  const qb = drawn.players.find((p) => p.id === 'o-qb');
  setPlan(drawn, qb.id, { x: 0, y: -1 }, 1);
  for (const p of drawn.players) {
    if (p.team === 'offense' && p.id !== qb.id) setPlan(drawn, p.id, { x: 0, y: 1 }, 1);
  }
  drawn.players.find((p) => p.id === 'o-wr1').cover = 'd-cb1';
  drawn.plannedPass = {
    from: 'o-qb', dir: { x: 0, y: 1 }, power: 1, target: 'o-wr1', auto: false,
  };
  advancePlay(drawn, g);
  advancePlay(bare, g);
  advancePlay(drawn, g);
  advancePlay(bare, g);
  assert.deepEqual(drawn.playRead.read, bare.playRead.read);
});

test('an inert genome triggers nothing, ever', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = inert();
  advancePlay(s, g);
  const withPercept = learnedOrders(s, 'defense', g);
  // The same state with no percept at all: the fallback path.
  const bare = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  bare.ball = { carrierId: 'o-qb', pos: null, vel: null };
  bare.plannedPass = null;
  assert.deepEqual(withPercept, learnedOrders(bare, 'defense', g));
});
