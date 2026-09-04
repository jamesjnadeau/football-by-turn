import test from 'node:test';
import assert from 'node:assert/strict';
import { createLobby, applyLobbyMessage } from '../../worker/lobby-engine.js';

function depths(messages) {
  return messages.filter((m) => m.type === 'queued');
}

test('joining an empty lobby only reports depths -- nobody to pair with yet', () => {
  const record = createLobby();
  const { record: r2, messages } = applyLobbyMessage(record, { type: 'join', id: 'a', side: 'offense' });
  assert.deepEqual(r2.offense, ['a']);
  assert.deepEqual(r2.defense, []);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { to: 'broadcast', type: 'queued', offense: 1, defense: 0 });
});

test('the second side joining pairs the two oldest waiters and empties both queues', () => {
  let record = createLobby();
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a', side: 'offense' }));
  const { record: r2, messages } = applyLobbyMessage(record, { type: 'join', id: 'b', side: 'defense' });
  assert.deepEqual(r2.offense, []);
  assert.deepEqual(r2.defense, []);
  const matched = messages.filter((m) => m.type === 'matched');
  assert.equal(matched.length, 2);
  const forA = matched.find((m) => m.to === 'a');
  const forB = matched.find((m) => m.to === 'b');
  assert.equal(forA.side, 'offense');
  assert.equal(forB.side, 'defense');
  assert.equal(forA.matchId, forB.matchId, 'both coaches are told the same match');
});

test('the longest waiter is popped first, on each side independently', () => {
  let record = createLobby();
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a1', side: 'offense' }));
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a2', side: 'offense' }));
  const { record: r2, messages } = applyLobbyMessage(record, { type: 'join', id: 'd1', side: 'defense' });
  const matched = messages.filter((m) => m.type === 'matched');
  assert.deepEqual(matched.map((m) => m.to).sort(), ['a1', 'd1']);
  assert.deepEqual(r2.offense, ['a2'], 'the later offense waiter is still queued');
});

test('switch moves a waiter to the other queue without losing depth-broadcast accuracy', () => {
  let record = createLobby();
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a', side: 'offense' }));
  const { record: r2, messages } = applyLobbyMessage(record, { type: 'switch', id: 'a' });
  assert.deepEqual(r2.offense, []);
  assert.deepEqual(r2.defense, ['a']);
  assert.deepEqual(messages[0], { to: 'broadcast', type: 'queued', offense: 0, defense: 1 });
});

test('switch immediately pairs if the other queue already has a waiter', () => {
  let record = createLobby();
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a', side: 'offense' }));
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'b', side: 'offense' }));
  // Both offense, nobody on defense yet -- no pairing happens on either join.
  const { messages } = applyLobbyMessage(record, { type: 'switch', id: 'b' });
  assert.ok(messages.some((m) => m.type === 'matched'), 'switching into a non-empty queue pairs immediately');
});

test('leave drops a waiter from whichever queue holds him, silently if he is in neither', () => {
  let record = createLobby();
  ({ record } = applyLobbyMessage(record, { type: 'join', id: 'a', side: 'offense' }));
  const { record: r2 } = applyLobbyMessage(record, { type: 'leave', id: 'a' });
  assert.deepEqual(r2.offense, []);
  const { record: r3 } = applyLobbyMessage(r2, { type: 'leave', id: 'ghost' });
  assert.deepEqual(r3, r2);
});
