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
import { lobbyMarkup } from '../lib/game/lobby.js';
import { sideMarkup, SIDES } from '../lib/game/home.js';
import { getVariant } from '../lib/game/variants.js';
import { createNet } from './net.js';

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

function openLobbySocket(variant, side, onMatched) {
  const ws = new WebSocket(wsUrl(`/lobby?variant=${variant.id}&side=${side}`));
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'queued') {
      home.innerHTML = lobbyMarkup({
        variant, side, offenseDepth: msg.offense, defenseDepth: msg.defense,
      });
    } else if (msg.type === 'matched') {
      ws.close();
      onMatched(msg);
    }
  });
  home.addEventListener('click', function onLobbyClick(e) {
    if (e.target.closest?.('[data-lobby-switch]')) {
      ws.send(JSON.stringify({ type: 'switch' }));
    } else if (e.target.closest?.('[data-lobby-back]')) {
      ws.close();
      home.removeEventListener('click', onLobbyClick);
      showSidePicker(variant);
    }
  });
  return ws;
}

function openMatchSocket(matchId, side, token, onMessage) {
  const ws = new WebSocket(wsUrl(`/match/${matchId}?side=${side}&token=${token}`));
  ws.addEventListener('message', (ev) => onMessage(JSON.parse(ev.data)));
  sessionStorage.setItem('fbt-match', JSON.stringify({ matchId, side, token }));
  return ws;
}

async function enterMatch(variant, matched, onExit) {
  show(home, false);
  show(board, true);
  // The handle goes on the socket in the same breath the socket is opened,
  // because MatchDO broadcasts `start` the moment the second coach connects
  // -- which is inside the await below. createNet holds anything that lands
  // before startGame has registered a handler for it.
  const ws = openMatchSocket(matched.matchId, matched.side, matched.token, () => {});
  const net = createNet(ws, matched.side);
  game ??= await import('./main.js');
  game.startGame({ variant: variant.id, side: matched.side, onExit, net });
}

function showSidePicker(variant) {
  show(board, false);
  show(home, true);
  home.innerHTML = sideMarkup(variant, [
    ...SIDES.filter((s) => s.id === 'offense' || s.id === 'defense'),
  ]);
}

export function startMultiplayer({ variant: variantId, onExit = () => {} } = {}) {
  const variant = getVariant(variantId);
  showSidePicker(variant);
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
    openLobbySocket(variant, btn.dataset.side, (matched) => enterMatch(variant, matched, onExit));
  });
}
