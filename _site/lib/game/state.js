/**
 * The game state: plain serializable data plus the mutating helpers the
 * planning phase uses. Nothing here steps time — that's turn.js — and
 * nothing here rolls dice.
 */
import { fieldPos, GOAL_YARD } from './view.js';
import { headingOf } from './modes.js';
import { sub, len, norm } from './vec.js';
// The closed form of a loose ball's flight, from the module that owns it.
// pass.js imports this file, so it cannot be the one to hand it over.
import { powerForTravel, spawnOffset } from './flight.js';
import {
  getRoster, DEFAULT_VARIANT, OFFENSIVE_LINE_ROLES, offenseSize, defenseSize,
} from './rosters.js';
// Re-exported so play.js can name a default variant without reaching past this
// module — state.js stays the layer everything else reads the game from.
export { DEFAULT_VARIANT };
import { DRIVE_START_YARD, FIRST_DOWN_YARDS } from './constants.js';
import { maybeApplyLearnedFormations } from './learned/formation.js';

/**
 * The snap runs between these two. Named here rather than in rosters.js
 * because they are the same two men in every game this page deals — a variant
 * that had no centre or nobody under him would be a different sport.
 * formationPlayers refuses to build a roster missing either of them.
 */
export const SNAPPER_ID = 'o-c';
export const SNAP_TARGET_ID = 'o-qb';

function makePlayer(spec, team, losYard) {
  return {
    id: spec.id,
    team,
    role: spec.role,
    radius: spec.radius,
    mass: spec.radius * spec.radius,
    pos: fieldPos(spec.across, losYard + spec.down),
    vel: { x: 0, y: 0 },
    plan: null,
    mode: 'normal',
    charge: 0,
    facing: null,
    // Whether this player is currently inside a driving blocker's assist
    // aura — recomputed every sub-step by block.js's applyCutBlockAssist,
    // never set by hand. Defaulted here so modes.js's maxSpeed/accelMult
    // never read `undefined` off a player nobody has scanned yet.
    cutBlockAssist: false,
    // The id of the opponent this player has been told to cover, or null. A
    // cover order and a movement arrow are alternatives, not layers: setPlan
    // clears this, and setCover writes the plan.
    cover: null,
    tackleCooldown: 0,
  };
}

/**
 * The defense half of formationPlayers, alone: what a personnel-package
 * change (formation.js's setPersonnel) rebuilds when the offense already has
 * its own drags on the board and a fresh formationPlayers() call would throw
 * them away by reseating both sides at once.
 */
export function defensePlayers(losYard, variantId = DEFAULT_VARIANT) {
  const roster = getRoster(variantId);
  if (roster.defense.length !== defenseSize(roster)) {
    throw new Error(`variant "${roster.id}" must field ${defenseSize(roster)} on defense`);
  }
  return roster.defense.map((s) => makePlayer(s, 'defense', losYard));
}

/**
 * Both teams at the snap, built from the named variant's roster. rosters.js is
 * the only place a formation is written down; this is the only place one is
 * built.
 */
export function formationPlayers(losYard, variantId = DEFAULT_VARIANT) {
  const roster = getRoster(variantId);
  if (roster.offense.length !== offenseSize(roster)) {
    throw new Error(`variant "${roster.id}" must field ${offenseSize(roster)} on offense`);
  }
  // A roster with nobody to snap the ball, or nobody to snap it to, would open
  // every down with the ball stuck in a lineman's hands and no way to start —
  // aimSnap simply gives up. Better to fail here, where the roster is written.
  for (const id of [SNAPPER_ID, SNAP_TARGET_ID]) {
    if (!roster.offense.some((spec) => spec.id === id)) {
      throw new Error(`variant "${roster.id}" has no "${id}" to take the snap`);
    }
  }
  return [
    ...roster.offense.map((s) => makePlayer(s, 'offense', losYard)),
    ...defensePlayers(losYard, variantId),
  ];
}

/**
 * A variant's drive-start formation as football coordinates, by id — what
 * `formationPlayers` builds every down out of, before anybody drags anyone.
 * The ids are shared between variants but the spots are not (the flanker and
 * the linebackers stand differently in each), so the variant has to be named.
 * Exported because play.js has to be able to tell a formation the coach SET
 * from the one the down handed him: a play with nothing in it but the spots
 * everyone already occupies is an empty play.
 */
