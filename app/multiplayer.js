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
import { lobbyMarkup, matchOverMarkup, matchOverResult, lobbyUnavailableMarkup } from '../lib/game/lobby.js';
import { sideMarkup, MULTIPLAYER_SIDES } from '../lib/game/home.js';
import { gameOverMessage } from '../lib/game/hud.js';
import { getVariant } from '../lib/game/variants.js';
import { createNet, bindWhileOpen } from './net.js';

const home = document.getElementById('home');
const board = document.getElementById('board');

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
      onMatched(msg);
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

function openMatchSocket(matchId, side, token, onMessage) {
  const ws = new WebSocket(wsUrl(`/match/${matchId}?side=${side}&token=${token}`));
  ws.addEventListener('message', (ev) => onMessage(JSON.parse(ev.data)));
  sessionStorage.setItem('fbt-match', JSON.stringify({ matchId, side, token }));
  return ws;
}

/** How long the board keeps the final play before the end screen replaces it. */
const MATCH_OVER_LINGER_MS = 3000;

async function enterMatch(variant, matched, onExit) {
  show(home, false);
  show(board, true);
  // Leaving the match -- the Coaches Menu's Home button, or Back on the end
  // screen -- closes the socket, so the server sees this coach go rather
  // than holding a seat for a browser that has gone home. Without this the
  // opponent was left playing a ghost whose seat stayed occupied.
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    ws.close();
    onExit();
  };
  // Play again: the socket is done with, but the coach is not going home --
  // he is going straight back into the queue for the side he just played.
  const again = () => {
    if (left) return;
    left = true;
    ws.close();
    openLobbySocket(variant, matched.side, (next) => enterMatch(variant, next, onExit), onExit);
  };
  // The last state the server sent, kept so the end screen can say the
  // result in the game's own words, facing this coach.
  let lastState = null;
  const onMessage = (msg) => {
    if (msg.type === 'turn') {
      lastState = msg.state;
    } else if (msg.type === 'matchOver') {
      const finalState = lastState && {
        ...lastState, aiTeam: null, remoteTeam: matched.side === 'offense' ? 'defense' : 'offense',
      };
      const result = matchOverResult(msg.reason, finalState ? gameOverMessage(finalState) : 'The drive is over.');
      // The board narrates the ending first (main.js's own matchOver
      // handler); the end screen follows once the coach has had a look.
      setTimeout(() => {
        if (left) return;
        showMatchOver(variant, matched.side, result, { leave, again });
      }, MATCH_OVER_LINGER_MS);
    }
  };
  // The handle goes on the socket in the same breath the socket is opened,
  // because MatchDO broadcasts `start` the moment the second coach connects
  // -- which is inside the await below. createNet holds anything that lands
  // before startGame has registered a handler for it.
  const ws = openMatchSocket(matched.matchId, matched.side, matched.token, onMessage);
  const net = createNet(ws, matched.side);
  game ??= await import('./main.js');
  game.startGame({ variant: variant.id, side: matched.side, onExit: leave, net });
}

/**
 * The end screen: the result, Play again (back through the queue for the
 * same side -- a fresh pairing, not a rematch) and Back. Drawn into the home
 * section over the board, the way the lobby was.
 */
function showMatchOver(variant, side, result, { leave, again }) {
  show(board, false);
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
