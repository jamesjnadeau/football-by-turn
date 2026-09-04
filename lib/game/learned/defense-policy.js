/**
 * The learned defense's brain. Same contract as defense.js: PURE — it reads
 * state (plus a genome) and returns {id, aim, cover} orders; ai.js is the
 * only writer. The structure is hand-written and the numbers are learned:
 *
 *   - a scheme gate (man vs zone) — a thresholded logit over the situation;
 *   - man assignments — the same greedy claim defense.js runs, but over a
 *     learned cost (distance, receiver depth, receiver width) instead of
 *     bare distance;
 *   - zone anchors — genome offsets handed to zone.js.
 *
 * What stays rule-based, on purpose (see the spec's design decision 7): the
 * front's rush/contain, the linebacker's mirror-and-fill, the free man's
 * deepAim, and the whole-defense convergence once the carrier is past the
 * line. The learned layer decides scheme, assignment and alignment; it does
 * not relearn how to run a pursuit angle.
 */
import { carrier, ballPos } from '../state.js';
import {
  positionGroup, pastLine, losY, defendDir, rushLineman, flowLinebacker,
  deepMan, deepAim, interceptPoint, leverageAim,
} from '../defense.js';
import { maxSpeed } from '../modes.js';
import { zoneOrders } from '../zone.js';
import { dist } from '../vec.js';
import {
  AI_THREAT_SPEED_RATIO, TENDENCY_SCHEME_SHADE, TENDENCY_COVER_DISCOUNT_YARDS,
  TENDENCY_ANCHOR_SHIFT_YARDS,
} from '../constants.js';
import {
  UNITS_PER_YARD_X, CENTRE_X, FIELD_WIDTH_YARDS,
} from '../../field/geometry.js';
import { snapLook } from '../read.js';

/**
 * The situation, each part squashed to roughly [0,1]: which down it is, how
 * much of a fresh set of downs is still to gain, and how wide the offense was
 * standing WHEN IT SNAPPED.
 *
 * `look` is read.js's frozen picture, and taking spread from there rather than
 * measuring it live is what stops the man/zone call flipping in the middle of
 * a play: men scatter, so a live width grows all down long, and a gate reading
 * it would answer a different question every turn. A scheme is a pre-snap
 * call. Coarse on purpose — a gate with three inputs can be learned from a few
 * thousand plays; one with thirty cannot.
 */
export function schemeFeatures(state, look) {
  return {
    down: (state.down - 1) / 3,
    toGo: Math.min(1, (state.toGoYard - state.losYard) / 10),
    spread: look.spread,
  };
}

/**
 * The bias layer: what this defense makes of the coach it is facing.
 *
 * `tendencies` is lib/game/tendencies.js's reading — {passRate, runSide,
 * favorite, samples} — or null, which is what every existing caller passes by
 * omission and what the training harness always passes. Each of these returns
 * exactly zero for null AND for a reading taken from no history, so "no data"
 * and "no bias" are the same state rather than two states that have to agree.
 *
 * Every one is clamped by its own constant. The genome is what plays; a habit
 * only leans on it.
 */
const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v));

/** The man/zone gate's tendency lean: a coach who throws earns zone. */
export function schemeShade(tendencies) {
  if (!tendencies) return 0;
  return clamp((tendencies.passRate - 0.5) * 2 * TENDENCY_SCHEME_SHADE, TENDENCY_SCHEME_SHADE);
}

/** Yards off the cost of covering the man this coach keeps throwing to — so
 *  he is claimed first, and from further away than bare distance would. */
export function favoriteDiscount(tendencies, receiverId) {
  const fav = tendencies?.favorite;
  if (!fav || fav.id !== receiverId) return 0;
  return Math.max(0, Math.min(TENDENCY_COVER_DISCOUNT_YARDS,
    fav.edge * TENDENCY_COVER_DISCOUNT_YARDS));
}

/** Yards a zone anchor slides toward the side the runs have been going. */
export function anchorShift(tendencies) {
  if (!tendencies) return 0;
  return clamp(tendencies.runSide * TENDENCY_ANCHOR_SHIFT_YARDS, TENDENCY_ANCHOR_SHIFT_YARDS);
}

