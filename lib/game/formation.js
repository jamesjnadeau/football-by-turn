/**
 * The pre-snap rulebook: where a player may line up, whether the formation
 * he is part of is legal, and where the defense stands to answer it.
 *
 * Everything here is PURE — it reads `state` and returns facts or positions.
 * state.js's placePlayer is what writes a spot; app/main.js is what decides
 * when to ask.
 *
 * Positions are read off the FIELD, not off role names, the same way
 * defense.js reads them: "on the line" is a depth, not a role, so a formation
 * this file has never heard of still gets judged.
 */
import { defendDir, losY, positionGroup, deepMan } from './defense.js';
import { getPlayer, ballPos } from './state.js';
import { dist } from './vec.js';
import { yardsOfY, fieldPos } from './view.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT, CENTRE_X } from '../field/geometry.js';
import {
  ON_LINE_YARDS, MIN_ON_LINE, ALIGN_LINE_YARDS, ALIGN_CORNER_YARDS,
  ALIGN_BACKER_YARDS, ALIGN_DEEP_YARDS, ALIGN_NUDGE_UNITS, ALIGN_NUDGE_STEPS,
} from './constants.js';

/**
 * Whether anyone may be repositioned at all: a formation is what you come to
 * the line with, so it may be changed right up to the snap and not after. The
 * same gate play.js's canUsePlays uses, and for the same reason.
 */
export function canReposition(state) {
  return state.phase === 'planning' && state.turnIndex === 0;
}

/**
 * Move a player to `pos`, or refuse. The one writer in this file — everything
 * else here reads — and it lives here rather than in state.js so that state.js
 * stays what it is, the layer every other module reads from and none of them
 * has to be imported by.
 *
 * A caller who wants to TELL the coach why a spot was refused asks spotFault
 * itself; the answer here is the yes or no.
 */
export function placePlayer(state, id, pos) {
  if (!canReposition(state)) return false;
  if (spotFault(state, id, pos) !== null) return false;
  const p = getPlayer(state, id);
  p.pos = pos;
  // Whatever he had been told to do was worked out from where he was
  // standing — a destination is an absolute spot on the field, not an offset —
  // so moving him makes the order a lie. He comes to his new spot with nothing
  // drawn on him, which is also what the coach sees.
  p.plan = null;
  p.cover = null;
  return true;
}

/**
 * Why `pos` is not a spot this player may line up on, or null if it is one.
 *
 * Three refusals, and they are all things that cannot physically be true
 * rather than things a referee would flag: you may not line up past the line
 * of scrimmage, you may not stand outside the sideline, and you may not stand
 * inside another player. A formation that merely breaks a COUNTING rule is
 * legal to attempt and gets a flag instead — see formationFoul.
 */
export function spotFault(state, id, pos) {
  const player = getPlayer(state, id);
  const dir = defendDir(player.team);
  const past = dir > 0 ? pos.y < losY(state) : pos.y > losY(state);
  if (past) return 'past-line';
  if (pos.x - player.radius < SIDELINE_LEFT) return 'out-of-bounds';
  if (pos.x + player.radius > SIDELINE_RIGHT) return 'out-of-bounds';
  for (const other of state.players) {
    if (other.id === id) continue;
    if (dist(other.pos, pos) < other.radius + player.radius) return 'occupied';
  }
  return null;
}

/**
 * Whether this player is lining up ON the line of scrimmage. A depth, not a
 * role: a receiver split fifteen yards wide is on the line if he is level
 * with it, and a lineman who has backed off it is not.
 *
 * There is no third category. Anyone this returns false for is a back, which
 * is what makes lineCount alone enough to judge a formation.
 */
export function onTheLine(state, player) {
  return Math.abs(yardsOfY(player.pos.y) - state.losYard) <= ON_LINE_YARDS;
}

/** How many of `team` are on the line of scrimmage. */
export function lineCount(state, team) {
  return state.players.filter((p) => p.team === team && onTheLine(state, p)).length;
}

/**
 * The flag this formation has earned, or null.
 *
 * Only the offense is judged: the defense may align however it likes, which is
 * true of real football and is also what lets alignDefense put its front
 * wherever the offense's front makes it want to stand.
 *
 * Unlike spotFault this is not a refusal. A coach is allowed to break the
 * huddle in an illegal formation and find out about it afterwards, exactly as
 * he is allowed to throw an illegal forward pass — turn.js is what sets the
 * flag, and rules.js's nextDown is what enforces it.
 */
export function formationFoul(state) {
  return lineCount(state, 'offense') < MIN_ON_LINE ? 'illegal-formation' : null;
}

/** Where along the field a spot `yards` off the line, on `team`'s side, sits. */
function offLine(state, team, yards) {
  return fieldPos(0, state.losYard + defendDir(team) * yards).y;
}

