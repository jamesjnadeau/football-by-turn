/**
 * Draws the field a diagram is painted on: turf, boundaries, yard lines and
 * their numbers, hash marks, the end zone, the uprights, the press box legend.
 *
 * No players and no officials — those are `markers.js`. Everything here comes
 * out of the view and the geometry, so a diagram cannot disagree with the
 * field it sits on.
 */
import {
  SIDELINE_LEFT,
  SIDELINE_RIGHT,
  HASH_TICK_UNITS,
  YARD_LABEL_LEFT_X,
  YARD_LABEL_RIGHT_X,
  YARD_LABEL_BASELINE_OFFSET,
  PRESS_BOX_X,
  goalPostsX,
  hashCentresX,
  hashYards,
  num,
  y as yardToY,
} from './geometry.js';
import { escapeText } from './escape.js';

const FIELD_WIDTH_UNITS = SIDELINE_RIGHT - SIDELINE_LEFT;

/** How far an upright runs either side of the end line. */
const GOAL_POST_OVERHANG = 5;

const line = (x1, y1, x2, y2, cls) =>
  `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" class="${cls}"/>`;

/** A yard number in both margins, straddling its line. */
function yardLabels(lineY, label) {
  if (label == null) return '';
  const baseline = num(lineY + YARD_LABEL_BASELINE_OFFSET);
  const text = escapeText(label);
  return (
    `<text x="${num(YARD_LABEL_LEFT_X)}" y="${baseline}" class="ylab end">${text}</text>` +
    `<text x="${num(YARD_LABEL_RIGHT_X)}" y="${baseline}" class="ylab start">${text}</text>`
  );
}

/**
 * Draws one view's field.
 *
 * Returns the SVG fragment plus the frame it needs, so the caller can build
 * the document without knowing any geometry.
 */
export function renderField(view) {
  const topY = view.fieldTopY;
  const bottomY = yardToY(view, view.bottomYard);
  const goalY = view.goalYard == null ? null : yardToY(view, view.goalYard);
  // Turf runs to the goal line; past it the end zone is hatched instead.
  const turfBottomY = goalY ?? bottomY;

  const parts = [];

  parts.push(
    `<rect x="${num(SIDELINE_LEFT)}" y="${num(topY)}" width="${num(FIELD_WIDTH_UNITS)}" height="${num(turfBottomY - topY)}" class="turf"/>`,
  );
  if (goalY !== null) {
    parts.push(
      `<rect x="${num(SIDELINE_LEFT)}" y="${num(goalY)}" width="${num(FIELD_WIDTH_UNITS)}" height="${num(bottomY - goalY)}" class="ez"/>`,
    );
  }

  // Hash marks sit under the lines so a yard line reads as continuous.
  const [hashLeftX, hashRightX] = hashCentresX();
  for (const yard of hashYards(view)) {
    const hy = yardToY(view, yard);
    for (const cx of [hashLeftX, hashRightX]) {
      parts.push(
        line(cx - HASH_TICK_UNITS / 2, hy, cx + HASH_TICK_UNITS / 2, hy, 'hash'),
      );
    }
  }

  parts.push(line(SIDELINE_LEFT, topY, SIDELINE_LEFT, bottomY, 'sl'));
  parts.push(line(SIDELINE_RIGHT, topY, SIDELINE_RIGHT, bottomY, 'sl'));

  for (const { yard, label } of view.yardLines ?? []) {
    const ly = yardToY(view, yard);
    parts.push(line(SIDELINE_LEFT, ly, SIDELINE_RIGHT, ly, 'yl'));
    parts.push(yardLabels(ly, label));
  }

  if (view.scrimmage) {
    const sy = yardToY(view, view.scrimmage.yard);
    parts.push(line(SIDELINE_LEFT, sy, SIDELINE_RIGHT, sy, 'rl'));
    parts.push(yardLabels(sy, view.scrimmage.label));
  }

  if (goalY !== null) {
    parts.push(line(SIDELINE_LEFT, goalY, SIDELINE_RIGHT, goalY, 'gl'));
    parts.push(yardLabels(goalY, 'G'));
    // The end line, which needs no number of its own.
    parts.push(line(SIDELINE_LEFT, bottomY, SIDELINE_RIGHT, bottomY, 'gl'));
  }

  if (view.goalPosts) {
    for (const px of goalPostsX()) {
      parts.push(
        line(px, bottomY - GOAL_POST_OVERHANG, px, bottomY + GOAL_POST_OVERHANG, 'post'),
      );
    }
  }

  // Which sideline the press box is on orients the whole diagram, so it is
  // part of the field rather than an annotation.
  const pressBoxY = num((topY + bottomY) / 2);
  parts.push(
    `<text x="${num(PRESS_BOX_X)}" y="${pressBoxY}" class="pb" transform="rotate(90 ${num(PRESS_BOX_X)} ${pressBoxY})">PRESS BOX</text>`,
  );

  return { svg: parts.join(''), height: view.height };
}
