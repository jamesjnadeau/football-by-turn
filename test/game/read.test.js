import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapLook, manCues, advanceRead, advancePlay, setCalledPlay,
} from '../../lib/game/read.js';
import { learnedOrders } from '../../lib/game/learned/defense-policy.js';
import {
  createGame, getPlayer, setMode, setPlan,
} from '../../lib/game/state.js';
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
});

test('advancePlay builds the percept on the turn it finds none', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.playRead, null);
  advancePlay(s, inert());
  assert.deepEqual(s.playRead.look, snapLook(s));
  assert.deepEqual(s.playRead.call, { offense: null, defense: null });
  assert.deepEqual(s.playRead.reads, {});
});

test('the look is frozen: scattering the offense does not move it', () => {
  const s = createGame({ seed: 1 });
  advancePlay(s, inert());
  const before = { ...s.playRead.look };
  // Sweep the whole offense to one sideline — a live measurement would jump.
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 6);
  }
  // A new turn: advancePlay is a no-op on a turn it has already advanced, so
  // without this the second call below would prove nothing at all.
  s.turnIndex = 1;
  advancePlay(s, inert());
  assert.deepEqual(s.playRead.look, before);
});

test('an inert genome never gets past an empty percept: no cover is ever made, so no read is ever taken', () => {
  const s = createGame({ seed: 1 });
  const g = inert();
  advancePlay(s, g);
  for (let i = 1; i <= 5; i++) {
    s.turnIndex = i;
    advancePlay(s, g);
  }
  assert.deepEqual(s.playRead.reads, {});
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
  assert.ok(s.playRead.reads);
});

test('the accumulator: inertia carries last turn, the cues add on top', () => {
  const g = { ...inert(), 'read:man:downfield': 2, 'read:man:lateral': -1, 'read:man:inertia': 0.5 };
  const prev = { pass: 0.4, confidence: Math.tanh(0.4), committed: false };
  const r = advanceRead(prev, { downfield: 0.25, lateral: 0.5 }, g);
  // 0.5*0.4 + 2*0.25 + -1*0.5 = 0.2 + 0.5 - 0.5 = 0.2
  assert.ok(Math.abs(r.pass - 0.2) < 1e-9, r.pass);
  assert.equal(r.confidence, Math.tanh(r.pass));
});

test('with no prior at all, the accumulator starts from the cues alone', () => {
  const g = { ...inert(), 'read:man:downfield': 1, 'read:man:inertia': 0.9 };
  const r = advanceRead(null, { downfield: 1, lateral: 0 }, g);
  assert.equal(r.pass, 1); // no prior to carry, whatever read:man:inertia is
});

test('confidence is bounded and committed follows read:man:commit', () => {
  const g = { ...inert(), 'read:man:downfield': 4, 'read:man:commit': 1 };
  const r = advanceRead(null, { downfield: 1, lateral: 0 }, g);
  assert.ok(r.confidence < 1);
  assert.equal(r.committed, true);
});

test('a covered man in a pass-protection stance reads the same as one without', () => {
  // manCues is built from baseSpeed (radius only, no SPEED_MULT), so a
  // stance an ORDER would put a man in must not move the cue -- the one
  // thing this file may never learn except from motion.
  const s = createGame({ seed: 1 });
  const man = getPlayer(s, 'o-rb');
  man.vel = { x: 3, y: -8 };
  const bare = manCues(s, man);
  setMode(s, man.id, 'holding');
  assert.deepEqual(manCues(s, man), bare);
});

test('a call written before the first turn does not cost the down its snap read', () => {
  // setCalledPlay can be the first thing to touch a down: the training harness
  // coaches before runTurn, and the offense's autoplan button runs in planning.
  const g = inert();
  const early = createGame({ seed: 1 });
  setCalledPlay(early, 'offense', { call: 'run', side: 1, give: false });
  advancePlay(early, g);

  const plain = createGame({ seed: 1 });
  advancePlay(plain, g);

  assert.deepEqual(early.playRead.reads, plain.playRead.reads);
  assert.deepEqual(early.playRead.reads, {});
});

test('a fresh down clears the percept, and the next advancePlay starts with no reads', () => {
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

  advancePlay(s, inert());
  assert.deepEqual(s.playRead.reads, {}, 'the new down starts exactly like the last one did');
});

test('a defender covering a man who is not getting downfield reads run', () => {
  const g = { ...inert(), 'read:man:downfield': 1 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g); // turn 0: the snap, no cover yet
  s.playRead.call.defense = { scheme: 'man', cover: new Map([['d-cb1', 'o-wr1']]) };
  getPlayer(s, 'o-wr1').vel = { x: 0, y: -60 }; // held up, not releasing downfield
  s.turnIndex = 1;
  advancePlay(s, g);
  const read = s.playRead.reads['d-cb1'];
  assert.ok(read.pass < 0 && read.committed, `expected a committed run read, got ${JSON.stringify(read)}`);
});