/** Hold an x inside the sidelines for a body of this radius. */
function inbounds(x, radius) {
  return Math.max(SIDELINE_LEFT + radius, Math.min(SIDELINE_RIGHT - radius, x));
}

/**
 * The nearest x to `want` at depth `y` where a body of this radius fits clear
 * of everyone in `placed`.
 *
 * Searched outward a nudge at a time, right before left at equal distance, and
 * the first clear spot wins. Scanning rather than shoving is what makes this
 * terminate: pushing a man off whoever he lands on can shove him onto somebody
 * else and back again forever, which is exactly what a linebacker squeezed
 * between two of his own linemen used to do.
 */
function clearX(placed, want, y, radius) {
  for (let k = 0; k <= ALIGN_NUDGE_STEPS; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const x = inbounds(want + sign * k * ALIGN_NUDGE_UNITS, radius);
      const clash = placed.some((q) => dist(q.pos, { x, y }) < q.radius + radius);
      if (!clash) return x;
    }
  }
  return inbounds(want, radius); // a field this crowded cannot happen with two teams
}

/**
 * Where the defense stands to answer the formation the offense is showing.
 *
 * Each defender's spot comes from his job and from where the offense actually
 * is, never from a role name or a stored formation — the same way defense.js
 * derives its in-play orders, so an offense this file has never seen still
 * gets covered:
 *
 *   - the FRONT goes head-up on the interior of the offensive line: as many of
 *     the offense's on-the-line men as there are defensive linemen, taken from
 *     the middle of the formation outwards;
 *   - the LAST MAN BACK (deepMan, so the same player defense.js will play as
 *     the free man) aligns deepest of anyone, over the middle of the offense;
 *   - the other BACKS take the widest offensive men left over, at a cushion —
 *     which is what makes a receiver split wide drag his corner across;
 *   - the BACKER, and anyone else, mirrors the ball at the depth defense.js
 *     already holds him at, so the alignment and the first turn agree.
 *
 * Pure: it returns spots and moves nobody. Every spot it returns is inbounds
 * and clear of the men already placed, so nothing it hands back is something
 * spotFault would refuse.
 */
export function alignDefense(state, team = 'defense') {
  const them = state.players.filter((p) => p.team !== team);
  const mine = state.players.filter((p) => p.team === team);
  if (!them.length) return [];

  const ball = ballPos(state) ?? { x: CENTRE_X, y: losY(state) };
  const middle = them.reduce((sum, p) => sum + p.pos.x, 0) / them.length;

  // The offense's front, innermost first, and everyone else widest first:
  // between them, an ordering of every opponent by how central he is.
  const onLine = them.filter((p) => onTheLine(state, p))
    .sort((a, b) => Math.abs(a.pos.x - ball.x) - Math.abs(b.pos.x - ball.x)
      || a.id.localeCompare(b.id));
  const front = mine.filter((p) => positionGroup(p) === 'line');
  const covered = new Set(onLine.slice(0, front.length).map((p) => p.id));
  const wide = them.filter((p) => !covered.has(p.id))
    .sort((a, b) => Math.abs(b.pos.x - ball.x) - Math.abs(a.pos.x - ball.x)
      || a.id.localeCompare(b.id));

  const free = deepMan(state, team);
  const backs = mine.filter((p) => positionGroup(p) === 'back' && p.id !== free?.id);

  // Ordered so that pairing a defender with an opponent is a matter of taking
  // the next one off each list: the front takes the interior in order, the
  // corners take the widest in order.
  const aim = new Map();
  front.forEach((d, i) => {
    const o = onLine[i] ?? onLine[onLine.length - 1];
    aim.set(d.id, { x: o ? o.pos.x : ball.x, y: offLine(state, team, ALIGN_LINE_YARDS) });
  });
  backs.forEach((d, i) => {
    const o = wide[i];
    aim.set(d.id, { x: o ? o.pos.x : ball.x, y: offLine(state, team, ALIGN_CORNER_YARDS) });
  });
  if (free) {
    aim.set(free.id, { x: middle, y: offLine(state, team, ALIGN_DEEP_YARDS) });
  }
  for (const d of mine) {
    if (aim.has(d.id)) continue;
    aim.set(d.id, { x: ball.x, y: offLine(state, team, ALIGN_BACKER_YARDS) });
  }

  // Placed in formation order, each man moved across the field until he is
  // clear of everyone — his own team as it goes down, and the offense he is
  // lining up against, which is already standing there. Nothing here may hand
  // back a spot spotFault would refuse: two receivers stacked on a sideline
  // would otherwise stack their coverage on top of each other.
  const placed = them.map((p) => ({ radius: p.radius, pos: p.pos }));
  const spots = [];
  for (const d of mine) {
    const want = aim.get(d.id);
    const x = clearX(placed, want.x, want.y, d.radius);
    const pos = { x, y: want.y };
    placed.push({ radius: d.radius, pos });
    spots.push({ id: d.id, pos });
  }
  return spots;
}