export function defaultSpots(variantId = DEFAULT_VARIANT) {
  const roster = getRoster(variantId);
  const out = {};
  for (const s of [...roster.offense, ...roster.defense]) {
    out[s.id] = { across: s.across, down: s.down };
  }
  return out;
}

/**
 * `ai` names the team the computer coaches — 'defense', or null for hot-seat,
 * where the human plans both sides. Stored as `aiTeam`; every AI check in the
 * codebase reads that one field, so coaching the offense one day is a value
 * change, not a rename. The default is null so the library's own semantics —
 * and every test written against them — stay exactly as they were; app/main.js
 * is what opts the played game in.
 *
 * `aiLevel` names which brain coaches that team — see the field's own comment.
 *
 * `genomeOverrides` is `{defense, offense}` — trained genome values to play
 * instead of the shipped ones, either side null for "ship's own". See
 * learned/active.js.
 */
export function createGame({
  seed = 1, ai = null, aiLevel = 'pursuit', variant = DEFAULT_VARIANT,
  genomeOverrides = null, losYard = DRIVE_START_YARD, scriptedOrders = null,
} = {}) {
  const state = {
    seed,
    aiTeam: ai,
    // Which game this is: the same id the home screen's button carries.
    // Resolved through getRoster rather than stored raw, so an unknown name
    // never survives into the state where nextDown would rebuild the field
    // from it every down.
    variantId: getRoster(variant).id,
    // Which brain coaches `aiTeam`: 'pursuit' (ai.js — everyone at the ball)
    // or 'smart' (defense.js — assignment football). The default is the older
    // one so the library's semantics, and every test written against them,
    // stay exactly as they were; app/main.js is what opts the played game into
    // 'smart'.
    aiLevel,
    down: 1,
    losYard,
    // The absolute yard this set of downs must reach for a fresh one. Reset by
    // nextDown (rules.js) on every first down; clamped to the goal line itself
    // inside the 10, which is what makes "goal to go" fall out for free rather
    // than needing a special case.
    toGoYard: Math.min(losYard + FIRST_DOWN_YARDS, GOAL_YARD),
    phase: 'planning',
    turnIndex: 0,
    players: formationPlayers(losYard, variant),
    ball: { carrierId: SNAPPER_ID, pos: null, vel: null },
    // A throw planned for this turn, the down's forward-pass tally, and the
    // flag it may have earned. All three are per-down: nextDown resets them.
    plannedPass: null,
    // The computer offense's play memory: the call it made at the snap
    // ({call, side?, give?}), so turn three still knows what turn zero
    // decided. Plain serializable data, per-down, like plannedPass — see
    // learned/offense-policy.js. null whenever no learned offense is playing.
    aiPlay: null,
    // What this coach keeps doing, as counts (lib/game/tendencies.js), or
    // null. Plain serializable data like everything else here; the app is
    // what loads it out of storage and hands it over, because the counts
    // outlive the game the way the playbook does. Only the learned DEFENSE
    // reads it — see ai.js's coachLearnedDefense.
    tendencyCounts: null,
    // The other side's authored orders, by turn index, or null — what ai.js's
    // 'scripted' level plays. Plain serializable data handed in, exactly like
    // tendencyCounts and genomeOverrides, and for the same reason: nothing
    // under lib/ may reach out for it, so the caller brings it.
    scriptedOrders,
    // A genome trained in this browser (app/train-worker.js), per side, or
    // null for the one this build ships. Plain serializable data like
    // tendencyCounts, and handed over for the same reason: learned/active.js
    // is what reads it, and nothing under lib/ may read a browser's storage.
    // Taken as an option rather than assigned afterwards because
    // maybeApplyLearnedFormations runs below, before this function returns —
    // an override that arrived late would miss the first down's formation.
    genomeOverrides: {
      defense: genomeOverrides?.defense ?? null,
      offense: genomeOverrides?.offense ?? null,
    },
    forwardPasses: 0,
    penalty: null,
    deadReason: null,
    result: null,
  };
  // A learned-level computer stands its own formation before the snap is
  // aimed, so the aim is taken from the spots everyone will actually occupy.
  maybeApplyLearnedFormations(state);
  aimSnap(state);
  return state;
}

