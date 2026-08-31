import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COACH_LOG_MAX, emptyCoachLog, captureSnapshot, applySnapshot, appendSnapshot,
  serializeCoachLog, parseCoachLog, sanitizeSnapshot,
} from '../../lib/game/coach-log.js';
import {
  createGame, getPlayer, setPlan, setMode, setPass, formationPlayers, aimSnap,
  SNAPPER_ID,
} from '../../lib/game/state.js';
import { setCover } from '../../lib/game/cover.js';
import { placePlayer } from '../../lib/game/formation.js';
import { fieldPos, yardsOfY } from '../../lib/game/view.js';

/** The same down, spotted somewhere else — how the harness re-spots a game. */
function respot(state, losYard) {
  state.losYard = losYard;
  state.toGoYard = losYard + 10;
  state.players = formationPlayers(losYard, state.variantId);
  state.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  state.plannedPass = null;
  aimSnap(state);
  return state;
}

test('a snapshot carries the situation and only the coached team', () => {
  const s = createGame({ seed: 1 });
  s.down = 3;
  s.toGoYard = s.losYard + 7;
  const snap = captureSnapshot(s, 'offense');
  assert.deepEqual(snap.situation, {
    down: 3, toGo: 7, losYard: s.losYard, turnIndex: 0, variant: '7', side: 'offense',
  });
  for (const id of Object.keys(snap.spots)) assert.ok(id.startsWith('o-'), id);
  assert.equal(Object.keys(snap.spots).length, 7);
});

test("arrows, cover orders, stances and the coach's own throw are all recorded", () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  setMode(s, 'o-lg', 'holding');
  setPass(s, SNAPPER_ID, { x: 0, y: -1 }, 0.5, 'o-wr1');
  const off = captureSnapshot(s, 'offense');
  assert.deepEqual(off.plans['o-rb'], { dir: { x: 0, y: 1 }, throttle: 1 });
  assert.equal(off.stances['o-lg'].mode, 'holding');
  assert.ok(off.stances['o-lg'].facing);
  assert.deepEqual(off.pass, {
    from: SNAPPER_ID, dir: { x: 0, y: -1 }, power: 0.5, target: 'o-wr1',
  });

  setCover(s, 'd-cb1', 'o-wr1');
  const def = captureSnapshot(s, 'defense');
  assert.equal(def.covers['d-cb1'], 'o-wr1');
  // setCover writes a plan too; the snapshot records the ORDER, not its
  // opening aim, or re-applying it would put an arrow on instead of a man.
  assert.equal(def.plans['d-cb1'], undefined);
  assert.equal(def.pass, null); // the throw belongs to the other team
});

test("the automatic snap is not the coach's throw and is never recorded", () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.plannedPass.auto, true);
  assert.equal(captureSnapshot(s, 'offense').pass, null);
});

test('a snapshot replays onto the same down spotted somewhere else', () => {
  const a = createGame({ seed: 1 });
  placePlayer(a, 'o-wr1', fieldPos(-10, a.losYard - 1));
  setPlan(a, 'o-rb', { x: 0, y: 1 }, 1);
  setMode(a, 'o-lg', 'holding');
  const snap = captureSnapshot(a, 'offense');

  const b = respot(createGame({ seed: 2 }), 55);
  const { applied, skipped } = applySnapshot(b, 'offense', snap);
  assert.deepEqual(skipped, []);
  assert.ok(applied.includes('o-rb'));
  // Spots are yards off the line of scrimmage, so the picture is the picture.
  assert.deepEqual(getPlayer(b, 'o-wr1').pos, fieldPos(-10, 55 - 1));
  assert.deepEqual(getPlayer(b, 'o-rb').plan.dir, { x: 0, y: 1 });
  assert.equal(getPlayer(b, 'o-lg').mode, 'holding');
  // The snap goes back on by itself, exactly as applyPlay leaves it.
  assert.equal(b.plannedPass.auto, true);
});

test('a cover order replays as a cover order', () => {
  const a = createGame({ seed: 1 });
  setCover(a, 'd-cb1', 'o-wr1');
  const snap = captureSnapshot(a, 'defense');
  const b = createGame({ seed: 2 });
  applySnapshot(b, 'defense', snap);
  assert.equal(getPlayer(b, 'd-cb1').cover, 'o-wr1');
  assert.ok(getPlayer(b, 'd-cb1').plan, 'a covering man counts as planned');
});

