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
 * Nickel: one lineman out, a second linebacker in. The line is the stacked
 * front's own first two entries — nose and left tackle — so the two men who
 * stay are standing exactly where they already were; only the third man
 * (d-dt2, the right tackle) is gone. The extra backer's lane follows
 * defense.js's own spacing formula for two backers (BACKER_LANE_UNITS either
 * side of the ball), the same math backerLane runs at kickoff — see the "two
 * backers split the box" test in this file for the eleven-a-side version of
 * the same spacing.
 */
const SEVEN_DEFENSE_NICKEL = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: -3, down: 4 },
  { id: 'd-lb2', role: 'LB', radius: RADIUS_MID, across: 3, down: 4 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];

/**
 * Dime: one lineman out, a third cornerback in. The line is the same two
 * survivors nickel keeps. The new corner is the third-widest defender the
 * alignment algorithm hands a man to once the front only covers the centre
 * and the left guard — it lands on the right guard, at the same depth every
 * corner plays (ALIGN_CORNER_YARDS), which is why he is standing over an
 * interior lineman rather than out on the numbers: alignDefense pairs
 * whoever is left in array order against whoever is left uncovered, widest
 * first, and by the third corner all that is left is the guard.
 */
const SEVEN_DEFENSE_DIME = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-cb3', role: 'CB', radius: RADIUS_SKILL, across: 2.5, down: 2 },
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
 * Eleven a side nickel: one lineman out (d-de2, the right end — the front's
 * last array entry), a third linebacker in. The surviving four linemen are
 * the stacked front's own first four entries, unmoved. Three backers split
 * BACKER_LANE_UNITS lanes evenly about the ball, the same formula
 * backerLane runs live — for three men that is a full lane either side of
 * the middle one, twice what two backers hold.
 */
const ELEVEN_DEFENSE_NICKEL = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-dt2', role: 'DT', radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: 'd-de1', role: 'DE', radius: RADIUS_LINE, across: -5, down: 1 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: -6, down: 4 },
  { id: 'd-lb2', role: 'LB', radius: RADIUS_MID, across: 0, down: 4 },
  { id: 'd-lb3', role: 'LB', radius: RADIUS_MID, across: 6, down: 4 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-fs', role: 'FS', radius: RADIUS_SKILL, across: -7.5, down: 2 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];

/**
 * Eleven a side dime: the same lineman out as nickel, a fourth defensive
 * back in instead of a third backer. The two backers are untouched from the
 * stacked front. The new back is the fourth man alignDefense's widest-first
 * pairing reaches once the corners and the flanker safety have theirs — he
 * lands over the tight end's side of the formation, at the corners' own
 * depth, mirroring the flanker safety (d-fs) on the opposite hash.
 */
const ELEVEN_DEFENSE_DIME = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-dt2', role: 'DT', radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: 'd-de1', role: 'DE', radius: RADIUS_LINE, across: -5, down: 1 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: -3, down: 4 },
  { id: 'd-lb2', role: 'LB', radius: RADIUS_MID, across: 3, down: 4 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-fs', role: 'FS', radius: RADIUS_SKILL, across: -7.5, down: 2 },
  { id: 'd-cb3', role: 'CB', radius: RADIUS_SKILL, across: 7.5, down: 2 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];

/**
 * The tutorial's drill formations. A handful of men on one vertical line, so a
 * beginner can see one thing happen at a time.
 *
 * They live here because this file is the only place a formation is written
 * down — but in a table of their own, not in ROSTERS, because they are not
 * football. The "every roster" tests hold real variants to claims a drill
 * cannot meet: equal sides, exactly minOnLine men on the line, an offense
 * balanced about the middle of the field, a defense alignDefense would leave
 * where it stands. Those tests guard the real game; a drill must not be the
 * reason any of them gets weakened.
 *
 * `minOnLine: 0` is not a loophole, it is the truth about a drill: there is no
 * formation rule to break, so formationFoul has nothing to say.
 */
const DRILL_OFFENSE = [
  { id: 'o-c', role: 'C', radius: RADIUS_LINE, across: 0, down: -1 },
  // Five yards off his centre rather than the three a real quarterback takes.
  // A lesson is watched, not played at speed: the extra depth buys the coach a
  // turn to read what the rush is doing before it is on top of him, and it puts
  // daylight between the two men so the snap arrow reads as an arrow.
  { id: 'o-qb', role: 'QB', radius: RADIUS_MID, across: 0, down: -6 },
];

const DRILL_DEFENSE = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: 0, down: 4 },
];

