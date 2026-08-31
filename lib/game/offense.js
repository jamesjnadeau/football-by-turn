/**
 * The human offense's autoplan: a one-press QB run option.
 *
 * Mirrors play.js's shape (pure helpers plus one mutating entry point in the
 * same file) rather than the ai.js/defense.js split, because this is a
 * one-shot planning-time action triggered by a button press -- like
 * applyPlay -- not a per-turn brain turn.js calls on every runTurn.
 *
 * Positions are read off the field, not off role names, matching the ethos
 * defense.js's own header comment states -- the one exception is looking up
 * the quarterback and running back by role/id, because every roster in
 * rosters.js guarantees exactly one of each (SNAP_TARGET_ID for the QB, and
 * the sole player with role === 'RB').
 */
import { sub, len, norm, dot, scale, dist } from './vec.js';
import {
  setPlan, clearPlan, setMode, setPass, clearPass, aimSnap, getPlayer, carrier,
  SNAPPER_ID, SNAP_TARGET_ID,
} from './state.js';
import { positionGroup } from './defense.js';
import { pursuitTarget } from './ai.js';
import { OFFENSIVE_LINE_ROLES } from './rosters.js';
import { fieldPos } from './view.js';
// The closed form of a loose ball's flight, from the module that owns it.
// Imported from flight.js directly, NOT from pass.js, to avoid the same
// import cycle state.js itself avoids -- see state.js's own imports.
import { powerForTravel, spawnOffset } from './flight.js';
import {
  OPTION_READ_UNITS, OPTION_DIVE_LEAN, OPTION_KEEP_LEAN, OPTION_FAKE_FORWARD,
  OPTION_FAKE_THROTTLE, BLOCK_ENGAGE_UNITS, DAYLIGHT_ANGLES_DEG, DAYLIGHT_LOOKAHEAD_UNITS,
} from './constants.js';

/**
 * Which way (1 = right, -1 = left) this play runs. The tight end's own side
 * if there is one (the extra gap/blocker), else a fixed default.
 *
 * `centerX` is the field's own middle, in the same SVG units as `pos.x` --
 * NOT zero. Every player's `pos.x` is an absolute board coordinate (the field
 * spans roughly 35 to 235, always positive), so comparing a tight end's raw
 * `pos.x` against zero would read "right" for literally every position on the
 * board, including one repositioned left of centre. Defaults to
 * `fieldPos(0, 0).x` -- the x half of fieldPos does not depend on its
 * downYards argument, so any yard works as the second argument here.
 */
export function playSide(offense, centerX = fieldPos(0, 0).x) {
  const te = offense.find((p) => p.role === 'TE');
  if (!te) return 1;
  return Math.sign(te.pos.x - centerX) || 1;
}

/** The x of the widest offensive lineman on the play side -- the edge of the
 * blocked box, and the reference the read is measured against. */
export function playSideEdgeX(side, line) {
  const onSide = line.filter((p) => side * p.pos.x >= 0);
  const pool = onSide.length ? onSide : line;
  return pool.reduce((best, p) => (side * p.pos.x > side * best.pos.x ? p : best)).pos.x;
}

/** The widest defensive lineman on the play side -- the man the option reads.
 * Reuses defense.js's own positionGroup so a 4-man, 3-man or unbalanced front
 * all still hand back a reader. Null if the defense has fielded no line at all. */
export function readDefender(state, side) {
  const dl = state.players.filter((p) => p.team === 'defense' && positionGroup(p) === 'line');
  if (!dl.length) return null;
  return dl.reduce((best, p) => (side * p.pos.x > side * best.pos.x ? p : best));
}

function assignBlocks(blockers, defenders) {
  const pairs = [];
  for (const b of blockers) for (const d of defenders) pairs.push({ b: b.id, d: d.id, gap: dist(b.pos, d.pos) });
  pairs.sort((a, b) => a.gap - b.gap || a.b.localeCompare(b.b) || a.d.localeCompare(b.d));
  const map = new Map();
  const claimed = new Set();
  for (const { b, d } of pairs) {
    if (map.has(b) || claimed.has(d)) continue;
    map.set(b, d);
    claimed.add(d);
  }
  return map;
}

function applyBlocks(state, blockers) {
  const defenders = state.players.filter((p) => p.team === 'defense');
  const map = assignBlocks(blockers, defenders);
  for (const b of blockers) {
    const dId = map.get(b.id);
    if (!dId) continue; // more blockers than defenders left -- nobody left for him to block
    const d = getPlayer(state, dId);
    const gap = sub(d.pos, b.pos);
    if (len(gap) === 0) continue;
    setPlan(state, b.id, norm(gap), 1);
    if (len(gap) <= b.radius + d.radius + BLOCK_ENGAGE_UNITS) setMode(state, b.id, 'holding');
  }
}

