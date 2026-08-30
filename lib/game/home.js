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
