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
  FIELD_LOW_YARD, WINDOW_YARDS, WINDOW_BEHIND_YARDS, CAMERA_DEADZONE_YARDS,
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

/**
 * Where the camera sits while the ball is at `ballYard`.
 *
 * The camera holds on the line of scrimmage until the ball has got more than
 * CAMERA_DEADZONE_YARDS past it, and from then on trails it by exactly that --
 * so the ball comes to rest at the edge of the deadzone on screen and the
 * field scrolls underneath it for the rest of the run.
 *
 * Anchored to the LINE OF SCRIMMAGE rather than to wherever the camera was
 * last, which is what makes it a pure function of the down and the ball: there
 * is no camera position to carry between frames, nothing to reset at the snap,
 * and nothing that can drift out of step with the state.
 *
 * It never backs up behind the line, and needs no special case for a sack to
 * make that safe: the window already holds WINDOW_BEHIND_YARDS of ground
 * behind the line, so a quarterback driven backwards is on screen anyway.
 */
export function followYard(losYard, ballYard) {
  return Math.max(losYard, ballYard - CAMERA_DEADZONE_YARDS);
}

/**
 * The field to draw, and the window to show of it.
 *
 * These are two different things and this returns both. The FIELD is fixed --
 * every yard of it, goal line and end zone included, drawn once per down --
 * because the camera scrolls by moving the viewBox over what is already
 * there. Draw only the part in frame and the first scroll would run off the
 * end of it and show blank turf.
 *
 * The WINDOW is `windowTopY`/`height`: the crop actually on screen, positioned
 * from `cameraYard` and clamped so it never scrolls off either end of the
 * field. `cameraYard` defaults to the line of scrimmage, which is where the
 * camera rests at the snap and between downs; followYard is what moves it
 * during a play.
 */
export function gameView(losYard, cameraYard = losYard) {
  const rawTop = cameraYard - WINDOW_BEHIND_YARDS;
  const topYard = Math.max(FIELD_LOW_YARD, Math.min(rawTop, END_YARD - WINDOW_YARDS));
  const windowTopY = ANCHOR_Y + topYard * UNITS_PER_YARD_X;
  return {
    scaleY: UNITS_PER_YARD_X,
    anchorY: ANCHOR_Y,
    // The drawn field: all of it, camera or no camera.
    fieldTopY: ANCHOR_Y + FIELD_LOW_YARD * UNITS_PER_YARD_X,
    bottomYard: END_YARD,
    goalYard: GOAL_YARD,
    goalPosts: true,
    sidelineLabel: null,
    // The crop. renderBoardShell writes these two into the viewBox attribute,
    // and they are the only part of this that moves while a play is running.
    windowTopY: windowTopY - MARGIN_TOP,
    height: WINDOW_YARDS * UNITS_PER_YARD_X + MARGIN_TOP + MARGIN_BOTTOM,
    scrimmage: { yard: losYard },
    yardLines: tenYardLines(FIELD_LOW_YARD, END_YARD),
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
