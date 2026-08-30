/**
 * Assignment defense: the computer's second brain (`state.aiLevel === 'smart'`).
 *
 * Where ai.js's pursuit brain sends everyone at the ball, this one gives each
 * defender a job derived from where he is standing. Three functions do the
 * work, one per position — rushLineman, flowLinebacker, coverBack — and
 * smartOrder picks between them.
 *
 * Everything here is PURE: it reads `state` and returns orders. ai.js is the
 * only thing that writes them, which is what keeps the computer's plans out of
 * the state (and so off the screen) until the turn actually runs.
 *
 * Positions are read off the FIELD, not off role names. The contain side of a
 * lineman comes from where his own line is standing; the deep man is whoever is
 * aligned deepest; a "receiver" is anyone who can run with a defensive back.
 * A four-man front, an unbalanced one, or a role this file has never heard of
 * all still get coached.
 */
import { fieldPos } from './view.js';
import { add, sub, scale, dot, len, dist } from './vec.js';
import { maxSpeed } from './modes.js';
import { carrier, ballPos } from './state.js';
import {
  AI_INTERCEPT_MAX_SECONDS, AI_ATTACK_UNITS, AI_LEVERAGE_CUSHION,
  AI_CONTAIN_UNITS, AI_BACKER_DEPTH_UNITS, AI_BACKER_TRIGGER_UNITS,
  AI_DEEP_CUSHION_UNITS, AI_THREAT_SPEED_RATIO,
} from './constants.js';

/**
 * Role → position. Written as a table rather than as a test on the role string
 * so adding an end or a nickel back is one line here. Anything unlisted is
 * coached as a linebacker: the generalist's job — flow to the ball with
 * leverage — is the least wrong thing to do with a player you cannot place.
 */
const GROUPS = {
  NT: 'line', DT: 'line', DE: 'line',
  LB: 'backer', MLB: 'backer', OLB: 'backer',
  CB: 'back', S: 'back', FS: 'back', SS: 'back',
};

export function positionGroup(player) {
  return GROUPS[player.role] ?? 'backer';
}

/**
 * Which way along y this team's goal lies — the direction it is defending, and
 * so the direction "goal side" and "deep" mean for every function below. The
 * offense drives at +y (view.js: the goal line is yard 10, the backfield is
 * negative), so the defense protects +y and the offense protects -y.
 */
export function defendDir(team) {
  return team === 'offense' ? -1 : 1;
}

/** The line of scrimmage in SVG y. */
export function losY(state) {
  return fieldPos(0, state.losYard).y;
}

/** Whether `point` has got past the line, from `team`'s point of view. */
export function pastLine(state, team, point) {
  const dir = defendDir(team);
  return dir > 0 ? point.y > losY(state) : point.y < losY(state);
}

/**
 * The teammates playing the same position as `player`, himself included, in
 * `state.players` order. Contain assignments are shared out among these, so
 * this is what makes "the left edge rusher" a fact about the front rather than
 * a fact about an id.
 */
export function groupMates(state, player) {
  const group = positionGroup(player);
  return state.players.filter(
    (p) => p.team === player.team && positionGroup(p) === group,
  );
}

/**
 * Where `pursuer` should run to meet `target`: the point on the target's
 * current path that both of them reach at the same instant.
 *
 * Solve |d + v.t| = s.t for the earliest positive t, where d is the offset to
 * the target, v his velocity and s the pursuer's top speed. Squaring gives
 * (|v|^2 - s^2).t^2 + 2(d.v).t + |d|^2 = 0, an ordinary quadratic. The linear
 * case (a target running at exactly the pursuer's speed) is solved separately,
 * because dividing by a zero leading coefficient is not a rounding error.
 *
 * A target who is faster and running away has no solution at all: no root is
 * positive, and there is no angle that catches him. Then — and only then — this
 * degrades to the pursuit brain's answer, a lead over the time it takes to
 * cover the gap as it stands, which is the best available "close the distance"
 * heading. Either way the lead time is capped, so one breakaway cannot fling a
 * defender off the field.
 */
export function interceptPoint(pursuer, target) {
  const s = maxSpeed(pursuer);
  const d = sub(target.pos, pursuer.pos);
  const v = target.vel;
  const a = dot(v, v) - s * s;
  const b = 2 * dot(d, v);
  const c = dot(d, d);

  let t = null;
  if (Math.abs(a) < 1e-9) {
    if (b < 0) t = -c / b; // b >= 0 means he is not closing: no meeting point
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const roots = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((r) => r > 0);
      if (roots.length) t = Math.min(...roots);
    }
  }
  if (t === null) t = len(d) / s;
  return add(target.pos, scale(v, Math.min(t, AI_INTERCEPT_MAX_SECONDS)));
}

