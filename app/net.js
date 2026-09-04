/**
 * The match socket, as the handle app/main.js talks to. No DOM: the socket is
 * a parameter, so a test can hand it one made of nothing.
 *
 * The one thing this does beyond routing by message type is HOLD messages
 * that arrive before anybody has said they want them. That is not a nicety.
 * app/multiplayer.js opens the socket and then awaits import('./main.js')
 * before startGame can register a single handler, and MatchDO broadcasts
 * `start` the instant the second coach connects -- which is inside that gap.
 * A WebSocket has no memory, so a dropped `start` is a board that is never
 * built: a blank field and nothing to press.
 *
 * Held messages replay when their handler arrives, in arrival order, once.
 * Registering a handler later is then the same as having registered it
 * first, which is what stops the ordering of an import deciding whether a
 * match works.
 */
export function createNet(socket, side) {
  const handlers = {};
  const held = [];
  let current = null;
  const deliver = (msg) => {
    if (handlers[msg.type]) handlers[msg.type](msg);
    else held.push(msg);
  };
  /**
   * Point the handle at a socket. Called again on every reconnect: the
   * handlers app/main.js registered stay exactly where they are, and only the
   * wire underneath them changes. Messages from a socket that has since been
   * replaced are dropped -- it is closing, and anything it still had to say
   * the new socket's snapshot says better.
   */
  const attach = (ws) => {
    current = ws;
    ws.addEventListener('message', (ev) => {
      if (current !== ws) return;
      deliver(JSON.parse(ev.data));
    });
  };
  if (socket) attach(socket);
  const on = (type) => (handler) => {
    handlers[type] = handler;
    // Taken off the pile before any of them is delivered, so a handler that
    // sends something (and lands another message straight back) cannot see
    // its own arrivals replayed as history.
    const waiting = held.filter((m) => m.type === type);
    for (let i = held.length - 1; i >= 0; i--) if (held[i].type === type) held.splice(i, 1);
    for (const msg of waiting) handler(msg);
  };
  return {
    side,
    attach,
    /** Something this side of the wire has to say -- a dropped connection,
     *  a restored one -- routed like a message so main.js hears it the same way. */
    deliver,
    commit: (play, turnIndex) => {
      // A commit with no wire under it is dropped rather than thrown: the
      // reconnect's snapshot hands the coach the turn back, and he presses
      // End Turn again on a board he can see.
      if (!current || current.readyState !== 1) return false;
      current.send(JSON.stringify({ type: 'commit', turnIndex, play }));
      return true;
    },
    onStart: on('start'),
    onTurn: on('turn'),
    onTimeUp: on('timeUp'),
    onCommitRefused: on('commitRefused'),
    onOpponentGone: on('opponentGone'),
    onOpponentBack: on('opponentBack'),
    onMatchOver: on('matchOver'),
    onConnectionLost: on('connectionLost'),
    onConnectionRestored: on('connectionRestored'),
  };
}

/**
 * Listen to `target` only for as long as `socket` is open, and hand back a
 * way to stop sooner.
 *
 * The lobby's screens are all drawn into the same element, and their handlers
 * send on the socket that opened them. A handler that outlives its socket is
 * therefore two bugs at once: it answers clicks meant for whatever screen was
 * drawn next, and it sends on a socket that is already closed. Tying the
 * listener's life to the socket's makes both impossible to forget, because
 * every way out of a lobby screen -- matched, Back, a dropped connection --
 * closes the socket.
 */
export function bindWhileOpen(target, type, handler, socket) {
  target.addEventListener(type, handler);
  let bound = true;
  const release = () => {
    if (!bound) return;
    bound = false;
    target.removeEventListener(type, handler);
  };
  socket.addEventListener('close', release);
  return release;
}
