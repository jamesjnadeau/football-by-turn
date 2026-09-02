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
  socket.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (handlers[msg.type]) handlers[msg.type](msg);
    else held.push(msg);
  });
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
    commit: (play, turnIndex) => socket.send(JSON.stringify({ type: 'commit', turnIndex, play })),
    onStart: on('start'),
    onTurn: on('turn'),
    onTimeUp: on('timeUp'),
    onOpponentGone: on('opponentGone'),
    onOpponentBack: on('opponentBack'),
    onMatchOver: on('matchOver'),
  };
}
