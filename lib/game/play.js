/**
 * A play: one turn's worth of orders for the human's team, saved so it can be
 * called again on a later down. Only the FIRST turn of a down can be saved or
 * loaded — a play is what you come to the line with, and every arrow in one was
 * drawn from the snap formation, so replaying it mid-play would be orders
 * against a picture that no longer exists.
 *
 * Plain serializable data, deep-copied on the way in and on the way out: a
 * saved play must not share a vector with the live state, or the next drag
 * would silently rewrite the play, and loading the same play twice would hand
 * two games the same objects.
 */
import { setPlan, clearPlan, setMode, setPass, clearPass, aimSnap } from './state.js';

/** As long a name as a slot button can show without wrapping. */
export const PLAY_NAME_MAX = 24;

const STANCES = ['tucked', 'prepared', 'holding'];

/** Saving and loading are both first-turn-of-a-down operations. */
export function canUsePlays(state) {
  return state.phase === 'planning' && state.turnIndex === 0;
}

const vec = (v) => ({ x: v.x, y: v.y });

export function capturePlay(state, name) {
  const plans = {};
  const stances = {};
  for (const p of state.players) {
    // The computer's team is not the human's to save. Those plans do not exist
    // during a planning phase anyway (turn.js clears them at the end of every
    // turn); this is the second lock on the same door.
    if (p.team === state.aiTeam) continue;
    if (p.plan) plans[p.id] = { dir: vec(p.plan.dir), throttle: p.plan.throttle };
    // `facing` is saved with the mode because it is the axis the stance locked:
    // the arc render.js draws and the strike zone rules.js measures both come
    // off it, so restoring the mode alone would load a different play from the
    // one that was saved.
    if (p.mode !== 'normal') stances[p.id] = { mode: p.mode, facing: vec(p.facing) };
  }
  // The automatic snap is not the coach's throw and is not saved with his
  // play: every down puts it back on by itself, so capturing it would only
  // make an empty play look drawn — and isEmptyPlay is what stops him saving
  // a blank one.
  const pp = state.plannedPass?.auto ? null : state.plannedPass;
  return {
    name: String(name).slice(0, PLAY_NAME_MAX),
    plans,
    stances,
    pass: pp ? { from: pp.from, dir: vec(pp.dir), power: pp.power } : null,
  };
}

export function isEmptyPlay(play) {
  return Object.keys(play.plans).length === 0
    && Object.keys(play.stances).length === 0
    && play.pass === null;
}

/**
 * Load a play over the current orders. Everything the human controls is wiped
 * first — calling a play replaces the down's plan, it does not merge with a
 * half-drawn one. Whatever could not be given comes back in `skipped` (an id
 * this formation has no player for, a defender in a play saved in hot-seat, a
 * tuck by a man who is not carrying the ball this time), so the caller can say
 * how many. An id can be in both lists: his arrow went on, his stance did not.
 *
 * Arrows go on BEFORE stances, because setMode freezes `facing` from the
 * player's heading, which reads his plan; the saved facing is then written back
 * over it, so the stance ends up pointed exactly where it was saved pointing.
 */
export function applyPlay(state, play) {
  const applied = new Set();
  const skipped = new Set();
  const mine = (id) => {
    const p = state.players.find((pl) => pl.id === id);
    return p && p.team !== state.aiTeam ? p : null;
  };

  for (const p of state.players) {
    if (p.team === state.aiTeam) continue;
    setMode(state, p.id, 'normal');
    clearPlan(state, p.id);
  }
  clearPass(state);

  for (const [id, plan] of Object.entries(play.plans)) {
    if (!mine(id)) { skipped.add(id); continue; }
    setPlan(state, id, vec(plan.dir), plan.throttle);
    applied.add(id);
  }
  for (const [id, stance] of Object.entries(play.stances)) {
    const p = mine(id);
    if (!p) { skipped.add(id); continue; }
    // setMode refuses a stance that is no longer legal. That is a skip, not a
    // failure: the rest of the play still loads.
    if (setMode(state, id, stance.mode)) p.facing = vec(stance.facing);
    else skipped.add(id);
  }
  if (play.pass) {
    if (setPass(state, play.pass.from, vec(play.pass.dir), play.pass.power)) {
      applied.add(play.pass.from);
    } else skipped.add(play.pass.from);
  }
  // A play saved without a throw of its own would otherwise come out of the
  // huddle with the ball still on the centre and nobody told to move it. The
  // snap goes back on -- and does not overwrite a throw the play DID carry,
  // because that one is the coach's and aimSnap leaves those alone.
  aimSnap(state);
  return { applied: [...applied], skipped: [...skipped] };
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function sanVec(v) {
  if (!v || typeof v !== 'object') return null;
  const x = finite(v.x);
  const y = finite(v.y);
  return x === null || y === null ? null : { x, y };
}

/** A throttle or a throw's power: a number, held to [0,1] like a drag is. */
function sanUnit(v) {
  const n = finite(v);
  return n === null ? null : Math.max(0, Math.min(1, n));
}

/**
 * Whatever came back out of storage, as a play — or null. Strict on purpose:
 * these numbers go straight into the physics, and one NaN in a direction vector
 * puts a player at NaN,NaN for the rest of the game. A play with any bad entry
 * is dropped whole rather than half-loaded, because half a play is worse than
 * no play: the coach would call it and not notice the missing man.
 */
export function sanitizePlay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.name !== 'string') return null;
  if (!raw.plans || typeof raw.plans !== 'object') return null;
  if (!raw.stances || typeof raw.stances !== 'object') return null;

  const plans = {};
  for (const [id, plan] of Object.entries(raw.plans)) {
    // Assigning a "__proto__" key onto a literal would set the object's
    // prototype rather than add a property. Nothing legitimate is named that.
    if (id === '__proto__') return null;
    if (!plan || typeof plan !== 'object') return null;
    const dir = sanVec(plan.dir);
    const throttle = sanUnit(plan.throttle);
    if (!dir || throttle === null) return null;
    plans[id] = { dir, throttle };
  }

  const stances = {};
  for (const [id, stance] of Object.entries(raw.stances)) {
    if (id === '__proto__') return null;
    if (!stance || typeof stance !== 'object') return null;
    const facing = sanVec(stance.facing);
    if (!facing || !STANCES.includes(stance.mode)) return null;
    stances[id] = { mode: stance.mode, facing };
  }

  let pass = null;
  if (raw.pass !== null && raw.pass !== undefined) {
    if (typeof raw.pass !== 'object' || typeof raw.pass.from !== 'string') return null;
    const dir = sanVec(raw.pass.dir);
    const power = sanUnit(raw.pass.power);
    if (!dir || power === null) return null;
    pass = { from: raw.pass.from, dir, power };
  }

  return { name: raw.name.slice(0, PLAY_NAME_MAX), plans, stances, pass };
}
