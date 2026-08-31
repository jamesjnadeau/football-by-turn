/**
 * The teams each game can field: how many a side, how many men the formation
 * rule wants on the line, and where everybody stands at the snap.
 *
 * Keyed by the same ids lib/game/variants.js gives the home screen, so the
 * string on the button a coach presses is the string this file is looked up
 * with. This is the only file that knows the shape of a formation: state.js
 * builds players from these tables, formation.js asks them how many men the
 * line needs, and app/main.js names one when it deals a game.
 *
 * Positions are in yards relative to the line of scrimmage: `across` from the
 * middle of the field (negative is left), `down` toward the team's own goal (so
 * the offense is negative and the defense positive).
 *
 * ORDER MATTERS in these arrays, and not only for rendering. formation.js's
 * alignDefense pairs the defensive line with the offense's interior IN ARRAY
 * ORDER, against an offensive line it has sorted from the ball outwards; and
 * defense.js's deepestThreat breaks ties on array order, which is what makes
 * "the deepest man is the centre" true at the snap.
 */
import { RADIUS_LINE, RADIUS_MID, RADIUS_SKILL } from './constants.js';

const SEVEN_OFFENSE = [
  { id: 'o-c', role: 'C', radius: RADIUS_LINE, across: 0, down: -1 },
  { id: 'o-lg', role: 'LG', radius: RADIUS_LINE, across: -2.5, down: -1 },
  { id: 'o-rg', role: 'RG', radius: RADIUS_LINE, across: 2.5, down: -1 },
  { id: 'o-wr1', role: 'WR', radius: RADIUS_SKILL, across: -15, down: -1 },
  { id: 'o-wr2', role: 'WR', radius: RADIUS_SKILL, across: 15, down: -1 },
  { id: 'o-qb', role: 'QB', radius: RADIUS_MID, across: 0, down: -4 },
  { id: 'o-rb', role: 'RB', radius: RADIUS_SKILL, across: 0, down: -7 },
];

const SEVEN_DEFENSE = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-dt2', role: 'DT', radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: 0, down: 4 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];

/**
 * Eleven a side. A pro-style set: five linemen and a tight end, one receiver
 * split on the line and one flanked off it, a fullback on the weak side, a
 * quarterback and a back.
 *
 * Three things here are load-bearing and must not be nudged casually:
 *
 *   - exactly SEVEN of these are within ON_LINE_YARDS of the line (the five
 *     linemen, the tight end and o-wr1), which is minOnLine exactly. o-wr2 is
 *     three yards off the ball precisely so that he is a back rather than an
 *     eighth man on it;
 *   - the x positions SUM TO ZERO, which is what puts the free safety dead in
 *     the middle when alignDefense averages them;
 *   - o-te and o-fb are RADIUS_MID rather than RADIUS_SKILL, which keeps them
 *     under defense.js's AI_THREAT_SPEED_RATIO bar. That leaves exactly three
 *     coverage threats — both receivers and the back — for exactly three man
 *     defenders, so nobody comes off the snap uncovered.
 */
const ELEVEN_OFFENSE = [
  { id: 'o-c', role: 'C', radius: RADIUS_LINE, across: 0, down: -1 },
  { id: 'o-lg', role: 'LG', radius: RADIUS_LINE, across: -2.5, down: -1 },
  { id: 'o-rg', role: 'RG', radius: RADIUS_LINE, across: 2.5, down: -1 },
  { id: 'o-lt', role: 'LT', radius: RADIUS_LINE, across: -5, down: -1 },
  { id: 'o-rt', role: 'RT', radius: RADIUS_LINE, across: 5, down: -1 },
  { id: 'o-te', role: 'TE', radius: RADIUS_MID, across: 7.5, down: -1 },
  { id: 'o-wr1', role: 'WR', radius: RADIUS_SKILL, across: -15, down: -1 },
  { id: 'o-wr2', role: 'WR', radius: RADIUS_SKILL, across: 15, down: -3 },
  { id: 'o-fb', role: 'FB', radius: RADIUS_MID, across: -7.5, down: -3 },
  { id: 'o-qb', role: 'QB', radius: RADIUS_MID, across: 0, down: -4 },
  { id: 'o-rb', role: 'RB', radius: RADIUS_SKILL, across: 0, down: -7 },
];

/**
 * The answer to it: a five-two-four. Five down, two backers, four backs with
 * the safety free over the top.
 *
 * THE LINE IS LISTED MIDDLE-OUT, not left to right, and that is not a style
 * choice: formation.js's alignDefense pairs this array in order against the
 * offense's on-the-line men sorted from the ball outwards, which comes out
 * [C, LG, RG, LT, RT]. Reorder this array and the defense stops aligning where
 * it is already standing.
 */
const ELEVEN_DEFENSE = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-dt2', role: 'DT', radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: 'd-de1', role: 'DE', radius: RADIUS_LINE, across: -5, down: 1 },
  { id: 'd-de2', role: 'DE', radius: RADIUS_LINE, across: 5, down: 1 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: -3, down: 4 },
  { id: 'd-lb2', role: 'LB', radius: RADIUS_MID, across: 3, down: 4 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-fs', role: 'FS', radius: RADIUS_SKILL, across: -7.5, down: 2 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];

/**
 * Which roles count as offensive linemen — the only players allowed to enter
 * a cut block (setMode, state.js). Not a formation table: every roster above
 * names these same five roles for its interior line, so one set covers every
 * variant this game deals.
 */
export const OFFENSIVE_LINE_ROLES = new Set(['C', 'LG', 'RG', 'LT', 'RT']);

export const ROSTERS = {
  7: {
    id: '7',
    teamSize: 7,
    // Real football wants seven of eleven on the line; 7/11 of a seven-man
    // team rounds to five, which is exactly what this formation shows.
    minOnLine: 5,
    offense: SEVEN_OFFENSE,
    defense: SEVEN_DEFENSE,
  },
  11: {
    id: '11',
    teamSize: 11,
    // Real football, unrounded: seven of eleven on the line.
    minOnLine: 7,
    offense: ELEVEN_OFFENSE,
    defense: ELEVEN_DEFENSE,
  },
};

/**
 * What a game is dealt from when nobody names a variant. The older game, for
 * the reason createGame gives about `ai` and `aiLevel`: the library's semantics
 * and every test written against them stay as they were, and app/main.js — here
 * meaning the home screen behind it — is what opts a coach into anything else.
 */
export const DEFAULT_VARIANT = '7';

/**
 * The named roster, or the default. An unrecognised name falls back rather than
 * throwing: the id arrives from a button's `data-variant`, and a stale one
 * should deal a playable game rather than a blank screen. (`isPlayable` in
 * variants.js is the gate that stops it getting here at all; this is the second
 * lock on the same door.)
 */
export function getRoster(id) {
  return ROSTERS[id] ?? ROSTERS[DEFAULT_VARIANT];
}

/** How many players a side this game is being played with. */
export function teamSize(state) {
  return getRoster(state.variantId).teamSize;
}

/** How many men this game's formation rule wants on the line of scrimmage. */
export function minOnLine(state) {
  return getRoster(state.variantId).minOnLine;
}
