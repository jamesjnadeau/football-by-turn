/**
 * The game state: plain serializable data plus the mutating helpers the
 * planning phase uses. Nothing here steps time — that's turn.js — and
 * nothing here rolls dice.
 */
import { fieldPos } from './view.js';
import { headingOf } from './modes.js';
import { RADIUS_LINE, RADIUS_MID, RADIUS_SKILL, TEAM_SIZE } from './constants.js';

/**
 * One drive-start formation per team, positions in yards relative to the
 * LOS (across from centre, downfield from the LOS). Exactly TEAM_SIZE
 * entries each; edit here (and only here) to change team size.
 */
const OFFENSE = [
  { id: 'o-c', role: 'C', radius: RADIUS_LINE, across: 0, down: -1 },
  { id: 'o-lg', role: 'LG', radius: RADIUS_LINE, across: -2.5, down: -1 },
  { id: 'o-rg', role: 'RG', radius: RADIUS_LINE, across: 2.5, down: -1 },
  { id: 'o-wr1', role: 'WR', radius: RADIUS_SKILL, across: -15, down: -1 },
  { id: 'o-wr2', role: 'WR', radius: RADIUS_SKILL, across: 15, down: -1 },
  { id: 'o-qb', role: 'QB', radius: RADIUS_MID, across: 0, down: -4 },
  { id: 'o-rb', role: 'RB', radius: RADIUS_SKILL, across: 0, down: -7 },
];

const DEFENSE = [
  { id: 'd-nt', role: 'NT', radius: RADIUS_LINE, across: 0, down: 1 },
  { id: 'd-dt1', role: 'DT', radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: 'd-dt2', role: 'DT', radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: 'd-cb1', role: 'CB', radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: 'd-cb2', role: 'CB', radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: 'd-lb', role: 'LB', radius: RADIUS_MID, across: 0, down: 4 },
  { id: 'd-s', role: 'S', radius: RADIUS_SKILL, across: 0, down: 8 },
];

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
    // The id of the opponent this player has been told to cover, or null. A
    // cover order and a movement arrow are alternatives, not layers: setPlan
    // clears this, and setCover writes the plan.
    cover: null,
    tackleCooldown: 0,
  };
}

export function formationPlayers(losYard) {
  if (OFFENSE.length !== TEAM_SIZE || DEFENSE.length !== TEAM_SIZE) {
    throw new Error(`formations must have exactly TEAM_SIZE=${TEAM_SIZE} players`);
  }
  return [
    ...OFFENSE.map((s) => makePlayer(s, 'offense', losYard)),
    ...DEFENSE.map((s) => makePlayer(s, 'defense', losYard)),
  ];
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
 */
export function createGame({ seed = 1, ai = null, aiLevel = 'pursuit' } = {}) {
  return {
    seed,
    aiTeam: ai,
    // Which brain coaches `aiTeam`: 'pursuit' (ai.js — everyone at the ball)
    // or 'smart' (defense.js — assignment football). The default is the older
    // one so the library's semantics, and every test written against them,
    // stay exactly as they were; app/main.js is what opts the played game into
    // 'smart'.
    aiLevel,
    down: 1,
    losYard: 0,
    phase: 'planning',
    turnIndex: 0,
    players: formationPlayers(0),
    ball: { carrierId: 'o-qb', pos: null, vel: null },
    // A throw planned for this turn, the down's forward-pass tally, and the
    // flag it may have earned. All three are per-down: nextDown resets them.
    plannedPass: null,
    forwardPasses: 0,
    penalty: null,
    deadReason: null,
    result: null,
  };
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
    (mode === 'tucked' && state.ball.carrierId === id) ||
    (mode === 'prepared' && p.team === 'defense') ||
    (mode === 'holding' && p.team === 'offense');
  if (!legal) return false;
  p.mode = mode;
  p.charge = mode === 'normal' ? 0 : 1;
  p.facing = mode === 'normal' ? null : headingOf(p);
  return true;
}

/** Click-to-move, legal only before the play's first turn and on your own side. */
export function placePlayer(state, id, pos) {
  if (state.phase !== 'planning' || state.turnIndex !== 0) return false;
  const p = getPlayer(state, id);
  const losY = fieldPos(0, state.losYard).y;
  const onOwnSide = p.team === 'offense' ? pos.y < losY : pos.y > losY;
  if (!onOwnSide) return false;
  p.pos = pos;
  return true;
}

/** Whether the human may give this player orders. The computer's team is off limits. */
export function isControllable(state, id) {
  return getPlayer(state, id).team !== state.aiTeam;
}

/**
 * Plan a throw for this turn. Only whoever is holding the ball may throw, so a
 * player who is not the carrier is refused — the caller names him, rather than
 * the function quietly substituting whoever happens to have the ball. Only one
 * throw is planned at a time: a second call replaces the first, exactly as a
 * second drag replaces a movement arrow. `power` is the drag's throttle in
 * [0,1]; pass.js's releasePass is what turns it into a speed.
 */
export function setPass(state, id, dir, power) {
  if (state.ball.carrierId !== id) return false;
  state.plannedPass = { from: id, dir, power };
  return true;
}

export function clearPass(state) {
  state.plannedPass = null;
}
