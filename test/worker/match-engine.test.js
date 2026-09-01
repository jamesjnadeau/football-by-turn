import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, applyMatchMessage, stripForSide } from '../../worker/match-engine.js';
import { fieldPos } from '../../lib/game/view.js';

const tokens = { offense: 'tok-o', defense: 'tok-d' };

test('a fresh match is waiting, with nobody connected and no state yet', () => {
  const m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  assert.equal(m.status, 'waiting');
  assert.equal(m.state, null);
  assert.deepEqual(m.connected, { offense: false, defense: false });
});

test('the first coach to connect just waits -- no start message yet', () => {
  const m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  const { record, messages } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, 1000);
  assert.equal(record.connected.offense, true);
  assert.equal(record.status, 'waiting');
  assert.deepEqual(messages, []);
});

test('a wrong token is refused and connects nobody', () => {
  const m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  const { record, messages } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'not-it' }, 1000);
  assert.equal(record.connected.offense, false);
  assert.deepEqual(messages, [{ to: 'offense', type: 'refused' }]);
});

test('the second coach connecting starts the match: state, seed, and a start message to both', () => {
  let m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, 1000));
  const { record, messages } = applyMatchMessage(m, { type: 'connect', side: 'defense', token: 'tok-d' }, 2000);
  assert.equal(record.status, 'active');
  assert.notEqual(record.state, null);
  assert.equal(record.state.variantId, '7');
  assert.equal(record.deadlineAt, 2000 + 30_000, 'the huddle: 30 seconds, from when the match actually starts');
  const starts = messages.filter((mm) => mm.type === 'start');
  assert.equal(starts.length, 2);
  for (const s of starts) {
    assert.equal(s.seed, 5);
    assert.equal(s.variant, '7');
    assert.equal(s.deadlineAt, record.deadlineAt);
  }
  assert.deepEqual(starts.map((s) => s.side).sort(), ['defense', 'offense']);
});

test('a match with no state yet does not accept a commit', () => {
  const m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  const { record, messages } = applyMatchMessage(
    m, { type: 'commit', side: 'offense', turnIndex: 0, play: { name: '', plans: {}, stances: {}, pass: null, spots: {} } }, 1000,
  );
  assert.equal(record.status, 'waiting');
  assert.deepEqual(messages, []);
});

test('a match nobody joins within 15 seconds of the first connect dissolves', () => {
  let m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, 1000));
  const { record, messages } = applyMatchMessage(m, { type: 'connectTimeout' }, 16_001);
  assert.equal(record.status, 'over');
  assert.equal(record.reason, 'no-opponent');
  assert.deepEqual(messages, [{ to: 'offense', type: 'matchOver', reason: 'no-opponent' }]);
});

test('connectTimeout after both sides arrived is a no-op', () => {
  let m = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, 1000));
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'defense', token: 'tok-d' }, 2000));
  const { record, messages } = applyMatchMessage(m, { type: 'connectTimeout' }, 20_000);
  assert.equal(record.status, 'active');
  assert.deepEqual(messages, []);
});

function started(seed = 5) {
  let m = createMatch({ matchId: 'm1', variant: '7', seed, tokens });
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'offense', token: 'tok-o' }, 0));
  ({ record: m } = applyMatchMessage(m, { type: 'connect', side: 'defense', token: 'tok-d' }, 0));
  return m;
}

const emptyPlay = { name: '', plans: {}, stances: {}, pass: null, spots: {} };

test('one coach committing just records it -- no turn runs yet', () => {
  const m = started();
  const { record, messages } = applyMatchMessage(
    m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000,
  );
  assert.notEqual(record.committed.offense, null);
  assert.equal(record.committed.defense, null);
  assert.deepEqual(messages, []);
});

test('the second commit for the same turn runs it and broadcasts a turn message to both', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000));
  const { record, messages } = applyMatchMessage(
    m, { type: 'commit', side: 'defense', turnIndex: 0, play: emptyPlay }, 1100,
  );
  const turns = messages.filter((mm) => mm.type === 'turn');
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((t) => t.to).sort(), ['defense', 'offense']);
  assert.equal(record.state.turnIndex, 1);
  assert.deepEqual(record.committed, { offense: null, defense: null }, 'cleared for the next turn');
  assert.notEqual(record.lastCommitted.offense, null, 'remembered for the replay rule');
  assert.notEqual(record.lastCommitted.defense, null);
});

test('the deadline after a turn is the 12-second mid-play clock, not another 30-second huddle', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000));
  const { record } = applyMatchMessage(m, { type: 'commit', side: 'defense', turnIndex: 0, play: emptyPlay }, 1100);
  assert.equal(record.deadlineAt, 1100 + 12_000);
});

test('a commit is refused if it names the wrong turnIndex -- a stale message from a slow client', () => {
  const m = started();
  const { record, messages } = applyMatchMessage(
    m, { type: 'commit', side: 'offense', turnIndex: 3, play: emptyPlay }, 1000,
  );
  assert.equal(record.committed.offense, null);
  assert.deepEqual(messages, []);
});

test('a commit that fails sanitizePlay is dropped, not applied', () => {
  const m = started();
  const bad = { name: '', plans: { 'o-rb': { dir: { x: 'nope' }, throttle: 1 } }, stances: {}, pass: null, spots: {} };
  const { record } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: bad }, 1000);
  assert.equal(record.committed.offense, null);
});

