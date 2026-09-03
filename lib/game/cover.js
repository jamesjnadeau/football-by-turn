/**
 * Covering a man: the order you give by dragging one of your players onto one
 * of theirs.
 *
 * A cover order is not an arrow. An arrow is a direction fixed at the whistle;
 * a cover order is re-aimed every sub-step at wherever the covered man has got
 * to, which is what makes it possible to stay with someone who cuts. That is the
 * whole of the "AI" here — a blocker with an aim point that keeps moving.
 *
 * Where it aims depends on whether there is anything to protect. With the ball
 * on the blocker's own team he INTERPOSES: he aims for the point just on his
 * carrier's side of the man he is covering, which is what putting your body in
 * the way actually means. With no carrier of his own — a loose ball, or the
 * defense covering a receiver in a hot-seat game — he simply SHADOWS the target
 * where the target is going.
 */
import { add, sub, scale, norm, len, dist } from './vec.js';
import { getPlayer, carrier } from './state.js';
import { maxSpeed } from './modes.js';
import { COVER_LEAD_MAX_SECONDS, PICK_SLOP_UNITS, COVER_GRAB_REACH } from './constants.js';

/**
 * The nearest player NOT on `team` within pick range of `point`, or null. The
 * same slop app/main.js's hitTest uses to pick the man being ordered, so the
 * two ends of a drag are equally forgiving.
 */
export function opponentAt(state, point, team) {
  let best = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.team === team) continue;
    const d = dist(p.pos, point);
    if (d <= p.radius + PICK_SLOP_UNITS && d < bestD) { best = p.id; bestD = d; }
  }
  return best;
}

/**
 * Take up a man. Refused for a teammate (and so, implicitly, for himself),
 * which is the caller's cue that this drag was an ordinary run.
 *
 * The plan written here is the starting aim; updateCoverPlans replaces its
 * direction every sub-step. Writing one at all matters for two reasons that
 * have nothing to do with physics: turn.js's unplannedPlayers counts a covering
 * player as planned, and render.js only looks at players who have a plan.
 * Throttle is 1 because the assist is steering — a cover order is a commitment
 * to go get him, and there is no "how hard" left for the drag to say.
 */
export function setCover(state, id, targetId) {
  const p = getPlayer(state, id);
  const t = getPlayer(state, targetId);
  if (t.team === p.team) return false;
  p.cover = targetId;
  const to = sub(t.pos, p.pos);
  p.plan = {
    dir: len(to) === 0 ? { x: 0, y: p.team === 'offense' ? 1 : -1 } : norm(to),
    throttle: 1,
    target: null,
  };
  return true;
}

export function clearCover(state, id) {
  const p = getPlayer(state, id);
  p.cover = null;
}

/** Where the assist points this blocker right now. */
export function coverAim(state, player) {
  const t = getPlayer(state, player.cover);
  const lead = Math.min(
    COVER_LEAD_MAX_SECONDS,
    len(sub(t.pos, player.pos)) / maxSpeed(player),
  );
  const aim = add(t.pos, scale(t.vel, lead));

  // Interpose, but only for someone worth interposing for: the ball has to be
  // on this player's team and in someone else's hands. A carrier told to cover
  // a defender is doing something else entirely — running at him — and should
  // not aim behind his own back.
  const car = carrier(state);
  if (!car || car.team !== player.team || car.id === player.id) return aim;
  const toBall = sub(car.pos, aim);
  if (len(toBall) === 0) return aim;
  return add(aim, scale(norm(toBall), t.radius + player.radius));
}

/**
 * Re-aim every cover order. turn.js calls this before each physics sub-step,
 * which is what makes the order track a moving man instead of a remembered one.
 * Only the direction changes: the throttle stays at 1 and the plan never gains
 * a landing spot, because a cover order does not promise one.
 */
export function updateCoverPlans(state) {
  for (const p of state.players) {
    if (!p.cover) continue;
    // setPersonnel clears a cover order the moment its man leaves the field,
    // but it is not the only way state.players can change underneath one —
    // so check here too, and drop the order rather than let getPlayer's
    // deliberate throw end the whole turn over one stale aim point.
    if (!state.players.some((q) => q.id === p.cover)) { p.cover = null; continue; }
    const to = sub(coverAim(state, p), p.pos);
    if (len(to) === 0) continue; // standing on the aim point: no direction to run
    p.plan = { dir: norm(to), throttle: 1, target: null };
  }
}

/**
 * The extra contact distance a cover order buys, for one pair of players.
 * Symmetric, because a collision has no near end and far end: either of them
 * covering the other is the same engagement, and physics.js resolves the pair
 * once whichever way round it happens to hold them.
 */
export function grabBonus(a, b) {
  return a.cover === b.id || b.cover === a.id ? COVER_GRAB_REACH : 0;
}
