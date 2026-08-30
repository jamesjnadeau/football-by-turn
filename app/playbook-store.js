/**
 * Where the playbook lives between sessions. The only localStorage in the
 * repo, and the reason lib/game/playbook.js is pure: node --test has no
 * browser storage, so the format is tested there and only the plumbing is
 * here.
 *
 * Every call is wrapped, because localStorage does not merely return null when
 * the browser has blocked site data — the property access itself throws, and an
 * exception at module scope would take the whole game down with it. A coach who
 * cannot persist his plays should still get to play football.
 */
import { emptyPlaybook, parsePlaybook, serializePlaybook } from '../lib/game/playbook.js';

const KEY = 'football-by-turn:playbook';

export function loadPlaybook() {
  try {
    return parsePlaybook(localStorage.getItem(KEY));
  } catch {
    return emptyPlaybook();
  }
}

/** False when the browser refused to keep it — the caller says so out loud. */
export function savePlaybook(playbook) {
  try {
    localStorage.setItem(KEY, serializePlaybook(playbook));
    return true;
  } catch {
    return false;
  }
}
