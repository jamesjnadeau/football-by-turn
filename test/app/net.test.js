import test from 'node:test';
import assert from 'node:assert/strict';
import { createNet, bindWhileOpen } from '../../app/net.js';

/** A socket that only does what createNet is allowed to use of one. */
function fakeSocket() {
  const listeners = [];
  return {
    sent: [],
    closers: [],
    addEventListener: function (type, fn) {
      if (type === 'message') listeners.push(fn);
      if (type === 'close') this.closers.push(fn);
    },
    deliverClose() { for (const fn of this.closers) fn(); },
    send: function (data) { this.sent.push(JSON.parse(data)); },
    deliver(msg) { for (const fn of listeners) fn({ data: JSON.stringify(msg) }); },
  };
}

/** An element that only does what bindWhileOpen is allowed to use of one. */
function fakeTarget() {
  const bound = new Map();
  return {
    addEventListener: (type, fn) => bound.set(type + fn.toString(), fn),
    removeEventListener: (type, fn) => bound.delete(type + fn.toString()),
    fire: (type) => { for (const [k, fn] of bound) if (k.startsWith(type)) fn({ type }); },
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

test('a refused commit reaches its handler like any other message', () => {
  const ws = fakeSocket();
  const net = createNet(ws, 'offense');
  const seen = [];
  net.onCommitRefused((m) => seen.push(m.reason));
  ws.deliver({ type: 'commitRefused', reason: 'stale', turnIndex: 2 });
  assert.deepEqual(seen, ['stale']);
});

test('a screen\'s clicks stop being listened to when its socket closes', () => {
  // The lobby draws its buttons into the same element every screen uses, and
  // its handler sends on ITS socket. A handler that outlived that socket kept
  // answering clicks meant for whatever was drawn next, and sent on a socket
  // that was already closed.
  const ws = fakeSocket();
  const target = fakeTarget();
  const seen = [];
  bindWhileOpen(target, 'click', () => seen.push('press'), ws);
  target.fire('click');
  assert.deepEqual(seen, ['press']);
  ws.deliverClose();
  target.fire('click');
  assert.deepEqual(seen, ['press'], 'the closed socket took its listener with it');
});

test('a bound listener can be let go before the socket closes', () => {
  const ws = fakeSocket();
  const target = fakeTarget();
  const seen = [];
  const release = bindWhileOpen(target, 'click', () => seen.push('press'), ws);
  release();
  target.fire('click');
  assert.deepEqual(seen, []);
  ws.deliverClose(); // and releasing twice is not an error
});
