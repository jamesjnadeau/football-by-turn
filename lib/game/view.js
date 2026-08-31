/**
 * The game's field, in one fixed coordinate space: yard 0 is the offense's
 * own goal line, the goal it attacks is GOAL_YARD, and END_YARD is the back
 * of that end zone. fieldPos/yardsOfY convert between this fixed space and
 * SVG units through one unchanging anchorY/scaleY pair -- every player
 * position and every physics/rules distance check goes through them, and
 * none of it needs to know or care where the camera currently is.
 *
 * gameView(losYard), by contrast, is the camera: a WINDOW_YARDS-tall crop of
 * that fixed space that follows the line of scrimmage down the field,
 * clamped so it never scrolls past either end. Two different jobs, on
 * purpose -- see the plan's design decision 2. Scale is uniform (scaleY ===
 * UNITS_PER_YARD_X) for the same reason it always was: the physics treats
 * players as circles, and a circle is only a circle if a yard is the same
 * number of units in both axes.
 */
import { UNITS_PER_YARD_X, x, y } from '../field/geometry.js';
import {
  FIELD_LOW_YARD, WINDOW_YARDS, WINDOW_BEHIND_YARDS,
} from './constants.js';

export const OWN_GOAL_YARD = 0;
export const GOAL_YARD = 100;
export const END_YARD = 110;

const MARGIN_TOP = 10;
const MARGIN_BOTTOM = 10;
// The SVG y of yard 0, fixed for the whole game. Derived from FIELD_LOW_YARD
// so that a camera scrolled all the way back (topYard === FIELD_LOW_YARD)
// still has MARGIN_TOP of clearance above the topmost drawn yard line --
// exactly the invariant the old, single-window ANCHOR_Y held for TOP_YARD.
const ANCHOR_Y = MARGIN_TOP + -FIELD_LOW_YARD * UNITS_PER_YARD_X;

/** Standard broadcast numbering: distance from the nearer goal line. */
function yardLabel(absYard) {
  const yd = Math.round(absYard);
  return String(yd <= 50 ? yd : 100 - yd);
}

/** Numbered lines every ten yards inside the window, goal lines excluded --
 *  those get their own 'G' label from renderField's own goalYard/scrimmage
 *  handling, not this list. */
function tenYardLines(topYard, bottomYard) {
  const lines = [];
  const first = Math.ceil(topYard / 10) * 10;
  for (let yard = first; yard <= bottomYard; yard += 10) {
    if (yard <= OWN_GOAL_YARD || yard >= GOAL_YARD) continue;
    lines.push({ yard, label: yardLabel(yard) });
  }
  return lines;
}

export function gameView(losYard) {
  const rawTop = losYard - WINDOW_BEHIND_YARDS;
  const topYard = Math.max(FIELD_LOW_YARD, Math.min(rawTop, END_YARD - WINDOW_YARDS));
  const rawBottom = topYard + WINDOW_YARDS;
  // Only draw an end zone/uprights/goal line when the camera actually
  // reaches that far -- otherwise renderField would draw a goal line and a
  // hatched end zone below the window it is supposed to be cropped to.
  const reachesGoal = rawBottom >= GOAL_YARD;
  const bottomYard = reachesGoal ? Math.min(rawBottom, END_YARD) : rawBottom;
  const fieldTopY = ANCHOR_Y + topYard * UNITS_PER_YARD_X;
  const fieldBottomY = ANCHOR_Y + bottomYard * UNITS_PER_YARD_X;
  return {
    scaleY: UNITS_PER_YARD_X,
    anchorY: ANCHOR_Y,
    fieldTopY,
    bottomYard,
    goalYard: reachesGoal ? GOAL_YARD : null,
    goalPosts: reachesGoal,
    sidelineLabel: null,
    // The SVG viewBox's min-y and height -- the actual on-screen crop.
    // fieldTopY/height above stay in field.js's own vocabulary (yards-driven
    // SVG y's); these two are what renderBoardShell writes into the viewBox
    // attribute so the crop scrolls with the window instead of always
    // starting at SVG y 0.
    windowTopY: fieldTopY - MARGIN_TOP,
    height: (fieldBottomY + MARGIN_BOTTOM) - (fieldTopY - MARGIN_TOP),
    scrimmage: { yard: losYard },
    yardLines: tenYardLines(topYard, bottomYard),
  };
}

/** Football coordinates (yards across from centre, yards downfield from the
 *  offense's own goal line) -> SVG units. Independent of any camera. */
export function fieldPos(acrossYards, downYards) {
  return { x: x(acrossYards), y: ANCHOR_Y + downYards * UNITS_PER_YARD_X };
}

/** SVG y -> yards downfield. The inverse of fieldPos's y. */
export function yardsOfY(svgY) {
  return (svgY - ANCHOR_Y) / UNITS_PER_YARD_X;
}
