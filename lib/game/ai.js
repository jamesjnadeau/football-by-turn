/**
 * The computer opponent. Two brains, picked by `state.aiLevel`:
 *
 *   'pursuit' — this file. Every player it coaches runs at the ball, at where
 *     the carrier is going rather than where he is.
 *   'smart'   — lib/game/defense.js. Assignment football: the line rushes with
 *     contain, the linebacker mirrors and fills, the secondary plays man with a
 *     free man over the top. This file is still the only writer.
 *
 * Nothing in here rolls dice, so a coached turn is as reproducible as a
 * hand-planned one.
 *
 * turn.js is the only caller. It coaches at the top of the turn and calls
 * clearAiPlans at the bottom, which is the whole trick to keeping the
 * computer's intentions off the human's screen: no plan and no cover order of
 * the computer's ever exists while `phase === 'planning'`, so there is never
 * anything to draw.
 */
import { add, sub, len, norm, scale } from './vec.js';
import { ballPos, carrier, setPlan, setMode, clearPlan, getPlayer } from './state.js';
import { maxSpeed } from './modes.js';
import { smartOrders } from './defense.js';
import { setCover, clearCover } from './cover.js';
import { AI_LEAD_MAX_SECONDS, AI_BREAKDOWN_UNITS } from './constants.js';

/** The players the computer coaches — nobody at all in hot-seat games. */
export function aiPlayers(state) {
  if (!state.aiTeam) return [];
  return state.players.filter((p) => p.team === state.aiTeam);
}

/**
 * Where `player` should run. A loose ball is chased where it lies; a carrier is
 * LED — his position plus his current velocity over the time this player needs
 * to cover the gap at his own top speed, capped at AI_LEAD_MAX_SECONDS.
 * Aiming at where the carrier stands right now would leave every pursuer
 * trailing him by exactly one turn, forever.
 */
export function pursuitTarget(state, player) {
  const bp = ballPos(state);
  if (!bp) return null;
  const car = carrier(state);
  if (!car || car.id === player.id) return { ...bp };
  const t = Math.min(AI_LEAD_MAX_SECONDS, len(sub(bp, player.pos)) / maxSpeed(player));
  return add(bp, scale(car.vel, t));
}

/**
 * One full-throttle plan per coached player. Pure: nothing in `state` moves,
 * which is what lets the turn decide when (and whether) to apply them.
 */
export function defensePlans(state) {
  const plans = [];
  for (const p of aiPlayers(state)) {
    const target = pursuitTarget(state, p);
    if (target === null) continue;
    const to = sub(target, p.pos);
    if (len(to) === 0) continue; // standing on the ball: no direction to run
    plans.push({ id: p.id, dir: norm(to), throttle: 1 });
  }
  return plans;
}

/**
 * Break down once you are close enough to make the hit. The prepared stance
 * trades a defender's agility — not his speed — for reach and tackling power:
 * he keeps full pace along the axis he locks in and can only shuffle across it,
 * so it pays only inside AI_BREAKDOWN_UNITS of the carrier, where there is no
 * room left for the runner to cut around the committed axis. And only when
 * there IS an opposing carrier: a loose ball is a footrace, and everyone runs
 * it at full speed.
 *
 * The axis he locks is his momentum, not the arrow he is about to be given —
 * headingOf prefers velocity, so this holds no matter what order coachAi does
 * its work in. A defender breaking down out of a full sprint commits along the
 * line he was already chasing on, and has to build speed in a new direction
 * before he can commit to that one instead.
 *
 * setMode runs only on an actual change. Calling it every turn while already
 * prepared would re-arm `charge` on every single turn, handing the computer a
 * permanent acceleration bonus that no human player can have.
 */
export function applyAiModes(state) {
  const car = carrier(state);
  const chasing = car !== null && car.team !== state.aiTeam;
  for (const p of aiPlayers(state)) {
    const close = chasing && len(sub(car.pos, p.pos)) <= AI_BREAKDOWN_UNITS;
    const want = close ? 'prepared' : 'normal';
    if (p.mode !== want) setMode(state, p.id, want);
  }
}

/**
 * The assignment brain's orders, written into `state`.
 *
 * Cover orders go through cover.js's setCover, so the computer's man coverage
 * IS the human's cover order: re-aimed at the covered man every sub-step, and
 * worth the same COVER_MASS_MULT and COVER_GRAB_REACH. Everything else becomes
 * an ordinary full-throttle plan pointed at the order's aim.
 *
 * clearCover runs on anyone not covering, because setPlan clears cover but the
 * two `continue` guards below do not reach it — a stale assignment from last
 * turn must not keep steering a man this turn.
 */
export function coachSmartDefense(state) {
  for (const { id, aim, cover } of smartOrders(state, state.aiTeam)) {
    if (cover) { setCover(state, id, cover); continue; }
    clearCover(state, id);
    if (!aim) continue;
    const to = sub(aim, getPlayer(state, id).pos);
    if (len(to) === 0) continue; // standing on the aim point: no direction to run
    setPlan(state, id, norm(to), 1);
  }
}

/** Everything the computer decides for one turn, written into `state`. */
export function coachAi(state) {
  if (!state.aiTeam) return;
  applyAiModes(state);
  if (state.aiLevel === 'smart') {
    coachSmartDefense(state);
    return;
  }
  for (const { id, dir, throttle } of defensePlans(state)) setPlan(state, id, dir, throttle);
}

/**
 * Wipe the computer's arrows — and its coverage. runTurn calls this at the end
 * of every turn, so that no plan of the computer's survives into a planning
 * phase where renderArrows would happily draw it for the human to read, and no
 * assignment survives into a turn where the computer has been switched off, or
 * has read the field again and would rather cover somebody else.
 */
export function clearAiPlans(state) {
  for (const p of aiPlayers(state)) {
    clearPlan(state, p.id);
    clearCover(state, p.id);
  }
}
