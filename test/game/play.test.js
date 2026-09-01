import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, setPlan, setMode, setPass, getPlayer, formationPlayers,
} from '../../lib/game/state.js';
import {
  canUsePlays, capturePlay, applyPlay, isEmptyPlay, sanitizePlay, PLAY_NAME_MAX,
} from '../../lib/game/play.js';
import { fieldPos } from '../../lib/game/view.js';

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

// A first-turn game with the computer coaching the defense — the game as
// app/main.js actually creates it — with two arrows drawn on it.
function drawn() {
  const state = afterSnap(createGame({ ai: 'defense' }));
  setPlan(state, 'o-qb', { x: 0, y: -1 }, 0.5);
  setPlan(state, 'o-wr1', { x: 1, y: 0 }, 1);
  return state;
}

const goodPlay = () => ({
  name: 'Sweep',
  plans: { 'o-qb': { dir: { x: 0, y: -1 }, throttle: 0.5 } },
  stances: { 'o-rb': { mode: 'holding', facing: { x: 1, y: 0 } } },
  pass: { from: 'o-qb', dir: { x: 0, y: 1 }, power: 0.8 },
});

test('plays are a first-turn-of-a-down thing', () => {
  const state = drawn();
  assert.equal(canUsePlays(state), true);
  state.turnIndex = 1;
  assert.equal(canUsePlays(state), false);
  state.turnIndex = 0;
  state.phase = 'playOver';
  assert.equal(canUsePlays(state), false);
});

test('capturing takes every arrow the human drew', () => {
  const play = capturePlay(drawn(), 'Sweep left');
  assert.equal(play.name, 'Sweep left');
  assert.deepEqual(Object.keys(play.plans).sort(), ['o-qb', 'o-wr1']);
  assert.deepEqual(play.plans['o-qb'], { dir: { x: 0, y: -1 }, throttle: 0.5 });
});

test('capturing leaves the team the computer coaches out of it', () => {
  const state = drawn();
  state.aiTeam = null; // hot-seat: the defense is the human's to coach
  setPlan(state, 'd-lb', { x: 0, y: -1 }, 1);
  assert.ok('d-lb' in capturePlay(state, 'Blitz').plans);
  state.aiTeam = 'defense'; // ...and now it is not
  assert.ok(!('d-lb' in capturePlay(state, 'Blitz').plans));
});

test('a captured play does not share vectors with the live state', () => {
  const state = drawn();
  const play = capturePlay(state, 'Sweep');
  getPlayer(state, 'o-qb').plan.dir.x = 99;
  assert.equal(play.plans['o-qb'].dir.x, 0);
});

test('capturing takes a stance and the axis it locked', () => {
  const state = drawn();
  setMode(state, 'o-qb', 'tucked'); // he has the ball at the snap
  const play = capturePlay(state, 'QB keeper');
  assert.deepEqual(play.stances['o-qb'], { mode: 'tucked', facing: { x: 0, y: -1 } });
});

test('capturing takes a planned throw', () => {
  const state = drawn();
  setPass(state, 'o-qb', { x: 0, y: 1 }, 0.8);
  assert.deepEqual(
    capturePlay(state, 'Post').pass,
    { from: 'o-qb', dir: { x: 0, y: 1 }, power: 0.8 },
  );
});

test('a play with nothing in it is recognisable, and a drawn one is not', () => {
  assert.equal(isEmptyPlay(capturePlay(createGame({ ai: 'defense' }), 'nothing')), true);
  assert.equal(isEmptyPlay(capturePlay(drawn(), 'something')), false);
});

test('a name too long for a slot button is cut on the way in', () => {
  const play = capturePlay(drawn(), 'x'.repeat(PLAY_NAME_MAX + 10));
  assert.equal(play.name.length, PLAY_NAME_MAX);
});

test('applying a play puts the arrows back', () => {
  const play = capturePlay(drawn(), 'Sweep');
  const fresh = createGame({ ai: 'defense' });
  const { applied, skipped } = applyPlay(fresh, play);
  assert.deepEqual(applied.sort(), ['o-qb', 'o-wr1']);
  assert.deepEqual(skipped, []);
  assert.deepEqual(getPlayer(fresh, 'o-wr1').plan, {
    dir: { x: 1, y: 0 }, throttle: 1, target: null, short: false,
  });
});