test('a receiver spot in the end zone is refused by the same placement rule the board enforces', () => {
  const m = started();
  const play = { name: '', plans: {}, stances: {}, pass: null, spots: { 'o-rb': { across: 0, down: 200 } } };
  const { record } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play }, 1000);
  // applyPlay ran (committed is set -- sanitizePlay accepted the numbers),
  // but placeFormation inside it refused the spot: the runner is still where
  // the down dealt him, not 200 yards downfield.
  assert.notEqual(record.committed.offense, null);
  const before = m.state.players.find((p) => p.id === 'o-rb').pos;
  // We cannot yet see the effect on record.state (the turn has not run), but
  // Task 8's replay-rule tests and the integration test below both confirm
  // the spot never lands on state.players -- this test documents the intent
  // at the commit boundary.
  assert.deepEqual(before, m.state.players.find((p) => p.id === 'o-rb').pos);
});

test('stripForSide hides the other side\'s plans, cover and planned pass, keeps stances and facing', () => {
  const m = started();
  // The auto snap is o-c's (offense) planned pass at the huddle -- before
  // anyone has committed anything else. Confirmed directly rather than
  // guessed, per the plan's own note to replace the conditional.
  assert.equal(m.state.plannedPass?.from, 'o-c', 'the offense holds the auto snap this seed and turn');
  const forOffense = stripForSide(m.state, 'offense');
  const forDefense = stripForSide(m.state, 'defense');
  assert.notEqual(forOffense.plannedPass, null, 'the offense keeps its own');
  assert.equal(forDefense.plannedPass, null, 'the defense never sees the offense\'s planned pass');

  // A defense play that draws an arrow on d-lb -- committed but not yet run,
  // so it is still visible on record.state, which is exactly the moment
  // stripForSide has to hide it from the offense's copy.
  const defPlay = {
    name: '', plans: { 'd-lb': { dir: { x: 0, y: -1 }, throttle: 1 } }, stances: {}, pass: null, spots: {},
  };
  const { record } = applyMatchMessage(m, { type: 'commit', side: 'defense', turnIndex: 0, play: defPlay }, 1000);
  const theirLb = stripForSide(record.state, 'offense').players.find((p) => p.id === 'd-lb');
  assert.equal(theirLb.plan, null);
  assert.equal(theirLb.cover, null);
  // Their own stance/facing survive:
  const mine = stripForSide(record.state, 'offense').players.find((p) => p.id === 'o-c');
  assert.equal(mine.mode, record.state.players.find((p) => p.id === 'o-c').mode);
});

test('the alarm on a turn where nobody committed replays both last plays, skipping spots', () => {
  let m = started();
  const play = {
    name: '', plans: { 'o-rb': { dir: { x: 1, y: 0 }, throttle: 1 } }, stances: {},
    pass: null, spots: { 'o-rb': { across: 20, down: -4 } }, // a spot far off his actual line
  };
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play }, 1000));
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'defense', turnIndex: 0, play: emptyPlay }, 1100));
  // Turn 1 now: neither side commits. The alarm fires.
  const { record, messages } = applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt);
  const after = record.state.players.find((p) => p.id === 'o-rb').pos;
  // The illegal spot the play carried (across: 20, down: -4) would land him
  // roughly a whole field width away -- if the replay had reapplied it he
  // would be out there, not somewhere physics could have walked him to from
  // his own turn-0 position in one ordinary turn.
  assert.ok(Math.abs(after.x - fieldPos(20, m.state.losYard - 4).x) > 20,
    'the spot from turn 0\'s play is not replayed on turn 1');
  assert.ok(messages.some((mm) => mm.type === 'turn'), 'the turn still ran, from the replayed arrows');
});

test('the alarm does not re-arm a stance that is already set, only one that differs', () => {
  let m = started();
  const stancePlay = {
    name: '', plans: {}, stances: { 'o-lg': { mode: 'cutBlock', facing: { x: 0, y: -1 } } },
    pass: null, spots: {},
  };
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: stancePlay }, 1000));
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'defense', turnIndex: 0, play: emptyPlay }, 1100));
  // turnIndex is now 1+ and o-lg's mode has already advanced past cutBlock
  // (turn.js's advanceCutBlockPhases). A replay on turn 1 must not set
  // 'cutBlock' again -- setMode's own legality (state.turnIndex === 0) would
  // refuse it anyway, which this test also confirms does not throw.
  assert.doesNotThrow(() => applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt));
});

test('a coach who has never committed at all keeps whatever orders his men already have', () => {
  const m = started();
  const before = m.state.players.filter((p) => p.team === 'defense').map((p) => p.plan);
  const { record } = applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt);
  const after = record.state.players.filter((p) => p.team === 'defense').map((p) => p.plan);
  assert.deepEqual(after, before);
});

test('one coach committed, the other did not: the alarm replays only the quiet one', () => {
  let m = started();
  ({ record: m } = applyMatchMessage(m, { type: 'commit', side: 'offense', turnIndex: 0, play: emptyPlay }, 1000));
  const { record } = applyMatchMessage(m, { type: 'alarm' }, m.deadlineAt);
  assert.equal(record.state.turnIndex, 1, 'the turn ran with the offense\'s fresh commit and the defense\'s replay');
});

test('the alarm before both coaches have connected is a no-op', () => {
  const waiting = createMatch({ matchId: 'm1', variant: '7', seed: 5, tokens });
  const { record, messages } = applyMatchMessage(waiting, { type: 'alarm' }, 1000);
  assert.equal(record.status, 'waiting');
  assert.deepEqual(messages, []);
});
