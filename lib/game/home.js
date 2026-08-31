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

export function homeMarkup(variants = VARIANTS) {
  return '<h1>Football By Turn</h1>'
    + '<p class="home-blurb">Draw where your players run, half a second at a time.'
    + ' Pick a game.</p>'
    + `<div class="home-choices">${variants.map(choiceMarkup).join('')}</div>`;
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
];

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