test('applying a play wipes what was drawn before it', () => {
  const play = capturePlay(drawn(), 'Sweep');
  const other = createGame({ ai: 'defense' });
  afterSnap(other);
  setPlan(other, 'o-rb', { x: -1, y: 0 }, 1);
  setMode(other, 'o-qb', 'tucked');
  setPass(other, 'o-qb', { x: 0, y: 1 }, 0.5);
  applyPlay(other, play);
  assert.equal(getPlayer(other, 'o-rb').plan, null, 'an arrow not in the play is gone');
  assert.equal(getPlayer(other, 'o-qb').mode, 'normal', 'a stance not in the play is gone');
  assert.equal(other.plannedPass, null, 'a throw not in the play is gone');
});

test('applying does not alias the play into the state', () => {
  const play = capturePlay(drawn(), 'Sweep');
  const fresh = createGame({ ai: 'defense' });
  applyPlay(fresh, play);
  getPlayer(fresh, 'o-qb').plan.dir.x = 99;
  assert.equal(play.plans['o-qb'].dir.x, 0);
});

test('applying restores a stance and the axis it locked', () => {
  const state = drawn();
  setMode(state, 'o-qb', 'tucked');
  const play = capturePlay(state, 'QB keeper');
  const fresh = createGame({ ai: 'defense' });
  afterSnap(fresh);
  applyPlay(fresh, play);
  const qb = getPlayer(fresh, 'o-qb');
  assert.equal(qb.mode, 'tucked');
  assert.deepEqual(qb.facing, { x: 0, y: -1 });
  assert.equal(qb.charge, 1, 'the stance arms the next-turn burst, as a double tap would');
});

test('a stance that is no longer legal is skipped, and the rest still loads', () => {
  const state = drawn();
  setMode(state, 'o-qb', 'tucked');
  const play = capturePlay(state, 'QB keeper');
  const fresh = createGame({ ai: 'defense' });
  afterSnap(fresh);
  fresh.ball.carrierId = 'o-rb'; // the RB has it this time, so a QB tuck is illegal
  const { applied, skipped } = applyPlay(fresh, play);
  assert.equal(getPlayer(fresh, 'o-qb').mode, 'normal');
  assert.ok(skipped.includes('o-qb'), 'the stance could not be given');
  assert.ok(applied.includes('o-qb'), 'but his arrow still went on');
  assert.ok(applied.includes('o-wr1'));
});

test('an id this game has no player for is skipped', () => {
  const fresh = createGame({ ai: 'defense' });
  const play = {
    name: 'Old',
    plans: { 'o-te': { dir: { x: 0, y: 1 }, throttle: 1 } },
    stances: {},
    pass: null,
    spots: {},
  };
  const { applied, skipped } = applyPlay(fresh, play);
  assert.deepEqual(applied, []);
  assert.deepEqual(skipped, ['o-te']);
});

test('a play saved in hot-seat skips the defense once the computer has it', () => {
  const state = createGame({ ai: null });
  setPlan(state, 'd-lb', { x: 0, y: -1 }, 1);
  setPlan(state, 'o-qb', { x: 0, y: -1 }, 1);
  const play = capturePlay(state, 'Both teams');
  const fresh = createGame({ ai: 'defense' });
  const { applied, skipped } = applyPlay(fresh, play);
  assert.deepEqual(applied, ['o-qb']);
  // capturePlay now saves a spot for every man in hot-seat, defense included
  // (decision 6), so the whole defense is skipped here, not just the one man
  // with an arrow on him: applyPlay refuses their spots for the same reason
  // it refuses d-lb's plan — none of them are the human's once the computer
  // is coaching that side.
  assert.deepEqual(skipped.sort(), ['d-cb1', 'd-cb2', 'd-dt1', 'd-dt2', 'd-lb', 'd-nt', 'd-s']);
  assert.equal(getPlayer(fresh, 'd-lb').plan, null);
});

test('a throw is put back when the same man has the ball', () => {
  const state = drawn();
  setPass(state, 'o-qb', { x: 0, y: 1 }, 0.8);
  const play = capturePlay(state, 'Post');
  const fresh = createGame({ ai: 'defense' });
  afterSnap(fresh);
  applyPlay(fresh, play);
  assert.deepEqual(fresh.plannedPass, { from: 'o-qb', dir: { x: 0, y: 1 }, power: 0.8, target: null });
});

