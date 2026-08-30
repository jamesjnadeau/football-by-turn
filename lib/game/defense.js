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
import { carrier } from './state.js';
import {
  AI_INTERCEPT_MAX_SECONDS, AI_ATTACK_UNITS, AI_LEVERAGE_CUSHION,
  AI_CONTAIN_UNITS,
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
