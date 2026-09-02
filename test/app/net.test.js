import test from 'node:test';
import assert from 'node:assert/strict';
import { createNet } from '../../app/net.js';

/** A socket that only does what createNet is allowed to use of one. */
function fakeSocket() {
  const listeners = [];
  return {
    sent: [],
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    send: function (data) { this.sent.push(JSON.parse(data)); },
    deliver(msg) { for (const fn of listeners) fn({ data: JSON.stringify(msg) }); },
  };
}

test('a message routes to the handler for its type', () => {
  const ws = fakeSocket();
  const net = createNet(ws, 'offense');
  const seen = [];
  net.onStart((m) => seen.push(m));
  ws.deliver({ type: 'start', seed: 7 });
  assert.deepEqual(seen, [{ type: 'start', seed: 7 }]);
});

test('a message that arrives before its handler exists is not lost', () => {
  // The whole reason this module exists. app/multiplayer.js opens the match
  // socket and only then awaits import('./main.js') before startGame can
  // register onStart -- and the server broadcasts `start` the instant the
  // second coach connects, which is inside that gap. A dropped `start` is a
  // board that never gets built: a white page.
  const ws = fakeSocket();
  const net = createNet(ws, 'defense');
  ws.deliver({ type: 'start', seed: 7 });
  const seen = [];
  net.onStart((m) => seen.push(m));
  assert.deepEqual(seen, [{ type: 'start', seed: 7 }], 'the held message replays');
});

test('held messages replay in the order they arrived, once', () => {
  const ws = fakeSocket();
  const net = createNet(ws, 'offense');
  ws.deliver({ type: 'turn', n: 1 });
  ws.deliver({ type: 'turn', n: 2 });
  const seen = [];
  net.onTurn((m) => seen.push(m.n));
  assert.deepEqual(seen, [1, 2]);
  net.onTurn((m) => seen.push(m.n));
  assert.deepEqual(seen, [1, 2], 'a second registration does not replay them again');
});

test('commit sends the play and the turn it answers', () => {
  const ws = fakeSocket();
  createNet(ws, 'offense').commit({ plans: {} }, 3);
  assert.deepEqual(ws.sent, [{ type: 'commit', turnIndex: 3, play: { plans: {} } }]);
});
