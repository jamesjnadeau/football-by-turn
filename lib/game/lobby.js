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

/**
 * The end-of-match screen: what the drive came to, and the two ways on. Play
 * again puts the coach back through the queue for the side he just played --
 * a fresh pairing, not a rematch (spec) -- and Back goes home.
 *
 * `result` is the sentence about the drive, already facing this coach
 * (gameOverMessage, or the reason the match ended without one).
 */
export function matchOverMarkup({ variant, side, result }) {
  return `<h1>${escapeText(variant.label)}</h1>`
    + `<p class="home-blurb">${escapeText(result)}</p>`
    + '<div class="home-choices">'
    + '<button class="home-choice" type="button" data-lobby-again>'
    + '<span class="home-choice-label">Play again</span>'
    + `<span class="home-choice-note">Queue for ${escapeText(side)} against a new opponent.</span>`
    + '</button>'
    + '<button class="home-choice" type="button" data-lobby-back>'
    + '<span class="home-choice-label">Back</span>'
    + '<span class="home-choice-note">Return to the home screen.</span>'
    + '</button></div>';
}

/** What a match that ended without a result has to say for itself. */
export function matchOverResult(reason, gameOverText) {
  if (reason === 'down') return gameOverText;
  if (reason === 'opponent-left') return 'Your opponent left the match.';
  if (reason === 'no-opponent') return 'Your opponent never arrived.';
  return 'The match is over.';
}

/**
 * What the coach sees when the lobby socket dies before a match: a page
 * served with nothing behind it (`npm run serve`, or a Pages copy with the
 * flag left on) has no /lobby to answer, and a picker whose buttons do nothing
 * looks like a game that is broken rather than a server that is absent.
 */
export function lobbyUnavailableMarkup({ variant }) {
  return `<h1>${escapeText(variant.label)}</h1>`
    + '<p class="home-blurb">The lobby could not be reached.</p>'
    + '<p class="home-blurb">Multiplayer needs the game\'s Worker behind the page. '
    + 'Locally that is <code>npm run serve:worker</code>, not <code>npm run serve</code>.</p>'
    + '<div class="home-choices">'
    + '<button class="home-choice" type="button" data-lobby-back>'
    + '<span class="home-choice-label">Back</span>'
    + '</button></div>';
}
