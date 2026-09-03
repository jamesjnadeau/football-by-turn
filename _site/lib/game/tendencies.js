/**
 * What the human offense keeps doing, and what to make of it.
 *
 * Three counts, because the learned defense has exactly three joints a habit
 * can be pushed into (see learned/defense-policy.js): run vs pass by down and
 * distance, which side the runs go to, and which receiver the throws are aimed
 * at. Everything here is PURE — counts in, counts or a reading out. The app
 * stores them and hands them back (app/coach-store.js); nothing in this file
 * knows what a browser is.
 *
 * Every read is Laplace-smoothed by TENDENCY_PRIOR imaginary neutral plays.
 * That is the whole of the small-sample discipline: with nothing counted the
 * reads come out exactly neutral (0.5, 0, no favorite), which downstream means
 * no bias at all and therefore a defense that plays precisely what its genome
 * says; with three plays they have barely moved; with twenty they have most of
 * the way moved. There is no "enough data yet" threshold anywhere, because a
 * threshold is a cliff and this is a ramp.
 */
import {
  TENDENCY_PRIOR, TENDENCY_SHORT_YARDS, TENDENCY_MEDIUM_YARDS,
  TENDENCY_SIDE_DEADZONE,
} from './constants.js';

export const TENDENCY_VERSION = 1;

export function emptyTendencies() {
  return {
    v: TENDENCY_VERSION,
    calls: {},
    sides: { left: 0, middle: 0, right: 0 },
    targets: {},
    plays: 0,
  };
}

export function distanceBucket(toGo) {
  if (toGo <= TENDENCY_SHORT_YARDS) return 'short';
  if (toGo <= TENDENCY_MEDIUM_YARDS) return 'medium';
  return 'long';
}

/** The bucket one call is filed under: the down, and how far it is. */
export function situationKey(down, toGo) {
  return `${down}:${distanceBucket(toGo)}`;
}

/**
 * Which way a called run flows: the average sideways lean of every arrow on
 * the snapshot. The blockers lean with the run, so averaging the whole call
 * reads the play rather than one man's first step — and a call with nothing
 * drawn on it reads as up the middle, which contributes to the denominator and
 * to no side.
 */
export function runSideOf(snapshot) {
  const plans = Object.values(snapshot.plans);
  if (!plans.length) return 'middle';
  const lean = plans.reduce((sum, p) => sum + p.dir.x, 0) / plans.length;
  if (lean > TENDENCY_SIDE_DEADZONE) return 'right';
  if (lean < -TENDENCY_SIDE_DEADZONE) return 'left';
  return 'middle';
}

/**
 * One coaching snapshot, read as one observation. A snapshot carrying a throw
 * is a pass (the automatic snap is never in a snapshot — see coach-log.js), and
 * anything else is a run.
 */
export function observationFromSnapshot(snapshot) {
  const pass = snapshot.pass !== null;
  return {
    down: snapshot.situation.down,
    toGo: snapshot.situation.toGo,
    call: pass ? 'pass' : 'run',
    side: pass ? null : runSideOf(snapshot),
    target: pass ? snapshot.pass.target : null,
  };
}

/** The counts with one more play in them. Pure: the old object is untouched. */
export function observePlay(counts, obs) {
  const key = situationKey(obs.down, obs.toGo);
  const bucket = counts.calls[key] ?? { run: 0, pass: 0 };
  const calls = {
    ...counts.calls,
    [key]: {
      run: bucket.run + (obs.call === 'run' ? 1 : 0),
      pass: bucket.pass + (obs.call === 'pass' ? 1 : 0),
    },
  };
  const sides = { ...counts.sides };
  if (obs.call === 'run' && obs.side) sides[obs.side] += 1;
  const targets = { ...counts.targets };
  if (obs.call === 'pass' && obs.target) {
    targets[obs.target] = (targets[obs.target] ?? 0) + 1;
  }
  return { v: TENDENCY_VERSION, calls, sides, targets, plays: counts.plays + 1 };
}