export function schemeChoice(state, genome, tendencies = null, look = snapLook(state)) {
  const f = schemeFeatures(state, look);
  const z = genome['scheme:bias']
    + genome['scheme:down'] * f.down
    + genome['scheme:toGo'] * f.toGo
    + genome['scheme:spread'] * f.spread
    + schemeShade(tendencies);
  return z > 0 ? 'zone' : 'man';
}

/**
 * Who has whom, by learned preference. Structurally identical to
 * defense.js's assignCoverage — dedicated backs first, closest-COST pair
 * first, then one backer-fallback pass over genuine threats nobody claimed —
 * but the cost is a weighted sum in yards:
 *
 *   cost = wDist·(gap to him) + wDepth·(how deep he is) + wWidth·(how wide)
 *
 * With wDist=1 and the rest 0 the ordering is bare distance and this IS the
 * rule-based assignment (the test holds the two together). A negative wDepth
 * makes depth a discount: the deep man gets claimed first even from further
 * away, which is a preference no hand-written rule in defense.js can express.
 */
export function learnedCoverAssignments(state, team, genome, tendencies = null) {
  const car = carrier(state);
  const free = deepMan(state, team);
  const takers = state.players.filter(
    (p) => p.team === team && positionGroup(p) === 'back' && p.id !== free?.id,
  );
  const them = state.players.filter((p) => p.team !== team && p.id !== car?.id);
  const dir = defendDir(team);
  const line = losY(state);

  const claim = (map, claimed, defenders, receivers) => {
    const pairs = [];
    for (const d of defenders) {
      for (const r of receivers) {
        if (maxSpeed(r) < maxSpeed(d) * AI_THREAT_SPEED_RATIO) continue;
        const depth = ((r.pos.y - line) * dir) / UNITS_PER_YARD_X;
        const width = Math.abs(r.pos.x - CENTRE_X) / UNITS_PER_YARD_X;
        const cost = genome['cov:dist'] * (dist(d.pos, r.pos) / UNITS_PER_YARD_X)
          + genome['cov:depth'] * depth
          + genome['cov:width'] * width
          // The man this coach keeps throwing to is cheaper to take, in yards.
          - favoriteDiscount(tendencies, r.id);
        pairs.push({ d: d.id, r: r.id, cost });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost || a.d.localeCompare(b.d) || a.r.localeCompare(b.r));
    for (const { d, r } of pairs) {
      if (map.has(d) || claimed.has(r)) continue;
      map.set(d, r);
      claimed.add(r);
    }
    return new Set(pairs.map((p) => p.r));
  };

  const map = new Map();
  const claimed = new Set();
  const threats = claim(map, claimed, takers, them);
  const leftover = them.filter((r) => threats.has(r.id) && !claimed.has(r.id));
  if (leftover.length) {
    const backers = state.players.filter(
      (p) => p.team === team && positionGroup(p) === 'backer',
    );
    claim(map, claimed, backers, leftover);
  }
  return map;
}

/** The genome's zone anchors, for whichever of these players actually carry
 *  zone keys, slid toward the side this coach's runs have been going. Ids the
 *  genome has never met contribute nothing; the slide never carries an anchor
 *  past the sideline, since a zone nobody can stand in is not a zone. */
export function zoneAnchorsFromGenome(players, genome, tendencies = null) {
  const shift = anchorShift(tendencies);
  const halfField = FIELD_WIDTH_YARDS / 2;
  return players
    .filter((p) => typeof genome[`zone:${p.id}:across`] === 'number')
    .map((p) => ({
      id: p.id,
      across: Math.max(-halfField, Math.min(halfField, genome[`zone:${p.id}:across`] + shift)),
      depth: genome[`zone:${p.id}:depth`],
    }));
}

/**
 * The down's percept, or a stand-in built from the field.
 *
 * A state that never went through runTurn — an old save, a hand-rolled test
 * object, a caller that reaches for learnedOrders directly — carries no
 * playRead. Rather than refuse to play, this hands back a look measured now,
 * which is exactly the defense this file played before any of it existed.
 *
 * It deliberately does NOT attach that stand-in to `state` — learnedOrders is
 * a pure orders-only contract and has no business inventing a percept on a
 * caller's object. Which is exactly why learnedOrders resolves this ONCE, at
 * the top, and passes the result down: called twice on a state with no
 * playRead it would hand back two different objects, and the second caller
 * would find the call the first one wrote missing.
 */
function percept(state) {
  return state.playRead ?? {
    look: snapLook(state),
    // `snapped` carries read.js's own meaning — whether the snap read has been
    // taken. Nothing advances this stand-in, so it never has been. It is here
    // so the shape matches the real percept exactly: a consumer must not be
    // able to tell which of the two it was handed.
    snapped: false,
    call: { offense: null, defense: null },
  };
}

/**
 * The scheme this down is being played in, called ONCE. The first turn that
 * asks decides it and writes it down; every turn after reads it back. A
 * defense does not switch from man to zone in the middle of a play, and
 * before this it could, because the gate was re-run against a picture that
 * had moved.
 */
function committedScheme(state, p, genome, tendencies) {
  if (!p.call.defense) {
    p.call.defense = { scheme: schemeChoice(state, genome, tendencies, p.look), cover: null };
  }
  return p.call.defense.scheme;
}

/**
 * Who has whom this down, decided ONCE. The greedy claim runs on the first
 * turn that asks and the map is kept; before this it re-ran every turn, so a
 * defender could hand his man to somebody else between turn one and turn two
 * without anyone deciding he should.
 *
 * No re-assignment logic is needed and none is here. If the man being covered
 * catches the ball, the cached map still names him — harmlessly, since his
 * defender's order becomes "cover the new carrier", which is the right thing
 * to do anyway. Only once he crosses the line does learnedOrders' own
 * pastLine guard take the whole defense over and stop consulting this map at
 * all; a catch at or behind the line still runs through it first.
 */
function committedCover(state, p, team, genome, tendencies) {
  if (!p.call.defense.cover) {
    p.call.defense.cover = learnedCoverAssignments(state, team, genome, tendencies);
  }
  return p.call.defense.cover;
}

/**
 * Every order for one team, one turn — the learned counterpart of
 * defense.js's smartOrders, and the same contract: pure, formation order,
 * ai.js writes. The guards at the top are smartOrder's own, verbatim in
 * spirit: assignments are what you play BEFORE the play breaks.
 */
export function learnedOrders(state, team, genome, tendencies = null) {
  const bp = ballPos(state);
  if (!bp) return [];
  const mine = state.players.filter((p) => p.team === team);
  const car = carrier(state);
  if (!car || car.team === team) {
    return mine.map((p) => ({ id: p.id, aim: { ...bp }, cover: null }));
  }
  if (pastLine(state, team, car.pos)) {
    return mine.map((p) => ({
      id: p.id,
      aim: leverageAim(p, interceptPoint(p, car), car),
      cover: null,
    }));
  }

  const down = percept(state);
  const scheme = committedScheme(state, down, genome, tendencies);
  const zone = scheme === 'zone'
    ? zoneOrders(state, team, zoneAnchorsFromGenome(mine, genome, tendencies))
    : [];
  const zoned = new Set(zone.map((o) => o.id));
  const man = scheme === 'man'
    ? committedCover(state, down, team, genome, tendencies)
    : new Map();

  const orders = [];
  for (const p of mine) {
    if (positionGroup(p) === 'line') {
      orders.push({ id: p.id, ...rushLineman(state, p) });
      continue;
    }
    if (zoned.has(p.id)) continue; // his zone order is appended below
    const assigned = man.get(p.id);
    if (assigned) {
      orders.push({ id: p.id, aim: null, cover: assigned });
      continue;
    }
    if (positionGroup(p) === 'back') {
      orders.push({ id: p.id, aim: deepAim(state, p), cover: null });
      continue;
    }
    orders.push({ id: p.id, ...flowLinebacker(state, p) });
  }
  orders.push(...zone);
  return orders;
}
