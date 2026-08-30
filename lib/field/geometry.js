/**
 * The field's coordinate system.
 *
 * Scenes describe positions in football terms — yards across from the middle of
 * the field, yards up or down from a reference line — and this module is the
 * only place that turns those into SVG user units. Nothing downstream should
 * contain a raw coordinate.
 *
 * Two scales are in play, and they are deliberately independent:
 *
 *   - Across the field, the scale is fixed. Every diagram is 270 units wide
 *     with the sidelines 200 units apart, so a yard is always 3.75 units.
 *   - Along the field, each view picks its own `scaleY`. A diagram showing
 *     three yards either side of the goal line and one showing a kickoff from
 *     K's 40 cannot share a scale and still fit on a card. This is why the
 *     field looks stretched: that is the point, not a bug.
 *
 * The numbers below were recovered by measuring the diagrams this replaces.
 * Where a value encodes an actual NFHS measurement it is derived from that
 * measurement rather than written as a decimal, so it stays checkable.
 */

// ---------------------------------------------------------------------------
// Across the field — fixed for every diagram
// ---------------------------------------------------------------------------

/** Every diagram is this wide. The margins hold out-of-bounds officials. */
export const VIEWBOX_WIDTH = 270;

export const SIDELINE_LEFT = 35;
export const SIDELINE_RIGHT = 235;
export const CENTRE_X = (SIDELINE_LEFT + SIDELINE_RIGHT) / 2;

/** NFHS 1-2-1: the field is 160 feet wide. */
export const FIELD_WIDTH_YARDS = 160 / 3;

/** 3.75. Derived, so the sidelines and the hash marks can't drift apart. */
export const UNITS_PER_YARD_X =
  (SIDELINE_RIGHT - SIDELINE_LEFT) / FIELD_WIDTH_YARDS;

/** NFHS 1-2-1: hash marks are 53'4" in from each sideline. */
export const HASH_FROM_SIDELINE_YARDS = 160 / 9;
export const HASH_FROM_CENTRE_YARDS =
  FIELD_WIDTH_YARDS / 2 - HASH_FROM_SIDELINE_YARDS;

/** Length of a single hash tick, across the field. */
export const HASH_TICK_UNITS = 6;

/** NFHS 1-2-4: the uprights are 23'4" apart. */
export const GOAL_POST_SPACING_YARDS = 70 / 9;

/** Hash marks are drawn every five yards, not every yard: at diagram scale a
 *  one-yard pitch reads as a solid line and prints as a smear. */
export const HASH_PITCH_YARDS = 5;

// Where the yard-number labels and the press box legend sit.
export const YARD_LABEL_LEFT_X = 29;
export const YARD_LABEL_RIGHT_X = 241;
/** Nudges a label's baseline so it reads as centred on its line. */
export const YARD_LABEL_BASELINE_OFFSET = 3.6;
export const PRESS_BOX_X = 257;

// ---------------------------------------------------------------------------
// Along the field — per view
// ---------------------------------------------------------------------------

/**
 * A view is the crop: how much field is in frame and how hard it is squashed.
 *
 *   scaleY      units per yard down the field
 *   anchorY     the SVG y of yard 0 — the line of scrimmage, or the spot, or
 *               whatever line the view's labels are measured from
 *   fieldTopY   the SVG y where the drawn field begins. Content-driven: it is
 *               pulled back far enough to hold the deepest official in frame,
 *               so it is not derivable from the scale.
 *   bottomYard  the last yard in frame — the end line where there's an end
 *               zone, otherwise the bottom edge of the turf
 *   goalYard    yard of the goal line, or null for views with no end zone
 *   height      viewBox height. Also content-driven: it clears the bottom notes.
 */

/** Rounds to two decimals and drops the trailing zeros, so output is stable. */
export function num(value) {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Yards across from the middle of the field (negative is left) -> SVG x. */
export function x(yardsFromCentre) {
  return CENTRE_X + yardsFromCentre * UNITS_PER_YARD_X;
}

/** Yards down the field from the view's anchor line -> SVG y. */
export function y(view, yards) {
  return view.anchorY + yards * view.scaleY;
}

/**
 * The inverses. A diagram only ever converts one way — it is handed football
 * coordinates and writes SVG — but the drawing page is handed a pointer
 * position in SVG units and has to say which yard line that is. That is the
 * same conversion read backwards, so it belongs here beside the forward pair
 * rather than being worked out again at the call site with a copy of
 * `UNITS_PER_YARD_X` and the view's `scaleY` in it.
 */
export function xToYards(svgX) {
  return (svgX - CENTRE_X) / UNITS_PER_YARD_X;
}

export function yToYards(view, svgY) {
  return (svgY - view.anchorY) / view.scaleY;
}

/** The two hash-mark x centres. */
export function hashCentresX() {
  return [x(-HASH_FROM_CENTRE_YARDS), x(HASH_FROM_CENTRE_YARDS)];
}

/** The two upright x positions. */
export function goalPostsX() {
  const half = GOAL_POST_SPACING_YARDS / 2;
  return [x(-half), x(half)];
}

/** The yard at the top of the drawn field. Derived from `fieldTopY`. */
export function topYard(view) {
  return (view.fieldTopY - view.anchorY) / view.scaleY;
}

/** Where the playing field ends and the end zone begins. */
export function playingFieldBottomYard(view) {
  return view.goalYard ?? view.bottomYard;
}

/**
 * The yards at which hash marks are drawn: every five yards, on a grid aligned
 * to the view's anchor line, across the range the view asks for.
 *
 * A view may narrow the range with `hashFrom` / `hashTo`; without them the
 * marks run the length of the playing field. They never enter the end zone —
 * a real field has none there, and drawing them there reads as a longer field.
 */
export function hashYards(view) {
  const lo = Math.max(view.hashFrom ?? topYard(view), topYard(view));
  const hi = Math.min(
    view.hashTo ?? playingFieldBottomYard(view),
    playingFieldBottomYard(view),
  );
  const first = Math.ceil(lo / HASH_PITCH_YARDS) * HASH_PITCH_YARDS;
  const yards = [];
  // Guard against a view whose range is inverted or empty.
  for (let yd = first; yd <= hi + 1e-9; yd += HASH_PITCH_YARDS) yards.push(yd);
  return yards;
}
