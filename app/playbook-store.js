/**
 * Where the playbooks live between sessions. The only localStorage in the
 * repo, and the reason lib/game/playbook.js is pure: node --test has no
 * browser storage, so the format is tested there and only the plumbing is
 * here.
 *
 * One key holds both books — one read, one write, one version number, one
 * migration. The key has not changed since there was only one book, which is
 * what lets a coach's existing five plays come back as his offense's.
 *
 * Every call is wrapped, because localStorage does not merely return null when
 * the browser has blocked site data — the property access itself throws, and an
 * exception at module scope would take the whole game down with it. A coach who
 * cannot persist his plays should still get to play football.
 */
import { emptyLibrary, parseLibrary, serializeLibrary } from '../lib/game/playbook.js';

const KEY = 'football-by-turn:playbook';

export function loadLibrary() {
  try {
    return parseLibrary(localStorage.getItem(KEY));
  } catch {
    return emptyLibrary();
  }
}

/** False when the browser refused to keep it — the caller says so out loud. */
export function saveLibrary(library) {
  try {
    localStorage.setItem(KEY, serializeLibrary(library));
    return true;
  } catch {
    return false;
  }
}
