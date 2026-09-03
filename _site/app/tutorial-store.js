/**
 * Whether this coach has been through the tutorial. Kept in the browser like
 * the playbook, the coaching log and the trained genomes are, and for the same
 * reason: it is a fact about the person, not about the drive.
 *
 * A browser may refuse storage outright (private mode, a blocked origin), and a
 * coach who cannot be remembered should still be able to play — so every access
 * fails soft, and a refusal reads as "not done yet".
 */
const KEY = 'football-by-turn:tutorial-done';

export function loadTutorialDone() {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function saveTutorialDone() {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // Nothing to do and nothing worth saying: the tutorial still ran.
  }
}
