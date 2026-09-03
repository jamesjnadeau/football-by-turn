import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapLook, advanceRead, advancePlay } from '../../lib/game/read.js';
import { createGame, setMode } from '../../lib/game/state.js';
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
  const g = { ...inert(), 'read:prior': 0.5, 'read:spread': 2, 'read:backs': -1 };
  const look = { spread: 0.25, backs: 0.5, qbDepth: 6 };
  const r = advanceRead(look, null, null, g);
  assert.equal(r.pass, 0.5 + 2 * 0.25 + -1 * 0.5); // 0.5
  assert.equal(r.confidence, Math.tanh(0.5));
  assert.equal(r.committed, false); // read:commit inits at 8
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
