import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapLook, advancePlay, setCalledPlay } from '../../lib/game/read.js';
import { createGame } from '../../lib/game/state.js';
import { nextDown } from '../../lib/game/rules.js';
import { fieldPos } from '../../lib/game/view.js';

test('snapLook measures the offense it is handed', () => {
  const s = createGame({ seed: 1 });
  const look = snapLook(s);
  assert.ok(look.spread > 0 && look.spread <= 1);
  assert.ok(look.backs >= 0 && look.backs <= 1);
});

test('advancePlay builds the percept on the turn it finds none', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.playRead, null);
  advancePlay(s);
  assert.deepEqual(s.playRead.look, snapLook(s));
  assert.deepEqual(s.playRead.call, { offense: null, defense: null });
});

test('the look is frozen: scattering the offense does not move it', () => {
  const s = createGame({ seed: 1 });
  advancePlay(s);
  const before = { ...s.playRead.look };
  // Sweep the whole offense to one sideline — a live measurement would jump.
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 6);
  }
  // A new turn: advancePlay is a no-op on a turn it has already advanced, so
  // without this the second call below would prove nothing at all.
  s.turnIndex = 1;
  advancePlay(s);
  assert.deepEqual(s.playRead.look, before);
});

test('the percept is built hot-seat, with no aiTeam at all', () => {
  // Every play the training harness ever scores is this: aiTeam null, both
  // sides coached by the harness itself. A percept that needed an aiTeam
  // would be missing from all of them.
  const s = createGame({ seed: 1 });
  assert.equal(s.aiTeam, null);
  advancePlay(s);
  assert.ok(s.playRead);
  advancePlay(s);
  assert.ok(s.playRead);
});

test('a call written before the first turn does not cost the down its look', () => {
  // setCalledPlay can be the first thing to touch a down: the training harness
  // coaches before runTurn, and the offense's autoplan button runs in planning.
  const early = createGame({ seed: 1 });
  setCalledPlay(early, 'offense', { call: 'run', side: 1, give: false });
  advancePlay(early);

  const plain = createGame({ seed: 1 });
  advancePlay(plain);

  assert.deepEqual(early.playRead.look, plain.playRead.look);
});

test('a fresh down clears the percept, and the next advancePlay starts fresh', () => {
  // Idiom borrowed from rules.test.js's 'between downs' test: snap taken,
  // carrier spotted downfield, then a whistle and nextDown.
  const s = createGame({ seed: 1 }); // 1st & 10 at the 20, toGoYard 30
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  advancePlay(s);
  assert.ok(s.playRead, 'the down this play is about has a percept');

  const qb = s.players.find((p) => p.id === 'o-qb');
  qb.pos = { x: 150, y: fieldPos(0, 24).y }; // a 4-yard gain, short of the sticks
  s.deadReason = 'tackled';
  s.turnIndex = 5;
  nextDown(s);
  assert.equal(s.playRead, null, 'the whistle wipes the percept, not just the call on it');

  advancePlay(s);
  assert.ok(s.playRead, 'the new down gets a percept exactly like the last one did');
});
