/**
 * The ghost coach. The lookup itself is pure and now lives in
 * lib/game/train/ghost.js, because the browser replays a log too; what stays
 * here is the one thing a browser has no use for — reading a log off disk.
 *
 * Node-only, therefore; lib/ must never import from here.
 */
import { readFileSync } from 'node:fs';
import { parseCoachLog } from '../lib/game/coach-log.js';

export * from '../lib/game/train/ghost.js';

/** A log as exported by the game's Coaches Menu, read off disk. */
export function loadGhostLog(path) {
  return parseCoachLog(readFileSync(path, 'utf8'));
}
