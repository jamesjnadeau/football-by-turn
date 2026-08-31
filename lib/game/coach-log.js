/**
 * The coaching log: what the human actually called, turn by turn, as plain
 * serializable data.
 *
 * A snapshot is one planning phase seen from one team's side — where his men
 * were standing, the arrows and cover orders and stances he gave them, the
 * throw he set, and the SITUATION he gave them in. It is deliberately close to
 * play.js's saved play, and deliberately not the same thing:
 *
 *   - a play is the human's own team by definition; a snapshot names its team,
 *     because the thing that replays these (tools/ghost.js) has to be able to
 *     impersonate either side;
 *   - a play is only ever the first turn of a down; a snapshot is taken on
 *     every turn, because what you do on turn three is as much a habit as what
 *     you come to the line with;
 *   - a play has a name and a slot; a snapshot has a situation, which is the
 *     key everything downstream looks it up by.
 *
 * Pure, like playbook.js: this file knows what a snapshot IS, and
 * app/coach-store.js is the only thing that knows where one is kept.
 *
 * Spots are yards off the line of scrimmage and never SVG units, so a call
 * made on the 25 replays on the 40 as the same picture. `facing` is saved with
 * a stance because it is the axis the stance locked. The automatic snap is
 * never saved: it is how a down starts, not an order the coach gave.
 */
import { xToYards } from '../field/geometry.js';
import { fieldPos, yardsOfY } from './view.js';
import {
  setPlan, clearPlan, setMode, setPass, clearPass, aimSnap,
} from './state.js';
import { setCover, clearCover } from './cover.js';
import { placeFormation, canReposition } from './formation.js';

export const COACH_LOG_VERSION = 1;

/**
 * How many snapshots a log keeps. Four hundred is well over a hundred downs
 * of real coaching — enough for a ghost with a habit, small enough that the
 * JSON stays inside a browser's storage quota and a nearest-neighbor scan
 * stays instant.
 */
export const COACH_LOG_MAX = 400;

/** The stances a snapshot may carry — play.js's list, for the same reason:
 *  cutBlockDrive is never player-selected. */
const STANCES = ['tucked', 'prepared', 'holding', 'cutBlock'];

const vec = (v) => ({ x: v.x, y: v.y });

export function emptyCoachLog() {
  return [];
}

/**
 * One planning phase, from `team`'s side. Deep-copied on the way out: a
 * snapshot must not share a vector with the live state, or the next drag would
 * silently rewrite history.
 *
 * A covering man's ORDER is recorded and his plan is not. setCover writes both
 * — the plan is the order's opening aim — and recording the arrow as well
 * would replay as an arrow instead of as a man taken up.
 */
export function captureSnapshot(state, team) {
  const spots = {};
  const plans = {};
  const covers = {};
  const stances = {};
  for (const p of state.players) {
    if (p.team !== team) continue;
    spots[p.id] = {
      across: xToYards(p.pos.x),
      down: yardsOfY(p.pos.y) - state.losYard,
    };
    if (p.cover) covers[p.id] = p.cover;
    else if (p.plan) plans[p.id] = { dir: vec(p.plan.dir), throttle: p.plan.throttle };
    if (p.mode !== 'normal') stances[p.id] = { mode: p.mode, facing: vec(p.facing) };
  }
  const pp = state.plannedPass;
  const thrower = pp && !pp.auto ? state.players.find((p) => p.id === pp.from) : null;
  const mine = thrower && thrower.team === team ? pp : null;
  return {
    situation: {
      down: state.down,
      toGo: state.toGoYard - state.losYard,
      losYard: state.losYard,
      turnIndex: state.turnIndex,
      variant: state.variantId,
      side: team,
    },
    spots,
    plans,
    covers,
    stances,
    pass: mine
      ? { from: mine.from, dir: vec(mine.dir), power: mine.power, target: mine.target ?? null }
      : null,
  };
}

/**
 * Put a snapshot's orders back on `team`. Everything that team was holding is
 * wiped first — replaying a call replaces the huddle, it does not merge with
 * one — and whatever could not be given comes back in `skipped` (an id this
 * formation has no player for, a tuck by a man who is not carrying the ball
 * this time, a throw by a man who does not have the ball).
 *
 * The formation only goes on while a formation is still a thing: past the
 * first turn of a down everyone has scattered, and the spots in the snapshot
 * describe a picture that no longer exists. Arrows go on BEFORE stances,
 * because setMode freezes `facing` off the player's heading and the saved
 * facing is then written back over it — play.js's own ordering, for the same
 * reason.
 */
