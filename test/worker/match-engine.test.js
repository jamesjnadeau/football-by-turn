import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, applyMatchMessage } from '../../worker/match-engine.js';

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
