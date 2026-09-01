/**
 * The playbook: PLAY_SLOTS fixed slots for one side of the ball, and the
 * versioned JSON they survive a reload as. A playbook is an array; a slot is a
 * play or null. A LIBRARY is the pair of them — one book for the offense, one
 * for the defense — because a play is orders for named men, and the names
 * change with the side you coach: an offensive sweep called while coaching the
 * secondary is five arrows for people who are not on your team, which
 * applyPlay would skip whole. Pure — this file knows what a playbook IS, and
 * app/playbook-store.js is the only thing that knows where one is kept.
 *
 * Version 2 added `spots` — a play carries the formation it was called from,
 * not just its arrows. Version 3 split the one book into two. Both older
 * versions survive reading, because a coach's five plays outlive a format
 * change: a version-1 play is a play with no formation in it, which
 * sanitizePlay already reads as `spots: {}`, and a version-1 or -2 BOOK is the
 * offense's, because until sides existed the coach was always the offense.
 * Writing is always the current version.
 */
import { sanitizePlay } from './play.js';
import { coachedSide } from './hud.js';

export const PLAY_SLOTS = 5;
export const PLAYBOOK_VERSION = 3;

/** The books a library holds, in the order they are stored in. */
export const BOOK_SIDES = ['offense', 'defense'];

/** Versions this build can read. Writing is always the current one. */
const READABLE = new Set([1, 2, 3]);

export function emptyPlaybook() {
  return Array.from({ length: PLAY_SLOTS }, () => null);
}

/** A fresh book for each side. Two arrays, never one array twice. */
export function emptyLibrary() {
  return { offense: emptyPlaybook(), defense: emptyPlaybook() };
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
 * The book for one side of the ball. A side there is no book for reads as an
 * empty book rather than as undefined: the caller is about to index five slots
 * off this, and a menu of five empty buttons is a better answer than a crash.
 */
export function bookFor(library, side) {
  return BOOK_SIDES.includes(side) ? (library[side] ?? emptyPlaybook()) : emptyPlaybook();
}

/**
 * A copy of the library with `side`'s book replaced. A copy, for the same
 * reason putPlay makes one: the two books must never come to share an array,
 * or saving a play while coaching the offense would file it with the defense's
 * as well, which is the exact bug this shape exists to prevent.
 */
export function putBook(library, side, book) {
  if (!BOOK_SIDES.includes(side)) return library;
  return { ...library, [side]: book };
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
  return JSON.stringify({
    v: PLAYBOOK_VERSION,
    books: { offense: library.offense, defense: library.defense },
  });
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
    out.offense = parseSlots(raw.slots);
    return out;
  }
  if (!raw.books || typeof raw.books !== 'object') return out;
  for (const side of BOOK_SIDES) out[side] = parseSlots(raw.books[side]);
  return out;
}
