/**
 * Owns both sockets a multiplayer visit ever opens: the lobby socket, which
 * lives only until this coach is matched, and the match socket, which lives
 * for the whole drive. Hands off to app/main.js's startGame once a match
 * starts, the same way app/home.js hands off to it for every other side.
 *
 * DOM-touching plumbing, like app/home.js itself -- everything that is
 * actually a DECISION (what the lobby screen says) lives in a tested lib/
 * module; this file only wires sockets to the DOM and to main.js's net seam.
 */
import { lobbyMarkup, matchOverMarkup, matchOverResult, lobbyUnavailableMarkup, rejoinMarkup } from '../lib/game/lobby.js';
import { sideMarkup, MULTIPLAYER_SIDES } from '../lib/game/home.js';
import { gameOverMessage } from '../lib/game/hud.js';
import { getVariant } from '../lib/game/variants.js';
import { createNet, bindWhileOpen } from './net.js';

const home = document.getElementById('home');
const board = document.getElementById('board');
// The control bar is DOM beside the board (app/controls.js), so it is shown
// and hidden with it: a lobby or end screen has no turn to run.
const controls = document.getElementById('controls');

function show(el, visible) {
  el.toggleAttribute('hidden', !visible);
}

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

let game = null;

function openLobbySocket(variant, side, onMatched, onExit) {
  const ws = new WebSocket(wsUrl(`/lobby?variant=${variant.id}&side=${side}`));
  // Whether this socket ended the way a lobby socket is meant to: matched, or
  // by this coach's own Back. Any other close -- a page with no Worker behind
  // it (the handshake gets a 404), or the server going away -- is said out
  // loud, because the alternative is a side chooser whose buttons do nothing.
  let settled = false;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'queued') {
      home.innerHTML = lobbyMarkup({
        variant, side, offenseDepth: msg.offense, defenseDepth: msg.defense,
      });
    } else if (msg.type === 'matched') {
      settled = true;
      ws.close();
      onMatched({ matchId: msg.matchId, side: msg.side, token: msg.token, variant: variant.id });
    }
  });
  ws.addEventListener('close', () => {
    if (settled) return;
    home.innerHTML = lobbyUnavailableMarkup({ variant });
    home.addEventListener('click', function onBack(e) {
      if (!e.target.closest?.('[data-lobby-back]')) return;
      home.removeEventListener('click', onBack);
      showSidePicker(variant, onExit);
    });
  });
  // Bound to the socket's life, not to the one way out that remembered to
  // clean up after itself: being matched closes this socket too, and so does
  // the server going away. See bindWhileOpen.
  bindWhileOpen(home, 'click', (e) => {
    if (e.target.closest?.('[data-lobby-switch]')) {
      ws.send(JSON.stringify({ type: 'switch' }));
    } else if (e.target.closest?.('[data-lobby-back]')) {
      settled = true;
      ws.close();
      showSidePicker(variant, onExit);
    }
  }, ws);
  return ws;
}

const MATCH_KEY = 'fbt-match';

/**
 * The match this tab is in, kept so a reload can rejoin it. sessionStorage
 * on purpose: it is per tab, so a second tab is a stranger to the match
 * (it has no token), and it dies with the tab, so a match is never offered
 * back days later.
 */
function saveMatch(match) {
  try { sessionStorage.setItem(MATCH_KEY, JSON.stringify(match)); } catch { /* storage denied: no rejoin, nothing worse */ }
}
function clearMatch() {
  try { sessionStorage.removeItem(MATCH_KEY); } catch { /* nothing to clear */ }
}
function loadMatch() {
  try {
    const m = JSON.parse(sessionStorage.getItem(MATCH_KEY));
    return m && m.matchId && m.side && m.token && m.variant ? m : null;
  } catch { return null; }
}

/** How long the board keeps the final play before the end screen replaces it. */
const MATCH_OVER_LINGER_MS = 3000;
/** How long a dropped connection keeps trying before the match is given up.
 *  Matches the server's own DROP_GRACE_MS: past it the seat is gone anyway. */
const RECONNECT_WINDOW_MS = 20_000;
const RECONNECT_DELAY_MS = 1000;

/**
 * Enter a match: open its socket, hand main.js the net handle, and keep the
 * socket alive for the whole drive. `match` is `{matchId, side, token,
 * variant}` -- what the lobby's `matched` said, or what a reload found saved.
 *
 * The socket is not the match. It is reopened, with the same token, every
 * time it dies before the match is over: the server keeps the seat for
 * DROP_GRACE_MS and hands a returning coach the board as it stands, so a
 * dropped connection costs the coach a message, not the game. main.js never
 * sees the swap -- createNet's attach moves its handlers onto the new wire.
 */
