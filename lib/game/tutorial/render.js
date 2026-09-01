/**
 * The tutorial's own two marks: the coach card, and the ring round whatever
 * must be pressed next.
 *
 * Built as markup strings like everything else drawn on this board, so a test
 * can hold every word of a lesson without a DOM. app/main.js writes the result
 * into the `game-tutorial` layer, which sits above everything else in the
 * shell — a card that a player could stand in front of would be no use.
 *
 * The card is pinned to the BOTTOM of the window on purpose: the referee's
 * plate (render.js's renderMessage) holds the top, and "Tackled!" and "what to
 * do next" are two different voices that should not fight for one spot.
 */
import { escapeText } from '../../field/escape.js';
import { gameView } from '../view.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT, CENTRE_X, num } from '../../field/geometry.js';
import { wrapWords } from '../render.js';

/** Wider than the referee's plate: a lesson is a paragraph, not a shout. */
const CARD_MAX_CHARS = 40;
const CARD_LINE_HEIGHT = 5;
const CARD_CHAR_WIDTH = 2.35;
const CARD_PAD_X = 6;
const CARD_PAD_Y = 3.5;
const CARD_TITLE_HEIGHT = 4.5;
const CARD_FOOT_HEIGHT = 4;
const CARD_BTN_W = 26;
const CARD_BTN_H = 6;
const CARD_MARGIN_BOTTOM = 3;

/**
 * The card. Sized to its own words rather than to a fixed box, and clamped to
 * the sidelines the way the referee's plate is — an essay overflows rather
 * than being silently truncated, which is the renderer's problem to notice
 * and not the coach's to guess at.
 */
export function coachCardMark(card, losYard, cameraYard = losYard) {
  const view = gameView(losYard, cameraYard);
  const lines = wrapWords(card.text, CARD_MAX_CHARS);
  const bodyHeight = lines.length * CARD_LINE_HEIGHT;
  const footHeight = card.footer ? CARD_FOOT_HEIGHT : 0;
  const plateH = CARD_PAD_Y * 2 + CARD_TITLE_HEIGHT + bodyHeight + footHeight + CARD_BTN_H + 2;
  const widest = Math.max(CARD_MAX_CHARS * 0.7, ...lines.map((l) => l.length));
  const plateW = Math.min(
    widest * CARD_CHAR_WIDTH + CARD_PAD_X * 2,
    SIDELINE_RIGHT - SIDELINE_LEFT,
  );
  const plateX = CENTRE_X - plateW / 2;
  const plateY = view.windowTopY + view.height - CARD_MARGIN_BOTTOM - plateH;

  let y = plateY + CARD_PAD_Y + CARD_TITLE_HEIGHT * 0.75;
  const title =
    `<text class="tut-title" x="${num(CENTRE_X)}" y="${num(y)}">`
    + `${escapeText(card.title)} · ${escapeText(card.progress)}</text>`;

  y += CARD_TITLE_HEIGHT * 0.5;
  const body =
    `<text class="tut-text">${lines.map((l, i) =>
      `<tspan x="${num(CENTRE_X)}" y="${num(y + (i + 1) * CARD_LINE_HEIGHT)}">${escapeText(l)}</tspan>`
    ).join('')}</text>`;

  y += bodyHeight + CARD_LINE_HEIGHT;
  const foot = card.footer
    ? `<text class="tut-foot" x="${num(CENTRE_X)}" y="${num(y)}">${escapeText(card.footer)}</text>`
    : '';
  if (card.footer) y += CARD_FOOT_HEIGHT;

  // The one control a lesson has. `data-tutorial-next` rather than a skip name
  // because it is the same press either way: on a step it skips the lesson, on
  // the sign-off it moves to the next one, and app/main.js should not have to
  // know which card it is looking at.
  const btnX = CENTRE_X - CARD_BTN_W / 2;
  const control =
    `<g><rect data-tutorial-next="1" class="tut-next" tabindex="0" role="button"`
    + ` aria-label="${escapeText(card.control)}"`
    + ` x="${num(btnX)}" y="${num(y)}" width="${num(CARD_BTN_W)}" height="${num(CARD_BTN_H)}" rx="1"/>`
    + `<text class="tut-next-label" x="${num(CENTRE_X)}" y="${num(y + CARD_BTN_H / 2)}">`
    + `${escapeText(card.control)}</text></g>`;

  return (
    `<rect class="tut-plate" x="${num(plateX)}" y="${num(plateY)}"`
    + ` width="${num(plateW)}" height="${num(plateH)}" rx="2"/>`
    + title + body + foot + control
  );
}

/** The ring round whatever is to be pressed next, or nothing at all. */
export function highlightMark(anchor) {
  if (!anchor) return '';
  return `<circle class="tut-ring" cx="${num(anchor.x)}" cy="${num(anchor.y)}"`
    + ` r="${num(anchor.r + 2)}"/>`;
}