/**
 * The back stands OFF the line the other three share, six yards to the right.
 * Stacked behind the quarterback he would only ever be a lateral away, and a
 * throw straight backwards down the column is not the lesson.
 */
const DRILL_PASS_OFFENSE = [
  ...DRILL_OFFENSE,
  { id: 'o-rb', role: 'RB', radius: RADIUS_SKILL, across: 6, down: -5 },
];

export const DRILL_ROSTERS = {
  'tutorial-2v2': {
    id: 'tutorial-2v2',
    teamSize: 2,
    minOnLine: 0,
    offense: DRILL_OFFENSE,
    defense: DRILL_DEFENSE,
  },
  'tutorial-pass': {
    id: 'tutorial-pass',
    teamSize: 2,
    // The one asymmetric roster in the game: three against two. `teamSize`
    // still answers for the defense, and `offenseSize` overrides it for the
    // side that has the extra man.
    offenseSize: 3,
    minOnLine: 0,
    offense: DRILL_PASS_OFFENSE,
    defense: DRILL_DEFENSE,
  },
};

/** How many men a roster fields on each side. Every real variant fields the
 *  same number both ways and says so once, as `teamSize`; only a drill splits
 *  them. */
export function offenseSize(roster) {
  return roster.offenseSize ?? roster.teamSize;
}

export function defenseSize(roster) {
  return roster.defenseSize ?? roster.teamSize;
}

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
  '7-nickel': {
    id: '7-nickel', teamSize: 7, minOnLine: 5, offense: SEVEN_OFFENSE, defense: SEVEN_DEFENSE_NICKEL,
  },
  '7-dime': {
    id: '7-dime', teamSize: 7, minOnLine: 5, offense: SEVEN_OFFENSE, defense: SEVEN_DEFENSE_DIME,
  },
  11: {
    id: '11',
    teamSize: 11,
    // Real football, unrounded: seven of eleven on the line.
    minOnLine: 7,
    offense: ELEVEN_OFFENSE,
    defense: ELEVEN_DEFENSE,
  },
  '11-nickel': {
    id: '11-nickel', teamSize: 11, minOnLine: 7, offense: ELEVEN_OFFENSE, defense: ELEVEN_DEFENSE_NICKEL,
  },
  '11-dime': {
    id: '11-dime', teamSize: 11, minOnLine: 7, offense: ELEVEN_OFFENSE, defense: ELEVEN_DEFENSE_DIME,
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
 *
 * Drills are looked up here too, out of DRILL_ROSTERS — they are formations
 * this file owns, they are just not games.
 */
export function getRoster(id) {
  return ROSTERS[id] ?? DRILL_ROSTERS[id] ?? ROSTERS[DEFAULT_VARIANT];
}

/** How many players a side this game is being played with. */
export function teamSize(state) {
  return getRoster(state.variantId).teamSize;
}

/** How many men this game's formation rule wants on the line of scrimmage. */
export function minOnLine(state) {
  return getRoster(state.variantId).minOnLine;
}

/** The three packages a coach may sub the defense into, in cycle order. */
export const PERSONNEL_PACKAGES = ['stacked', 'nickel', 'dime'];

/**
 * Which package a variant id is currently carrying: the suffix after the
 * dash, or 'stacked' for a bare id like '7' or '11'. The inverse of
 * variantWithPersonnel, and what the personnel menu button reads to label
 * and cycle itself.
 */
export function personnelId(variantId) {
  const dash = String(variantId).indexOf('-');
  return dash === -1 ? 'stacked' : variantId.slice(dash + 1);
}

/** The bare variant id underneath any personnel suffix: '7-nickel' -> '7'. */
export function baseVariantId(variantId) {
  const dash = String(variantId).indexOf('-');
  return dash === -1 ? variantId : variantId.slice(0, dash);
}

/**
 * The variant id that fields `personnel` for whichever base game `variantId`
 * is already playing: '7-nickel' + 'dime' -> '7-dime', '11' + 'stacked' ->
 * '11'. Falls back to the bare base id if that combination has no roster —
 * the same "never hand back a name nothing was built for" rule getRoster
 * itself keeps — so an unrecognised package cannot strand the game on an id
 * nothing can look up.
 */
export function variantWithPersonnel(variantId, personnel) {
  const base = baseVariantId(variantId);
  const id = personnel === 'stacked' ? base : `${base}-${personnel}`;
  return ROSTERS[id] ? id : base;
}
