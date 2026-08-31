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
import {
  defendDir, losY, positionGroup, deepMan, backerLane,
} from './defense.js';
import {
  getPlayer, ballPos, aimSnap, defensePlayers,
} from './state.js';
import { dist } from './vec.js';
import { yardsOfY, fieldPos } from './view.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT, CENTRE_X, hashCentresX } from '../field/geometry.js';
import {
  ON_LINE_YARDS, ALIGN_LINE_YARDS, ALIGN_CORNER_YARDS,
  ALIGN_BACKER_YARDS, ALIGN_DEEP_YARDS, ALIGN_NUDGE_UNITS, ALIGN_NUDGE_STEPS,
} from './constants.js';
import { minOnLine, variantWithPersonnel } from './rosters.js';

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
  // The snap is aimed from where the two men stand, so moving either of them
  // makes the old aim wrong. Re-aiming here rather than at the call site means
  // it cannot be forgotten -- and aimSnap leaves a throw the coach set himself
  // alone, so this only ever corrects its own work.
  aimSnap(state);
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
  const others = state.players.filter((p) => p.id !== id);
  return spotFaultAmong(state, player, pos, others);
}

/**
 * The same judgement as spotFault, against a given set of bodies rather than
 * the field itself. spotFault is the every-day, one-man-against-the-field
 * shape; placeFormation needs to judge a candidate against an arrangement
 * that is still being built, so the occupancy check takes its bodies as an
 * argument instead of reading state.players.
 */
function spotFaultAmong(state, player, pos, others) {
  const dir = defendDir(player.team);
  const past = dir > 0 ? pos.y < losY(state) : pos.y > losY(state);
  if (past) return 'past-line';
  if (pos.x - player.radius < SIDELINE_LEFT) return 'out-of-bounds';
  if (pos.x + player.radius > SIDELINE_RIGHT) return 'out-of-bounds';
  // The ball is spotted between the hash marks, so the man who is going to
  // snap it has to stand between them too. Judged on his centre and not his
  // body: the rule is about where the BALL is, and the ball rides at his
  // middle until he lets go of it. Read off who is holding the ball rather
  // than off a role name, like everything else in this file -- the snapper is
  // whoever has it when the down starts.
  if (player.id === state.ball.carrierId) {
    const [hashLeft, hashRight] = hashCentresX();
    if (pos.x < hashLeft || pos.x > hashRight) return 'outside-hashes';
  }
  for (const other of others) {
    if (other.id === player.id) continue;
    if (dist(other.pos, pos) < other.radius + player.radius) return 'occupied';
  }
  return null;
}

/**
 * Seat a whole formation at once, and say who could not be seated.
 *
 * `placePlayer` judges one man against the field as it stands, which is right
 * for a drag and wrong for a saved formation: two men who swapped spots would
 * each land on the other and both moves would be refused. This judges the
 * ARRANGEMENT — every candidate against where everyone will actually end up —
 * so a permutation seats, and only a spot that is genuinely impossible skips.
 *
 * Requests are taken in order, and a man whose spot was refused stays where he
 * is and is back in the way of the men behind him. That is what makes one pass
 * enough: no accepted spot is ever invalidated by a later decision, so the
 * layout this returns never has two men standing inside each other.
 */
export function placeFormation(state, spots) {
  const applied = [];
  const skipped = [];
  if (!canReposition(state)) return { applied, skipped: spots.map((s) => s.id) };

  // The layout being judged against: everyone's position as it will stand.
  // A man about to move is taken out of it, and goes back in — at his new spot
  // or his old one — the moment his request is decided.
  const moving = new Set(spots.map((s) => s.id));
  const layout = state.players
    .filter((p) => !moving.has(p.id))
    .map((p) => ({ id: p.id, radius: p.radius, pos: p.pos }));

  for (const { id, pos } of spots) {
    const p = state.players.find((pl) => pl.id === id);
    if (!p) { skipped.push(id); continue; }
    const fault = spotFaultAmong(state, p, pos, layout);
    if (fault !== null) {
      skipped.push(id);
      layout.push({ id: p.id, radius: p.radius, pos: p.pos }); // he stays, and is in the way
      continue;
    }
    p.pos = pos;
    // The order he was given was worked out from where he was standing, so it
    // is a lie now — the same rule placePlayer keeps for a single drag.
    p.plan = null;
    p.cover = null;
    layout.push({ id: p.id, radius: p.radius, pos });
    applied.push(id);
  }
  // Once, at the end: the snap is aimed off two men who may both have moved.
  aimSnap(state);
  return { applied, skipped };
}

/**
 * Swap the defense onto a different personnel package — stacked, nickel, or
 * dime — for whatever down is currently being planned. Only the defense is
 * rebuilt: the offense keeps every spot the coach has already dragged it to,
 * which a fresh formationPlayers() call would otherwise throw away, because
 * that function reseats both sides from their roster defaults at once.
 *
 * Gated the same way placePlayer is, and for the same reason: personnel is
 * something you come to the line with, not something you change once the
 * ball is live.
 */
export function setPersonnel(state, personnel) {
  if (!canReposition(state)) return false;
  const variantId = variantWithPersonnel(state.variantId, personnel);
  state.variantId = variantId;
  state.players = [
    ...state.players.filter((p) => p.team === 'offense'),
    ...defensePlayers(state.losYard, variantId),
  ];
  return true;
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
  return lineCount(state, 'offense') < minOnLine(state) ? 'illegal-formation' : null;
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
  // Backers share the middle of the field rather than stacking on the ball —
  // the same lanes defense.js's flowLinebacker keeps during the play, so what
  // the coach lines up against is what he will be playing against. A defense
  // with one backer gets a lane of zero and lands on the ball, which is exactly
  // where the catch-all below used to put him.
  for (const d of mine.filter((p) => positionGroup(p) === 'backer')) {
    aim.set(d.id, {
      x: ball.x + backerLane(state, d),
      y: offLine(state, team, ALIGN_BACKER_YARDS),
    });
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