test('a throw from someone who is not carrying the ball is skipped', () => {
  const state = drawn();
  setPass(state, 'o-qb', { x: 0, y: 1 }, 0.8);
  const play = capturePlay(state, 'Post');
  const fresh = createGame({ ai: 'defense' });
  afterSnap(fresh);
  fresh.ball.carrierId = 'o-rb';
  const { skipped } = applyPlay(fresh, play);
  assert.equal(fresh.plannedPass, null);
  assert.ok(skipped.includes('o-qb'));
});

test('a well-formed play survives sanitising unchanged', () => {
  // goodPlay() is a version-1 fixture — no spots key — so the one thing
  // sanitising adds is the empty formation a play with no spots reads as.
  assert.deepEqual(sanitizePlay(goodPlay()), { ...goodPlay(), spots: {} });
});

test('sanitising drops anything that is not a play', () => {
  for (const bad of [null, undefined, 7, 'a play', [], {}]) {
    assert.equal(sanitizePlay(bad), null, JSON.stringify(bad) ?? 'undefined');
  }
});

test('sanitising rejects a play with a NaN in it', () => {
  const bad = goodPlay();
  bad.plans['o-qb'].dir.x = NaN;
  assert.equal(sanitizePlay(bad), null);
});

test('sanitising clamps a throttle and a power into [0,1]', () => {
  const wild = goodPlay();
  wild.plans['o-qb'].throttle = 4;
  wild.pass.power = -2;
  const clean = sanitizePlay(wild);
  assert.equal(clean.plans['o-qb'].throttle, 1);
  assert.equal(clean.pass.power, 0);
});

test('sanitising rejects a stance mode the game does not have', () => {
  const bad = goodPlay();
  bad.stances['o-rb'].mode = 'invisible';
  assert.equal(sanitizePlay(bad), null);
});

test('sanitising accepts a cut-block stance', () => {
  const p = goodPlay();
  p.stances['o-lg'] = { mode: 'cutBlock', facing: { x: 0, y: 1 } };
  assert.deepEqual(sanitizePlay(p).stances['o-lg'], { mode: 'cutBlock', facing: { x: 0, y: 1 } });
});

test('a cut block round-trips through capture and apply', () => {
  const state = drawn();
  setMode(state, 'o-lg', 'cutBlock');
  const play = capturePlay(state, 'Trap');
  assert.deepEqual(play.stances['o-lg'], { mode: 'cutBlock', facing: getPlayer(state, 'o-lg').facing });
  const fresh = createGame({ ai: 'defense' });
  afterSnap(fresh);
  const { skipped } = applyPlay(fresh, play);
  assert.equal(getPlayer(fresh, 'o-lg').mode, 'cutBlock');
  assert.ok(!skipped.includes('o-lg'));
});

test('sanitising refuses a __proto__ key', () => {
  // Built by JSON.parse, which makes __proto__ a real own property — an
  // assignment would have set the prototype instead and proved nothing.
  const bad = JSON.parse(
    '{"name":"x","plans":{"__proto__":{"dir":{"x":0,"y":1},"throttle":1}},"stances":{},"pass":null}',
  );
  assert.equal(sanitizePlay(bad), null);
});

test('a play with no throw sanitises to no throw', () => {
  const p = goodPlay();
  p.pass = null;
  assert.equal(sanitizePlay(p).pass, null);
});

test('a stored name too long for a slot button is cut', () => {
  const p = goodPlay();
  p.name = 'y'.repeat(PLAY_NAME_MAX + 5);
  assert.equal(sanitizePlay(p).name.length, PLAY_NAME_MAX);
});

test('capturing takes where every one of the coach\'s men is standing', () => {
  const state = drawn();
  getPlayer(state, 'o-wr1').pos = fieldPos(-22, state.losYard - 1);
  const play = capturePlay(state, 'Trips');
  assert.equal(Object.keys(play.spots).length, 7);          // his team only
  assert.deepEqual(play.spots['o-wr1'], { across: -22, down: -1 });
  assert.equal('d-cb1' in play.spots, false);
});

test('a spot is saved off the line of scrimmage, not off the yard line', () => {
  const state = drawn();
  state.losYard = 6;
  getPlayer(state, 'o-wr1').pos = fieldPos(-22, 6 - 1);
  assert.deepEqual(capturePlay(state, 'Trips').spots['o-wr1'], { across: -22, down: -1 });
});