/**
 * What the counts say about this down and distance. Every number here is
 * smoothed and bounded:
 *
 *   passRate — in (0,1), exactly 0.5 with nothing counted in this bucket.
 *   runSide  — in (-1,1), positive toward the right sideline, exactly 0 with
 *              nothing counted or with every run up the middle.
 *   favorite — the most-targeted receiver and an `edge` in [0,1) that is his
 *              share of the throws discounted by the prior, so one throw at a
 *              man is a fact and not yet a habit. Null until somebody has been
 *              thrown at.
 *   samples  — the plays actually counted in this bucket, for anyone who wants
 *              to say out loud how much the defense thinks it knows.
 */
export function readTendencies(counts, down, toGo) {
  const bucket = counts.calls[situationKey(down, toGo)] ?? { run: 0, pass: 0 };
  const passRate = (bucket.pass + TENDENCY_PRIOR)
    / (bucket.run + bucket.pass + 2 * TENDENCY_PRIOR);

  const { left, middle, right } = counts.sides;
  const runSide = (right - left) / (left + middle + right + 2 * TENDENCY_PRIOR);

  const ids = Object.keys(counts.targets).sort();
  let favorite = null;
  if (ids.length) {
    let best = ids[0];
    for (const id of ids) if (counts.targets[id] > counts.targets[best]) best = id;
    const total = ids.reduce((sum, id) => sum + counts.targets[id], 0);
    favorite = { id: best, edge: counts.targets[best] / (total + TENDENCY_PRIOR) };
  }

  return { passRate, runSide, favorite, samples: bucket.run + bucket.pass };
}

/**
 * The reading for the situation the game is actually in, or null when this
 * game is carrying no history — which is how ai.js asks, and how "no data
 * means no bias" is enforced in one place rather than at every call site.
 */
export function tendenciesForState(state) {
  if (!state.tendencyCounts) return null;
  return readTendencies(state.tendencyCounts, state.down, state.toGoYard - state.losYard);
}

export function serializeTendencies(counts) {
  return JSON.stringify(counts);
}

const count = (v) => (
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
);

/**
 * Storage back into counts. Anything unrecognisable reads as no history at
 * all: a wrong count would quietly aim the defense at a receiver the coach has
 * never thrown to, which is worse than forgetting the whole season.
 */
export function parseTendencies(text) {
  if (typeof text !== 'string' || text === '') return emptyTendencies();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyTendencies();
  }
  if (!raw || typeof raw !== 'object' || raw.v !== TENDENCY_VERSION) return emptyTendencies();
  const plays = count(raw.plays);
  if (plays === null) return emptyTendencies();

  const out = emptyTendencies();
  if (!raw.calls || typeof raw.calls !== 'object' || Array.isArray(raw.calls)) {
    return emptyTendencies();
  }
  for (const [key, bucket] of Object.entries(raw.calls)) {
    if (key === '__proto__' || !bucket || typeof bucket !== 'object') return emptyTendencies();
    const run = count(bucket.run);
    const pass = count(bucket.pass);
    if (run === null || pass === null) return emptyTendencies();
    out.calls[key] = { run, pass };
  }
  if (!raw.sides || typeof raw.sides !== 'object') return emptyTendencies();
  for (const side of ['left', 'middle', 'right']) {
    const n = count(raw.sides[side]);
    if (n === null) return emptyTendencies();
    out.sides[side] = n;
  }
  if (!raw.targets || typeof raw.targets !== 'object' || Array.isArray(raw.targets)) {
    return emptyTendencies();
  }
  for (const [id, n] of Object.entries(raw.targets)) {
    const hits = count(n);
    if (id === '__proto__' || hits === null) return emptyTendencies();
    out.targets[id] = hits;
  }
  out.plays = plays;
  return out;
}