export function applySnapshot(state, team, snapshot) {
  const applied = [];
  const skipped = [];
  const mine = (id) => {
    const p = state.players.find((pl) => pl.id === id);
    return p && p.team === team ? p : null;
  };

  for (const p of state.players) {
    if (p.team !== team) continue;
    setMode(state, p.id, 'normal');
    clearPlan(state, p.id);
    clearCover(state, p.id);
  }
  clearPass(state);

  if (canReposition(state)) {
    const wanted = [];
    for (const [id, spot] of Object.entries(snapshot.spots)) {
      if (!mine(id)) { skipped.push(id); continue; }
      wanted.push({ id, pos: fieldPos(spot.across, state.losYard + spot.down) });
    }
    // Not counted as `applied`: standing where you were told to stand is not
    // an order given — play.js's placeFormation call keeps the same count.
    for (const id of placeFormation(state, wanted).skipped) skipped.push(id);
  }

  for (const [id, plan] of Object.entries(snapshot.plans)) {
    if (!mine(id)) { skipped.push(id); continue; }
    setPlan(state, id, vec(plan.dir), plan.throttle);
    applied.push(id);
  }
  for (const [id, targetId] of Object.entries(snapshot.covers)) {
    if (!mine(id) || !state.players.some((pl) => pl.id === targetId)) {
      skipped.push(id);
      continue;
    }
    if (setCover(state, id, targetId)) applied.push(id);
    else skipped.push(id);
  }
  for (const [id, stance] of Object.entries(snapshot.stances)) {
    const p = mine(id);
    if (!p) { skipped.push(id); continue; }
    // setMode refuses a stance that is no longer legal. That is a skip, not a
    // failure: the rest of the call still goes on.
    if (setMode(state, id, stance.mode)) p.facing = vec(stance.facing);
    else skipped.push(id);
  }
  if (snapshot.pass) {
    const { from, dir, power, target } = snapshot.pass;
    // A target this field has no player for is dropped rather than carried:
    // releasePass would go looking for him mid-flight.
    const lock = target && state.players.some((pl) => pl.id === target) ? target : null;
    if (mine(from) && setPass(state, from, vec(dir), power, lock)) applied.push(from);
    else skipped.push(from);
  }
  // A call with no throw of its own would otherwise leave the ball on the
  // centre with nobody told to move it. aimSnap leaves a real throw alone.
  aimSnap(state);
  return { applied, skipped };
}

/** The log with `snapshot` on the end, never longer than `max`. */
export function appendSnapshot(log, snapshot, max = COACH_LOG_MAX) {
  const next = [...log, snapshot];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function serializeCoachLog(log) {
  return JSON.stringify({ v: COACH_LOG_VERSION, snapshots: log });
}

/**
 * Storage back into a log. Anything unrecognisable — absent, not JSON, a
 * version this build does not know — reads as an empty log. A single bad
 * SNAPSHOT is dropped and the rest kept, which is where this parts company
 * with parsePlaybook: a play is a thing the coach would call and notice
 * missing a man from, while a log is a pile of observations and losing one of
 * four hundred is nothing.
 */
export function parseCoachLog(text) {
  if (typeof text !== 'string' || text === '') return [];
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!raw || typeof raw !== 'object') return [];
  if (raw.v !== COACH_LOG_VERSION || !Array.isArray(raw.snapshots)) return [];
  const out = [];
  for (const entry of raw.snapshots) {
    const snap = sanitizeSnapshot(entry);
    if (snap) out.push(snap);
  }
  return out.length > COACH_LOG_MAX ? out.slice(out.length - COACH_LOG_MAX) : out;
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

/** A plain {id: ...} map from storage, or null if it is not one. Assigning a
 *  "__proto__" key onto a literal would set the object's prototype rather than
 *  add a property, and nothing legitimate is named that. */
function entriesOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = Object.entries(raw);
  return out.some(([id]) => id === '__proto__') ? null : out;
}

function sanSituation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const down = finite(raw.down);
  const toGo = finite(raw.toGo);
  const losYard = finite(raw.losYard);
  const turnIndex = finite(raw.turnIndex);
  if (down === null || toGo === null || losYard === null || turnIndex === null) return null;
  if (typeof raw.variant !== 'string') return null;
  if (raw.side !== 'offense' && raw.side !== 'defense') return null;
  return { down, toGo, losYard, turnIndex, variant: raw.variant, side: raw.side };
}

/**
 * Whatever came back out of storage, as a snapshot — or null. Strict on
 * purpose, exactly as sanitizePlay is: these numbers go straight into the
 * physics, and one NaN in a direction vector puts a player at NaN,NaN for the
 * rest of the game. A snapshot with any bad entry is dropped whole.
 */
export function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const situation = sanSituation(raw.situation);
  if (!situation) return null;

  const spotEntries = entriesOf(raw.spots);
  if (!spotEntries) return null;
  const spots = {};
  for (const [id, spot] of spotEntries) {
    if (!spot || typeof spot !== 'object') return null;
    const across = finite(spot.across);
    const down = finite(spot.down);
    if (across === null || down === null) return null;
    spots[id] = { across, down };
  }

  const planEntries = entriesOf(raw.plans);
  if (!planEntries) return null;
  const plans = {};
  for (const [id, plan] of planEntries) {
    if (!plan || typeof plan !== 'object') return null;
    const dir = sanVec(plan.dir);
    const throttle = sanUnit(plan.throttle);
    if (!dir || throttle === null) return null;
    plans[id] = { dir, throttle };
  }

  const coverEntries = entriesOf(raw.covers);
  if (!coverEntries) return null;
  const covers = {};
  for (const [id, targetId] of coverEntries) {
    if (typeof targetId !== 'string') return null;
    covers[id] = targetId;
  }

  const stanceEntries = entriesOf(raw.stances);
  if (!stanceEntries) return null;
  const stances = {};
  for (const [id, stance] of stanceEntries) {
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
    const target = raw.pass.target ?? null;
    if (target !== null && typeof target !== 'string') return null;
    pass = { from: raw.pass.from, dir, power, target };
  }

  return { situation, spots, plans, covers, stances, pass };
}
