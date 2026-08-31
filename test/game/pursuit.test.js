import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pursuitTarget } from '../../lib/game/pursuit.js';
import { pursuitTarget as reExported } from '../../lib/game/ai.js';
import { assignBlocks, applyBlocks } from '../../lib/game/offense.js';
import { createGame, getPlayer } from '../../lib/game/state.js';

test('pursuitTarget lives in pursuit.js and ai.js re-exports the same function', () => {
  assert.equal(pursuitTarget, reExported);
  const s = createGame({ seed: 1 });
  const target = pursuitTarget(s, getPlayer(s, 'd-s'));
  assert.ok(Number.isFinite(target.x) && Number.isFinite(target.y));
});

test('offense.js no longer leans on ai.js', () => {
  const src = readFileSync(new URL('../../lib/game/offense.js', import.meta.url), 'utf8');
  assert.ok(!src.includes("from './ai.js'"));
});

test('the block helpers are public: nearest pairs, then plans', () => {
  const s = createGame({ seed: 1 });
  const blockers = s.players.filter((p) => ['o-wr1', 'o-wr2'].includes(p.id));
  const defenders = s.players.filter((p) => p.team === 'defense');
  const map = assignBlocks(blockers, defenders);
  assert.equal(map.get('o-wr1'), 'd-cb1'); // each takes the corner across from him
  assert.equal(map.get('o-wr2'), 'd-cb2');
  applyBlocks(s, blockers);
  assert.ok(getPlayer(s, 'o-wr1').plan);
  assert.ok(getPlayer(s, 'o-wr2').plan);
});