/**
 * Plan the snap: the man holding the ball tosses it back to the man behind him.
 *
 * The centre starts every down with the ball, so a down that opened with no
 * orders would open with the ball in a lineman's hands and nothing happening.
 * This is the one order a coach does not have to give -- it is how a play
 * starts, not a choice he makes -- so it goes on for him, and goes back on
 * whenever it is wiped: a new down, Clear Arrows, a called play, or a move by
 * either man, since the aim is worked out from where the two are standing and
 * moving one makes the old aim wrong.
 *
 * `auto` is what stops that trampling the coach. A throw HE set replaces this
 * one and is left alone thereafter; only an aim this function put on is ever
 * re-aimed.
 *
 * The power is solved, not picked. A loose ball's whole flight is closed-form
 * -- speed * DT / (1 - BALL_FRICTION) -- so the speed that carries it from the
 * passer's hands to his target is that read backwards. It usually comes out
 * under PASS_SPEED_MIN and clamps there, which is right: the slowest throw in
 * the game still covers 4.4 yards, further than a centre stands from his
 * quarterback, so the ball is taken in flight rather than off the ground.
 *
 * `dir` and `power` are computed here from where the two men are standing NOW,
 * at the moment the huddle breaks -- but `target` is what actually decides
 * where the ball goes. releasePass re-aims any throw carrying a target at the
 * whistle, walking the quarterback's own route to find where he will meet it,
 * so a drop-back arrow on him leads the throw instead of firing at the spot he
 * has already left. `dir`/`power` survive as the fallback for the one case a
 * target cannot cover: a formation with no quarterback on it at all.
 */
export function aimSnap(state) {
  if (state.phase !== 'planning' || state.turnIndex !== 0) return false;
  if (state.plannedPass && !state.plannedPass.auto) return false; // the coach's own call
  if (state.ball.carrierId !== SNAPPER_ID) return false;
  const from = state.players.find((p) => p.id === SNAPPER_ID);
  const to = state.players.find((p) => p.id === SNAP_TARGET_ID);
  if (!from || !to) return false;

  const gap = sub(to.pos, from.pos);
  const distance = len(gap);
  if (distance === 0) return false;
  // The ball leaves his leading edge, not his centre, so that head start comes
  // off the flight it has to make. `Infinity` because the snap has no deadline:
  // it only has to reach a man a few feet away, and it gets there when it gets
  // there — unlike a lock-on, which is sized to arrive inside the turn.
  const travel = Math.max(0, distance - spawnOffset(from));
  const power = powerForTravel(travel, Infinity);

  state.plannedPass = {
    from: SNAPPER_ID, dir: norm(gap), power, auto: true, target: SNAP_TARGET_ID,
  };
  return true;
}

export function getPlayer(state, id) {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`unknown player "${id}"`);
  return p;
}

export function carrier(state) {
  return state.ball.carrierId === null ? null : getPlayer(state, state.ball.carrierId);
}

export function ballPos(state) {
  const c = carrier(state);
  return c ? c.pos : state.ball.pos;
}

/**
 * `target` is where this plan actually puts him at the whistle, and `short`
 * says whether he was pointed further than that — the two together are what
 * render.js draws: the circle always, plus the old arrow when he is still
 * running at the whistle. Both are computed by lib/game/predict.js and stored
 * rather than recomputed at paint time, so render.js stays a pure function of
 * the state and nothing is simulated twice. Plans made by the computer (ai.js)
 * and by tests pass neither and get a null target, which draws the old arrow on
 * its own — there is no prediction to show.
 */
export function setPlan(state, id, dir, throttle, target = null, short = false) {
  const p = getPlayer(state, id);
  p.plan = { dir, throttle, target, short };
  p.cover = null; // a fresh arrow is a fresh order: he is not covering anyone now
}

export function clearPlan(state, id) {
  getPlayer(state, id).plan = null;
}

export function clearAllPlans(state) {
  for (const p of state.players) {
    p.plan = null;
    p.cover = null;
  }
  state.plannedPass = null;
  // Clear Arrows wipes the orders the coach gave. The snap is not one of
  // those, so it goes straight back on -- clearing the board should leave a
  // down that can still start, not a centre standing on the ball.
  aimSnap(state);
}

