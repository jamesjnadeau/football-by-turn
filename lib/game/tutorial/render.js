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
/** Clearance below the control, inside the plate — not flush against its edge. */
const CARD_PAD_BOTTOM = 2.625;

// Font sizes below must track the .tut-title/.tut-text/.tut-foot rules in
// lib/game/render.js's stylesheet. CARD_CHAR_WIDTH is calibrated for the
// body's 4px font, so a title or footer line — set smaller, at 3.4px and 3px
// respectively — is scaled down to body-character-equivalents before being
// compared against the body lines, or it would overstate its own width and
// under-size the plate around it.
const CARD_TITLE_FONT_PX = 3.4;
const CARD_BODY_FONT_PX = 4;
const CARD_FOOT_FONT_PX = 3;

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

  // Walk the layout as offsets from the plate's own top, and let `plateH` be
  // the sum of exactly those offsets rather than a hand-kept tally — so the
  // two can never drift apart the way they did before: the plate used to be
  // sized by a formula that didn't mirror the bumps the walk actually takes
  // between title and body and between body and footer/control, and the
  // control's rect ended up hanging out past the plate's own bottom edge.
  let offset = CARD_PAD_Y + CARD_TITLE_HEIGHT * 0.75;
  const titleOffset = offset;
  offset += CARD_TITLE_HEIGHT * 0.5;
  const bodyOffset = offset;
  offset += bodyHeight + CARD_LINE_HEIGHT;
  const footOffset = offset;
  if (card.footer) offset += footHeight;
  const btnOffset = offset;
  offset += CARD_BTN_H;
  const plateH = offset + CARD_PAD_BOTTOM;

  const titleText = `${card.title} · ${card.progress}`;
  const widest = Math.max(
    CARD_MAX_CHARS * 0.7,
    ...lines.map((l) => l.length),
    titleText.length * (CARD_TITLE_FONT_PX / CARD_BODY_FONT_PX),
    card.footer ? card.footer.length * (CARD_FOOT_FONT_PX / CARD_BODY_FONT_PX) : 0,
  );
  const plateW = Math.min(
    widest * CARD_CHAR_WIDTH + CARD_PAD_X * 2,
    SIDELINE_RIGHT - SIDELINE_LEFT,
  );
  const plateX = CENTRE_X - plateW / 2;
  const plateY = view.windowTopY + view.height - CARD_MARGIN_BOTTOM - plateH;

  const titleY = plateY + titleOffset;
  const title =
    `<text class="tut-title" x="${num(CENTRE_X)}" y="${num(titleY)}">`
    + `${escapeText(titleText)}</text>`;

  const bodyY = plateY + bodyOffset;
  const body =
    `<text class="tut-text">${lines.map((l, i) =>
      `<tspan x="${num(CENTRE_X)}" y="${num(bodyY + (i + 1) * CARD_LINE_HEIGHT)}">${escapeText(l)}</tspan>`
    ).join('')}</text>`;

  const footY = plateY + footOffset;
  const foot = card.footer
    ? `<text class="tut-foot" x="${num(CENTRE_X)}" y="${num(footY)}">${escapeText(card.footer)}</text>`
    : '';

  const y = plateY + btnOffset;

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
