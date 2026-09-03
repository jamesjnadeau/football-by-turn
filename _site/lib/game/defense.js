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
  AI_DEEP_CUSHION_UNITS, AI_THREAT_SPEED_RATIO, BACKER_LANE_UNITS,
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
 * This player's group mates, left to right across the field, ties on id.
 *
 * Ordering by POSITION rather than by formation order is what makes a lane or a
 * contain assignment a fact about where a man is standing: two linebackers who
 * cross during a play swap lanes rather than running back across each other to
 * reclaim the one their id was born with.
 */
export function orderedMates(state, player) {
  return groupMates(state, player)
    .slice()
    .sort((a, b) => a.pos.x - b.pos.x || a.id.localeCompare(b.id));
}

/**
 * How far off the ball this backer holds himself, across the field.
 *
 * Backers spread evenly about the ball, BACKER_LANE_UNITS apart, in the order
 * they are standing in. One backer gets zero — he IS the middle — so a defense
 * with a single linebacker mirrors the ball exactly as it always has.
 */
export function backerLane(state, player) {
  const mates = orderedMates(state, player);
  const i = mates.findIndex((p) => p.id === player.id);
  return (i - (mates.length - 1) / 2) * BACKER_LANE_UNITS;
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
 * How far out on the front this lineman is playing: 0 for the man nearest the
 * middle, then -1, -2 … to his left and +1, +2 … to his right.
 *
 * A rank rather than a side, because contain is a distance and not only a
 * direction: on a five-man front the ends have to hold a wider edge than the
 * tackles inside them, or all four would manage the same yard of grass and
 * leave the same gap. rushLineman multiplies this by AI_CONTAIN_UNITS to get
 * the edge each man keeps, so a three-man front's -1/0/+1 is exactly the six
 * units either side it always kept.
 *
 * Derived from where his own line is actually standing, not from a role name,
 * so a four-man front, an unbalanced one, or a line that has drifted during the
 * play still yields exactly one man free up the middle. The middle man is
 * whoever is closest to the midpoint of the front's own span, ties going to the
 * man further left and then to the earlier id — deterministic, because nothing
 * the computer decides may depend on iteration luck.
 */
export function containRank(state, player) {
  const line = orderedMates(state, player);
  const xs = line.map((p) => p.pos.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const middle = line.reduce((a, b) =>
    Math.abs(b.pos.x - mid) < Math.abs(a.pos.x - mid) ? b : a);
  return line.findIndex((p) => p.id === player.id)
    - line.findIndex((p) => p.id === middle.id);
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
  const rank = containRank(state, player);
  if (rank === 0) return { aim, cover: null };
  const edge = car.pos.x + rank * AI_CONTAIN_UNITS;
  const x = rank < 0 ? Math.min(aim.x, edge) : Math.max(aim.x, edge);
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
  // The lane belongs to the mirror and not to the FILL above it: waiting is
  // when a box has to be shared, and arriving at the ball is not.
  const lane = backerLane(state, player);
  return {
    aim: { x: aim.x + lane, y: losY(state) + dir * AI_BACKER_DEPTH_UNITS },
    cover: null,
  };
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
 * The deepest opponent nobody has a real cover on — what the free defender
 * actually needs to shade toward, as opposed to whoever merely stands
 * deepest regardless of coverage.
 *
 * "Covered" here means a dedicated back has him (see assignCoverage). A
 * linebacker pulled in as a last resort does not count: that assignment
 * exists because nobody better was available, not because the matchup is
 * safe, so the free man keeps leaning that way too rather than trusting it.
 * Restricted to genuine receiver-threats (assignCoverage's `threats`), so a
 * slow lineman standing near the goal line never masquerades as an open
 * receiver just for lacking a defender's name next to his.
 *
 * Null when every real threat already has a dedicated back — deepAim's cue
 * to fall back to the deepest opponent overall, exactly as before.
 */
export function deepestOpenThreat(state, team) {
  const { them, threats, dedicated } = assignCoverage(state, team);
  const open = them.filter((r) => threats.has(r.id) && !dedicated.has(r.id));
  if (!open.length) return null;
  return open.reduce((a, b) => (depth(team, b.pos) > depth(team, a.pos) ? b : a));
}

/**
 * Where the free defender plays: on top of both the deepest receiver and the
 * ball, splitting the difference between them across the field.
 *
 * His whole job is that nothing gets behind him, so his depth is a cushion past
 * whichever of the two is deeper — never an average, which would let a receiver
 * running past him drag him only halfway.
 *
 * The anchor prefers whoever coverAssignments left genuinely open
 * (deepestOpenThreat) over the deepest opponent overall: a receiver nobody
 * has is the one who can get behind everybody, regardless of whether some
 * other, already-covered man happens to be standing deeper right now.
 */
export function deepAim(state, player) {
  const dir = defendDir(player.team);
  const threat = deepestOpenThreat(state, player.team) ?? deepestThreat(state, player.team);
  const bp = ballPos(state);
  const anchor = threat ? threat.pos : bp;
  const back = dir > 0 ? Math.max(anchor.y, bp.y) : Math.min(anchor.y, bp.y);
  return { x: (anchor.x + bp.x) / 2, y: back + dir * AI_DEEP_CUSHION_UNITS };
}

/**
 * One greedy nearest-pair pass: `defenders` claim from `receivers` into the
 * shared `map`/`claimed`, closest gap first, nobody claiming twice and nobody
 * claimed twice. Sorted by distance and claimed greedily, which is what stops
 * both corners chasing the same man and stops either of them crossing the
 * formation to take one. Ties break on ids, so the assignment is a function
 * of the position of the players and nothing else — no iteration luck, no
 * dice.
 *
 * A "receiver" is anyone `d` cannot comfortably outrun (see
 * AI_THREAT_SPEED_RATIO) — evaluated against whichever defender is doing the
 * claiming, so the same receiver can be a threat to a back and not to a
 * slower backer, or vice versa. Returns the set of receiver ids that were a
 * threat to at least one of `defenders`, which is how the caller tells "he
 * had nobody near him" apart from "he was never a threat at all".
 */
function claimNearest(map, claimed, defenders, receivers) {
  const pairs = [];
  for (const d of defenders) {
    for (const r of receivers) {
      if (maxSpeed(r) < maxSpeed(d) * AI_THREAT_SPEED_RATIO) continue;
      pairs.push({ d: d.id, r: r.id, gap: dist(d.pos, r.pos) });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || a.d.localeCompare(b.d) || a.r.localeCompare(b.r));
  for (const { d, r } of pairs) {
    if (map.has(d) || claimed.has(r)) continue;
    map.set(d, r);
    claimed.add(r);
  }
  return new Set(pairs.map((p) => p.r));
}

/**
 * Who has whom, and the bookkeeping deepAim needs to shade toward whoever is
 * actually left open: `them` (every opposing player who could be covered),
 * `threats` (which of them are real coverage threats to a dedicated back at
 * all) and `dedicated` (which of THOSE a dedicated back — not a backer
 * called in to help — actually has).
 *
 * Every defensive back except the free man takes one opposing receiver,
 * closest pair first. The carrier is never covered — he is tackled, which is
 * somebody else's assignment.
 *
 * Two backs cannot always reach every real threat — bunch two receivers onto
 * one side and the pass above burns both corners there, leaving whoever is
 * alone on the other side of the field with nobody near him at all. A backer
 * (LB/MLB/OLB) is the only body left once the dedicated backs are spoken for,
 * so — only once every back already has his own man, and only against
 * receivers a back would have covered in the first place — he runs the same
 * kind of greedy pass a second time against whatever is still unclaimed. His
 * own (often slower) speed still has to clear AI_THREAT_SPEED_RATIO against
 * each one, so a linebacker who cannot live with a genuine burner leaves him
 * be rather than pretending to help.
 */
function assignCoverage(state, team) {
  const car = carrier(state);
  const free = deepMan(state, team);
  const takers = state.players.filter(
    (p) => p.team === team && positionGroup(p) === 'back' && p.id !== free?.id,
  );
  const them = state.players.filter((p) => p.team !== team && p.id !== car?.id);

  const map = new Map();
  const claimed = new Set();
  const threats = claimNearest(map, claimed, takers, them);
  const dedicated = new Set(claimed);

  const leftover = them.filter((r) => threats.has(r.id) && !claimed.has(r.id));
  if (leftover.length) {
    const backers = state.players.filter((p) => p.team === team && positionGroup(p) === 'backer');
    claimNearest(map, claimed, backers, leftover);
  }
  return { map, them, threats, dedicated };
}

/** Who has whom — see assignCoverage. The map coverBack and smartOrder read. */
export function coverAssignments(state, team) {
  return assignCoverage(state, team).map;
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
    default: {
      // A backer plays his own position UNLESS coverAssignments has pressed
      // him into last-resort coverage — then he plays it the same way a back
      // plays an assignment, not the mirror-and-fill he does the rest of the
      // time. Reuses coverAssignments's own result rather than re-deciding
      // who is open a second way.
      const assigned = coverAssignments(state, player.team).get(player.id);
      return assigned ? { aim: null, cover: assigned } : flowLinebacker(state, player);
    }
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
