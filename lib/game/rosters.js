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
