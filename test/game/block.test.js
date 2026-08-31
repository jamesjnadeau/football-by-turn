import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, setMode, getPlayer } from '../../lib/game/state.js';
import { len, sub } from '../../lib/game/vec.js';
import { CUT_BLOCK_PUSH_UNITS, CUT_BLOCK_IMPULSE_SPEED } from '../../lib/game/constants.js';

function lineUp(id, defId) {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => [id, defId].includes(p.id));
  return s;
}

test('cut-blocking pushes the nearest defender ahead of him straight back', () => {
  const s = lineUp('o-lg', 'd-nt');
  const lg = getPlayer(s, 'o-lg');
  const nt = getPlayer(s, 'd-nt');
  lg.pos = { x: 135, y: 100 };
  nt.pos = { x: 135, y: 106 }; // downfield of the lineman, within engage range
  const before = { ...nt.pos };
  assert.equal(setMode(s, 'o-lg', 'cutBlock'), true);
  const gap = len(sub(nt.pos, before));
  assert.ok(Math.abs(gap - CUT_BLOCK_PUSH_UNITS) < 1e-6, `pushed ${CUT_BLOCK_PUSH_UNITS} units, got ${gap}`);
  assert.ok(nt.pos.y > before.y, 'pushed straight downfield, away from the blocker');
  assert.equal(len(nt.vel), CUT_BLOCK_IMPULSE_SPEED);
});

test('a cut block that finds nobody in range still commits the stance', () => {
  const s = lineUp('o-lg', 'd-nt');
  getPlayer(s, 'o-lg').pos = { x: 135, y: 100 };
  getPlayer(s, 'd-nt').pos = { x: 135, y: 300 }; // far downfield, well out of range
  assert.equal(setMode(s, 'o-lg', 'cutBlock'), true);
  assert.equal(getPlayer(s, 'o-lg').mode, 'cutBlock');
});

test('a cut block only hits a defender ahead of him, not one lined up behind', () => {
  const s = lineUp('o-lg', 'd-nt');
  const lg = getPlayer(s, 'o-lg');
  lg.pos = { x: 135, y: 100 };
  getPlayer(s, 'd-nt').pos = { x: 135, y: 94 }; // behind the lineman's downfield lunge
  const before = { ...getPlayer(s, 'd-nt').pos };
  setMode(s, 'o-lg', 'cutBlock');
  assert.deepEqual(getPlayer(s, 'd-nt').pos, before, 'a man behind him is not in the wedge');
});