/** Turn 0: the option read. */
function planOptionSnap(state, offense) {
  const qb = offense.find((p) => p.id === SNAP_TARGET_ID);
  const rb = offense.find((p) => p.role === 'RB');
  const line = offense.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role));
  if (!qb || !rb) return 'Nothing to autoplan -- this formation has no QB/RB to run an option with.';

  const side = playSide(offense);
  const edgeX = playSideEdgeX(side, line);
  const reader = readDefender(state, side);
  const give = reader !== null && side * (reader.pos.x - edgeX) > OPTION_READ_UNITS;

  if (give) {
    const from = getPlayer(state, SNAPPER_ID);
    const gap = sub(rb.pos, from.pos);
    if (len(gap) > 0) {
      const travel = Math.max(0, len(gap) - spawnOffset(from));
      setPass(state, SNAPPER_ID, norm(gap), powerForTravel(travel, Infinity), rb.id);
    }
  }
  // else: leave plannedPass alone. autoplanOffense's trailing aimSnap() call
  // puts the ordinary snap-to-QB back on, exactly as it does after Clear
  // Arrows or a new down.

  const leanDir = norm({ x: side * OPTION_DIVE_LEAN, y: 1 });
  for (const p of line) {
    setPlan(state, p.id, leanDir, 1); // gives cutBlock's setMode a heading to freeze into `facing`
    setMode(state, p.id, 'cutBlock');
  }

  setPlan(state, rb.id, leanDir, 1); // the dive -- real when he has the ball, the fake when he doesn't
  setPlan(
    state, qb.id,
    give
      ? norm({ x: -side, y: OPTION_FAKE_FORWARD }) // a boot away from the play, selling nothing
      : norm({ x: side * OPTION_KEEP_LEAN, y: 1 }), // the keep: wider than the dive, clearing the crashed reader
    give ? OPTION_FAKE_THROTTLE : 1,
  );

  const blockers = offense.filter((p) => p.id !== qb.id && p.id !== rb.id && !OFFENSIVE_LINE_ROLES.has(p.role));
  applyBlocks(state, blockers);

  return give
    ? 'Read: contain outside. Direct snap to the RB -- the QB fakes the boot.'
    : 'Read: crash inside. QB keeps it -- the RB fakes the dive.';
}

/**
 * daylightDirection: scores a fan of running lanes by how much room each has,
 * and picks the widest.
 */
export function daylightDirection(state, carrierPlayer) {
  const defenders = state.players.filter((p) => p.team === 'defense');
  let bestDir = null;
  let bestScore = -Infinity;
  for (const deg of DAYLIGHT_ANGLES_DEG) { // [0, -20, 20, -40, 40, -60, 60] -- straightest first
    const rad = (deg * Math.PI) / 180;
    const dir = { x: Math.sin(rad), y: Math.cos(rad) }; // deg 0 = straight upfield (+y)
    let clearance = Infinity;
    for (const d of defenders) {
      const rel = sub(d.pos, carrierPlayer.pos);
      const along = dot(rel, dir);
      if (along <= 0 || along > DAYLIGHT_LOOKAHEAD_UNITS) continue; // behind him, or too far off to matter yet
      const across = len(sub(rel, scale(dir, along))); // perpendicular distance off this lane
      clearance = Math.min(clearance, across);
    }
    if (clearance > bestScore) { bestScore = clearance; bestDir = dir; } // strict >, so the first (straightest) win on a tie
  }
  return bestDir ?? { x: 0, y: 1 };
}

/** Every turn after: adaptive, not scripted. */
function planInPlay(state, offense) {
  const car = carrier(state);
  if (!car || car.team !== 'offense') {
    // Loose ball, or the defense somehow already has it: everybody goes and
    // gets it. Reuses ai.js's own lead-the-carrier / chase-the-loose-ball
    // math -- the same function the computer's pursuit brain runs on the
    // other side of the ball.
    for (const p of offense) {
      const target = pursuitTarget(state, p);
      if (!target) continue;
      const to = sub(target, p.pos);
      if (len(to) === 0) continue;
      setPlan(state, p.id, norm(to), 1);
    }
    return 'Scrambling for the ball.';
  }

  setPlan(state, car.id, daylightDirection(state, car), 1);
  applyBlocks(state, offense.filter((p) => p.id !== car.id));
  return `${car.role} finds the alley -- everybody else blocks.`;
}

export function autoplanOffense(state) {
  if (state.phase !== 'planning' || state.aiTeam === 'offense') return null;

  const offense = state.players.filter((p) => p.team === 'offense');
  // Wipe this team's own current orders first, the same way applyPlay wipes
  // the human's board before drawing a new play over it.
  for (const p of offense) { setMode(state, p.id, 'normal'); clearPlan(state, p.id); }
  // Only clear a pass that belongs to the offense -- a hot-seat coach's own
  // throw planned for the DEFENSE (after a turnover) is not this button's to
  // wipe.
  if (!state.plannedPass || getPlayer(state, state.plannedPass.from).team === 'offense') {
    clearPass(state);
  }

  const note = state.turnIndex === 0 ? planOptionSnap(state, offense) : planInPlay(state, offense);
  aimSnap(state); // restores the automatic snap-to-QB, but only if nothing above set an override (see state.js's aimSnap)
  return note;
}
