/**
 * Where a genome trained in this browser lives between sessions — one key per
 * side, each holding one serialized bundle.
 *
 * The same bargain app/coach-store.js and app/playbook-store.js keep: the
 * FORMAT is pure and tested under node --test (lib/game/train/bundle.js) and
 * only the plumbing is here, and every call is wrapped because localStorage
 * does not merely return null when the browser has blocked site data — the
 * property access itself throws. A coach whose browser will not remember him
 * should still get to play football against the genome this build ships.
 *
 * Stored as the whole BUNDLE and not just its values, so that Copy trained
 * genome still hands over a complete, importable file after a reload — the
 * meta is what tells the maintainer what he is looking at.
 */
import { parseBundle, serializeBundle } from '../lib/game/train/bundle.js';

const KEY = {
  defense: 'football-by-turn:genome:defense',
  offense: 'football-by-turn:genome:offense',
};

/** Anything that is not a valid bundle for this side reads as no bundle:
 *  a genome saved by an older build is a genome this one cannot play. */
function loadOne(side) {
  try {
    const { bundle } = parseBundle(localStorage.getItem(KEY[side]));
    return bundle && bundle.side === side ? bundle : null;
  } catch {
    return null;
  }
}

export function loadGenomeBundles() {
  return { defense: loadOne('defense'), offense: loadOne('offense') };
}

/** False when the browser refused to keep it — the caller says so out loud. */
export function saveGenomeBundle(side, bundle) {
  try {
    localStorage.setItem(KEY[side], serializeBundle(bundle));
    return true;
  } catch {
    return false;
  }
}

/** Both sides, always — a coach asking for the shipped AI back does not mean
 *  half of it. */
export function clearGenomeBundles() {
  try {
    localStorage.removeItem(KEY.defense);
    localStorage.removeItem(KEY.offense);
    return true;
  } catch {
    return false;
  }
}

/** The two bundles as the plain data `state.genomeOverrides` wants. */
export function overrideValues(bundles) {
  return {
    defense: bundles.defense ? bundles.defense.values : null,
    offense: bundles.offense ? bundles.offense.values : null,
  };
}
