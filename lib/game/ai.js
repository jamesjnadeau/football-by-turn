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
import { sub, len, norm } from './vec.js';
import { carrier, setPlan, setMode, clearPlan, getPlayer } from './state.js';
import { smartOrders } from './defense.js';
import { setCover, clearCover } from './cover.js';
import { AI_BREAKDOWN_UNITS } from './constants.js';
import { learnedOrders } from './learned/defense-policy.js';
import { tendenciesForState } from './tendencies.js';
import { DEFENSE_GENOME } from './learned/defense-genome.js';
import { coachLearnedOffense } from './learned/offense-policy.js';
import { OFFENSE_GENOME } from './learned/offense-genome.js';
// pursuitTarget moved to pursuit.js so offense-side modules can share it
// without importing this file; re-exported so every existing importer —
// tests included — still finds it here.
export { pursuitTarget } from './pursuit.js';
import { pursuitTarget } from './pursuit.js';

/** The players the computer coaches — nobody at all in hot-seat games.
 *  An explicit `team` lets a hot-seat training harness borrow the machinery. */
export function aiPlayers(state, team = state.aiTeam) {
  if (!team) return [];
  return state.players.filter((p) => p.team === team);
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
export function applyAiModes(state, team = state.aiTeam) {
  const car = carrier(state);
  const chasing = car !== null && car.team !== team;
  for (const p of aiPlayers(state, team)) {
    const close = chasing && len(sub(car.pos, p.pos)) <= AI_BREAKDOWN_UNITS;
    const want = close ? 'prepared' : 'normal';
    if (p.mode !== want) setMode(state, p.id, want);
  }
}

/**
 * The one writer of {id, aim, cover} orders, whoever computed them. Cover
 * orders go through cover.js's setCover, so the computer's man coverage IS
 * the human's cover order; everything else becomes an ordinary full-throttle
 * plan pointed at the order's aim. clearCover runs on anyone not covering —
 * a stale assignment from last turn must not keep steering a man this turn.
 */
export function applyOrders(state, orders) {
  for (const { id, aim, cover } of orders) {
    if (cover) { setCover(state, id, cover); continue; }
    clearCover(state, id);
    if (!aim) continue;
    const to = sub(aim, getPlayer(state, id).pos);
    if (len(to) === 0) continue; // standing on the aim point: no direction to run
    setPlan(state, id, norm(to), 1);
  }
}

/** The assignment brain's orders, written into `state`. */
export function coachSmartDefense(state) {
  applyOrders(state, smartOrders(state, state.aiTeam));
}

/**
 * The learned brain's orders — the shipped genome's, shaded by whatever this
 * game knows about the coach across the table, written into `state`. A game
 * carrying no counts reads as no tendencies at all, which is byte-for-byte the
 * defense this function played before it could learn anything.
 */
export function coachLearnedDefense(state) {
  applyOrders(state, learnedOrders(
    state, state.aiTeam, DEFENSE_GENOME.values, tendenciesForState(state),
  ));
}

/** Everything the computer decides for one turn, written into `state`. */
export function coachAi(state) {
  if (!state.aiTeam) return;
  if (state.aiTeam === 'offense' && state.aiLevel === 'learned') {
    coachLearnedOffense(state, OFFENSE_GENOME.values);
    return;
  }
  applyAiModes(state);
  if (state.aiLevel === 'learned' && state.aiTeam === 'defense') {
    coachLearnedDefense(state);
    return;
  }
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

/**
 * The three settings the Defense button steps through, in cycle order, with
 * the words the board says about each. Kept here rather than in app/main.js so
 * the cycle is testable and there is exactly one place that knows a level named
 * 'smart' exists.
 *
 * Smart is first because that is what a new game starts on: the better defense
 * is the default opponent, and the pursuit brain is the one you drop to.
 */
export const AI_MODES = [
  {
    ai: 'defense',
    level: 'smart',
    label: 'Defense: computer (smart)',
    note: 'The computer plays assignment defense: the line rushes with contain, the linebacker fills, the secondary plays man with help over the top.',
  },
  {
    ai: 'defense',
    level: 'learned',
    label: 'Defense: computer (learned)',
    note: 'The computer plays its trained defense: a learned formation, learned man/zone scheme calls, and learned coverage matchups.',
  },
  {
    ai: 'defense',
    level: 'pursuit',
    label: 'Defense: computer (basic)',
    note: 'The computer sends every defender straight at the ball.',
  },
  {
    ai: 'offense',
    level: 'learned',
    label: 'Offense: computer (learned)',
    note: 'You coach the defense; the computer runs its trained offense — learned formation, run/pass calls, routes and reads.',
  },
  {
    ai: null,
    level: 'smart',
    label: 'Defense: you',
    note: 'Hot-seat: you coach both teams.',
  },
];

/**
 * Which setting the state is in. Hot-seat is hot-seat whatever `aiLevel` it
 * is carrying, so that stepping out to hot-seat and back returns you to the
 * brain you were playing. Any (team, level) pair no entry names — an old
 * save, a test's hand-rolled state — reads as the first entry rather than
 * crashing the button.
 */
export function aiModeIndex(state) {
  if (!state.aiTeam) return AI_MODES.length - 1;
  const i = AI_MODES.findIndex(
    (m) => m.ai === state.aiTeam && m.level === state.aiLevel,
  );
  return i === -1 ? 0 : i;
}

/** The setting one press of the Defense button moves to. */
export function nextAiMode(state) {
  return AI_MODES[(aiModeIndex(state) + 1) % AI_MODES.length];
}

/**
 * The mode a fresh game starts in for the choice the coach made on the home
 * screen. Playing a side means facing the learned brain on the other one;
 * training mode is the current mode left exactly as is — the smart computer
 * defense every visit dealt before sides existed. All three answers are
 * entries the mode button already cycles: this is a default, not a sixth
 * mode, and an unrecognized side falls back to the training game.
 */
export function defaultModeForSide(side) {
  if (side === 'offense') return { ai: 'defense', level: 'learned' };
  if (side === 'defense') return { ai: 'offense', level: 'learned' };
  return { ai: 'defense', level: 'smart' };
}