/**
 * Hold an aim point on the goal side of the man being chased.
 *
 * A pursuit angle that runs level with the carrier is an angle he runs straight
 * through: by the time the defender arrives the carrier is a body-width past
 * the spot. So while a defender is still closing, his aim is pushed at least
 * AI_LEVERAGE_CUSHION toward the goal he is defending — he takes the angle
 * that arrives in front.
 *
 * Inside AI_ATTACK_UNITS this stops: at contact range, keeping a cushion means
 * never making the tackle. Leverage is how you get there, not what you do when
 * you arrive.
 *
 * Only the goal-ward component is touched. Across the field the aim is
 * whatever the caller worked out, which is what lets rushLineman layer contain
 * on top of this without the two fighting each other.
 */
export function leverageAim(defender, aim, target) {
  if (dist(defender.pos, target.pos) <= AI_ATTACK_UNITS) return aim;
  const dir = defendDir(defender.team);
  const floor = target.pos.y + dir * AI_LEVERAGE_CUSHION;
  return { x: aim.x, y: dir > 0 ? Math.max(aim.y, floor) : Math.min(aim.y, floor) };
}

/**
 * Which edge of the front this lineman is responsible for: -1 for the left,
 * +1 for the right, 0 for whoever is nearest the middle of it.
 *
 * Derived from where his own line is actually standing, not from a role name,
 * so a four-man front, an unbalanced one, or a line that has drifted during the
 * play still yields exactly one containing rusher on each edge and one man free
 * up the middle. The middle man is whoever is closest to the midpoint of the
 * front's own span, with ties going to the earlier man in formation order —
 * deterministic, because nothing the computer decides may depend on iteration
 * luck.
 */