test('a defender covering a man getting downfield fast reads pass', () => {
  const g = { ...inert(), 'read:man:downfield': 1 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g);
  s.playRead.call.defense = { scheme: 'man', cover: new Map([['d-cb1', 'o-wr1']]) };
  getPlayer(s, 'o-wr1').vel = { x: 0, y: 60 }; // releasing hard downfield
  s.turnIndex = 1;
  advancePlay(s, g);
  const read = s.playRead.reads['d-cb1'];
  assert.ok(read.pass > 0 && read.committed, `expected a committed pass read, got ${JSON.stringify(read)}`);
});

test('the lateral cue separates the fake from a real pass, which downfield alone does not', () => {
  const g = { ...inert(), 'read:man:lateral': 1 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g);
  s.playRead.call.defense = { scheme: 'man', cover: new Map([['d-cb1', 'o-wr1']]) };
  getPlayer(s, 'o-wr1').vel = { x: 45, y: 0 }; // sideways, no downfield gain at all
  s.turnIndex = 1;
  advancePlay(s, g);
  const read = s.playRead.reads['d-cb1'];
  assert.ok(read.pass > 0 && read.committed, `expected lateral motion to commit a pass read, got ${JSON.stringify(read)}`);
});

test('inertia keeps a run read alive for a turn after the man releases (the fake)', () => {
  const g = { ...inert(), 'read:man:downfield': 1, 'read:man:inertia': 0.9 };
  const s = createGame({ seed: 1 });
  advancePlay(s, g); // turn 0: the snap
  s.playRead.call.defense = { scheme: 'man', cover: new Map([['d-cb1', 'o-wr1']]) };
  const man = getPlayer(s, 'o-wr1');
  man.vel = { x: 0, y: -60 }; // held -- a run key, hard
  s.turnIndex = 1;
  advancePlay(s, g);
  assert.ok(s.playRead.reads['d-cb1'].pass < 0 && s.playRead.reads['d-cb1'].committed);

  man.vel = { x: 0, y: 30 }; // he releases -- but the belief carries a turn late
  s.turnIndex = 2;
  advancePlay(s, g);
  assert.ok(
    s.playRead.reads['d-cb1'].pass < 0,
    'still reading run one turn after release, which is the point',
  );
});

test('the read never looks at the orders', () => {
  // Covers every field read.js's own rule forbids except `mode`, which the
  // separate stance test above already pins: the two boards below carry the
  // SAME defensive cover assignment (set directly, not through learnedOrders,
  // so this stays a test of read.js alone) and differ only in what the
  // OFFENSE has drawn -- a movement plan, a stray cover field, and a planned
  // pass, none of which manCues may read.
  const g = { ...inert(), 'read:man:downfield': 1, 'read:man:lateral': 1 };
  const drawn = createGame({ seed: 1 });
  const bare = createGame({ seed: 1 });
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
  const cover = new Map([['d-cb1', 'o-wr1']]);
  drawn.playRead.call.defense = { scheme: 'man', cover };
  bare.playRead.call.defense = { scheme: 'man', cover };
  // A new turn: advancePlay is a no-op on a turn it has already advanced.
  drawn.turnIndex = 1;
  bare.turnIndex = 1;
  advancePlay(drawn, g);
  advancePlay(bare, g);
  assert.deepEqual(drawn.playRead.reads, bare.playRead.reads);
});

test('a zone defender and the rushing line get no read: nobody has a man to key off', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...inert(), 'scheme:bias': 4, 'read:man:downfield': 1 }; // firmly zone
  advancePlay(s, g);
  learnedOrders(s, 'defense', g); // turn 0: writes the zone call, no cover map
  for (const p of s.players) if (p.team === 'offense') p.vel = { x: 0, y: 40 };
  s.turnIndex = 1;
  advancePlay(s, g);
  assert.deepEqual(s.playRead.reads, {}, 'a zone down has nobody to key off');
});

test('the rushing line never gets a read, even in man', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...inert(), 'scheme:bias': -4, 'read:man:downfield': 1 }; // firmly man
  advancePlay(s, g);
  learnedOrders(s, 'defense', g); // turn 0: writes the man call and cover map
  for (const p of s.players) if (p.team === 'offense') p.vel = { x: 0, y: 40 };
  s.turnIndex = 1;
  advancePlay(s, g);
  for (const id of ['d-nt', 'd-dt1', 'd-dt2']) {
    assert.equal(s.playRead.reads[id], undefined, `${id} has no man and no read`);
  }
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
