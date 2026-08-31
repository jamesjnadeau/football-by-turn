import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, setMode, getPlayer } from '../../lib/game/state.js';
import { applyPendingCutBlocks } from '../../lib/game/block.js';
import { len, sub } from '../../lib/game/vec.js';
import { CUT_BLOCK_PUSH_UNITS, CUT_BLOCK_IMPULSE_SPEED } from '../../lib/game/constants.js';

function lineUp(id, defId) {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => [id, defId].includes(p.id));
  return s;
}

test('committing to a cut block does not move anyone yet', () => {
  const s = lineUp('o-lg', 'd-nt');
  const lg = getPlayer(s, 'o-lg');
  const nt = getPlayer(s, 'd-nt');
  lg.pos = { x: 135, y: 100 };
  nt.pos = { x: 135, y: 106 }; // downfield of the lineman, within engage range
  const before = { ...nt.pos };
  assert.equal(setMode(s, 'o-lg', 'cutBlock'), true);
  assert.deepEqual(nt.pos, before, 'the shove waits for the turn to actually start');
  assert.deepEqual(nt.vel, { x: 0, y: 0 });
});

test('the turn starting fires every pending cut block, pushing the nearest defender ahead of him straight back', () => {
  const s = lineUp('o-lg', 'd-nt');
  const lg = getPlayer(s, 'o-lg');
  const nt = getPlayer(s, 'd-nt');
  lg.pos = { x: 135, y: 100 };
  nt.pos = { x: 135, y: 106 };
  const before = { ...nt.pos };
  setMode(s, 'o-lg', 'cutBlock');
  applyPendingCutBlocks(s);
  const gap = len(sub(nt.pos, before));
  assert.ok(Math.abs(gap - CUT_BLOCK_PUSH_UNITS) < 1e-6, `pushed ${CUT_BLOCK_PUSH_UNITS} units, got ${gap}`);
  assert.ok(nt.pos.y > before.y, 'pushed straight downfield, away from the blocker');
  assert.equal(len(nt.vel), CUT_BLOCK_IMPULSE_SPEED);
});

test('the shove targets wherever the defender actually stood when the turn started, not when the stance was committed', () => {
  const s = lineUp('o-lg', 'd-nt');
  const lg = getPlayer(s, 'o-lg');
  const nt = getPlayer(s, 'd-nt');
  lg.pos = { x: 135, y: 100 };
  nt.pos = { x: 135, y: 300 }; // out of range at commit time
  setMode(s, 'o-lg', 'cutBlock');
  nt.pos = { x: 135, y: 106 }; // the rest of the huddle moves him into range before Run Turn
  applyPendingCutBlocks(s);
  assert.ok(nt.pos.y > 106, 'the late-arriving defender still gets cut');
});

test('applyPendingCutBlocks only fires for players actually committed to the stance', () => {
  const s = lineUp('o-lg', 'd-nt');
  const nt = getPlayer(s, 'd-nt');
  getPlayer(s, 'o-lg').pos = { x: 135, y: 100 };
  nt.pos = { x: 135, y: 106 };
  const before = { ...nt.pos };
  applyPendingCutBlocks(s); // nobody has committed to anything
  assert.deepEqual(nt.pos, before);
});

test('a cut block that finds nobody in range still leaves the stance committed', () => {
  const s = lineUp('o-lg', 'd-nt');
  getPlayer(s, 'o-lg').pos = { x: 135, y: 100 };
  getPlayer(s, 'd-nt').pos = { x: 135, y: 300 }; // far downfield, well out of range
  setMode(s, 'o-lg', 'cutBlock');
  applyPendingCutBlocks(s);
  assert.equal(getPlayer(s, 'o-lg').mode, 'cutBlock');
});

test('a cut block only hits a defender ahead of him, not one lined up behind', () => {
  const s = lineUp('o-lg', 'd-nt');
  const lg = getPlayer(s, 'o-lg');
  lg.pos = { x: 135, y: 100 };
  getPlayer(s, 'd-nt').pos = { x: 135, y: 94 }; // behind the lineman's downfield lunge
  const before = { ...getPlayer(s, 'd-nt').pos };
  setMode(s, 'o-lg', 'cutBlock');
  applyPendingCutBlocks(s);
  assert.deepEqual(getPlayer(s, 'd-nt').pos, before, 'a man behind him is not in the wedge');
});
