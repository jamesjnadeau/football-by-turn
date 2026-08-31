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
import { AI_THREAT_SPEED_RATIO } from '../constants.js';
import {
  UNITS_PER_YARD_X, CENTRE_X, SIDELINE_LEFT, SIDELINE_RIGHT,
} from '../../field/geometry.js';

/**
 * The situation, each part squashed to roughly [0,1]: which down it is, how
 * much of a fresh set of downs is still to gain, and how wide the offense is
 * standing. Coarse on purpose — a gate with three inputs can be learned from
 * a few thousand plays; one with thirty cannot.
 */
export function schemeFeatures(state) {
  const offense = state.players.filter((p) => p.team === 'offense');
  const xs = offense.map((p) => p.pos.x);
  const width = SIDELINE_RIGHT - SIDELINE_LEFT;
  return {
    down: (state.down - 1) / 3,
    toGo: Math.min(1, (state.toGoYard - state.losYard) / 10),
    spread: xs.length ? (Math.max(...xs) - Math.min(...xs)) / width : 0,
  };
}

export function schemeChoice(state, genome) {
  const f = schemeFeatures(state);
  const z = genome['scheme:bias']
    + genome['scheme:down'] * f.down
    + genome['scheme:toGo'] * f.toGo
    + genome['scheme:spread'] * f.spread;
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
export function learnedCoverAssignments(state, team, genome) {
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
          + genome['cov:width'] * width;
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
 *  zone keys. Ids the genome has never met contribute nothing. */
export function zoneAnchorsFromGenome(players, genome) {
  return players
    .filter((p) => typeof genome[`zone:${p.id}:across`] === 'number')
    .map((p) => ({
      id: p.id,
      across: genome[`zone:${p.id}:across`],
      depth: genome[`zone:${p.id}:depth`],
    }));
}

/**
 * Every order for one team, one turn — the learned counterpart of
 * defense.js's smartOrders, and the same contract: pure, formation order,
 * ai.js writes. The guards at the top are smartOrder's own, verbatim in
 * spirit: assignments are what you play BEFORE the play breaks.
 */
export function learnedOrders(state, team, genome) {
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

  const scheme = schemeChoice(state, genome);
  const zone = scheme === 'zone'
    ? zoneOrders(state, team, zoneAnchorsFromGenome(mine, genome))
    : [];
  const zoned = new Set(zone.map((o) => o.id));
  const man = scheme === 'man'
    ? learnedCoverAssignments(state, team, genome)
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