async function enterMatch(variant, match, onExit, { resuming = false } = {}) {
  saveMatch(match);
  const net = createNet(null, match.side);
  let left = false;   // this coach chose to go: Home, Back, Play again
  let over = false;   // the server said the match ended, or refused the seat
  let dealt = false;  // the board has been handed over at least once
  let lostAt = null;  // when the current outage began, or null while connected
  let retryTimer = null;
  let ws = null;
  let lastState = null;

  if (resuming) {
    // No board yet: the rejoin screen holds the section until the first
    // snapshot, and Give up is the way out of a server that never answers.
    show(board, false);
    show(controls, false);
    show(home, true);
    home.innerHTML = rejoinMarkup({ variant, side: match.side });
    home.addEventListener('click', function onGiveUp(e) {
      if (!e.target.closest?.('[data-lobby-back]')) return;
      home.removeEventListener('click', onGiveUp);
      leave();
    });
  } else {
    show(home, false);
    show(board, true);
    show(controls, true);
  }

  const stop = () => {
    clearTimeout(retryTimer);
    retryTimer = null;
    clearMatch();
    // Closing the socket is what tells the server this coach has gone,
    // rather than holding a seat for a browser that went home.
    try { ws?.close(); } catch { /* already gone */ }
  };
  const leave = () => {
    if (left) return;
    left = true;
    stop();
    onExit();
  };
  // Play again: straight back into the queue for the side he just played.
  const again = () => {
    if (left) return;
    left = true;
    stop();
    openLobbySocket(variant, match.side, (next) => enterMatch(variant, next, onExit), onExit);
  };
  const endWith = (result) => {
    over = true;
    clearMatch();
    if (left) return;
    showMatchOver(variant, match.side, result, { leave, again });
  };
  const finalCall = () => {
    const finalState = lastState && {
      ...lastState, aiTeam: null, remoteTeam: match.side === 'offense' ? 'defense' : 'offense',
    };
    return finalState ? gameOverMessage(finalState) : 'The drive is over.';
  };

  const onMessage = (msg) => {
    if (msg.type === 'turn') {
      lastState = msg.state;
      if (!dealt) {
        dealt = true;
        show(home, false);
        show(board, true);
        show(controls, true);
      }
    } else if (msg.type === 'start') {
      dealt = true;
    } else if (msg.type === 'matchOver') {
      // The board narrates the ending first (main.js's own matchOver
      // handler); the end screen follows once the coach has had a look.
      const result = matchOverResult(msg.reason, finalCall());
      over = true;
      clearMatch();
      setTimeout(() => endWith(result), MATCH_OVER_LINGER_MS);
    } else if (msg.type === 'refused') {
      // The seat is not this token's any more: the match is over, or the
      // server has forgotten it. There is nothing to keep trying for.
      endWith(dealt ? 'The connection could not be restored.' : 'That match could not be rejoined.');
    }
  };

  const connect = () => {
    const socket = new WebSocket(wsUrl(`/match/${match.matchId}?side=${match.side}&token=${match.token}`));
    ws = socket;
    net.attach(socket);
    socket.addEventListener('message', (ev) => onMessage(JSON.parse(ev.data)));
    socket.addEventListener('open', () => {
      if (lostAt === null) return;
      lostAt = null;
      net.deliver({ type: 'connectionRestored' });
    });
    socket.addEventListener('close', () => {
      if (ws !== socket || left || over) return;
      if (lostAt === null) {
        lostAt = Date.now();
        net.deliver({ type: 'connectionLost' });
      }
      if (Date.now() - lostAt > RECONNECT_WINDOW_MS) {
        endWith(dealt ? 'The connection was lost and could not be restored.' : 'That match could not be rejoined.');
        return;
      }
      retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });
  };
  // The socket is opened before main.js is imported, because MatchDO
  // broadcasts `start` the moment the second coach connects -- inside the
  // await below. createNet holds anything that lands before startGame has
  // registered a handler for it.
  connect();
  game ??= await import('./main.js');
  game.startGame({ variant: variant.id, side: match.side, onExit: leave, net });
}

/**
 * Pick the match this tab was in back up, if it was in one. app/home.js asks
 * on every page load, before drawing the home screen: a reload mid-drive
 * comes straight back to the board rather than to a menu with the match
 * quietly still running behind it. Returns whether there was one to rejoin.
 */
export function resumeSavedMatch({ onExit = () => {} } = {}) {
  const saved = loadMatch();
  if (!saved) return false;
  enterMatch(getVariant(saved.variant), saved, onExit, { resuming: true });
  return true;
}

/**
 * The end screen: the result, Play again (back through the queue for the
 * same side -- a fresh pairing, not a rematch) and Back. Drawn into the home
 * section over the board, the way the lobby was.
 */
function showMatchOver(variant, side, result, { leave, again }) {
  show(board, false);
  show(controls, false);
  show(home, true);
  home.innerHTML = matchOverMarkup({ variant, side, result });
  home.addEventListener('click', function onEndClick(e) {
    if (e.target.closest?.('[data-lobby-again]')) {
      home.removeEventListener('click', onEndClick);
      again();
    } else if (e.target.closest?.('[data-lobby-back]')) {
      home.removeEventListener('click', onEndClick);
      leave();
    }
  });
}

/**
 * The side chooser, and the listener that answers it. One function for both
 * because the screen is reached twice -- from the home screen, and from the
 * lobby's Back -- and a chooser drawn without its listener is a screen of
 * dead buttons: app/home.js stopped listening to this section the moment
 * multiplayer took it over, so nothing else would answer them.
 */
function showSidePicker(variant, onExit) {
  show(board, false);
  show(controls, false);
  show(home, true);
  home.innerHTML = sideMarkup(variant, MULTIPLAYER_SIDES);
  home.addEventListener('click', function onSideClick(e) {
    // sideMarkup writes a Back button into every chooser it builds, and
    // app/home.js deliberately stops listening to this section the moment
    // multiplayer takes it over -- so this screen's Back is ours to answer.
    if (e.target.closest?.('[data-home-back]')) {
      home.removeEventListener('click', onSideClick);
      onExit();
      return;
    }
    const btn = e.target.closest?.('[data-side]');
    if (!btn) return;
    home.removeEventListener('click', onSideClick);
    openLobbySocket(variant, btn.dataset.side, (matched) => enterMatch(variant, matched, onExit), onExit);
  });
}

export function startMultiplayer({ variant: variantId, onExit = () => {} } = {}) {
  showSidePicker(getVariant(variantId), onExit);
}
