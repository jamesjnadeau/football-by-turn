/**
 * Zone coverage: defend a place, not a man.
 *
 * A zone is an anchor point — across/depth yards off the line of scrimmage —
 * and the field is carved between the anchors by nearest-anchor: each
 * opposing non-carrier belongs to whichever zone's anchor he is closest to.
 * A defender whose zone holds a threat he could actually run with plays the
 * deepest of them, with the same leveraged-intercept math the man defense
 * uses; an empty zone holds its anchor.
 *
 * Membership is recomputed from positions every time the orders are asked
 * for, which is the whole difference from man coverage: a receiver who
 * crosses out of a zone is PASSED OFF to the next one rather than chased.
 * That is also why these are aim orders and never `cover` orders — a cover
 * order (cover.js) is a per-sub-step pursuit of one man, exactly what a
 * zone is not.
 *
 * Pure, like defense.js: reads state, returns orders, writes nothing.
 * ai.js's applyOrders is the writer.
 */
import { fieldPos } from './view.js';
import { carrier } from './state.js';
import { maxSpeed } from './modes.js';
import { interceptPoint, leverageAim, defendDir } from './defense.js';
import { dist } from './vec.js';
import { AI_THREAT_SPEED_RATIO } from './constants.js';

/** A zone's home spot: across yards from the middle, depth yards past the
 *  line on `team`'s own side. */
export function zoneAnchorPoint(state, team, across, depth) {
  return fieldPos(across, state.losYard + defendDir(team) * depth);
}

/** Who a zone might have to handle: every opposing non-carrier. The carrier
 *  is tackled, not zoned — the policy's own converge guards own him. */
export function zoneThreats(state, team) {
  const car = carrier(state);
  return state.players.filter((p) => p.team !== team && p.id !== car?.id);
}

/**
 * One order per anchor'd defender. `anchors` is [{id, across, depth}];
 * ids not on the field are skipped, so a genome tuned for one variant can be
 * asked about another without exploding.
 */
export function zoneOrders(state, team, anchors) {
  const spots = [];
  for (const a of anchors) {
    const d = state.players.find((p) => p.id === a.id);
    if (!d) continue;
    spots.push({ d, point: zoneAnchorPoint(state, team, a.across, a.depth) });
  }
  const byZone = new Map(spots.map((s) => [s.d.id, []]));
  for (const t of zoneThreats(state, team)) {
    let best = null;
    let bestD = Infinity;
    for (const s of spots) {
      const gap = dist(t.pos, s.point);
      if (gap < bestD) { best = s; bestD = gap; }
    }
    if (best) byZone.get(best.d.id).push(t);
  }
  const dir = defendDir(team);
  return spots.map(({ d, point }) => {
    const mine = byZone.get(d.id)
      .filter((t) => maxSpeed(t) >= maxSpeed(d) * AI_THREAT_SPEED_RATIO);
    if (!mine.length) return { id: d.id, aim: point, cover: null };
    const deepest = mine.reduce((a, b) => (b.pos.y * dir > a.pos.y * dir ? b : a));
    return { id: d.id, aim: leverageAim(d, interceptPoint(d, deepest), deepest), cover: null };
  });
}
