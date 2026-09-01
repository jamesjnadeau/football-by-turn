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
import { createGame, serializeState } from '../lib/game/state.js';

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

  // Task 7 fills in 'commit'.
  return { record, messages: [] };
}
