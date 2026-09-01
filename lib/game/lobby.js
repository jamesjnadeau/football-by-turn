/**
 * The lobby screen, as a markup string — the same discipline home.js and
 * render.js follow, and for the same reason: node --test has no DOM, so this
 * is the only way to test what the waiting screen says. app/multiplayer.js
 * writes this into the page and listens for the two presses.
 */
import { escapeText } from '../field/escape.js';

const OTHER_SIDE = { offense: 'defense', defense: 'offense' };

/**
 * `variant` is `{id, label}` (see lib/game/variants.js). `side` is which
 * queue this coach is in. `offenseDepth`/`defenseDepth` are how many coaches
 * are waiting for each side right now — LobbyDO broadcasts these on every
 * change (spec: "It broadcasts both queue depths to everyone waiting").
 */
export function lobbyMarkup({ variant, side, offenseDepth, defenseDepth }) {
  const other = OTHER_SIDE[side];
  return `<h1>${escapeText(variant.label)}</h1>`
    + `<p class="home-blurb">Waiting to play ${escapeText(side)}…</p>`
    + '<ul class="lobby-depths">'
    + `<li>${offenseDepth} waiting for offense</li>`
    + `<li>${defenseDepth} waiting for defense</li>`
    + '</ul>'
    + '<div class="home-choices">'
    + '<button class="home-choice" type="button" data-lobby-switch>'
    + `<span class="home-choice-label">Queue for ${escapeText(other)} instead</span>`
    + '</button>'
    + '<button class="home-choice" type="button" data-lobby-back>'
    + '<span class="home-choice-label">Back</span>'
    + '<span class="home-choice-note">Leave the queue.</span>'
    + '</button></div>';
}