test('replaying one side leaves the other side untouched', () => {
  const a = createGame({ seed: 1 });
  setPlan(a, 'o-rb', { x: 1, y: 0 }, 1);
  const snap = captureSnapshot(a, 'offense');
  const b = createGame({ seed: 2 });
  setPlan(b, 'd-lb', { x: 0, y: -1 }, 1);
  const before = { ...getPlayer(b, 'd-lb').pos };
  applySnapshot(b, 'offense', snap);
  assert.deepEqual(getPlayer(b, 'd-lb').plan.dir, { x: 0, y: -1 });
  assert.deepEqual(getPlayer(b, 'd-lb').pos, before);
});

test('mid-play the orders replay but nobody is re-seated', () => {
  const a = createGame({ seed: 1 });
  placePlayer(a, 'o-wr1', fieldPos(-10, a.losYard - 1));
  setPlan(a, 'o-rb', { x: 0, y: 1 }, 1);
  const snap = captureSnapshot(a, 'offense');

  const b = createGame({ seed: 2 });
  b.turnIndex = 2; // the play is running: a formation is not a thing any more
  const spot = { ...getPlayer(b, 'o-wr1').pos };
  applySnapshot(b, 'offense', snap);
  assert.deepEqual(getPlayer(b, 'o-wr1').pos, spot);
  assert.deepEqual(getPlayer(b, 'o-rb').plan.dir, { x: 0, y: 1 });
});

test('appendSnapshot keeps the newest COACH_LOG_MAX snapshots', () => {
  const s = createGame({ seed: 1 });
  let log = emptyCoachLog();
  for (let i = 0; i < COACH_LOG_MAX + 5; i++) {
    s.down = (i % 4) + 1;
    log = appendSnapshot(log, captureSnapshot(s, 'offense'));
  }
  assert.equal(log.length, COACH_LOG_MAX);
  assert.equal(log[log.length - 1].situation.down, ((COACH_LOG_MAX + 4) % 4) + 1);
});

test('a log survives the round trip through storage', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0.6, y: 0.8 }, 0.75);
  setCover(s, 'd-cb1', 'o-wr1');
  const log = [captureSnapshot(s, 'offense'), captureSnapshot(s, 'defense')];
  assert.deepEqual(parseCoachLog(serializeCoachLog(log)), log);
});

test('junk reads as an empty log, and one bad snapshot does not poison the rest', () => {
  assert.deepEqual(parseCoachLog(undefined), []);
  assert.deepEqual(parseCoachLog(''), []);
  assert.deepEqual(parseCoachLog('{not json'), []);
  assert.deepEqual(parseCoachLog(JSON.stringify({ v: 99, snapshots: [] })), []);

  const s = createGame({ seed: 1 });
  const good = captureSnapshot(s, 'offense');
  const text = JSON.stringify({ v: 1, snapshots: [good, { situation: null }, good] });
  assert.deepEqual(parseCoachLog(text), [good, good]);
});

test('sanitizeSnapshot refuses anything that would put a NaN on the field', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const good = captureSnapshot(s, 'offense');
  assert.deepEqual(sanitizeSnapshot(JSON.parse(JSON.stringify(good))), good);
  assert.equal(sanitizeSnapshot(null), null);
  assert.equal(sanitizeSnapshot({ ...good, situation: { ...good.situation, down: 'x' } }), null);
  assert.equal(sanitizeSnapshot({ ...good, situation: { ...good.situation, side: 'both' } }), null);
  assert.equal(sanitizeSnapshot({ ...good, plans: { 'o-rb': { dir: { x: NaN, y: 1 }, throttle: 1 } } }), null);
  assert.equal(sanitizeSnapshot({ ...good, covers: { 'd-cb1': 7 } }), null);
  assert.equal(sanitizeSnapshot({ ...good, stances: { 'o-lg': { mode: 'flying', facing: { x: 0, y: 1 } } } }), null);
  // A "__proto__" key can only ever ARRIVE through JSON.parse — writing one in
  // an object literal sets the prototype instead of adding the key — and
  // JSON.parse is exactly how storage hands one over.
  const sneaky = JSON.parse('{"__proto__":{"across":0,"down":0}}');
  assert.equal(sanitizeSnapshot({ ...good, spots: sneaky }), null);
});