/**
 * Mode legality is the spec's: tucking is something the runner does with the
 * ball; preparing to tackle is a defensive stance; defend-position is an
 * offensive one. Setting any non-normal mode arms `charge`, the next-turn
 * burst the spec grants for having set your feet.
 *
 * Committing to any of these also FREEZES an axis into `facing` — the way he
 * was headed at that instant. Everything the stance is worth hangs off it:
 * full speed along it, a shuffle across it, and (for a prepared defender only)
 * double reach in the wedge ahead of it. It has to be frozen rather than read
 * live, or "full speed the way you're headed" would be satisfied by every
 * arrow the player draws and the stance would cost nothing.
 */
export function setMode(state, id, mode) {
  const p = getPlayer(state, id);
  const legal =
    mode === 'normal' ||
    (mode === 'tucked' && state.ball.carrierId === id && !OFFENSIVE_LINE_ROLES.has(p.role)) ||
    (mode === 'prepared' && p.team === 'defense') ||
    (mode === 'holding' && p.team === 'offense') ||
    // The cut block ("tucked special"): a lineman's own snap-count stance,
    // not something drawn up mid-down — see block.js for what committing to
    // it actually does.
    (mode === 'cutBlock' && p.team === 'offense'
      && OFFENSIVE_LINE_ROLES.has(p.role) && state.turnIndex === 0);
  if (!legal) return false;
  p.mode = mode;
  p.charge = mode === 'normal' ? 0 : 1;
  // Committing to a cut block does not throw it yet — the shove itself waits
  // for the turn to actually start (turn.js's applyPendingCutBlocks), so a
  // coach can still see final pre-snap positions before Run Turn commits
  // anyone to anything.
  p.facing = mode === 'normal' ? null : headingOf(p);
  return true;
}

/**
 * Whether the human at THIS browser may give this player orders. Two teams
 * are off limits: the computer's (`aiTeam`), unchanged from single-player,
 * and -- in a multiplayer match -- the other human's (`remoteTeam`, set by
 * app/main.js's startGame when a `net` handle is present, never by anything
 * under lib/). A single-player game never sets remoteTeam, so this reads
 * exactly as it always has for every existing caller.
 */
export function isControllable(state, id) {
  const team = getPlayer(state, id).team;
  return team !== state.aiTeam && team !== state.remoteTeam;
}

/**
 * Plan a throw for this turn. Only whoever is holding the ball may throw, so a
 * player who is not the carrier is refused — the caller names him, rather than
 * the function quietly substituting whoever happens to have the ball. Only one
 * throw is planned at a time: a second call replaces the first, exactly as a
 * second drag replaces a movement arrow. `power` is the drag's throttle in
 * [0,1]; pass.js's releasePass is what turns it into a speed.
 *
 * `target` is the id of the receiver this throw is locked onto, or null. It
 * changes nothing about how the ball flies — releasePass reads `dir` and
 * `power` like it always has — but it is what tells the board to draw the lock
 * instead of a bare arrow, and what tells releasePass this throw is aimed at a
 * man and must therefore stay in his reach rather than arcing over him.
 */
export function setPass(state, id, dir, power, target = null) {
  if (state.ball.carrierId !== id) return false;
  state.plannedPass = { from: id, dir, power, target };
  return true;
}

export function clearPass(state) {
  state.plannedPass = null;
}

/**
 * The state as plain JSON-safe data — a deep copy, not a view. A match's
 * Durable Object calls this after every turn to persist the authoritative
 * state (so a hibernated instance can wake up and keep refereeing) and to
 * build the tailored snapshot each client is sent (worker/match-engine.js's
 * stripForSide starts from this). structuredClone is exactly the "deep copy
 * of plain data" this state already is -- there is nothing here it cannot
 * clone, which Task 1's own round-trip test is what proves rather than
 * assumes.
 */
export function serializeState(state) {
  return structuredClone(state);
}

/**
 * The inverse: a state built by serializeState, back as a live state. Refuses
 * anything that is not at least shaped like one, because this is the one
 * place a corrupt or truncated Durable Object storage read would otherwise
 * turn into a state with `players` missing and every downstream function
 * throwing from a different, more confusing place.
 */
export function hydrateState(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.players)) {
    throw new Error('hydrateState: not a serialized state');
  }
  return structuredClone(data);
}