export function containSide(state, player) {
  const line = groupMates(state, player);
  const xs = line.map((p) => p.pos.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const middle = line.reduce((a, b) =>
    Math.abs(b.pos.x - mid) < Math.abs(a.pos.x - mid) ? b : a);
  if (middle.id === player.id) return 0;
  return player.pos.x < mid ? -1 : 1;
}

/**
 * A lineman rushes the ball — and the edge rushers never let it outside them.
 *
 * The old brain sent all three linemen at one point, which is why a carrier who
 * simply stepped around the pile was gone. Here each edge rusher's aim is held
 * at least AI_CONTAIN_UNITS to his own side of the carrier, so the pocket has
 * walls: the middle is the free rusher's, and both edges cost the carrier a
 * change of direction.
 *
 * Contain, like leverage, is for the approach. Inside AI_ATTACK_UNITS he takes
 * the shortest line to the man and hits him.
 *
 * Requires an opposing carrier — smartOrder is what guarantees one.
 */
export function rushLineman(state, player) {
  const car = carrier(state);
  const aim = leverageAim(player, interceptPoint(player, car), car);
  if (dist(player.pos, car.pos) <= AI_ATTACK_UNITS) return { aim, cover: null };
  const side = containSide(state, player);
  if (side === 0) return { aim, cover: null };
  const edge = car.pos.x + side * AI_CONTAIN_UNITS;
  const x = side < 0 ? Math.min(aim.x, edge) : Math.max(aim.x, edge);
  return { aim: { x, y: aim.y }, cover: null };
}

/**
 * A linebacker reads before he runs.
 *
 * The pursuit brain sends him at the ball wherever it is, which on any handoff
 * or cutback means he has vacated the middle of the field before the run has
 * even started. Instead, while the carrier is still deep in the backfield, he
 * MIRRORS: he holds AI_BACKER_DEPTH_UNITS on his own side of the line and
 * matches the ball across the field, so whichever way the run declares he is
 * already square to it and downhill of nobody.
 *
 * The lateral half of the mirror is the leveraged intercept's x, so he leads
 * the ball across rather than trailing it — a mirror that is one turn late is
 * not a mirror.
 *
 * Once the carrier is inside AI_BACKER_TRIGGER_UNITS of the line he FILLS:
 * straight to the pursuit angle, cushion and all. (A carrier who is already
 * past the line never reaches this function at all — smartOrder converges the
 * whole defense before dispatching.)
 *
 * Requires an opposing carrier — smartOrder is what guarantees one.
 */
export function flowLinebacker(state, player) {
  const car = carrier(state);
  const aim = leverageAim(player, interceptPoint(player, car), car);
  const dir = defendDir(player.team);
  const gap = (car.pos.y - losY(state)) * dir; // negative while he is behind it
  if (gap >= -AI_BACKER_TRIGGER_UNITS) return { aim, cover: null };
  return { aim: { x: aim.x, y: losY(state) + dir * AI_BACKER_DEPTH_UNITS }, cover: null };
}

/** How deep along the defended direction a point is. Bigger is nearer the goal. */
function depth(team, point) {
  return point.y * defendDir(team);
}

/**
 * The opponent who has got nearest the goal this team is defending — the man
 * the free defender has to stay on top of. Ties go to the earlier man in
 * formation order, which matters only at the snap, when a whole offensive line
 * is level.
 */
export function deepestThreat(state, team) {
  const them = state.players.filter((p) => p.team !== team);
  if (!them.length) return null;
  return them.reduce((a, b) => (depth(team, b.pos) > depth(team, a.pos) ? b : a));
}

/**
 * The last man back: whichever defensive back is aligned deepest. Read off the
 * field rather than off the role name, so a corner who has dropped behind the
 * safety inherits the job — and a secondary of any size still leaves exactly
 * one man free.
 */
export function deepMan(state, team) {
  const backs = state.players.filter(
    (p) => p.team === team && positionGroup(p) === 'back',
  );
  if (!backs.length) return null;
  return backs.reduce((a, b) => (depth(team, b.pos) > depth(team, a.pos) ? b : a));
}

/**
 * Where the free defender plays: on top of both the deepest receiver and the
 * ball, splitting the difference between them across the field.
 *
 * His whole job is that nothing gets behind him, so his depth is a cushion past
 * whichever of the two is deeper — never an average, which would let a receiver
 * running past him drag him only halfway.
 */
export function deepAim(state, player) {
  const dir = defendDir(player.team);
  const threat = deepestThreat(state, player.team);
  const bp = ballPos(state);
  const anchor = threat ? threat.pos : bp;
  const back = dir > 0 ? Math.max(anchor.y, bp.y) : Math.min(anchor.y, bp.y);
  return { x: (anchor.x + bp.x) / 2, y: back + dir * AI_DEEP_CUSHION_UNITS };
}

/**
 * Who has whom. Every defensive back except the free man takes one opposing
 * receiver, closest pair first.
 *
 * Pairs are sorted by distance and claimed greedily, which is what stops both
 * corners chasing the same man and stops either of them crossing the formation
 * to take one. Ties break on ids, so the assignment is a function of the
 * position of the players and nothing else — no iteration luck, no dice.
 *
 * A "receiver" is anyone the covering back cannot comfortably outrun (see
 * AI_THREAT_SPEED_RATIO). The carrier is never covered — he is tackled, which
 * is somebody else's assignment.
 */
export function coverAssignments(state, team) {
  const car = carrier(state);
  const free = deepMan(state, team);
  const takers = state.players.filter(
    (p) => p.team === team && positionGroup(p) === 'back' && p.id !== free?.id,
  );
  const them = state.players.filter((p) => p.team !== team && p.id !== car?.id);

  const pairs = [];
  for (const d of takers) {
    for (const r of them) {
      if (maxSpeed(r) < maxSpeed(d) * AI_THREAT_SPEED_RATIO) continue;
      pairs.push({ d: d.id, r: r.id, gap: dist(d.pos, r.pos) });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || a.d.localeCompare(b.d) || a.r.localeCompare(b.r));

  const map = new Map();
  const claimed = new Set();
  for (const { d, r } of pairs) {
    if (map.has(d) || claimed.has(r)) continue;
    map.set(d, r);
    claimed.add(r);
  }
  return map;
}

/**
 * A defensive back covers his man, or plays help if he has not got one.
 *
 * The cover order is the real thing — the same `state.cover` a human issues by
 * dragging one of his players onto one of yours — so cover.js re-aims it every
 * sub-step and it is worth the same mass and grab reach. A receiver who cuts
 * mid-turn is therefore covered, not left behind, which the pursuit brain's
 * once-a-turn arrow could never manage.
 *
 * The free man, and anyone with nobody worth covering, plays deepAim instead.
 */
export function coverBack(state, player) {
  const assigned = coverAssignments(state, player.team).get(player.id);
  if (assigned) return { aim: null, cover: assigned };
  return { aim: deepAim(state, player), cover: null };
}

/** An order that means "nothing to do": the caller leaves him as he is. */
const NO_ORDER = { aim: null, cover: null };

/**
 * One player's job this turn.
 *
 * Assignments are what you play BEFORE the play breaks. Three things end them,
 * and they are checked in this order:
 *
 *   1. No ball to defend at all — nothing to do.
 *   2. A loose ball is a footrace: everybody sprints at it, exactly as the
 *      pursuit brain does, because possession beats every assignment there is.
 *   3. The carrier is past the line, or on this player's own team: assignments
 *      are over and the whole defense converges on the ball with leverage.
 *      Nobody stays in coverage while a man runs at the goal line.
 *
 * Only when none of those hold does he play his position.
 */
export function smartOrder(state, player) {
  const bp = ballPos(state);
  if (!bp) return NO_ORDER;
  const car = carrier(state);
  if (!car) return { aim: { ...bp }, cover: null };
  if (car.team === player.team) return { aim: { ...bp }, cover: null };
  if (pastLine(state, player.team, car.pos)) {
    return { aim: leverageAim(player, interceptPoint(player, car), car), cover: null };
  }
  switch (positionGroup(player)) {
    case 'line': return rushLineman(state, player);
    case 'back': return coverBack(state, player);
    default: return flowLinebacker(state, player);
  }
}

/**
 * Every order for one team, in formation order. Pure — nothing in `state`
 * moves, which is what lets ai.js decide when (and whether) to apply them, the
 * same contract defensePlans keeps.
 */
export function smartOrders(state, team) {
  return state.players
    .filter((p) => p.team === team)
    .map((p) => ({ id: p.id, ...smartOrder(state, p) }))
    .filter((o) => o.aim !== null || o.cover !== null);
}
