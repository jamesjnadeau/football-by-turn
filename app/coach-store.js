/**
 * Where what the computer has learned about you lives between sessions: the
 * coaching log (every planning snapshot you have run a turn from) and the
 * tendency counts read off them.
 *
 * The same bargain app/playbook-store.js keeps, for the same reasons: the
 * FORMAT is pure and tested under node --test (lib/game/coach-log.js,
 * lib/game/tendencies.js) and only the plumbing is here, and every call is
 * wrapped because localStorage does not merely return null when the browser
 * has blocked site data — the property access itself throws. A coach whose
 * browser will not remember him should still get to play football against a
 * defense that has simply forgotten everything.
 */
import { parseCoachLog, serializeCoachLog } from '../lib/game/coach-log.js';
import { emptyTendencies, parseTendencies, serializeTendencies } from '../lib/game/tendencies.js';

const LOG_KEY = 'football-by-turn:coach-log';
const TENDENCY_KEY = 'football-by-turn:tendencies';

export function loadCoachLog() {
  try {
    return parseCoachLog(localStorage.getItem(LOG_KEY));
  } catch {
    return [];
  }
}

/** False when the browser refused to keep it — the caller says so out loud. */
export function saveCoachLog(log) {
  try {
    localStorage.setItem(LOG_KEY, serializeCoachLog(log));
    return true;
  } catch {
    return false;
  }
}

export function clearCoachLog() {
  try {
    localStorage.removeItem(LOG_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadTendencies() {
  try {
    return parseTendencies(localStorage.getItem(TENDENCY_KEY));
  } catch {
    return emptyTendencies();
  }
}

export function saveTendencies(counts) {
  try {
    localStorage.setItem(TENDENCY_KEY, serializeTendencies(counts));
    return true;
  } catch {
    return false;
  }
}

export function clearTendencies() {
  try {
    localStorage.removeItem(TENDENCY_KEY);
    return true;
  } catch {
    return false;
  }
}
