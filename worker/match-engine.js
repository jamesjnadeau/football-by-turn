/**
 * One match's whole life, as a plain function of (record, message, now) ->
 * (new record, messages to send). No sockets, no timers, no platform API --
 * worker/match-do.js is the thin shell that turns these into real WebSocket
 * traffic and a real Durable Object alarm. Same discipline lib/game/turn.js's
 * runTurn and lib/game/home.js's markup both already follow.
 *
 * `now` is always handed in rather than read from Date.now() in here, for
 * the same reason runTurn takes `random` rather than rolling its own dice:
 * a test has to be able to name the exact millisecond a deadline landed on.
 */
import { createGame, serializeState, hydrateState } from '../lib/game/state.js';
import { applyPlay, sanitizePlay } from '../lib/game/play.js';
import { runTurn } from '../lib/game/turn.js';
import { nextDown } from '../lib/game/rules.js';
import { mulberry32 } from '../lib/game/rng.js';

export const HUDDLE_SECONDS = 30;    // spec: first turn of a down -- formations are being set
export const TURN_CLOCK_SECONDS = 12; // spec: every turn after -- adjusting a picture already drawn
export const CONNECT_TIMEOUT_MS = 15_000; // spec: a match nobody completes within this dissolves
export const FLUSH_GRACE_MS = 2_000;      // spec: how long timeUp waits for a last-second commit
export const DROP_GRACE_MS = 20_000;      // spec: how long a dropped coach's seat is held

export function createMatch({ matchId, variant, seed, tokens }) {
  return {
    matchId, variant, seed,
    status: 'waiting',
    tokens,
    connected: { offense: false, defense: false },
    state: null,
    lastCommitted: { offense: null, defense: null },
    committed: { offense: null, defense: null },
    deadlineAt: null,
    disconnectedAt: { offense: null, defense: null },
    reason: null,
  };
}

const OTHER = { offense: 'defense', defense: 'offense' };

function bothConnected(record) {
  return record.connected.offense && record.connected.defense;
}

function startMatch(record, now) {
  const state = createGame({ seed: record.seed, variant: record.variant });
  const deadlineAt = now + HUDDLE_SECONDS * 1000;
  const next = { ...record, status: 'active', state, deadlineAt };
  const messages = ['offense', 'defense'].map((side) => ({
    to: side, type: 'start', seed: record.seed, variant: record.variant,
    losYard: state.losYard, side, deadlineAt,
  }));
  return { record: next, messages };
}

export function applyMatchMessage(record, message, now) {
  if (message.type === 'connect') {
    if (record.tokens[message.side] !== message.token) {
      return { record, messages: [{ to: message.side, type: 'refused' }] };
    }
    const connected = { ...record.connected, [message.side]: true };
    const withConnect = { ...record, connected };
    if (record.status === 'waiting' && bothConnected(withConnect)) {
      return startMatch(withConnect, now);
    }
    return { record: withConnect, messages: [] };
  }

  if (message.type === 'connectTimeout') {
    if (record.status !== 'waiting') return { record, messages: [] };
    const waitingSide = record.connected.offense ? 'offense'
      : record.connected.defense ? 'defense' : null;
    if (waitingSide === null) return { record, messages: [] };
    const next = { ...record, status: 'over', reason: 'no-opponent' };
    return { record: next, messages: [{ to: waitingSide, type: 'matchOver', reason: 'no-opponent' }] };
  }

  if (record.status !== 'active') return { record, messages: [] };

  if (message.type === 'commit') {
    if (message.turnIndex !== record.state.turnIndex) return { record, messages: [] };
    const play = sanitizePlay(message.play);
    if (!play) return { record, messages: [] };
    const state = cloneState(record.state);
    // placeFormation (inside applyPlay) is the same placement rule the board
    // enforces during repositioning -- a spot it refuses is simply skipped,
    // the way an illegal drag is: the rest of the play still applies.
    applyPlay(state, play, message.side);
    const committed = { ...record.committed, [message.side]: play };
    const withCommit = { ...record, state, committed };
    if (committed.offense !== null && committed.defense !== null) {
      return runResolvedTurn(withCommit, now);
    }
    return { record: withCommit, messages: [] };
  }

  if (message.type === 'alarm') {
    if (record.status !== 'active') return { record, messages: [] };
    const filled = fillFromLastCommitted(record);
    const withFilled = { ...record, state: filled };
    return runResolvedTurn(withFilled, now);
  }

  return { record, messages: [] };
}

function cloneState(state) {
  return hydrateState(serializeState(state));
}

export function stripForSide(state, side) {
  const stripped = cloneState(state);
  for (const p of stripped.players) {
    if (p.team === side) continue;
    p.plan = null;
    p.cover = null;
  }
  if (stripped.plannedPass && stripped.plannedPass.from
    && getTeamOf(stripped, stripped.plannedPass.from) !== side) {
    stripped.plannedPass = null;
  }
  return stripped;
}

function getTeamOf(state, id) {
  return state.players.find((p) => p.id === id)?.team ?? null;
}

/**
 * Fill in whatever the deadline caught missing, from each side's last
 * committed play -- or leave a side untouched if it has never committed at
 * all (spec: "there is nothing to replay"). Two rules, both named in the
 * spec and both already precedented by lib/game/ai.js's applyScriptedOrders:
 * a replayed play's SPOTS are dropped (repositioning is a pre-snap act, and
 * turn.js's canReposition already refuses a spot past turn 0 -- applyPlay's
 * placeFormation call would simply skip them, but dropping them here means a
 * replay never even LOOKS like it tried to reposition anyone), and a replayed
 * STANCE is set only where it differs from the player's current mode, so a
 * quiet coach does not collect a fresh charge bonus every turn he is replayed.
 */
function fillFromLastCommitted(record) {
  let state = record.state;
  for (const side of ['offense', 'defense']) {
    if (record.committed[side] !== null) continue; // this turn's own commit wins
    const last = record.lastCommitted[side];
    if (!last) continue; // never committed: keep whatever orders he already has
    state = cloneState(state);
    const trimmedStances = {};
    for (const [id, stance] of Object.entries(last.stances)) {
      const current = state.players.find((p) => p.id === id);
      if (current && current.mode !== stance.mode) trimmedStances[id] = stance;
    }
    applyPlay(state, { ...last, spots: {}, stances: trimmedStances }, side);
  }
  return state;
}

function runResolvedTurn(record, now) {
  const random = mulberry32(record.seed + record.state.turnIndex);
  const state = cloneState(record.state);
  const { frames, events } = runTurn(state, random);
  if (state.phase === 'playOver') {
    // The whistle already ran (a score, a turnover, a down that just ended);
    // nextDown deals the next one or ends the game, the same call goToNextDown
    // makes in single-player.
    nextDown(state);
  }
  const lastCommitted = {
    offense: record.committed.offense ?? record.lastCommitted.offense,
    defense: record.committed.defense ?? record.lastCommitted.defense,
  };
  const deadlineAt = now + TURN_CLOCK_SECONDS * 1000;
  const next = {
    ...record, state, lastCommitted, committed: { offense: null, defense: null }, deadlineAt,
    status: state.phase === 'gameOver' ? 'over' : record.status,
    reason: state.phase === 'gameOver' ? 'down' : record.reason,
  };
  const messages = ['offense', 'defense'].map((side) => ({
    to: side, type: 'turn', frames, events, down: state.down, deadlineAt,
    state: stripForSide(state, side),
  }));
  return { record: next, messages };
}
