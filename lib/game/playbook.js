/**
 * The playbook: PLAY_SLOTS fixed slots for one side of the ball, and the
 * versioned JSON they survive a reload as. A playbook is an array; a slot is a
 * play or null. A LIBRARY holds one pair of books — offense and defense — per
 * variant, because a play is orders for named men standing at spots a
 * formation put them at, and both the names and the spots change with the
 * variant you're fielding: an 11-man sweep called into a 7-man game is five
 * arrows for a formation that variant doesn't have. Pure — this file knows
 * what a playbook IS, and app/playbook-store.js is the only thing that knows
 * where one is kept.
 *
 * Version 2 added `spots` — a play carries the formation it was called from,
 * not just its arrows. Version 3 split the one book into two. Version 4 split
 * those two books per variant, because a saved play only ever fits the
 * formation it was captured from. All older versions survive reading, because
 * a coach's five plays outlive a format change: a version-1 play is a play
 * with no formation in it, which sanitizePlay already reads as `spots: {}`; a
 * version-1 or -2 BOOK is the offense's, because until sides existed the coach
 * was always the offense; and a version-3 library — offense and defense with
 * no variant of their own — is read as the 7-man variant's, because 7-man is
 * the only game there was until variants existed. Writing is always the
 * current version.
 */
import { sanitizePlay } from './play.js';
import { coachedSide } from './hud.js';
import { VARIANTS } from './variants.js';
import { DEFAULT_VARIANT } from './rosters.js';

export const PLAY_SLOTS = 5;
export const PLAYBOOK_VERSION = 4;

/** The books a library holds, in the order they are stored in. */
export const BOOK_SIDES = ['offense', 'defense'];

/** The variants a library holds a pair of books for. */
export const LIBRARY_VARIANTS = VARIANTS.map((v) => v.id);

/** Versions this build can read. Writing is always the current one. */
const READABLE = new Set([1, 2, 3, 4]);

export function emptyPlaybook() {
  return Array.from({ length: PLAY_SLOTS }, () => null);
}

/** A fresh book for each side. Two arrays, never one array twice. */
function emptyBookPair() {
  return { offense: emptyPlaybook(), defense: emptyPlaybook() };
}

/** A fresh book pair for each variant. Never one array shared between two. */
export function emptyLibrary() {
  const out = {};
  for (const id of LIBRARY_VARIANTS) out[id] = emptyBookPair();
  return out;
}

/** The lowest unused slot, or -1 when every one is taken. */
export function firstEmptySlot(playbook) {
  return playbook.findIndex((slot) => slot === null);
}

/**
 * A copy of the playbook with `slot` set to `play`. A slot outside the five
 * returns the playbook unchanged rather than growing the array: five slots is
 * the contract, and the slot number comes from a prompt the coach typed.
 */
export function putPlay(playbook, slot, play) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PLAY_SLOTS) return playbook;
  const next = playbook.slice();
  next[slot] = play;
  return next;
}

/**
 * The book for one side of the ball in one variant. A variant or side there is
 * no book for reads as an empty book rather than as undefined: the caller is
 * about to index five slots off this, and a menu of five empty buttons is a
 * better answer than a crash.
 */
export function bookFor(library, variantId, side) {
  if (!BOOK_SIDES.includes(side)) return emptyPlaybook();
  return library[variantId]?.[side] ?? emptyPlaybook();
}

/**
 * A copy of the library with `side`'s book replaced for one variant. A copy,
 * for the same reason putPlay makes one: two books must never come to share an
 * array, or saving a play while coaching the offense would file it with the
 * defense's as well, which is the exact bug this shape exists to prevent —
 * and the same goes for two variants sharing a book, which would let a
 * 7-man play turn up in an 11-man game.
 */
export function putBook(library, variantId, side, book) {
  if (!LIBRARY_VARIANTS.includes(variantId) || !BOOK_SIDES.includes(side)) return library;
  const pair = library[variantId] ?? emptyBookPair();
  return { ...library, [variantId]: { ...pair, [side]: book } };
}

/**
 * Which book the coach is looking at: the one for the side he is coaching.
 * Derived from the state every time it is asked rather than stored anywhere,
 * so the mid-game Defense button — which can hand him the other side of the
 * ball — moves him to the other book with it.
 *
 * Hot-seat coaches both teams and so has no side of its own; it reads as the
 * offense's book, the same call hud.js makes when it gives hot-seat the
 * offense's kickoff line. The drive is still yours to script.
 */
export function playbookSide(state) {
  return coachedSide(state);
}

/**
 * What the menu's Plays heading says. Without it, handing the computer the
 * other team would silently relabel five slot buttons and a coach would think
 * his plays had been eaten.
 */
export function playbookHeading(state) {
  return playbookSide(state) === 'defense' ? 'Plays — Defense' : 'Plays — Offense';
}

export function serializeLibrary(library) {
  const variants = {};
  for (const id of LIBRARY_VARIANTS) {
    const pair = library[id] ?? emptyBookPair();
    variants[id] = { offense: pair.offense, defense: pair.defense };
  }
  return JSON.stringify({ v: PLAYBOOK_VERSION, variants });
}

/**
 * Exactly PLAY_SLOTS sanitised slots, however many were stored — and five
 * empty ones for anything that is not a list of plays at all.
 */
function parseSlots(raw) {
  const out = emptyPlaybook();
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < PLAY_SLOTS; i++) out[i] = sanitizePlay(raw[i]);
  return out;
}

function parseBookPair(raw) {
  const out = emptyBookPair();
  if (!raw || typeof raw !== 'object') return out;
  for (const side of BOOK_SIDES) out[side] = parseSlots(raw[side]);
  return out;
}

/**
 * Storage back into a library. Anything unrecognisable — absent, not JSON, a
 * version this build does not know, a play with a NaN in it — reads as an
 * empty library or an empty slot. Losing a saved play is a disappointment;
 * loading a corrupt one puts NaN into the physics, so the trade is not close.
 */
export function parseLibrary(text) {
  const out = emptyLibrary();
  if (typeof text !== 'string' || text === '') return out;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  if (!READABLE.has(raw.v)) return out;
  // Before version 3 there was one book and it was the offense's — a coach
  // could only ever be the offense at the time he saved it. This is a
  // migration, not a guess: those plays ARE offensive plays.
  if (raw.v < 3) {
    out[DEFAULT_VARIANT].offense = parseSlots(raw.slots);
    return out;
  }
  // Version 3 had two books and no variant — every game was 7-man then, so
  // those plays ARE the 7-man variant's, the same kind of migration as v1/v2.
  if (raw.v === 3) {
    if (!raw.books || typeof raw.books !== 'object') return out;
    out[DEFAULT_VARIANT] = parseBookPair(raw.books);
    return out;
  }
  if (!raw.variants || typeof raw.variants !== 'object') return out;
  for (const id of LIBRARY_VARIANTS) out[id] = parseBookPair(raw.variants[id]);
  return out;
}
