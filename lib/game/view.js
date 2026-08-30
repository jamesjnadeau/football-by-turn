/**
 * The game's one view: a uniform-scale window from 20 yards behind the
 * drive's start to the back of the end zone. Unlike the diagram views this
 * copies its shape from, scaleY here MUST equal UNITS_PER_YARD_X — the
 * physics treats players as circles, and a circle is only a circle if a
 * yard is the same number of units in both axes.
 *
 * Yard 0 is where the drive starts (the 10-yard line). The goal line is
 * yard 10, the end line yard 20, and the frame reaches back to yard -20.
 */
import { UNITS_PER_YARD_X, x, y } from '../field/geometry.js';

export const TOP_YARD = -20;
export const GOAL_YARD = 10;
export const END_YARD = 20;

const MARGIN_TOP = 10;
const MARGIN_BOTTOM = 10;
const ANCHOR_Y = MARGIN_TOP + -TOP_YARD * UNITS_PER_YARD_X; // yard 0 in SVG y

export function gameView(losYard) {
  return {
    scaleY: UNITS_PER_YARD_X,
    anchorY: ANCHOR_Y,
    fieldTopY: MARGIN_TOP,
    bottomYard: END_YARD,
    goalYard: GOAL_YARD,
    goalPosts: true,
    sidelineLabel: 'COACHES MENU',
    height: ANCHOR_Y + END_YARD * UNITS_PER_YARD_X + MARGIN_BOTTOM,
    // Unlabelled: it is the only dashed line on the board, so it needs no
    // name, and a "LOS" label would print right on top of the "10" yard
    // number sharing its gutter.
    scrimmage: { yard: losYard },
    yardLines: [
      { yard: -15, label: '25' },
      { yard: -10, label: '20' },
      { yard: -5, label: '15' },
      { yard: 0, label: '10' },
      { yard: 5, label: '5' },
    ],
  };
}

/** Football coordinates (yards across from centre, yards downfield) → SVG units. */
export function fieldPos(acrossYards, downYards) {
  return { x: x(acrossYards), y: y(gameView(0), downYards) };
}

/** SVG y → yards downfield. The inverse of fieldPos's y. */
export function yardsOfY(svgY) {
  return (svgY - ANCHOR_Y) / UNITS_PER_YARD_X;
}
