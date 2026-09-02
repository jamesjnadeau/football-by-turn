/**
 * The home screen, as a markup string — the same discipline render.js follows
 * for the board, and for the same reason: `node --test` has no DOM, so the
 * only way to test what the page says is to build it as text. app/home.js
 * writes this into the page and listens for the press.
 *
 * `variants` is a parameter rather than a straight import so a test can hand
 * it a list of its own; the default is the real one, which is what the app
 * uses.
 */
import { escapeText } from '../field/escape.js';
import { VARIANTS } from './variants.js';

/** What an unplayable variant's button says after its name. */
export const COMING_SOON = 'coming soon';

function choiceMarkup(variant) {
  const label = variant.available
    ? escapeText(variant.label)
    : `${escapeText(variant.label)} — ${COMING_SOON}`;
  return `<button class="home-choice" type="button" data-variant="${escapeText(variant.id)}"`
    + `${variant.available ? '' : ' disabled'}>`
    + `<span class="home-choice-label">${label}</span>`
    + `<span class="home-choice-note">${escapeText(variant.note)}</span>`
    + '</button>';
}

/**
 * The tutorial's own button. Not a variant: it deals its own drills rather
 * than one of the games in VARIANTS, so it is written in beneath the list
 * instead of being an entry in it. Quieter than the two green choices, because
 * it is the thing you do once, not the thing you came for.
 */
function tutorialMarkup(tutorialDone) {
  const note = tutorialDone
    ? 'You have been through these. Run them again any time.'
    : 'Four short lessons: the snap, running, blocking, throwing and covering.';
  return '<button class="home-choice home-choice-quiet" type="button" data-tutorial>'
    + '<span class="home-choice-label">How to play</span>'
    + `<span class="home-choice-note">${escapeText(note)}</span>`
    + '</button>';
}

export function homeMarkup(variants = VARIANTS, { tutorialDone = false } = {}) {
  return '<h1>Football By Turn</h1>'
    + '<p class="home-blurb">Draw where your players run, half a second at a time.'
    + ' Pick a game.</p>'
    + `<div class="home-choices">${variants.map(choiceMarkup).join('')}`
    + `${tutorialMarkup(tutorialDone)}</div>`;
}

/**
 * The second question the home screen asks: which side of the ball you
 * coach. Same discipline as the variant list — a list of choices, built as
 * a string, with the notes saying what the computer will be doing about it.
 */
export const SIDES = [
  {
    id: 'offense',
    label: 'Play Offense',
    note: 'You call the runs and throws against the computer’s learned defense.',
  },
  {
    id: 'defense',
    label: 'Play Defense',
    note: 'You set the coverage against the computer’s learned offense.',
  },
  {
    id: 'training',
    label: 'Training Mode',
    note: 'The game as it always was: coach the offense against the computer’s smart assignment defense.',
  },
  {
    id: 'multiplayer',
    label: 'Multiplayer',
    note: 'Play a live drive against another coach.',
  },
];

/**
 * The sides this build can actually offer. Multiplayer is the one entry that
 * needs something behind the page: a Worker holding the lobby and the match.
 * The GitHub Pages mirror publishes these same files with no Worker under
 * them, so it asks for the entry to be dropped rather than offering a button
 * that opens a socket to an origin which cannot answer it.
 *
 * A parameter rather than a read of the flag, for the reason `homeMarkup`
 * takes its variants as one: a test hands it both answers. app/home.js is
 * where the build's real answer is looked up.
 */
export function sidesFor({ multiplayer = true } = {}, sides = SIDES) {
  return multiplayer ? sides : sides.filter((s) => s.id !== 'multiplayer');
}

/**
 * The side chooser for one picked variant. Buttons carry `data-side` the way
 * the first screen's carry `data-variant`, plus a `data-home-back` button
 * for a coach who pressed the wrong game — app/home.js matches on all three.
 */
export function sideMarkup(variant, sides = SIDES) {
  const buttons = sides.map((s) =>
    `<button class="home-choice" type="button" data-side="${escapeText(s.id)}">`
    + `<span class="home-choice-label">${escapeText(s.label)}</span>`
    + `<span class="home-choice-note">${escapeText(s.note)}</span>`
    + '</button>').join('');
  return `<h1>${escapeText(variant.label)}</h1>`
    + '<p class="home-blurb">Pick your side.</p>'
    + `<div class="home-choices">${buttons}`
    + '<button class="home-choice" type="button" data-home-back>'
    + '<span class="home-choice-label">Back</span>'
    + '<span class="home-choice-note">Pick a different game.</span>'
    + '</button></div>';
}