test('a play that only moves a man is not empty', () => {
  const state = afterSnap(createGame({ ai: 'defense' }));
  assert.equal(isEmptyPlay(capturePlay(state, '')), true);
  getPlayer(state, 'o-wr1').pos = fieldPos(-22, -1);
  assert.equal(isEmptyPlay(capturePlay(state, '')), false);
});

test('calling a play lines the formation back up on this down\'s line', () => {
  const from = drawn();
  getPlayer(from, 'o-wr1').pos = fieldPos(-22, from.losYard - 1);
  const play = capturePlay(from, 'Trips');

  const to = afterSnap(createGame({ ai: 'defense' }));
  to.losYard = 6;
  to.players = formationPlayers(6);
  applyPlay(to, play);
  assert.deepEqual(getPlayer(to, 'o-wr1').pos, fieldPos(-22, 5));
});

test('calling a play puts back a man the previous call had moved', () => {
  const state = afterSnap(createGame({ ai: 'defense' }));
  const home = { ...getPlayer(state, 'o-wr1').pos };
  const plain = capturePlay(state, 'Base');
  getPlayer(state, 'o-wr1').pos = fieldPos(-22, -1);
  applyPlay(state, plain);
  assert.deepEqual(getPlayer(state, 'o-wr1').pos, home);
});

test('the arrows are given after the men are seated, not before', () => {
  const from = drawn();
  getPlayer(from, 'o-wr1').pos = fieldPos(-22, -1);
  setPlan(from, 'o-wr1', { x: 0, y: 1 }, 1);
  const state = afterSnap(createGame({ ai: 'defense' }));
  applyPlay(state, capturePlay(from, 'Trips'));
  // Seating a man clears his plan; if that ran second the arrow would be gone.
  assert.deepEqual(getPlayer(state, 'o-wr1').plan.dir, { x: 0, y: 1 });
  assert.deepEqual(getPlayer(state, 'o-wr1').pos, fieldPos(-22, -1));
});

test('a spot this down has no room for is skipped, and the play still loads', () => {
  const from = drawn();
  const play = capturePlay(from, 'Deep');
  play.spots['o-wr1'] = { across: 0, down: 4 };  // past the line
  const state = afterSnap(createGame({ ai: 'defense' }));
  const home = { ...getPlayer(state, 'o-wr1').pos };
  const { skipped } = applyPlay(state, play);
  assert.equal(skipped.includes('o-wr1'), true);
  assert.deepEqual(getPlayer(state, 'o-wr1').pos, home);
});

test('a play saved in hot-seat does not move the computer\'s defense', () => {
  const hotseat = afterSnap(createGame({ seed: 1 }));   // aiTeam null: both teams are his
  getPlayer(hotseat, 'd-cb1').pos = fieldPos(-22, 2);
  const play = capturePlay(hotseat, 'Both');
  assert.equal('d-cb1' in play.spots, true);

  const state = afterSnap(createGame({ ai: 'defense' }));
  const home = { ...getPlayer(state, 'd-cb1').pos };
  const { skipped } = applyPlay(state, play);
  assert.deepEqual(getPlayer(state, 'd-cb1').pos, home);
  assert.equal(skipped.includes('d-cb1'), true);
});

test('a version-1 play — no spots at all — loads its arrows and moves nobody', () => {
  const state = drawn();
  getPlayer(state, 'o-wr1').pos = fieldPos(-22, -1);
  const where = { ...getPlayer(state, 'o-wr1').pos };
  applyPlay(state, sanitizePlay({ ...goodPlay() }));   // goodPlay has no `spots`
  assert.deepEqual(getPlayer(state, 'o-wr1').pos, where);
});

test('sanitising rejects a play with a NaN in a spot', () => {
  assert.equal(sanitizePlay({ ...goodPlay(), spots: { 'o-wr1': { across: NaN, down: -1 } } }), null);
  assert.equal(sanitizePlay({ ...goodPlay(), spots: { 'o-wr1': { down: -1 } } }), null);
  assert.equal(sanitizePlay({ ...goodPlay(), spots: 7 }), null);
});

test('sanitising refuses a __proto__ spot', () => {
  const raw = { ...goodPlay(), spots: {} };
  Object.defineProperty(raw.spots, '__proto__', { value: { across: 0, down: 0 }, enumerable: true });
  assert.equal(sanitizePlay(raw), null);
});
