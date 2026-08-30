/**
 * The playbook: PLAY_SLOTS fixed slots, and the versioned JSON they survive a
 * reload as. A playbook is an array; a slot is a play or null. Pure — this
 * file knows what a playbook IS, and app/playbook-store.js is the only thing
 * that knows where one is kept.
 */
import { sanitizePlay } from './play.js';

export const PLAY_SLOTS = 5;
export const PLAYBOOK_VERSION = 1;

export function emptyPlaybook() {
  return Array.from({ length: PLAY_SLOTS }, () => null);
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

export function serializePlaybook(playbook) {
  return JSON.stringify({ v: PLAYBOOK_VERSION, slots: playbook });
}

/**
 * Storage back into a playbook. Anything unrecognisable — absent, not JSON, a
 * version this build does not know, a play with a NaN in it — reads as an empty
 * book or an empty slot. Losing a saved play is a disappointment; loading a
 * corrupt one puts NaN into the physics, so the trade is not close. Exactly
 * PLAY_SLOTS slots come back however many were stored.
 */
export function parsePlaybook(text) {
  const out = emptyPlaybook();
  if (typeof text !== 'string' || text === '') return out;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  if (raw.v !== PLAYBOOK_VERSION || !Array.isArray(raw.slots)) return out;
  for (let i = 0; i < PLAY_SLOTS; i++) out[i] = sanitizePlay(raw.slots[i]);
  return out;
}
